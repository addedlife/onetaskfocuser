namespace DeskPhone.RelayV2.Obex;

// The ONE canonical table of OBEX opcodes / response codes / header IDs.
// The legacy stack scattered these as raw hex literals (0xA0, 0xC1, 0xD3…)
// across four files with no shared definition — every new profile re-derived
// them from the spec by hand. Everything in RelayV2 references this file.

public enum ObexOpcode : byte
{
    Connect    = 0x80,
    Disconnect = 0x81,
    Put        = 0x02,
    PutFinal   = 0x82,
    Get        = 0x03,
    GetFinal   = 0x83,
    SetPath    = 0x85,
    Abort      = 0xFF,
}

public enum ObexResponse : byte
{
    Continue           = 0x90,
    Success            = 0xA0,
    BadRequest         = 0xC0,
    Unauthorized       = 0xC1,
    Forbidden          = 0xC3,
    NotFound           = 0xC4,
    NotAcceptable      = 0xC6,
    PreconditionFailed = 0xCC,
    NotImplemented     = 0xD1,
    ServiceUnavailable = 0xD3,
}

public enum ObexHeaderId : byte
{
    Name         = 0x01, // unicode (UTF-16BE)
    Type         = 0x42, // byte sequence
    Target       = 0x46, // byte sequence
    Body         = 0x48, // byte sequence
    EndOfBody    = 0x49, // byte sequence
    Who          = 0x4A, // byte sequence
    AppParams    = 0x4C, // byte sequence
    ConnectionId = 0xCB, // 4-byte
    Length       = 0xC3, // 4-byte
    Srm          = 0x97, // 1-byte (Single Response Mode)
    SrmParam     = 0x98, // 1-byte
}

public static class ObexLimits
{
    // Hard ceiling on any packet length read off the wire. The legacy code
    // allocated ByteArray(total) straight from an untrusted 2-byte length
    // header with no upper bound — a hostile or corrupted peer could demand
    // a 64KB allocation per packet forever, or (on Android, where the same
    // bug existed) worse. 64KB is the OBEX protocol max anyway; anything
    // claiming more is malformed by definition.
    public const int MaxPacketBytes = 0xFFFF;
    // Sanity ceiling on a fully reassembled multi-packet object (a phonebook,
    // a message listing, an MMS). Prevents unbounded memory growth from a
    // peer that streams Continue packets forever.
    public const int MaxObjectBytes = 32 * 1024 * 1024;
}
