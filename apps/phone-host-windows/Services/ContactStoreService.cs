using DeskPhone.Models;
using System.IO;
using System.Text.Json;

namespace DeskPhone.Services;

public class ContactStoreService
{
    private static readonly string StorePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "DeskPhone",
        "contacts.json");

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = true
    };

    public List<ContactEntry> Load()
    {
        try
        {
            if (!File.Exists(StorePath)) return new List<ContactEntry>();
            var json = File.ReadAllText(StorePath);
            return JsonSerializer.Deserialize<List<ContactEntry>>(json, JsonOpts)
                   ?? new List<ContactEntry>();
        }
        catch
        {
            return new List<ContactEntry>();
        }
    }

    public void Save(IEnumerable<ContactEntry> contacts)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(StorePath)!);
            var json = JsonSerializer.Serialize(contacts.ToList(), JsonOpts);
            File.WriteAllText(StorePath, json);
        }
        catch { }
    }

    public (List<ContactEntry> merged, int addedCount, int skippedCount) Merge(
        IEnumerable<ContactEntry> existing,
        IEnumerable<ContactEntry> incoming)
    {
        var merged = existing
            .Select(Clone)
            .ToList();

        var knownPhones = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var contact in merged)
        {
            var device = MessageStoreService.NormalizeDeviceAddress(contact.SourceDeviceAddress);
            foreach (var phone in contact.PhoneNumbers.Select(NormalizePhone).Where(p => !string.IsNullOrEmpty(p)))
                knownPhones.Add(BuildDevicePhoneKey(device, phone));
        }

        int added = 0, skipped = 0;

        foreach (var contact in incoming)
        {
            var normalizedPhones = contact.PhoneNumbers
                .Select(NormalizePhone)
                .Where(p => !string.IsNullOrEmpty(p))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (normalizedPhones.Count == 0)
            {
                skipped++;
                continue;
            }

            var device = MessageStoreService.NormalizeDeviceAddress(contact.SourceDeviceAddress);
            if (normalizedPhones.Select(phone => BuildDevicePhoneKey(device, phone)).Any(knownPhones.Contains))
            {
                skipped++;
                continue;
            }

            merged.Add(new ContactEntry
            {
                DisplayName = string.IsNullOrWhiteSpace(contact.DisplayName)
                    ? Models.Conversation.FormatPhone(normalizedPhones[0])
                    : contact.DisplayName.Trim(),
                PhoneNumbers = normalizedPhones,
                SourceDeviceAddress = contact.SourceDeviceAddress,
                SourceFileName = contact.SourceFileName,
                ImportedAt = contact.ImportedAt == default ? DateTime.Now : contact.ImportedAt
            });

            foreach (var phone in normalizedPhones)
                knownPhones.Add(BuildDevicePhoneKey(device, phone));

            added++;
        }

        return (merged, added, skipped);
    }

    private static string BuildDevicePhoneKey(string? deviceAddress, string phone) =>
        $"{MessageStoreService.NormalizeDeviceAddress(deviceAddress)}|{phone}";

    public static string NormalizePhone(string? src)
    {
        if (string.IsNullOrWhiteSpace(src)) return "";

        var value = src.Trim();

        if (value.StartsWith("Me >", StringComparison.OrdinalIgnoreCase))
            value = value.Length > 5 ? value[5..].Trim() : "";

        if (value.StartsWith("tel:", StringComparison.OrdinalIgnoreCase))
            value = value[4..].Trim();

        var metadataIndex = value.IndexOfAny(new[] { ';', '?', ',' });
        if (metadataIndex >= 0)
            value = value[..metadataIndex].Trim();

        var digits = new string(value.Where(char.IsDigit).ToArray());
        if (digits.Length == 11 && digits.StartsWith("1", StringComparison.Ordinal))
            digits = digits[1..];

        return digits;
    }

    public static bool PhoneNumbersLikelyMatch(string? left, string? right)
        => GetPhoneMatchScore(left, right) > 0;

    public static int GetPhoneMatchScore(string? left, string? right)
    {
        var leftCandidates = BuildLookupCandidates(left);
        var rightCandidates = BuildLookupCandidates(right);

        foreach (var leftCandidate in leftCandidates)
        {
            foreach (var rightCandidate in rightCandidates)
            {
                if (string.Equals(leftCandidate.Value, rightCandidate.Value, StringComparison.OrdinalIgnoreCase))
                    return Math.Min(leftCandidate.Score, rightCandidate.Score);
            }
        }

        return 0;
    }

    private static List<(string Value, int Score)> BuildLookupCandidates(string? source)
    {
        var candidates = new List<(string Value, int Score)>();
        void AddCandidate(string? raw, int score)
        {
            var candidate = NormalizePhone(raw);
            if (string.IsNullOrWhiteSpace(candidate))
                return;

            for (int i = 0; i < candidates.Count; i++)
            {
                if (!string.Equals(candidates[i].Value, candidate, StringComparison.OrdinalIgnoreCase))
                    continue;

                if (score > candidates[i].Score)
                    candidates[i] = (candidate, score);
                return;
            }

            candidates.Add((candidate, score));
        }

        var normalized = NormalizePhone(source);
        AddCandidate(normalized, 100);
        if (string.IsNullOrWhiteSpace(normalized))
            return candidates;

        if (normalized.Length > 11)
        {
            if (normalized.StartsWith("011", StringComparison.Ordinal))
            {
                AddCandidate(normalized[3..], 90);
            }
            else if (normalized.StartsWith("00", StringComparison.Ordinal))
            {
                AddCandidate(normalized[2..], 90);
            }
            else
            {
                var leadingLocal = normalized.StartsWith("1", StringComparison.Ordinal) && normalized.Length >= 11
                    ? normalized.Substring(1, 10)
                    : normalized.Substring(0, 10);
                AddCandidate(leadingLocal, 80);
            }
        }

        return candidates;
    }

    private static ContactEntry Clone(ContactEntry contact) => new()
    {
        DisplayName = contact.DisplayName,
        PhoneNumbers = contact.PhoneNumbers.ToList(),
        SourceDeviceAddress = contact.SourceDeviceAddress,
        SourceFileName = contact.SourceFileName,
        ImportedAt = contact.ImportedAt
    };
}
