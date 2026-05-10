using InTheHand.Net;
using InTheHand.Net.Sockets;

namespace DeskPhone.Models;

public class BluetoothDeviceModel
{
    public BluetoothAddress Address       { get; }
    public string           Name          { get; }
    public bool             IsPaired      { get; }
    public bool             IsConnected   { get; set; }

    public BluetoothDeviceModel(BluetoothDeviceInfo info)
    {
        Address    = info.DeviceAddress;
        Name       = string.IsNullOrWhiteSpace(info.DeviceName)
                         ? info.DeviceAddress.ToString()
                         : info.DeviceName;
        IsPaired   = info.Authenticated;
        IsConnected = info.Connected;
    }

    // For manual construction (e.g. saved device)
    public BluetoothDeviceModel(BluetoothAddress address, string name, bool isPaired = false)
    {
        Address  = address;
        Name     = name;
        IsPaired = isPaired;
    }

    public override string ToString() => Name;
}
