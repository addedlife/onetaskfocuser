using System.Text;
using Windows.ApplicationModel.Calls;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.Rfcomm;
using Windows.Devices.Enumeration;

// Probe v4 — last-resort triggers to make Windows' BthHFEnum bring up an
// HFP-HF call-audio endpoint for the phone:
//   1. PhoneLineTransportDevice register + connect (the Phone Link path)
//   2. Enumerate PhoneLine objects (forces the comms stack to materialize lines)
//   3. PhoneCallManager.RequestStoreAsync + default line probe
// We log every audio endpoint before/after and any PhoneLine that appears.

var logSb  = new StringBuilder();
var logPath = Path.Combine(AppContext.BaseDirectory, "probe-log.txt");
void Log(string s)
{
    var line = $"{DateTime.Now:HH:mm:ss.fff}  {s}";
    Console.WriteLine(line);
    logSb.AppendLine(line);
    try { File.WriteAllText(logPath, logSb.ToString()); } catch { }
}

async Task DumpEndpointsAsync(string tag)
{
    foreach (var cls in new[] { DeviceClass.AudioRender, DeviceClass.AudioCapture })
    {
        var devs = await DeviceInformation.FindAllAsync(cls);
        foreach (var d in devs) Log($"   [{tag}] {cls}: {d.Name}  enabled={d.IsEnabled}");
    }
}

Log("=== probe v4 ===");
try { Log($"Package: {Windows.ApplicationModel.Package.Current.Id.FullName}"); }
catch (Exception ex) { Log($"NO identity {ex.HResult:X8}"); }

await DumpEndpointsAsync("before");

BluetoothDevice? bt = null;
try
{
    bt = await BluetoothDevice.FromBluetoothAddressAsync(0x7E4B46E95FBA);
    var hfpAg = RfcommServiceId.FromUuid(new Guid("0000111F-0000-1000-8000-00805F9B34FB"));
    var svc = await bt!.GetRfcommServicesForIdAsync(hfpAg, BluetoothCacheMode.Uncached);
    Log($"Phone={bt.Name} status={bt.ConnectionStatus} sdp={svc.Error}/{svc.Services.Count}");
}
catch (Exception ex) { Log($"wake failed {ex.HResult:X8} {ex.Message}"); }

// ── Transport register + connect ──
string sel = PhoneLineTransportDevice.GetDeviceSelector(PhoneLineTransport.Bluetooth);
var infos = await DeviceInformation.FindAllAsync(sel);
PhoneLineTransportDevice? t = null;
foreach (var i in infos)
    if (i.Id.Contains("7E4B46E95FBA", StringComparison.OrdinalIgnoreCase))
        t = PhoneLineTransportDevice.FromId(i.Id);
if (t != null)
{
    try { Log($"access={await t.RequestAccessAsync()}"); } catch (Exception ex) { Log($"access threw {ex.Message}"); }
    try { t.RegisterApp(); Log("RegisterApp OK"); } catch (Exception ex) { Log($"RegisterApp threw {ex.HResult:X8}"); }
    for (int a = 1; a <= 2; a++)
    {
        try { Log($"Connect#{a}={await t.ConnectAsync()}"); } catch (Exception ex) { Log($"Connect#{a} threw {ex.HResult:X8} {ex.Message}"); }
        await Task.Delay(3000);
    }
}
else Log("transport not found");

// ── PhoneCallManager store + line enumeration ──
try
{
    var store = await PhoneCallManager.RequestStoreAsync();
    var def = await store.GetDefaultLineAsync();
    Log($"DefaultLine={def}");
    if (def != Guid.Empty)
    {
        try
        {
            var pl = await PhoneLine.FromIdAsync(def);
            Log($"   line network='{pl?.NetworkName}' transport={pl?.Transport} canDial={pl?.CanDial}");
        }
        catch (Exception ex) { Log($"   FromIdAsync threw {ex.HResult:X8} {ex.Message}"); }
    }
}
catch (Exception ex) { Log($"store threw {ex.HResult:X8} {ex.Message}"); }

await Task.Delay(4000);
await DumpEndpointsAsync("after");
Log("=== done ===");
