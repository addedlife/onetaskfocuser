namespace DeskPhone.RelayV2.Bt;

// Pure delta-sync math: given what we already have and what the phone's
// listing shows, decide which bodies to download. The legacy MapService mixed
// this logic into its OBEX code, which is why it could never be unit-tested;
// here it's set arithmetic with no I/O.
public static class MessageDeltaPlanner
{
    /// Listing entries whose bodies need downloading: unknown handle, listing
    /// order preserved (MAP listings are newest-first), duplicates and blank
    /// handles dropped, capped at maxFetch so one sync round stays short —
    /// the paginated history loader picks up anything beyond the cap.
    public static List<MapListingEntry> PlanFetches(
        IReadOnlySet<string> knownHandles,
        IEnumerable<MapListingEntry> listing,
        int maxFetch)
    {
        var planned = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var result = new List<MapListingEntry>();
        foreach (var entry in listing)
        {
            if (result.Count >= maxFetch) break;
            if (string.IsNullOrWhiteSpace(entry.Handle)) continue;
            if (knownHandles.Contains(entry.Handle)) continue;
            if (!planned.Add(entry.Handle)) continue;
            result.Add(entry);
        }
        return result;
    }
}
