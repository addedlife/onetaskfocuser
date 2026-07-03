using System.Collections.Concurrent;
using System.IO;
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
    public Func<string, string, Task<bool>>?       Send        { get; set; }
    public Func<Task>?                             Refresh     { get; set; }
    public Func<string, Task>?                     MarkRead    { get; set; }
    public Func<string, Task>?                     MarkUnread  { get; set; }
    public Func<Task>?                             Connect     { get; set; }
    public Func<Task<bool>>?                       ShowApp     { get; set; }
    public Action<string>?                         LogLine     { get; set; }
    public Func<string>?                           GetLanUrl   { get; set; }
    // Returns (mediaId, dataUrl) for resized picture-text previews to upload out-of-band.
    public Func<List<(string id, string dataUrl)>>? GetRelayMedia { get; set; }

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
        _ = Task.Run(() => DrainCommandsLoopAsync(_cts.Token));
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
        }
        finally { _pushGate.Release(); }
    }

    // ── Command drain: cloud mailbox → host ─────────────────────────────────────
    // NOT a streaming listener. Firestore's REST documents:listen endpoint cannot
    // hold a live stream: the server treats the transcoded bidi call as complete
    // the instant the request body ends and answers "[]" (verified 2026-07-02 with
    // curl — array-wrapped body + database param gets HTTP 200 and an immediate
    // close, no events, ever). b322 shipped with that listener, so NO relayed
    // command was ever delivered; every remote send/dial/reconnect expired unseen.
    //
    // Adaptive poll instead: 2 s while commands are flowing (someone is actively
    // driving the phone from a browser), 6 s idle. Idle cost ≈ 14k reads/day ≈
    // $0.25/month on Blaze — the price of the feature actually working.
    private const int DrainIdleMs   = 6_000;
    private const int DrainActiveMs = 2_000;
    private static readonly TimeSpan DrainActiveWindow = TimeSpan.FromMinutes(3);
    private DateTime _lastCommandSeenUtc = DateTime.MinValue;

    private async Task DrainCommandsLoopAsync(CancellationToken ct)
    {
        var url = $"{FS_BASE}/phone-relay/commands?key={FB_API_KEY}";
        var loggedFirstPoll = false;
        var consecutiveErrors = 0;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var resp = await _http.GetAsync(url, ct);
                if (resp.IsSuccessStatusCode)
                {
                    if (!loggedFirstPoll)
                    {
                        loggedFirstPoll = true;
                        LogLine?.Invoke("[RELAY DRAIN] command mailbox reachable — remote commands will run");
                    }
                    consecutiveErrors = 0;
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
                            // Clear BEFORE dispatch so a slow command (e.g. a send over a
                            // reconnecting link) can't be re-read and re-executed by the
                            // next poll round. Commands already parsed live in memory.
                            await ClearCommandsAsync();
                            DispatchCommandsFromString(commandsJson);
                        }
                    }
                }
                else if ((int)resp.StatusCode != 404)   // 404 = mailbox doc not created yet
                {
                    consecutiveErrors++;
                    if (consecutiveErrors <= 3)
                        LogLine?.Invoke($"[RELAY DRAIN] HTTP {(int)resp.StatusCode}");
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                consecutiveErrors++;
                if (consecutiveErrors <= 3)
                    LogLine?.Invoke($"[RELAY DRAIN] {ex.GetType().Name}: {ex.Message}");
            }

            var interval = DateTime.UtcNow - _lastCommandSeenUtc < DrainActiveWindow
                ? DrainActiveMs
                : DrainIdleMs;
            try { await Task.Delay(interval, ct); }
            catch (OperationCanceledException) { break; }
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

    public void Dispose()
    {
        Stop();
        _http.Dispose();
        _pushGate.Dispose();
    }
}
