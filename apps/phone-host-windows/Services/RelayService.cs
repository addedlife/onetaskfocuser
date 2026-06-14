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
    private readonly HttpClient     _streamHttp = new() { Timeout = Timeout.InfiniteTimeSpan }; // for the Firestore streaming listen connection
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
        "/dial" or "/answer" or "/hangup" or "/toggle-mute" => TimeSpan.FromSeconds(45),
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
        _ = Task.Run(() => ListenCommandsAsync(_cts.Token));
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

    // ── Firestore streaming listener: commands → host ──────────────────────────
    // Keeps a long-lived HTTP connection to Firestore's Listen API.
    // When a browser writes a command to phone-relay/commands, Firestore pushes the
    // documentChange event here within milliseconds — zero polling, zero idle reads.
    private async Task ListenCommandsAsync(CancellationToken ct)
    {
        var listenUrl = $"https://firestore.googleapis.com/v1/projects/{FB_PROJECT}/databases/(default)/documents:listen?key={FB_API_KEY}";
        var docPath   = $"projects/{FB_PROJECT}/databases/(default)/documents/phone-relay/commands";
        var addTarget = $"{{\"addTarget\":{{\"documents\":{{\"documents\":[\"{docPath}\"]}},\"targetId\":1}}}}";

        int attempt = 0;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Post, listenUrl)
                {
                    Content = new StringContent(addTarget, Encoding.UTF8, "application/json")
                };
                using var resp = await _streamHttp.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);

                if (!resp.IsSuccessStatusCode)
                {
                    LogLine?.Invoke($"[RELAY LISTEN] HTTP {(int)resp.StatusCode}");
                    attempt = await BackoffAsync(attempt, ct);
                    continue;
                }

                attempt = 0;
                LogLine?.Invoke("[RELAY LISTEN] command listener connected");

                await using var stream = await resp.Content.ReadAsStreamAsync(ct);
                using var reader = new StreamReader(stream);

                while (!ct.IsCancellationRequested)
                {
                    var line = await reader.ReadLineAsync(ct);
                    if (line == null) break; // stream closed

                    // Firestore streams as a JSON array: "[", then "{...}", then ",{...}" — never closes "]".
                    var trimmed = line.TrimStart(' ', ',', '[').Trim();
                    if (trimmed.Length < 2 || trimmed[0] != '{') continue;

                    try
                    {
                        using var evt = JsonDocument.Parse(trimmed);
                        OnListenEvent(evt.RootElement);
                    }
                    catch { /* malformed chunk — skip */ }
                }

                if (!ct.IsCancellationRequested)
                    LogLine?.Invoke("[RELAY LISTEN] stream ended — reconnecting");
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                LogLine?.Invoke($"[RELAY LISTEN] {ex.GetType().Name}: {ex.Message}");
            }

            attempt = await BackoffAsync(attempt, ct);
        }
    }

    private void OnListenEvent(JsonElement root)
    {
        if (!root.TryGetProperty("documentChange", out var docChange)) return;
        if (!docChange.TryGetProperty("document", out var document)) return;
        if (!document.TryGetProperty("fields", out var fields)) return;
        if (!fields.TryGetProperty("data", out var data)) return;
        if (!data.TryGetProperty("stringValue", out var sv)) return;

        var commandsJson = sv.GetString() ?? "[]";
        if (commandsJson.Length <= 2) return; // empty array "[]"

        DispatchCommandsFromString(commandsJson);
        _ = ClearCommandsAsync();
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

    private static async Task<int> BackoffAsync(int attempt, CancellationToken ct)
    {
        var delay = Math.Min(30_000, 1_000 << Math.Min(attempt, 5));
        try { await Task.Delay(delay, ct); }
        catch (OperationCanceledException) { }
        return Math.Min(attempt + 1, 5);
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
        _streamHttp.Dispose();
        _pushGate.Dispose();
    }
}
