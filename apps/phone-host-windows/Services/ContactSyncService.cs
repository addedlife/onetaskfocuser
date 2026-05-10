using DeskPhone.Models;
using System.IO;
using System.Text;
using System.Text.Json;

namespace DeskPhone.Services;

public class ContactSyncService
{
    private const string OperationExtension = ".contactsync.json";
    private const string UpsertOperation = "upsert";
    private const string DeleteOperation = "delete";

    private static readonly string RootPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "DeskPhone",
        "contact-sync");

    public ContactSyncState GetState(string? deviceAddress)
    {
        var root = GetDeviceRoot(deviceAddress);
        var inbox = Path.Combine(root, "inbox");
        var outbox = Path.Combine(root, "outbox");
        var pendingOutbound = Path.Combine(outbox, "pending");
        var imported = Path.Combine(outbox, "imported");
        var ignored = Path.Combine(outbox, "ignored");

        Directory.CreateDirectory(inbox);
        Directory.CreateDirectory(pendingOutbound);
        Directory.CreateDirectory(imported);
        Directory.CreateDirectory(ignored);

        return new ContactSyncState
        {
            RootPath = root,
            InboxPath = inbox,
            OutboxPath = outbox,
            PendingOutboundPath = pendingOutbound,
            PendingFileCount = CountSupportedFiles(inbox),
            ImportedFileCount = CountSupportedFiles(imported),
            IgnoredFileCount = CountSupportedFiles(ignored),
            PendingOutboundFileCount = CountOperationFiles(pendingOutbound),
            PendingOutboundUpsertCount = CountOperationFiles(pendingOutbound, UpsertOperation),
            PendingOutboundDeleteCount = CountOperationFiles(pendingOutbound, DeleteOperation)
        };
    }

    public ContactImportResult ImportPendingFiles(
        string? deviceAddress,
        IReadOnlyCollection<ContactEntry> existingContacts,
        int maxFiles = 4)
    {
        var state = GetState(deviceAddress);
        var files = GetSupportedFiles(state.InboxPath)
            .OrderBy(f => File.GetLastWriteTimeUtc(f))
            .Take(maxFiles)
            .ToList();

        var merged = existingContacts
            .Select(CloneContact)
            .ToList();

        int added = 0;
        int updated = 0;
        int deleted = 0;
        int skipped = 0;
        int processedFiles = 0;

        foreach (var file in files)
        {
            try
            {
                if (file.EndsWith(".vcf", StringComparison.OrdinalIgnoreCase))
                {
                    foreach (var contact in ParseVcfFile(file, deviceAddress))
                        TallyOutcome(ApplyUpsert(merged, contact), ref added, ref updated, ref deleted, ref skipped);
                }
                else if (TryReadOperationFile(file, out var operation))
                {
                    TallyOutcome(ApplyOperation(merged, operation), ref added, ref updated, ref deleted, ref skipped);
                }
                else
                {
                    skipped++;
                    MoveToArchive(file, Path.Combine(state.OutboxPath, "ignored"));
                    processedFiles++;
                    continue;
                }

                MoveToArchive(file, Path.Combine(state.OutboxPath, "imported"));
            }
            catch
            {
                skipped++;
                MoveToArchive(file, Path.Combine(state.OutboxPath, "ignored"));
            }

            processedFiles++;
        }

        return new ContactImportResult
        {
            MergedContacts = merged,
            AddedContacts = added,
            UpdatedContacts = updated,
            DeletedContacts = deleted,
            SkippedContacts = skipped,
            ProcessedFiles = processedFiles,
            PendingFilesRemaining = CountSupportedFiles(state.InboxPath)
        };
    }

    public ContactImportResult ImportFile(
        string filePath,
        string? deviceAddress,
        IReadOnlyCollection<ContactEntry> existingContacts)
    {
        var merged = existingContacts
            .Select(CloneContact)
            .ToList();

        int added = 0;
        int updated = 0;
        int deleted = 0;
        int skipped = 0;

        foreach (var contact in ParseVcfFile(filePath, deviceAddress))
            TallyOutcome(ApplyUpsert(merged, contact), ref added, ref updated, ref deleted, ref skipped);

        return new ContactImportResult
        {
            MergedContacts = merged,
            AddedContacts = added,
            UpdatedContacts = updated,
            DeletedContacts = deleted,
            SkippedContacts = skipped,
            ProcessedFiles = 1,
            PendingFilesRemaining = 0
        };
    }

    public int SkipPendingFiles(string? deviceAddress, int maxFiles = int.MaxValue)
    {
        var state = GetState(deviceAddress);
        var files = GetSupportedFiles(state.InboxPath)
            .OrderBy(f => File.GetLastWriteTimeUtc(f))
            .Take(maxFiles)
            .ToList();

        foreach (var file in files)
            MoveToArchive(file, Path.Combine(state.OutboxPath, "ignored"));

        return files.Count;
    }

    public QueuedContactSyncResult QueueUpsertOperation(
        string? deviceAddress,
        ContactEntry contact,
        ContactEntry? previousSnapshot = null)
    {
        if (string.IsNullOrWhiteSpace(deviceAddress))
            return QueuedContactSyncResult.CreateFailure("No device address is available for outbound contact sync.");

        var state = GetState(deviceAddress);
        int queued = 0;

        if (previousSnapshot != null && HaveDifferentPhoneSets(previousSnapshot.PhoneNumbers, contact.PhoneNumbers))
        {
            WriteOperationFile(state.PendingOutboundPath, new ContactSyncOperationFile
            {
                Operation = DeleteOperation,
                DisplayName = previousSnapshot.DisplayName,
                PhoneNumbers = NormalizePhones(previousSnapshot.PhoneNumbers),
                DeviceAddress = deviceAddress,
                Source = "DeskPhone",
                CreatedUtc = DateTime.UtcNow
            });
            queued++;
        }

        WriteOperationFile(state.PendingOutboundPath, new ContactSyncOperationFile
        {
            Operation = UpsertOperation,
            DisplayName = contact.DisplayName,
            PhoneNumbers = NormalizePhones(contact.PhoneNumbers),
            DeviceAddress = deviceAddress,
            Source = "DeskPhone",
            CreatedUtc = DateTime.UtcNow
        });
        queued++;

        return QueuedContactSyncResult.CreateSuccess(deviceAddress, state.PendingOutboundPath, queued, CountOperationFiles(state.PendingOutboundPath));
    }

    public QueuedContactSyncResult QueueDeleteOperation(string? deviceAddress, ContactEntry contact)
    {
        if (string.IsNullOrWhiteSpace(deviceAddress))
            return QueuedContactSyncResult.CreateFailure("No device address is available for outbound contact sync.");

        var state = GetState(deviceAddress);
        WriteOperationFile(state.PendingOutboundPath, new ContactSyncOperationFile
        {
            Operation = DeleteOperation,
            DisplayName = contact.DisplayName,
            PhoneNumbers = NormalizePhones(contact.PhoneNumbers),
            DeviceAddress = deviceAddress,
            Source = "DeskPhone",
            CreatedUtc = DateTime.UtcNow
        });

        return QueuedContactSyncResult.CreateSuccess(deviceAddress, state.PendingOutboundPath, 1, CountOperationFiles(state.PendingOutboundPath));
    }

    private static IEnumerable<ContactEntry> ParseVcfFile(string filePath, string? deviceAddress)
    {
        var text = File.ReadAllText(filePath);
        var unfolded = UnfoldLines(text);

        var contacts = new List<ContactEntry>();
        List<string>? cardLines = null;

        foreach (var line in unfolded)
        {
            if (line.Equals("BEGIN:VCARD", StringComparison.OrdinalIgnoreCase))
            {
                cardLines = new List<string>();
                continue;
            }

            if (line.Equals("END:VCARD", StringComparison.OrdinalIgnoreCase))
            {
                if (cardLines != null)
                {
                    var contact = ParseCard(cardLines, deviceAddress, Path.GetFileName(filePath));
                    if (contact != null)
                        contacts.Add(contact);
                }
                cardLines = null;
                continue;
            }

            cardLines?.Add(line);
        }

        return contacts;
    }

    private static ContactEntry? ParseCard(
        IEnumerable<string> lines,
        string? deviceAddress,
        string fileName)
    {
        string name = "";
        string structuredName = "";
        var numbers = new List<string>();

        foreach (var rawLine in lines)
        {
            var idx = rawLine.IndexOf(':');
            if (idx <= 0) continue;

            var left = rawLine[..idx];
            var value = Unescape(rawLine[(idx + 1)..]).Trim();
            var property = left.Split(';')[0];
            if (property.Contains('.'))
                property = property[(property.LastIndexOf('.') + 1)..];

            if (property.Equals("FN", StringComparison.OrdinalIgnoreCase))
            {
                name = value;
            }
            else if (property.Equals("N", StringComparison.OrdinalIgnoreCase))
            {
                structuredName = string.Join(" ",
                    value.Split(';')
                         .Where(p => !string.IsNullOrWhiteSpace(p))
                         .Select(p => p.Trim()));
            }
            else if (property.Equals("TEL", StringComparison.OrdinalIgnoreCase))
            {
                var normalized = ContactStoreService.NormalizePhone(value);
                if (!string.IsNullOrEmpty(normalized))
                    numbers.Add(normalized);
            }
        }

        numbers = numbers
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (numbers.Count == 0) return null;

        var displayName = !string.IsNullOrWhiteSpace(name)
            ? name
            : !string.IsNullOrWhiteSpace(structuredName)
                ? structuredName
                : Conversation.FormatPhone(numbers[0]);

        return new ContactEntry
        {
            DisplayName = displayName,
            PhoneNumbers = numbers,
            SourceDeviceAddress = deviceAddress ?? "",
            SourceFileName = fileName,
            ImportedAt = DateTime.Now
        };
    }

    private static IEnumerable<string> UnfoldLines(string text)
    {
        var sourceLines = text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        var lines = new List<string>();

        foreach (var line in sourceLines)
        {
            if ((line.StartsWith(' ') || line.StartsWith('\t')) && lines.Count > 0)
                lines[^1] += line.TrimStart();
            else
                lines.Add(line);
        }

        return lines;
    }

    private static string Unescape(string value) =>
        value.Replace("\\n", "\n", StringComparison.OrdinalIgnoreCase)
             .Replace("\\N", "\n", StringComparison.OrdinalIgnoreCase)
             .Replace("\\,", ",", StringComparison.Ordinal)
             .Replace("\\;", ";", StringComparison.Ordinal)
             .Replace("\\\\", "\\", StringComparison.Ordinal);

    private static void MoveToArchive(string filePath, string archiveFolder)
    {
        Directory.CreateDirectory(archiveFolder);

        var targetPath = Path.Combine(archiveFolder, Path.GetFileName(filePath));
        if (File.Exists(targetPath))
        {
            var stamp = DateTime.Now.ToString("yyyyMMdd_HHmmssfff");
            var name = Path.GetFileNameWithoutExtension(filePath);
            var ext = Path.GetExtension(filePath);
            targetPath = Path.Combine(archiveFolder, $"{name}_{stamp}{ext}");
        }

        File.Move(filePath, targetPath);
    }

    private static string GetDeviceRoot(string? deviceAddress)
    {
        var raw = string.IsNullOrWhiteSpace(deviceAddress) ? "unknown-device" : deviceAddress;
        var safe = new string(raw.Select(ch =>
            char.IsLetterOrDigit(ch) || ch is '-' or '_' ? ch : '_').ToArray());
        return Path.Combine(RootPath, safe);
    }

    private static IEnumerable<string> GetSupportedFiles(string directoryPath) =>
        Directory.GetFiles(directoryPath)
            .Where(IsSupportedInboundFile);

    private static bool IsSupportedInboundFile(string filePath) =>
        filePath.EndsWith(".vcf", StringComparison.OrdinalIgnoreCase)
        || filePath.EndsWith(OperationExtension, StringComparison.OrdinalIgnoreCase);

    private static int CountSupportedFiles(string directoryPath) =>
        GetSupportedFiles(directoryPath).Count();

    private static int CountOperationFiles(string directoryPath, string? operation = null)
    {
        var files = Directory.GetFiles(directoryPath, $"*{OperationExtension}");
        if (string.IsNullOrWhiteSpace(operation))
            return files.Length;

        return files.Count(file => Path.GetFileName(file).Contains($"_{operation}_", StringComparison.OrdinalIgnoreCase));
    }

    private static ContactSyncOutcome ApplyOperation(List<ContactEntry> contacts, ContactSyncOperationFile operation)
    {
        var normalizedPhones = NormalizePhones(operation.PhoneNumbers);
        if (normalizedPhones.Count == 0)
            return ContactSyncOutcome.Skipped;

        return string.Equals(operation.Operation, DeleteOperation, StringComparison.OrdinalIgnoreCase)
            ? ApplyDelete(contacts, normalizedPhones)
            : ApplyUpsert(contacts, new ContactEntry
            {
                DisplayName = operation.DisplayName,
                PhoneNumbers = normalizedPhones,
                SourceDeviceAddress = operation.DeviceAddress ?? "",
                SourceFileName = Path.GetFileName(operation.Source ?? "contactsync"),
                ImportedAt = operation.CreatedUtc == default ? DateTime.Now : operation.CreatedUtc.ToLocalTime()
            });
    }

    private static ContactSyncOutcome ApplyUpsert(List<ContactEntry> contacts, ContactEntry incoming)
    {
        var normalizedPhones = NormalizePhones(incoming.PhoneNumbers);
        if (normalizedPhones.Count == 0)
            return ContactSyncOutcome.Skipped;

        var matchingIndices = contacts
            .Select((contact, index) => new { contact, index })
            .Where(x => ContactSharesAnyPhone(x.contact, normalizedPhones))
            .Select(x => x.index)
            .ToList();

        var displayName = string.IsNullOrWhiteSpace(incoming.DisplayName)
            ? Conversation.FormatPhone(normalizedPhones[0])
            : incoming.DisplayName.Trim();

        if (matchingIndices.Count == 0)
        {
            contacts.Add(new ContactEntry
            {
                DisplayName = displayName,
                PhoneNumbers = normalizedPhones,
                SourceDeviceAddress = incoming.SourceDeviceAddress,
                SourceFileName = incoming.SourceFileName,
                ImportedAt = incoming.ImportedAt == default ? DateTime.Now : incoming.ImportedAt
            });
            return ContactSyncOutcome.Added;
        }

        var primary = contacts[matchingIndices[0]];
        bool changed = false;

        if (!string.Equals(primary.DisplayName, displayName, StringComparison.OrdinalIgnoreCase))
        {
            primary.DisplayName = displayName;
            changed = true;
        }

        if (HaveDifferentPhoneSets(primary.PhoneNumbers, normalizedPhones))
        {
            primary.PhoneNumbers = normalizedPhones;
            changed = true;
        }

        if (!string.IsNullOrWhiteSpace(incoming.SourceDeviceAddress)
            && !string.Equals(primary.SourceDeviceAddress, incoming.SourceDeviceAddress, StringComparison.OrdinalIgnoreCase))
        {
            primary.SourceDeviceAddress = incoming.SourceDeviceAddress;
            changed = true;
        }

        if (!string.IsNullOrWhiteSpace(incoming.SourceFileName)
            && !string.Equals(primary.SourceFileName, incoming.SourceFileName, StringComparison.OrdinalIgnoreCase))
        {
            primary.SourceFileName = incoming.SourceFileName;
            changed = true;
        }

        if (incoming.ImportedAt != default && primary.ImportedAt != incoming.ImportedAt)
        {
            primary.ImportedAt = incoming.ImportedAt;
            changed = true;
        }

        if (matchingIndices.Count > 1)
        {
            foreach (var duplicateIndex in matchingIndices.Skip(1).OrderByDescending(index => index))
                contacts.RemoveAt(duplicateIndex);
            changed = true;
        }

        return changed ? ContactSyncOutcome.Updated : ContactSyncOutcome.Skipped;
    }

    private static ContactSyncOutcome ApplyDelete(List<ContactEntry> contacts, IReadOnlyCollection<string> normalizedPhones)
    {
        int removed = contacts.RemoveAll(contact => ContactSharesAnyPhone(contact, normalizedPhones));
        return removed > 0 ? ContactSyncOutcome.Deleted : ContactSyncOutcome.Skipped;
    }

    private static bool ContactSharesAnyPhone(ContactEntry contact, IReadOnlyCollection<string> normalizedPhones)
    {
        if (normalizedPhones.Count == 0)
            return false;

        return contact.PhoneNumbers
            .Select(ContactStoreService.NormalizePhone)
            .Where(phone => !string.IsNullOrWhiteSpace(phone))
            .Any(normalizedPhones.Contains);
    }

    private static List<string> NormalizePhones(IEnumerable<string> phones) =>
        phones.Select(ContactStoreService.NormalizePhone)
              .Where(phone => !string.IsNullOrWhiteSpace(phone))
              .Distinct(StringComparer.OrdinalIgnoreCase)
              .ToList();

    private static bool HaveDifferentPhoneSets(IEnumerable<string> left, IEnumerable<string> right)
    {
        var leftSet = new HashSet<string>(NormalizePhones(left), StringComparer.OrdinalIgnoreCase);
        var rightSet = new HashSet<string>(NormalizePhones(right), StringComparer.OrdinalIgnoreCase);
        return !leftSet.SetEquals(rightSet);
    }

    private static ContactEntry CloneContact(ContactEntry contact) => new()
    {
        DisplayName = contact.DisplayName,
        PhoneNumbers = contact.PhoneNumbers.ToList(),
        SourceDeviceAddress = contact.SourceDeviceAddress,
        SourceFileName = contact.SourceFileName,
        ImportedAt = contact.ImportedAt
    };

    private static void TallyOutcome(
        ContactSyncOutcome outcome,
        ref int added,
        ref int updated,
        ref int deleted,
        ref int skipped)
    {
        switch (outcome)
        {
            case ContactSyncOutcome.Added:
                added++;
                break;
            case ContactSyncOutcome.Updated:
                updated++;
                break;
            case ContactSyncOutcome.Deleted:
                deleted++;
                break;
            default:
                skipped++;
                break;
        }
    }

    private static bool TryReadOperationFile(string filePath, out ContactSyncOperationFile operation)
    {
        try
        {
            var json = File.ReadAllText(filePath);
            operation = JsonSerializer.Deserialize<ContactSyncOperationFile>(json) ?? new ContactSyncOperationFile();
            if (string.IsNullOrWhiteSpace(operation.Operation))
                return false;

            operation.Operation = operation.Operation.Trim().ToLowerInvariant();
            if (operation.Operation is not (UpsertOperation or DeleteOperation))
                return false;

            operation.PhoneNumbers = NormalizePhones(operation.PhoneNumbers);
            return true;
        }
        catch
        {
            operation = new ContactSyncOperationFile();
            return false;
        }
    }

    private static void WriteOperationFile(string pendingOutboundPath, ContactSyncOperationFile operation)
    {
        Directory.CreateDirectory(pendingOutboundPath);
        var normalizedPhones = NormalizePhones(operation.PhoneNumbers);
        var key = normalizedPhones.FirstOrDefault() ?? "contact";
        var stamp = DateTime.UtcNow.ToString("yyyyMMddTHHmmssfff");
        var fileName = $"{stamp}_{operation.Operation}_{key}{OperationExtension}";
        var filePath = Path.Combine(pendingOutboundPath, fileName);
        var json = JsonSerializer.Serialize(operation, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(filePath, json);
    }
}

public class ContactImportResult
{
    public List<ContactEntry> MergedContacts { get; set; } = new();
    public int AddedContacts { get; set; }
    public int UpdatedContacts { get; set; }
    public int DeletedContacts { get; set; }
    public int SkippedContacts { get; set; }
    public int ProcessedFiles { get; set; }
    public int PendingFilesRemaining { get; set; }
}

public class QueuedContactSyncResult
{
    public bool Succeeded { get; set; }
    public string Message { get; set; } = "";
    public string DeviceAddress { get; set; } = "";
    public string PendingPath { get; set; } = "";
    public int QueuedCount { get; set; }
    public int PendingQueueCount { get; set; }

    public static QueuedContactSyncResult CreateFailure(string message) => new()
    {
        Succeeded = false,
        Message = message
    };

    public static QueuedContactSyncResult CreateSuccess(
        string deviceAddress,
        string pendingPath,
        int queuedCount,
        int pendingQueueCount) => new()
        {
            Succeeded = true,
            DeviceAddress = deviceAddress,
            PendingPath = pendingPath,
            QueuedCount = queuedCount,
            PendingQueueCount = pendingQueueCount
        };
}

public class ContactSyncOperationFile
{
    public string Operation { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public List<string> PhoneNumbers { get; set; } = new();
    public string DeviceAddress { get; set; } = "";
    public string Source { get; set; } = "";
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
}

public enum ContactSyncOutcome
{
    Skipped,
    Added,
    Updated,
    Deleted
}
