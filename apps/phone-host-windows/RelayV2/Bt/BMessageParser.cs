using System.Text;

namespace DeskPhone.RelayV2.Bt;

public sealed record ParsedMessage(string Sender, string Body);

// bMessage body parser for MAP message fetches. The wire format genuinely
// varies by handset vendor — the legacy stack grew three parsing branches in
// production and v2 keeps all three, but as ONE ordered, fixture-tested
// decision ladder instead of scattered fallbacks:
//   1. standard bMessage envelope (BEGIN:BMSG … BEGIN:MSG payload END:MSG)
//   2. raw MIME with no envelope (MediaTek/"Fig 52" handsets)
//   3. plain text
public static class BMessageParser
{
    public static ParsedMessage Parse(byte[] raw)
    {
        var text = Encoding.UTF8.GetString(raw);

        if (text.Contains("BEGIN:BMSG", StringComparison.OrdinalIgnoreCase))
            return ParseEnvelope(text);
        if (LooksLikeMime(text))
            return new ParsedMessage("", ExtractMimeText(text));
        return new ParsedMessage("", text.Trim());
    }

    private static ParsedMessage ParseEnvelope(string text)
    {
        var sender = "";
        // Originator vCard: first TEL inside the BENV's BEGIN:VCARD block.
        var lines = text.Replace("\r\n", "\n").Split('\n');
        var inVcard = false;
        foreach (var line in lines)
        {
            if (line.StartsWith("BEGIN:VCARD", StringComparison.OrdinalIgnoreCase)) inVcard = true;
            else if (line.StartsWith("END:VCARD", StringComparison.OrdinalIgnoreCase)) inVcard = false;
            else if (inVcard && line.StartsWith("TEL", StringComparison.OrdinalIgnoreCase))
            {
                var colon = line.IndexOf(':');
                if (colon > 0 && sender.Length == 0) sender = line[(colon + 1)..].Trim();
            }
        }

        // Payload between BEGIN:MSG and the LAST END:MSG (bodies may contain
        // the literal string END:MSG; the spec length field is unreliable
        // across vendors, so last-marker wins).
        var start = text.IndexOf("BEGIN:MSG", StringComparison.OrdinalIgnoreCase);
        var end = text.LastIndexOf("END:MSG", StringComparison.OrdinalIgnoreCase);
        var body = "";
        if (start >= 0 && end > start)
        {
            var payloadStart = text.IndexOf('\n', start);
            if (payloadStart > 0 && payloadStart < end)
                body = text[(payloadStart + 1)..end].TrimEnd('\r', '\n');
        }
        if (LooksLikeMime(body)) body = ExtractMimeText(body);
        return new ParsedMessage(sender, body.Trim());
    }

    internal static bool LooksLikeMime(string text) =>
        text.Contains("Content-Type:", StringComparison.OrdinalIgnoreCase) &&
        (text.Contains("MIME-Version:", StringComparison.OrdinalIgnoreCase) ||
         text.Contains("boundary=", StringComparison.OrdinalIgnoreCase));

    /// Extract the first text/plain part from a MIME body (MMS). Attachments
    /// are intentionally not handled here — media flows through pushMedia
    /// separately; this parser's contract is "the human-readable text".
    internal static string ExtractMimeText(string mime)
    {
        var boundary = FindBoundary(mime);
        if (boundary == null)
        {
            // Single-part: body is after the blank header separator.
            var sep = mime.IndexOf("\r\n\r\n", StringComparison.Ordinal);
            if (sep < 0) sep = mime.IndexOf("\n\n", StringComparison.Ordinal);
            return sep >= 0 ? mime[(sep + 2)..].Trim() : mime.Trim();
        }
        foreach (var part in mime.Split("--" + boundary))
        {
            if (!part.Contains("text/plain", StringComparison.OrdinalIgnoreCase)) continue;
            var sep = part.IndexOf("\r\n\r\n", StringComparison.Ordinal);
            var sepLen = 4;
            if (sep < 0) { sep = part.IndexOf("\n\n", StringComparison.Ordinal); sepLen = 2; }
            if (sep < 0) continue;
            var body = part[(sep + sepLen)..].Trim();
            if (part.Contains("base64", StringComparison.OrdinalIgnoreCase))
            {
                try { body = Encoding.UTF8.GetString(Convert.FromBase64String(body.Replace("\r", "").Replace("\n", ""))); }
                catch (FormatException) { /* not actually base64 — keep raw */ }
            }
            return body;
        }
        return "";
    }

    private static string? FindBoundary(string mime)
    {
        var idx = mime.IndexOf("boundary=", StringComparison.OrdinalIgnoreCase);
        if (idx < 0) return null;
        var rest = mime[(idx + 9)..];
        if (rest.StartsWith('"'))
        {
            var close = rest.IndexOf('"', 1);
            return close > 1 ? rest[1..close] : null;
        }
        var end = rest.IndexOfAny(new[] { '\r', '\n', ';', ' ' });
        return end > 0 ? rest[..end] : rest;
    }
}
