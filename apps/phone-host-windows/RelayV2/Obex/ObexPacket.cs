using System.Buffers.Binary;
using System.Text;

namespace DeskPhone.RelayV2.Obex;

// One OBEX packet: a code byte, a 2-byte big-endian total length, optional
// fixed fields (Connect/SetPath carry extras), then a list of headers.
// Pure data + pure (de)serialization — no sockets — so every quirk the old
// stack learned in production (MediaTek's short CONNECT response, empty
// EndOfBody rejection) is captured here as a unit-testable byte transform.
public sealed class ObexPacket
{
    public byte Code { get; init; }
    public byte[] FixedFields { get; init; } = Array.Empty<byte>();
    public List<(ObexHeaderId Id, byte[] Value)> Headers { get; } = new();

    public ObexResponse ResponseCode => (ObexResponse)Code;
    public bool IsFinal => (Code & 0x80) != 0;

    public void AddByteSeq(ObexHeaderId id, byte[] value) => Headers.Add((id, value));

    public void AddUnicode(ObexHeaderId id, string value)
    {
        // OBEX unicode headers are UTF-16BE with a mandatory null terminator;
        // the EMPTY name header is encoded as zero-length (no terminator).
        var bytes = value.Length == 0
            ? Array.Empty<byte>()
            : Encoding.BigEndianUnicode.GetBytes(value + "\0");
        Headers.Add((id, bytes));
    }

    public void AddFourByte(ObexHeaderId id, uint value)
    {
        var b = new byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(b, value);
        Headers.Add((id, b));
    }

    public void AddOneByte(ObexHeaderId id, byte value) => Headers.Add((id, new[] { value }));

    public byte[]? FindHeader(ObexHeaderId id)
    {
        foreach (var (hid, value) in Headers)
            if (hid == id) return value;
        return null;
    }

    /// All Body + EndOfBody payload bytes in order — the object content.
    public byte[] BodyBytes()
    {
        using var ms = new MemoryStream();
        foreach (var (id, value) in Headers)
            if (id is ObexHeaderId.Body or ObexHeaderId.EndOfBody)
                ms.Write(value);
        return ms.ToArray();
    }

    public byte[] Serialize()
    {
        using var ms = new MemoryStream();
        ms.WriteByte(Code);
        ms.WriteByte(0); ms.WriteByte(0); // length placeholder
        ms.Write(FixedFields);
        foreach (var (id, value) in Headers)
        {
            ms.WriteByte((byte)id);
            var kind = (byte)id >> 6;
            switch (kind)
            {
                case 0: // unicode — 2-byte length includes the 3 prefix bytes
                case 1: // byte sequence — same length rule
                    var len = (ushort)(value.Length + 3);
                    ms.WriteByte((byte)(len >> 8));
                    ms.WriteByte((byte)(len & 0xFF));
                    ms.Write(value);
                    break;
                case 2: // 1-byte value
                    ms.WriteByte(value[0]);
                    break;
                case 3: // 4-byte value
                    ms.Write(value, 0, 4);
                    break;
            }
        }
        var packet = ms.ToArray();
        if (packet.Length > ObexLimits.MaxPacketBytes)
            throw new ObexProtocolException($"outbound packet {packet.Length}B exceeds OBEX max {ObexLimits.MaxPacketBytes}B");
        BinaryPrimitives.WriteUInt16BigEndian(packet.AsSpan(1), (ushort)packet.Length);
        return packet;
    }

    /// Parse one packet from raw bytes. fixedFieldCount is how many bytes
    /// after the 3-byte prefix belong to the operation's fixed fields
    /// (Connect response: 4 — version/flags/maxPacket; everything else: 0).
    /// tolerateShortConnect handles the MediaTek/"Fig 52" quirk the legacy
    /// stack discovered in production: some handsets omit the 4 fixed bytes
    /// from their CONNECT response entirely.
    public static ObexPacket Parse(ReadOnlySpan<byte> raw, int fixedFieldCount = 0, bool tolerateShortConnect = false)
    {
        if (raw.Length < 3) throw new ObexProtocolException("packet shorter than 3-byte OBEX prefix");
        var declared = BinaryPrimitives.ReadUInt16BigEndian(raw.Slice(1));
        if (declared != raw.Length)
            throw new ObexProtocolException($"declared length {declared} != actual {raw.Length}");

        int offset = 3;
        var fixedFields = Array.Empty<byte>();
        if (fixedFieldCount > 0)
        {
            if (raw.Length >= offset + fixedFieldCount)
            {
                fixedFields = raw.Slice(offset, fixedFieldCount).ToArray();
                offset += fixedFieldCount;
            }
            else if (!tolerateShortConnect)
            {
                throw new ObexProtocolException($"packet too short for {fixedFieldCount} fixed fields");
            }
            // tolerateShortConnect: fall through with no fixed fields — the
            // MediaTek short-CONNECT case; headers (if any) start at offset 3.
        }

        var packet = new ObexPacket { Code = raw[0], FixedFields = fixedFields };
        while (offset < raw.Length)
        {
            var id = raw[offset];
            var kind = id >> 6;
            switch (kind)
            {
                case 0:
                case 1:
                {
                    if (offset + 3 > raw.Length) throw new ObexProtocolException("truncated header length");
                    var len = BinaryPrimitives.ReadUInt16BigEndian(raw.Slice(offset + 1));
                    if (len < 3 || offset + len > raw.Length)
                        throw new ObexProtocolException($"header 0x{id:X2} length {len} exceeds packet");
                    packet.Headers.Add(((ObexHeaderId)id, raw.Slice(offset + 3, len - 3).ToArray()));
                    offset += len;
                    break;
                }
                case 2:
                    if (offset + 2 > raw.Length) throw new ObexProtocolException("truncated 1-byte header");
                    packet.Headers.Add(((ObexHeaderId)id, new[] { raw[offset + 1] }));
                    offset += 2;
                    break;
                default: // 3
                    if (offset + 5 > raw.Length) throw new ObexProtocolException("truncated 4-byte header");
                    packet.Headers.Add(((ObexHeaderId)id, raw.Slice(offset + 1, 4).ToArray()));
                    offset += 5;
                    break;
            }
        }
        return packet;
    }
}

public sealed class ObexProtocolException : Exception
{
    public ObexProtocolException(string message) : base(message) { }
}
