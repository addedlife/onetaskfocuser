using System.Diagnostics;
using System.IO;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace DeskPhone;

/// <summary>
/// Native shell that hosts the Shamash webapp (served by DeskPhone itself on
/// loopback) inside an embedded Edge WebView2.  This is the single-UI-codebase
/// pattern: the polished web phone screen IS the desktop UI, while this process
/// keeps doing Bluetooth, the control API, and notifications underneath it.
///
/// Pro details handled here:
///  - explicit user-data folder under %LOCALAPPDATA% (required for unpackaged
///    apps; default would try to write next to the EXE),
///  - auto-grant of microphone permission for the loopback origin so the call
///    audio console's Talk feature works without a prompt,
///  - external links open in the default browser instead of trapping the user,
///  - graceful fallback when the WebView2 runtime is missing.
/// </summary>
public partial class WebShellWindow : Window
{
    private readonly string _url;
    private int _navRetries;
    private const string LoopbackOrigin = "http://127.0.0.1:8765";
    private string? _lastPalette;
    private System.Collections.Generic.IReadOnlyDictionary<string, string>? _lastColors;

    public WebShellWindow(string url)
    {
        _url = url;
        InitializeComponent();
        Loaded += async (_, _) => await InitializeAsync();
    }

    private async Task InitializeAsync()
    {
        try
        {
            var userDataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DeskPhone", "WebView2");
            var env = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
            await Web.EnsureCoreWebView2Async(env);

            var core = Web.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = true;
            core.Settings.IsStatusBarEnabled = false;

            // The web UI's Talk feature needs the mic; the page is our own
            // loopback origin, so grant silently instead of prompting.
            core.PermissionRequested += (_, e) =>
            {
                if (e.PermissionKind == CoreWebView2PermissionKind.Microphone &&
                    e.Uri.StartsWith(LoopbackOrigin, StringComparison.OrdinalIgnoreCase))
                {
                    e.State = CoreWebView2PermissionState.Allow;
                    e.Handled = true;
                }
            };

            // Keep loopback navigation inside the shell; send everything else
            // (external links in messages, etc.) to the default browser.
            core.NewWindowRequested += (_, e) =>
            {
                e.Handled = true;
                if (e.Uri.StartsWith(LoopbackOrigin, StringComparison.OrdinalIgnoreCase))
                    core.Navigate(e.Uri);
                else
                    TryShellOpen(e.Uri);
            };

            core.DocumentTitleChanged += (_, _) =>
            {
                var t = core.DocumentTitle;
                Title = string.IsNullOrWhiteSpace(t) ? "DeskPhone"
                      : t.Contains("DeskPhone", StringComparison.OrdinalIgnoreCase) ? t
                      : $"{t} — DeskPhone";
            };

            // Startup race: when this window opens at app launch, the loopback
            // HTTP listener may not be accepting yet. Retry the first navigation
            // a few times instead of stranding the user on a browser error page.
            core.NavigationCompleted += (_, e) =>
            {
                if (e.IsSuccess) { _navRetries = 0; return; }
                if (_navRetries >= 12) return;
                _navRetries++;
                _ = Dispatcher.InvokeAsync(async () =>
                {
                    await Task.Delay(900);
                    try { core.Navigate(_url); } catch { }
                });
            };

            core.Navigate(_url);
        }
        catch (Exception ex)
        {
            // Most common cause: WebView2 runtime not installed.
            Web.Visibility = Visibility.Collapsed;
            Fallback.Visibility = Visibility.Visible;
            FallbackDetail.Text = ex.Message;
        }
    }

    private void OpenInBrowser_Click(object sender, RoutedEventArgs e) => TryShellOpen(_url);

    private static void TryShellOpen(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch { /* no default browser handler — nothing sensible to do */ }
    }

    public void PushTheme(string palette, System.Collections.Generic.IReadOnlyDictionary<string, string> colors)
    {
        _lastPalette = palette;
        _lastColors = colors;
        if (Web.CoreWebView2 == null) return;
        try
        {
            var json = System.Text.Json.JsonSerializer.Serialize(new
            {
                type = "dp-theme-update",
                palette = palette,
                colors = colors
            });
            Web.CoreWebView2.PostWebMessageAsJson(json);
        }
        catch { }
    }
}
