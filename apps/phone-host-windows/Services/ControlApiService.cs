using System.IO;
using System.Net;
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

    // ── Callbacks wired up by the ViewModel ───────────────────────────────
    public Func<string>?                     GetStatus   { get; set; }
    public Func<int, bool, string>?          GetMessages { get; set; }
    public Func<string>?                     GetCalls    { get; set; }
    public Func<string>?                     GetContacts { get; set; }
    public Func<Task>?                       Connect     { get; set; }
    public Func<Task>?                       Answer      { get; set; }
    public Func<Task>?                       HangUp      { get; set; }
    public Func<string, Task>?               Dial        { get; set; }
    public Func<string, string, Task<bool>>? Send        { get; set; }
    public Func<string, string, IReadOnlyList<MessageAttachment>, Task<bool>>? SendWithAttachments { get; set; }
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
                if (string.IsNullOrWhiteSpace(to) || string.IsNullOrWhiteSpace(text))
                    { statusCode = 400; body = JsonError("missing ?to=X&body=Y"); }
                else
                {
                    bool ok = Send is not null && await Send(to, text);
                    body = Json("result", ok ? "sent" : "failed");
                }
            }
            else if (method == "POST" && path == "/send-with-attachments")
            {
                if (!TryParseAttachmentSendRequest(requestBody, out var to, out var text, out var attachments, out var error))
                {
                    statusCode = 400;
                    body = JsonError(error);
                }
                else
                {
                    bool ok = SendWithAttachments is not null && await SendWithAttachments(to, text, attachments);
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
            "Access-Control-Allow-Headers: Content-Type\r\n" +
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
        404 => "Not Found",
        _ => "OK"
    };

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
        out string error)
    {
        to = "";
        text = "";
        attachments = Array.Empty<MessageAttachment>();
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
