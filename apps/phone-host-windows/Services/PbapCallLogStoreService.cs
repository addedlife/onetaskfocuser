using DeskPhone.Models;
using System.IO;
using System.Text.Json;

namespace DeskPhone.Services;

public class PbapCallLogStoreService
{
    private static readonly string StorePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "DeskPhone",
        "pbap-calllogs.json");

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = true
    };

    public List<PbapCallLogEntry> Load()
    {
        try
        {
            if (!File.Exists(StorePath)) return new List<PbapCallLogEntry>();
            var json = File.ReadAllText(StorePath);
            return JsonSerializer.Deserialize<List<PbapCallLogEntry>>(json, JsonOpts)
                   ?? new List<PbapCallLogEntry>();
        }
        catch
        {
            return new List<PbapCallLogEntry>();
        }
    }

    public void Save(IEnumerable<PbapCallLogEntry> entries)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(StorePath)!);
            var json = JsonSerializer.Serialize(entries.ToList(), JsonOpts);
            File.WriteAllText(StorePath, json);
        }
        catch { }
    }

    public (List<PbapCallLogEntry> merged, int addedCount) Merge(
        IEnumerable<PbapCallLogEntry> existing,
        IEnumerable<PbapCallLogEntry> incoming)
    {
        var merged = existing
            .Select(Clone)
            .ToList();

        var knownKeys = new HashSet<string>(
            merged.Select(BuildKey),
            StringComparer.OrdinalIgnoreCase);

        var added = 0;
        foreach (var entry in incoming)
        {
            var key = BuildKey(entry);
            if (!knownKeys.Add(key))
                continue;

            merged.Add(Clone(entry));
            added++;
        }

        merged = merged
            .OrderByDescending(e => e.Time)
            .ThenByDescending(e => e.ImportedAt)
            .ToList();

        return (merged, added);
    }

    public (List<PbapCallLogEntry> merged, int addedCount, int removedCount) ReplaceDeviceEntries(
        IEnumerable<PbapCallLogEntry> existing,
        string? deviceAddress,
        IEnumerable<PbapCallLogEntry> incoming)
    {
        var preserved = existing
            .Where(entry => !string.Equals(entry.SourceDeviceAddress?.Trim(), deviceAddress?.Trim(), StringComparison.OrdinalIgnoreCase))
            .Select(Clone)
            .ToList();

        var previousDeviceEntries = existing
            .Where(entry => string.Equals(entry.SourceDeviceAddress?.Trim(), deviceAddress?.Trim(), StringComparison.OrdinalIgnoreCase))
            .Select(Clone)
            .ToList();

        var replacement = incoming
            .Select(Clone)
            .GroupBy(BuildKey, StringComparer.OrdinalIgnoreCase)
            .Select(group => group
                .OrderByDescending(entry => entry.Time)
                .ThenByDescending(entry => entry.ImportedAt)
                .First())
            .ToList();

        var previousKeys = previousDeviceEntries
            .Select(BuildKey)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var replacementKeys = replacement
            .Select(BuildKey)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        preserved.AddRange(replacement);
        preserved = preserved
            .OrderByDescending(entry => entry.Time)
            .ThenByDescending(entry => entry.ImportedAt)
            .ToList();

        return (
            preserved,
            replacementKeys.Except(previousKeys, StringComparer.OrdinalIgnoreCase).Count(),
            previousKeys.Except(replacementKeys, StringComparer.OrdinalIgnoreCase).Count());
    }

    public List<PbapCallLogEntry> DeleteEntries(IEnumerable<PbapCallLogEntry> existing, IEnumerable<CallRecord> records)
    {
        var deleteKeys = records
            .Where(record => record.IsPhoneSynced)
            .Select(BuildKey)
            .Where(key => !string.IsNullOrWhiteSpace(key))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (deleteKeys.Count == 0)
            return existing
                .Select(Clone)
                .OrderByDescending(entry => entry.Time)
                .ThenByDescending(entry => entry.ImportedAt)
                .ToList();

        return existing
            .Where(entry => !deleteKeys.Contains(BuildKey(entry)))
            .Select(Clone)
            .OrderByDescending(entry => entry.Time)
            .ThenByDescending(entry => entry.ImportedAt)
            .ToList();
    }

    public List<PbapCallLogEntry> RestoreEntries(IEnumerable<PbapCallLogEntry> existing, IEnumerable<CallRecord> records)
    {
        var restored = records
            .Where(record => record.IsPhoneSynced)
            .Select(record => new PbapCallLogEntry
            {
                Number = record.Number,
                Name = record.Name,
                Direction = record.Direction,
                Time = record.Time,
                RawTimestamp = record.PhoneLogTimestamp ?? "",
                SourceObject = record.PhoneLogSourceObject ?? "",
                SourceDeviceAddress = record.SourceDeviceAddress ?? "",
                ImportedAt = DateTime.Now
            });

        return Merge(existing, restored).merged;
    }

    private static string BuildKey(PbapCallLogEntry entry)
    {
        var phone = ContactStoreService.NormalizePhone(entry.Number);
        var timestamp = !string.IsNullOrWhiteSpace(entry.RawTimestamp)
            ? entry.RawTimestamp.Trim()
            : entry.Time.ToUniversalTime().ToString("O");
        var device = (entry.SourceDeviceAddress ?? "").Trim();
        return $"{device}|{entry.Direction}|{phone}|{timestamp}";
    }

    private static string BuildKey(CallRecord record)
    {
        var phone = ContactStoreService.NormalizePhone(record.Number);
        var timestamp = !string.IsNullOrWhiteSpace(record.PhoneLogTimestamp)
            ? record.PhoneLogTimestamp.Trim()
            : record.Time.ToUniversalTime().ToString("O");
        var device = (record.SourceDeviceAddress ?? "").Trim();
        return $"{device}|{record.Direction}|{phone}|{timestamp}";
    }

    private static PbapCallLogEntry Clone(PbapCallLogEntry entry) => new()
    {
        Number = entry.Number,
        Name = entry.Name,
        Direction = entry.Direction,
        Time = entry.Time,
        RawTimestamp = entry.RawTimestamp,
        SourceObject = entry.SourceObject,
        SourceDeviceAddress = entry.SourceDeviceAddress,
        ImportedAt = entry.ImportedAt
    };
}
