using InTheHand.Net;
using InTheHand.Net.Bluetooth;
using InTheHand.Net.Sockets;
using System.Text;
using System.Xml;

namespace DeskPhone.Services;

/// <summary>
/// MAP Message Notification Service (MNS) — UUID 0x1133.
///
/// After the PC connects to the phone's MAP server (MAS, UUID 0x1132), the phone
/// needs somewhere to push real-time event reports (new message, delivery status, etc.).
/// This class runs an RFCOMM server that the phone connects back to and sends OBEX PUT
/// requests containing MAP event XML documents.
///
/// Flow:
///   1. Start() — opens BluetoothListener on UUID 0x1133
///   2. MapService.RegisterForNotificationsAsync() — sends SetNotificationRegistration
///      to the phone's MAS, telling it to connect to our MNS and send events
///   3. Phone connects → we accept → serve OBEX CONNECT/PUT/DISCONNECT
///   4. Each PUT body is a MAP event report XML → parse → fire NewMessage / Delivered
///
/// Event report XML example (MAP spec §3.1.6):
///   &lt;MAP-event-report version="1.0"&gt;
///     &lt;event type="NewMessage" handle="0001" folder="INBOX" msg_type="SMS_GSM"/&gt;
///   &lt;/MAP-event-report&gt;
/// </summary>
public sealed class MapNotificationService : IAsyncDisposable
{
    // MAP MNS UUID — the phone dials this to deliver event reports
    public static readonly Guid MnsUuid = new("00001133-0000-1000-8000-00805F9B34FB");

    // OBEX MNS target UUID used in CONNECT header (MAP spec §6.4)
    private static readonly byte[] MnsObexTarget =
    {
        0xBB, 0x58, 0x2B, 0x41, 0x42, 0x0C, 0x11, 0xDB,
        0xB0, 0xDE, 0x08, 0x00, 0x20, 0x0C, 0x9A, 0x66
    };

    // OBEX header IDs (same encoding as ObexClient)
    private const byte HdrName      = 0x01;
    private const byte HdrType      = 0x42;
    private const byte HdrConnId    = 0xCB;
    private const byte HdrBody      = 0x48;
    private const byte HdrEndBody   = 0x49;
    private const byte HdrWho       = 0x4A;   // used in CONNECT response

    // ── Events ────────────────────────────────────────────────────────────
    /// <summary>Fired when the phone reports a new incoming SMS/MMS.</summary>
    public event Action<string /*handle*/, string /*folder*/>? NewMessage;
    /// <summary>Fired when the phone confirms delivery of a sent message.</summary>
    public event Action<string /*handle*/>?                    MessageDelivered;
    /// <summary>Fired when the phone reports a sent message was read by the recipient.</summary>
    public event Action<string /*handle*/>?                    MessageRead;
    /// <summary>Log line for the debug panel.</summary>
    public event Action<string>?                               LogLine;

    public bool IsRunning { get; private set; }

    private BluetoothListener?          _listener;
    private CancellationTokenSource     _cts = new();
    private Task?                       _serverTask;

    // ── Start ─────────────────────────────────────────────────────────────
    public void Start()
    {
        if (IsRunning) return;

        try
        {
            // Standard MNS listener using the 32feet UUID mapping
            _listener = new BluetoothListener(MnsUuid);
            _listener.ServiceName = "Map Message Notification Service";
            _listener.Start();
            
            IsRunning = true;


            _cts = new CancellationTokenSource();
            _serverTask = AcceptLoopAsync(_cts.Token);

            LogLine?.Invoke("[MNS] RFCOMM server started with MAP 1.2 Profile Descriptor");
        }
        catch (System.Net.Sockets.SocketException ex) when (ex.NativeErrorCode == 10048)
        {
            LogLine?.Invoke("[MNS] ERROR: Port 0x1133 already in use. Please close Windows 'Phone Link', 'Intel Unison', or other DeskPhone instances.");
        }
        catch (Exception ex)
        {
            LogLine?.Invoke($"[MNS] Failed to start: {ex.Message}");
        }
    }

    // ── Stop ──────────────────────────────────────────────────────────────
    public async ValueTask DisposeAsync()
    {
        _cts.Cancel();
        _listener?.Stop();
        IsRunning = false;
        if (_serverTask is not null)
        {
            try { await _serverTask.WaitAsync(TimeSpan.FromSeconds(3)); }
            catch { }
        }
    }

    // ── Accept loop: waits for the phone to connect ───────────────────────
    private async Task AcceptLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                // AcceptBluetoothClient is blocking — run on a thread-pool thread
                var client = await Task.Run(() => _listener!.AcceptBluetoothClient(), ct);
                LogLine?.Invoke("[MNS] Phone connected — serving OBEX");

                // Handle each phone connection on its own task so Accept can loop
                _ = Task.Run(() => ServeClientAsync(client, ct), ct);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                if (!ct.IsCancellationRequested)
                    LogLine?.Invoke($"[MNS] Accept error: {ex.Message}");
                await Task.Delay(2000, ct).ConfigureAwait(false);
            }
        }
    }

    // ── Serve a single phone connection ───────────────────────────────────
    // The phone acts as an OBEX client; we act as the server.
    // Expected sequence: CONNECT → PUT (event) × N → DISCONNECT
    private async Task ServeClientAsync(BluetoothClient client, CancellationToken ct)
    {
        using var _ = client;
        var stream  = client.GetStream();
        uint connId = 1;   // connection-ID we assign in our CONNECT response

        try
        {
            while (!ct.IsCancellationRequested)
            {
                var pkt = await ReadPacketAsync(stream, ct);
                if (pkt.Length == 0) break;

                byte opcode = pkt[0];

                // ── OBEX CONNECT (0x80) ──────────────────────────────────
                if (opcode == 0x80)
                {
                    // Respond with OK (0xA0), echo back version/flags, send ConnectionID
                    var connIdHeader = Build4ByteHeader  (HdrConnId, connId);

                    int total = 7 + connIdHeader.Length;
                    var resp  = new byte[total];
                    resp[0]   = 0xA0;   // OK
                    resp[1]   = (byte)(total >> 8);
                    resp[2]   = (byte)(total & 0xFF);
                    resp[3]   = 0x10;   // OBEX 1.0
                    resp[4]   = 0x00;   // flags
                    resp[5]   = 0xFF;   // max packet hi
                    resp[6]   = 0xFF;   // max packet lo
                    connIdHeader.CopyTo(resp, 7);

                    await stream.WriteAsync(resp, ct);
                    await stream.FlushAsync(ct);
                    LogLine?.Invoke("[MNS] OBEX CONNECT accepted");
                }

                // ── OBEX PUT (0x82 or 0x02) — event report ───────────────
                else if (opcode is 0x82 or 0x02)
                {
                    // Accumulate body — could span multiple Continue packets
                    using var bodyStream = new System.IO.MemoryStream();
                    bool finalPkt = (opcode & 0x80) != 0;

                    ExtractBody(pkt, bodyStream);

                    // If not final, send Continue and read more chunks
                    while (!finalPkt)
                    {
                        var cont = new byte[] { 0x90, 0x00, 0x03 };   // Continue
                        await stream.WriteAsync(cont, ct);
                        await stream.FlushAsync(ct);

                        pkt = await ReadPacketAsync(stream, ct);
                        if (pkt.Length == 0) goto done;
                        finalPkt = (pkt[0] & 0x80) != 0;
                        ExtractBody(pkt, bodyStream);
                    }

                    // Send OK
                    var ok = new byte[] { 0xA0, 0x00, 0x03 };
                    await stream.WriteAsync(ok, ct);
                    await stream.FlushAsync(ct);

                    // Parse MAP event report
                    var xml = Encoding.UTF8.GetString(bodyStream.ToArray());
                    LogLine?.Invoke($"[MNS] Event: {xml.Replace("\n","↵").Replace("\r","")}");
                    ParseEventReport(xml);
                }

                // ── OBEX DISCONNECT (0x81) ───────────────────────────────
                else if (opcode == 0x81)
                {
                    var ok = new byte[] { 0xA0, 0x00, 0x03 };
                    await stream.WriteAsync(ok, ct);
                    await stream.FlushAsync(ct);
                    LogLine?.Invoke("[MNS] Phone disconnected gracefully");
                    break;
                }
                else
                {
                    // Unknown opcode — send Service Unavailable and bail
                    LogLine?.Invoke($"[MNS] Unknown opcode 0x{opcode:X2}");
                    var err = new byte[] { 0xD3, 0x00, 0x03 };
                    await stream.WriteAsync(err, ct);
                    await stream.FlushAsync(ct);
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { LogLine?.Invoke($"[MNS] Client error: {ex.Message}"); }
        done: ;
    }

    // ── MAP event-report XML parser ───────────────────────────────────────
    private void ParseEventReport(string xml)
    {
        // Phone occasionally sends a zero-byte (empty) MAP event notification —
        // this is a known quirk on some Android firmware. Guard here so we never
        // pass an empty string to XmlDocument.LoadXml, which throws
        // "Root element is missing" and pollutes the debug log.
        if (string.IsNullOrWhiteSpace(xml))
        {
            LogLine?.Invoke("[MNS] Event body empty — phone sent empty notification, ignoring");
            return;
        }

        try
        {
            var doc   = new XmlDocument();
            doc.LoadXml(xml.Trim());

            // Handle both plain <MAP-event-report> and namespace-prefixed variants
            var eventNode =
                doc.SelectSingleNode("//*[local-name()='event']");

            if (eventNode is null)
            {
                LogLine?.Invoke("[MNS] No <event> node found in report");
                return;
            }

            var type   = eventNode.Attributes?["type"]?.Value   ?? "";
            var handle = eventNode.Attributes?["handle"]?.Value ?? "";
            var folder = eventNode.Attributes?["folder"]?.Value ?? "";

            LogLine?.Invoke($"[MNS] type={type} handle={handle} folder={folder}");

            switch (type.ToLowerInvariant())
            {
                case "newmessage":
                    NewMessage?.Invoke(handle, folder);
                    break;

                case "deliverycomplete":
                case "deliverysuccess":
                    MessageDelivered?.Invoke(handle);
                    break;

                case "messageread":
                    MessageRead?.Invoke(handle);
                    break;

                // "SendingSuccess", "SendingFailure", "MemoryAvailable", etc. — ignore for now
                default:
                    LogLine?.Invoke($"[MNS] Event type '{type}' not handled");
                    break;
            }
        }
        catch (Exception ex)
        {
            LogLine?.Invoke($"[MNS] Event parse error: {ex.Message}");
        }
    }

    // ── OBEX packet reader (same logic as ObexClient) ─────────────────────
    private static async Task<byte[]> ReadPacketAsync(System.IO.Stream stream,
                                                       CancellationToken ct)
    {
        var hdr  = new byte[3];
        int read = await ReadExactAsync(stream, hdr, 0, 3, ct);
        if (read < 3) return Array.Empty<byte>();

        int total   = (hdr[1] << 8) | hdr[2];
        int bodyLen = total - 3;

        var pkt = new byte[total];
        hdr.CopyTo(pkt, 0);
        if (bodyLen > 0) await ReadExactAsync(stream, pkt, 3, bodyLen, ct);
        return pkt;
    }

    private static async Task<int> ReadExactAsync(System.IO.Stream stream,
        byte[] buf, int offset, int count, CancellationToken ct)
    {
        int total = 0;
        while (total < count)
        {
            int n = await stream.ReadAsync(buf.AsMemory(offset + total, count - total), ct);
            if (n == 0) break;
            total += n;
        }
        return total;
    }

    // ── Extract Body/EndBody bytes from a packet ──────────────────────────
    private static void ExtractBody(byte[] pkt, System.IO.MemoryStream dest)
    {
        int i = 3;
        while (i + 2 < pkt.Length)
        {
            byte  hdrId = pkt[i];
            int   hdrLen = (pkt[i + 1] << 8) | pkt[i + 2];
            if (hdrLen < 3 || i + hdrLen > pkt.Length) break;

            if (hdrId is HdrBody or HdrEndBody)
                dest.Write(pkt, i + 3, hdrLen - 3);

            i += hdrLen;
        }
    }

    // ── OBEX header builders ──────────────────────────────────────────────
    private static byte[] Build4ByteHeader(byte id, uint value)
    {
        // OBEX 4-byte fixed headers (0xC0-0xFF) MUST NOT have a 2-byte length field.
        // They are exactly 5 bytes: 1 byte ID + 4 bytes value.
        return new byte[]
        {
            id,
            (byte)(value >> 24), (byte)(value >> 16),
            (byte)(value >> 8),  (byte)(value & 0xFF)
        };
    }

    private static byte[] BuildByteSeqHeader(byte id, byte[] data)
    {
        int len  = 3 + data.Length;
        var hdr  = new byte[len];
        hdr[0]   = id;
        hdr[1]   = (byte)(len >> 8);
        hdr[2]   = (byte)(len & 0xFF);
        data.CopyTo(hdr, 3);
        return hdr;
    }
}
