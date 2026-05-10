using InTheHand.Net;
using InTheHand.Net.Sockets;
using DeskPhone.Models;
using System.Globalization;
using System.Text;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.Rfcomm;

namespace DeskPhone.Services;

public sealed class PbapService
{
    private static readonly Guid PbapPseUuid = new("0000112F-0000-1000-8000-00805F9B34FB");
    private const byte ObexSuccess = 0xA0;
    private static readonly byte[] PbapTargetUuid =
    {
        0x79, 0x61, 0x35, 0xF0, 0xF0, 0xC5, 0x11, 0xD8,
        0x09, 0x66, 0x08, 0x00, 0x20, 0x0C, 0x9A, 0x66
    };

    private readonly BluetoothDeviceConnector _connector = new();

    public event Action<string>? LogLine;

    public async Task<PbapConnectionResult> ConnectAsync(BluetoothAddress address, CancellationToken ct = default)
    {
        var sessionReady = await TryPrepareSessionAsync(address, ct);
        if (!sessionReady.IsConnected)
            return PbapConnectionResult.Unavailable(sessionReady.Kind, sessionReady.Summary, sessionReady.Guidance);

        try
        {
            await sessionReady.Obex!.DisconnectAsync(ct);
            LogLine?.Invoke($"[PBAP] OBEX DISCONNECT OK ({sessionReady.Mode})");
            return PbapConnectionResult.Connected("PBAP connected and ready for call-log import.");
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            LogLine?.Invoke($"[PBAP] OBEX DISCONNECT warning ({sessionReady.Mode}): {ex.Message}");
            return PbapConnectionResult.Connected("PBAP connected and ready for call-log import.");
        }
        finally
        {
            sessionReady.Dispose();
        }
    }

    public async Task<PbapCallLogImportResult> ImportCallLogsAsync(BluetoothAddress address, CancellationToken ct = default)
    {
        var sessionReady = await TryPrepareSessionAsync(address, ct);
        if (!sessionReady.IsConnected || sessionReady.Obex is null)
            return PbapCallLogImportResult.Unavailable(sessionReady.Kind, sessionReady.Summary, sessionReady.Guidance);

        try
        {
            var incoming = await DownloadPhonebookAsync(sessionReady.Obex, "ich.vcf", CallDirection.Incoming, address, ct);
            var outgoing = await DownloadPhonebookAsync(sessionReady.Obex, "och.vcf", CallDirection.Outgoing, address, ct);
            var missed = await DownloadPhonebookAsync(sessionReady.Obex, "mch.vcf", CallDirection.Missed, address, ct);

            var entries = incoming
                .Concat(outgoing)
                .Concat(missed)
                .OrderByDescending(entry => entry.Time)
                .ThenByDescending(entry => entry.ImportedAt)
                .ToList();

            LogLine?.Invoke($"[PBAP] Imported {entries.Count} total call log entries ({incoming.Count} incoming, {outgoing.Count} outgoing, {missed.Count} missed)");
            return PbapCallLogImportResult.Success(
                entries,
                $"PBAP connected and imported {entries.Count} phone call log entries ({incoming.Count} incoming, {outgoing.Count} outgoing, {missed.Count} missed).");
        }
        catch (PbapImportException ex)
        {
            LogLine?.Invoke($"[PBAP] Call-log import blocked: {ex.Message}");
            return PbapCallLogImportResult.Unavailable(ex.Kind, ex.Message, ex.Guidance);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            LogLine?.Invoke($"[PBAP] Call-log import failed: {ex.Message}");
            return PbapCallLogImportResult.Unavailable(
                PbapAvailabilityKind.ImportFailed,
                $"PBAP connected, but call-log import failed: {ex.Message}",
                "Reconnect the phone and try again. If the phone keeps refusing PBAP downloads, check whether Bluetooth contact and call-history sharing is enabled for this PC.");
        }
        finally
        {
            try
            {
                await sessionReady.Obex.DisconnectAsync(ct);
                LogLine?.Invoke($"[PBAP] OBEX DISCONNECT OK ({sessionReady.Mode})");
            }
            catch (Exception ex)
            {
                LogLine?.Invoke($"[PBAP] OBEX DISCONNECT warning ({sessionReady.Mode}): {ex.Message}");
            }

            sessionReady.Dispose();
        }
    }

    private void HandleConnectorLogLine(string line) => LogLine?.Invoke(line);

    private async Task<PbapSessionReady> TryPrepareSessionAsync(BluetoothAddress address, CancellationToken ct)
    {
        try
        {
            _connector.LogLine += HandleConnectorLogLine;

            var linkReady = await _connector.EnsureDeviceConnectedAsync(address, ct);
            if (!linkReady)
            {
                return PbapSessionReady.Unavailable(
                    PbapAvailabilityKind.ConnectionLost,
                    "Phone did not stay connected long enough to open PBAP call-log access.",
                    "Keep the phone awake and nearby until connection finishes, then reconnect.");
            }

            var addrUlong = Convert.ToUInt64(address.ToString().Replace(":", ""), 16);
            var device = await BluetoothDevice.FromBluetoothAddressAsync(addrUlong).AsTask(ct);
            if (device is null)
            {
                return PbapSessionReady.Unavailable(
                    PbapAvailabilityKind.Error,
                    "Windows could not open the phone for PBAP call-log access.",
                    "Reconnect the phone and try again. If Windows still cannot open PBAP, unpair and pair the phone again.");
            }

            var pbapServiceId = RfcommServiceId.FromUuid(PbapPseUuid);
            var serviceResult = await device.GetRfcommServicesForIdAsync(
                pbapServiceId, BluetoothCacheMode.Uncached).AsTask(ct);

            LogLine?.Invoke($"[PBAP] Service query error={serviceResult.Error}, count={serviceResult.Services.Count}");

            if (serviceResult.Error != BluetoothError.Success)
            {
                var assessment = AssessBluetoothServiceError(serviceResult.Error);
                return PbapSessionReady.Unavailable(assessment.Kind, assessment.Summary, assessment.Guidance);
            }

            if (serviceResult.Services.Count == 0)
            {
                return PbapSessionReady.Unavailable(
                    PbapAvailabilityKind.NotAdvertised,
                    "Phone did not advertise PBAP phonebook access to this PC.",
                    "On the phone, open Bluetooth settings for this PC and enable contacts or call-history sharing if that option exists. If sharing is already enabled, this phone may not expose PBAP call logs to Windows.");
            }

            var service = serviceResult.Services[0];
            LogLine?.Invoke($"[PBAP] Found service {service.ServiceId.Uuid} host={service.ConnectionHostName} svc={service.ConnectionServiceName}");

            const int maxAttempts = 3;
            Exception? lastEx = null;

            for (var attempt = 1; attempt <= maxAttempts; attempt++)
            {
                var targeted = await TryOpenSessionAsync(address, attempt, maxAttempts, PbapTargetUuid, "targeted OBEX", ct);
                if (targeted.IsConnected)
                    return targeted;

                if (targeted.Obex is not null || targeted.Client is not null)
                    targeted.Dispose();

                var fallback = await TryOpenSessionAsync(address, attempt, maxAttempts, null, "bare OBEX fallback", ct);
                if (fallback.IsConnected)
                    return fallback;

                if (fallback.Obex is not null || fallback.Client is not null)
                    fallback.Dispose();

                lastEx = fallback.Exception ?? targeted.Exception ?? lastEx;

                if (attempt < maxAttempts)
                    await Task.Delay(1500, ct);
            }

            if (lastEx is null)
            {
                return PbapSessionReady.Unavailable(
                    PbapAvailabilityKind.Error,
                    "Phone advertises PBAP, but DeskPhone could not open a stable PBAP session yet.",
                    "Reconnect the phone and try again. If PBAP keeps failing while calls and texts work, the phone may expose the profile but still refuse call-log access.");
            }

            var failure = AssessSessionException(lastEx);
            return PbapSessionReady.Unavailable(failure.Kind, failure.Summary, failure.Guidance);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            LogLine?.Invoke($"[PBAP] Connection failed: {ex.Message}");
            var failure = AssessSessionException(ex);
            return PbapSessionReady.Unavailable(failure.Kind, failure.Summary, failure.Guidance);
        }
        finally
        {
            _connector.LogLine -= HandleConnectorLogLine;
        }
    }

    private async Task<PbapSessionReady> TryOpenSessionAsync(
        BluetoothAddress address,
        int attempt,
        int totalAttempts,
        byte[]? targetUuid,
        string mode,
        CancellationToken ct)
    {
        BluetoothClient? client = null;
        ObexClient? obex = null;

        try
        {
            client = new BluetoothClient();
            await Task.Run(() => client.Connect(address, PbapPseUuid), ct);
            LogLine?.Invoke($"[PBAP] RFCOMM connected ({mode}, attempt {attempt}/{totalAttempts})");

            obex = new ObexClient(client.GetStream(), targetUuid);
            var ok = await obex.ConnectAsync(ct: ct);
            if (!ok)
            {
                LogLine?.Invoke($"[PBAP] OBEX CONNECT rejected ({mode}, attempt {attempt}/{totalAttempts})");
                return PbapSessionReady.Failed(mode, client, obex, null);
            }

            LogLine?.Invoke($"[PBAP] OBEX CONNECT OK ({mode}) ConnID={obex.ConnectionId}");
            return PbapSessionReady.Connected(mode, client, obex);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            LogLine?.Invoke($"[PBAP] {mode} attempt {attempt}/{totalAttempts} failed: {ex.Message}");
            return PbapSessionReady.Failed(mode, client, obex, ex);
        }
    }

    private async Task<List<PbapCallLogEntry>> DownloadPhonebookAsync(
        ObexClient obex,
        string objectName,
        CallDirection direction,
        BluetoothAddress address,
        CancellationToken ct)
    {
        await obex.SetPathAsync("", ct: ct);
        var telecomReady = await obex.SetPathAsync("telecom", ct: ct);
        ObexGetResult result;

        if (telecomReady)
        {
            result = await obex.GetResultAsync("x-bt/phonebook", objectName, ct: ct);
            if (result.ResponseCode == ObexSuccess && result.Body.Length == 0)
                result = await obex.GetResultAsync("x-bt/phonebook", $"telecom/{objectName}", ct: ct);
        }
        else
        {
            result = await obex.GetResultAsync("x-bt/phonebook", $"telecom/{objectName}", ct: ct);
        }

        if (result.ResponseCode != ObexSuccess)
            throw BuildImportException(result.ResponseCode, objectName);

        var raw = result.Body;
        LogLine?.Invoke($"[PBAP] Downloaded {objectName} ({raw.Length} bytes)");
        return ParseCallLogEntries(raw, direction, objectName, address.ToString());
    }

    private static PbapFailureAssessment AssessBluetoothServiceError(BluetoothError error)
    {
        if (error == BluetoothError.DeviceNotConnected)
        {
            return new(
                PbapAvailabilityKind.ConnectionLost,
                "Phone dropped before PBAP call-log access could finish opening.",
                "Keep the phone awake and nearby until connection finishes, then reconnect.");
        }

        var errorText = error.ToString();
        if (errorText.Contains("access", StringComparison.OrdinalIgnoreCase) ||
            errorText.Contains("denied", StringComparison.OrdinalIgnoreCase))
        {
            return new(
                PbapAvailabilityKind.PermissionRequired,
                $"Windows was denied PBAP access while opening the phone ({error}).",
                "On the phone, allow Bluetooth contact or call-history sharing for this PC, then reconnect.");
        }

        return new(
            PbapAvailabilityKind.Error,
            $"Windows returned {error} while opening PBAP.",
            "Reconnect the phone and try again. If Windows keeps refusing PBAP while calls work, unpair and pair the phone again.");
    }

    private static PbapFailureAssessment AssessSessionException(Exception ex)
    {
        var message = ex.Message;
        if (ContainsAny(message, "access is denied", "access denied", "unauthorized", "forbidden", "authentication"))
        {
            return new(
                PbapAvailabilityKind.PermissionRequired,
                $"Phone advertised PBAP, but refused call-log access: {message}",
                "On the phone, open Bluetooth settings for this PC and turn on contacts or call-history sharing, then reconnect.");
        }

        if (ContainsAny(message, "closed", "reset", "aborted", "timed out", "timeout", "device not connected"))
        {
            return new(
                PbapAvailabilityKind.ConnectionLost,
                $"Phone advertised PBAP, but the session dropped before call-log access was ready: {message}",
                "Keep the phone unlocked, nearby, and on the same Bluetooth connection until PBAP finishes opening.");
        }

        if (ContainsAny(message, "not found", "no such service", "service discovery"))
        {
            return new(
                PbapAvailabilityKind.NotAdvertised,
                $"Phone did not expose a usable PBAP call-log session: {message}",
                "If the phone has a Bluetooth contacts or call-history sharing toggle for this PC, turn it on and reconnect. Otherwise the phone may not support PBAP call logs.");
        }

        return new(
            PbapAvailabilityKind.Error,
            $"PBAP connection failed: {message}",
            "Reconnect the phone and try again. If PBAP still fails while calls and messages work, the phone may partially advertise PBAP without granting call-log access.");
    }

    private static PbapImportException BuildImportException(byte responseCode, string objectName)
    {
        return responseCode switch
        {
            0x00 => new PbapImportException(
                PbapAvailabilityKind.ConnectionLost,
                $"Phone dropped the PBAP call-log download while fetching {objectName}.",
                "Keep the phone awake and nearby until PBAP finishes syncing, then reconnect."),
            0xC1 or 0xC3 => new PbapImportException(
                PbapAvailabilityKind.PermissionRequired,
                $"Phone refused PBAP call-log download for {objectName} (OBEX 0x{responseCode:X2}).",
                "On the phone, open Bluetooth settings for this PC and enable contacts or call-history sharing, then reconnect."),
            0xC4 or 0xD3 => new PbapImportException(
                PbapAvailabilityKind.NotAdvertised,
                $"Phone opened PBAP, but did not expose the expected call-log book {objectName} (OBEX 0x{responseCode:X2}).",
                "Some phones expose PBAP contacts but not call history. If the phone has a sharing toggle for this PC, enable it and reconnect."),
            _ => new PbapImportException(
                PbapAvailabilityKind.ImportFailed,
                $"PBAP call-log download failed for {objectName} (OBEX 0x{responseCode:X2}).",
                "Reconnect the phone and try again. If the phone keeps rejecting PBAP downloads, it may not permit call-log sync to Windows.")
        };
    }

    private static bool ContainsAny(string text, params string[] fragments) =>
        fragments.Any(fragment => text.Contains(fragment, StringComparison.OrdinalIgnoreCase));

    private static List<PbapCallLogEntry> ParseCallLogEntries(
        byte[] raw,
        CallDirection direction,
        string sourceObject,
        string deviceAddress)
    {
        if (raw.Length == 0)
            return new List<PbapCallLogEntry>();

        var text = DecodeText(raw);
        var lines = UnfoldLines(text);
        var entries = new List<PbapCallLogEntry>();
        List<string>? cardLines = null;

        foreach (var line in lines)
        {
            if (line.Equals("BEGIN:VCARD", StringComparison.OrdinalIgnoreCase))
            {
                cardLines = new List<string>();
                continue;
            }

            if (line.Equals("END:VCARD", StringComparison.OrdinalIgnoreCase))
            {
                if (cardLines is not null)
                {
                    var entry = ParseCard(cardLines, direction, sourceObject, deviceAddress);
                    if (entry is not null)
                        entries.Add(entry);
                }
                cardLines = null;
                continue;
            }

            cardLines?.Add(line);
        }

        return entries;
    }

    private static PbapCallLogEntry? ParseCard(
        IEnumerable<string> lines,
        CallDirection direction,
        string sourceObject,
        string deviceAddress)
    {
        string number = "";
        string name = "";
        string structuredName = "";
        string rawTimestamp = "";
        DateTime timestamp = DateTime.Now;

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
                         .Where(part => !string.IsNullOrWhiteSpace(part))
                         .Select(part => part.Trim()));
            }
            else if (property.Equals("TEL", StringComparison.OrdinalIgnoreCase))
            {
                number = ContactStoreService.NormalizePhone(value);
            }
            else if (property.Equals("X-IRMC-CALL-DATETIME", StringComparison.OrdinalIgnoreCase))
            {
                rawTimestamp = value;
                if (TryParseCallDateTime(value, out var parsed))
                    timestamp = parsed;
            }
        }

        if (string.IsNullOrWhiteSpace(number) && string.IsNullOrWhiteSpace(name) && string.IsNullOrWhiteSpace(structuredName))
            return null;

        var displayName = !string.IsNullOrWhiteSpace(name)
            ? name
            : !string.IsNullOrWhiteSpace(structuredName)
                ? structuredName
                : null;

        return new PbapCallLogEntry
        {
            Number = number,
            Name = displayName,
            Direction = direction,
            Time = timestamp,
            RawTimestamp = rawTimestamp,
            SourceObject = sourceObject,
            SourceDeviceAddress = deviceAddress,
            ImportedAt = DateTime.Now
        };
    }

    private static bool TryParseCallDateTime(string value, out DateTime timestamp)
    {
        var formats = new[]
        {
            "yyyyMMdd'T'HHmmss",
            "yyyyMMdd'T'HHmmss'Z'",
            "yyyyMMdd'T'HHmmsszzzz",
            "yyyyMMdd'T'HHmmsszzz"
        };

        if (DateTime.TryParseExact(
                value,
                formats,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AllowWhiteSpaces | DateTimeStyles.AssumeLocal,
                out timestamp))
        {
            if (value.EndsWith('Z'))
                timestamp = DateTime.SpecifyKind(timestamp, DateTimeKind.Utc).ToLocalTime();
            return true;
        }

        timestamp = DateTime.Now;
        return false;
    }

    private static string DecodeText(byte[] raw)
    {
        var utf8 = Encoding.UTF8.GetString(raw);
        return utf8.Contains("BEGIN:VCARD", StringComparison.OrdinalIgnoreCase)
            ? utf8
            : Encoding.ASCII.GetString(raw);
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

    private sealed class PbapSessionReady : IDisposable
    {
        public bool IsConnected { get; init; }
        public PbapAvailabilityKind Kind { get; init; }
        public string Summary { get; init; } = "";
        public string Guidance { get; init; } = "";
        public string Mode { get; init; } = "";
        public BluetoothClient? Client { get; init; }
        public ObexClient? Obex { get; init; }
        public Exception? Exception { get; init; }

        public static PbapSessionReady Connected(string mode, BluetoothClient client, ObexClient obex) => new()
        {
            IsConnected = true,
            Kind = PbapAvailabilityKind.Connected,
            Mode = mode,
            Summary = "PBAP connected and ready for call-log import.",
            Client = client,
            Obex = obex
        };

        public static PbapSessionReady Failed(string mode, BluetoothClient? client, ObexClient? obex, Exception? exception) => new()
        {
            IsConnected = false,
            Mode = mode,
            Client = client,
            Obex = obex,
            Exception = exception
        };

        public static PbapSessionReady Unavailable(PbapAvailabilityKind kind, string summary, string guidance = "") => new()
        {
            IsConnected = false,
            Kind = kind,
            Summary = summary,
            Guidance = guidance
        };

        public void Dispose()
        {
            Obex?.Dispose();
            Client?.Dispose();
        }
    }

    private readonly record struct PbapFailureAssessment(PbapAvailabilityKind Kind, string Summary, string Guidance);

    private sealed class PbapImportException : Exception
    {
        public PbapAvailabilityKind Kind { get; }
        public string Guidance { get; }

        public PbapImportException(PbapAvailabilityKind kind, string summary, string guidance)
            : base(summary)
        {
            Kind = kind;
            Guidance = guidance;
        }
    }
}

public enum PbapAvailabilityKind
{
    NotRun,
    Checking,
    Connected,
    NotAdvertised,
    PermissionRequired,
    ConnectionLost,
    ImportFailed,
    Error
}

public sealed record PbapConnectionResult(bool IsConnected, PbapAvailabilityKind Kind, string Summary, string Guidance)
{
    public static PbapConnectionResult Connected(string summary) => new(true, PbapAvailabilityKind.Connected, summary, "");
    public static PbapConnectionResult Unavailable(PbapAvailabilityKind kind, string summary, string guidance = "") => new(false, kind, summary, guidance);
}

public sealed record PbapCallLogImportResult(bool Succeeded, IReadOnlyList<PbapCallLogEntry> Entries, PbapAvailabilityKind Kind, string Summary, string Guidance)
{
    public static PbapCallLogImportResult Success(IReadOnlyList<PbapCallLogEntry> entries, string summary) => new(true, entries, PbapAvailabilityKind.Connected, summary, "");
    public static PbapCallLogImportResult Unavailable(PbapAvailabilityKind kind, string summary, string guidance = "") => new(false, Array.Empty<PbapCallLogEntry>(), kind, summary, guidance);
}
