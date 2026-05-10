using System.Runtime.InteropServices;

namespace DeskPhone.Services;

/// <summary>
/// P/Invoke wrappers for Windows Bluetooth APIs not exposed by WinRT.
/// </summary>
internal static class NativeBluetoothHelper
{
    // ── Constants ─────────────────────────────────────────────────────────────
    private const uint BLUETOOTH_SERVICE_ENABLE = 1;
    private const uint ERROR_SUCCESS            = 0;
    private const uint ERROR_ACCESS_DENIED      = 5;
    private const uint ERROR_NO_MORE_ITEMS      = 259;

    // ── SYSTEMTIME (16 bytes) ─────────────────────────────────────────────────
    [StructLayout(LayoutKind.Sequential)]
    private struct SYSTEMTIME
    {
        public ushort wYear, wMonth, wDayOfWeek, wDay,
                      wHour, wMinute, wSecond, wMilliseconds;
    }

    // ── BLUETOOTH_DEVICE_INFO (560 bytes on x64) ──────────────────────────────
    // The ulong Address field gets 4 bytes of implicit padding before it
    // (natural 8-byte alignment after the 4-byte dwSize).
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct BLUETOOTH_DEVICE_INFO
    {
        public uint       dwSize;
        public ulong      Address;           // BLUETOOTH_ADDRESS union — ullLong
        public uint       ulClassofDevice;
        public int        fConnected;
        public int        fRemembered;
        public int        fAuthenticated;
        public SYSTEMTIME stLastSeen;
        public SYSTEMTIME stLastUsed;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 248)]
        public string?    szName;
    }

    // ── BLUETOOTH_DEVICE_SEARCH_PARAMS (40 bytes on x64) ─────────────────────
    // After cTimeoutMultiplier (1 byte), the marshaler inserts 7 bytes of padding
    // to align hRadio (IntPtr = 8 bytes on x64) to an 8-byte boundary.
    [StructLayout(LayoutKind.Sequential)]
    private struct BLUETOOTH_DEVICE_SEARCH_PARAMS
    {
        public uint   dwSize;
        public int    fReturnAuthenticated;
        public int    fReturnRemembered;
        public int    fReturnUnknown;
        public int    fReturnConnected;
        public int    fIssueInquiry;
        public byte   cTimeoutMultiplier;
        // 7 bytes padding injected here by the marshaler (natural alignment)
        public IntPtr hRadio;
    }

    // ── P/Invoke ──────────────────────────────────────────────────────────────
    [DllImport("BluetoothApis.dll", SetLastError = true)]
    private static extern IntPtr BluetoothFindFirstDevice(
        ref BLUETOOTH_DEVICE_SEARCH_PARAMS pbtsp,
        ref BLUETOOTH_DEVICE_INFO          pbtdi);

    [DllImport("BluetoothApis.dll", SetLastError = true)]
    private static extern bool BluetoothFindNextDevice(
        IntPtr                    hFind,
        ref BLUETOOTH_DEVICE_INFO pbtdi);

    [DllImport("BluetoothApis.dll", SetLastError = true)]
    private static extern bool BluetoothFindDeviceClose(IntPtr hFind);

    [DllImport("BluetoothApis.dll", SetLastError = true)]
    private static extern uint BluetoothSetServiceState(
        IntPtr                    hRadio,
        ref BLUETOOTH_DEVICE_INFO pbtdi,
        ref Guid                  pGuidService,
        uint                      dwServiceFlags);

    [StructLayout(LayoutKind.Sequential)]
    private struct BLUETOOTH_FIND_RADIO_PARAMS
    {
        public uint dwSize;
    }

    [DllImport("BluetoothApis.dll", SetLastError = true)]
    private static extern IntPtr BluetoothFindFirstRadio(
        ref BLUETOOTH_FIND_RADIO_PARAMS pbtfrp,
        out IntPtr                      phRadio);

    [DllImport("BluetoothApis.dll", SetLastError = true)]
    private static extern bool BluetoothFindNextRadio(
        IntPtr  hFind,
        out IntPtr phRadio);

    [DllImport("BluetoothApis.dll", SetLastError = true)]
    private static extern bool BluetoothFindRadioClose(IntPtr hFind);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    // ── Public API ────────────────────────────────────────────────────────────

    /// <summary>
    /// Best-effort request for Windows to enable the paired HFP profile entries
    /// for the specified device.
    ///
    /// BluetoothSetServiceState requires the BLUETOOTH_DEVICE_INFO to come from
    /// a real BluetoothFindFirstDevice/NextDevice call — a hand-crafted struct
    /// returns ERROR_INVALID_PARAMETER (0x57). So we enumerate paired devices,
    /// match by address, then call SetServiceState with the found record.
    ///
    /// We try two GUIDs: 0x111F (HFP Audio Gateway — phone's service class)
    /// and 0x111E (HFP Hands-Free Unit — PC's service class). Either one may
    /// trigger inbox HFP profile activation depending on the Windows version.
    ///
    /// Returns 0 on success, or a Win32 error code.
    /// </summary>
    public static (uint code, string description) EnableHfpForDevice(ulong bluetoothAddress)
    {
        var deviceInfoSize = (uint)Marshal.SizeOf<BLUETOOTH_DEVICE_INFO>();
        var searchSize     = (uint)Marshal.SizeOf<BLUETOOTH_DEVICE_SEARCH_PARAMS>();

        var searchParams = new BLUETOOTH_DEVICE_SEARCH_PARAMS
        {
            dwSize               = searchSize,
            fReturnAuthenticated = 1,   // paired (authenticated) devices
            fReturnRemembered    = 1,   // remembered (previously paired) devices
            fReturnConnected     = 1,   // currently connected devices
            fReturnUnknown       = 0,
            fIssueInquiry        = 0,   // don't scan radio — use cached list (fast)
            cTimeoutMultiplier   = 0,
            hRadio               = IntPtr.Zero
        };

        var radioParams = new BLUETOOTH_FIND_RADIO_PARAMS
            { dwSize = (uint)Marshal.SizeOf<BLUETOOTH_FIND_RADIO_PARAMS>() };
        var hRadioFind = BluetoothFindFirstRadio(ref radioParams, out var hRadio);
        if (hRadioFind == IntPtr.Zero)
        {
            var err = (uint)Marshal.GetLastWin32Error();
            return (err, $"BluetoothFindFirstRadio failed: 0x{err:X8}");
        }

        try
        {
            uint firstFailure = 0;
            int totalScanned = 0;
            do
            {
                searchParams.hRadio = hRadio;
                var deviceInfo = new BLUETOOTH_DEVICE_INFO
                {
                    dwSize = deviceInfoSize,
                    szName = ""
                };

                var hFind = BluetoothFindFirstDevice(ref searchParams, ref deviceInfo);
                if (hFind == IntPtr.Zero)
                {
                    var findErr = (uint)Marshal.GetLastWin32Error();
                    if (firstFailure == 0)
                        firstFailure = findErr;
                    CloseHandle(hRadio);
                    continue;
                }

                try
                {
                    do
                    {
                        totalScanned++;
                        if (deviceInfo.Address != bluetoothAddress)
                        {
                            deviceInfo = new BLUETOOTH_DEVICE_INFO { dwSize = deviceInfoSize, szName = "" };
                            continue;
                        }

                        var hfpAgGuid  = new Guid("0000111F-0000-1000-8000-00805F9B34FB"); // Audio Gateway
                        var hfpHfuGuid = new Guid("0000111E-0000-1000-8000-00805F9B34FB"); // Hands-Free Unit

                        var r1 = BluetoothSetServiceState(
                            hRadio, ref deviceInfo, ref hfpAgGuid, BLUETOOTH_SERVICE_ENABLE);
                        if (r1 == ERROR_SUCCESS)
                            return (r1, $"OK on radio-bound device record (AG UUID 0x111F) — Windows accepted the HFP enable request");

                        var r2 = BluetoothSetServiceState(
                            hRadio, ref deviceInfo, ref hfpHfuGuid, BLUETOOTH_SERVICE_ENABLE);
                        if (r2 == ERROR_SUCCESS)
                            return (r2, $"OK on radio-bound device record (HFU UUID 0x111E) — Windows accepted the HFP enable request");

                        return (r1, $"AG(0x111F)=0x{r1:X8} HFU(0x111E)=0x{r2:X8}: {Describe(r1)}");
                    }
                    while (BluetoothFindNextDevice(hFind, ref deviceInfo));
                }
                finally
                {
                    BluetoothFindDeviceClose(hFind);
                    CloseHandle(hRadio);
                }
            }
            while (BluetoothFindNextRadio(hRadioFind, out hRadio));

            if (firstFailure != 0)
                return (firstFailure, $"Bluetooth device enumeration failed on every radio: {Describe(firstFailure)}");

            return (ERROR_NO_MORE_ITEMS,
                $"Device 0x{bluetoothAddress:X12} not found in {totalScanned} paired device record(s) across local radios — check that phone is paired in Windows Bluetooth settings");
        }
        finally
        {
            BluetoothFindRadioClose(hRadioFind);
        }
    }

    private static string Describe(uint code) => code switch
    {
        ERROR_SUCCESS       => "OK — Windows accepted the HFP profile-enable request",
        ERROR_ACCESS_DENIED => "Access denied — try running DeskPhone as Administrator",
        _                   => $"Win32 error 0x{code:X8}"
    };
}
