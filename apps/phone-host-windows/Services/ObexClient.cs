using System.IO;
using System.Text;

namespace DeskPhone.Services;

/// <summary>
/// Minimal OBEX client — just enough to support MAP inbox reads.
/// OBEX is a binary request/response protocol (like HTTP but over a serial stream).
/// Each packet has: 1-byte opcode, 2-byte length, then typed headers.
/// </summary>
internal class ObexClient : IDisposable
{
    private readonly Stream _stream;
    private readonly byte[]? _targetUuid;
    private uint _connectionId;
    public  uint ConnectionId => _connectionId;

    // OBEX header IDs
    private const byte HdrName      = 0x01;   // unicode string
    private const byte HdrType      = 0x42;   // byte seq
    private const byte HdrAppParams = 0x4C;   // byte seq
    private const byte HdrTarget    = 0x46;   // byte seq
    private const byte HdrConnId    = 0xCB;   // 4-byte fixed
    private const byte HdrBody      = 0x48;   // byte seq
    private const byte HdrEndBody   = 0x49;   // byte seq
    private const byte HdrWho       = 0x4A;   // byte seq (MNS response)

    // OBEX opcodes
    private const byte OpConnect    = 0x80;
    private const byte OpDisconnect = 0x81;
    private const byte OpGet        = 0x83;   // GET with Final bit
    private const byte OpSetPath    = 0x85;   // SETPATH with Final bit

    // Response codes
    private const byte ResOk        = 0xA0;   // 200 OK (final)
    private const byte ResContinue  = 0x90;   // 100 Continue

    // MAP OBEX target UUID: BB582B40-420C-11DB-B0DE-0800200C9A66
    private static readonly byte[] MapTargetUuid =
    {
        0xBB, 0x58, 0x2B, 0x40, 0x42, 0x0C, 0x11, 0xDB,
        0xB0, 0xDE, 0x08, 0x00, 0x20, 0x0C, 0x9A, 0x66
    };

    public ObexClient(Stream stream) : this(stream, MapTargetUuid) { }

    public ObexClient(Stream stream, byte[]? targetUuid)
    {
        _stream = stream;
        _targetUuid = targetUuid;
    }

    // ── CONNECT ──────────────────────────────────────────────────────────
    public async Task<bool> ConnectAsync(byte[]? appParams = null, CancellationToken ct = default)
    {
        var headers = new List<byte[]>();
        if (_targetUuid is { Length: > 0 })
            headers.Add(BuildByteSeqHeader(HdrTarget, _targetUuid));
        if (appParams is not null)
            headers.Add(BuildByteSeqHeader(HdrAppParams, appParams));

        int headersLen = headers.Sum(h => h.Length);
        // Packet: opcode(1) + length(2) + version(1) + flags(1) + maxPkt(2) + headers
        int total = 7 + headersLen;
        var pkt = new byte[total];
        pkt[0] = OpConnect;
        pkt[1] = (byte)(total >> 8);
        pkt[2] = (byte)(total & 0xFF);
        pkt[3] = 0x10;   // Revert to OBEX 1.0 for maximum handset compatibility
        pkt[4] = 0x00;   // flags
        pkt[5] = 0xFF;   // max packet size hi
        pkt[6] = 0xFF;   // max packet size lo
        
        int offset = 7;
        foreach (var h in headers) { h.CopyTo(pkt, offset); offset += h.Length; }

        await _stream.WriteAsync(pkt, ct);
        await _stream.FlushAsync(ct);

        var resp = await ReadPacketAsync(ct);
        if (resp.Length < 3 || resp[0] != ResOk) return false;

        // Fig 52 / MediaTek Lite: Detect if phone skipped the 4 bytes (Ver/Flags/MaxPkt).
        // Standard length is 7+ bytes. If 3-6 bytes, it's headers-only after the 3-byte prefix.
        int headerOffset = (resp.Length >= 7 && resp[3] >= 0x10) ? 7 : 3;
        
        ParseResponseHeaders(resp, headerOffset, out _connectionId, out _);
        return true;
    }

    // ── SETPATH ───────────────────────────────────────────────────────────
    public async Task<bool> SetPathAsync(string folderName, bool backup = false,
                                          CancellationToken ct = default)
    {
        var headers = new List<byte[]>();
        if (_connectionId != 0)
            headers.Add(Build4ByteHeader(HdrConnId, _connectionId));
        // Always include Name header — empty string navigates to root on most servers
        headers.Add(BuildUnicodeHeader(HdrName, folderName));

        byte flags = backup ? (byte)0x01 : (byte)0x00;

        int headersLen = headers.Sum(h => h.Length);
        int total      = 5 + headersLen; // opcode(1)+len(2)+flags(1)+constants(1)

        var pkt = new byte[total];
        pkt[0] = OpSetPath;
        pkt[1] = (byte)(total >> 8);
        pkt[2] = (byte)(total & 0xFF);
        pkt[3] = flags;
        pkt[4] = 0x00;  // constants

        int offset = 5;
        foreach (var h in headers) { h.CopyTo(pkt, offset); offset += h.Length; }

        await _stream.WriteAsync(pkt, ct);
        await _stream.FlushAsync(ct);

        var resp = await ReadPacketAsync(ct);
        return resp.Length > 0 && resp[0] == ResOk;
    }

    // ── GET (reassembles chunked responses) ───────────────────────────────
    public async Task<byte[]> GetAsync(string mimeType, string? name,
                                        byte[]? appParams = null,
                                        CancellationToken ct = default)
    {
        var result = await GetResultAsync(mimeType, name, appParams, ct);
        return result.Body;
    }

    public async Task<ObexGetResult> GetResultAsync(string mimeType, string? name,
                                                    byte[]? appParams = null,
                                                    CancellationToken ct = default)
    {
        var headers = new List<byte[]>();
        if (_connectionId != 0)
            headers.Add(Build4ByteHeader(HdrConnId, _connectionId));

        var rawBytes  = Encoding.ASCII.GetBytes(mimeType.TrimEnd('\0'));
        var typeBytes = new byte[rawBytes.Length + 1];
        Array.Copy(rawBytes, typeBytes, rawBytes.Length);
        typeBytes[typeBytes.Length - 1] = 0x00; 
        headers.Add(BuildByteSeqHeader(HdrType, typeBytes));
        if (name is not null)
            headers.Add(BuildUnicodeHeader(HdrName, name));
        if (appParams is not null)
            headers.Add(BuildByteSeqHeader(HdrAppParams, appParams));

        int headersLen = headers.Sum(h => h.Length);
        int total      = 3 + headersLen;
        var pkt        = new byte[total];
        pkt[0] = OpGet;
        pkt[1] = (byte)(total >> 8);
        pkt[2] = (byte)(total & 0xFF);
        int offset = 3;
        foreach (var h in headers) { h.CopyTo(pkt, offset); offset += h.Length; }

        await _stream.WriteAsync(pkt, ct);
        await _stream.FlushAsync(ct);

        // Reassemble body across multiple Continue responses
        using var body = new MemoryStream();
        byte responseCode = 0x00;
        while (true)
        {
            var resp = await ReadPacketAsync(ct);
            if (resp.Length == 0) break;

            responseCode = resp[0];
            ParseResponseHeaders(resp, 3, out _, out var chunk);
            if (chunk is { Length: > 0 }) body.Write(chunk);

            if (resp[0] == ResOk)      break;    // final packet
            if (resp[0] != ResContinue) break;   // unexpected code — stop

            // Send empty GET to continue
            var cont = new byte[] { 0x83, 0x00, 0x03 };
            await _stream.WriteAsync(cont, ct);
            await _stream.FlushAsync(ct);
        }

        return new ObexGetResult(responseCode, body.ToArray());
    }

    // ── PUT (send an object to the phone — used for MAP message send) ────
    // OBEX opcode 0x82 = PUT with Final bit set.
    // Returns the raw OBEX response code so callers can log exactly what the phone said.
    // 0xA0 = OK, 0x90 = Continue (handled internally), anything else = failure.
    public async Task<byte> PutAsync(string mimeType, string? name, byte[]? body,
                                      byte[]? appParams = null,
                                      bool includeTarget = false,
                                      CancellationToken ct = default)
    {
        var headers = new List<byte[]>();
        if (_connectionId != 0)
            headers.Add(Build4ByteHeader(HdrConnId, _connectionId));

        if (includeTarget && _targetUuid is { Length: > 0 })
            headers.Add(BuildByteSeqHeader(HdrTarget, _targetUuid));
            

        // Only include Name header if caller provides one
        if (name is not null)
            headers.Add(BuildUnicodeHeader(HdrName, name));

        // Ensure Type (MIME) is null-terminated ASCII. 
        // Hex-dump analysis confirmed previous string-concatenation was being trimmed.
        var rawBytes  = Encoding.ASCII.GetBytes(mimeType.TrimEnd('\0'));
        var typeBytes = new byte[rawBytes.Length + 1];
        Array.Copy(rawBytes, typeBytes, rawBytes.Length);
        typeBytes[typeBytes.Length - 1] = 0x00; // Force physical null byte
        headers.Add(BuildByteSeqHeader(HdrType, typeBytes));

        if (appParams is not null)
            headers.Add(BuildByteSeqHeader(HdrAppParams, appParams));
        
        // Final Body or EndBody header.
        // For MAP registration (no-body), some phones (MediaTek) reject the request 
        // with 0xC0 if an empty EndBody header is present. We only add it if there
        // is actual data to send.
        if (body is { Length: > 0 })
        {
            headers.Add(BuildByteSeqHeader(HdrEndBody, body));
        }

        int headersLen = headers.Sum(h => h.Length);
        int total      = 3 + headersLen;
        var pkt        = new byte[total];
        pkt[0] = 0x82;   // PUT + Final bit
        pkt[1] = (byte)(total >> 8);
        pkt[2] = (byte)(total & 0xFF);

        int offset = 3;
        foreach (var h in headers) { h.CopyTo(pkt, offset); offset += h.Length; }

        await _stream.WriteAsync(pkt, ct);
        await _stream.FlushAsync(ct);
        
        var hex = string.Join(" ", pkt.Select(b => b.ToString("X2")));
        Console.WriteLine($"[OBEX DEBUG] PUT PACKET: {hex}");

        while (true)
        {
            var resp = await ReadPacketAsync(ct);
            if (resp.Length == 0) return 0x00;
            if (resp[0] == ResOk) return ResOk;
            if (resp[0] == ResContinue)
            {
                var cont = new byte[] { 0x82, 0x00, 0x03 };
                await _stream.WriteAsync(cont, ct);
                await _stream.FlushAsync(ct);
                continue;
            }
            return resp[0];
        }
    }

    // ── DISCONNECT ────────────────────────────────────────────────────────
    public async Task DisconnectAsync(CancellationToken ct = default)
    {
        var headers = _connectionId != 0
            ? Build4ByteHeader(HdrConnId, _connectionId)
            : Array.Empty<byte>();

        int total = 3 + headers.Length;
        var pkt   = new byte[total];
        pkt[0] = OpDisconnect;
        pkt[1] = (byte)(total >> 8);
        pkt[2] = (byte)(total & 0xFF);
        headers.CopyTo(pkt, 3);

        await _stream.WriteAsync(pkt, ct);
        await _stream.FlushAsync(ct);
        await ReadPacketAsync(ct);   // read and discard OK
    }

    // ── Packet reader (length-prefixed) ───────────────────────────────────
    private async Task<byte[]> ReadPacketAsync(CancellationToken ct)
    {
        var hdr = new byte[3];
        int read = await ReadExactAsync(hdr, 0, 3, ct);
        if (read < 3) return Array.Empty<byte>();

        int total   = (hdr[1] << 8) | hdr[2];
        int bodyLen = total - 3;

        var pkt  = new byte[total];
        hdr.CopyTo(pkt, 0);
        if (bodyLen > 0)
            await ReadExactAsync(pkt, 3, bodyLen, ct);

        var hex = string.Join(" ", pkt.Select(b => b.ToString("X2")));
        Console.WriteLine($"[OBEX DEBUG] RECV PACKET: {hex}");

        return pkt;
    }

    private async Task<int> ReadExactAsync(byte[] buf, int offset, int count,
                                            CancellationToken ct)
    {
        int total = 0;
        while (total < count)
        {
            int n = await _stream.ReadAsync(buf.AsMemory(offset + total, count - total), ct);
            if (n == 0) break;
            total += n;
        }
        return total;
    }

    // ── Response header parser ─────────────────────────────────────────────
    private static void ParseResponseHeaders(byte[] pkt, int start,
                                              out uint connId, out byte[]? body)
    {
        connId = 0;
        body   = null;

        int i = start;
        while (i < pkt.Length)
        {
            byte id = pkt[i];
            
            // OBEX header ID bitmask (Top two bits):
            // 00: Unicode Null-Terminated (variable length)
            // 01: Byte Sequence (variable length)
            // 10: 1-Byte (fixed length)
            // 11: 4-Byte (fixed length)
            byte type = (byte)(id >> 6);

            if (type == 0b11) // 4-byte fixed (e.g. 0xCB Connection ID)
            {
                if (id == HdrConnId && i + 4 < pkt.Length)
                {
                    connId = ((uint)pkt[i+1] << 24) | ((uint)pkt[i+2] << 16)
                           | ((uint)pkt[i+3] <<  8) |  pkt[i+4];
                }
                i += 5;
            }
            else if (type == 0b10) // 1-byte fixed
            {
                i += 2;
            }
            else // Variable length (00 or 01)
            {
                if (i + 2 >= pkt.Length) break;
                int len = (pkt[i + 1] << 8) | pkt[i + 2];
                if (len < 3 || i + len > pkt.Length) break;

                if ((id == HdrBody || id == HdrEndBody))
                    body = pkt[(i + 3)..(i + len)];

                i += len;
            }
        }
    }

    // ── Header builders ───────────────────────────────────────────────────
    private static byte[] BuildByteSeqHeader(byte id, byte[] data)
    {
        int len = 3 + data.Length;
        var buf = new byte[len];
        buf[0] = id;
        buf[1] = (byte)(len >> 8);
        buf[2] = (byte)(len & 0xFF);
        data.CopyTo(buf, 3);
        return buf;
    }

    private static byte[] BuildUnicodeHeader(byte id, string text)
    {
        // OBEX unicode headers: UTF-16BE, null-terminated
        var encoded = Encoding.BigEndianUnicode.GetBytes(text + "\0");
        return BuildByteSeqHeader(id, encoded);
    }

    private static byte[] Build4ByteHeader(byte id, uint value)
    {
        return new byte[]
        {
            id,
            (byte)(value >> 24), (byte)(value >> 16),
            (byte)(value >>  8), (byte)(value & 0xFF)
        };
    }

    public void Dispose() { /* stream owned by caller */ }
}

internal readonly record struct ObexGetResult(byte ResponseCode, byte[] Body);
