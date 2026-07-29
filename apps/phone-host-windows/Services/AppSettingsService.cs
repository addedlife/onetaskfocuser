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

        // This PC's stable identity in the cloud device registry. Paired with
        // RelayKey (which is now this device's OWN secret, not a shared one).
        // See functions/_relay-devices.cjs for the full design.
        public string RelayDeviceId { get; set; } = "";
        // Set once the cloud has confirmed enrollment, so we don't re-enroll on
        // every launch. "pending" until the owner approves in the web app.
        public string RelayEnrollState { get; set; } = "";
    }

    // ── State ─────────────────────────────────────────────────────────────
    private Settings _current = new();
    public  Settings Current  => _current;

    /// <summary>True when a settings file exists on disk but could not be read or
    /// parsed this session. In that state the in-memory settings are DEFAULTS, not
    /// the user's — so nothing may be persisted over the real file, and no identity
    /// (relay key) may be regenerated from them.</summary>
    public bool    LoadFailed { get; private set; }
    /// <summary>Why the load failed, for the debug log. Null when the load was clean.</summary>
    public string? LoadError  { get; private set; }
    /// <summary>Why the last Save() did not persist. Null when the last save succeeded.</summary>
    public string? SaveError  { get; private set; }

    /// <summary>True when a first-run relay key was generated but could not be written
    /// to disk, so it was discarded rather than used. The host then has NO relay key,
    /// which is the honest state — an unsaved key is one the cloud rejects forever.</summary>
    public bool    RelayKeyMintAbandoned { get; private set; }

    /// <summary>False when the key this process is using is not the one saved on disk —
    /// i.e. the running host has silently re-identified itself and the cloud will reject
    /// it. Surfaced by /relay-status so the whole diagnosis is one request.</summary>
    public bool RelayKeyMatchesDisk => RelayKeyPersisted(_current.RelayKey);

    /// <summary>Read the file back and confirm the key really landed. Save() reports its
    /// own exceptions, but a write that "succeeds" into a redirected/virtualised folder
    /// still leaves the next launch reading the old file — only a read-back proves it.</summary>
    private static bool RelayKeyPersisted(string expected)
    {
        try
        {
            var onDisk = JsonSerializer.Deserialize<Settings>(File.ReadAllText(SettingsPath));
            return string.Equals(onDisk?.RelayKey, expected, StringComparison.Ordinal);
        }
        catch { return false; }
    }

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
        // A folder we could not create is NOT a clean first run — we have no idea
        // whether a settings file is sitting in there. LoadFailed must be set here
        // too, or the relay-key mint below fires on a state we never inspected.
        try { Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath)!); }
        catch (Exception ex)
        {
            LoadError  = $"settings folder unavailable — {ex.GetType().Name}: {ex.Message}";
            LoadFailed = true;
        }

        // Same for the existence probe itself: a throwing File.Exists means
        // "unknown", not "absent". Treating it as absent is what turns a transient
        // filesystem hiccup into a regenerated identity.
        var fileExists = false;
        try { fileExists = File.Exists(SettingsPath); }
        catch (Exception ex)
        {
            LoadError  = $"could not probe settings file — {ex.GetType().Name}: {ex.Message}";
            LoadFailed = true;
        }

        if (fileExists)
        {
            // A settings file that EXISTS but cannot be read is not a first run, and
            // must never be treated as one. The usual cause is transient: an
            // overlapping restart where the outgoing instance still holds the file
            // for a moment. Retry briefly before giving up.
            for (var attempt = 1; attempt <= 4; attempt++)
            {
                try
                {
                    var parsed = JsonSerializer.Deserialize<Settings>(File.ReadAllText(SettingsPath));
                    if (parsed != null)
                    {
                        _current   = parsed;
                        LoadFailed = false;
                        LoadError  = null;
                        break;
                    }
                    LoadError = "settings file parsed to null";
                }
                catch (Exception ex) { LoadError = $"{ex.GetType().Name}: {ex.Message}"; }

                LoadFailed = true;
                if (attempt < 4) Thread.Sleep(150 * attempt);
            }
        }

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

        // ── Mint this PC's own relay identity on a GENUINE first run ──────
        //
        // HISTORY — why this block is so heavily guarded.
        //
        // The relay key USED to have to equal a single global PHONE_RELAY_SECRET
        // held by the cloud. Minting a random Guid therefore produced a key that
        // could never match, and nothing surfaced the mismatch, so remote texts
        // and call control stayed dead for the whole session behind an endless
        // [RELAY AUTH] 401 loop. That happened three times:
        //   2026-07-15  the secret was rotated in GitHub; disk still held the old one.
        //   2026-07-22  settings could not be read, the code called it "first run",
        //               invented a key, and its Save() failed too — disk held the
        //               CORRECT key while the process used a random one for hours.
        //   2026-07-24  two DeskPhone processes ran at once, indistinguishable
        //               because every host shared one identity.
        //
        // WHAT CHANGED — the key is no longer shared. It is now THIS DEVICE'S OWN
        // secret, paired with RelayDeviceId, registered in the cloud's
        // relay-devices registry and approved once by the owner. A freshly minted
        // random key is now the CORRECT outcome rather than a guaranteed outage,
        // because uniqueness is the point. See functions/_relay-devices.cjs.
        //
        // Two guards survive that change and still matter:
        //   • LoadFailed — never mint an identity from settings we could not read,
        //     or we orphan the real one that is sitting on disk.
        //   • persist-or-abandon — an identity that does not reach disk means we
        //     re-enroll under a NEW id on every launch, piling up pending devices
        //     the owner has to sift through. Roll it back and say so instead.
        if (string.IsNullOrWhiteSpace(_current.RelayKey) && !LoadFailed)
        {
            var minted   = Guid.NewGuid().ToString("N"); // 32 hex chars, no dashes
            var deviceId = "win-" + Environment.MachineName.ToLowerInvariant()
                                       .Replace(" ", "-")
                                       .Replace(".", "-")
                         + "-" + Guid.NewGuid().ToString("N").Substring(0, 8);
            // Registry ids are [A-Za-z0-9_-]{8,64}; strip anything else a machine
            // name might contribute so enrollment can never be rejected as malformed.
            deviceId = new string(deviceId.Where(c => char.IsLetterOrDigit(c) || c == '-' || c == '_').ToArray());
            if (deviceId.Length > 64) deviceId = deviceId.Substring(0, 64);

            _current.RelayKey      = minted;
            _current.RelayDeviceId = deviceId;
            _current.RelayEnrollState = "";
            Save();
            if (!RelayKeyPersisted(minted))
            {
                _current.RelayKey      = "";
                _current.RelayDeviceId = "";
                RelayKeyMintAbandoned  = true;
                SaveError ??= "settings file did not accept the new relay key";
            }
        }
        // An older build's settings file has a RelayKey but no RelayDeviceId.
        // Give it one so it can enroll instead of falling back to the legacy
        // shared-secret path forever.
        else if (!string.IsNullOrWhiteSpace(_current.RelayKey)
              && string.IsNullOrWhiteSpace(_current.RelayDeviceId)
              && !LoadFailed)
        {
            var deviceId = "win-" + Environment.MachineName.ToLowerInvariant().Replace(" ", "-").Replace(".", "-")
                         + "-" + Guid.NewGuid().ToString("N").Substring(0, 8);
            deviceId = new string(deviceId.Where(c => char.IsLetterOrDigit(c) || c == '-' || c == '_').ToArray());
            if (deviceId.Length > 64) deviceId = deviceId.Substring(0, 64);
            _current.RelayDeviceId = deviceId;
            Save();
        }

        NormalizeAppearanceSettings();
    }

    // ── API ───────────────────────────────────────────────────────────────
    public void Save()
    {
        // Never write defaults over a settings file we could not read. Doing so
        // turns a momentary read failure into permanent loss of the relay key,
        // known devices, drafts, pins and theme.
        if (LoadFailed)
        {
            SaveError = "not saved — the existing settings file could not be read this session";
            return;
        }

        try
        {
            var json = JsonSerializer.Serialize(_current,
                new JsonSerializerOptions { WriteIndented = true });

            // Write-then-replace: a crash or a full disk mid-write leaves the old
            // file intact instead of a truncated one that fails to parse next launch.
            var tmp = SettingsPath + ".tmp";
            File.WriteAllText(tmp, json);
            File.Move(tmp, SettingsPath, overwrite: true);
            SaveError = null;
        }
        catch (Exception ex)
        {
            SaveError = $"{ex.GetType().Name}: {ex.Message}";
        }
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
