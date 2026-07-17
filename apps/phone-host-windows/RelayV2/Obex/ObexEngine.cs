using System.Buffers.Binary;

namespace DeskPhone.RelayV2.Obex;

// The single OBEX engine, used by BOTH roles: client (PBAP/MAP GET/PUT) and
// server (the MNS listener the phone connects back into). The legacy stack
// implemented the protocol twice from scratch — ObexClient.cs and the inline
// server in MapNotificationService.cs — with no shared code; a framing bug
// fixed in one never reached the other. This engine works over any Stream,
// so unit tests drive it with MemoryStreams built from captured fixtures.
public sealed class ObexEngine
{
    private readonly Stream _stream;
    private uint? _connectionId;
    // Peer's advertised max packet size from CONNECT negotiation. The legacy
    // client hardcoded 0xFFFF and never read the responder's value; we honor
    // what the peer actually advertises (floored to the spec minimum 255).
    public int PeerMaxPacket { get; private set; } = 0xFFFF;

    public ObexEngine(Stream stream) => _stream = stream;

    // ── Wire I/O ─────────────────────────────────────────────────────────────

    public async Task<ObexPacket> ReadPacketAsync(int fixedFieldCount = 0, bool tolerateShortConnect = false, CancellationToken ct = default)
    {
        var raw = await ReadRawPacketAsync(ct);
        return ObexPacket.Parse(raw, fixedFieldCount, tolerateShortConnect);
    }

    private async Task<byte[]> ReadRawPacketAsync(CancellationToken ct)
    {
        var prefix = await ReadExactAsync(3, ct);
        var total = BinaryPrimitives.ReadUInt16BigEndian(prefix.AsSpan(1));
        if (total < 3 || total > ObexLimits.MaxPacketBytes)
            throw new ObexProtocolException($"inbound packet declares invalid length {total}");
        var rest = total > 3 ? await ReadExactAsync(total - 3, ct) : Array.Empty<byte>();
        var raw = new byte[total];
        prefix.CopyTo(raw, 0);
        rest.CopyTo(raw, 3);
        return raw;
    }

    public async Task WritePacketAsync(ObexPacket packet, CancellationToken ct = default)
    {
        var bytes = packet.Serialize();
        await _stream.WriteAsync(bytes, ct);
        await _stream.FlushAsync(ct);
    }

    private async Task<byte[]> ReadExactAsync(int count, CancellationToken ct)
    {
        var buf = new byte[count];
        var read = 0;
        while (read < count)
        {
            var n = await _stream.ReadAsync(buf.AsMemory(read, count - read), ct);
            if (n == 0) throw new EndOfStreamException($"peer closed mid-packet ({read}/{count} bytes)");
            read += n;
        }
        return buf;
    }

    // ── Client role ──────────────────────────────────────────────────────────

    /// OBEX CONNECT with optional Target UUID and app params (MAP passes the
    /// MASInstanceID here). Parses the peer's advertised max packet size and
    /// Who/ConnectionId headers. Tolerates the MediaTek short response (no
    /// version/flags/maxPacket fields).
    public async Task<ObexResponse> ConnectAsync(byte[]? targetUuid = null, byte[]? appParams = null, CancellationToken ct = default)
    {
        var req = new ObexPacket
        {
            Code = (byte)ObexOpcode.Connect,
            FixedFields = new byte[] { 0x10, 0x00, 0xFF, 0xFF }, // v1.0, no flags, our max 65535
        };
        if (targetUuid != null) req.AddByteSeq(ObexHeaderId.Target, targetUuid);
        if (appParams != null) req.AddByteSeq(ObexHeaderId.AppParams, appParams);
        await WritePacketAsync(req, ct);

        var resp = await ReadPacketAsync(fixedFieldCount: 4, tolerateShortConnect: true, ct: ct);
        if (resp.FixedFields.Length == 4)
        {
            var peerMax = BinaryPrimitives.ReadUInt16BigEndian(resp.FixedFields.AsSpan(2));
            if (peerMax >= 255) PeerMaxPacket = peerMax;
        }
        var connId = resp.FindHeader(ObexHeaderId.ConnectionId);
        if (connId is { Length: 4 })
            _connectionId = BinaryPrimitives.ReadUInt32BigEndian(connId);
        return resp.ResponseCode;
    }

    public async Task<ObexResponse> DisconnectAsync(CancellationToken ct = default)
    {
        var req = new ObexPacket { Code = (byte)ObexOpcode.Disconnect };
        AttachConnectionId(req);
        await WritePacketAsync(req, ct);
        return (await ReadPacketAsync(ct: ct)).ResponseCode;
    }

    /// SETPATH one level. Empty name + !down = navigate to root.
    public async Task<ObexResponse> SetPathAsync(string name, bool up = false, CancellationToken ct = default)
    {
        var req = new ObexPacket
        {
            Code = (byte)ObexOpcode.SetPath,
            FixedFields = new byte[] { (byte)(up ? 0x03 : 0x02), 0x00 }, // don't-create bit always set
        };
        AttachConnectionId(req);
        if (!up) req.AddUnicode(ObexHeaderId.Name, name);
        await WritePacketAsync(req, ct);
        return (await ReadPacketAsync(ct: ct)).ResponseCode;
    }

    public sealed record ObexGetResult(ObexResponse Code, byte[] Body, byte[]? AppParams);

    /// Full GET with multi-packet Continue reassembly, object-size ceiling,
    /// and app-params passthrough (PBAP/MAP listings carry metadata there).
    public async Task<ObexGetResult> GetAsync(string name, string? type = null, byte[]? appParams = null, CancellationToken ct = default)
    {
        var req = new ObexPacket { Code = (byte)ObexOpcode.GetFinal };
        AttachConnectionId(req);
        if (name.Length > 0 || type == null) req.AddUnicode(ObexHeaderId.Name, name);
        if (type != null) req.AddByteSeq(ObexHeaderId.Type, System.Text.Encoding.ASCII.GetBytes(type + "\0"));
        if (appParams != null) req.AddByteSeq(ObexHeaderId.AppParams, appParams);
        await WritePacketAsync(req, ct);

        using var body = new MemoryStream();
        byte[]? gotAppParams = null;
        while (true)
        {
            var resp = await ReadPacketAsync(ct: ct);
            gotAppParams ??= resp.FindHeader(ObexHeaderId.AppParams);
            var chunk = resp.BodyBytes();
            if (body.Length + chunk.Length > ObexLimits.MaxObjectBytes)
                throw new ObexProtocolException("GET object exceeds size ceiling");
            body.Write(chunk);

            if (resp.ResponseCode == ObexResponse.Success)
                return new ObexGetResult(ObexResponse.Success, body.ToArray(), gotAppParams);
            if (resp.ResponseCode != ObexResponse.Continue)
                return new ObexGetResult(resp.ResponseCode, body.ToArray(), gotAppParams);

            // Ask for the next chunk: empty GET-final with just the connection id.
            var cont = new ObexPacket { Code = (byte)ObexOpcode.GetFinal };
            AttachConnectionId(cont);
            await WritePacketAsync(cont, ct);
        }
    }

    /// PUT with outbound multi-packet chunking honoring the peer's advertised
    /// max packet size — the legacy client only ever sent single-packet PUTs,
    /// a latent failure for MMS bodies larger than one packet.
    public async Task<ObexResponse> PutAsync(string name, byte[] body, string? type = null, byte[]? appParams = null, CancellationToken ct = default)
    {
        // Conservative per-packet body budget: peer max minus generous header room.
        var budget = Math.Max(255, PeerMaxPacket - 200);
        var offset = 0;
        var first = true;
        while (true)
        {
            var remaining = body.Length - offset;
            var isLast = remaining <= budget;
            var take = isLast ? remaining : budget;

            var req = new ObexPacket { Code = (byte)(isLast ? ObexOpcode.PutFinal : ObexOpcode.Put) };
            AttachConnectionId(req);
            if (first)
            {
                // No Name header at all for nameless PUTs (MAP notification
                // registration) — a zero-length Name header is another of the
                // empty-header shapes quirky firmware rejects; the legacy
                // stack's proven form simply omits it.
                if (name.Length > 0) req.AddUnicode(ObexHeaderId.Name, name);
                if (type != null) req.AddByteSeq(ObexHeaderId.Type, System.Text.Encoding.ASCII.GetBytes(type + "\0"));
                if (appParams != null) req.AddByteSeq(ObexHeaderId.AppParams, appParams);
                first = false;
            }
            if (take > 0)
                req.AddByteSeq(isLast ? ObexHeaderId.EndOfBody : ObexHeaderId.Body, body.AsSpan(offset, take).ToArray());
            // PUT with a genuinely empty body must NOT carry an empty EndOfBody
            // header — a production-discovered handset rejection the legacy
            // stack learned the hard way; preserved here by the take>0 guard.

            await WritePacketAsync(req, ct);
            var resp = await ReadPacketAsync(ct: ct);
            if (isLast) return resp.ResponseCode;
            if (resp.ResponseCode != ObexResponse.Continue) return resp.ResponseCode;
            offset += take;
        }
    }

    private void AttachConnectionId(ObexPacket packet)
    {
        if (_connectionId is { } id) packet.AddFourByte(ObexHeaderId.ConnectionId, id);
    }

    // ── Server role (MNS) ────────────────────────────────────────────────────

    /// Serve one OBEX client session (the phone, for MNS): CONNECT / PUT
    /// (multi-packet reassembled) / DISCONNECT. Each complete PUT object is
    /// handed to onPut. Returns when the peer disconnects or the token fires.
    public async Task ServeAsync(Func<byte[], Task> onPut, CancellationToken ct = default)
    {
        using var putBody = new MemoryStream();
        while (!ct.IsCancellationRequested)
        {
            byte[] raw;
            try { raw = await ReadRawPacketAsync(ct); }
            catch (EndOfStreamException) { return; }
            // CONNECT requests carry 4 fixed bytes (version/flags/maxPacket);
            // every other opcode has none. Decide from the code byte before parsing.
            var isConnect = raw[0] == (byte)ObexOpcode.Connect;
            var req = ObexPacket.Parse(raw, fixedFieldCount: isConnect ? 4 : 0, tolerateShortConnect: isConnect);

            switch ((ObexOpcode)req.Code)
            {
                case ObexOpcode.Connect:
                    await WritePacketAsync(new ObexPacket
                    {
                        Code = (byte)ObexResponse.Success,
                        FixedFields = new byte[] { 0x10, 0x00, 0xFF, 0xFF },
                    }, ct);
                    break;

                case ObexOpcode.Put:
                    putBody.Write(req.BodyBytes());
                    if (putBody.Length > ObexLimits.MaxObjectBytes) throw new ObexProtocolException("PUT object exceeds size ceiling");
                    await WritePacketAsync(new ObexPacket { Code = (byte)ObexResponse.Continue }, ct);
                    break;

                case ObexOpcode.PutFinal:
                    putBody.Write(req.BodyBytes());
                    if (putBody.Length > ObexLimits.MaxObjectBytes) throw new ObexProtocolException("PUT object exceeds size ceiling");
                    await WritePacketAsync(new ObexPacket { Code = (byte)ObexResponse.Success }, ct);
                    var obj = putBody.ToArray();
                    putBody.SetLength(0);
                    // Empty event bodies are NORMAL (observed MediaTek behavior:
                    // the PUT itself is the "something changed" signal) — the
                    // callback decides what to do with zero bytes.
                    await onPut(obj);
                    break;

                case ObexOpcode.Disconnect:
                    await WritePacketAsync(new ObexPacket { Code = (byte)ObexResponse.Success }, ct);
                    return;

                default:
                    await WritePacketAsync(new ObexPacket { Code = (byte)ObexResponse.NotImplemented }, ct);
                    break;
            }
        }
    }
}
