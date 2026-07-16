using System.Text;

namespace DeskPhone.RelayV2.Bt;

public sealed record VCardEntry(
    string Name,
    List<string> Numbers,
    DateTimeOffset? CallTime,   // X-IRMC-CALL-DATETIME when present (call logs)
    string CallDirection        // "" | "RECEIVED" | "DIALED" | "MISSED"
);

// vCard 2.1/3.0 parser for PBAP payloads. Fixes the concrete gaps found in
// the legacy PbapService parser:
//   - QUOTED-PRINTABLE encoded values (non-ASCII names) are decoded, not
//     passed through as =D7=90-style soup
//   - real UTF-8 validation (strict decoder) instead of "does the text
//     contain BEGIN:VCARD" as an encoding heuristic
//   - unparseable timestamps yield null, never DateTime.Now masquerading
//     as real data
// Pure text -> records; unit-tested against fixture cards.
public static class VCardParser
{
    public static List<VCardEntry> Parse(byte[] raw)
    {
        var text = DecodeUtf8OrLatin1(raw);
        var entries = new List<VCardEntry>();
        foreach (var card in SplitCards(Unfold(text)))
        {
            var name = "";
            var numbers = new List<string>();
            DateTimeOffset? callTime = null;
            var direction = "";

            foreach (var line in card)
            {
                var colon = line.IndexOf(':');
                if (colon <= 0) continue;
                var prop = line[..colon];
                var value = line[(colon + 1)..];

                var propName = prop.Split(';')[0].ToUpperInvariant();
                if (prop.Contains("QUOTED-PRINTABLE", StringComparison.OrdinalIgnoreCase))
                    value = DecodeQuotedPrintable(value);

                switch (propName)
                {
                    case "FN":
                        if (name.Length == 0) name = Unescape(value).Trim();
                        break;
                    case "N":
                        if (name.Length == 0)
                        {
                            // N is family;given;middle;prefix;suffix
                            var parts = SplitEscaped(value, ';').Select(Unescape).ToArray();
                            name = string.Join(" ", new[] { parts.ElementAtOrDefault(1), parts.ElementAtOrDefault(0) }
                                .Where(p => !string.IsNullOrWhiteSpace(p))).Trim();
                        }
                        break;
                    case "TEL":
                        var num = Unescape(value).Trim();
                        if (num.Length > 0) numbers.Add(num);
                        break;
                    case "X-IRMC-CALL-DATETIME":
                        callTime = ParseIrmcDateTime(value);
                        foreach (var p in prop.Split(';').Skip(1))
                        {
                            var d = p.ToUpperInvariant();
                            if (d is "RECEIVED" or "DIALED" or "MISSED") direction = d;
                            else if (d.StartsWith("TYPE=", StringComparison.Ordinal)) direction = d[5..];
                        }
                        break;
                }
            }
            entries.Add(new VCardEntry(name, numbers, callTime, direction));
        }
        return entries;
    }

    /// YYYYMMDDTHHMMSS with optional Z or ±HHMM offset. Unlike the legacy
    /// parser, an offset suffix is honored (the "+4h skew" ticket: dropping
    /// it silently shifted every call-log time by the timezone delta) and an
    /// unparseable value returns null instead of DateTime.Now.
    internal static DateTimeOffset? ParseIrmcDateTime(string value)
    {
        var v = value.Trim();
        if (v.Length < 15 || v[8] != 'T') return null;
        if (!int.TryParse(v[..4], out var y) || !int.TryParse(v[4..6], out var mo) ||
            !int.TryParse(v[6..8], out var d) || !int.TryParse(v[9..11], out var h) ||
            !int.TryParse(v[11..13], out var mi) || !int.TryParse(v[13..15], out var s))
            return null;
        try
        {
            var rest = v[15..];
            if (rest.StartsWith('Z'))
                return new DateTimeOffset(y, mo, d, h, mi, s, TimeSpan.Zero);
            if ((rest.StartsWith('+') || rest.StartsWith('-')) && rest.Length >= 5 &&
                int.TryParse(rest[1..3], out var oh) && int.TryParse(rest[3..5], out var om))
            {
                var offset = new TimeSpan(oh, om, 0);
                if (rest[0] == '-') offset = -offset;
                return new DateTimeOffset(y, mo, d, h, mi, s, offset);
            }
            // No suffix: device-local time; use the local zone explicitly.
            return new DateTimeOffset(new DateTime(y, mo, d, h, mi, s, DateTimeKind.Local));
        }
        catch (ArgumentOutOfRangeException) { return null; }
    }

    private static string DecodeUtf8OrLatin1(byte[] raw)
    {
        try
        {
            // Strict decoder: throws on invalid sequences — a REAL validity
            // check, unlike substring-sniffing.
            return new UTF8Encoding(false, throwOnInvalidBytes: true).GetString(raw);
        }
        catch (DecoderFallbackException)
        {
            return Encoding.Latin1.GetString(raw);
        }
    }

    /// RFC 2425 line unfolding: a line starting with space/tab continues the
    /// previous line. Also joins quoted-printable soft breaks (trailing =).
    internal static List<string> Unfold(string text)
    {
        var raw = text.Replace("\r\n", "\n").Split('\n');
        var lines = new List<string>();
        foreach (var line in raw)
        {
            if (lines.Count > 0 && (line.StartsWith(' ') || line.StartsWith('\t')))
                lines[^1] += line[1..];
            else if (lines.Count > 0 && lines[^1].EndsWith('=') &&
                     lines[^1].Contains("QUOTED-PRINTABLE", StringComparison.OrdinalIgnoreCase))
                lines[^1] = lines[^1][..^1] + line; // QP soft line break
            else
                lines.Add(line);
        }
        return lines;
    }

    private static IEnumerable<List<string>> SplitCards(List<string> lines)
    {
        List<string>? current = null;
        foreach (var line in lines)
        {
            if (line.Equals("BEGIN:VCARD", StringComparison.OrdinalIgnoreCase)) current = new List<string>();
            else if (line.Equals("END:VCARD", StringComparison.OrdinalIgnoreCase))
            {
                if (current != null) yield return current;
                current = null;
            }
            else current?.Add(line);
        }
    }

    internal static string DecodeQuotedPrintable(string value)
    {
        var bytes = new List<byte>();
        for (var i = 0; i < value.Length; i++)
        {
            if (value[i] == '=' && i + 2 < value.Length &&
                Uri.IsHexDigit(value[i + 1]) && Uri.IsHexDigit(value[i + 2]))
            {
                bytes.Add(Convert.ToByte(value.Substring(i + 1, 2), 16));
                i += 2;
            }
            else bytes.Add((byte)value[i]);
        }
        return Encoding.UTF8.GetString(bytes.ToArray());
    }

    internal static string Unescape(string value) =>
        value.Replace("\\n", "\n").Replace("\\N", "\n")
             .Replace("\\,", ",").Replace("\\;", ";").Replace("\\\\", "\\");

    internal static List<string> SplitEscaped(string value, char sep)
    {
        var parts = new List<string>();
        var current = new StringBuilder();
        for (var i = 0; i < value.Length; i++)
        {
            if (value[i] == '\\' && i + 1 < value.Length) { current.Append(value[i]).Append(value[i + 1]); i++; continue; }
            if (value[i] == sep) { parts.Add(current.ToString()); current.Clear(); continue; }
            current.Append(value[i]);
        }
        parts.Add(current.ToString());
        return parts;
    }
}
