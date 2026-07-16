using System.Net.Http.Json;
using System.Text.Json;
using Firebase.Database;
using Firebase.Database.Query;
using Firebase.Database.Streaming;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json.Linq;

namespace DeskPhone.RelayV2.Relay;

// Cloud relay client, v2 model: this host REPORTS presence and OBEYS the
// leader the cloud elects — it runs no arbitration math of its own (the
// scoring lives in exactly one place, the cloud's copy of phone-link.js).
//
// Transport: FirebaseDatabase.net (maintained community RTDB client, REST +
// SSE streaming with auto-reconnect) replaces the legacy hand-rolled SSE
// parser that silently dropped multi-line data: frames. Documented
// limitation, by design: onDisconnect() is a WebSocket-protocol feature of
// the official SDKs and is NOT available over REST/SSE — so a CRASHED
// Windows host is detected by the cloud's 60s presence-staleness scoring
// window rather than instantly; a gracefully stopped one removes its
// presence immediately. (The Android host uses the official SDK and gets
// true onDisconnect.)
public sealed class RelayClientV2 : IAsyncDisposable
{
    private static readonly TimeSpan HeartbeatEvery = TimeSpan.FromSeconds(15);
    private const string RtdbUrl = "https://onetaskonly-app-default-rtdb.firebaseio.com";
    private const string WebApiKey = "AIzaSyB5UiDE9s0xjWeYa4OQ1LLJ63EwPVoSLrA"; // public client key; RTDB rules are the gate
    private const string HostId = "windows";

    private readonly ILogger _log;
    private readonly HttpClient _http; // resilient (standard pipeline) — injected
    private readonly string _endpoint;
    private readonly string _secret;

    private FirebaseClient? _firebase;
    private IDisposable? _commandSub;
    private IDisposable? _leaderSub;
    private Timer? _heartbeat;
    private string _idToken = "";
    private DateTimeOffset _idTokenExpiry;
    private string _refreshToken = "";
    private readonly SemaphoreSlim _tokenGate = new(1, 1);

    public sealed record Leader(string HostId, long FencingToken, long Since);
    public Leader? CurrentLeader { get; private set; }
    public bool IAmLeader => CurrentLeader?.HostId == HostId;
    public event Func<string, Task>? CommandReceived; // fencing-checked command paths
    public Func<bool> IsPhoneConnected { get; set; } = () => false;
    public Func<int> LinkQuality { get; set; } = () => 0;

    public RelayClientV2(ILogger log, HttpClient http, string endpoint, string secret)
    {
        _log = log;
        _http = http;
        _endpoint = endpoint.TrimEnd('/');
        _secret = secret;
    }

    public async Task StartAsync(CancellationToken ct = default)
    {
        await EnsureIdTokenAsync(ct);
        _firebase = new FirebaseClient(RtdbUrl, new FirebaseOptions
        {
            AuthTokenAsyncFactory = async () => { await EnsureIdTokenAsync(CancellationToken.None); return _idToken; },
        });

        // Live leader watch — push, not poll.
        _leaderSub = _firebase.Child("phone-relay-v2/leader")
            .AsObservable<JToken>()
            .Subscribe(evt =>
            {
                try
                {
                    if (evt.Object is not JObject obj) return;
                    CurrentLeader = new Leader(
                        (string?)obj["hostId"] ?? "",
                        (long?)obj["fencingToken"] ?? 0,
                        (long?)obj["since"] ?? 0);
                    _log.LogInformation("leader: {Host} token {Token}{Me}",
                        CurrentLeader.HostId, CurrentLeader.FencingToken, IAmLeader ? " (me)" : "");
                }
                catch (Exception ex) { _log.LogWarning(ex, "leader event parse"); }
            });

        // Live command watch. Clear-before-dispatch (at-most-once, same
        // deliberate contract as v1) + fencing-token check per command.
        _commandSub = _firebase.Child("phone-relay-v2/commands")
            .AsObservable<JToken>()
            .Subscribe(evt => _ = DrainCommandsAsync());

        _heartbeat = new Timer(_ => _ = HeartbeatAsync(), null, TimeSpan.Zero, HeartbeatEvery);
        _log.LogInformation("relay v2 client started (presence heartbeat every {S}s)", HeartbeatEvery.TotalSeconds);
    }

    private async Task HeartbeatAsync()
    {
        try
        {
            await _firebase!.Child($"phone-relay-v2/presence/{HostId}")
                .PutAsync(JsonSerializer.Serialize(new
                {
                    t = new Dictionary<string, string> { [".sv"] = "timestamp" }, // server clock, not ours
                    connected = IsPhoneConnected(),
                    quality = LinkQuality(),
                }));
        }
        catch (Exception ex) { _log.LogWarning(ex, "presence heartbeat failed"); }
    }

    private async Task DrainCommandsAsync()
    {
        try
        {
            var node = _firebase!.Child("phone-relay-v2/commands");
            var raw = await node.OnceSingleAsync<JToken>();
            if (raw is null || raw.Type is JTokenType.Null or JTokenType.Undefined) return;
            var commands = raw switch
            {
                JArray arr => arr.OfType<JToken>().ToList(),
                JObject map => map.Properties().Select(p => p.Value).ToList(),
                _ => new List<JToken>(),
            };
            if (commands.Count == 0) return;

            await node.PutAsync("null"); // clear BEFORE dispatch — no double execution

            foreach (var cmd in commands)
            {
                var path = (string?)cmd["path"] ?? "";
                var token = (long?)cmd["fencingToken"] ?? -1;
                if (!IAmLeader || token != CurrentLeader?.FencingToken)
                {
                    _log.LogInformation("rejecting stale/misdirected command {Path} (cmdToken={T}, leader={L})",
                        path, token, CurrentLeader?.FencingToken);
                    continue;
                }
                if (path.Length > 0 && CommandReceived is { } handler)
                    await handler(path);
            }
        }
        catch (Exception ex) { _log.LogWarning(ex, "command drain failed"); }
    }

    /// Push the full state snapshot to the cloud (Zod-validated server-side).
    public async Task PushStateAsync(object statusPayload, IReadOnlyList<object> messages, IReadOnlyList<object> calls, IReadOnlyList<object> contacts, CancellationToken ct = default)
    {
        var body = new
        {
            hostId = HostId,
            fencingToken = CurrentLeader?.FencingToken ?? 0,
            status = statusPayload,
            messages,
            calls,
            contacts,
        };
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{_endpoint}?action=push&hostType={HostId}")
        {
            Content = JsonContent.Create(body),
        };
        req.Headers.Add("X-Relay-Secret", _secret);
        var res = await _http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode)
            _log.LogWarning("state push -> HTTP {Status}: {Body}", (int)res.StatusCode, await res.Content.ReadAsStringAsync(ct));
    }

    // ── Auth: per-platform secret -> custom token -> ID token (+refresh) ─────

    private async Task EnsureIdTokenAsync(CancellationToken ct)
    {
        if (_idToken.Length > 0 && DateTimeOffset.UtcNow < _idTokenExpiry - TimeSpan.FromMinutes(5)) return;
        await _tokenGate.WaitAsync(ct);
        try
        {
            if (_idToken.Length > 0 && DateTimeOffset.UtcNow < _idTokenExpiry - TimeSpan.FromMinutes(5)) return;

            if (_refreshToken.Length > 0)
            {
                try { await RefreshIdTokenAsync(ct); return; }
                catch (Exception ex) { _log.LogInformation(ex, "token refresh failed; re-minting"); }
            }

            using var mintReq = new HttpRequestMessage(HttpMethod.Post, $"{_endpoint}?action=relaytoken")
            {
                Content = JsonContent.Create(new { hostType = HostId, hostInstanceId = Environment.MachineName }),
            };
            mintReq.Headers.Add("X-Relay-Secret", _secret);
            var mint = await _http.SendAsync(mintReq, ct);
            mint.EnsureSuccessStatusCode();
            var custom = (await mint.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: ct))
                .GetProperty("customToken").GetString()!;

            var signIn = await _http.PostAsJsonAsync(
                $"https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key={WebApiKey}",
                new { token = custom, returnSecureToken = true }, ct);
            signIn.EnsureSuccessStatusCode();
            var payload = await signIn.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: ct);
            _idToken = payload.GetProperty("idToken").GetString()!;
            _refreshToken = payload.GetProperty("refreshToken").GetString()!;
            _idTokenExpiry = DateTimeOffset.UtcNow + TimeSpan.FromSeconds(
                int.Parse(payload.GetProperty("expiresIn").GetString() ?? "3600"));
        }
        finally { _tokenGate.Release(); }
    }

    private async Task RefreshIdTokenAsync(CancellationToken ct)
    {
        var res = await _http.PostAsync(
            $"https://securetoken.googleapis.com/v1/token?key={WebApiKey}",
            new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "refresh_token",
                ["refresh_token"] = _refreshToken,
            }), ct);
        res.EnsureSuccessStatusCode();
        var payload = await res.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: ct);
        _idToken = payload.GetProperty("id_token").GetString()!;
        _refreshToken = payload.GetProperty("refresh_token").GetString()!;
        _idTokenExpiry = DateTimeOffset.UtcNow + TimeSpan.FromSeconds(
            int.Parse(payload.GetProperty("expires_in").GetString() ?? "3600"));
    }

    public async ValueTask DisposeAsync()
    {
        _heartbeat?.Dispose();
        _commandSub?.Dispose();
        _leaderSub?.Dispose();
        // Graceful release: remove presence NOW so re-election is immediate on
        // clean shutdown (the crash path relies on the 60s staleness window).
        try { if (_firebase != null) await _firebase.Child($"phone-relay-v2/presence/{HostId}").PutAsync("null"); }
        catch (Exception ex) { _log.LogInformation(ex, "graceful presence release failed"); }
        _firebase?.Dispose();
    }
}
