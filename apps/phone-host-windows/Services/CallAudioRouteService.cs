using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;
using System.Collections.Generic;

namespace DeskPhone.Services;

/// <summary>
/// Observes which Windows audio device call audio will play through.
///
/// Why this exists
/// ───────────────
/// The Microsoft Bluetooth stack on Windows (especially ARM64) has no inbox
/// driver path that lets the PC act as the HFU side of an HFP connection to a
/// phone's audio gateway.  See scratch/option3_research/README.md for the
/// architectural details.  Result: there is no native way to route Bluetooth
/// call audio to PC speakers and microphone.
///
/// What we *can* do is observe the user's Windows default Communications
/// playback device.  Two cases produce different UX:
///
///  - **Phone-speaker fallback** (default): the device is the PC's built-in
///    speakers/mic or some unrelated audio device.  Calls happen on the phone
///    and the user can put the phone on speakerphone.  Surface a neutral
///    informational banner.
///
///  - **Hardware speakerphone present**: the user has plugged in a
///    USB-and-Bluetooth speakerphone (Jabra Speak, Poly Sync, Yealink CP, etc.)
///    that pairs to the phone over Bluetooth (its own firmware implements HFU)
///    and exposes itself to Windows as a USB audio device.  Call audio
///    naturally routes through it.  We detect by friendly-name pattern and
///    surface a positive "Routing through {device}" banner.
///
/// The service polls every few seconds and also subscribes to MMNotificationClient
/// so it reacts quickly when the user changes the default device or plugs/unplugs
/// hardware.
/// </summary>
public sealed class CallAudioRouteService : IMMNotificationClient, IDisposable
{
    public sealed record RouteSnapshot(
        string DeviceName,
        bool   IsExternalSpeakerphone,
        string Summary);

    public event Action<RouteSnapshot>? RouteChanged;

    // Substrings that identify USB or USB-and-Bluetooth speakerphone hardware.
    // Matched case-insensitive against the WASAPI friendly name.  Adding more
    // brand keywords here is the only thing needed to recognise additional
    // devices — no other code change required.
    private static readonly string[] SpeakerphoneNameMarkers =
    {
        "jabra speak",       // Jabra Speak 410 / 510 / 710 / 810
        "jabra evolve",      // Jabra Evolve series (some have BT)
        "poly sync",         // Poly Sync 20+ / 40+ / 60
        "polycom",
        "yealink cp",        // Yealink CP900 / CP700
        "yealink mp",
        "anker powerconf",   // Anker PowerConf S3 / S330
        "ankerwork",
        "emeet",             // eMeet OfficeCore
        "konftel",
        "logitech p710",
        "logitech mobile speakerphone",
        "plantronics calisto",
        "plantronics savi",
        "speakerphone",      // generic catch-all for unidentified models
    };

    private readonly MMDeviceEnumerator _enumerator = new();
    private System.Threading.Timer?     _poll;
    private RouteSnapshot               _last = new("", false, "Audio plays on the phone");
    private bool                        _disposed;

    public void Start()
    {
        try { _enumerator.RegisterEndpointNotificationCallback(this); }
        catch { /* notifications are best-effort */ }

        // Initial read + periodic refresh every 4 s.  Polling is cheap and
        // covers cases where MMNotificationClient doesn't fire (some virtual
        // devices switch silently).
        _poll = new System.Threading.Timer(_ => Refresh(), null,
            TimeSpan.Zero, TimeSpan.FromSeconds(4));
    }

    private void Refresh()
    {
        if (_disposed) return;
        try
        {
            // The Communications role is what call/Teams/Phone-Link audio uses.
            MMDevice? dev = null;
            try { dev = _enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Communications); }
            catch { /* may throw if no audio devices */ }

            string name = "";
            try { name = dev?.FriendlyName ?? ""; } catch { name = ""; }

            bool isExternal = LooksLikeSpeakerphone(name);
            string summary = isExternal
                ? $"Call audio will route through {ShortName(name)}"
                : "Call audio plays on the phone (use phone speakerphone, or attach a USB Bluetooth speakerphone)";

            var snap = new RouteSnapshot(name, isExternal, summary);
            if (snap != _last)
            {
                _last = snap;
                RouteChanged?.Invoke(snap);
            }
        }
        catch { /* refresh is best-effort */ }
    }

    private static bool LooksLikeSpeakerphone(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) return false;
        var lower = name.ToLowerInvariant();
        foreach (var marker in SpeakerphoneNameMarkers)
            if (lower.Contains(marker)) return true;
        return false;
    }

    /// <summary>Strip Windows' "(Device Name) ModelText" wrapping so the UI shows just the model.</summary>
    private static string ShortName(string full)
    {
        // Windows formats render endpoints like "Speakers (Jabra Speak 510 USB)".
        // Prefer whatever's inside the parentheses if it's the more identifying part.
        int open = full.IndexOf('(');
        int close = full.LastIndexOf(')');
        if (open >= 0 && close > open + 1)
        {
            var inner = full.Substring(open + 1, close - open - 1).Trim();
            if (inner.Length > 0) return inner;
        }
        return full;
    }

    // ── IMMNotificationClient ────────────────────────────────────────────────
    // Each callback simply re-runs Refresh().  We don't filter on dataFlow/role
    // because the user could be changing any default and we want to be lazy.
    public void OnDeviceStateChanged(string deviceId, DeviceState newState) => Refresh();
    public void OnDeviceAdded(string pwstrDeviceId)                         => Refresh();
    public void OnDeviceRemoved(string deviceId)                            => Refresh();
    public void OnDefaultDeviceChanged(DataFlow flow, Role role, string id) => Refresh();
    public void OnPropertyValueChanged(string pwstrDeviceId, PropertyKey key) { /* no-op */ }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        try { _poll?.Dispose(); } catch { }
        try { _enumerator.UnregisterEndpointNotificationCallback(this); } catch { }
        try { _enumerator.Dispose(); } catch { }
    }
}
