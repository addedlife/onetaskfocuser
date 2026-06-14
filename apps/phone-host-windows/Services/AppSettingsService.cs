using System.IO;
using System.Text.Json;

namespace DeskPhone.Services;

/// <summary>
/// Saves and loads user preferences to %APPDATA%\DeskPhone\settings.json.
/// Tracks a history of connected devices so the reconnect prompt can offer
/// "reconnect to FIG-NEWTON?" on startup without doing a BT scan first.
/// </summary>
public class AppSettingsService
{
    private const double DefaultUiScalePercent = 100;
    private const double MinUiScalePercent = 100;
    private const double MaxUiScalePercent = 115;
    private static readonly double[] CrispUiScalePresets = [100, 105, 110, 115];

    private static readonly string SettingsPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "DeskPhone", "settings.json");

    // ── Persisted model ───────────────────────────────────────────────────
    public class KnownDevice
    {
        public string   Address  { get; set; } = "";
        public string   Name     { get; set; } = "";
        public DateTime LastSeen { get; set; } = DateTime.Now;
        public bool     IsDefault { get; set; }

        public int HistoryOffsetInbox { get; set; } = 0;
        public int HistoryOffsetSent  { get; set; } = 0;
    }

    public class PendingBuildHandoff
    {
        public string   BuildPath     { get; set; } = "";
        public string   BuildVersion  { get; set; } = "";
        public string   DeviceAddress { get; set; } = "";
        public string   DeviceName    { get; set; } = "";
        public DateTime RequestedAt   { get; set; } = DateTime.Now;
    }

    public class MessageDraft
    {
        public string   PhoneNumber     { get; set; } = "";
        public string   RecipientInput  { get; set; } = "";
        public string   Body            { get; set; } = "";
        public bool     IsNewMessage    { get; set; }
        public DateTime UpdatedAt       { get; set; } = DateTime.Now;
    }

    public class DeviceAlertState
    {
        public string DeviceAddress { get; set; } = "";
        public bool HasVoicemailAlert { get; set; }
        public string VoicemailAlertText { get; set; } = "";
        public DateTime UpdatedAt { get; set; } = DateTime.Now;
    }

    public class Settings
    {
        // Legacy single-device fields — kept for JSON backward-compat, migrated on load
        public string? LastDeviceAddress { get; set; }
        public string? LastDeviceName    { get; set; }

        public bool AutoConnect { get; set; } = true;
        
        public bool PauseHistoryActivity { get; set; } = true;

        public bool? DarkModeEnabled { get; set; }

        public string PreferredPalette { get; set; } = "BlueGold";

        public bool SyncThemeWithShamash { get; set; } = true;

        public Dictionary<string, string> LastThemeColors { get; set; } = new(StringComparer.OrdinalIgnoreCase);

        // Open the modern web phone UI (the webapp's phone screen, served from
        // this app's own loopback server) automatically on launch.
        public bool OpenModernUiOnLaunch { get; set; } = true;

        public double? UiScalePercent { get; set; }

        public bool IsNavigationRailCollapsed { get; set; }

        public List<string> PinnedConversationPhones { get; set; } = new();

        public List<string> MutedConversationAlertPhones { get; set; } = new();

        public List<string> BlockedConversationPhones { get; set; } = new();

        // "Chronological" (default) or "UnreadFirst"
        public string ConversationSortMode { get; set; } = "Chronological";

        // List of every device the user has successfully connected to, newest first
        public List<KnownDevice> KnownDevices { get; set; } = new();

        // One-shot release handoff used when the current build offers to switch
        // the user into a newly deployed build.
        public PendingBuildHandoff? PendingBuildHandoff { get; set; }

        public List<MessageDraft> MessageDrafts { get; set; } = new();

        public List<DeviceAlertState> DeviceAlertStates { get; set; } = new();

        // Cloud relay: DeskPhone pushes phone state here so any browser anywhere can reach it
        public string RelayKey { get; set; } = "";
        public string RelayUrl { get; set; } = "";   // empty = use default Netlify URL
    }

    // ── State ─────────────────────────────────────────────────────────────
    private Settings _current = new();
    public  Settings Current  => _current;

    /// <summary>Most-recently-used device (for the startup reconnect prompt).</summary>
    public KnownDevice? MostRecentDevice =>
        _current.KnownDevices
                .OrderByDescending(d => d.LastSeen)
                .FirstOrDefault();

    public KnownDevice? DefaultDevice =>
        _current.KnownDevices
                .FirstOrDefault(d => d.IsDefault);

    // ── Constructor ───────────────────────────────────────────────────────
    public AppSettingsService()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath)!);

            if (File.Exists(SettingsPath))
            {
                var json = File.ReadAllText(SettingsPath);
                _current = JsonSerializer.Deserialize<Settings>(json) ?? new();
            }
        }
        catch { _current = new(); }

        // ── Migrate from old single-device fields ─────────────────────────
        if (_current.KnownDevices.Count == 0 &&
            !string.IsNullOrEmpty(_current.LastDeviceAddress))
        {
            _current.KnownDevices.Add(new KnownDevice
            {
                Address  = _current.LastDeviceAddress,
                Name     = _current.LastDeviceName ?? _current.LastDeviceAddress,
                LastSeen = DateTime.Now,
                IsDefault = true
            });
            Save();
        }
        else if (_current.KnownDevices.Count == 1 && !_current.KnownDevices[0].IsDefault)
        {
            _current.KnownDevices[0].IsDefault = true;
            Save();
        }

        // ── Auto-generate relay key on first run ──────────────────────────
        if (string.IsNullOrWhiteSpace(_current.RelayKey))
        {
            _current.RelayKey = Guid.NewGuid().ToString("N"); // 32 hex chars, no dashes
            Save();
        }

        NormalizeAppearanceSettings();
    }

    // ── API ───────────────────────────────────────────────────────────────
    public void Save()
    {
        try
        {
            var json = JsonSerializer.Serialize(_current,
                new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(SettingsPath, json);
        }
        catch { }
    }

    public void SetDarkMode(bool enabled)
    {
        var desiredPalette = enabled ? "BlueGold" : "Google";
        if (_current.DarkModeEnabled == enabled &&
            string.Equals(_current.PreferredPalette, desiredPalette, StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        _current.DarkModeEnabled = enabled;
        _current.PreferredPalette = desiredPalette;
        Save();
    }

    public double GetUiScalePercent()
        => ClampUiScalePercent(_current.UiScalePercent ?? DefaultUiScalePercent);

    public bool SetUiScalePercent(double percent)
    {
        var clamped = ClampUiScalePercent(percent);
        if (Math.Abs((_current.UiScalePercent ?? DefaultUiScalePercent) - clamped) < 0.01)
            return false;

        _current.UiScalePercent = clamped;
        Save();
        return true;
    }

    public bool IsConversationPinned(string? phoneNumber)
        => ContainsConversationPhone(_current.PinnedConversationPhones, phoneNumber);

    public bool AreConversationAlertsMuted(string? phoneNumber)
        => ContainsConversationPhone(_current.MutedConversationAlertPhones, phoneNumber);

    public bool IsConversationBlocked(string? phoneNumber)
        => ContainsConversationPhone(_current.BlockedConversationPhones, phoneNumber);

    public bool SetConversationPinned(string? phoneNumber, bool isPinned)
        => SetConversationPhoneMembership(_current.PinnedConversationPhones, phoneNumber, isPinned);

    public bool SetConversationAlertsMuted(string? phoneNumber, bool isMuted)
        => SetConversationPhoneMembership(_current.MutedConversationAlertPhones, phoneNumber, isMuted);

    public bool SetConversationBlocked(string? phoneNumber, bool isBlocked)
        => SetConversationPhoneMembership(_current.BlockedConversationPhones, phoneNumber, isBlocked);

    /// <summary>
    /// Record a successful connection. Moves the device to the top of the list
    /// (updates LastSeen) so MostRecentDevice always returns it next time.
    /// </summary>
    public void SaveDevice(string address, string name)
    {
        var hadAnyDevice = _current.KnownDevices.Count > 0;
        var existing = _current.KnownDevices
            .FirstOrDefault(d => d.Address.Equals(address, StringComparison.OrdinalIgnoreCase));

        if (existing is null)
        {
            _current.KnownDevices.Insert(0, new KnownDevice
            { Address = address, Name = name, LastSeen = DateTime.Now, IsDefault = !hadAnyDevice });
        }
        else
        {
            existing.Name     = name;
            existing.LastSeen = DateTime.Now;
        }

        // Keep legacy fields in sync (some code may still read them)
        _current.LastDeviceAddress = address;
        _current.LastDeviceName    = name;
        Save();
    }

    public void SetDefaultDevice(string address)
    {
        var target = _current.KnownDevices
            .FirstOrDefault(d => d.Address.Equals(address, StringComparison.OrdinalIgnoreCase));
        if (target is null)
            return;

        foreach (var device in _current.KnownDevices)
            device.IsDefault = false;

        target.IsDefault = true;
        _current.LastDeviceAddress = target.Address;
        _current.LastDeviceName = target.Name;
        Save();
    }

    /// <summary>Remove a device from the saved list.</summary>
    public void ForgetDevice(string address)
    {
        var removedDefault = _current.KnownDevices.Any(d =>
            d.IsDefault && d.Address.Equals(address, StringComparison.OrdinalIgnoreCase));
        _current.KnownDevices.RemoveAll(d =>
            d.Address.Equals(address, StringComparison.OrdinalIgnoreCase));
        if (_current.LastDeviceAddress?.Equals(address, StringComparison.OrdinalIgnoreCase) == true)
        {
            _current.LastDeviceAddress = MostRecentDevice?.Address;
            _current.LastDeviceName    = MostRecentDevice?.Name;
        }
        if (removedDefault)
        {
            _current.LastDeviceAddress = null;
            _current.LastDeviceName = null;
        }
        Save();
    }

    public void SavePendingBuildHandoff(string buildPath, string buildVersion, string? deviceAddress, string? deviceName)
    {
        _current.PendingBuildHandoff = new PendingBuildHandoff
        {
            BuildPath = buildPath ?? "",
            BuildVersion = buildVersion ?? "",
            DeviceAddress = deviceAddress ?? "",
            DeviceName = deviceName ?? "",
            RequestedAt = DateTime.Now
        };
        Save();
    }

    public DeviceAlertState? GetDeviceAlertState(string? deviceAddress)
    {
        var normalized = NormalizeDeviceAddress(deviceAddress);
        if (string.IsNullOrWhiteSpace(normalized))
            return null;

        return _current.DeviceAlertStates
            .FirstOrDefault(state => string.Equals(
                NormalizeDeviceAddress(state.DeviceAddress),
                normalized,
                StringComparison.OrdinalIgnoreCase));
    }

    public void SetVoicemailAlertState(string? deviceAddress, bool hasAlert, string? alertText)
    {
        var normalized = NormalizeDeviceAddress(deviceAddress);
        if (string.IsNullOrWhiteSpace(normalized))
            return;

        _current.DeviceAlertStates ??= new List<DeviceAlertState>();
        var existing = _current.DeviceAlertStates
            .FirstOrDefault(state => string.Equals(
                NormalizeDeviceAddress(state.DeviceAddress),
                normalized,
                StringComparison.OrdinalIgnoreCase));

        if (!hasAlert)
        {
            if (existing == null)
                return;

            _current.DeviceAlertStates.Remove(existing);
            Save();
            return;
        }

        if (existing == null)
        {
            _current.DeviceAlertStates.Add(new DeviceAlertState
            {
                DeviceAddress = normalized,
                HasVoicemailAlert = true,
                VoicemailAlertText = alertText ?? "",
                UpdatedAt = DateTime.Now
            });
            Save();
            return;
        }

        existing.DeviceAddress = normalized;
        existing.HasVoicemailAlert = true;
        existing.VoicemailAlertText = alertText ?? "";
        existing.UpdatedAt = DateTime.Now;
        Save();
    }

    public PendingBuildHandoff? ConsumePendingBuildHandoffForCurrentProcess()
    {
        var handoff = _current.PendingBuildHandoff;
        if (handoff is null)
            return null;

        var currentPath = NormalizePath(Environment.ProcessPath);
        var targetPath = NormalizePath(handoff.BuildPath);

        if (string.IsNullOrWhiteSpace(targetPath) || !File.Exists(targetPath))
        {
            _current.PendingBuildHandoff = null;
            Save();
            return null;
        }

        if (!string.Equals(currentPath, targetPath, StringComparison.OrdinalIgnoreCase))
            return null;

        _current.PendingBuildHandoff = null;
        Save();
        return handoff;
    }

    private static string NormalizePath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return "";

        try
        {
            return Path.GetFullPath(path);
        }
        catch
        {
            return path ?? "";
        }
    }

    private void NormalizeAppearanceSettings()
    {
        _current.MessageDrafts ??= new List<MessageDraft>();
        _current.DeviceAlertStates ??= new List<DeviceAlertState>();
        _current.PinnedConversationPhones ??= new List<string>();
        _current.MutedConversationAlertPhones ??= new List<string>();
        _current.BlockedConversationPhones ??= new List<string>();

        var darkMode = _current.DarkModeEnabled
            ?? string.Equals(_current.PreferredPalette, "BlueGold", StringComparison.OrdinalIgnoreCase);
        var preferredPalette = darkMode ? "BlueGold" : "Google";
        var uiScalePercent = ClampUiScalePercent(_current.UiScalePercent ?? DefaultUiScalePercent);

        if (_current.DarkModeEnabled == darkMode &&
            string.Equals(_current.PreferredPalette, preferredPalette, StringComparison.OrdinalIgnoreCase) &&
            Math.Abs((_current.UiScalePercent ?? DefaultUiScalePercent) - uiScalePercent) < 0.01)
        {
            return;
        }

        _current.DarkModeEnabled = darkMode;
        _current.PreferredPalette = preferredPalette;
        _current.UiScalePercent = uiScalePercent;
        Save();
    }

    private bool SetConversationPhoneMembership(List<string> target, string? phoneNumber, bool include)
    {
        var normalized = NormalizeConversationPhone(phoneNumber);
        if (string.IsNullOrWhiteSpace(normalized))
            return false;

        var removed = target.RemoveAll(phone =>
            string.Equals(phone, normalized, StringComparison.OrdinalIgnoreCase)) > 0;

        if (!include)
        {
            if (!removed)
                return false;

            Save();
            return true;
        }

        target.Add(normalized);
        Save();
        return true;
    }

    private static bool ContainsConversationPhone(IEnumerable<string> source, string? phoneNumber)
    {
        var normalized = NormalizeConversationPhone(phoneNumber);
        if (string.IsNullOrWhiteSpace(normalized))
            return false;

        return source.Any(phone => string.Equals(phone, normalized, StringComparison.OrdinalIgnoreCase));
    }

    private static string NormalizeConversationPhone(string? phoneNumber)
        => ContactStoreService.NormalizePhone(phoneNumber);

    private static string NormalizeDeviceAddress(string? address)
        => MessageStoreService.NormalizeDeviceAddress(address);

    private static double ClampUiScalePercent(double percent)
    {
        if (double.IsNaN(percent) || double.IsInfinity(percent))
            return DefaultUiScalePercent;

        var clamped = Math.Clamp(percent, MinUiScalePercent, MaxUiScalePercent);
        return CrispUiScalePresets
            .OrderBy(preset => Math.Abs(preset - clamped))
            .First();
    }
}
