using System.Text;
using System.Xml.Linq;
using DeskPhone.RelayV2.Obex;
using Microsoft.Extensions.Logging;

namespace DeskPhone.RelayV2.Bt;

public sealed record MapMessage(string Handle, string Sender, string Body, DateTimeOffset? Time, bool IsRead, bool Incoming);

// MAP client — SMS/MMS listing, fetch, send, and MNS registration, all on
// one ObexEngine session held open (OBEX is strict request/response, so one
// SemaphoreSlim serializes operations; that constraint is protocol truth,
// not an implementation shortcut).
public sealed class MapClientV2 : IAsyncDisposable
{
    private static readonly byte[] MasTarget =
    {
        0xBB, 0x58, 0x2B, 0x40, 0x42, 0x0C, 0x11, 0xDB,
        0xB0, 0xDE, 0x08, 0x00, 0x20, 0x0C, 0x9A, 0x66,
    };

    private readonly ILogger _log;
    private readonly SemaphoreSlim _obexLock = new(1, 1);
    private RfcommConnection? _conn;
    private ObexEngine? _obex;

    public bool IsConnected => _obex != null;
    public MapClientV2(ILogger log) => _log = log;

    public async Task ConnectAsync(ulong bluetoothAddress, CancellationToken ct = default)
    {
        _conn = await RfcommConnection.ConnectAsync(bluetoothAddress, RfcommConnection.MapUuid, ct);
        _obex = new ObexEngine(_conn.Stream);
        var code = await _obex.ConnectAsync(MasTarget, ct);
        if (code != ObexResponse.Success)
            throw new ObexProtocolException($"MAP CONNECT failed: {code}");
        await _obex.SetPathAsync("", ct: ct);        // root
        await _obex.SetPathAsync("telecom", ct: ct);
        await _obex.SetPathAsync("msg", ct: ct);
    }

    /// Ask the phone to push new-message notifications to our MNS server.
    public async Task RegisterForNotificationsAsync(CancellationToken ct = default)
    {
        await WithObexAsync(async obex =>
        {
            // SetNotificationRegistration: app-param id 0x0E, 1 byte, value 1.
            var code = await obex.PutAsync("", new byte[] { 0x30 }, "x-bt/MAP-NotificationRegistration",
                appParams: new byte[] { 0x0E, 0x01, 0x01 }, ct: ct);
            if (code != ObexResponse.Success)
                _log.LogWarning("MNS registration -> {Code}", code);
            return true;
        }, ct);
    }

    /// List the newest `count` messages in the inbox.
    public Task<List<MapMessage>> ListInboxAsync(int count, CancellationToken ct = default) =>
        WithObexAsync(async obex =>
        {
            // MaxListCount app-param (id 0x01, 2 bytes).
            var appParams = new byte[] { 0x01, 0x02, (byte)(count >> 8), (byte)(count & 0xFF) };
            var result = await obex.GetAsync("inbox", "x-bt/MAP-msg-listing", appParams, ct);
            if (result.Code != ObexResponse.Success)
            {
                _log.LogInformation("MAP listing -> {Code}", result.Code);
                return new List<MapMessage>();
            }
            return ParseListing(result.Body);
        }, ct);

    /// Fetch one message body by handle.
    public Task<ParsedMessage> FetchAsync(string handle, CancellationToken ct = default) =>
        WithObexAsync(async obex =>
        {
            // Attachment=off (0x0A), Charset=UTF-8 (0x14 value 1).
            var appParams = new byte[] { 0x0A, 0x01, 0x00, 0x14, 0x01, 0x01 };
            var result = await obex.GetAsync(handle, "x-bt/message", appParams, ct);
            if (result.Code != ObexResponse.Success)
                throw new ObexProtocolException($"MAP fetch {handle} -> {result.Code}");
            return BMessageParser.Parse(result.Body);
        }, ct);

    /// Send an SMS. Builds a standard bMessage envelope; PUT to outbox.
    public Task SendSmsAsync(string toNumber, string body, CancellationToken ct = default) =>
        WithObexAsync(async obex =>
        {
            var bmsg = BuildSmsBMessage(toNumber, body);
            // Charset app-param: UTF-8.
            var code = await obex.PutAsync("outbox", Encoding.UTF8.GetBytes(bmsg), "x-bt/message",
                appParams: new byte[] { 0x14, 0x01, 0x01 }, ct: ct);
            if (code != ObexResponse.Success)
                throw new ObexProtocolException($"MAP send -> {code}");
            return true;
        }, ct);

    internal static string BuildSmsBMessage(string toNumber, string body)
    {
        var sb = new StringBuilder();
        sb.Append("BEGIN:BMSG\r\nVERSION:1.0\r\nSTATUS:READ\r\nTYPE:SMS_GSM\r\nFOLDER:telecom/msg/outbox\r\n");
        sb.Append("BEGIN:BENV\r\nBEGIN:VCARD\r\nVERSION:2.1\r\nN:\r\n");
        sb.Append($"TEL:{toNumber}\r\nEND:VCARD\r\n");
        var payload = body.Replace("\r\n", "\n").Replace("\n", "\r\n");
        // LENGTH counts the BEGIN:MSG..END:MSG block per spec; vendors accept
        // small drift but the field must exist.
        var msgBlock = $"BEGIN:MSG\r\n{payload}\r\nEND:MSG\r\n";
        sb.Append($"BEGIN:BBODY\r\nCHARSET:UTF-8\r\nLENGTH:{Encoding.UTF8.GetByteCount(msgBlock)}\r\n");
        sb.Append(msgBlock);
        sb.Append("END:BBODY\r\nEND:BENV\r\nEND:BMSG\r\n");
        return sb.ToString();
    }

    internal static List<MapMessage> ParseListing(byte[] raw)
    {
        var list = new List<MapMessage>();
        var text = Encoding.UTF8.GetString(raw);
        if (text.TrimStart().Length == 0) return list;
        // MAP listings are real XML — parse them as XML instead of the legacy
        // stack's regex/substring approach.
        var doc = XDocument.Parse(text);
        foreach (var msg in doc.Descendants("msg"))
        {
            list.Add(new MapMessage(
                Handle: (string?)msg.Attribute("handle") ?? "",
                Sender: (string?)msg.Attribute("sender_addressing") ?? (string?)msg.Attribute("sender_name") ?? "",
                Body: (string?)msg.Attribute("subject") ?? "",
                Time: VCardParser.ParseIrmcDateTime((string?)msg.Attribute("datetime") ?? ""),
                IsRead: string.Equals((string?)msg.Attribute("read"), "yes", StringComparison.OrdinalIgnoreCase),
                Incoming: !string.Equals((string?)msg.Attribute("direction"), "outgoing", StringComparison.OrdinalIgnoreCase)));
        }
        return list;
    }

    private async Task<T> WithObexAsync<T>(Func<ObexEngine, Task<T>> op, CancellationToken ct)
    {
        var obex = _obex ?? throw new InvalidOperationException("MAP not connected");
        await _obexLock.WaitAsync(ct);
        try { return await op(obex); }
        finally { _obexLock.Release(); }
    }

    public async ValueTask DisposeAsync()
    {
        if (_obex != null)
        {
            try { await _obex.DisconnectAsync(); } catch { }
            _obex = null;
        }
        if (_conn != null) await _conn.DisposeAsync();
    }
}
