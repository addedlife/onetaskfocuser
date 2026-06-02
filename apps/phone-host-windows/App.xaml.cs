using System.Windows;
using DeskPhone.ViewModels;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Toolkit.Uwp.Notifications;

namespace DeskPhone;

public partial class App : Application
{
    private const string AppUserModelId = "PureInc.DeskPhone";

    protected override void OnStartup(StartupEventArgs e)
    {
        SetCurrentProcessExplicitAppUserModelID(AppUserModelId);

        // Register the toast-notification activation handler BEFORE any toasts are shown.
        // ToastNotificationManagerCompat registers a COM activator in HKCU on first call so
        // that Windows routes "background" activation (reply button, quick-reply chips) back
        // into THIS running process — no window opens, no shell launch, completely silent.
        ToastNotificationManagerCompat.OnActivated += toastArgs =>
            Current.Dispatcher.Invoke(() => GetViewModel()?.HandleToastActivation(toastArgs));

        base.OnStartup(e);

        // Wire up process-exit hooks so BT is disconnected cleanly even on
        // forced kills (task manager, build script taskkill, Windows logoff).
        // Shutdown() is idempotent so calling it multiple times is safe.
        AppDomain.CurrentDomain.ProcessExit += (_, _) => GetViewModel()?.Shutdown();
        Current.SessionEnding              += (_, _) => GetViewModel()?.Shutdown();

        DispatcherUnhandledException += (_, ex) =>
        {
            try
            {
                var dir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "DeskPhone");
                Directory.CreateDirectory(dir);
                var path = Path.Combine(dir, "unhandled-exceptions.log");
                File.AppendAllText(path,
                    $"=== {DateTime.Now:yyyy-MM-dd HH:mm:ss} ==={Environment.NewLine}{ex.Exception}{Environment.NewLine}{Environment.NewLine}");
            }
            catch { }

            System.Windows.MessageBox.Show($"Unexpected error:\n\n{ex.Exception.Message}",
                "DeskPhone Error",
                System.Windows.MessageBoxButton.OK,
                System.Windows.MessageBoxImage.Error);
            ex.Handled = true;
        };
    }

    private static MainViewModel? GetViewModel()
        => Current?.MainWindow?.DataContext as MainViewModel;

    [DllImport("shell32.dll", SetLastError = true)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(
        [MarshalAs(UnmanagedType.LPWStr)] string appId);
}
