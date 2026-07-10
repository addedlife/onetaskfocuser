using DeskPhone.Models;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Text.Json;

namespace DeskPhone.Services;

/// <summary>
/// Saves and loads SMS messages to a local JSON file so they persist
/// between app launches and serve as a data backup.
/// Stored in %APPDATA%\DeskPhone\messages.json
/// </summary>
public class MessageStoreService
{
    private static readonly string StorePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "DeskPhone", "messages.json");

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = true
    };

    public List<SmsMessage> Load(out List<string> purgedMmsHandles)
    {
        purgedMmsHandles = new List<string>();
        try
        {
            if (File.Exists(StorePath))
            {
                var json = File.ReadAllText(StorePath);
                var msgs = JsonSerializer.Deserialize<List<SmsMessage>>(json, JsonOpts)
                           ?? new List<SmsMessage>();

                if (!json.Contains("\"IsRead\"", StringComparison.Ordinal))
                {
                    foreach (var msg in msgs)
                        msg.IsRead = true;
                }

                var bad = msgs.Where(m => m.IsMms && !m.HasImageAttachment && string.IsNullOrEmpty(m.Body)).ToList();
                purgedMmsHandles = bad.Select(m => m.Handle).Where(h => !string.IsNullOrEmpty(h)).ToList();
                foreach (var b in bad) msgs.Remove(b);

                return msgs;
            }
        }
        catch { }
        return new List<SmsMessage>();
    }

    public List<SmsMessage> Load() => Load(out _);

    public void Save(IEnumerable<SmsMessage> messages)
    {
        try
        {
            WriteJson(StorePath, messages);
        }
        catch { }
    }

    public void Export(string destinationPath, IEnumerable<SmsMessage> messages) =>
        WriteJson(destinationPath, messages);

    public static string NormalizeDeviceAddress(string? address) =>
        string.IsNullOrWhiteSpace(address) ? "" : address.Trim();

    public static bool SameDevice(string? left, string? right) =>
        string.Equals(NormalizeDeviceAddress(left), NormalizeDeviceAddress(right), StringComparison.OrdinalIgnoreCase);

    public (List<SmsMessage> merged, int newCount) Merge(
        IEnumerable<SmsMessage> existing,
        IEnumerable<SmsMessage> fromPhone)
    {
        var byHandle = new Dictionary<string, SmsMessage>(StringComparer.OrdinalIgnoreCase);
        var byLocalId = new Dictionary<string, SmsMessage>(StringComparer.OrdinalIgnoreCase);

        foreach (var m in existing)
        {
            var device = NormalizeDeviceAddress(m.SourceDeviceAddress);
            if (!string.IsNullOrEmpty(m.Handle))
                byHandle[BuildStoreKey(device, m.Handle)] = m;
            else if (!string.IsNullOrEmpty(m.LocalId))
                byLocalId[BuildStoreKey(device, m.LocalId)] = m;
            else
            {
                var fallback = $"local_{m.Timestamp.Ticks}_{m.Body?.GetHashCode()}";
                byHandle[BuildStoreKey(device, fallback)] = m;
            }
        }

        int newCount = 0;
        foreach (var m in fromPhone)
        {
            var device = NormalizeDeviceAddress(m.SourceDeviceAddress);
            if (!string.IsNullOrEmpty(m.Handle))
            {
                var handleKey = BuildStoreKey(device, m.Handle);
                if (!byHandle.ContainsKey(handleKey))
                {
                    var matched = byLocalId.Values.FirstOrDefault(local =>
                        local.IsSent &&
                        SameDevice(local.SourceDeviceAddress, m.SourceDeviceAddress) &&
                        local.NormalizedPhone == m.NormalizedPhone &&
                        Math.Abs((local.Timestamp - m.Timestamp).TotalSeconds) < ReconcileWindowSeconds(local) &&
                        SameMessageBody(local.Body, m.Body));

                    if (matched != null)
                    {
                        byLocalId.Remove(BuildStoreKey(matched.SourceDeviceAddress, matched.LocalId!));
                        PreserveRicherLocalBody(m, matched);
                        PreserveRicherAttachments(m, matched);
                        if (string.IsNullOrWhiteSpace(m.SourceDeviceAddress))
                            m.SourceDeviceAddress = matched.SourceDeviceAddress;
                        // Keep the bubble's identity (id = LocalId in the API) so the
                        // web composer's echo id survives phone-copy adoption.
                        m.LocalId ??= matched.LocalId;
                        m.SendStatus = "";
                        byHandle[BuildStoreKey(m.SourceDeviceAddress, m.Handle)] = m;
                    }
                    else
                    {
                        newCount++;
                        byHandle[handleKey] = m;
                    }
                }
                else
                {
                    var existing2 = byHandle[handleKey];
                    PreserveRicherLocalBody(m, existing2);
                    PreserveRicherAttachments(m, existing2);
                    if (string.IsNullOrWhiteSpace(m.SourceDeviceAddress))
                        m.SourceDeviceAddress = existing2.SourceDeviceAddress;
                    if (m.IsSent)
                        m.SendStatus = "";
                    byHandle[BuildStoreKey(m.SourceDeviceAddress, m.Handle)] = m;
                }
            }
            else
            {
                var key = BuildStoreKey(device, $"phone_{m.Timestamp.Ticks}_{m.Body?.GetHashCode()}");
                if (!byHandle.ContainsKey(key)) { newCount++; byHandle[key] = m; }
            }
        }

        var merged = byHandle.Values
            .Concat(byLocalId.Values)
            .OrderByDescending(m => m.Timestamp)
            .ToList();

        return (merged, newCount);
    }

    // How far apart the local bubble's PC-clock timestamp and the phone-side
    // copy's phone-clock timestamp may be and still count as the SAME send.
    // 90 s was too tight: a couple minutes of PC↔phone clock skew (common)
    // beat it, the local "Confirming" bubble never adopted the phone's sent
    // copy, and the thread showed the message TWICE — one "Sent", one stuck
    // on "Confirming on phone" forever (owner ticket 7/9). While the local
    // bubble still carries an in-flight status it can only be our own recent
    // send, so a 15-minute window is safe; already-confirmed locals keep the
    // tight window.
    private static double ReconcileWindowSeconds(SmsMessage local) =>
        string.IsNullOrWhiteSpace(local.SendStatus) ? 90 : 900;

    private static string BuildStoreKey(string? deviceAddress, string rawKey) =>
        $"{NormalizeDeviceAddress(deviceAddress)}|{rawKey}";

    private static bool SameMessageBody(string? left, string? right)
    {
        var normalizedLeft = NormalizeBodyForComparison(left);
        var normalizedRight = NormalizeBodyForComparison(right);
        if (normalizedLeft.Length == 0 || normalizedRight.Length == 0)
            return true;

        if (normalizedLeft.Length >= 10 || normalizedRight.Length >= 10)
        {
            var leftPrefix = normalizedLeft[..Math.Min(normalizedLeft.Length, 30)];
            var rightPrefix = normalizedRight[..Math.Min(normalizedRight.Length, 30)];
            return normalizedRight.StartsWith(leftPrefix, StringComparison.OrdinalIgnoreCase) ||
                   normalizedLeft.StartsWith(rightPrefix, StringComparison.OrdinalIgnoreCase);
        }

        return string.Equals(normalizedLeft, normalizedRight, StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizeBodyForComparison(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return "";

        var normalized = value.Replace("\r\n", "\n").Replace('\r', '\n');
        normalized = Regex.Replace(normalized, "[ \t]+", " ");
        normalized = Regex.Replace(normalized, "\n+", "\n");
        return normalized.Trim();
    }

    private static void PreserveRicherLocalBody(SmsMessage incoming, SmsMessage local)
    {
        if (string.IsNullOrWhiteSpace(local.Body))
            return;

        if (NewlineCount(local.Body) > NewlineCount(incoming.Body))
            incoming.Body = local.Body;
    }

    private static void PreserveRicherAttachments(SmsMessage incoming, SmsMessage local)
    {
        if (incoming.Attachments.Count == 0 && local.Attachments.Count > 0)
            incoming.Attachments = local.Attachments
                .Select(CloneAttachment)
                .ToList();

        if ((incoming.AttachmentData == null || incoming.AttachmentData.Length == 0) &&
            local.AttachmentData is { Length: > 0 })
            incoming.AttachmentData = local.AttachmentData.ToArray();
    }

    private static MessageAttachment CloneAttachment(MessageAttachment attachment) => new()
    {
        ContentType = attachment.ContentType,
        FileName = attachment.FileName,
        Data = attachment.Data.ToArray()
    };

    private static int NewlineCount(string? value)
    {
        if (string.IsNullOrEmpty(value))
            return 0;

        return value.Replace("\r\n", "\n").Replace('\r', '\n').Count(c => c == '\n');
    }

    private static void WriteJson(string destinationPath, IEnumerable<SmsMessage> messages)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
        var json = JsonSerializer.Serialize(messages.ToList(), JsonOpts);
        File.WriteAllText(destinationPath, json);
    }
}
