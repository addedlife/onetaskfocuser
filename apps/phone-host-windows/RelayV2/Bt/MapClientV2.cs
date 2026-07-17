using System.Text;
using System.Xml.Linq;
using DeskPhone.RelayV2.Obex;
using Microsoft.Extensions.Logging;

namespace DeskPhone.RelayV2.Bt;

// MAP client — SMS/MMS listing, fetch, send, status, and MNS registration,
// all on one ObexEngine session held open (OBEX is strict request/response,
// so one SemaphoreSlim serializes operations; that constraint is protocol
// truth, not an implementation shortcut). Because every operation acquires
// the lock independently, long jobs like the history loader naturally
// interleave with sends instead of blocking them.
public sealed class MapClientV2 : IAsyncDisposable
{
    private static readonly byte[] MasTarget =
    {
        0xBB, 0x58, 0x2B, 0x40, 0x42, 0x0C, 0x11, 0xDB,
        0xB0, 0xDE, 0x08, 0x00, 0x20, 0x0C, 0x9A, 0x66,
    };
    private const string ListingType = "x-bt/MAP-msg-listing";

    private readonly ILogger _log;
    private readonly SemaphoreSlim _obexLock = new(1, 1);
    private RfcommConnection? _conn;
    private ObexEngine? _obex;
    // Goes (and stays) true when the handset refuses child-folder Name
    // listings from the telecom/msg park position — some firmware only serves
    // a listing for the CURRENT folder, so we fall back to SetPath walking
    // (production lesson from the legacy stack, b332 era).
    private bool _useLegacyNav;

    public bool IsConnected => _obex != null;
    public MapClientV2(ILogger log) => _log = log;
    /// Test seam: drive the client over a fixture engine, no Bluetooth.
    internal MapClientV2(ILogger log, ObexEngine engine) { _log = log; _obex = engine; }

    public async Task ConnectAsync(ulong bluetoothAddress, CancellationToken ct = default)
    {
        _conn = await RfcommConnection.ConnectAsync(bluetoothAddress, RfcommConnection.MapUuid, ct);
        _obex = new ObexEngine(_conn.Stream);
        // MASInstanceID 0 in the CONNECT app-params — part of the legacy
        // stack's production-proven MAP handshake; some handsets bind the
        // session to a degraded context without it.
        var code = await _obex.ConnectAsync(MasTarget, appParams: new byte[] { 0x0F, 0x01, 0x00 }, ct: ct);
        if (code != ObexResponse.Success)
            throw new ObexProtocolException($"MAP CONNECT failed: {code}");
        // Park at telecom/msg once; steady-state operations name the child
        // folder in the request instead of re-walking the tree every time.
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
            // The 0x30 filler body is required — a bodyless PUT is rejected
            // outright by some handsets (observed MediaTek behavior).
            var code = await obex.PutAsync("", new byte[] { 0x30 }, "x-bt/MAP-NotificationRegistration",
                appParams: new byte[] { 0x0E, 0x01, 0x01 }, ct: ct);
            if (code != ObexResponse.Success)
                _log.LogWarning("MNS registration -> {Code}", code);
            return true;
        }, ct);
    }

    /// List `count` messages of a folder (inbox/sent), newest first.
    /// `offset` pages deeper via the MAP ListStartOffset parameter.
    public Task<List<MapListingEntry>> ListFolderAsync(string folder, int count, int offset = 0, CancellationToken ct = default) =>
        WithObexAsync(async obex =>
        {
            // App params: MaxListCount (0x01, 2 bytes) + ListStartOffset (0x02, 2 bytes).
            var appParams = offset > 0
                ? new byte[]
                  {
                      0x01, 0x02, (byte)(count >> 8), (byte)(count & 0xFF),
                      0x02, 0x02, (byte)(offset >> 8), (byte)(offset & 0xFF),
                  }
                : new byte[] { 0x01, 0x02, (byte)(count >> 8), (byte)(count & 0xFF) };

            byte[] xml = Array.Empty<byte>();
            if (!_useLegacyNav)
            {
                var result = await obex.GetAsync(folder, ListingType, appParams, ct);
                if (result.Code != ObexResponse.Success)
                {
                    _log.LogInformation("MAP listing {Folder} -> {Code}", folder, result.Code);
                    return new List<MapListingEntry>();
                }
                xml = result.Body;
                if (xml.Length == 0)
                {
                    // An EMPTY folder still returns listing XML; zero bytes
                    // means the child-folder form was refused. Switch to
                    // SetPath navigation for the rest of the session.
                    _useLegacyNav = true;
                    _log.LogInformation("MAP child-folder listing refused for '{Folder}' — switching to SetPath navigation", folder);
                }
            }
            if (_useLegacyNav)
                xml = await ListViaSetPathAsync(obex, folder, appParams, ct);

            return ParseListing(xml, folder);
        }, ct);

    // Legacy navigation: walk into the folder, GET the current-folder listing,
    // walk back up so sends/status ops still see telecom/msg as the position.
    private async Task<byte[]> ListViaSetPathAsync(ObexEngine obex, string folder, byte[] appParams, CancellationToken ct)
    {
        await obex.SetPathAsync("", ct: ct);
        await obex.SetPathAsync("telecom", ct: ct);
        await obex.SetPathAsync("msg", ct: ct);
        await obex.SetPathAsync(folder, ct: ct);
        var result = await obex.GetAsync("", ListingType, appParams, ct);
        await obex.SetPathAsync("", up: true, ct: ct); // folder -> msg
        if (result.Code != ObexResponse.Success)
        {
            _log.LogInformation("MAP legacy listing {Folder} -> {Code}", folder, result.Code);
            return Array.Empty<byte>();
        }
        return result.Body;
    }

    /// Fetch one message body by handle. isMms=true asks the phone for the
    /// full MIME body including attachments; SMS stays body-only for speed.
    public Task<ParsedMessage> FetchAsync(string handle, bool isMms = false, CancellationToken ct = default) =>
        WithObexAsync(async obex =>
        {
            var appParams = isMms
                ? new byte[] { 0x0A, 0x01, 0x01 }                    // Attachment=on
                : new byte[] { 0x0A, 0x01, 0x00, 0x14, 0x01, 0x01 }; // body only, UTF-8
            var result = await obex.GetAsync(handle, "x-bt/message", appParams, ct);
            if (result.Code == ObexResponse.Success && result.Body.Length == 0)
            {
                // Some handsets only serve the body with NO app-params at all.
                result = await obex.GetAsync(handle, "x-bt/message", null, ct);
            }
            if (result.Code != ObexResponse.Success)
                throw new ObexProtocolException($"MAP fetch {handle} -> {result.Code}");
            return BMessageParser.Parse(result.Body);
        }, ct);

    /// Send a message. Text-only tries SMS_GSM → SMS_CDMA → MMS: NotAcceptable
    /// (0xC6) is the ONE code that means "wrong message type, try another";
    /// every other failure is definitive (production-learned, v1 semantics).
    /// With attachments it's MMS or nothing.
    public Task<bool> SendMessageAsync(string toNumber, string body, IReadOnlyList<MapAttachment>? attachments = null, CancellationToken ct = default) =>
        WithObexAsync(async obex =>
        {
            // PushMessage app-params (MAP §5.4.2): Transparent=0 (keep a copy
            // in Sent), Retry=1 (phone retries over cellular), Charset=UTF-8.
            var appParams = new byte[] { 0x0C, 0x01, 0x00, 0x0D, 0x01, 0x01, 0x14, 0x01, 0x01 };
            var hasAttachments = attachments is { Count: > 0 };
            var ladder = hasAttachments ? new[] { "MMS" } : new[] { "SMS_GSM", "SMS_CDMA", "MMS" };

            var last = ObexResponse.BadRequest;
            foreach (var msgType in ladder)
            {
                var payload = hasAttachments
                    ? BuildMmsBMessage(toNumber, body, attachments!)
                    : Encoding.UTF8.GetBytes(BuildSmsBMessage(toNumber, body, msgType));
                last = await obex.PutAsync("outbox", payload, "x-bt/message", appParams, ct);
                if (last == ObexResponse.Success) return true;
                _log.LogInformation("MAP send type={Type} -> {Code}", msgType, last);
                if (last != ObexResponse.NotAcceptable) break;
            }
            throw new ObexProtocolException($"MAP send failed: {last}");
        }, ct);

    /// Push a read/unread change back to the phone (MAP SetMessageStatus).
    public Task<bool> SetReadStatusAsync(string handle, bool isRead, CancellationToken ct = default) =>
        SetStatusAsync(handle, indicator: 0x00, on: isRead, ct);

    /// deletedStatus=yes moves the message into the phone's Deleted folder.
    public Task<bool> SetDeletedStatusAsync(string handle, bool isDeleted, CancellationToken ct = default) =>
        SetStatusAsync(handle, indicator: 0x01, on: isDeleted, ct);

    private Task<bool> SetStatusAsync(string handle, byte indicator, bool on, CancellationToken ct) =>
        WithObexAsync(async obex =>
        {
            var appParams = new byte[] { 0x17, 0x01, indicator, 0x18, 0x01, on ? (byte)1 : (byte)0 };
            var code = await obex.PutAsync(handle, new byte[] { 0x30 }, "x-bt/messageStatus", appParams, ct);
            if (code != ObexResponse.Success)
                _log.LogWarning("MAP status {Handle} indicator={Indicator} -> {Code}", handle, indicator, code);
            return code == ObexResponse.Success;
        }, ct);

    // BYTE-PARITY RULE: these two builders reproduce the legacy stack's
    // production-proven envelopes exactly. The first v2 draft "tidied" them
    // (added an empty N: line, dropped ENCODING:8BIT, STATUS:READ instead of
    // UNREAD) and the owner's handset ACCEPTED the push with 0xA0 but never
    // transmitted anything — a silent drop. Quirk knowledge is load-bearing;
    // do not clean these up again without a real-phone send test.
    internal static string BuildSmsBMessage(string toNumber, string body, string msgType = "SMS_GSM")
    {
        // LENGTH per MAP spec §5.2.2: byte count from "BEGIN:MSG\r\n" through
        // "END:MSG\r\n" inclusive.
        var msgBlock = "BEGIN:MSG\r\n" + body + "\r\n" + "END:MSG\r\n";
        return
            "BEGIN:BMSG\r\n" +
            "VERSION:1.0\r\n" +
            "STATUS:UNREAD\r\n" +
            $"TYPE:{msgType}\r\n" +
            "FOLDER:telecom/msg/outbox\r\n" +
            "BEGIN:BENV\r\n" +
            "BEGIN:VCARD\r\n" +       // recipient vCard sits INSIDE the BENV (0xC6 otherwise)
            "VERSION:2.1\r\n" +
            $"TEL:{toNumber}\r\n" +
            "END:VCARD\r\n" +
            "BEGIN:BBODY\r\n" +
            "CHARSET:UTF-8\r\n" +
            "ENCODING:8BIT\r\n" +
            $"LENGTH:{Encoding.UTF8.GetByteCount(msgBlock)}\r\n" +
            msgBlock +
            "END:BBODY\r\n" +
            "END:BENV\r\n" +
            "END:BMSG\r\n";
    }

    // MMS payload: a bMessage envelope whose MSG block is a MIME multipart
    // document — text part first, then each attachment base64-encoded.
    internal static byte[] BuildMmsBMessage(string toNumber, string text, IReadOnlyList<MapAttachment> attachments)
    {
        var boundary = $"deskphone-{Guid.NewGuid():N}";
        var mime = new StringBuilder();
        mime.Append($"Content-Type: multipart/mixed; boundary=\"{boundary}\"\r\n");
        mime.Append("MIME-Version: 1.0\r\n\r\n");

        if (!string.IsNullOrWhiteSpace(text))
        {
            mime.Append($"--{boundary}\r\n");
            mime.Append("Content-Type: text/plain; charset=utf-8\r\n");
            mime.Append("Content-Transfer-Encoding: 8bit\r\n\r\n");
            mime.Append(text);
            mime.Append("\r\n");
        }

        foreach (var attachment in attachments)
        {
            var name = attachment.FileName.Replace("\"", "");
            mime.Append($"--{boundary}\r\n");
            mime.Append($"Content-Type: {attachment.ContentType}; name=\"{name}\"\r\n");
            mime.Append("Content-Transfer-Encoding: base64\r\n");
            mime.Append($"Content-Disposition: attachment; filename=\"{name}\"\r\n\r\n");
            mime.Append(WrapBase64(Convert.ToBase64String(attachment.Data)));
            mime.Append("\r\n");
        }
        mime.Append($"--{boundary}--\r\n");

        var mimeBytes = Encoding.UTF8.GetBytes(mime.ToString());
        var msgBlockLength = mimeBytes.Length + Encoding.UTF8.GetByteCount("BEGIN:MSG\r\nEND:MSG\r\n");
        var prefix = Encoding.UTF8.GetBytes(
            "BEGIN:BMSG\r\nVERSION:1.0\r\nSTATUS:UNREAD\r\nTYPE:MMS\r\nFOLDER:telecom/msg/outbox\r\n" +
            "BEGIN:BENV\r\nBEGIN:VCARD\r\nVERSION:2.1\r\n" +
            $"TEL:{toNumber}\r\nEND:VCARD\r\n" +
            $"BEGIN:BBODY\r\nENCODING:8BIT\r\nLENGTH:{msgBlockLength}\r\n" +
            "BEGIN:MSG\r\n");
        var suffix = "\r\nEND:MSG\r\nEND:BBODY\r\nEND:BENV\r\nEND:BMSG\r\n"u8.ToArray();

        var payload = new byte[prefix.Length + mimeBytes.Length + suffix.Length];
        prefix.CopyTo(payload, 0);
        mimeBytes.CopyTo(payload, prefix.Length);
        suffix.CopyTo(payload, prefix.Length + mimeBytes.Length);
        return payload;
    }

    private static string WrapBase64(string value)
    {
        const int lineLength = 76;
        var sb = new StringBuilder(value.Length + (value.Length / lineLength + 1) * 2);
        for (var i = 0; i < value.Length; i += lineLength)
        {
            sb.Append(value, i, Math.Min(lineLength, value.Length - i));
            sb.Append("\r\n");
        }
        return sb.ToString();
    }

    internal static List<MapListingEntry> ParseListing(byte[] raw, string folder)
    {
        var list = new List<MapListingEntry>();
        var text = Encoding.UTF8.GetString(raw);
        if (text.TrimStart().Length == 0) return list;
        var isSentFolder = folder.Equals("sent", StringComparison.OrdinalIgnoreCase);
        try
        {
            // MAP listings are real XML — parse them as XML instead of the
            // legacy stack's regex/substring approach.
            var doc = XDocument.Parse(text);
            foreach (var msg in doc.Descendants("msg"))
            {
                var handle = (string?)msg.Attribute("handle") ?? "";
                if (handle.Length == 0) continue;
                var direction = (string?)msg.Attribute("direction") ?? "";
                list.Add(new MapListingEntry(
                    Handle: handle,
                    Sender: (string?)msg.Attribute("sender_addressing") ?? (string?)msg.Attribute("sender_name") ?? "",
                    Recipient: (string?)msg.Attribute("recipient_addressing") ?? (string?)msg.Attribute("recipient_name") ?? "",
                    Subject: (string?)msg.Attribute("subject") ?? "",
                    Time: VCardParser.ParseIrmcDateTime((string?)msg.Attribute("datetime") ?? ""),
                    IsRead: string.Equals((string?)msg.Attribute("read"), "yes", StringComparison.OrdinalIgnoreCase),
                    IsMms: string.Equals((string?)msg.Attribute("type"), "MMS", StringComparison.OrdinalIgnoreCase),
                    Incoming: !isSentFolder && !string.Equals(direction, "outgoing", StringComparison.OrdinalIgnoreCase)));
            }
        }
        catch (System.Xml.XmlException)
        {
            // Malformed listing XML from an exotic handset: return what we
            // have (nothing) rather than killing the sync loop.
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
