using System.Windows;
using System.Windows.Media;

namespace DeskPhone.Services;

/// <summary>
/// Hot-swaps the active colour palette and UI skin at runtime by replacing
/// the corresponding merged ResourceDictionary in Application.Resources.
///
/// Two independent axes — mix any palette with any skin:
///   Palette  (merged[0])  — colour tokens only (BgMain, AccentBlue, etc.)
///   Skin     (merged[1])  — shape/geometry/font styles (buttons, cards, etc.)
///
/// All elements use DynamicResource, so a swap triggers an instant re-render
/// of every brush and style in the window — no restart needed.
///
/// URI note: at runtime we must use pack:// absolute URIs, not relative paths.
/// XAML loaders resolve relative URIs themselves; code-behind does not.
/// </summary>
public static class ThemeService
{
    // ── Catalogue ─────────────────────────────────────────────────────────

    public static readonly string[] AvailablePalettes =
        { "BlueGold", "Google", "Claude", "Aurora", "StarryNight", "Nebula", "Arctic" };

    public static readonly string[] AvailableSkins =
        { "Material", "Apple", "Optimus" };

    // Display labels that the UI shows (same index order as above)
    public static readonly string[] PaletteLabels =
        { "Blue Gold", "Google", "Claude", "Aurora", "Starry Night", "Nebula", "Arctic" };

    public static readonly string[] SkinLabels =
        { "Material", "Apple", "Optimus" };

    // ── State ─────────────────────────────────────────────────────────────

    private static string _currentPalette = "BlueGold";
    private static string _currentSkin    = "Material";

    public static string CurrentPalette => _currentPalette;
    public static string CurrentSkin    => _currentSkin;

    // ── Helpers ───────────────────────────────────────────────────────────

    private static Uri PaletteUri(string name) =>
        new($"pack://application:,,,/Themes/Palettes/{name}.xaml");

    private static Uri SkinUri(string name) =>
        new($"pack://application:,,,/Themes/Skins/{name}.xaml");

    // ── Public API ────────────────────────────────────────────────────────

    /// <summary>Swap the colour palette. Call on the UI thread.</summary>
    public static void ApplyPalette(string name)
    {
        if (!AvailablePalettes.Contains(name)) return;
        try
        {
            SwapDict(0, PaletteUri(name));
            _currentPalette = name;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Theme] palette swap failed: {ex.Message}");
        }
    }

    public static void ApplyBridgeColors(IReadOnlyDictionary<string, string> colors)
    {
        if (colors.Count == 0) return;

        SetBrush("Background", colors, "bg");
        SetBrush("OnBackground", colors, "text");
        SetBrush("Surface", colors, "card");
        SetBrush("OnSurface", colors, "text");
        SetBrush("SurfaceVariant", colors, "brdS");
        SetBrush("OnSurfaceVariant", colors, "tSoft");
        SetBrush("SurfaceContainerLowest", colors, "card");
        SetBrush("SurfaceContainerLow", colors, "bgW");
        SetBrush("SurfaceContainer", colors, "bgW");
        SetBrush("SurfaceContainerHigh", colors, "brdS");
        SetBrush("SurfaceContainerHighest", colors, "brd");
        SetBrush("Outline", colors, "tFaint");
        SetBrush("OutlineVariant", colors, "brd");

        SetBrush("BgMain", colors, "card");
        SetBrush("BgSidebar", colors, "bg");
        SetBrush("BgHover", colors, "bgW");
        SetBrush("BgInput", colors, "bgW");
        SetBrush("BgSelected", colors, "tonal");

        SetBrush("Primary", colors, "primary");
        SetBrush("OnPrimary", colors, "onPrimary");
        SetBrush("PrimaryContainer", colors, "tonal");
        SetBrush("OnPrimaryContainer", colors, "onTonal");
        SetBrush("AccentBlue", colors, "primary");
        SetBrush("AccentBlueDark", colors, "primary");
        SetBrush("AccentBlueLight", colors, "tonal");
        SetBrush("BorderFocus", colors, "primary");

        SetBrush("TextPrimary", colors, "text");
        SetBrush("TextSecond", colors, "tSoft");
        SetBrush("TextMuted", colors, "tFaint");
        SetBrush("TextDisabled", colors, "tFaint");
        SetBrush("TextOnAccent", colors, "onPrimary");
        SetBrush("TextOnAccentBlueLight", colors, "onTonal");
        SetBrush("Border", colors, "brd");

        SetBrush("BubbleIn", colors, "bgW");
        SetBrush("BubbleInBorder", colors, "brd");
        SetBrush("BubbleOut", colors, "primary");
        SetBrush("BubbleOutText", colors, "onPrimary");
    }

    /// <summary>Swap the UI skin. Call on the UI thread.</summary>
    public static void ApplySkin(string name)
    {
        if (!AvailableSkins.Contains(name)) return;
        try
        {
            SwapDict(1, SkinUri(name));
            _currentSkin = name;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Theme] skin swap failed: {ex.Message}");
        }
    }

    /// <summary>Legacy single-string apply — maps old "Light/Dark/Midnight" to new names.</summary>
    public static void Apply(string name)
    {
        // Map legacy names so old settings.json entries still work
        var mapped = name switch
        {
            "Light"    => "Google",
            "Dark"     => "StarryNight",
            "Midnight" => "Nebula",
            _          => name
        };
        ApplyPalette(mapped);
    }

    // ── Internal ──────────────────────────────────────────────────────────

    private static void SwapDict(int index, Uri uri)
    {
        var app = Application.Current;
        if (app is null) return;
        var merged = app.Resources.MergedDictionaries;
        if (merged.Count <= index) return;

        // Remove + insert at same position — WPF DynamicResource updates reliably
        merged.RemoveAt(index);
        merged.Insert(index, new ResourceDictionary { Source = uri });
    }

    private static void SetBrush(string resourceKey, IReadOnlyDictionary<string, string> colors, string colorKey)
    {
        if (!colors.TryGetValue(colorKey, out var raw) || !TryParseColor(raw, out var color))
            return;

        Application.Current.Resources[resourceKey] = new SolidColorBrush(color);
    }

    private static bool TryParseColor(string raw, out System.Windows.Media.Color color)
    {
        color = default;
        if (string.IsNullOrWhiteSpace(raw)) return false;

        try
        {
            var parsed = System.Windows.Media.ColorConverter.ConvertFromString(raw.Trim());
            if (parsed is not System.Windows.Media.Color c) return false;
            color = c;
            return true;
        }
        catch
        {
            return false;
        }
    }
}
