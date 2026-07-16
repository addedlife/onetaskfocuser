using System.Text;

namespace DeskPhone.RelayV2.Hfp;

// Formal tokenizer for the AT result lines an HFP Audio Gateway sends.
// Handles quoted strings (a caller name containing a comma must not split
// the +CLIP argument list — the legacy split(',') parsing corrupted exactly
// that case) and resolves +CIEV indicator indexes to names via the CIND map
// captured during handshake. Pure string → AtEvent; no I/O; fully unit-tested
// against fixture transcripts.
public sealed class AtTokenizer
{
    private readonly Dictionary<int, string> _cindMap = new();

    /// Parse the +CIND: (…),(…) definition line from the handshake, e.g.
    /// +CIND: ("service",(0,1)),("call",(0,1)),("callsetup",(0-3))
    /// Populates the index→name map (+CIEV indexes are 1-based).
    public void LoadCindDefinition(string payload)
    {
        _cindMap.Clear();
        var index = 1;
        var depth = 0;
        var sawNameThisGroup = false;
        var quote = new StringBuilder();
        var inQuote = false;
        foreach (var ch in payload)
        {
            if (ch == '"')
            {
                if (inQuote)
                {
                    // Closing quote: the FIRST quoted string inside each
                    // top-level (…) group is that indicator's name.
                    if (depth >= 1 && !sawNameThisGroup)
                    {
                        _cindMap[index++] = quote.ToString();
                        sawNameThisGroup = true;
                    }
                    quote.Clear();
                }
                inQuote = !inQuote;
                continue;
            }
            if (inQuote) { quote.Append(ch); continue; }
            if (ch == '(') depth++;
            else if (ch == ')')
            {
                depth--;
                if (depth == 0) sawNameThisGroup = false;
            }
        }
    }

    /// Tokenize one complete line off the wire into a typed event.
    public AtEvent Tokenize(string line)
    {
        var t = line.Trim();
        if (t.Length == 0) return new AtEvent.Unknown("");

        if (t == "RING") return new AtEvent.Ring();
        if (t == "OK") return new AtEvent.Completion(true);
        if (t == "ERROR") return new AtEvent.Completion(false, "ERROR");
        if (t.StartsWith("+CME ERROR:", StringComparison.Ordinal))
            return new AtEvent.Completion(false, t[11..].Trim());

        if (t.StartsWith("+CLIP:", StringComparison.Ordinal))
        {
            var args = SplitArgs(t[6..]);
            return new AtEvent.CallerId(args.Count > 0 ? args[0] : "");
        }
        if (t.StartsWith("+CCWA:", StringComparison.Ordinal))
        {
            var args = SplitArgs(t[6..]);
            return new AtEvent.CallWaiting(args.Count > 0 ? args[0] : "");
        }
        if (t.StartsWith("+CIEV:", StringComparison.Ordinal))
        {
            var args = SplitArgs(t[6..]);
            if (args.Count >= 2 && int.TryParse(args[0], out var idx) && int.TryParse(args[1], out var val))
            {
                var name = _cindMap.TryGetValue(idx, out var n) ? n : $"#{idx}";
                return new AtEvent.IndicatorChange(name, val);
            }
            return new AtEvent.Unknown(t);
        }
        if (t.StartsWith("+BCS:", StringComparison.Ordinal) || t.StartsWith("+BSIR:", StringComparison.Ordinal) ||
            t.StartsWith("+BVRA:", StringComparison.Ordinal) || t.StartsWith("+VGS", StringComparison.Ordinal) ||
            t.StartsWith("+VGM", StringComparison.Ordinal))
            return new AtEvent.Ignored(t);

        return new AtEvent.Unknown(t);
    }

    /// Split an AT argument list on commas, honoring quoted strings — a
    /// caller name of `"Smith, John"` is ONE argument. Quotes are stripped.
    internal static List<string> SplitArgs(string payload)
    {
        var args = new List<string>();
        var current = new StringBuilder();
        var inQuote = false;
        foreach (var ch in payload)
        {
            if (ch == '"') { inQuote = !inQuote; continue; }
            if (ch == ',' && !inQuote)
            {
                args.Add(current.ToString().Trim());
                current.Clear();
                continue;
            }
            current.Append(ch);
        }
        args.Add(current.ToString().Trim());
        return args;
    }
}
