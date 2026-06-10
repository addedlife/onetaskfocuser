using System.Collections.Concurrent;
using System.Net.Http;
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
    private const string DefaultRelayUrl = "https://onetaskfocuser.netlify.app/.netlify/functions/phone-relay";
    private const int PushIntervalMs     = 5_000;   // background heartbeat push every 5 s
    private const int DrainIntervalMs    = 2_000;   // poll for commands every 2 s
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
    public Func<string, string, Task<bool>>?       Send        { get; set; }
    public Func<Task>?                             Refresh     { get; set; }
    public Func<string, Task>?                     MarkRead    { get; set; }
    public Func<string, Task>?                     MarkUnread  { get; set; }
    public Action<string>?                         LogLine     { get; set; }
    public Func<string>?                           GetLanUrl   { get; set; }
    // Returns (mediaId, dataUrl) for resized picture-text previews to upload out-of-band.
    public Func<List<(string id, string dataUrl)>>? GetRelayMedia { get; set; }

    // ── Config ────────────────────────────────────────────────────────────────
    private string _relayUrl = DefaultRelayUrl;
    private string _relayKey = "";
    public  bool   IsEnabled => !string.IsNullOrWhiteSpace(_relayKey);

    // ── State ─────────────────────────────────────────────────────────────────
    private CancellationTokenSource _cts      = new();
    private readonly HttpClient     _http     = new() { Timeout = TimeSpan.FromMilliseconds(HttpTimeoutMs) };
    private DateTime                _lastPush = DateTime.MinValue;
    private int                     _pushErrors;
    private int                     _drainErrors;

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
        "/dial" or "/answer" or "/hangup" or "/toggle-mute" => TimeSpan.FromSeconds(45),
        _ => TimeSpan.FromMinutes(10),
    };

    public void Configure(string relayKey, string? relayUrl)
    {
        _relayKey = relayKey?.Trim() ?? "";
        if (!string.IsNullOrWhiteSpace(relayUrl))
            _relayUrl = relayUrl.TrimEnd('/');
    }

    public void Start()
    {
        if (!IsEnabled) return;
        _cts = new CancellationTokenSource();
        _ = Task.Run(() => PushLoopAsync(_cts.Token));
        _ = Task.Run(() => DrainLoopAsync(_cts.Token));
        LogLine?.Invoke($"[RELAY] Started — pushing to {_relayUrl}");
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

        // Serialize every push (heartbeat loop + PushNow) so two writes never race
        // the same Firestore doc. The gate is released in finally.
        await _pushGate.WaitAsync();
        try
        {
            // Upload any new picture-text images first, so the state blob's mediaId
            // references resolve the moment a phone reads it.
            await UploadPendingMediaAsync();

            // Build state blob: status + recent messages + calls + contacts
            var statusJson   = GetStatus();
            var messagesJson = GetMessages?.Invoke(MessageRelayLimit, false) ?? "[]";
            var callsJson    = GetCalls?.Invoke() ?? "[]";
            var contactsJson = GetContacts?.Invoke() ?? "[]";

            // Inline-assemble the outer object without deserializing everything —
            // these are already valid JSON strings, just stitch them together.
            var lanUrl      = GetLanUrl?.Invoke() ?? "";
            var resultsJson = "[" + string.Join(",", _commandResults) + "]";
            var stateJson = $"{{\"status\":{statusJson},\"messages\":{messagesJson},\"calls\":{callsJson},\"contacts\":{contactsJson},\"commandResults\":{resultsJson},\"lanUrl\":\"{lanUrl}\",\"pushedAt\":{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}}}";

            using var content = new StringContent(stateJson, Encoding.UTF8, "application/json");
            using var req     = new HttpRequestMessage(HttpMethod.Post, $"{_relayUrl}?action=push") { Content = content };
            req.Headers.Add("X-Relay-Secret", _relayKey);
            using var resp = await _http.SendAsync(req);
            if (!resp.IsSuccessStatusCode)
            {
                var body = await resp.Content.ReadAsStringAsync();
                throw new Exception($"HTTP {(int)resp.StatusCode} — {body[..Math.Min(200, body.Length)]}");
            }
            _lastPush = DateTime.UtcNow;
        }
        finally { _pushGate.Release(); }
    }

    // Upload resized picture-text previews to phone-media/{id}, once each. Runs inside
    // the push gate so _uploadedMedia is touched single-threaded. A failed upload is
    // simply retried on the next push (the id isn't marked done).
    private async Task UploadPendingMediaAsync()
    {
        var media = GetRelayMedia?.Invoke();
        if (media is null || media.Count == 0) return;

        foreach (var (id, dataUrl) in media)
        {
            if (_uploadedMedia.Contains(id)) continue;
            try
            {
                // id is hex and dataUrl is a base64 data: URL — no JSON-special chars.
                var body = $"{{\"id\":\"{id}\",\"dataUrl\":\"{dataUrl}\"}}";
                using var content = new StringContent(body, Encoding.UTF8, "application/json");
                using var req = new HttpRequestMessage(HttpMethod.Post, $"{_relayUrl}?action=push-media") { Content = content };
                req.Headers.Add("X-Relay-Secret", _relayKey);
                using var resp = await _http.SendAsync(req);
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

    // ── Drain loop: cloud commands → execute on DeskPhone ────────────────────
    private async Task DrainLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(DrainIntervalMs, ct);
                await DrainCommandsAsync();
                _drainErrors = 0;
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                _drainErrors++;
                if (_drainErrors <= 3)
                    LogLine?.Invoke($"[RELAY DRAIN] {ex.GetType().Name}: {ex.Message}");
            }
        }
    }

    private async Task DrainCommandsAsync()
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, $"{_relayUrl}?action=drain");
        req.Headers.Add("X-Relay-Secret", _relayKey);
        using var resp = await _http.SendAsync(req);
        if (!resp.IsSuccessStatusCode) return;

        var json = await resp.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.ValueKind != JsonValueKind.Array) return;

        foreach (var cmdEl in doc.RootElement.EnumerateArray())
        {
            var path = cmdEl.GetProperty("path").GetString() ?? "";
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

            var ageMs = queuedAtMs > 0
                ? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - queuedAtMs
                : 0;
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
                    if (string.IsNullOrWhiteSpace(to) || string.IsNullOrWhiteSpace(body) || Send is null)
                    {
                        ok = false; error = "missing recipient or message body";
                    }
                    else
                    {
                        ok = await Send(to, body);
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

    public void Dispose()
    {
        Stop();
        _http.Dispose();
        _pushGate.Dispose();
    }
}
