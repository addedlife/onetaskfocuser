using System.Collections.Concurrent;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace DeskPhone.Services;

/// <summary>
/// Cloud relay: pushes phone state to the Netlify phone-relay function every few seconds
/// and drains any commands queued there by a remote browser.
///
/// This is what makes calls/texts work from any browser anywhere in the world,
/// even when the browser can't directly reach localhost:8765.
/// </summary>
public class RelayService : IDisposable
{
    // Firestore REST — writes go directly to Firebase, bypassing the Netlify relay function entirely.
    // The web API key is intentionally public (Firebase design; security enforced by Firestore rules).
    private const string FB_PROJECT  = "onetaskonly-app";
    private const string FB_API_KEY  = "AIzaSyB5UiDE9s0xjWeYa4OQ1LLJ63EwPVoSLrA";
    private const string FS_BASE     = "https://firestore.googleapis.com/v1/projects/" + FB_PROJECT + "/databases/(default)/documents";

    private const int PushIntervalMs     = 300_000; // backup heartbeat: 5 min liveness-only.
                                                    // Commands arrive via Firestore streaming listener — no polling.
                                                    // Phone connect/disconnect fires PushNow() immediately.
    private const int MessageRelayLimit  = 150;     // messages in the cloud blob — onSnapshot re-sends the
                                                    // WHOLE doc to every device on each change, so keep it
                                                    // small (mobile-data friendly, well under Firestore's
                                                    // 1 MiB doc cap). The LAN /messages path keeps full 5000.
    private const int HttpTimeoutMs      = 8_000;
    private const int MinPushGapMs       = 900;     // floor between pushes so a burst of texts coalesces

    // ── Callbacks wired by MainViewModel (same sources as ControlApiService) ─
    public Func<string>?                           GetStatus   { get; set; }
    public Func<int, bool, string>?                GetMessages { get; set; }
    public Func<string>?                           GetCalls    { get; set; }
    public Func<string>?                           GetContacts { get; set; }
    public Func<string, Task>?                     Dial        { get; set; }
    public Func<Task>?                             HangUp      { get; set; }
    public Func<Task>?                             Answer      { get; set; }
    public Func<Task>?                             ToggleMute  { get; set; }
    // (to, body, clientMessageId?) — cid from the web echo rides through so the
    // new message's LocalId matches it exactly (see ControlApiService.Send).
    public Func<string, string, string?, Task<bool>>? Send     { get; set; }
    public Func<Task>?                             Refresh     { get; set; }
    public Func<string, Task>?                     MarkRead    { get; set; }
    public Func<string, Task>?                     MarkUnread  { get; set; }
    public Func<Task>?                             Connect     { get; set; }
    public Func<Task<bool>>?                       ShowApp     { get; set; }
    public Action<string>?                         LogLine     { get; set; }
    public Func<string>?                           GetLanUrl   { get; set; }
    // Returns (mediaId, dataUrl) for resized picture-text previews to upload out-of-band.
    public Func<List<(string id, string dataUrl)>>? GetRelayMedia { get; set; }
    /// <summary>Whether THIS host currently holds the phone's Bluetooth link.
    /// Relay arbitration rule (shared with the Android tablet host, b4+): only the
    /// connected host pushes state and drains commands; a parked host goes silent
    /// after one farewell push, so two hosts never fight over the cloud doc and a
    /// remote command never executes twice.</summary>
    public Func<bool>? IsPhoneConnected { get; set; }
    private bool _lastPushedConnected = true;   // true → the farewell push always fires once
    /// <summary>Fired when arbitration says this host must let go of the phone while it
    /// still holds the Bluetooth link (the owner flipped `preferred` to the other host).
    /// MainViewModel wires this to a clean BT teardown — but never mid-call, so it may
    /// decline; arbitration re-fires every tick until the link is actually down.</summary>
    public Func<Task>? ReleasePhone { get; set; }

    // ── Host arbitration (owner doc: phone-relay/owner) ─────────────────────────
    // One tiny shared doc decides which host holds the phone, so the PC and the
    // tablet never fight over the phone's Bluetooth link — that tug-of-war was the
    // connect/disconnect/forget/remove swamp. The rule is additive and safe: only
    // the host that SHOULD hold ever initiates a connection; a non-preferred host
    // simply never grabs (no disconnect, no teardown). The web toggle writes
    // `preferred`; the active holder renews `host`/`t`/`connected` as a heartbeat.
    // (Web side: apps/web/src/08-app-split/phone-host-control.js.)
    public string HostId { get; set; } = "windows";       // this host's id in the owner doc
    private const int  OwnerHeartbeatMs     = 15_000;     // renew cadence while holding
    private const int  OwnerStaleMs         = 90_000;     // preferred host silent this long ⇒ treat as dead
    private const int  OwnerTakeoverGraceMs = 90_000;     // brief yield after a fresh switch before taking over
    private const int  OwnerSwitchPollMs    = 5_000;      // faster poll while a handoff is in flight
    private const int  OwnerSwitchWindowMs  = 90_000;     // how long after a preference flip we poll fast
    private volatile bool _shouldHoldPhone  = true;       // default true = legacy "always try to hold"
    private long _lastPreferredAtMs;                      // preferredAtMs from the last owner-doc read
    /// <summary>Whether THIS host should currently hold the phone. MainViewModel's
    /// startup auto-connect and watchdog consult this before initiating a connection.</summary>
    public bool ShouldHoldPhone => _shouldHoldPhone;

    // ── Config ────────────────────────────────────────────────────────────────
    private string _relayKey = "";
    public  bool   IsEnabled => !string.IsNullOrWhiteSpace(_relayKey);

    // ── State ─────────────────────────────────────────────────────────────────
    private CancellationTokenSource _cts      = new();
    private readonly HttpClient     _http       = new() { Timeout = TimeSpan.FromMilliseconds(HttpTimeoutMs) };
    private DateTime                _lastPush = DateTime.MinValue;
    private int                     _pushErrors;

    // PushNow coalescing: serialize all pushes through one gate, and collapse a
    // burst of PushNow() calls (e.g. 5 texts at once) into a single trailing push.
    private readonly SemaphoreSlim  _pushGate        = new(1, 1);
    private volatile bool           _pushNowScheduled;
    private readonly HashSet<string> _uploadedMedia  = new();   // mediaIds already in phone-media

    // Last few command acknowledgements, pre-serialized JSON objects. They ride every
    // state push so the browser that queued a command (and got an id back from
    // ?action=command) can confirm the command's REAL outcome instead of assuming success.
    private readonly ConcurrentQueue<string> _commandResults = new();
    private const int CommandResultLimit = 20;

    private void RecordCommandResult(string commandId, string path, bool ok, string? error)
    {
        if (string.IsNullOrWhiteSpace(commandId)) return;   // command predates the ack protocol
        _commandResults.Enqueue(JsonSerializer.Serialize(new
        {
            id          = commandId,
            path,
            ok,
            error       = error ?? "",
            completedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        }));
        while (_commandResults.Count > CommandResultLimit && _commandResults.TryDequeue(out _)) { }
    }

    // Commands queue in the cloud mailbox while the PC is offline and execute on wake,
    // which can be hours later.  A stale /dial must never ring someone in the middle of
    // the night; a stale /send is acked as expired so the sender sees the truth instead
    // of a surprise delivery or a silent drop.
    private static TimeSpan CommandTtl(string path) => path switch
    {
        // /show joins the short bucket: raising the PC window hours after the tap
        // would be a poltergeist, not a feature.
        "/dial" or "/answer" or "/hangup" or "/toggle-mute" or "/show" => TimeSpan.FromSeconds(45),
        _ => TimeSpan.FromMinutes(10),
    };

    public void Configure(string relayKey, string? relayUrl)
    {
        _relayKey = relayKey?.Trim() ?? "";
        // relayUrl is no longer used — the host writes directly to Firestore (see FS_BASE).
        // Kept in the signature so the settings layer needs no change.
    }

    public void Start()
    {
        if (!IsEnabled) return;
        _cts = new CancellationTokenSource();
        _ = Task.Run(() => PushLoopAsync(_cts.Token));
        _ = Task.Run(() => StreamRtdbCommandsAsync(_cts.Token));
        _ = Task.Run(() => DrainCommandsLoopAsync(_cts.Token));
        _ = Task.Run(() => ArbitrationLoopAsync(_cts.Token));
        LogLine?.Invoke($"[RELAY] Started — writing directly to Firestore ({FB_PROJECT})");
    }

    public void Stop()
    {
        _cts.Cancel();
        LogLine?.Invoke("[RELAY] Stopped");
    }

    // ── Push loop: state → cloud ──────────────────────────────────────────────
    private async Task PushLoopAsync(CancellationToken ct)
    {
        // Push FIRST, then wait — so the cloud mailbox is fresh the instant the relay
        // starts. (Previously it waited a full interval before the first push, leaving
        // remote phones staring at an empty/stale mailbox for the first ~5 seconds.)
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await PushStateAsync();
                _pushErrors = 0;
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                _pushErrors++;
                if (_pushErrors <= 3)
                    LogLine?.Invoke($"[RELAY PUSH] {ex.GetType().Name}: {ex.Message}");
            }

            try { await Task.Delay(PushIntervalMs, ct); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task PushStateAsync()
    {
        if (GetStatus is null) return;

        // Arbitration: while another host (the tablet) holds the phone, our pushes
        // would overwrite its live cloud data with our disconnected snapshot. One
        // farewell push flips the cloud to "disconnected", then we stay silent
        // until the link comes back to us.
        var connected = IsPhoneConnected?.Invoke() ?? true;
        if (!connected && !_lastPushedConnected) return;

        // Serialize every push (heartbeat loop + PushNow) so two writes never race
        // the same Firestore doc. The gate is released in finally.
        await _pushGate.WaitAsync();
        try
        {
            // Upload any new picture-text images first, so the state blob's mediaId
            // references resolve the moment a phone reads it.
            await UploadPendingMediaAsync();

            // Build state blob: status + recent messages + calls + contacts.
            // relayReceivedAt is stamped here (previously the Netlify function did it)
            // since the host now writes directly to Firestore.
            var nowMs        = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var statusJson   = GetStatus();
            var messagesJson = GetMessages?.Invoke(MessageRelayLimit, false) ?? "[]";
            var callsJson    = GetCalls?.Invoke() ?? "[]";
            var contactsJson = GetContacts?.Invoke() ?? "[]";
            var lanUrl       = GetLanUrl?.Invoke() ?? "";
            var resultsJson  = "[" + string.Join(",", _commandResults) + "]";
            var stateJson    = $"{{\"status\":{statusJson},\"messages\":{messagesJson},\"calls\":{callsJson},\"contacts\":{contactsJson},\"commandResults\":{resultsJson},\"lanUrl\":\"{lanUrl}\",\"pushedAt\":{nowMs},\"relayReceivedAt\":{nowMs}}}";

            // Write state directly to Firestore — no Netlify hop.
            var fsStateBody = $"{{\"fields\":{{\"data\":{{\"stringValue\":{JsonSerializer.Serialize(stateJson)}}}}}}}";
            var stateUrl    = $"{FS_BASE}/phone-relay/state?key={FB_API_KEY}&updateMask.fieldPaths=data";
            using var stateContent = new StringContent(fsStateBody, Encoding.UTF8, "application/json");
            using var stateReq     = new HttpRequestMessage(HttpMethod.Patch, stateUrl) { Content = stateContent };
            using var stateResp    = await _http.SendAsync(stateReq);
            if (!stateResp.IsSuccessStatusCode)
            {
                var body = await stateResp.Content.ReadAsStringAsync();
                throw new Exception($"Firestore state PATCH HTTP {(int)stateResp.StatusCode} — {body[..Math.Min(200, body.Length)]}");
            }
            _lastPush = DateTime.UtcNow;
            _lastPushedConnected = connected;
        }
        finally { _pushGate.Release(); }
    }

    // ── Command mailbox: Realtime Database, true push ───────────────────────────
    // The commands mailbox lives in the Realtime Database (b326+), whose REST API
    // supports genuine SSE streaming — one idle HTTP connection instead of thousands
    // of idle Firestore reads per day, and commands land in under a second.
    //
    // Firestore's REST documents:listen can NEVER replace this: the server treats
    // the transcoded bidi call as complete the instant the request body ends and
    // closes with "[]" (verified 2026-07-02 with curl). b322 shipped exactly that
    // listener, so no relayed command was delivered for 15 days. Do not go back.
    //
    // The poll loop below stays as the safety net: fast while the stream is down,
    // nearly silent while it's healthy (RTDB GETs are free — bandwidth only).
    private const string RtdbCommandsUrl = "https://" + FB_PROJECT + "-default-rtdb.firebaseio.com/phone-relay/commands.json";
    private readonly HttpClient _streamHttp = new() { Timeout = Timeout.InfiniteTimeSpan };
    private volatile bool _rtdbStreamHealthy;

    // ── RTDB auth: the commands mailbox used to be a public .read/.write:true
    // rule (anyone, signed in or not, could read/inject phone commands). It now
    // requires a Firebase ID token carrying relay_device:true. DeskPhone gets one
    // by POSTing its existing X-Relay-Secret to the phone-relay Function's
    // ?action=relay-token (mints a custom token), then exchanging that for a real
    // ID token via Identity Toolkit. Cached and refreshed ~5 min before its
    // 1-hour expiry; every direct RTDB call below attaches it as a Bearer header.
    private const string RelayTokenMintUrl = "https://us-central1-" + FB_PROJECT + ".cloudfunctions.net/phoneRelay?action=relay-token";
    private const string IdentityToolkitSignInUrl = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=" + FB_API_KEY;
    private string? _relayIdToken;
    private DateTime _relayIdTokenExpiryUtc = DateTime.MinValue;
    private readonly SemaphoreSlim _relayTokenGate = new(1, 1);

    private async Task<string?> GetRelayIdTokenAsync(CancellationToken ct)
    {
        if (_relayIdToken != null && DateTime.UtcNow < _relayIdTokenExpiryUtc) return _relayIdToken;
        await _relayTokenGate.WaitAsync(ct);
        try
        {
            if (_relayIdToken != null && DateTime.UtcNow < _relayIdTokenExpiryUtc) return _relayIdToken;
            if (string.IsNullOrWhiteSpace(_relayKey))
            {
                LogLine?.Invoke("[RELAY AUTH] no relay secret configured — cannot mint an RTDB token");
                return null;
            }
            using var mintReq = new HttpRequestMessage(HttpMethod.Post, RelayTokenMintUrl);
            mintReq.Headers.Add("X-Relay-Secret", _relayKey);
            using var mintResp = await _http.SendAsync(mintReq, ct);
            if (!mintResp.IsSuccessStatusCode)
            {
                LogLine?.Invoke($"[RELAY AUTH] token mint HTTP {(int)mintResp.StatusCode}");
                return null;
            }
            using var mintDoc = JsonDocument.Parse(await mintResp.Content.ReadAsStringAsync(ct));
            var customToken = mintDoc.RootElement.GetProperty("customToken").GetString();

            using var signInReq = new HttpRequestMessage(HttpMethod.Post, IdentityToolkitSignInUrl)
            {
                Content = new StringContent(
                    JsonSerializer.Serialize(new { token = customToken, returnSecureToken = true }),
                    Encoding.UTF8, "application/json")
            };
            using var signInResp = await _http.SendAsync(signInReq, ct);
            if (!signInResp.IsSuccessStatusCode)
            {
                LogLine?.Invoke($"[RELAY AUTH] sign-in HTTP {(int)signInResp.StatusCode}");
                return null;
            }
            using var signInDoc = JsonDocument.Parse(await signInResp.Content.ReadAsStringAsync(ct));
            _relayIdToken = signInDoc.RootElement.GetProperty("idToken").GetString();
            var expiresInSec = int.TryParse(signInDoc.RootElement.GetProperty("expiresIn").GetString(), out var s) ? s : 3600;
            _relayIdTokenExpiryUtc = DateTime.UtcNow.AddSeconds(Math.Max(60, expiresInSec - 300));
            return _relayIdToken;
        }
        catch (Exception ex)
        {
            LogLine?.Invoke($"[RELAY AUTH] {ex.GetType().Name}: {ex.Message}");
            return null;
        }
        finally { _relayTokenGate.Release(); }
    }

    private async Task AttachRelayAuthAsync(HttpRequestMessage req, CancellationToken ct)
    {
        // RTDB's REST API only honors Firebase ID tokens as an ?auth= query
        // parameter. An Authorization: Bearer header is parsed as a (wrong-type)
        // Google OAuth2 access token and the request 401s. b338 shipped the
        // Bearer form, so from the moment the rules locked down (7/15) every
        // mailbox read/clear failed silently and no cloud command was delivered.
        var idToken = await GetRelayIdTokenAsync(ct);
        if (idToken == null || req.RequestUri == null) return;
        var sep = string.IsNullOrEmpty(req.RequestUri.Query) ? "?" : "&";
        req.RequestUri = new Uri(req.RequestUri.AbsoluteUri + sep + "auth=" + Uri.EscapeDataString(idToken));
    }

    private const int DrainStreamHealthyMs = 120_000; // safety sweep behind a live stream
    private const int DrainIdleMs          = 6_000;   // stream down, no recent commands
    private const int DrainActiveMs        = 2_000;   // stream down, commands flowing
    private static readonly TimeSpan DrainActiveWindow = TimeSpan.FromMinutes(3);
    private static readonly TimeSpan LegacySweepEvery  = TimeSpan.FromSeconds(60);
    private DateTime _lastCommandSeenUtc = DateTime.MinValue;
    private DateTime _lastLegacySweepUtc = DateTime.MinValue;

    private async Task StreamRtdbCommandsAsync(CancellationToken ct)
    {
        int attempt = 0;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Get, RtdbCommandsUrl);
                req.Headers.Accept.ParseAdd("text/event-stream");
                await AttachRelayAuthAsync(req, ct);
                using var resp = await _streamHttp.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
                if (!resp.IsSuccessStatusCode)
                {
                    LogLine?.Invoke($"[RELAY STREAM] HTTP {(int)resp.StatusCode}");
                }
                else
                {
                    attempt = 0;
                    _rtdbStreamHealthy = true;
                    LogLine?.Invoke("[RELAY STREAM] live — commands arrive by push");

                    await using var stream = await resp.Content.ReadAsStreamAsync(ct);
                    using var reader = new StreamReader(stream);
                    string? eventName = null;
                    while (!ct.IsCancellationRequested)
                    {
                        var line = await reader.ReadLineAsync(ct);
                        if (line == null) break; // stream closed
                        if (line.StartsWith("event:")) { eventName = line[6..].Trim(); continue; }
                        if (!line.StartsWith("data:")) continue;
                        if (eventName is not ("put" or "patch")) continue;
                        var payload = line[5..].Trim();
                        if (payload.Length == 0 || payload == "null") continue;
                        try
                        {
                            using var evt = JsonDocument.Parse(payload);
                            if (evt.RootElement.TryGetProperty("data", out var data) &&
                                data.ValueKind != JsonValueKind.Null)
                            {
                                await DrainMailboxOnceAsync(ct);
                            }
                        }
                        catch { /* malformed chunk — skip */ }
                    }
                    if (!ct.IsCancellationRequested)
                        LogLine?.Invoke("[RELAY STREAM] ended — reconnecting");
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                LogLine?.Invoke($"[RELAY STREAM] {ex.GetType().Name}: {ex.Message}");
            }

            _rtdbStreamHealthy = false;
            attempt = Math.Min(attempt + 1, 5);
            try { await Task.Delay(Math.Min(30_000, 1_000 << attempt), ct); }
            catch (OperationCanceledException) { break; }
        }
        _rtdbStreamHealthy = false;
    }

    // Fetch + clear + dispatch the RTDB mailbox. Shared by the SSE trigger and the
    // safety-net poll. Clears BEFORE dispatch so a slow command (e.g. a send over a
    // reconnecting link) can't be re-read and re-executed.
    private async Task<bool> DrainMailboxOnceAsync(CancellationToken ct)
    {
        // Parked host: the command mailbox belongs to whichever host holds the
        // phone — draining here would execute commands on a phone-less PC.
        if (IsPhoneConnected?.Invoke() == false) return false;
        using var getReq = new HttpRequestMessage(HttpMethod.Get, RtdbCommandsUrl);
        await AttachRelayAuthAsync(getReq, ct);
        using var resp = await _http.SendAsync(getReq, ct);
        if (!resp.IsSuccessStatusCode)
        {
            LogLine?.Invoke($"[RELAY DRAIN] RTDB HTTP {(int)resp.StatusCode}");
            return false;
        }
        var body = (await resp.Content.ReadAsStringAsync(ct)).Trim();
        if (body.Length <= 2 || body == "null") return false;

        using (var clearReq = new HttpRequestMessage(HttpMethod.Put, RtdbCommandsUrl)
        { Content = new StringContent("null", Encoding.UTF8, "application/json") })
        {
            await AttachRelayAuthAsync(clearReq, ct);
            await _http.SendAsync(clearReq, ct);
        }

        var commandsJson = NormalizeRtdbArray(body);
        if (commandsJson.Length <= 2) return false;
        _lastCommandSeenUtc = DateTime.UtcNow;
        DispatchCommandsFromString(commandsJson);
        return true;
    }

    // RTDB stores arrays as objects ({"0":{...},"1":{...}}) when keys go sparse —
    // normalize either shape back to the JSON array DispatchCommandsFromString expects.
    private static string NormalizeRtdbArray(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.ValueKind == JsonValueKind.Array) return body;
            if (doc.RootElement.ValueKind == JsonValueKind.Object)
            {
                var items = doc.RootElement.EnumerateObject()
                    .OrderBy(p => int.TryParse(p.Name, out var i) ? i : int.MaxValue)
                    .Select(p => p.Value.GetRawText());
                return "[" + string.Join(",", items) + "]";
            }
        }
        catch { }
        return "[]";
    }

    private async Task DrainCommandsLoopAsync(CancellationToken ct)
    {
        var loggedFirstPoll = false;
        var consecutiveErrors = 0;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await DrainMailboxOnceAsync(ct);
                if (!loggedFirstPoll)
                {
                    loggedFirstPoll = true;
                    LogLine?.Invoke("[RELAY DRAIN] command mailbox reachable — remote commands will run");
                }
                consecutiveErrors = 0;

                // Transition sweep (remove in a later build): commands queued by the
                // pre-RTDB relay function still land in the old Firestore doc.
                if (DateTime.UtcNow - _lastLegacySweepUtc >= LegacySweepEvery)
                {
                    _lastLegacySweepUtc = DateTime.UtcNow;
                    await DrainLegacyFirestoreOnceAsync(ct);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                consecutiveErrors++;
                if (consecutiveErrors <= 3)
                    LogLine?.Invoke($"[RELAY DRAIN] {ex.GetType().Name}: {ex.Message}");
            }

            var interval = _rtdbStreamHealthy
                ? DrainStreamHealthyMs
                : (DateTime.UtcNow - _lastCommandSeenUtc < DrainActiveWindow ? DrainActiveMs : DrainIdleMs);
            try { await Task.Delay(interval, ct); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task DrainLegacyFirestoreOnceAsync(CancellationToken ct)
    {
        if (IsPhoneConnected?.Invoke() == false) return;
        try
        {
            var url = $"{FS_BASE}/phone-relay/commands?key={FB_API_KEY}";
            using var resp = await _http.GetAsync(url, ct);
            if (!resp.IsSuccessStatusCode) return;   // 404 = doc gone — nothing legacy left
            var body = await resp.Content.ReadAsStringAsync(ct);
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("fields", out var fields) &&
                fields.TryGetProperty("data", out var data) &&
                data.TryGetProperty("stringValue", out var sv))
            {
                var commandsJson = sv.GetString() ?? "[]";
                if (commandsJson.Length > 2)
                {
                    _lastCommandSeenUtc = DateTime.UtcNow;
                    await ClearCommandsAsync();
                    DispatchCommandsFromString(commandsJson);
                }
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
        catch (Exception ex)
        {
            LogLine?.Invoke($"[RELAY LEGACY] {ex.GetType().Name}: {ex.Message}");
        }
    }

    private async Task ClearCommandsAsync()
    {
        try
        {
            const string clearBody = "{\"fields\":{\"data\":{\"stringValue\":\"[]\"}}}";
            var clearUrl = $"{FS_BASE}/phone-relay/commands?key={FB_API_KEY}&updateMask.fieldPaths=data";
            using var content = new StringContent(clearBody, Encoding.UTF8, "application/json");
            using var req = new HttpRequestMessage(HttpMethod.Patch, clearUrl) { Content = content };
            await _http.SendAsync(req);
        }
        catch (Exception ex)
        {
            LogLine?.Invoke($"[RELAY CLEAR] {ex.GetType().Name}: {ex.Message}");
        }
    }

    // Upload resized picture-text previews to phone-media/{id} directly in Firestore,
    // once each. Runs inside the push gate so _uploadedMedia is touched single-threaded.
    // A failed upload is simply retried on the next push (the id isn't marked done).
    private async Task UploadPendingMediaAsync()
    {
        var media = GetRelayMedia?.Invoke();
        if (media is null || media.Count == 0) return;

        foreach (var (id, dataUrl) in media)
        {
            if (_uploadedMedia.Contains(id)) continue;
            try
            {
                var fsBody   = $"{{\"fields\":{{\"data\":{{\"stringValue\":{JsonSerializer.Serialize(dataUrl)}}}}}}}";
                var mediaUrl = $"{FS_BASE}/phone-media/{Uri.EscapeDataString(id)}?key={FB_API_KEY}&updateMask.fieldPaths=data";
                using var content = new StringContent(fsBody, Encoding.UTF8, "application/json");
                using var req     = new HttpRequestMessage(HttpMethod.Patch, mediaUrl) { Content = content };
                using var resp    = await _http.SendAsync(req);
                if (resp.IsSuccessStatusCode) _uploadedMedia.Add(id);
                else LogLine?.Invoke($"[RELAY MEDIA] {id} → HTTP {(int)resp.StatusCode}");
            }
            catch (Exception ex)
            {
                LogLine?.Invoke($"[RELAY MEDIA] {id}: {ex.Message}");
            }
        }
    }

    /// <summary>
    /// Push state to the cloud immediately instead of waiting for the 5 s heartbeat.
    /// Call this whenever the phone state changes (new text, sent text, read-state,
    /// command result) so all remote browsers see it within ~1 s.
    ///
    /// Coalescing: idle → fires right away; mid-burst → collapses to a single trailing
    /// push (≥ MinPushGapMs apart) that always carries the latest state, because the
    /// blob is rebuilt from the live callbacks at send time.
    /// </summary>
    public void PushNow()
    {
        if (!IsEnabled) return;
        if (_pushNowScheduled) return;     // a push is already queued for this burst
        _pushNowScheduled = true;

        _ = Task.Run(async () =>
        {
            try
            {
                var since = DateTime.UtcNow - _lastPush;
                var wait  = MinPushGapMs - (int)since.TotalMilliseconds;
                if (wait > 0) await Task.Delay(wait);
                _pushNowScheduled = false;  // reset BEFORE sending so changes during the
                                            // send schedule the next trailing push
                await PushStateAsync();
            }
            catch (Exception ex)
            {
                _pushNowScheduled = false;
                LogLine?.Invoke($"[RELAY PUSHNOW] {ex.GetType().Name}: {ex.Message}");
            }
        });
    }

    // ── Command dispatch ──────────────────────────────────────────────────────
    // Parses a raw JSON array string (the Firestore "data" field from phone-relay/commands)
    // and fires each command. Called from OnListenEvent when the streaming listener detects a change.
    private void DispatchCommandsFromString(string commandsJson)
    {
        if (string.IsNullOrWhiteSpace(commandsJson)) return;
        using var doc = JsonDocument.Parse(commandsJson);
        if (doc.RootElement.ValueKind != JsonValueKind.Array) return;

        foreach (var cmdEl in doc.RootElement.EnumerateArray())
        {
            var path = cmdEl.TryGetProperty("path", out var pEl) ? (pEl.GetString() ?? "") : "";
            if (string.IsNullOrWhiteSpace(path)) continue;
            var id       = cmdEl.TryGetProperty("id", out var idEl) ? (idEl.GetString() ?? "") : "";
            var queuedAt = cmdEl.TryGetProperty("queuedAt", out var qEl) && qEl.TryGetInt64(out var qv) ? qv : 0L;
            _ = Task.Run(() => ExecuteCommandAsync(path, id, queuedAt));
        }
    }

    // Parse the path+query string (same format the webapp already sends to localhost),
    // route to the appropriate callback, and acknowledge the command's real outcome.
    private async Task ExecuteCommandAsync(string rawPath, string commandId, long queuedAtMs)
    {
        var q    = rawPath.IndexOf('?');
        var path = (q < 0 ? rawPath : rawPath[..q]).ToLowerInvariant();
        var qs   = q < 0 ? "" : rawPath[(q + 1)..];

        try
        {
            LogLine?.Invoke($"[RELAY CMD] {path}");

            // Fail-safe: a command with no parseable queuedAt cannot prove freshness.
            // The mailbox holds entries queued while the PC was offline — for DAYS when
            // the drain was broken (b322) — and executing an unverifiable /dial or /send
            // is how a stale command rings someone in the middle of the night. The live
            // relay function always stamps queuedAt, so only legacy junk is refused.
            if (queuedAtMs <= 0)
            {
                LogLine?.Invoke($"[RELAY CMD] {path} has no queue timestamp — treated as expired");
                RecordCommandResult(commandId, path, ok: false, error: "no queue timestamp — treated as expired");
                PushNow();
                return;
            }

            var ageMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - queuedAtMs;
            if (ageMs > CommandTtl(path).TotalMilliseconds)
            {
                LogLine?.Invoke($"[RELAY CMD] {path} expired ({ageMs / 1000}s in queue) — not executed");
                RecordCommandResult(commandId, path, ok: false, error: "expired before DeskPhone was online");
                PushNow();
                return;
            }

            bool ok = true;
            string? error = null;

            switch (path)
            {
                case "/dial":
                    var n = ParseStr(qs, "n");
                    if (string.IsNullOrWhiteSpace(n) || Dial is null) { ok = false; error = "missing number"; }
                    else await Dial(n);
                    break;
                case "/hangup":
                    if (HangUp is null) { ok = false; error = "unavailable"; }
                    else await HangUp();
                    break;
                case "/answer":
                    if (Answer is null) { ok = false; error = "unavailable"; }
                    else await Answer();
                    break;
                case "/toggle-mute":
                    if (ToggleMute is null) { ok = false; error = "unavailable"; }
                    else await ToggleMute();
                    break;
                case "/send":
                    var to   = ParseStr(qs, "to");
                    var body = ParseStr(qs, "body");
                    var cid  = ParseStr(qs, "cid");
                    if (string.IsNullOrWhiteSpace(to) || string.IsNullOrWhiteSpace(body) || Send is null)
                    {
                        ok = false; error = "missing recipient or message body";
                    }
                    else
                    {
                        ok = await Send(to, body, string.IsNullOrWhiteSpace(cid) ? null : cid);
                        if (!ok) error = "phone link rejected the send — kept as Failed in DeskPhone for retry";
                        LogLine?.Invoke(ok
                            ? $"[RELAY CMD] send delivered to phone ({to})"
                            : $"[RELAY CMD] send FAILED on phone link ({to}) — kept as Failed in DeskPhone for retry");
                    }
                    break;
                case "/refresh":
                    if (Refresh is null) { ok = false; error = "unavailable"; }
                    else await Refresh();
                    break;
                case "/mark-conversation-read":
                    var rPhone = ParseStr(qs, "phone");
                    if (string.IsNullOrWhiteSpace(rPhone) || MarkRead is null) { ok = false; error = "missing phone"; }
                    else await MarkRead(rPhone);
                    break;
                case "/mark-conversation-unread":
                    var uPhone = ParseStr(qs, "phone");
                    if (string.IsNullOrWhiteSpace(uPhone) || MarkUnread is null) { ok = false; error = "missing phone"; }
                    else await MarkUnread(uPhone);
                    break;
                case "/connect":
                    if (Connect is null) { ok = false; error = "unavailable"; }
                    else await Connect();
                    break;
                case "/show":
                    if (ShowApp is null) { ok = false; error = "unavailable"; }
                    else
                    {
                        ok = await ShowApp();
                        if (!ok) error = "DeskPhone window could not be raised";
                    }
                    break;
                default:
                    LogLine?.Invoke($"[RELAY CMD] unhandled: {path}");
                    ok = false; error = $"unknown command {path}";
                    break;
            }

            RecordCommandResult(commandId, path, ok, error);

            // Push the resulting state right away so the remote browser sees the
            // effect of its command (call state, sent text, read flag) AND the
            // acknowledgement within ~1 s instead of waiting for the next heartbeat.
            PushNow();
        }
        catch (Exception ex)
        {
            LogLine?.Invoke($"[RELAY CMD ERR] {ex.Message}");
            RecordCommandResult(commandId, path, ok: false, error: ex.Message);
            PushNow();
        }
    }

    private static string ParseStr(string qs, string key)
    {
        var m = System.Text.RegularExpressions.Regex.Match(qs, $@"(?:^|&){key}=([^&]*)");
        return m.Success ? Uri.UnescapeDataString(m.Groups[1].Value.Replace("+", " ")) : "";
    }

    // ── Host arbitration loop: read owner doc, decide, heartbeat ─────────────────
    private async Task ArbitrationLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try { await EvaluateShouldHoldAsync(ct); }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            catch (Exception ex) { LogLine?.Invoke($"[ARBITRATION] {ex.GetType().Name}: {ex.Message}"); }
            // A handoff in flight (fresh preference flip) polls fast so both hosts
            // converge in seconds — release on one side, connect on the other.
            var sincePreferred = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - Interlocked.Read(ref _lastPreferredAtMs);
            var delayMs = (sincePreferred >= 0 && sincePreferred < OwnerSwitchWindowMs) ? OwnerSwitchPollMs : OwnerHeartbeatMs;
            try { await Task.Delay(delayMs, ct); }
            catch (OperationCanceledException) { break; }
        }
    }

    /// <summary>
    /// Read phone-relay/owner, recompute whether this host should hold the phone,
    /// and — while holding — renew the heartbeat (host/t/connected). Also callable
    /// once at startup so the first auto-connect decision already knows whether the
    /// tablet is the live primary. When the relay isn't configured, arbitration is
    /// skipped and ShouldHoldPhone stays true (legacy behavior).
    /// </summary>
    public async Task EvaluateShouldHoldAsync(CancellationToken ct = default)
    {
        if (!IsEnabled) { _shouldHoldPhone = true; return; }

        var preferred = "tablet"; var ownerHost = ""; long ownerT = 0, preferredAt = 0; var ownerConnected = false;
        var presence = new Dictionary<string, (long T, bool Connected, double Quality)>();
        try
        {
            using var resp = await _http.GetAsync($"{FS_BASE}/phone-relay/owner?key={FB_API_KEY}", ct);
            if (resp.IsSuccessStatusCode)
            {
                var body = await resp.Content.ReadAsStringAsync(ct);
                using var doc = JsonDocument.Parse(body);
                if (doc.RootElement.TryGetProperty("fields", out var f))
                {
                    preferred      = ReadStr(f, "preferred", "tablet");
                    ownerHost      = ReadStr(f, "host", "");
                    ownerT         = ReadLong(f, "t", 0);
                    preferredAt    = ReadLong(f, "preferredAtMs", 0);
                    ownerConnected = ReadBool(f, "connected", false);
                    ReadPresenceMap(f, presence);
                }
            }
            // 404 = no owner doc yet ⇒ leave defaults ⇒ shouldHold stays true (legacy).
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { return; }

        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        // Presence beacon: EVERY host advertises hosts.{id} = { t, connected, quality }
        // each tick, parked or not — this is the auto-finder's input. Field-masked to
        // our own map entry, so hosts never clobber each other (or host/t/connected).
        await WritePresenceAsync(now, IsPhoneConnected?.Invoke() ?? false, ct);

        // preferred "pc" ⇒ the PC (this host) should hold; "tablet" ⇒ the Android host.
        // "auto" ⇒ the strongest live BT-capable link wins (chooseAutoHost — the same
        // scoring the web's phone-link.js publishes). "ipad" ⇒ the iPad fronts the
        // cloud feed, but it physically cannot hold Bluetooth Classic, so the
        // BT-holding decision also falls back to auto arbitration.
        var preferredId = preferred switch
        {
            "pc"     => "windows",
            "tablet" => "android",
            _        => ChooseAutoHost(presence, now, ownerHost) is { Length: > 0 } winner ? winner : "android",
        };
        var amPreferred    = preferredId == HostId;
        var preferredFresh = ownerHost == preferredId && (now - ownerT) < OwnerStaleMs && ownerConnected;

        bool shouldHold;
        if (amPreferred)         shouldHold = true;                                  // I'm the chosen host — always try
        else if (preferredFresh) shouldHold = false;                                // preferred host is alive & holding — stay parked
        else                     shouldHold = (now - preferredAt) >= OwnerTakeoverGraceMs; // brief yield after a switch, else take over so the phone isn't orphaned
        var wasHolding = _shouldHoldPhone;
        _shouldHoldPhone = shouldHold;
        Interlocked.Exchange(ref _lastPreferredAtMs, preferredAt);

        // Only the intended holder writes the heartbeat — a parked host writing
        // host=windows would clobber the tablet's ownership. While holding, renew.
        if (shouldHold)
        {
            await WriteOwnerHeartbeatAsync(now, IsPhoneConnected?.Invoke() ?? false, ct);

            // Acquire: we hold (or just won) the phone but aren't connected. During the
            // switch window this retries every fast tick — the first attempts usually
            // lose the race with the other host's release, and the phone needs a few
            // seconds to free the profiles. Connect() has its own in-flight/idle guards.
            var withinSwitchWindow = (now - preferredAt) >= 0 && (now - preferredAt) < OwnerSwitchWindowMs;
            if ((!wasHolding || withinSwitchWindow) && !(IsPhoneConnected?.Invoke() ?? false) && Connect is not null)
            {
                LogLine?.Invoke("[ARBITRATION] this host is now preferred — connecting to the phone");
                try { await Connect(); }
                catch (Exception ex) { LogLine?.Invoke($"[ARBITRATION] acquire connect failed: {ex.Message}"); }
            }
            return;
        }

        // Resign-then-acquire: the phone serves HFP/MAP to ONE host at a time, so a
        // handoff only completes if the losing host actively drops its BT link — the
        // winner cannot connect around a held link. Only a FRESH, explicit preference
        // flip triggers a release (a stale doc must never yank a working connection),
        // and MainViewModel declines while a call is live; we re-fire each tick until
        // the link is really down.
        var stillConnected = IsPhoneConnected?.Invoke() ?? false;
        if (stillConnected && (now - preferredAt) < OwnerSwitchWindowMs && ReleasePhone is not null)
        {
            LogLine?.Invoke("[ARBITRATION] preferred host changed — releasing the phone's Bluetooth link");
            try { await ReleasePhone(); }
            catch (Exception ex) { LogLine?.Invoke($"[ARBITRATION] release failed: {ex.Message}"); }

            // Farewell heartbeat: we were the recorded holder, so mark connected=false
            // once so web surfaces and the winner see the link drop within a tick.
            if (ownerHost == HostId && !(IsPhoneConnected?.Invoke() ?? false))
                await WriteOwnerHeartbeatAsync(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), false, ct);
        }
    }

    /// <summary>Fire a heartbeat immediately on a connect/disconnect edge so remote
    /// surfaces and the other host see the change within ~1 s, not after the stale
    /// window. No-op unless this host is the intended holder (never clobbers the peer).</summary>
    public void OnConnectionChanged()
    {
        if (!IsEnabled || !_shouldHoldPhone) return;
        _ = Task.Run(async () =>
        {
            try
            {
                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                await WriteOwnerHeartbeatAsync(now, IsPhoneConnected?.Invoke() ?? false, default);
            }
            catch (Exception ex) { LogLine?.Invoke($"[ARBITRATION] onchange {ex.Message}"); }
        });
    }

    /// <summary>
    /// Explicit takeover: write `preferred` to the owner doc — the same lever the
    /// web segmented control pulls, so every browser's Tablet|PC control shifts on
    /// its own and the losing host releases via the b330 resign-then-acquire flow.
    /// Field-masked: never touches host/t/connected. Optimistically flips
    /// ShouldHoldPhone and opens the fast-poll switch window so the local connect
    /// isn't gated while the doc round-trips.
    /// </summary>
    public async Task<bool> SetPreferredAsync(string preferred, CancellationToken ct = default)
    {
        if (!IsEnabled) return false;
        var value = preferred is "pc" or "tablet" or "ipad" or "auto" ? preferred : "tablet";
        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var fsBody = $"{{\"fields\":{{\"preferred\":{{\"stringValue\":\"{value}\"}},\"preferredAtMs\":{{\"integerValue\":\"{nowMs}\"}}}}}}";
        var url = $"{FS_BASE}/phone-relay/owner?key={FB_API_KEY}" +
                  "&updateMask.fieldPaths=preferred&updateMask.fieldPaths=preferredAtMs";
        using var content = new StringContent(fsBody, Encoding.UTF8, "application/json");
        using var req = new HttpRequestMessage(HttpMethod.Patch, url) { Content = content };
        using var resp = await _http.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode)
        {
            LogLine?.Invoke($"[ARBITRATION] set preferred={value} HTTP {(int)resp.StatusCode}");
            return false;
        }
        // 'ipad'/'auto' have no single BT target — leave shouldHold to the next
        // arbitration tick's auto scoring instead of guessing here.
        if (value is "pc" or "tablet")
            _shouldHoldPhone = (value == "pc" ? "windows" : "android") == HostId;
        Interlocked.Exchange(ref _lastPreferredAtMs, nowMs);
        LogLine?.Invoke($"[ARBITRATION] preferred host set to {value} (explicit takeover)");
        return true;
    }

    // ── Auto-finder (spec: apps/web/src/08-app-split/phone-link.js) ─────────────
    // Verbatim port of scoreHostLink/chooseAutoHost so every arbiter — web,
    // Windows, Android — ranks the lanes identically and auto mode cannot
    // oscillate. Only BT-capable hosts are candidates; the iPad never holds.
    private const long   PresenceLiveWindowMs = 60_000;
    private const double AutoSwitchMargin     = 25;
    private static readonly string[] BtCapableHosts = { "android", "windows" };

    private static double ScoreHostLink(string hostId, (long T, bool Connected, double Quality) e, long now)
    {
        if (e.T <= 0 || now - e.T >= PresenceLiveWindowMs) return 0;
        var quality = Math.Clamp(e.Quality, 0, 100);
        var staticPriority = hostId switch { "android" => 3, "windows" => 2, "ios" => 1, _ => 0 };
        return 10 + (e.Connected ? 100 : 0) + quality * 0.5 + staticPriority;
    }

    internal static string ChooseAutoHost(
        IReadOnlyDictionary<string, (long T, bool Connected, double Quality)> presence, long now, string currentHostId)
    {
        var bestId = ""; double bestScore = 0;
        foreach (var id in BtCapableHosts)
        {
            var score = presence.TryGetValue(id, out var e) ? ScoreHostLink(id, e, now) : 0;
            if (score > bestScore) { bestScore = score; bestId = id; }
        }
        if (bestId.Length == 0) return "";
        // Hysteresis: the current holder keeps the phone unless dead or beaten by a clear margin.
        if (currentHostId.Length > 0 && Array.IndexOf(BtCapableHosts, currentHostId) >= 0 &&
            presence.TryGetValue(currentHostId, out var cur))
        {
            var currentScore = ScoreHostLink(currentHostId, cur, now);
            if (currentScore > 0 && bestScore < currentScore + AutoSwitchMargin) return currentHostId;
        }
        return bestId;
    }

    private static void ReadPresenceMap(JsonElement fields, Dictionary<string, (long, bool, double)> into)
    {
        if (!fields.TryGetProperty("hosts", out var hostsField) ||
            !hostsField.TryGetProperty("mapValue", out var map) ||
            !map.TryGetProperty("fields", out var entries)) return;
        foreach (var entry in entries.EnumerateObject())
        {
            if (!entry.Value.TryGetProperty("mapValue", out var mv) ||
                !mv.TryGetProperty("fields", out var f)) continue;
            into[entry.Name] = (ReadLong(f, "t", 0), ReadBool(f, "connected", false), ReadLong(f, "quality", 0));
        }
    }

    // Link quality is self-reported 0–100. Windows' Bluetooth stack exposes no
    // RSSI for an HFP/MAP link, so the honest signal here is binary: a working
    // phone connection is a 100, anything else a 0. (Refine if a metric appears.)
    private async Task WritePresenceAsync(long nowMs, bool connected, CancellationToken ct)
    {
        var quality = connected ? 100 : 0;
        var fsBody = JsonSerializer.Serialize(new
        {
            fields = new
            {
                hosts = new
                {
                    mapValue = new
                    {
                        fields = new Dictionary<string, object>
                        {
                            [HostId] = new
                            {
                                mapValue = new
                                {
                                    fields = new
                                    {
                                        t         = new { integerValue = nowMs.ToString() },
                                        connected = new { booleanValue = connected },
                                        quality   = new { integerValue = quality.ToString() },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });
        var url = $"{FS_BASE}/phone-relay/owner?key={FB_API_KEY}" +
                  $"&updateMask.fieldPaths=hosts.{HostId}";
        using var content = new StringContent(fsBody, Encoding.UTF8, "application/json");
        using var req = new HttpRequestMessage(HttpMethod.Patch, url) { Content = content };
        try
        {
            using var resp = await _http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode)
                LogLine?.Invoke($"[ARBITRATION] presence write HTTP {(int)resp.StatusCode}");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
        catch (Exception ex) { LogLine?.Invoke($"[ARBITRATION] presence write failed: {ex.Message}"); }
    }

    private async Task WriteOwnerHeartbeatAsync(long nowMs, bool connected, CancellationToken ct)
    {
        var fsBody = $"{{\"fields\":{{\"host\":{{\"stringValue\":\"{HostId}\"}},\"t\":{{\"integerValue\":\"{nowMs}\"}},\"connected\":{{\"booleanValue\":{(connected ? "true" : "false")}}}}}}}";
        var url = $"{FS_BASE}/phone-relay/owner?key={FB_API_KEY}" +
                  "&updateMask.fieldPaths=host&updateMask.fieldPaths=t&updateMask.fieldPaths=connected";
        using var content = new StringContent(fsBody, Encoding.UTF8, "application/json");
        using var req = new HttpRequestMessage(HttpMethod.Patch, url) { Content = content };
        using var resp = await _http.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode)
            LogLine?.Invoke($"[ARBITRATION] owner heartbeat HTTP {(int)resp.StatusCode}");
    }

    // Tiny Firestore-REST field readers (values are typed: stringValue/integerValue/…).
    private static string ReadStr(JsonElement fields, string name, string dflt)
        => fields.TryGetProperty(name, out var e) && e.TryGetProperty("stringValue", out var v) ? (v.GetString() ?? dflt) : dflt;
    private static long ReadLong(JsonElement fields, string name, long dflt)
    {
        if (fields.TryGetProperty(name, out var e))
        {
            if (e.TryGetProperty("integerValue", out var iv) && long.TryParse(iv.GetString(), out var l)) return l;
            if (e.TryGetProperty("doubleValue", out var dv) && dv.TryGetDouble(out var d)) return (long)d;
        }
        return dflt;
    }
    private static bool ReadBool(JsonElement fields, string name, bool dflt)
        => fields.TryGetProperty(name, out var e) && e.TryGetProperty("booleanValue", out var v) ? v.GetBoolean() : dflt;

    public void Dispose()
    {
        Stop();
        _http.Dispose();
        _streamHttp.Dispose();
        _pushGate.Dispose();
    }
}
