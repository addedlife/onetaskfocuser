namespace DeskPhone.RelayV2.Bt;

// The message-domain models shared by the MAP client, the parsers, the host
// state, and the local API. One definition each — the legacy stack had the
// same concepts smeared across SmsMessage (457 lines of mutable class),
// per-service tuples, and anonymous payload shapes.

/// One binary attachment extracted from (or destined for) an MMS.
public sealed record MapAttachment(string ContentType, string FileName, byte[] Data);

/// One row of a MAP folder listing — metadata only, no body downloaded yet.
public sealed record MapListingEntry(
    string Handle,
    string Sender,
    string Recipient,
    string Subject,
    DateTimeOffset? Time,
    bool IsRead,
    bool IsMms,
    bool Incoming);

/// A fully materialized message: listing metadata merged with the fetched
/// body and any attachments. Immutable — read-state updates produce a copy.
public sealed record MapMessage(
    string Handle,
    string Sender,
    string Recipient,
    string Body,
    DateTimeOffset? Time,
    bool IsRead,
    bool Incoming,
    bool IsMms,
    string Folder,
    IReadOnlyList<MapAttachment> Attachments);

/// Parser output for one fetched message body.
public sealed record ParsedMessage(string Sender, string Body, IReadOnlyList<MapAttachment> Attachments);

/// One call-log row — from a PBAP pull or a live HFP-resolved call.
public sealed record CallLogEntry(string Name, string Number, string Kind, long? Timestamp);
