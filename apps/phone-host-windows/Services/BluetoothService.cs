using DeskPhone.Models;
using InTheHand.Net.Bluetooth;
using InTheHand.Net.Sockets;

namespace DeskPhone.Services;

// Named BluetoothScanner (not BluetoothService) to avoid shadowing
// InTheHand.Net.Bluetooth.BluetoothService, which holds the service UUID constants.
public class BluetoothScanner
{
    public event Action<string>? StatusChanged;

    /// <summary>
    /// Returns all devices the Windows Bluetooth stack knows about —
    /// previously paired and currently discoverable.
    /// </summary>
    public Task<List<BluetoothDeviceModel>> DiscoverDevicesAsync(
        CancellationToken ct = default)
    {
        return Task.Run(() =>
        {
            StatusChanged?.Invoke("Scanning for Bluetooth devices…");
            var results = new List<BluetoothDeviceModel>();

            using var client = new BluetoothClient();

            // Paired / remembered devices — instant, no radio scan needed.
            // Windows/InTheHand cache DeviceName and Connected at pairing time, so a
            // phone renamed after pairing (or one that's since gone out of range)
            // reports stale info unless we force a live re-query per device.
            try
            {
                foreach (var d in client.PairedDevices)
                {
                    ct.ThrowIfCancellationRequested();
                    try { d.Refresh(); } catch { /* best-effort; fall back to cached values */ }
                    results.Add(new BluetoothDeviceModel(d));
                }
            }
            catch (OperationCanceledException) { throw; }
            catch { /* Bluetooth off or no paired devices */ }

            ct.ThrowIfCancellationRequested();

            // Also scan radio for newly discoverable devices nearby
            try
            {
                var nearby = client.DiscoverDevices(20);
                foreach (var d in nearby)
                {
                    ct.ThrowIfCancellationRequested();
                    if (!results.Any(r => r.Address == d.DeviceAddress))
                        results.Add(new BluetoothDeviceModel(d));
                }
            }
            catch (OperationCanceledException) { throw; }
            catch { /* discovery timed out — paired list is still useful */ }

            // Currently-connected devices first, so the list leads with what's actually
            // reachable right now instead of burying it under every device ever paired.
            var ordered = results
                .OrderByDescending(r => r.IsConnected)
                .ThenBy(r => r.Name, StringComparer.OrdinalIgnoreCase)
                .ToList();

            StatusChanged?.Invoke(ordered.Count == 0
                ? "No devices found — is Bluetooth on?"
                : $"{ordered.Count} device(s) found");

            return ordered;
        }, ct);
    }

    /// <summary>
    /// Checks whether a Bluetooth radio is present and accessible.
    /// </summary>
    public static bool IsBluetoothAvailable()
    {
        try { return BluetoothRadio.Default != null; }
        catch { return false; }
    }
}
