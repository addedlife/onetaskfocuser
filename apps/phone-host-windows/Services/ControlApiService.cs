using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using DeskPhone.Models;

namespace DeskPhone.Services;

/// <summary>
/// DeskPhone Windows host control API on http://localhost:8765/
/// Built on TcpListener (raw socket) so it works without Windows URL-ACL
/// registration and without admin rights.
///
/// Endpoints:
///   GET  /status          → JSON: host, connection, call state, message count
///   POST /connect         → auto-connect to saved device
///   POST /answer          → answer ringing call
///   POST /hangup          → hang up
///   POST /toggle-mute     → toggle active call mute
///   POST /dial?n=NUMBER   → dial a number
///   POST /send?to=X&body=Y → send SMS via MAP
///   POST /send-with-attachments → send SMS/MMS JSON payload via MAP
///   POST /toggle-message-pin?id=ID → pin or unpin a message in the local store
///   POST /show               → bring window to front
///   POST /hide               → minimize window to taskbar
///   POST /toggle-main-window → show or hide the native WPF MainWindow (default hidden)
///   POST /accept-build-update /snooze-build-update /show-build-update-prompt
///   POST /refresh         → force inbox refresh
///   POST /handoff?target=X → open DeskPhone to a native UI target for temporary web shortcuts
///   POST /test-reg?v=N    → test notification variant N
///   GET  /log?n=N         → last N lines of deskphone.log (default 100)
///   GET  /messages        → recent message list as JSON
///   GET  /calls           → recent call history as JSON
///   GET  /contacts        → saved contacts as JSON
/// </summary>
public class ControlApiService : IDisposable
{
    private const int Port = 8765;
    private const int MaxJsonBodyChars = 12 * 1024 * 1024;
    private TcpListener? _server;
    private CancellationTokenSource _cts = new();

    /// <summary>Google-account pairing gate for LAN callers (loopback is exempt —
    /// the embedded web shell is served from 127.0.0.1). See HostAuthService.</summary>
    public HostAuthService Auth { get; }

    public ControlApiService()
    {
        Auth = new HostAuthService(s => LogLine?.Invoke(s));
    }

    /// <summary>Live call-audio bridge: captures a chosen Windows input device and
    /// streams 16 kHz mono PCM to browser subscribers. See CallAudioBridgeService.</summary>
    public readonly CallAudioBridgeService CallAudio = new();

    // ── Callbacks wired up by the ViewModel ───────────────────────────────
    public Func<string>?                     GetStatus   { get; set; }
    public Func<int, bool, string>?          GetMessages { get; set; }
    public Func<string>?                     GetCalls    { get; set; }
    public Func<string>?                     GetContacts { get; set; }
    public Func<Task>?                       Connect     { get; set; }
    public Func<Task>?                       Answer      { get; set; }
    public Func<Task>?                       HangUp      { get; set; }
    public Func<string, Task>?               Dial        { get; set; }
    // Send delegates carry an optional client message id (`cid`) minted by the
    // web composer's echo bubble; DeskPhone stamps it as the new message's
    // LocalId so the state blob returns it verbatim and the web echo
    // reconciles EXACTLY instead of by recipient+body+time heuristics.
    public Func<string, string, string?, Task<bool>>? Send { get; set; }
    public Func<string, string, IReadOnlyList<MessageAttachment>, string?, Task<bool>>? SendWithAttachments { get; set; }
    public Func<Task>?                       Refresh     { get; set; }
    public Func<Task>?                       RefreshAudio { get; set; }
    public Func<Task>?                       OpenBluetoothSettings { get; set; }
    public Func<Task>?                       OpenSoundSettings { get; set; }
    public Func<Task>?                       OpenBuildsFolder { get; set; }
    public Func<Task>?                       OpenEventLog { get; set; }
    public Func<Task>?                       OpenContactSyncFolder { get; set; }
    public Func<Task>?                       ExportMessagesBackup { get; set; }
    public Func<Task>?                       ResetUiScale { get; set; }
    public Func<Task>?                       RefreshThemeSync { get; set; }
    public Func<Task>?                       ImportStarterVcf { get; set; }
    public Func<Task>?                       ImportPendingContacts { get; set; }
    public Func<Task>?                       SkipPendingContacts { get; set; }
    public Func<bool, Task>?                 SetSyncThemeWithShamash { get; set; }
    public Func<bool, Task>?                 SetPauseHistoryActivity { get; set; }
    public Func<bool, Task>?                 SetDarkModeEnabled { get; set; }
    public Func<Task>?                       OpenLiveLog { get; set; }
    public Func<Task>?                       OpenWebUi { get; set; }
    public Func<Task>?                       OpenAudioConsole { get; set; }
    public Func<Task>?                       ClearLog { get; set; }
    public Func<Task>?                       RunUiAuditor { get; set; }
    public Func<Task>?                       ToggleMute { get; set; }
    public Func<Task>?                       AcceptBuildUpdate { get; set; }
    public Func<Task>?                       SnoozeBuildUpdate { get; set; }
    public Func<Task>?                       ShowBuildUpdatePrompt { get; set; }
    public Func<string, Task>?               ToggleMessagePin { get; set; }
    public Func<string, Task>?               DeleteMessage { get; set; }
    public Func<Task>?                       UndoMessageDelete { get; set; }
    public Func<Task>?                       ScanDevices { get; set; }
    public Func<string, Task>?               ConnectSavedDevice { get; set; }
    public Func<string, Task>?               SetDefaultSavedDevice { get; set; }
    public Func<string, Task>?               ForgetSavedDevice { get; set; }
    public Func<string, Task>?               ConnectScannedDevice { get; set; }
    public Func<string, string, string, Task>? SaveContact { get; set; }
    public Func<string, string, Task>?       DeleteContact { get; set; }
    public Func<string, Task>?               MarkConversationRead { get; set; }
    public Func<string, Task>?               MarkConversationUnread { get; set; }
    public Func<string, Task>?               ToggleConversationPin { get; set; }
    public Func<string, Task>?               ToggleConversationMute { get; set; }
    public Func<string, Task>?               ToggleConversationBlock { get; set; }
    public Func<string, Task>?               ToggleCallBlock { get; set; }
    public Func<string, Task>?               DeleteCallEntry { get; set; }
    public Func<Task>?                       DeleteAllCallHistory { get; set; }
    public Func<Task>?                       UndoCallHistoryDelete { get; set; }
    public Func<int, Task<bool>>?            TestReg     { get; set; }
    public Action?                           Shutdown    { get; set; }
    public Action<string>?                   LogLine     { get; set; }
    public Func<string>?                     GetRelayStatus { get; set; }
    public Func<string, string, Task<bool>>? OfferBuildUpdate { get; set; }
    public Func<Task<bool>>?                 ShowApp     { get; set; }
    public Func<Task<bool>>?                 HideApp     { get; set; }
    public Func<Task<bool>>?                 ToggleMainWindow { get; set; }
    public Func<string, string, Task<bool>>? Handoff     { get; set; }
    public Func<double, double, double, double, bool, string, Task<bool>>? SetStageBounds { get; set; }
    public Func<string, Task<bool>>?         PulseStage  { get; set; }
    public Func<string, bool, Task<bool>>?   ExitStage   { get; set; }
    public Func<string, IReadOnlyDictionary<string, string>, Task<bool>>? ApplyTheme { get; set; }

    // ── Startup result reported back to the ViewModel for logging ─────────
    public string StartupResult { get; private set; } = "";

    // ── LAN URL (populated after Start) ──────────────────────────────────
    public string? LanUrl { get; private set; }

    public void Start()
    {
        try
        {
            _cts = new CancellationTokenSource();
            CallAudio.Log = s => LogLine?.Invoke(s);
            _server = new TcpListener(IPAddress.Any, Port);
            _server.Start();
            LanUrl = GetLanUrl();
            _ = Task.Run(() => AcceptLoopAsync(_cts.Token));
            var lanNote = LanUrl is not null ? $" | LAN: {LanUrl}/" : "";
            StartupResult = $"OK — listening on http://localhost:{Port}/{lanNote}";
        }
        catch (Exception ex)
        {
            StartupResult = $"FAILED — {ex.GetType().Name}: {ex.Message}";
        }
    }

    private static string? GetLanUrl()
    {
        try
        {
            var host = System.Net.Dns.GetHostName();
            var addresses = System.Net.Dns.GetHostAddresses(host);
            var lan = addresses.FirstOrDefault(a =>
                a.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork &&
                !IPAddress.IsLoopback(a));
            return lan is not null ? $"http://{lan}:{Port}" : null;
        }
        catch { return null; }
    }

    public void Stop()
    {
        _cts.Cancel();
        try { _server?.Stop(); } catch { }
        try { CallAudio.Dispose(); } catch { }
    }

    // ── LAN-host proxy plumbing ───────────────────────────────────────────
    private static readonly HttpClient _forwardHttp = new() { Timeout = TimeSpan.FromSeconds(10) };

    /// <summary>Accepts only http://<private-LAN-IP>:port targets — the proxy must
    /// never be steerable at loopback (loop), public internet (SSRF), or HTTPS.</summary>
    private static bool TryParseForwardTarget(string raw, out Uri baseUri)
    {
        baseUri = null!;
        if (!Uri.TryCreate(raw?.Trim(), UriKind.Absolute, out var uri)) return false;
        if (uri.Scheme != "http") return false;
        if (!IPAddress.TryParse(uri.Host, out var ip)) return false;
        if (IPAddress.IsLoopback(ip)) return false;
        var b = ip.GetAddressBytes();
        var isPrivate = b.Length == 4 && (
            b[0] == 10 ||
            (b[0] == 172 && b[1] >= 16 && b[1] <= 31) ||
            (b[0] == 192 && b[1] == 168) ||
            (b[0] == 169 && b[1] == 254));
        if (!isPrivate) return false;
        baseUri = uri;
        return true;
    }

    private async Task<(int status, string body)> ForwardToLanHostAsync(
        Uri baseUri, string method, string rawPath, string requestBody, Dictionary<string, string> headers)
    {
        try
        {
            using var req = new HttpRequestMessage(new HttpMethod(method), new Uri(baseUri, rawPath));
            // Pass the pairing credentials through verbatim; everything else
            // (including X-Forward-Host itself) stays behind.
            if (headers.TryGetValue("Authorization", out var auth))
                req.Headers.TryAddWithoutValidation("Authorization", auth);
            if (headers.TryGetValue("X-Host-Token", out var hostToken))
                req.Headers.TryAddWithoutValidation("X-Host-Token", hostToken);
            if (!string.IsNullOrEmpty(requestBody) && method is "POST" or "PUT")
                req.Content = new StringContent(requestBody, Encoding.UTF8, "application/json");
            using var res = await _forwardHttp.SendAsync(req);
            var body = await res.Content.ReadAsStringAsync();
            return ((int)res.StatusCode, body);
        }
        catch (Exception ex)
        {
            LogLine?.Invoke($"[API] LAN proxy to {baseUri} failed: {ex.GetType().Name}: {ex.Message}");
            return (502, JsonError($"LAN host {baseUri.Host} unreachable from this PC"));
        }
    }

    // ── Accept loop ───────────────────────────────────────────────────────
    private async Task AcceptLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var client = await _server!.AcceptTcpClientAsync(ct);
                _ = Task.Run(() => HandleClientAsync(client), ct);
            }
            catch (OperationCanceledException) { break; }
            catch { /* port closed or transient — keep listening */ }
        }
    }

    // ── Per-request handler ───────────────────────────────────────────────
    private async Task HandleClientAsync(TcpClient client)
    {
        using var _ = client;
        try
        {
            using var stream = client.GetStream();
            using var reader = new StreamReader(stream, Encoding.UTF8, leaveOpen: true);

            // Read the HTTP request line (e.g. "GET /status HTTP/1.1")
            var requestLine = await reader.ReadLineAsync() ?? "";
            var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            string? hdr;
            while (!string.IsNullOrEmpty(hdr = await reader.ReadLineAsync()))
            {
                var colon = hdr.IndexOf(':');
                if (colon > 0)
                    headers[hdr[..colon].Trim()] = hdr[(colon + 1)..].Trim();
            }

            var parts  = requestLine.Split(' ');
            if (parts.Length < 2) return;
            var method  = parts[0].ToUpperInvariant();
            var rawPath = parts[1];                               // e.g. /status?n=50
            var qmark   = rawPath.IndexOf('?');
            var path    = (qmark < 0 ? rawPath : rawPath[..qmark]).ToLowerInvariant();
            var qs      = qmark < 0 ? "" : rawPath[(qmark + 1)..];
            var requestBody = await ReadRequestBodyAsync(reader, headers);

            if (method == "OPTIONS")
            {
                await WriteHttpResponseAsync(stream, "", 204);
                return;
            }

            // ── Auth gate (before everything else). Loopback is exempt: the
            //    embedded web shell and the same-PC browser ride 127.0.0.1.
            //    LAN callers need X-Host-Token once an owner has paired;
            //    /pair swaps a Firebase ID token for one; /health stays open. ──
            var remoteIsLoopback =
                client.Client.RemoteEndPoint is System.Net.IPEndPoint ep && IPAddress.IsLoopback(ep.Address);

            // ── LAN-host proxy (before /pair so pairing THROUGH the proxy reaches
            //    the target host, not this PC's own pairing handler) ────────────
            //    A browser page served over HTTPS cannot fetch http://192.168.x.x
            //    (mixed-content blocking — loopback is the sole exemption), so the
            //    web app sends the request HERE with X-Forward-Host naming the LAN
            //    host that actually holds the phone (e.g. the Android tablet), and
            //    we relay it. Loopback callers only, private-network targets only,
            //    and the header is never propagated onward — no loops, no SSRF.
            //    Auth rides through untouched: the target host still enforces its
            //    own Google-account pairing on the forwarded X-Host-Token.
            if (remoteIsLoopback &&
                headers.TryGetValue("X-Forward-Host", out var forwardHost) &&
                TryParseForwardTarget(forwardHost, out var forwardBase))
            {
                var (fwdStatus, fwdBody) = await ForwardToLanHostAsync(forwardBase, method, rawPath, requestBody, headers);
                await WriteHttpResponseAsync(stream, fwdBody, fwdStatus);
                return;
            }

            if (method == "POST" && path == "/pair")
            {
                var bearer = headers.TryGetValue("Authorization", out var authHdr) &&
                             authHdr.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
                    ? authHdr[7..].Trim() : ParseStr(qs, "idToken");
                var (pairStatus, pairBody) = Auth.Pair(bearer);
                await WriteHttpResponseAsync(stream, pairBody, pairStatus);
                return;
            }
            if (!remoteIsLoopback && Auth.IsEnforced && path != "/health" &&
                !Auth.IsValidHostToken(headers.TryGetValue("X-Host-Token", out var ht) ? ht : null))
            {
                await WriteHttpResponseAsync(stream,
                    JsonError("unauthorized — sign into Shamash with the owner's Google account to pair"), 401);
                return;
            }

            // ── Live call-audio bridge (handled before the JSON chain because the
            //    PCM stream writes its own long-lived response and the listener
            //    page returns HTML) ─────────────────────────────────────────────
            if (path == "/call-audio.pcm")
            {
                await StreamCallAudioAsync(stream, qs);
                return;
            }
            if (path == "/call-audio.ws")
            {
                await HandleCallAudioWebSocketAsync(stream, headers, qs);
                return;
            }
            if (path == "/audio-bridge")
            {
                await WriteHtmlResponseAsync(stream, BuildAudioBridgePage());
                return;
            }

            string body;
            int statusCode = 200;

            if (path is "" or "/status")
            {
                body = GetStatus?.Invoke() ?? Json("status", "unknown");
            }
            else if (path == "/log")
            {
                var n = ParseInt(qs, "n", 100);
                var logPath = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "DeskPhone", "deskphone.log");
                body = ReadLastLines(logPath, n);
            }
            else if (path == "/messages")
            {
                var limit = Math.Clamp(ParseInt(qs, "limit", 1200), 50, 5000);
                var includeAttachmentData = ParseInt(qs, "includeAttachmentData", 0) != 0;
                body = GetMessages?.Invoke(limit, includeAttachmentData) ?? "[]";
            }
            else if (path == "/calls")
            {
                body = GetCalls?.Invoke() ?? "[]";
            }
            else if (path == "/contacts")
            {
                body = GetContacts?.Invoke() ?? "[]";
            }
            else if (path == "/audio-inputs")
            {
                body = AudioInputsJson();
            }
            else if (path == "/audio-outputs")
            {
                body = JsonSerializer.Serialize(new
                {
                    devices = CallAudio.ListOutputs()
                        .Select(d => new { id = d.Id, name = d.Name, isDefault = d.IsDefault })
                });
            }
            else if (path == "/call-audio/state")
            {
                body = CallAudioStateJson();
            }
            else if (method == "POST" && path == "/call-audio/config")
            {
                var cfg = CallAudio.Settings;
                void Apply(string key, Action<string> set) { var v = ParseStr(qs, key); if (qs.Contains(key + "=")) set(v); }
                Apply("carkitIn",  v => cfg.CarkitInputId  = v);
                Apply("carkitOut", v => cfg.CarkitOutputId = v);
                Apply("deskOut",   v => cfg.DeskOutputId   = v);
                Apply("deskMic",   v => cfg.DeskMicId      = v);
                if (qs.Contains("autoEngage=")) cfg.AutoEngageDeskMode = ParseInt(qs, "autoEngage", 0) != 0;
                CallAudio.SaveConfig();
                LogLine?.Invoke("[call-audio] config updated");
                body = CallAudioStateJson();
            }
            else if (method == "POST" && path == "/desk-mode/start")
            {
                var summary = CallAudio.EngageDeskMode();
                body = JsonSerializer.Serialize(new { engaged = CallAudio.DeskModeEngaged, summary });
            }
            else if (method == "POST" && path == "/desk-mode/stop")
            {
                CallAudio.ReleaseDeskMode();
                body = JsonSerializer.Serialize(new { engaged = CallAudio.DeskModeEngaged });
            }
            else if (method == "POST" && path == "/call-audio/uplink-start")
            {
                var deviceId = ParseStr(qs, "device");
                try
                {
                    CallAudio.StartUplink(string.IsNullOrWhiteSpace(deviceId) ? null : deviceId);
                    body = CallAudioStateJson();
                }
                catch (Exception ex) { statusCode = 500; body = JsonError($"uplink start failed: {ex.Message}"); }
            }
            else if (method == "POST" && path == "/call-audio/uplink-stop")
            {
                CallAudio.StopUplink();
                body = CallAudioStateJson();
            }
            else if (method == "POST" && path == "/call-audio/start")
            {
                var deviceId = ParseStr(qs, "device");
                try
                {
                    CallAudio.Start(string.IsNullOrWhiteSpace(deviceId) ? null : deviceId);
                    body = AudioInputsJson();
                }
                catch (Exception ex) { statusCode = 500; body = JsonError($"start failed: {ex.Message}"); }
            }
            else if (method == "POST" && path == "/call-audio/stop")
            {
                CallAudio.Stop();
                body = AudioInputsJson();
            }
            else if (method == "POST" && path == "/connect")
            {
                if (Connect is not null) await Connect();
                body = Json("result", "connect triggered");
            }
            else if (method == "POST" && path == "/answer")
            {
                if (Answer is not null) await Answer();
                body = Json("result", "answer triggered");
            }
            else if (method == "POST" && path == "/hangup")
            {
                if (HangUp is not null) await HangUp();
                body = Json("result", "hangup triggered");
            }
            else if (method == "POST" && path == "/refresh")
            {
                if (Refresh is not null) await Refresh();
                body = Json("result", "refresh triggered");
            }
            else if (method == "POST" && path == "/audio-refresh")
            {
                if (RefreshAudio is not null) await RefreshAudio();
                body = Json("result", "audio refresh triggered");
            }
            else if (method == "POST" && path == "/open-bluetooth-settings")
            {
                if (OpenBluetoothSettings is not null) await OpenBluetoothSettings();
                body = Json("result", "bluetooth settings opened");
            }
            else if (method == "POST" && path == "/open-sound-settings")
            {
                if (OpenSoundSettings is not null) await OpenSoundSettings();
                body = Json("result", "sound settings opened");
            }
            else if (method == "POST" && path == "/open-builds-folder")
            {
                if (OpenBuildsFolder is not null) await OpenBuildsFolder();
                body = Json("result", "builds folder opened");
            }
            else if (method == "POST" && path == "/open-event-log")
            {
                if (OpenEventLog is not null) await OpenEventLog();
                body = Json("result", "event log opened");
            }
            else if (method == "POST" && path == "/open-contact-sync-folder")
            {
                if (OpenContactSyncFolder is not null) await OpenContactSyncFolder();
                body = Json("result", "contact sync folder opened");
            }
            else if (method == "POST" && path == "/export-messages-backup")
            {
                if (ExportMessagesBackup is not null) await ExportMessagesBackup();
                body = Json("result", "messages backup export opened");
            }
            else if (method == "POST" && path == "/reset-ui-scale")
            {
                if (ResetUiScale is not null) await ResetUiScale();
                body = Json("result", "ui scale reset");
            }
            else if (method == "POST" && path == "/refresh-theme-sync")
            {
                if (RefreshThemeSync is not null) await RefreshThemeSync();
                body = Json("result", "theme sync refresh triggered");
            }
            else if (method == "POST" && path == "/import-starter-vcf")
            {
                if (ImportStarterVcf is not null) await ImportStarterVcf();
                body = Json("result", "starter vcf import opened");
            }
            else if (method == "POST" && path == "/import-pending-contacts")
            {
                if (ImportPendingContacts is not null) await ImportPendingContacts();
                body = Json("result", "pending contact import triggered");
            }
            else if (method == "POST" && path == "/skip-pending-contacts")
            {
                if (SkipPendingContacts is not null) await SkipPendingContacts();
                body = Json("result", "pending contacts ignored");
            }
            else if (method == "POST" && path == "/set-theme-sync")
            {
                var enabled = ParseInt(qs, "enabled", 0) != 0;
                if (SetSyncThemeWithShamash is not null) await SetSyncThemeWithShamash(enabled);
                body = Json("result", enabled ? "theme sync enabled" : "theme sync disabled");
            }
            else if (method == "POST" && path == "/set-history-paused")
            {
                var paused = ParseInt(qs, "paused", 0) != 0;
                if (SetPauseHistoryActivity is not null) await SetPauseHistoryActivity(paused);
                body = Json("result", paused ? "history paused" : "history active");
            }
            else if (method == "POST" && path == "/set-dark-mode")
            {
                var enabled = ParseInt(qs, "enabled", 0) != 0;
                if (SetDarkModeEnabled is not null) await SetDarkModeEnabled(enabled);
                body = Json("result", enabled ? "dark mode enabled" : "dark mode disabled");
            }
            else if (method == "POST" && path == "/open-live-log")
            {
                if (OpenLiveLog is not null) await OpenLiveLog();
                body = Json("result", "live log opened");
            }
            else if (method == "POST" && path == "/open-web-ui")
            {
                if (OpenWebUi is not null) await OpenWebUi();
                body = Json("result", "web ui shell opened");
            }
            else if (method == "POST" && path == "/open-audio-console")
            {
                if (OpenAudioConsole is not null) await OpenAudioConsole();
                body = Json("result", "audio console shell opened");
            }
            else if (method == "POST" && path == "/clear-log")
            {
                if (ClearLog is not null) await ClearLog();
                body = Json("result", "log cleared");
            }
            else if (method == "POST" && path == "/run-ui-auditor")
            {
                if (RunUiAuditor is not null) await RunUiAuditor();
                body = Json("result", "ui auditor opened");
            }
            else if (method == "POST" && path == "/toggle-mute")
            {
                if (ToggleMute is not null) await ToggleMute();
                body = Json("result", "mute toggled");
            }
            else if (method == "POST" && path == "/accept-build-update")
            {
                if (AcceptBuildUpdate is not null) await AcceptBuildUpdate();
                body = Json("result", "build update accepted");
            }
            else if (method == "POST" && path == "/snooze-build-update")
            {
                if (SnoozeBuildUpdate is not null) await SnoozeBuildUpdate();
                body = Json("result", "build update snoozed");
            }
            else if (method == "POST" && path == "/show-build-update-prompt")
            {
                if (ShowBuildUpdatePrompt is not null) await ShowBuildUpdatePrompt();
                body = Json("result", "build update prompt shown");
            }
            else if (method == "POST" && path == "/toggle-message-pin")
            {
                var id = ParseStr(qs, "id");
                if (string.IsNullOrWhiteSpace(id)) { statusCode = 400; body = JsonError("missing ?id=ID"); }
                else
                {
                    if (ToggleMessagePin is not null) await ToggleMessagePin(id);
                    body = Json("result", "message pin toggled");
                }
            }
            else if (method == "POST" && path == "/delete-message")
            {
                var id = ParseStr(qs, "id");
                if (string.IsNullOrWhiteSpace(id)) { statusCode = 400; body = JsonError("missing ?id=ID"); }
                else
                {
                    if (DeleteMessage is not null) await DeleteMessage(id);
                    body = Json("result", "message deleted");
                }
            }
            else if (method == "POST" && path == "/undo-message-delete")
            {
                if (UndoMessageDelete is not null) await UndoMessageDelete();
                body = Json("result", "message delete undone");
            }
            else if (method == "POST" && path == "/scan-devices")
            {
                if (ScanDevices is not null) await ScanDevices();
                body = Json("result", "device scan complete");
            }
            else if (method == "POST" && path == "/connect-saved-device")
            {
                var address = ParseStr(qs, "addr");
                if (string.IsNullOrWhiteSpace(address)) { statusCode = 400; body = JsonError("missing ?addr=ADDRESS"); }
                else
                {
                    if (ConnectSavedDevice is not null) await ConnectSavedDevice(address);
                    body = Json("result", "saved device connect requested");
                }
            }
            else if (method == "POST" && path == "/set-default-saved-device")
            {
                var address = ParseStr(qs, "addr");
                if (string.IsNullOrWhiteSpace(address)) { statusCode = 400; body = JsonError("missing ?addr=ADDRESS"); }
                else
                {
                    if (SetDefaultSavedDevice is not null) await SetDefaultSavedDevice(address);
                    body = Json("result", "default saved device updated");
                }
            }
            else if (method == "POST" && path == "/forget-saved-device")
            {
                var address = ParseStr(qs, "addr");
                if (string.IsNullOrWhiteSpace(address)) { statusCode = 400; body = JsonError("missing ?addr=ADDRESS"); }
                else
                {
                    if (ForgetSavedDevice is not null) await ForgetSavedDevice(address);
                    body = Json("result", "saved device forgotten");
                }
            }
            else if (method == "POST" && path == "/connect-scanned-device")
            {
                var address = ParseStr(qs, "addr");
                if (string.IsNullOrWhiteSpace(address)) { statusCode = 400; body = JsonError("missing ?addr=ADDRESS"); }
                else
                {
                    if (ConnectScannedDevice is not null) await ConnectScannedDevice(address);
                    body = Json("result", "scanned device connect requested");
                }
            }
            else if (method == "POST" && path == "/save-contact")
            {
                var id = ParseStr(qs, "id");
                var name = ParseStr(qs, "name");
                var phone = ParseStr(qs, "phone");
                if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(phone)) { statusCode = 400; body = JsonError("missing ?name=NAME&phone=PHONE"); }
                else
                {
                    if (SaveContact is not null) await SaveContact(id, name, phone);
                    body = Json("result", "contact saved");
                }
            }
            else if (method == "POST" && path == "/delete-contact")
            {
                var id = ParseStr(qs, "id");
                var phone = ParseStr(qs, "phone");
                if (string.IsNullOrWhiteSpace(id) && string.IsNullOrWhiteSpace(phone)) { statusCode = 400; body = JsonError("missing ?id=ID or ?phone=PHONE"); }
                else
                {
                    if (DeleteContact is not null) await DeleteContact(id, phone);
                    body = Json("result", "contact deleted");
                }
            }
            else if (method == "POST" && path == "/undo-call-history-delete")
            {
                if (UndoCallHistoryDelete is not null) await UndoCallHistoryDelete();
                body = Json("result", "call history delete undone");
            }
            else if (method == "POST" && path == "/mark-conversation-read")
            {
                var phone = ParseStr(qs, "phone");
                if (string.IsNullOrWhiteSpace(phone)) { statusCode = 400; body = JsonError("missing ?phone=NUMBER"); }
                else
                {
                    if (MarkConversationRead is not null) await MarkConversationRead(phone);
                    body = Json("result", "conversation marked read");
                }
            }
            else if (method == "POST" && path == "/mark-conversation-unread")
            {
                var phone = ParseStr(qs, "phone");
                if (string.IsNullOrWhiteSpace(phone)) { statusCode = 400; body = JsonError("missing ?phone=NUMBER"); }
                else
                {
                    if (MarkConversationUnread is not null) await MarkConversationUnread(phone);
                    body = Json("result", "conversation marked unread");
                }
            }
            else if (method == "POST" && path == "/toggle-conversation-pin")
            {
                var phone = ParseStr(qs, "phone");
                if (string.IsNullOrWhiteSpace(phone)) { statusCode = 400; body = JsonError("missing ?phone=NUMBER"); }
                else
                {
                    if (ToggleConversationPin is not null) await ToggleConversationPin(phone);
                    body = Json("result", "conversation pin toggled");
                }
            }
            else if (method == "POST" && path == "/toggle-conversation-mute")
            {
                var phone = ParseStr(qs, "phone");
                if (string.IsNullOrWhiteSpace(phone)) { statusCode = 400; body = JsonError("missing ?phone=NUMBER"); }
                else
                {
                    if (ToggleConversationMute is not null) await ToggleConversationMute(phone);
                    body = Json("result", "conversation mute toggled");
                }
            }
            else if (method == "POST" && path == "/toggle-conversation-block")
            {
                var phone = ParseStr(qs, "phone");
                if (string.IsNullOrWhiteSpace(phone)) { statusCode = 400; body = JsonError("missing ?phone=NUMBER"); }
                else
                {
                    if (ToggleConversationBlock is not null) await ToggleConversationBlock(phone);
                    body = Json("result", "conversation block toggled");
                }
            }
            else if (method == "POST" && path == "/toggle-call-block")
            {
                var phone = ParseStr(qs, "phone");
                if (string.IsNullOrWhiteSpace(phone)) { statusCode = 400; body = JsonError("missing ?phone=NUMBER"); }
                else
                {
                    if (ToggleCallBlock is not null) await ToggleCallBlock(phone);
                    body = Json("result", "call block toggled");
                }
            }
            else if (method == "POST" && path == "/delete-call-entry")
            {
                var id = ParseStr(qs, "id");
                if (string.IsNullOrWhiteSpace(id)) { statusCode = 400; body = JsonError("missing ?id=CALL_ID"); }
                else
                {
                    if (DeleteCallEntry is not null) await DeleteCallEntry(id);
                    body = Json("result", "call entry deleted");
                }
            }
            else if (method == "POST" && path == "/delete-all-call-history")
            {
                if (DeleteAllCallHistory is not null) await DeleteAllCallHistory();
                body = Json("result", "call history deleted");
            }
            else if (method == "POST" && path == "/shutdown")
            {
                // Write response FIRST, then trigger shutdown — otherwise the TCP
                // socket closes before the caller reads "shutdown triggered".
                body = Json("result", "shutdown triggered");
                await WriteHttpResponseAsync(stream, body, 200);
                // Fire on the thread pool so we don't deadlock the TCP handler
                var shutdownAction = Shutdown;
                Task.Run(() => shutdownAction?.Invoke());
                return;   // skip the generic response writer below
            }
            else if (method == "POST" && path == "/offer-update")
            {
                var exePath = ParseStr(qs, "exe");
                var build = ParseStr(qs, "build");
                bool ok = OfferBuildUpdate is not null && await OfferBuildUpdate(exePath, build);
                body = Json("result", ok ? "build offer shown" : "build offer rejected");
            }
            else if (method == "POST" && path == "/show")
            {
                bool ok = ShowApp is not null && await ShowApp();
                body = Json("result", ok ? "shown" : "show unavailable");
            }
            else if (method == "POST" && path == "/hide")
            {
                bool ok = HideApp is not null && await HideApp();
                body = Json("result", ok ? "hidden" : "hide unavailable");
            }
            else if (method == "POST" && path == "/toggle-main-window")
            {
                bool visible = ToggleMainWindow is not null && await ToggleMainWindow();
                body = JsonSerializer.Serialize(new { result = visible ? "shown" : "hidden", visible });
            }
            else if (method == "POST" && path == "/handoff")
            {
                var target = ParseStr(qs, "target");
                var value = ParseStr(qs, "value");
                if (string.IsNullOrWhiteSpace(target))
                {
                    statusCode = 400;
                    body = JsonError("missing ?target=X");
                }
                else
                {
                    bool ok = Handoff is not null && await Handoff(target, value);
                    body = Json("result", ok ? "handoff opened" : "handoff unavailable");
                }
            }
            else if (method == "POST" && path == "/stage")
            {
                var x = ParseDouble(qs, "x", double.NaN);
                var y = ParseDouble(qs, "y", double.NaN);
                var w = ParseDouble(qs, "w", double.NaN);
                var h = ParseDouble(qs, "h", double.NaN);
                var chrome = ParseInt(qs, "chrome", 0) != 0;
                var token = ParseStr(qs, "token");
                if (double.IsNaN(x) || double.IsNaN(y) || double.IsNaN(w) || double.IsNaN(h))
                    { statusCode = 400; body = JsonError("missing ?x=&y=&w=&h="); }
                else
                {
                    bool ok = SetStageBounds is not null && await SetStageBounds(x, y, w, h, chrome, token);
                    body = Json("result", ok ? "stage set" : "stage unavailable");
                }
            }
            else if (method == "POST" && path == "/stage-pulse")
            {
                var token = ParseStr(qs, "token");
                bool ok = PulseStage is not null && await PulseStage(token);
                body = Json("result", ok ? "stage alive" : "stage unavailable");
            }
            else if (method == "POST" && path == "/stage-exit")
            {
                var token = ParseStr(qs, "token");
                var force = ParseInt(qs, "force", 0) != 0;
                bool ok = ExitStage is not null && await ExitStage(token, force);
                body = Json("result", ok ? "stage exited" : "stage owned");
            }
            else if (method == "POST" && path == "/theme")
            {
                var palette = ParseStr(qs, "palette");
                var colors = ParseThemeColors(qs);
                bool ok = !string.IsNullOrWhiteSpace(palette) && ApplyTheme is not null && await ApplyTheme(palette, colors);
                body = Json("result", ok ? "theme applied" : "theme unavailable");
            }
            else if (path == "/lan-url")
            {
                body = LanUrl is not null ? $"{{\"url\":\"{LanUrl}\"}}" : "{\"url\":null}";
            }
            else if (path == "/relay-status")
            {
                body = GetRelayStatus?.Invoke() ?? "{\"enabled\":false}";
            }
            else if (method == "POST" && path == "/test-reg")
            {
                var v = ParseInt(qs, "v", 0);
                bool ok = TestReg is not null && await TestReg(v);
                body = Json("result", ok ? "success" : "failed");
            }
            else if (method == "POST" && path == "/dial")
            {
                var number = ParseStr(qs, "n");
                if (string.IsNullOrWhiteSpace(number)) { statusCode = 400; body = JsonError("missing ?n=NUMBER"); }
                else
                {
                    if (Dial is not null) await Dial(number);
                    body = Json("result", $"dialing {number}");
                }
            }
            else if (method == "POST" && path == "/send")
            {
                var to   = ParseStr(qs, "to");
                var text = ParseStr(qs, "body");
                var cid  = ParseStr(qs, "cid");
                if (string.IsNullOrWhiteSpace(to) || string.IsNullOrWhiteSpace(text))
                    { statusCode = 400; body = JsonError("missing ?to=X&body=Y"); }
                else
                {
                    bool ok = Send is not null && await Send(to, text, string.IsNullOrWhiteSpace(cid) ? null : cid);
                    body = Json("result", ok ? "sent" : "failed");
                }
            }
            else if (method == "POST" && path == "/send-with-attachments")
            {
                if (!TryParseAttachmentSendRequest(requestBody, out var to, out var text, out var attachments, out var cid, out var error))
                {
                    statusCode = 400;
                    body = JsonError(error);
                }
                else
                {
                    bool ok = SendWithAttachments is not null && await SendWithAttachments(to, text, attachments, cid);
                    body = Json("result", ok ? "sent" : "failed");
                }
            }
            else if (method == "GET")
            {
                // Serve built webapp static files from ./web/ next to the exe (SPA fallback for unknown GET paths)
                await ServeStaticAsync(stream, rawPath.Contains('?') ? rawPath[..rawPath.IndexOf('?')] : rawPath);
                return;
            }
            else
            {
                statusCode = 404;
                body = JsonError($"unknown: {path}");
            }

            // Write HTTP response
            await WriteHttpResponseAsync(stream, body, statusCode);
        }
        catch (Exception ex)
        {
            LogLine?.Invoke($"[API ERROR] {ex.GetType().Name}: {ex.Message}");
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────
    private static async Task WriteHttpResponseAsync(NetworkStream stream, string body, int statusCode)
    {
        var bodyBytes = Encoding.UTF8.GetBytes(body);
        var response = Encoding.ASCII.GetBytes(
            $"HTTP/1.1 {statusCode} {StatusReason(statusCode)}\r\n" +
            "Content-Type: application/json\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
            "Access-Control-Allow-Headers: Content-Type, Authorization, X-Host-Token\r\n" +
            "Access-Control-Allow-Private-Network: true\r\n" +
            $"Content-Length: {bodyBytes.Length}\r\n" +
            "Connection: close\r\n" +
            "\r\n");

        await stream.WriteAsync(response);
        if (bodyBytes.Length > 0)
            await stream.WriteAsync(bodyBytes);
        await stream.FlushAsync();
    }

    private static string StatusReason(int statusCode) => statusCode switch
    {
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK"
    };

    // ── Call-audio bridge helpers ─────────────────────────────────────────
    private string AudioInputsJson()
    {
        var inputs = CallAudio.ListInputs();
        var payload = new
        {
            running           = CallAudio.IsRunning,
            currentDeviceId   = CallAudio.CurrentDeviceId,
            currentDeviceName = CallAudio.CurrentDeviceName,
            level             = CallAudio.LastLevel,
            subscribers       = CallAudio.SubscriberCount,
            sampleRate        = CallAudioBridgeService.OutputSampleRate,
            devices           = inputs.Select(d => new { id = d.Id, name = d.Name, isDefault = d.IsDefault })
        };
        return JsonSerializer.Serialize(payload);
    }

    private string CallAudioStateJson()
    {
        var cfg = CallAudio.Settings;
        return JsonSerializer.Serialize(new
        {
            downlink = new
            {
                running           = CallAudio.IsRunning,
                deviceId          = CallAudio.CurrentDeviceId,
                deviceName        = CallAudio.CurrentDeviceName,
                level             = CallAudio.LastLevel,
                subscribers       = CallAudio.SubscriberCount,
            },
            uplink = new
            {
                active        = CallAudio.UplinkActive,
                deviceName    = CallAudio.UplinkDeviceName,
                bytesReceived = CallAudio.UplinkBytesReceived,
            },
            deskMode = new
            {
                engaged    = CallAudio.DeskModeEngaged,
                autoEngage = cfg.AutoEngageDeskMode,
                lanes      = CallAudio.DeskLaneStatus()
                    .Select(l => new { l.Name, l.Source, l.Target, l.Level, l.Faulted }),
            },
            config = new
            {
                carkitIn  = cfg.CarkitInputId,
                carkitOut = cfg.CarkitOutputId,
                deskOut   = cfg.DeskOutputId,
                deskMic   = cfg.DeskMicId,
                autoEngage = cfg.AutoEngageDeskMode,
            },
            sampleRate = CallAudioBridgeService.OutputSampleRate,
            inputs  = CallAudio.ListInputs().Select(d => new { id = d.Id, name = d.Name, isDefault = d.IsDefault }),
            outputs = CallAudio.ListOutputs().Select(d => new { id = d.Id, name = d.Name, isDefault = d.IsDefault }),
        });
    }

    // ── WebSocket: full-duplex call audio ────────────────────────────────
    // Server→client binary frames: downlink PCM (16 kHz mono s16le).
    // Client→server binary frames: uplink PCM (same format) → carkit output.
    // Minimal RFC 6455: binary/ping/pong/close, masked client frames, no extensions.
    private async Task HandleCallAudioWebSocketAsync(
        NetworkStream stream, IReadOnlyDictionary<string, string> headers, string qs)
    {
        if (!headers.TryGetValue("Sec-WebSocket-Key", out var wsKey) ||
            !headers.TryGetValue("Upgrade", out var upgrade) ||
            !upgrade.Contains("websocket", StringComparison.OrdinalIgnoreCase))
        {
            await WriteHttpResponseAsync(stream, JsonError("expected a WebSocket upgrade request"), 400);
            return;
        }

        var accept = Convert.ToBase64String(
            System.Security.Cryptography.SHA1.HashData(
                Encoding.ASCII.GetBytes(wsKey.Trim() + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));

        var handshake = Encoding.ASCII.GetBytes(
            "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            $"Sec-WebSocket-Accept: {accept}\r\n\r\n");
        await stream.WriteAsync(handshake, _cts.Token);
        await stream.FlushAsync(_cts.Token);

        LogLine?.Invoke("[call-audio] websocket client connected");

        var uplinkDevice = ParseStr(qs, "uplink");
        bool uplinkStartedHere = false;
        var sendLock = new SemaphoreSlim(1, 1);
        using var closeCts = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token);

        // Downlink pump: capture chunks → binary frames.
        var (reader, lease) = CallAudio.AddSubscriber();
        var downlinkTask = Task.Run(async () =>
        {
            try
            {
                await foreach (var chunk in reader.ReadAllAsync(closeCts.Token))
                    await SendWsFrameAsync(stream, 0x2, chunk, sendLock, closeCts.Token);
            }
            catch { /* socket closed — read pump handles shutdown */ }
        });

        // Read pump: client frames → uplink PCM / ping / close.
        try
        {
            var header = new byte[2];
            while (!closeCts.Token.IsCancellationRequested)
            {
                await ReadExactAsync(stream, header, 2, closeCts.Token);
                int opcode = header[0] & 0x0F;
                bool masked = (header[1] & 0x80) != 0;
                long len = header[1] & 0x7F;

                if (len == 126)
                {
                    var ext = new byte[2];
                    await ReadExactAsync(stream, ext, 2, closeCts.Token);
                    len = (ext[0] << 8) | ext[1];
                }
                else if (len == 127)
                {
                    var ext = new byte[8];
                    await ReadExactAsync(stream, ext, 8, closeCts.Token);
                    len = 0;
                    for (int i = 0; i < 8; i++) len = (len << 8) | ext[i];
                }

                if (len > 1024 * 1024) break;            // refuse absurd frames

                var mask = new byte[4];
                if (masked) await ReadExactAsync(stream, mask, 4, closeCts.Token);

                var payload = new byte[len];
                if (len > 0) await ReadExactAsync(stream, payload, (int)len, closeCts.Token);
                if (masked)
                    for (int i = 0; i < payload.Length; i++)
                        payload[i] ^= mask[i & 3];

                if (opcode == 0x8)                        // close
                {
                    // Stop the downlink pump BEFORE replying: a strict client
                    // (.NET ClientWebSocket) fails its close handshake if data
                    // frames keep arriving after it initiates close.
                    closeCts.Cancel();
                    try { await downlinkTask; } catch { }
                    await SendWsFrameAsync(stream, 0x8, Array.Empty<byte>(), sendLock, CancellationToken.None);
                    break;
                }
                if (opcode == 0x9)                        // ping → pong
                {
                    await SendWsFrameAsync(stream, 0xA, payload, sendLock, closeCts.Token);
                    continue;
                }
                if (opcode == 0x2 && payload.Length > 0)  // binary → uplink voice
                {
                    if (!CallAudio.UplinkActive)
                    {
                        try
                        {
                            CallAudio.StartUplink(string.IsNullOrWhiteSpace(uplinkDevice) ? null : uplinkDevice);
                            uplinkStartedHere = true;
                        }
                        catch (Exception ex) { LogLine?.Invoke($"[call-audio] ws uplink start failed: {ex.Message}"); }
                    }
                    CallAudio.WriteUplink(payload, 0, payload.Length);
                }
                // text frames (opcode 0x1) and pongs are ignored for now
            }
        }
        catch { /* client vanished — normal for tab close / network drop */ }
        finally
        {
            closeCts.Cancel();
            lease.Dispose();
            if (uplinkStartedHere) CallAudio.StopUplink();
            try { await downlinkTask; } catch { }
            sendLock.Dispose();
            LogLine?.Invoke("[call-audio] websocket client disconnected");
        }
    }

    private static async Task SendWsFrameAsync(
        NetworkStream stream, byte opcode, byte[] payload, SemaphoreSlim sendLock, CancellationToken ct)
    {
        byte[] header;
        if (payload.Length < 126)
            header = new byte[] { (byte)(0x80 | opcode), (byte)payload.Length };
        else if (payload.Length <= 65535)
            header = new byte[] { (byte)(0x80 | opcode), 126,
                                  (byte)(payload.Length >> 8), (byte)(payload.Length & 0xFF) };
        else
            throw new InvalidOperationException("frame too large");

        await sendLock.WaitAsync(ct);
        try
        {
            await stream.WriteAsync(header, ct);
            if (payload.Length > 0) await stream.WriteAsync(payload, ct);
            await stream.FlushAsync(ct);
        }
        finally { sendLock.Release(); }
    }

    private static async Task ReadExactAsync(NetworkStream stream, byte[] buf, int count, CancellationToken ct)
    {
        int read = 0;
        while (read < count)
        {
            int n = await stream.ReadAsync(buf.AsMemory(read, count - read), ct);
            if (n <= 0) throw new IOException("socket closed");
            read += n;
        }
    }

    /// <summary>Writes an indefinite chunked PCM stream to the socket until the
    /// client disconnects, then releases its subscriber lease.</summary>
    private async Task StreamCallAudioAsync(NetworkStream stream, string qs)
    {
        var deviceId = ParseStr(qs, "device");
        if (!string.IsNullOrWhiteSpace(deviceId))
        {
            try { CallAudio.Start(deviceId); }
            catch (Exception ex) { LogLine?.Invoke($"[call-audio] requested device start failed: {ex.Message}"); }
        }

        var (reader, lease) = CallAudio.AddSubscriber();
        using var _l = lease;

        var header = Encoding.ASCII.GetBytes(
            "HTTP/1.1 200 OK\r\n" +
            "Content-Type: application/octet-stream\r\n" +
            "Cache-Control: no-store\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Access-Control-Allow-Private-Network: true\r\n" +
            $"X-Sample-Rate: {CallAudioBridgeService.OutputSampleRate}\r\n" +
            "Connection: close\r\n\r\n");

        try
        {
            await stream.WriteAsync(header, _cts.Token);
            await stream.FlushAsync(_cts.Token);
            await foreach (var chunk in reader.ReadAllAsync(_cts.Token))
            {
                await stream.WriteAsync(chunk, _cts.Token);
                await stream.FlushAsync(_cts.Token);
            }
        }
        catch { /* client closed the stream or host shutting down — release the lease via using */ }
    }

    private static string BuildAudioBridgePage() => """
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DeskPhone — Call Audio</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: 'Segoe UI', Roboto, system-ui, sans-serif; margin:0; padding:24px;
         background:#0b0f14; color:#e7edf3; }
  .wrap { max-width:620px; margin:0 auto; display:flex; flex-direction:column; gap:16px; }
  .card { background:#141b24; border:1px solid #243140; border-radius:16px; padding:20px 22px; }
  h1 { font-size:18px; margin:0; display:flex; align-items:center; gap:10px; }
  h2 { font-size:13px; margin:0 0 12px; color:#9fd0ff; text-transform:uppercase; letter-spacing:.08em; }
  p.sub { margin:6px 0 0; color:#8aa0b4; font-size:13px; line-height:1.45; }
  label { display:block; font-size:12px; color:#8aa0b4; margin:12px 0 5px; }
  select, button { font-size:14px; }
  select { width:100%; padding:9px; border-radius:10px; background:#0e141b; color:#e7edf3;
           border:1px solid #2b3a4b; }
  .row { display:flex; gap:10px; margin-top:14px; }
  button { flex:1; padding:11px; border-radius:10px; border:none; cursor:pointer; font-weight:600;
           background:#26405c; color:#fff; }
  button.go   { background:#0b8a4a; }
  button.warn { background:#7a2230; }
  button:disabled { opacity:.45; cursor:default; }
  .meter { height:12px; border-radius:6px; background:#0e141b; border:1px solid #2b3a4b;
           overflow:hidden; margin-top:12px; }
  .meter > div { height:100%; width:0%; background:linear-gradient(90deg,#0b8a4a,#d6c40b,#d63b3b);
                 transition:width .08s linear; }
  .status { margin-top:10px; font-size:13px; color:#8aa0b4; min-height:17px; }
  .badge { font-size:12px; font-weight:600; border-radius:999px; padding:3px 12px; background:#26405c; }
  .badge.live { background:#0b8a4a; }
  .check { display:flex; align-items:center; gap:8px; margin-top:14px; font-size:13px; color:#c7d4e0; }
  .check input { width:16px; height:16px; }
  .lanes { font-size:12px; color:#8aa0b4; margin-top:8px; line-height:1.5; }
</style>
</head>
<body>
<div class="wrap">

  <div class="card">
    <h1>Call Audio <span class="badge" id="callBadge">idle</span></h1>
    <p class="sub">Live two-way bridge between the carkit device (the hardware your phone
       sends call audio to) and this browser or your PC headset. Configure devices once;
       Desk Mode can then follow calls automatically.</p>
  </div>

  <div class="card">
    <h2>Devices</h2>
    <label>Carkit input — call audio arrives here</label>
    <select id="cfgCarkitIn"></select>
    <label>Carkit output — your voice plays out here (phone hears it)</label>
    <select id="cfgCarkitOut"></select>
    <label>Desk output — your headset / AirPods</label>
    <select id="cfgDeskOut"></select>
    <label>Desk mic — your headset / AirPods microphone</label>
    <select id="cfgDeskMic"></select>
    <div class="check">
      <input type="checkbox" id="cfgAuto">
      <span>Auto-engage Desk Mode while a call is active</span>
    </div>
    <div class="row"><button id="saveCfg" class="go">Save devices</button></div>
    <div class="status" id="cfgStatus"></div>
  </div>

  <div class="card">
    <h2>Browser — listen &amp; talk</h2>
    <div class="row">
      <button id="listen" class="go">Listen</button>
      <button id="talk">Talk</button>
      <button id="stopAll" class="warn" disabled>Stop</button>
    </div>
    <div class="meter"><div id="bar"></div></div>
    <div class="status" id="status">Idle.</div>
  </div>

  <div class="card">
    <h2>Desk Mode — carkit ⇄ headset</h2>
    <div class="row">
      <button id="deskOn" class="go">Engage</button>
      <button id="deskOff" class="warn">Release</button>
    </div>
    <div class="lanes" id="lanes">Not engaged.</div>
  </div>

</div>
<script>
const $ = (id) => document.getElementById(id);
const RATE = 16000;
let ws = null, ctx = null, nextTime = 0;
let listening = false, talking = false;
let micStream = null, micCtx = null, micNode = null, micSrc = null;

// ── shared websocket (downlink frames in, uplink frames out) ──
function wsUrl() {
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/call-audio.ws';
}
function ensureWs() {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) return resolve(ws);
    const s = new WebSocket(wsUrl());
    s.binaryType = 'arraybuffer';
    s.onopen = () => { ws = s; resolve(s); };
    s.onerror = (e) => reject(new Error('WebSocket failed'));
    s.onclose = () => { if (ws === s) { ws = null; if (listening || talking) stopAll('Connection closed.'); } };
    s.onmessage = (ev) => { if (listening && ev.data instanceof ArrayBuffer) playChunk(ev.data); };
  });
}
function closeWsIfIdle() {
  if (!listening && !talking && ws) { try { ws.close(); } catch {} ws = null; }
}

// ── downlink playback ──
function playChunk(buf) {
  if (!ctx) return;
  const frames = Math.floor(buf.byteLength / 2);
  if (!frames) return;
  const dv = new DataView(buf);
  const f32 = new Float32Array(frames);
  for (let i = 0; i < frames; i++) f32[i] = dv.getInt16(i * 2, true) / 32768;
  const ab = ctx.createBuffer(1, frames, RATE);
  ab.copyToChannel(f32, 0);
  const src = ctx.createBufferSource();
  src.buffer = ab; src.connect(ctx.destination);
  if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.06;
  src.start(nextTime);
  nextTime += ab.duration;
}

async function startListen() {
  try {
    try { ctx = new AudioContext({ sampleRate: RATE }); } catch { ctx = new AudioContext(); }
    await ctx.resume();
    nextTime = ctx.currentTime + 0.20;
    await fetch('/call-audio/start?device=' + encodeURIComponent($('cfgCarkitIn').value), { method:'POST' });
    await ensureWs();
    listening = true;
    syncButtons('Live — listening to the carkit input.');
  } catch (e) { syncButtons('Listen failed: ' + e.message); }
}

// ── uplink (your mic → carkit output) ──
async function startTalk() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    syncButtons('Mic capture needs a secure page (localhost or HTTPS).'); return;
  }
  try {
    micStream = await navigator.mediaDevices.getUserMedia(
      { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    await ensureWs();
    try { micCtx = new AudioContext({ sampleRate: RATE }); } catch { micCtx = new AudioContext(); }
    await micCtx.resume();
    micSrc = micCtx.createMediaStreamSource(micStream);
    micNode = micCtx.createScriptProcessor(2048, 1, 1);
    const mute = micCtx.createGain(); mute.gain.value = 0;   // processor must reach destination to run
    micNode.onaudioprocess = (ev) => {
      if (!talking || !ws || ws.readyState !== WebSocket.OPEN) return;
      const f32 = ev.inputBuffer.getChannelData(0);
      const out = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++) {
        const s = Math.max(-1, Math.min(1, f32[i]));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      ws.send(out.buffer);
    };
    micSrc.connect(micNode); micNode.connect(mute); mute.connect(micCtx.destination);
    talking = true;
    syncButtons('Live — your voice is feeding the carkit output.');
  } catch (e) { stopTalkInternals(); syncButtons('Talk failed: ' + e.message); }
}

function stopTalkInternals() {
  try { micNode && micNode.disconnect(); } catch {}
  try { micSrc && micSrc.disconnect(); } catch {}
  try { micStream && micStream.getTracks().forEach(t => t.stop()); } catch {}
  try { micCtx && micCtx.close(); } catch {}
  micNode = micSrc = micStream = micCtx = null;
}

function stopAll(msg) {
  listening = false;
  talking = false;
  stopTalkInternals();
  try { ctx && ctx.close(); } catch {}
  ctx = null;
  closeWsIfIdle();
  syncButtons(msg || 'Stopped.');
}

function syncButtons(msg) {
  $('listen').disabled = listening;
  $('talk').disabled = talking;
  $('stopAll').disabled = !listening && !talking;
  if (msg) $('status').textContent = msg;
}

// ── config + state ──
function fillSelect(sel, devices, selectedId) {
  sel.innerHTML = '';
  const none = document.createElement('option');
  none.value = ''; none.textContent = '(not set — use default)';
  sel.appendChild(none);
  for (const d of devices) {
    const o = document.createElement('option');
    o.value = d.id; o.textContent = d.name + (d.isDefault ? '  (default)' : '');
    sel.appendChild(o);
  }
  sel.value = selectedId || '';
}

let cfgLoaded = false;
async function refreshState() {
  try {
    const j = await (await fetch('/call-audio/state')).json();
    if (!cfgLoaded) {
      fillSelect($('cfgCarkitIn'),  j.inputs,  j.config.carkitIn);
      fillSelect($('cfgDeskMic'),   j.inputs,  j.config.deskMic);
      fillSelect($('cfgCarkitOut'), j.outputs, j.config.carkitOut);
      fillSelect($('cfgDeskOut'),   j.outputs, j.config.deskOut);
      $('cfgAuto').checked = !!j.config.autoEngage;
      cfgLoaded = true;
    }
    $('bar').style.width = Math.min(100, Math.round((j.downlink.level || 0) * 140)) + '%';
    if (j.deskMode.engaged) {
      $('lanes').innerHTML = j.deskMode.lanes.map(l =>
        (l.Faulted ? '⚠ ' : '● ') + l.Name + ': ' + l.Source + ' → ' + l.Target).join('<br>') || 'Engaged (no lanes).';
    } else {
      $('lanes').textContent = j.deskMode.autoEngage
        ? 'Not engaged — will engage automatically during calls.' : 'Not engaged.';
    }
  } catch {}
  try {
    const s = await (await fetch('/status')).json();
    const active = s.isCallActive || s.isRinging;
    $('callBadge').textContent = s.callState || 'idle';
    $('callBadge').className = 'badge' + (active ? ' live' : '');
  } catch {}
}

async function saveCfg() {
  const p = new URLSearchParams({
    carkitIn:  $('cfgCarkitIn').value,
    carkitOut: $('cfgCarkitOut').value,
    deskOut:   $('cfgDeskOut').value,
    deskMic:   $('cfgDeskMic').value,
    autoEngage: $('cfgAuto').checked ? '1' : '0',
  });
  try {
    await fetch('/call-audio/config?' + p, { method: 'POST' });
    $('cfgStatus').textContent = 'Saved.';
    setTimeout(() => $('cfgStatus').textContent = '', 2500);
  } catch (e) { $('cfgStatus').textContent = 'Save failed: ' + e; }
}

$('listen').onclick = startListen;
$('talk').onclick = startTalk;
$('stopAll').onclick = () => stopAll();
$('saveCfg').onclick = saveCfg;
$('deskOn').onclick  = async () => { await saveCfg(); await fetch('/desk-mode/start', { method:'POST' }); refreshState(); };
$('deskOff').onclick = async () => { await fetch('/desk-mode/stop',  { method:'POST' }); refreshState(); };

refreshState();
setInterval(refreshState, 1500);
</script>
</body>
</html>
""";

    private static async Task WriteHtmlResponseAsync(NetworkStream stream, string html)
    {
        var bodyBytes = Encoding.UTF8.GetBytes(html);
        var response = Encoding.ASCII.GetBytes(
            "HTTP/1.1 200 OK\r\n" +
            "Content-Type: text/html; charset=utf-8\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Cache-Control: no-store\r\n" +
            $"Content-Length: {bodyBytes.Length}\r\n" +
            "Connection: close\r\n\r\n");
        await stream.WriteAsync(response);
        await stream.WriteAsync(bodyBytes);
        await stream.FlushAsync();
    }

    private static string Json(string key, string value)
        => $"{{\"{key}\":\"{value}\"}}";

    private static string JsonError(string msg)
    {
        var safe = msg.Replace("\\", "\\\\").Replace("\"", "\\\"");
        return $"{{\"error\":\"{safe}\"}}";
    }

    private static async Task<string> ReadRequestBodyAsync(StreamReader reader, IReadOnlyDictionary<string, string> headers)
    {
        if (!headers.TryGetValue("Content-Length", out var rawLength) ||
            !int.TryParse(rawLength, out var length) ||
            length <= 0)
            return "";

        if (length > MaxJsonBodyChars)
            throw new InvalidOperationException("request body is too large");

        var buffer = new char[length];
        var read = 0;
        while (read < length)
        {
            var count = await reader.ReadBlockAsync(buffer, read, length - read);
            if (count <= 0) break;
            read += count;
        }

        return new string(buffer, 0, read);
    }

    private static bool TryParseAttachmentSendRequest(
        string requestBody,
        out string to,
        out string text,
        out IReadOnlyList<MessageAttachment> attachments,
        out string? cid,
        out string error)
    {
        to = "";
        text = "";
        attachments = Array.Empty<MessageAttachment>();
        cid = null;
        error = "";

        if (string.IsNullOrWhiteSpace(requestBody))
        {
            error = "missing JSON body";
            return false;
        }

        AttachmentSendRequest? request;
        try
        {
            request = JsonSerializer.Deserialize<AttachmentSendRequest>(
                requestBody,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        }
        catch (JsonException ex)
        {
            error = $"invalid JSON: {ex.Message}";
            return false;
        }

        to = request?.To?.Trim() ?? "";
        text = request?.Body?.Trim() ?? "";
        cid = string.IsNullOrWhiteSpace(request?.Cid) ? null : request!.Cid!.Trim();
        var uploads = request?.Attachments ?? new List<AttachmentUpload>();
        if (string.IsNullOrWhiteSpace(to))
        {
            error = "missing to";
            return false;
        }

        if (string.IsNullOrWhiteSpace(text) && uploads.Count == 0)
        {
            error = "missing body or attachments";
            return false;
        }

        var decoded = new List<MessageAttachment>();
        foreach (var upload in uploads)
        {
            var dataBase64 = upload.DataBase64?.Trim() ?? "";
            if (string.IsNullOrWhiteSpace(dataBase64))
                continue;

            var comma = dataBase64.IndexOf(',');
            if (dataBase64.StartsWith("data:", StringComparison.OrdinalIgnoreCase) && comma >= 0)
                dataBase64 = dataBase64[(comma + 1)..];

            byte[] data;
            try
            {
                data = Convert.FromBase64String(dataBase64);
            }
            catch (FormatException)
            {
                error = $"invalid attachment data for {upload.FileName ?? "attachment"}";
                return false;
            }

            if (data.Length == 0) continue;
            decoded.Add(new MessageAttachment
            {
                ContentType = string.IsNullOrWhiteSpace(upload.ContentType) ? "application/octet-stream" : upload.ContentType.Trim(),
                FileName = string.IsNullOrWhiteSpace(upload.FileName) ? $"attachment-{decoded.Count + 1}.bin" : upload.FileName.Trim(),
                Data = data
            });
        }

        attachments = decoded;
        return true;
    }

    private static int ParseInt(string qs, string key, int def)
    {
        var m = System.Text.RegularExpressions.Regex.Match(qs, $@"(?:^|&){key}=(\d+)");
        return m.Success && int.TryParse(m.Groups[1].Value, out var v) ? v : def;
    }

    private static double ParseDouble(string qs, string key, double def)
    {
        var raw = ParseStr(qs, key);
        return double.TryParse(raw, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var v)
            ? v
            : def;
    }

    private static string ParseStr(string qs, string key)
    {
        var m = System.Text.RegularExpressions.Regex.Match(qs, $@"(?:^|&){key}=([^&]*)");
        return m.Success ? Uri.UnescapeDataString(m.Groups[1].Value.Replace("+", " ")) : "";
    }

    private static IReadOnlyDictionary<string, string> ParseThemeColors(string qs)
    {
        var colors = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var key in new[]
                 {
                     "bg", "bgW", "card", "text", "tSoft", "tFaint", "brd", "brdS",
                     "primary", "onPrimary", "tonal", "onTonal"
                 })
        {
            var value = ParseStr(qs, key);
            if (!string.IsNullOrWhiteSpace(value))
                colors[key] = value;
        }

        return colors;
    }

    private static string ReadLastLines(string path, int count)
    {
        try
        {
            var lines = File.ReadAllLines(path);
            var tail  = lines.Length <= count ? lines : lines[^count..];
            return JsonSerializer.Serialize(tail);
        }
        catch (Exception ex) { return JsonError(ex.Message); }
    }

    private sealed class AttachmentSendRequest
    {
        public string? To { get; set; }
        public string? Body { get; set; }
        public string? Cid { get; set; }
        public List<AttachmentUpload>? Attachments { get; set; }
    }

    private sealed class AttachmentUpload
    {
        public string? FileName { get; set; }
        public string? ContentType { get; set; }
        public string? DataBase64 { get; set; }
    }

    // ── Static file serving (webapp bundle from ./web/ next to exe) ──────

    private static string WebRoot => Path.Combine(AppContext.BaseDirectory, "web");

    private static async Task ServeStaticAsync(NetworkStream stream, string urlPath)
    {
        var root = WebRoot;
        if (!Directory.Exists(root))
        {
            // No web bundle deployed — fall through to generic 404
            var nb = Encoding.UTF8.GetBytes(JsonError("web root not found"));
            var nh = Encoding.ASCII.GetBytes(
                "HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\n" +
                $"Content-Length: {nb.Length}\r\nConnection: close\r\n\r\n");
            await stream.WriteAsync(nh); await stream.WriteAsync(nb); await stream.FlushAsync();
            return;
        }

        // Resolve path inside web root; SPA fallback to index.html for non-asset paths
        string filePath;
        var clean = urlPath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
        if (string.IsNullOrEmpty(clean) || clean == "index.html")
            filePath = Path.Combine(root, "index.html");
        else
            filePath = Path.Combine(root, clean);

        // Path traversal guard
        var fullPath = Path.GetFullPath(filePath);
        var rootFull = Path.GetFullPath(root);
        if (!fullPath.StartsWith(rootFull + Path.DirectorySeparatorChar) && fullPath != rootFull)
        {
            var fb = Encoding.UTF8.GetBytes(JsonError("forbidden"));
            var fh = Encoding.ASCII.GetBytes(
                "HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\n" +
                $"Content-Length: {fb.Length}\r\nConnection: close\r\n\r\n");
            await stream.WriteAsync(fh); await stream.WriteAsync(fb); await stream.FlushAsync();
            return;
        }

        // If file missing, serve index.html (client-side routing / SPA fallback)
        if (!File.Exists(fullPath))
            fullPath = Path.Combine(root, "index.html");

        if (!File.Exists(fullPath))
        {
            var mb = Encoding.UTF8.GetBytes(JsonError("not found"));
            var mh = Encoding.ASCII.GetBytes(
                "HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\n" +
                $"Content-Length: {mb.Length}\r\nConnection: close\r\n\r\n");
            await stream.WriteAsync(mh); await stream.WriteAsync(mb); await stream.FlushAsync();
            return;
        }

        var mime = GetMimeType(fullPath);
        var data = await File.ReadAllBytesAsync(fullPath);
        var header = Encoding.ASCII.GetBytes(
            "HTTP/1.1 200 OK\r\n" +
            $"Content-Type: {mime}\r\n" +
            $"Content-Length: {data.Length}\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Cache-Control: no-cache\r\n" +
            "Connection: close\r\n\r\n");
        await stream.WriteAsync(header);
        await stream.WriteAsync(data);
        await stream.FlushAsync();
    }

    private static string GetMimeType(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".html"          => "text/html; charset=utf-8",
        ".js"            => "application/javascript",
        ".css"           => "text/css",
        ".json"          => "application/json",
        ".png"           => "image/png",
        ".jpg" or ".jpeg"=> "image/jpeg",
        ".gif"           => "image/gif",
        ".svg"           => "image/svg+xml",
        ".ico"           => "image/x-icon",
        ".woff"          => "font/woff",
        ".woff2"         => "font/woff2",
        ".ttf"           => "font/ttf",
        ".otf"           => "font/otf",
        ".txt"           => "text/plain",
        _                => "application/octet-stream"
    };

    public void Dispose() => Stop();
}
