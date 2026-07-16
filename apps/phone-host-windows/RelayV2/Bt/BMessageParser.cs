using System.Text;

namespace DeskPhone.RelayV2.Bt;

// bMessage body parser for MAP message fetches. The wire format genuinely
// varies by handset vendor — the legacy stack grew three parsing branches in
// production and v2 keeps all three, but as ONE ordered, fixture-tested
// decision ladder instead of scattered fallbacks:
//   1. standard bMessage envelope (BEGIN:BMSG … BEGIN:MSG payload END:MSG)
//   2. raw MIME with no envelope (MediaTek/"Fig 52" handsets)
//   3. plain text
//
// All slicing happens on a Latin-1 view of the raw bytes: Latin-1 maps every
// byte to exactly one char, so binary MIME payloads survive the string round
// trip untouched; human text is re-decoded as UTF-8 only at extraction time.
public static class BMessageParser
{
    public static ParsedMessage Parse(byte[] raw)
    {
        var latin = Encoding.Latin1.GetString(raw);

        if (latin.Contains("BEGIN:BMSG", StringComparison.OrdinalIgnoreCase))
            return ParseEnvelope(latin);
        if (LooksLikeMime(latin))
        {
            var (body, attachments) = ExtractMime(latin);
            return new ParsedMessage("", body, attachments);
        }
        return new ParsedMessage("", Utf8(latin).Trim(), Array.Empty<MapAttachment>());
    }

    /// Latin-1 slice → original bytes → UTF-8 text.
    private static string Utf8(string latinSlice) =>
        Encoding.UTF8.GetString(Encoding.Latin1.GetBytes(latinSlice));

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
        var payload = "";
        if (start >= 0 && end > start)
        {
            var payloadStart = text.IndexOf('\n', start);
            if (payloadStart > 0 && payloadStart < end)
                payload = text[(payloadStart + 1)..end].TrimEnd('\r', '\n');
        }

        if (LooksLikeMime(payload))
        {
            var (body, attachments) = ExtractMime(payload);
            return new ParsedMessage(sender, body, attachments);
        }
        return new ParsedMessage(sender, Utf8(payload).Trim(), Array.Empty<MapAttachment>());
    }

    internal static bool LooksLikeMime(string text) =>
        text.Contains("Content-Type:", StringComparison.OrdinalIgnoreCase) &&
        (text.Contains("MIME-Version:", StringComparison.OrdinalIgnoreCase) ||
         text.Contains("boundary=", StringComparison.OrdinalIgnoreCase));

    /// Extract the human-readable text AND all binary attachments from a MIME
    /// body (MMS). SMIL presentation markup is layout metadata, not content —
    /// skipped, same as every consumer messaging app does.
    internal static (string Body, IReadOnlyList<MapAttachment> Attachments) ExtractMime(string mime)
    {
        var attachments = new List<MapAttachment>();
        var body = "";

        var boundary = FindBoundary(mime);
        var parts = boundary == null
            ? new[] { mime }
            : mime.Split("--" + boundary);

        foreach (var part in parts)
        {
            var trimmed = part.TrimStart();
            if (trimmed.Length == 0 || trimmed.StartsWith("--", StringComparison.Ordinal)) continue;

            var (headers, content) = SplitPart(part);
            if (content.Length == 0) continue;

            var contentType = HeaderValue(headers, "Content-Type").Split(';')[0].Trim().ToLowerInvariant();
            var encoding = HeaderValue(headers, "Content-Transfer-Encoding").Trim().ToLowerInvariant();
            if (boundary == null && contentType.Length == 0) contentType = "text/plain";

            if (contentType.StartsWith("multipart/", StringComparison.Ordinal)) continue;
            if (contentType.Contains("smil", StringComparison.Ordinal)) continue;

            if (contentType.StartsWith("text/plain", StringComparison.Ordinal))
            {
                if (body.Length > 0) continue;
                var text = encoding == "base64" ? DecodeBase64Text(content) : Utf8(content).Trim();
                if (!text.StartsWith("<smil", StringComparison.OrdinalIgnoreCase)) body = text;
                continue;
            }

            // Everything else with real bytes is an attachment (image, vCard,
            // audio, pdf, …) — the legacy parser proved "images only" was too
            // narrow the first time someone texted a contact card.
            var data = encoding == "base64"
                ? TryDecodeBase64(content)
                : Encoding.Latin1.GetBytes(content);
            if (data is not { Length: > 0 }) continue;

            attachments.Add(new MapAttachment(
                contentType.Length > 0 ? contentType : GuessContentType(data),
                ExtractFileName(headers) ?? $"MMS_attachment_{attachments.Count + 1:00}.{GuessExtension(contentType, data)}",
                data));
        }

        return (body, attachments);
    }

    private static (string Headers, string Content) SplitPart(string part)
    {
        var sep = part.IndexOf("\r\n\r\n", StringComparison.Ordinal);
        var sepLen = 4;
        if (sep < 0) { sep = part.IndexOf("\n\n", StringComparison.Ordinal); sepLen = 2; }
        if (sep < 0) return (part, "");
        return (part[..sep], part[(sep + sepLen)..].Trim('\r', '\n'));
    }

    private static string HeaderValue(string headers, string name)
    {
        foreach (var raw in headers.Replace("\r\n", "\n").Split('\n'))
        {
            var line = raw.Trim();
            if (line.StartsWith(name + ":", StringComparison.OrdinalIgnoreCase))
                return line[(name.Length + 1)..].Trim();
        }
        return "";
    }

    private static string? ExtractFileName(string headers)
    {
        foreach (var key in new[] { "filename=", "name=" })
        {
            var idx = headers.IndexOf(key, StringComparison.OrdinalIgnoreCase);
            if (idx < 0) continue;
            var rest = headers[(idx + key.Length)..];
            string value;
            if (rest.StartsWith('"'))
            {
                var close = rest.IndexOf('"', 1);
                if (close <= 1) continue;
                value = rest[1..close];
            }
            else
            {
                var end = rest.IndexOfAny(new[] { '\r', '\n', ';', ' ' });
                value = end > 0 ? rest[..end] : rest;
            }
            value = SanitizeFileName(value);
            if (value.Length > 0) return value;
        }
        return null;
    }

    private static string SanitizeFileName(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        return new string(value.Select(ch => invalid.Contains(ch) ? '_' : ch).ToArray()).Trim();
    }

    private static string DecodeBase64Text(string content)
    {
        var bytes = TryDecodeBase64(content);
        return bytes == null ? content.Trim() : Encoding.UTF8.GetString(bytes).Trim();
    }

    private static byte[]? TryDecodeBase64(string content)
    {
        var b64 = new string(content.Where(c => !char.IsWhiteSpace(c)).ToArray());
        // Strip a trailing boundary fragment ("--…") that survived the split.
        var dashes = b64.IndexOf("--", StringComparison.Ordinal);
        if (dashes > 0) b64 = b64[..dashes];
        while (b64.Length % 4 != 0) b64 += "=";
        try { return Convert.FromBase64String(b64); }
        catch (FormatException) { return null; }
    }

    private static string GuessContentType(byte[] data)
    {
        if (data.Length >= 4)
        {
            if (data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF) return "image/jpeg";
            if (data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47) return "image/png";
            if (data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x38) return "image/gif";
            if (data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46) return "image/webp";
        }
        return "application/octet-stream";
    }

    private static string GuessExtension(string contentType, byte[] data)
    {
        var ct = contentType.Length > 0 ? contentType : GuessContentType(data);
        return ct switch
        {
            "image/jpeg" => "jpg",
            "image/png" => "png",
            "image/gif" => "gif",
            "image/webp" => "webp",
            var t when t.Contains("vcard") => "vcf",
            var t when t.Contains("pdf") => "pdf",
            var t when t.StartsWith("audio/") => "bin",
            var t when t.StartsWith("video/") => "bin",
            _ => "bin",
        };
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
