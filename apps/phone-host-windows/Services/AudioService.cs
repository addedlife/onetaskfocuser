using Microsoft.Win32;
using NAudio.CoreAudioApi;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace DeskPhone.Services;

/// <summary>
/// Enumerates Windows communications endpoints and inspects whether the
/// connected phone is actually surfaced to Windows as a call-audio target.
/// This lets DeskPhone distinguish between:
/// 1. HFP call control being present
/// 2. media-only A2DP being present
/// 3. a real speaker/mic path existing in Windows Sound
 /// </summary>
public class AudioService : IDisposable
{
    private const string BthEnumPath = @"SYSTEM\CurrentControlSet\Enum\BTHENUM";
    private const string HfpHandsFreeGuid = "0000111F-0000-1000-8000-00805F9B34FB";
    private const string HspHeadsetGatewayGuid = "00001112-0000-1000-8000-00805F9B34FB";
    private const string A2dpSinkGuid = "0000110A-0000-1000-8000-00805F9B34FB";

    private readonly MMDeviceEnumerator _enumerator = new();

    public record AudioDevice(string Id, string Name, bool IsDefault);
    public record AudioRouteSnapshot(
        IReadOnlyList<AudioDevice> PlaybackDevices,
        IReadOnlyList<AudioDevice> RecordingDevices,
        string Summary,
        string LogLine);

    private sealed record BluetoothProfileState(bool Present, int? ConnectionCount);

    public List<AudioDevice> GetPlaybackDevices()
    {
        var defaultId = TryGetDefaultEndpointId(DataFlow.Render);
        var col       = _enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active);
        var list     = new List<AudioDevice>();

        foreach (var d in col)
            list.Add(new AudioDevice(d.ID, d.FriendlyName, d.ID == defaultId));

        return list;
    }

    public List<AudioDevice> GetRecordingDevices()
    {
        var defaultId = TryGetDefaultEndpointId(DataFlow.Capture);
        var col       = _enumerator.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active);
        var list     = new List<AudioDevice>();

        foreach (var d in col)
            list.Add(new AudioDevice(d.ID, d.FriendlyName, d.ID == defaultId));

        return list;
    }

    public AudioRouteSnapshot GetRouteSnapshot(string? bluetoothAddress, string? deviceName)
    {
        var playbackDevices  = GetPlaybackDevices();
        var recordingDevices = GetRecordingDevices();

        var normalizedAddress = NormalizeBluetoothAddress(bluetoothAddress);
        var label = string.IsNullOrWhiteSpace(deviceName)
            ? (!string.IsNullOrWhiteSpace(normalizedAddress) ? normalizedAddress : "the current phone")
            : deviceName!;

        var hfp  = FindProfileState(normalizedAddress, HfpHandsFreeGuid);
        var hsp  = FindProfileState(normalizedAddress, HspHeadsetGatewayGuid);
        var a2dp = FindProfileState(normalizedAddress, A2dpSinkGuid);

        var matchingPlayback = playbackDevices
            .Where(device => MatchesPhoneEndpoint(device.Name, deviceName))
            .Select(device => device.Name)
            .ToList();
        var matchingRecording = recordingDevices
            .Where(device => MatchesPhoneEndpoint(device.Name, deviceName))
            .Select(device => device.Name)
            .ToList();

        return new AudioRouteSnapshot(
            playbackDevices,
            recordingDevices,
            BuildSummary(
                label,
                normalizedAddress,
                hfp,
                hsp,
                a2dp,
                matchingPlayback,
                matchingRecording),
            BuildLogLine(
                label,
                normalizedAddress,
                hfp,
                hsp,
                a2dp,
                matchingPlayback.Count > 0,
                matchingRecording.Count > 0));
    }

    private string? TryGetDefaultEndpointId(DataFlow dataFlow)
    {
        try
        {
            return _enumerator.GetDefaultAudioEndpoint(dataFlow, Role.Communications).ID;
        }
        catch
        {
            return null;
        }
    }

    private static string NormalizeBluetoothAddress(string? bluetoothAddress)
        => string.IsNullOrWhiteSpace(bluetoothAddress)
            ? ""
            : bluetoothAddress.Replace(":", "")
                              .Replace("-", "")
                              .Trim()
                              .ToUpperInvariant();

    private static bool MatchesPhoneEndpoint(string endpointName, string? deviceName)
    {
        if (string.IsNullOrWhiteSpace(deviceName))
            return false;

        return endpointName.Contains(deviceName, StringComparison.OrdinalIgnoreCase);
    }

    private static BluetoothProfileState FindProfileState(string normalizedAddress, string serviceGuid)
    {
        if (string.IsNullOrWhiteSpace(normalizedAddress))
            return new BluetoothProfileState(false, null);

        using var bthEnum = Registry.LocalMachine.OpenSubKey(BthEnumPath);
        if (bthEnum is null)
            return new BluetoothProfileState(false, null);

        foreach (var serviceKeyName in bthEnum.GetSubKeyNames())
        {
            if (!serviceKeyName.Contains(serviceGuid, StringComparison.OrdinalIgnoreCase))
                continue;

            using var serviceKey = bthEnum.OpenSubKey(serviceKeyName);
            if (serviceKey is null)
                continue;

            foreach (var instanceKeyName in serviceKey.GetSubKeyNames())
            {
                if (!instanceKeyName.Contains(normalizedAddress, StringComparison.OrdinalIgnoreCase))
                    continue;

                using var instanceKey = serviceKey.OpenSubKey(instanceKeyName);
                using var deviceParameters = instanceKey?.OpenSubKey("Device Parameters");

                int? connectionCount = null;
                var connectionValue = deviceParameters?.GetValue("ConnectionCount");
                if (connectionValue is not null)
                {
                    try { connectionCount = Convert.ToInt32(connectionValue); }
                    catch { }
                }

                return new BluetoothProfileState(true, connectionCount);
            }
        }

        return new BluetoothProfileState(false, null);
    }

    private static string BuildSummary(
        string label,
        string normalizedAddress,
        BluetoothProfileState hfp,
        BluetoothProfileState hsp,
        BluetoothProfileState a2dp,
        IReadOnlyList<string> matchingPlayback,
        IReadOnlyList<string> matchingRecording)
    {
        if (string.IsNullOrWhiteSpace(normalizedAddress) && string.IsNullOrWhiteSpace(label))
        {
            return "DeskPhone is listing Windows communications devices. Connect or select a phone to inspect its call-audio path.";
        }

        if (!hfp.Present)
        {
            return $"{label} is not registered in Windows as a Hands-Free Profile target yet.\n\n" +
                   "DeskPhone can still show general Windows audio devices, but phone-call audio cannot route through the PC until Windows finishes pairing the phone for call audio.";
        }

        if (matchingPlayback.Count == 0 && matchingRecording.Count == 0)
        {
            var builder = new StringBuilder();
            builder.Append(label)
                   .Append(" is paired for hands-free control, but Windows has not created a usable call-audio endpoint for it.");

            builder.Append("\n\n");
            builder.Append("HFP driver present: yes");
            if (hfp.ConnectionCount.HasValue)
                builder.Append("\nHFP driver connection count: ").Append(hfp.ConnectionCount.Value);
            builder.Append("\nA2DP media path present: ").Append(a2dp.Present ? "yes" : "no");
            builder.Append("\nHeadset-gateway path present: ").Append(hsp.Present ? "yes" : "no");
            builder.Append("\nWindows playback endpoint for this phone: no");
            builder.Append("\nWindows microphone endpoint for this phone: no");

            builder.Append("\n\n");
            builder.Append("That is why DeskPhone can answer, hang up, and dial while voice still stays on the phone.");
            builder.Append("\nThis is not a normal Sound Settings selection problem, because there is no matching speaker or mic device in Windows Sound for this phone right now.");
            return builder.ToString();
        }

        var playbackLabel = matchingPlayback.Count == 0
            ? "none"
            : string.Join(", ", matchingPlayback);
        var recordingLabel = matchingRecording.Count == 0
            ? "none"
            : string.Join(", ", matchingRecording);

        return $"{label} has Windows call-audio endpoints available.\n\n" +
               $"Playback endpoint(s): {playbackLabel}\n" +
               $"Microphone endpoint(s): {recordingLabel}\n\n" +
               "If live call audio still does not move through the PC, the remaining fault is the active stream-attachment phase rather than Bluetooth pairing.";
    }

    private static string BuildLogLine(
        string label,
        string normalizedAddress,
        BluetoothProfileState hfp,
        BluetoothProfileState hsp,
        BluetoothProfileState a2dp,
        bool hasPlaybackEndpoint,
        bool hasRecordingEndpoint)
        => $"[AUDIO ROUTE] device='{label}' addr={FormatAddressForLog(normalizedAddress)} " +
           $"hfp={BoolFlag(hfp.Present)} hfpConnections={(hfp.ConnectionCount?.ToString() ?? "n/a")} " +
           $"hsp={BoolFlag(hsp.Present)} a2dp={BoolFlag(a2dp.Present)} " +
           $"playbackEndpoint={BoolFlag(hasPlaybackEndpoint)} captureEndpoint={BoolFlag(hasRecordingEndpoint)}";

    private static string FormatAddressForLog(string normalizedAddress)
        => string.IsNullOrWhiteSpace(normalizedAddress) ? "n/a" : normalizedAddress;

    private static string BoolFlag(bool value) => value ? "yes" : "no";

    public void Dispose() => _enumerator.Dispose();
}
