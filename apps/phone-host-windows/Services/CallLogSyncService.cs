using DeskPhone.Models;
using System.IO;
using System.Text.Json;

namespace DeskPhone.Services;

public class CallLogSyncService
{
    private const string OperationExtension = ".calllogsync.json";
    private const string DeleteOperation = "delete";
    private const string DeleteAllOperation = "delete-all";

    private static readonly string RootPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "DeskPhone",
        "call-log-sync");

    public QueuedCallLogSyncResult QueueDeleteOperation(string? deviceAddress, CallRecord record)
    {
        if (string.IsNullOrWhiteSpace(deviceAddress))
            return QueuedCallLogSyncResult.CreateFailure("No device address is available for outbound call-log sync.");

        var state = GetState(deviceAddress);
        WriteOperationFile(state.PendingOutboundPath, new CallLogSyncOperationFile
        {
            Operation = DeleteOperation,
            DeviceAddress = deviceAddress,
            Number = ContactStoreService.NormalizePhone(record.Number),
            Direction = record.Direction,
            RawTimestamp = NormalizeTimestamp(record.PhoneLogTimestamp, record.Time),
            CreatedUtc = DateTime.UtcNow,
            Source = "DeskPhone"
        });

        return QueuedCallLogSyncResult.CreateSuccess(deviceAddress, state.PendingOutboundPath, 1, CountOperationFiles(state.PendingOutboundPath));
    }

    public QueuedCallLogSyncResult QueueDeleteAllOperation(string? deviceAddress)
    {
        if (string.IsNullOrWhiteSpace(deviceAddress))
            return QueuedCallLogSyncResult.CreateFailure("No device address is available for outbound call-log sync.");

        var state = GetState(deviceAddress);
        WriteOperationFile(state.PendingOutboundPath, new CallLogSyncOperationFile
        {
            Operation = DeleteAllOperation,
            DeviceAddress = deviceAddress,
            CreatedUtc = DateTime.UtcNow,
            Source = "DeskPhone"
        });

        return QueuedCallLogSyncResult.CreateSuccess(deviceAddress, state.PendingOutboundPath, 1, CountOperationFiles(state.PendingOutboundPath));
    }

    public int CancelPendingDeleteOperations(string? deviceAddress, IEnumerable<CallRecord> records)
    {
        if (string.IsNullOrWhiteSpace(deviceAddress))
            return 0;

        var state = GetState(deviceAddress);
        var deleteKeys = records
            .Select(record => BuildKey(
                deviceAddress,
                record.Direction,
                record.Number,
                record.PhoneLogTimestamp,
                record.Time))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        return DeletePendingFiles(state.PendingOutboundPath, deviceAddress, operation =>
            string.Equals(operation.Operation, DeleteOperation, StringComparison.OrdinalIgnoreCase) &&
            deleteKeys.Contains(BuildOperationKey(operation) ?? ""));
    }

    public int CancelPendingDeleteAllOperation(string? deviceAddress)
    {
        if (string.IsNullOrWhiteSpace(deviceAddress))
            return 0;

        var state = GetState(deviceAddress);
        return DeletePendingFiles(state.PendingOutboundPath, deviceAddress, operation =>
            string.Equals(operation.Operation, DeleteAllOperation, StringComparison.OrdinalIgnoreCase));
    }

    public List<PbapCallLogEntry> ApplyPendingOutboundDeletes(string? deviceAddress, IEnumerable<PbapCallLogEntry> entries)
    {
        var clonedEntries = entries
            .Select(CloneEntry)
            .ToList();

        if (string.IsNullOrWhiteSpace(deviceAddress))
            return SortEntries(clonedEntries);

        var state = GetState(deviceAddress);
        var pending = LoadPendingOperations(state.PendingOutboundPath, deviceAddress);
        if (pending.Count == 0)
            return SortEntries(clonedEntries);

        if (pending.Any(op => string.Equals(op.Operation, DeleteAllOperation, StringComparison.OrdinalIgnoreCase)))
        {
            return SortEntries(clonedEntries
                .Where(entry => !string.Equals(NormalizeDevice(entry.SourceDeviceAddress), NormalizeDevice(deviceAddress), StringComparison.OrdinalIgnoreCase))
                .ToList());
        }

        var deleteKeys = pending
            .Where(op => string.Equals(op.Operation, DeleteOperation, StringComparison.OrdinalIgnoreCase))
            .Select(BuildOperationKey)
            .Where(key => !string.IsNullOrWhiteSpace(key))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (deleteKeys.Count == 0)
            return SortEntries(clonedEntries);

        return SortEntries(clonedEntries
            .Where(entry => !deleteKeys.Contains(BuildEntryKey(entry)))
            .ToList());
    }

    private static CallLogSyncState GetState(string? deviceAddress)
    {
        var root = GetDeviceRoot(deviceAddress);
        var outbox = Path.Combine(root, "outbox");
        var pendingOutbound = Path.Combine(outbox, "pending");
        var imported = Path.Combine(outbox, "imported");
        var ignored = Path.Combine(outbox, "ignored");

        Directory.CreateDirectory(pendingOutbound);
        Directory.CreateDirectory(imported);
        Directory.CreateDirectory(ignored);

        return new CallLogSyncState
        {
            PendingOutboundPath = pendingOutbound
        };
    }

    private static List<CallLogSyncOperationFile> LoadPendingOperations(string pendingOutboundPath, string deviceAddress)
    {
        if (!Directory.Exists(pendingOutboundPath))
            return new List<CallLogSyncOperationFile>();

        var operations = new List<CallLogSyncOperationFile>();
        foreach (var file in Directory.GetFiles(pendingOutboundPath, $"*{OperationExtension}")
                     .OrderBy(path => File.GetLastWriteTimeUtc(path)))
        {
            if (!TryReadOperationFile(file, out var operation))
                continue;

            if (!string.Equals(NormalizeDevice(operation.DeviceAddress), NormalizeDevice(deviceAddress), StringComparison.OrdinalIgnoreCase))
                continue;

            operations.Add(operation);
        }

        return operations;
    }

    private static int DeletePendingFiles(
        string pendingOutboundPath,
        string deviceAddress,
        Func<CallLogSyncOperationFile, bool> predicate)
    {
        if (!Directory.Exists(pendingOutboundPath))
            return 0;

        var removed = 0;
        foreach (var file in Directory.GetFiles(pendingOutboundPath, $"*{OperationExtension}"))
        {
            if (!TryReadOperationFile(file, out var operation))
                continue;

            if (!string.Equals(NormalizeDevice(operation.DeviceAddress), NormalizeDevice(deviceAddress), StringComparison.OrdinalIgnoreCase))
                continue;

            if (!predicate(operation))
                continue;

            try
            {
                File.Delete(file);
                removed++;
            }
            catch { }
        }

        return removed;
    }

    private static bool TryReadOperationFile(string filePath, out CallLogSyncOperationFile operation)
    {
        try
        {
            var json = File.ReadAllText(filePath);
            operation = JsonSerializer.Deserialize<CallLogSyncOperationFile>(json) ?? new CallLogSyncOperationFile();
            operation.Operation = (operation.Operation ?? "").Trim().ToLowerInvariant();
            operation.DeviceAddress = NormalizeDevice(operation.DeviceAddress);
            operation.Number = ContactStoreService.NormalizePhone(operation.Number);
            operation.RawTimestamp = (operation.RawTimestamp ?? "").Trim();

            if (operation.Operation is not (DeleteOperation or DeleteAllOperation))
            {
                operation = new CallLogSyncOperationFile();
                return false;
            }

            return true;
        }
        catch
        {
            operation = new CallLogSyncOperationFile();
            return false;
        }
    }

    private static void WriteOperationFile(string pendingOutboundPath, CallLogSyncOperationFile operation)
    {
        Directory.CreateDirectory(pendingOutboundPath);

        var stamp = (operation.CreatedUtc == default ? DateTime.UtcNow : operation.CreatedUtc)
            .ToString("yyyyMMdd_HHmmssfff");
        var key = string.Equals(operation.Operation, DeleteAllOperation, StringComparison.OrdinalIgnoreCase)
            ? "all"
            : BuildSafeKey(BuildOperationKey(operation) ?? $"{operation.DeviceAddress}_{stamp}");
        var fileName = $"{stamp}_{operation.Operation}_{key}{OperationExtension}";
        var path = Path.Combine(pendingOutboundPath, fileName);

        var json = JsonSerializer.Serialize(operation, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(path, json);
    }

    private static int CountOperationFiles(string directoryPath)
    {
        if (!Directory.Exists(directoryPath))
            return 0;

        return Directory.GetFiles(directoryPath, $"*{OperationExtension}").Length;
    }

    private static string? BuildOperationKey(CallLogSyncOperationFile operation)
    {
        if (string.Equals(operation.Operation, DeleteAllOperation, StringComparison.OrdinalIgnoreCase))
            return null;

        return BuildKey(
            operation.DeviceAddress,
            operation.Direction,
            operation.Number,
            operation.RawTimestamp,
            default);
    }

    private static string BuildEntryKey(PbapCallLogEntry entry) => BuildKey(
        entry.SourceDeviceAddress,
        entry.Direction,
        entry.Number,
        entry.RawTimestamp,
        entry.Time);

    private static string BuildKey(
        string? deviceAddress,
        CallDirection direction,
        string? number,
        string? rawTimestamp,
        DateTime fallbackTime)
    {
        var phone = ContactStoreService.NormalizePhone(number);
        var timestamp = NormalizeTimestamp(rawTimestamp, fallbackTime);
        return $"{NormalizeDevice(deviceAddress)}|{direction}|{phone}|{timestamp}";
    }

    private static string NormalizeTimestamp(string? rawTimestamp, DateTime fallbackTime) =>
        !string.IsNullOrWhiteSpace(rawTimestamp)
            ? rawTimestamp.Trim()
            : fallbackTime == default
                ? ""
                : fallbackTime.ToUniversalTime().ToString("O");

    private static string NormalizeDevice(string? deviceAddress) =>
        (deviceAddress ?? "").Trim();

    private static string BuildSafeKey(string key) =>
        new string(key.Select(ch =>
            char.IsLetterOrDigit(ch) || ch is '-' or '_' ? ch : '_').ToArray());

    private static string GetDeviceRoot(string? deviceAddress)
    {
        var safe = BuildSafeKey(string.IsNullOrWhiteSpace(deviceAddress) ? "unknown-device" : deviceAddress);
        return Path.Combine(RootPath, safe);
    }

    private static PbapCallLogEntry CloneEntry(PbapCallLogEntry entry) => new()
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

    private static List<PbapCallLogEntry> SortEntries(IEnumerable<PbapCallLogEntry> entries) => entries
        .OrderByDescending(entry => entry.Time)
        .ThenByDescending(entry => entry.ImportedAt)
        .ToList();

    private sealed class CallLogSyncState
    {
        public string PendingOutboundPath { get; init; } = "";
    }

    private sealed class CallLogSyncOperationFile
    {
        public string Operation { get; set; } = "";
        public string DeviceAddress { get; set; } = "";
        public string Number { get; set; } = "";
        public CallDirection Direction { get; set; }
        public string RawTimestamp { get; set; } = "";
        public DateTime CreatedUtc { get; set; }
        public string Source { get; set; } = "";
    }
}

public sealed record QueuedCallLogSyncResult(
    bool Succeeded,
    string Message,
    string DeviceAddress,
    string PendingOutboundPath,
    int QueuedCount,
    int PendingQueueCount)
{
    public static QueuedCallLogSyncResult CreateSuccess(string? deviceAddress, string pendingOutboundPath, int queuedCount, int pendingQueueCount) =>
        new(true, "", deviceAddress ?? "", pendingOutboundPath, queuedCount, pendingQueueCount);

    public static QueuedCallLogSyncResult CreateFailure(string message) =>
        new(false, message, "", "", 0, 0);
}
