using InTheHand.Net;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.Rfcomm;
using System.Diagnostics;

namespace DeskPhone.Services;

/// <summary>
/// Ensures a Bluetooth device is connected at the link level before
/// HFP and MAP attempt service discovery.
///
/// Windows requires an active BT link to perform SDP queries. Without this,
/// GetRfcommServicesForIdAsync returns 0 services even though the device has them.
///
/// Strategy: Open a minimal L2CAP or dummy RFCOMM connection to establish the link,
/// then close it. This forces Windows to establish the physical connection and
/// cache the SDP response, making subsequent service discovery fast.
/// </summary>
public class BluetoothDeviceConnector
{
    public event Action<string>? LogLine;

    private void Log(string msg) => LogLine?.Invoke(msg);

    /// <summary>
    /// Ensures the device is connected by establishing and closing a probe connection.
    /// Returns true if successful, false if the device is unreachable.
    /// Logs all diagnostic info.
    /// </summary>
    public async Task<bool> EnsureDeviceConnectedAsync(BluetoothAddress deviceAddress,
                                                       CancellationToken ct = default)
    {
        try
        {
            ulong addrUlong = Convert.ToUInt64(
                deviceAddress.ToString().Replace(":", ""), 16);

            Log($"[BT CONNECT] Checking device {deviceAddress}");
            var btDevice = await BluetoothDevice.FromBluetoothAddressAsync(addrUlong).AsTask(ct);
            if (btDevice is null)
            {
                Log($"[BT CONNECT] Device handle not available — device may be out of range");
                return false;
            }

            Log($"[BT CONNECT] Device found, attempting to establish link…");

            // Try to query device properties to trigger connection
            try
            {
                _ = btDevice.Name;
                _ = btDevice.DeviceId;
                Log($"[BT CONNECT] Device properties accessed");
            }
            catch (Exception ex)
            {
                Log($"[BT CONNECT] Property access failed (expected if device not connected): {ex.Message}");
            }

            // Attempt to open a probe L2CAP connection to establish the link
            // If successful, Windows will cache the SDP response and keep the device connected.
            var connectAttempts = 0;
            const int maxAttempts = 3;

            while (connectAttempts < maxAttempts && !ct.IsCancellationRequested)
            {
                connectAttempts++;
                try
                {
                    // Use SDP service as the probe — it's always available.
                    // GUID "0000110B-0000-1000-8000-00805F9B34FB" = Service Discovery Protocol
                    var sdpServiceId = RfcommServiceId.FromUuid(new Guid("0000110B-0000-1000-8000-00805F9B34FB"));
                    var svcResult = await btDevice.GetRfcommServicesForIdAsync(
                        sdpServiceId, BluetoothCacheMode.Uncached).AsTask(ct);

                    Log($"[BT CONNECT] Attempt {connectAttempts}: SDP query returned {svcResult.Services.Count} service(s), error={svcResult.Error}");

                    if (svcResult.Error == BluetoothError.Success)
                    {
                        Log($"[BT CONNECT] Success: device is connected and responding");
                        return true;
                    }

                    if (svcResult.Error == BluetoothError.DeviceNotConnected)
                    {
                        Log($"[BT CONNECT] Device not connected — attempting reconnect delay…");
                        if (connectAttempts < maxAttempts)
                            await Task.Delay(500, ct);
                        continue;
                    }

                    // Other errors — device may be out of range or too far
                    Log($"[BT CONNECT] Attempt {connectAttempts} failed with {svcResult.Error}");
                    if (connectAttempts < maxAttempts)
                        await Task.Delay(500, ct);
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    Log($"[BT CONNECT] Attempt {connectAttempts} exception: {ex.Message}");
                    if (connectAttempts < maxAttempts)
                        await Task.Delay(500, ct);
                }
            }

            Log($"[BT CONNECT] All {maxAttempts} attempts exhausted — device unreachable");
            return false;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            Log($"[BT CONNECT] Fatal error: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Quick check if device is currently connected without retry.
    /// </summary>
    public async Task<bool> IsDeviceConnectedAsync(BluetoothAddress deviceAddress,
                                                   CancellationToken ct = default)
    {
        try
        {
            ulong addrUlong = Convert.ToUInt64(
                deviceAddress.ToString().Replace(":", ""), 16);
            var btDevice = await BluetoothDevice.FromBluetoothAddressAsync(addrUlong).AsTask(ct);
            if (btDevice is null) return false;

            var sdpServiceId = RfcommServiceId.FromUuid(new Guid("0000110B-0000-1000-8000-00805F9B34FB"));
            var svcResult = await btDevice.GetRfcommServicesForIdAsync(
                sdpServiceId, BluetoothCacheMode.Uncached).AsTask(ct);

            return svcResult.Error == BluetoothError.Success;
        }
        catch
        {
            return false;
        }
    }
}
