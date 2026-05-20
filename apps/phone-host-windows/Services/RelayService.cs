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
    private const int PushIntervalMs     = 5_000;   // push state every 5 s
    private const int DrainIntervalMs    = 2_000;   // poll for commands every 2 s
    private const int MessageRelayLimit  = 500;     // messages to include in state blob
    private const int HttpTimeoutMs      = 8_000;

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
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(PushIntervalMs, ct);
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
        }
    }

    private async Task PushStateAsync()
    {
        if (GetStatus is null) return;

        // Build state blob: status + recent messages + calls + contacts
        var statusJson   = GetStatus();
        var messagesJson = GetMessages?.Invoke(MessageRelayLimit, false) ?? "[]";
        var callsJson    = GetCalls?.Invoke() ?? "[]";
        var contactsJson = GetContacts?.Invoke() ?? "[]";

        // Inline-assemble the outer object without deserializing everything —
        // these are already valid JSON strings, just stitch them together.
        var stateJson = $"{{\"status\":{statusJson},\"messages\":{messagesJson},\"calls\":{callsJson},\"contacts\":{contactsJson},\"pushedAt\":{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}}}";

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
            _ = Task.Run(() => ExecuteCommandAsync(path));
        }
    }

    // Parse the path+query string (same format the webapp already sends to localhost)
    // and route to the appropriate callback.
    private async Task ExecuteCommandAsync(string rawPath)
    {
        try
        {
            var q     = rawPath.IndexOf('?');
            var path  = (q < 0 ? rawPath : rawPath[..q]).ToLowerInvariant();
            var qs    = q < 0 ? "" : rawPath[(q + 1)..];

            LogLine?.Invoke($"[RELAY CMD] {path}");

            switch (path)
            {
                case "/dial":
                    var n = ParseStr(qs, "n");
                    if (!string.IsNullOrWhiteSpace(n) && Dial is not null) await Dial(n);
                    break;
                case "/hangup":
                    if (HangUp is not null) await HangUp();
                    break;
                case "/answer":
                    if (Answer is not null) await Answer();
                    break;
                case "/toggle-mute":
                    if (ToggleMute is not null) await ToggleMute();
                    break;
                case "/send":
                    var to   = ParseStr(qs, "to");
                    var body = ParseStr(qs, "body");
                    if (!string.IsNullOrWhiteSpace(to) && !string.IsNullOrWhiteSpace(body) && Send is not null)
                        await Send(to, body);
                    break;
                case "/refresh":
                    if (Refresh is not null) await Refresh();
                    break;
                case "/mark-conversation-read":
                    var rPhone = ParseStr(qs, "phone");
                    if (!string.IsNullOrWhiteSpace(rPhone) && MarkRead is not null) await MarkRead(rPhone);
                    break;
                case "/mark-conversation-unread":
                    var uPhone = ParseStr(qs, "phone");
                    if (!string.IsNullOrWhiteSpace(uPhone) && MarkUnread is not null) await MarkUnread(uPhone);
                    break;
                default:
                    LogLine?.Invoke($"[RELAY CMD] unhandled: {path}");
                    break;
            }
        }
        catch (Exception ex)
        {
            LogLine?.Invoke($"[RELAY CMD ERR] {ex.Message}");
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
    }
}
