using DeskPhone.ViewModels;
using DeskPhone.Helpers;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media.Imaging;
using System.Windows.Media;
using System.Windows.Controls.Primitives;
using System.Windows.Interop;
using System.Diagnostics;
using System.IO;

namespace DeskPhone;

public partial class MainWindow : Window
{
    private const double CompactRailThreshold = 1200;
    private const double ConversationStackThreshold = 760;
    private const double CallsStackThreshold = 780;

    // The web shell is the only window users see. MainWindow stays hidden as
    // the plumbing host (services, ViewModel, WPF lifetime, stage mode).
    private const string WebShellUrl = "http://127.0.0.1:8765/?standalone=deskphone";
    private WebShellWindow? _webShell;
    private bool _mainWindowXamlVisible;

    public bool IsMainWindowXamlVisible => _mainWindowXamlVisible;

    private bool _isAdjustingBounds;
    private bool _isStageMode;
    private bool _stageActivated;
    private WindowStyle _preStageWindowStyle;
    private ResizeMode _preStageResizeMode;
    private bool _preStageTopmost;
    private DateTime _lastStagePulseUtc = DateTime.MinValue;
    private string _stageOwnerToken = "";
    private double _stageLeaseSeconds = 8;
    private readonly System.Windows.Threading.DispatcherTimer _stageWatchdog = new()
    {
        Interval = TimeSpan.FromSeconds(2)
    };
    private bool _isSyncingNavigationSelection;
    private ScrollViewer? _messageScrollViewer;
    private LogWindow? _logWindow;

    public MainWindow()
    {
        InitializeComponent();
        SetWindowIcon();
        MessageBodyFormatter.UrlClicked += OpenUrlInChrome;
        MessageBodyFormatter.PhoneClicked += ShowPhoneActions;
        // Auto-scroll to bottom when switching conversations or when messages load
        Loaded += (_, _) =>
        {
            EnsureMessageScrollViewer();
            if (DataContext is MainViewModel vm)
            {
                vm.ShowConversationCallHistoryPane = true;
                vm.RequestScrollToMessage += ScrollMessageIntoView;
                vm.PropertyChanged += (_, e) =>
                {
                    if (e.PropertyName == nameof(MainViewModel.SelectedConversation))
                        QueueScrollToNewestMessage();

                    if (e.PropertyName == nameof(MainViewModel.ShowLiveLog))
                    {
                        Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Loaded,
                            SyncLogWindow);
                    }

                    if (e.PropertyName == nameof(MainViewModel.SelectedTab))
                    {
                        Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Loaded,
                            SyncSelectedTabFromViewModel);
                    }

                    if (e.PropertyName is nameof(MainViewModel.ShowMessagesListPane)
                        or nameof(MainViewModel.ShowConversationCallHistoryPane)
                        or nameof(MainViewModel.ShowRecentCallsPane)
                        or nameof(MainViewModel.ShowDialerPane)
                        or nameof(MainViewModel.IsNavigationRailCollapsed)
                        or nameof(MainViewModel.UiScale))
                    {
                        Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Loaded,
                            ApplyResponsiveLayout);
                    }
                };
            }

            ApplyResponsiveLayout();
            EnsureWindowFitsCurrentScreen();
            SyncSelectedTabFromViewModel();
            SyncLogWindow();
            UpdateWindowFrameCompensation();
            QueueScrollToNewestMessage();
        };

        // Open the web shell as the visible DeskPhone window; keep this WPF
        // window hidden so it doesn't appear in the taskbar or on screen.
        Loaded += (_, _) =>
        {
            ShowInTaskbar = false;
            _webShell = new WebShellWindow(WebShellUrl);
            _webShell.Closed += (_, _) => Close();
            _webShell.Show();
            Hide();
        };

        SizeChanged += (_, _) => ApplyResponsiveLayout();
        LocationChanged += (_, _) => EnsureWindowFitsCurrentScreen();
        StateChanged += (_, _) =>
        {
            if (WindowState == WindowState.Normal)
                EnsureWindowFitsCurrentScreen();

            UpdateWindowFrameCompensation();
            ApplyResponsiveLayout();
        };

        _stageWatchdog.Tick += (_, _) =>
        {
            if (_isStageMode && DateTime.UtcNow - _lastStagePulseUtc > TimeSpan.FromSeconds(_stageLeaseSeconds))
                ExitStageModeOnUi(force: true);
        };
    }

    public bool SetStageBounds(double screenX, double screenY, double width, double height, bool showChrome, string token = "")
    {
        if (width < 360 || height < 360)
            return false;

        Dispatcher.Invoke(() =>
        {
            _lastStagePulseUtc = DateTime.UtcNow;
            _stageOwnerToken = token ?? "";
            _stageLeaseSeconds = string.IsNullOrWhiteSpace(_stageOwnerToken) ? 8 : 30;
            if (!_isStageMode)
            {
                _preStageWindowStyle = WindowStyle;
                _preStageResizeMode = ResizeMode;
                _preStageTopmost = Topmost;
                _stageActivated = false;
            }

            _isStageMode = true;
            Show();
            if (WindowState != WindowState.Normal)
                WindowState = WindowState.Normal;

            WindowStyle = showChrome ? _preStageWindowStyle : WindowStyle.None;
            ResizeMode = showChrome ? _preStageResizeMode : ResizeMode.NoResize;
            Topmost = true;

            Left = screenX;
            Top = screenY;
            Width = width;
            Height = height;

            if (!_stageActivated)
            {
                Activate();
                _stageActivated = true;
            }

            _stageWatchdog.Start();
            ApplyResponsiveLayout();
        });

        return true;
    }

    public bool PulseStage(string token = "")
    {
        var ok = false;
        Dispatcher.Invoke(() =>
        {
            ok = _isStageMode && StageTokenMatches(token);
            if (ok)
                _lastStagePulseUtc = DateTime.UtcNow;
        });

        return ok;
    }

    public bool ExitStageMode(string token = "", bool force = false)
    {
        var ok = false;
        Dispatcher.Invoke(() => ok = ExitStageModeOnUi(token, force));

        return ok;
    }

    public bool BringToFront()
    {
        if (_webShell is { } shell)
        {
            Dispatcher.Invoke(() =>
            {
                shell.Show();
                if (shell.WindowState == WindowState.Minimized)
                    shell.WindowState = WindowState.Normal;
                shell.Activate();
            });
            return true;
        }
        if (Dispatcher.CheckAccess())
            BringToFrontOnUi();
        else
            Dispatcher.Invoke(BringToFrontOnUi);
        return true;
    }

    public bool HideWindow()
    {
        if (_webShell is { } shell)
        {
            Dispatcher.Invoke(() => shell.WindowState = WindowState.Minimized);
            return true;
        }
        if (Dispatcher.CheckAccess())
            WindowState = WindowState.Minimized;
        else
            Dispatcher.Invoke(() => { WindowState = WindowState.Minimized; });
        return true;
    }

    /// <summary>Show or hide the native WPF shell (MainWindow). Default is hidden — WebShellWindow is the user-facing UI.</summary>
    public bool ToggleMainWindowXamlUi()
    {
        _mainWindowXamlVisible = !_mainWindowXamlVisible;
        if (_mainWindowXamlVisible)
        {
            ShowInTaskbar = true;
            Show();
            if (WindowState == WindowState.Minimized)
                WindowState = WindowState.Normal;
            Activate();
            ApplyResponsiveLayout();
        }
        else
        {
            Hide();
            ShowInTaskbar = false;
        }

        return _mainWindowXamlVisible;
    }

    private bool ExitStageModeOnUi(string token = "", bool force = false)
    {
        if (!_isStageMode)
            return true;

        if (!force && !StageTokenMatches(token))
            return false;

        _stageWatchdog.Stop();
        _isStageMode = false;
        _stageActivated = false;
        _stageOwnerToken = "";
        WindowStyle = _preStageWindowStyle;
        ResizeMode = _preStageResizeMode;
        Topmost = _preStageTopmost;
        EnsureWindowFitsCurrentScreen();
        ApplyResponsiveLayout();

        return true;
    }

    private void BringToFrontOnUi()
    {
        ExitStageModeOnUi(force: true);

        Show();
        if (WindowState == WindowState.Minimized)
            WindowState = WindowState.Normal;

        var previousTopmost = Topmost;
        Topmost = true;
        Activate();
        Topmost = previousTopmost;
        Focus();
    }

    public bool OpenHandoffTarget(string? target, string? value = null)
    {
        if (Dispatcher.CheckAccess())
            return OpenHandoffTargetOnUi(target, value);

        var ok = false;
        Dispatcher.Invoke(() => ok = OpenHandoffTargetOnUi(target, value));
        return ok;
    }

    private bool OpenHandoffTargetOnUi(string? target, string? value)
    {
        BringToFrontOnUi();

        if (DataContext is not MainViewModel vm)
            return false;

        var key = NormalizeHandoffTarget(target);
        var targetValue = value?.Trim() ?? "";

        switch (key)
        {
            case "":
            case "show":
                return true;

            case "messages":
            case "phone":
                vm.SelectedTab = AppTab.Messages;
                QueueScrollToNewestMessage();
                return true;

            case "new-message":
            case "compose":
            case "text":
                vm.SelectedTab = AppTab.Messages;
                if (!string.IsNullOrWhiteSpace(targetValue))
                    return OpenMessageTarget(targetValue, showCompose: true);

                vm.SelectedConversation = null;
                vm.ComposeToNumber = "";
                vm.ComposeRecipientInput = "";
                vm.ComposeBody = "";
                vm.ShowComposePanel = true;
                Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Loaded, new Action(() =>
                    FocusTextBox(ComposeRecipientTextBox)));
                return true;

            case "make-call":
            case "calls":
            case "dialer":
            case "call":
                vm.SelectedTab = AppTab.Calls;
                vm.ShowDialerPane = true;
                vm.ShowRecentCallsPane = true;
                if (!string.IsNullOrWhiteSpace(targetValue))
                    vm.DialNumber = targetValue;
                Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Loaded, new Action(() =>
                    FocusTextBox(MainDialNumberBox)));
                return true;

            case "contacts":
            case "contact-manager":
                vm.SelectedTab = AppTab.Contacts;
                return true;

            case "new-contact":
                vm.SelectedTab = AppTab.Contacts;
                if (!string.IsNullOrWhiteSpace(targetValue) && vm.SaveAsContactCommand.CanExecute(targetValue))
                    vm.SaveAsContactCommand.Execute(targetValue);
                else if (vm.NewContactCommand.CanExecute(null))
                    vm.NewContactCommand.Execute(null);
                Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Loaded, new Action(() =>
                    FocusTextBox(ContactManagerNameBox)));
                return true;

            case "edit-contact":
                vm.SelectedTab = AppTab.Contacts;
                var contact = vm.FindContactForNumber(targetValue);
                if (contact is not null && vm.EditContactCommand.CanExecute(contact))
                    vm.EditContactCommand.Execute(contact);
                else if (!string.IsNullOrWhiteSpace(targetValue) && vm.SaveAsContactCommand.CanExecute(targetValue))
                    vm.SaveAsContactCommand.Execute(targetValue);
                else if (vm.NewContactCommand.CanExecute(null))
                    vm.NewContactCommand.Execute(null);
                Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Loaded, new Action(() =>
                    FocusTextBox(ContactManagerNameBox)));
                return true;

            case "mark-read":
            case "mark-unread":
            case "toggle-pin":
            case "toggle-mute":
            case "toggle-block":
                vm.SelectedTab = AppTab.Messages;
                var conversation = vm.FindConversationForPhone(targetValue);
                if (conversation is null)
                    return true;

                var command = key switch
                {
                    "mark-read" => vm.MarkConversationReadCommand,
                    "mark-unread" => vm.MarkConversationUnreadCommand,
                    "toggle-pin" => vm.ToggleConversationPinnedCommand,
                    "toggle-mute" => vm.ToggleConversationAlertsMutedCommand,
                    "toggle-block" => vm.ToggleConversationBlockedCommand,
                    _ => null
                };

                if (command?.CanExecute(conversation) == true)
                    command.Execute(conversation);
                return true;

            case "settings":
            case "connection-settings":
            case "settings-connection":
                vm.SelectedTab = AppTab.Settings;
                vm.SelectedSettingsSection = SettingsSection.Connection;
                return true;

            case "settings-appearance":
                vm.SelectedTab = AppTab.Settings;
                vm.SelectedSettingsSection = SettingsSection.Appearance;
                return true;

            case "settings-sync":
                vm.SelectedTab = AppTab.Settings;
                vm.SelectedSettingsSection = SettingsSection.Sync;
                return true;

            case "settings-audio":
                vm.SelectedTab = AppTab.Settings;
                vm.SelectedSettingsSection = SettingsSection.Audio;
                return true;

            case "developer":
            case "developer-tools":
                vm.SelectedTab = AppTab.DeveloperTools;
                return true;

            case "live-log":
            case "log":
                vm.ShowLiveLog = true;
                SyncLogWindow();
                return true;

            case "build-update":
                if (vm.ShowBuildUpdatePromptCommand.CanExecute(null))
                    vm.ShowBuildUpdatePromptCommand.Execute(null);
                return true;

            default:
                return false;
        }
    }

    private static string NormalizeHandoffTarget(string? target)
        => (target ?? "")
            .Trim()
            .ToLowerInvariant()
            .Replace("_", "-")
            .Replace(" ", "-");

    private bool StageTokenMatches(string token)
    {
        return string.IsNullOrWhiteSpace(_stageOwnerToken)
            || (!string.IsNullOrWhiteSpace(token) && string.Equals(token, _stageOwnerToken, StringComparison.Ordinal));
    }

    private void ApplyResponsiveLayout()
    {
        if (!IsLoaded)
            return;

        UpdateWindowFrameCompensation();
        ApplyShellLayout();
        ApplyConversationLayout();
        ApplyCallsLayout();
    }

    private void UpdateWindowFrameCompensation()
    {
        if (RootShellGrid == null)
            return;

        if (WindowState != WindowState.Maximized)
        {
            RootShellGrid.Margin = new Thickness(0);
            return;
        }

        var resizeBorder = SystemParameters.WindowResizeBorderThickness;
        const double overscan = 1;

        RootShellGrid.Margin = new Thickness(
            -Math.Ceiling(resizeBorder.Left + overscan),
            -Math.Ceiling(resizeBorder.Top + overscan),
            -Math.Ceiling(resizeBorder.Right + overscan),
            -Math.Ceiling(resizeBorder.Bottom + overscan));
    }

    private double GetUiScale()
        => DataContext is MainViewModel vm ? Math.Max(vm.UiScale, 0.5d) : 1d;

    private double GetEffectiveWidth(double rawWidth)
        => rawWidth / GetUiScale();

    private void ApplyShellLayout()
    {
        var compactRail = (DataContext is MainViewModel vm && vm.IsNavigationRailCollapsed)
            || GetEffectiveWidth(ActualWidth) < CompactRailThreshold;
        RootNavigationColumn.Width = new GridLength(compactRail ? 76 : 268);
        RootNavigationColumn.MinWidth = compactRail ? 76 : 224;
        RootNavigationColumn.MaxWidth = compactRail ? 76 : 320;
        ShellNavigationSplitter.Visibility = compactRail ? Visibility.Collapsed : Visibility.Visible;
    }

    private void ApplyConversationLayout()
    {
        if (DataContext is not MainViewModel vm)
            return;

        var showMessagesList = vm.ShowMessagesListPane;
        var effectiveMessagesWidth = GetEffectiveWidth(MessagesRootGrid.ActualWidth);

        var messageListWidth = effectiveMessagesWidth < 980 ? 220 : 300;
        MessagesListColumn.Width = showMessagesList
            ? new GridLength(messageListWidth)
            : new GridLength(0);
        MessagesListColumn.MinWidth = showMessagesList ? 200 : 0;
        MessagesListColumn.MaxWidth = showMessagesList ? 420 : 0;
        MessagesListSplitter.Visibility = showMessagesList ? Visibility.Visible : Visibility.Collapsed;

        var listWidth = showMessagesList ? messageListWidth : 0;
        var availableWidth = Math.Max(effectiveMessagesWidth - listWidth, 0);
        var stackCallHistory = false;
        var callHistoryWidth = availableWidth >= 980 ? 360 : 300;
        var messageMinimumWidth = availableWidth < 900 ? 300 : 360;

        ConversationCallHistoryPane.Visibility = Visibility.Visible;

        if (stackCallHistory)
        {
            ConversationDetailPrimaryRow.Height = new GridLength(2, GridUnitType.Star);
            ConversationDetailHorizontalSplitterRow.Height = GridLength.Auto;
            ConversationDetailSecondaryRow.Height = new GridLength(1, GridUnitType.Star);

            ConversationMessagesColumn.Width = new GridLength(1, GridUnitType.Star);
            ConversationMessagesColumn.MinWidth = 0;
            ConversationVerticalSplitter.Visibility = Visibility.Collapsed;
            ConversationVerticalSplitterColumn.Width = new GridLength(0);
            ConversationHorizontalSplitter.Visibility = Visibility.Visible;
            ConversationCallHistoryColumn.Width = new GridLength(0);
            ConversationCallHistoryColumn.MinWidth = 0;
            ConversationCallHistoryColumn.MaxWidth = 0;

            Grid.SetRow(ConversationMessagesPane, 0);
            Grid.SetColumn(ConversationMessagesPane, 0);
            Grid.SetColumnSpan(ConversationMessagesPane, 3);

            Grid.SetRow(ConversationCallHistoryPane, 2);
            Grid.SetColumn(ConversationCallHistoryPane, 0);
            Grid.SetColumnSpan(ConversationCallHistoryPane, 3);
            ConversationCallHistoryPane.BorderThickness = new Thickness(0, 1, 0, 0);
        }
        else
        {
            ConversationDetailPrimaryRow.Height = new GridLength(1, GridUnitType.Star);
            ConversationDetailHorizontalSplitterRow.Height = new GridLength(0);
            ConversationDetailSecondaryRow.Height = new GridLength(0);

            ConversationMessagesColumn.Width = new GridLength(1, GridUnitType.Star);
            ConversationMessagesColumn.MinWidth = messageMinimumWidth;
            ConversationVerticalSplitter.Visibility = Visibility.Visible;
            ConversationVerticalSplitterColumn.Width = GridLength.Auto;
            ConversationHorizontalSplitter.Visibility = Visibility.Collapsed;
            ConversationCallHistoryColumn.Width = new GridLength(callHistoryWidth);
            ConversationCallHistoryColumn.MinWidth = availableWidth < 900 ? 280 : 300;
            ConversationCallHistoryColumn.MaxWidth = 460;

            Grid.SetRow(ConversationMessagesPane, 0);
            Grid.SetColumn(ConversationMessagesPane, 0);
            Grid.SetColumnSpan(ConversationMessagesPane, 1);

            Grid.SetRow(ConversationCallHistoryPane, 0);
            Grid.SetColumn(ConversationCallHistoryPane, 2);
            Grid.SetColumnSpan(ConversationCallHistoryPane, 1);
            ConversationCallHistoryPane.BorderThickness = new Thickness(1, 0, 0, 0);
        }
    }

    private void SyncLogWindow()
    {
        if (DataContext is not MainViewModel vm)
            return;

        if (vm.ShowLiveLog)
        {
            if (_logWindow == null)
            {
                _logWindow = new LogWindow(vm);
                _logWindow.Closed += (_, _) =>
                {
                    var currentVm = DataContext as MainViewModel;
                    var shouldResetToggle = currentVm?.ShowLiveLog == true;
                    _logWindow = null;
                    if (shouldResetToggle)
                        currentVm!.ShowLiveLog = false;
                };
                PositionLogWindow(_logWindow);
                _logWindow.Show();
                _logWindow.Activate();
                return;
            }

            if (!_logWindow.IsVisible)
                _logWindow.Show();

            if (_logWindow.WindowState == WindowState.Minimized)
                _logWindow.WindowState = WindowState.Normal;

            _logWindow.Activate();

            return;
        }

        if (_logWindow == null)
            return;

        var window = _logWindow;
        _logWindow = null;
        window.Close();
    }

    private void PositionLogWindow(LogWindow window)
    {
        var handle = new WindowInteropHelper(this).Handle;
        if (handle == IntPtr.Zero)
            return;

        var screen = System.Windows.Forms.Screen.FromHandle(handle);
        var dpi = VisualTreeHelper.GetDpi(this);
        var workArea = new Rect(
            screen.WorkingArea.Left / dpi.DpiScaleX,
            screen.WorkingArea.Top / dpi.DpiScaleY,
            screen.WorkingArea.Width / dpi.DpiScaleX,
            screen.WorkingArea.Height / dpi.DpiScaleY);

        var desiredLeft = Left + Width + 18;
        if (desiredLeft + window.Width > workArea.Right)
            desiredLeft = Left - window.Width - 18;

        if (desiredLeft < workArea.Left)
            desiredLeft = Math.Max(workArea.Left, workArea.Right - window.Width);

        var desiredTop = Top + 24;
        if (desiredTop + window.Height > workArea.Bottom)
            desiredTop = Math.Max(workArea.Top, workArea.Bottom - window.Height);

        window.Left = desiredLeft;
        window.Top = desiredTop;
    }

    private void ApplyCallsLayout()
    {
        if (DataContext is not MainViewModel vm)
            return;

        var showRecentCalls = vm.ShowRecentCallsPane;
        var showDialer = vm.ShowDialerPane;
        var stackDialer = false;

        RecentCallsPane.Visibility = showRecentCalls ? Visibility.Visible : Visibility.Collapsed;
        DialerPane.Visibility = showDialer ? Visibility.Visible : Visibility.Collapsed;

        if (showRecentCalls && !showDialer)
        {
            CallsPrimaryRow.Height = new GridLength(1, GridUnitType.Star);
            CallsHorizontalSplitterRow.Height = new GridLength(0);
            CallsSecondaryRow.Height = new GridLength(0);
            CallsVerticalSplitter.Visibility = Visibility.Collapsed;
            CallsVerticalSplitterColumn.Width = new GridLength(0);
            CallsHorizontalSplitter.Visibility = Visibility.Collapsed;
            CallsListColumn.Width = new GridLength(1, GridUnitType.Star);
            DialerColumn.Width = new GridLength(0);
            DialerColumn.MinWidth = 0;
            DialerColumn.MaxWidth = 0;

            Grid.SetRow(RecentCallsPane, 0);
            Grid.SetColumn(RecentCallsPane, 0);
            Grid.SetColumnSpan(RecentCallsPane, 3);
            return;
        }

        if (!showRecentCalls && showDialer)
        {
            CallsPrimaryRow.Height = new GridLength(1, GridUnitType.Star);
            CallsHorizontalSplitterRow.Height = new GridLength(0);
            CallsSecondaryRow.Height = new GridLength(0);
            CallsVerticalSplitter.Visibility = Visibility.Collapsed;
            CallsVerticalSplitterColumn.Width = new GridLength(0);
            CallsHorizontalSplitter.Visibility = Visibility.Collapsed;
            CallsListColumn.Width = new GridLength(0);
            DialerColumn.Width = new GridLength(1, GridUnitType.Star);
            DialerColumn.MinWidth = 0;
            DialerColumn.MaxWidth = double.PositiveInfinity;

            Grid.SetRow(DialerPane, 0);
            Grid.SetColumn(DialerPane, 0);
            Grid.SetColumnSpan(DialerPane, 3);
            DialerPane.BorderThickness = new Thickness(0);
            return;
        }

        CallsListColumn.Width = new GridLength(1, GridUnitType.Star);
        DialerColumn.Width = new GridLength(332);
        DialerColumn.MinWidth = 296;
        DialerColumn.MaxWidth = 388;

        if (stackDialer)
        {
            CallsPrimaryRow.Height = new GridLength(1, GridUnitType.Star);
            CallsHorizontalSplitterRow.Height = GridLength.Auto;
            CallsSecondaryRow.Height = new GridLength(1, GridUnitType.Star);

            CallsVerticalSplitter.Visibility = Visibility.Collapsed;
            CallsVerticalSplitterColumn.Width = new GridLength(0);
            CallsHorizontalSplitter.Visibility = Visibility.Visible;

            Grid.SetRow(RecentCallsPane, 0);
            Grid.SetColumn(RecentCallsPane, 0);
            Grid.SetColumnSpan(RecentCallsPane, 3);

            Grid.SetRow(DialerPane, 2);
            Grid.SetColumn(DialerPane, 0);
            Grid.SetColumnSpan(DialerPane, 3);
            DialerPane.BorderThickness = new Thickness(0, 1, 0, 0);
        }
        else
        {
            CallsPrimaryRow.Height = new GridLength(1, GridUnitType.Star);
            CallsHorizontalSplitterRow.Height = new GridLength(0);
            CallsSecondaryRow.Height = new GridLength(0);

            CallsVerticalSplitter.Visibility = Visibility.Visible;
            CallsVerticalSplitterColumn.Width = GridLength.Auto;
            CallsHorizontalSplitter.Visibility = Visibility.Collapsed;

            Grid.SetRow(RecentCallsPane, 0);
            Grid.SetColumn(RecentCallsPane, 0);
            Grid.SetColumnSpan(RecentCallsPane, 1);

            Grid.SetRow(DialerPane, 0);
            Grid.SetColumn(DialerPane, 2);
            Grid.SetColumnSpan(DialerPane, 1);
            DialerPane.BorderThickness = new Thickness(1, 0, 0, 0);
        }
    }

    private void EnsureWindowFitsCurrentScreen()
    {
        if (!IsLoaded || WindowState != WindowState.Normal || _isAdjustingBounds)
            return;

        var handle = new WindowInteropHelper(this).Handle;
        if (handle == IntPtr.Zero)
            return;

        var screen = System.Windows.Forms.Screen.FromHandle(handle);
        var dpi = VisualTreeHelper.GetDpi(this);
        var workArea = new Rect(
            screen.WorkingArea.Left / dpi.DpiScaleX,
            screen.WorkingArea.Top / dpi.DpiScaleY,
            screen.WorkingArea.Width / dpi.DpiScaleX,
            screen.WorkingArea.Height / dpi.DpiScaleY);

        _isAdjustingBounds = true;
        try
        {
            if (Width > workArea.Width)
                Width = workArea.Width;

            if (Height > workArea.Height)
                Height = workArea.Height;

            if (Left < workArea.Left)
                Left = workArea.Left;

            if (Top < workArea.Top)
                Top = workArea.Top;

            if (Left + Width > workArea.Right)
                Left = Math.Max(workArea.Left, workArea.Right - Width);

            if (Top + Height > workArea.Bottom)
                Top = Math.Max(workArea.Top, workArea.Bottom - Height);
        }
        finally
        {
            _isAdjustingBounds = false;
        }
    }

    private void OpenUrlInChrome(string url)
    {
        Dispatcher.Invoke(() =>
        {
            try
            {
                var chromeCandidates = new[]
                {
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google", "Chrome", "Application", "chrome.exe"),
                    "chrome.exe"
                };

                var chrome = chromeCandidates.FirstOrDefault(c => c.Equals("chrome.exe", StringComparison.OrdinalIgnoreCase) || File.Exists(c));
                if (chrome != null)
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = chrome,
                        Arguments = url,
                        UseShellExecute = true
                    });
                }
            }
            catch { }
        });
    }

    private void OpenConnectionSettingsButton_Click(object sender, RoutedEventArgs e)
    {
        TabSettings.IsChecked = true;
        if (DataContext is MainViewModel vm)
            vm.SelectedSettingsSection = SettingsSection.Connection;
    }

    private void OpenLiveLogButton_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is MainViewModel vm)
            vm.ShowLiveLog = true;
    }

    private void MakeCallButton_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is MainViewModel vm)
        {
            vm.ShowDialerPane = true;
            vm.ShowRecentCallsPane = true;
        }

        TabCalls.IsChecked = true;
        Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Loaded, new Action(() =>
            FocusTextBox(MainDialNumberBox)));
    }

    private void NavigationTab_Checked(object sender, RoutedEventArgs e)
    {
        if (_isSyncingNavigationSelection || DataContext is not MainViewModel vm)
            return;

        if (sender is not FrameworkElement element || element.Tag is not string tag)
            return;

        if (Enum.TryParse<AppTab>(tag, out var tab))
            vm.SelectedTab = tab;
    }

    private void SyncSelectedTabFromViewModel()
    {
        if (DataContext is not MainViewModel vm)
            return;

        _isSyncingNavigationSelection = true;
        try
        {
            TabMessages.IsChecked = vm.SelectedTab == AppTab.Messages;
            TabCalls.IsChecked = vm.SelectedTab == AppTab.Calls;
            TabContacts.IsChecked = vm.SelectedTab == AppTab.Contacts;
            TabSettings.IsChecked = vm.SelectedTab == AppTab.Settings;
            TabDeveloperTools.IsChecked = vm.SelectedTab == AppTab.DeveloperTools;
        }
        finally
        {
            _isSyncingNavigationSelection = false;
        }
    }

    public bool OpenMessageBannerTarget(bool showCompose)
    {
        if (DataContext is not MainViewModel vm)
            return false;

        return OpenMessageTarget(vm.MessageBannerPhoneNumber, showCompose, dismissBanner: true);
    }

    private bool OpenMessageTarget(string? phoneNumber, bool showCompose, bool dismissBanner = false)
    {
        if (DataContext is not MainViewModel vm)
            return false;

        var targetPhone = DeskPhone.Services.ContactStoreService.NormalizePhone(phoneNumber);
        if (string.IsNullOrWhiteSpace(targetPhone))
            return false;

        Show();
        if (WindowState == WindowState.Minimized)
            WindowState = WindowState.Normal;

        Activate();
        TabMessages.IsChecked = true;

        var conversation = vm.FindConversationForPhone(targetPhone);
        if (conversation != null)
        {
            vm.ShowComposePanel = false;
            vm.SelectedConversation = conversation;
            if (dismissBanner)
                vm.DismissMessageBanner();

            Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Loaded, new Action(() =>
            {
                QueueScrollToNewestMessage();
                if (showCompose)
                    FocusTextBox(ReplyComposeBox);
            }));

            return true;
        }

        vm.SelectedConversation = null;
        vm.PrepareComposeForPhone(targetPhone);
        vm.ShowComposePanel = true;
        if (dismissBanner)
            vm.DismissMessageBanner();

        Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Loaded, new Action(() =>
        {
            if (showCompose)
                FocusTextBox(ComposeNewBodyBox);
        }));

        return true;
    }

    private bool StartCallToPhone(string? phoneNumber)
    {
        if (DataContext is not MainViewModel vm)
            return false;

        var targetPhone = DeskPhone.Services.ContactStoreService.NormalizePhone(phoneNumber);
        if (string.IsNullOrWhiteSpace(targetPhone))
            return false;

        Show();
        if (WindowState == WindowState.Minimized)
            WindowState = WindowState.Normal;

        Activate();
        vm.SelectedTab = AppTab.Calls;
        vm.DialNumber = targetPhone;

        if (vm.DialCommand.CanExecute(null))
            vm.DialCommand.Execute(null);

        return true;
    }

    private static void FocusTextBox(System.Windows.Controls.TextBox? textBox)
    {
        if (textBox == null)
            return;

        textBox.Focus();
        Keyboard.Focus(textBox);
        textBox.CaretIndex = textBox.Text?.Length ?? 0;
    }

    private void MessageBannerPreview_Click(object sender, MouseButtonEventArgs e)
    {
        OpenMessageBannerTarget(showCompose: false);
        e.Handled = true;
    }

    private void MessageBannerOpenButton_Click(object sender, RoutedEventArgs e)
        => OpenMessageBannerTarget(showCompose: false);

    private void MessageBannerReplyButton_Click(object sender, RoutedEventArgs e)
        => OpenMessageBannerTarget(showCompose: true);

    private void MessageBannerCloseButton_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is MainViewModel vm)
            vm.DismissMessageBanner();
    }

    private void ContactManagerTextButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { DataContext: DeskPhone.Models.ContactOption option })
            OpenMessageTarget(option.PhoneNumber, showCompose: true);
    }

    private void ContactManagerCallButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not FrameworkElement { DataContext: DeskPhone.Models.ContactOption option })
            return;

        if (DataContext is not MainViewModel vm)
            return;

        vm.SelectedTab = AppTab.Calls;

        if (vm.DialContactCommand.CanExecute(option))
            vm.DialContactCommand.Execute(option);
        else
            vm.DialNumber = option.PhoneNumber;
    }

    private void ContactManagerEditButton_Click(object sender, RoutedEventArgs e)
        => FocusTextBox(ContactManagerNameBox);

    private void CallHistoryCallButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement element)
            StartCallToPhone(element.Tag as string);
    }

    private void CallHistoryMessageButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement element)
            OpenMessageTarget(element.Tag as string, showCompose: true);
    }

    private void ResetTextSizeButton_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is MainViewModel vm)
            vm.ResetUiScale();
    }

    private void OpenUiAuditorButton_Click(object sender, RoutedEventArgs e)
    {
        var auditorExe = FindUiAuditorExe();
        if (string.IsNullOrWhiteSpace(auditorExe))
        {
            System.Windows.MessageBox.Show(this,
                "DeskPhone UI Auditor was not found in this build.",
                "UI Auditor",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            return;
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = auditorExe,
            WorkingDirectory = Path.GetDirectoryName(auditorExe) ?? AppContext.BaseDirectory,
            UseShellExecute = true
        });
    }

    private static string? FindUiAuditorExe()
    {
        const string auditorExeName = "DeskPhoneUiAuditor.exe";
        var baseDir = new DirectoryInfo(AppContext.BaseDirectory);
        var candidates = new List<string>
        {
            Path.Combine(baseDir.FullName, "Tools", "DeskPhoneUiAuditor", auditorExeName)
        };

        for (var current = baseDir; current is not null; current = current.Parent)
        {
            candidates.Add(Path.Combine(current.FullName, "Tools", "DeskPhoneUiAuditor", auditorExeName));
            candidates.Add(Path.Combine(current.FullName, "Tools", "DeskPhoneUiAuditor", "bin", "Release", "net8.0-windows10.0.19041.0", auditorExeName));
            candidates.Add(Path.Combine(current.FullName, "Tools", "DeskPhoneUiAuditor", "bin", "Debug", "net8.0-windows10.0.19041.0", auditorExeName));
        }

        return candidates.FirstOrDefault(File.Exists);
    }

    private void UiScaleSlider_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        if (sender is Slider slider && slider.IsMouseCaptureWithin)
            return;

        CommitUiScaleDraftPercent();
    }

    private void UiScaleSlider_PreviewMouseLeftButtonUp(object sender, MouseButtonEventArgs e)
        => CommitUiScaleDraftPercent();

    private void UiScaleSlider_LostMouseCapture(object sender, System.Windows.Input.MouseEventArgs e)
        => CommitUiScaleDraftPercent();

    private void CommitUiScaleDraftPercent()
    {
        if (DataContext is MainViewModel vm)
            vm.CommitUiScaleDraftPercent();
    }

    private void ShowPhoneActions(string number)
    {
        if (string.IsNullOrWhiteSpace(number)) return;

        Dispatcher.Invoke(() =>
        {
            var menu = new ContextMenu
            {
                Placement = PlacementMode.MousePoint
            };

            var textItem = new MenuItem { Header = $"Text {Models.Conversation.FormatPhone(number)}" };
            textItem.Click += (_, _) =>
            {
                if (DataContext is MainViewModel vm)
                {
                    vm.SelectedConversation = null;
                    vm.ComposeRecipientInput = number;
                    vm.ComposeToNumber = number;
                    vm.ComposeBody = "";
                    vm.ShowComposePanel = true;
                    TabMessages.IsChecked = true;
                }
            };

            var callItem = new MenuItem { Header = $"Call {Models.Conversation.FormatPhone(number)}" };
            callItem.Click += (_, _) =>
            {
                if (DataContext is MainViewModel vm)
                {
                    vm.DialNumber = number;
                    TabCalls.IsChecked = true;
                }
            };

            if (DataContext is MainViewModel vm)
            {
                var existingContact = vm.FindContactForNumber(number);
                var contactItem = new MenuItem
                {
                    Header = existingContact == null ? "Save as contact" : "Edit contact"
                };
                contactItem.Click += (_, _) =>
                {
                    if (existingContact == null)
                        vm.SaveAsContactCommand.Execute(number);
                    else
                        vm.EditContactCommand.Execute(existingContact);
                };
                menu.Items.Add(contactItem);
            }

            menu.Items.Add(textItem);
            menu.Items.Add(callItem);
            menu.IsOpen = true;
        });
    }

    // Draw a blue circle + phone glyph icon and set it as the window/taskbar icon.
    private void SetWindowIcon()
    {
        try
        {
            using var bmp = new System.Drawing.Bitmap(64, 64,
                System.Drawing.Imaging.PixelFormat.Format32bppArgb);
            using (var g = System.Drawing.Graphics.FromImage(bmp))
            {
                g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                g.Clear(System.Drawing.Color.Transparent);

                using var circleBrush = new System.Drawing.SolidBrush(
                    System.Drawing.Color.FromArgb(0xFF, 0x1A, 0x73, 0xE8));
                g.FillEllipse(circleBrush, 2, 2, 60, 60);

                using var fontMdl2 = new System.Drawing.Font(
                    "Segoe MDL2 Assets", 32f,
                    System.Drawing.FontStyle.Regular,
                    System.Drawing.GraphicsUnit.Pixel);
                var sf = new System.Drawing.StringFormat
                {
                    Alignment = System.Drawing.StringAlignment.Center,
                    LineAlignment = System.Drawing.StringAlignment.Center
                };
                using var whiteBrush = new System.Drawing.SolidBrush(System.Drawing.Color.White);
                g.DrawString("\uE717", fontMdl2, whiteBrush,
                    new System.Drawing.RectangleF(0, 0, 64, 64), sf);
            }

            // Convert GDI+ Bitmap → WPF BitmapSource → ImageSource for the window icon
            var hbmp = bmp.GetHbitmap();
            try
            {
                var wpfBitmap = System.Windows.Interop.Imaging.CreateBitmapSourceFromHBitmap(
                    hbmp, IntPtr.Zero, Int32Rect.Empty,
                    BitmapSizeOptions.FromEmptyOptions());
                Icon = wpfBitmap;
            }
            finally
            {
                DeleteObject(hbmp);
            }
        }
        catch { /* non-fatal — falls back to default WPF icon */ }
    }

    [System.Runtime.InteropServices.DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr hObject);

    // ── Dialpad backspace ─────────────────────────────────────────────────
    private void BackspaceButton_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is MainViewModel vm && vm.DialNumber.Length > 0)
            vm.DialNumber = vm.DialNumber[..^1];
    }

    // ── New Message button ────────────────────────────────────────────────
    private void NewMessageButton_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is MainViewModel vm)
        {
            vm.SelectedConversation = null;
            vm.ComposeToNumber      = "";
            vm.ComposeRecipientInput = "";
            vm.ComposeBody          = "";
            vm.ShowComposePanel     = true;
        }
        TabMessages.IsChecked = true;
        Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Loaded, new Action(() =>
            FocusTextBox(ComposeRecipientTextBox)));
    }

    private void ComposeContactSuggestion_Click(object sender, RoutedEventArgs e)
    {
        Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Loaded, new Action(() =>
            FocusTextBox(ComposeNewBodyBox)));
    }

    private void CloseComposeButton_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is MainViewModel vm)
            vm.ShowComposePanel = false;
    }

    // ── "Call" button in conversation header ──────────────────────────────
    private void CallContactButton_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is MainViewModel vm && vm.SelectedConversation is not null)
        {
            vm.DialNumber      = vm.SelectedConversation.PhoneNumber;
            TabCalls.IsChecked = true;
        }
    }

    // ── Reply box: pre-fill To: when user focuses the reply area ─────────
    private void ReplyBox_GotFocus(object sender, RoutedEventArgs e)
    {
        if (DataContext is MainViewModel vm
            && vm.SelectedConversation is not null
            && string.IsNullOrEmpty(vm.ComposeToNumber))
        {
            vm.ComposeToNumber = vm.SelectedConversation.PhoneNumber;
        }
    }

    // ── Enter = Send, Shift+Enter = new line ──────────────────────────────
    // Applies to both the inline reply box and the new-message compose box.
    private void ComposeBox_KeyDown(object sender, System.Windows.Input.KeyEventArgs e)
    {
        if (e.Key == Key.Return && (Keyboard.Modifiers & ModifierKeys.Shift) == 0)
        {
            // Plain Enter → send
            if (DataContext is MainViewModel vm &&
                vm.SendMessageCommand.CanExecute(null))
            {
                vm.SendMessageCommand.Execute(null);
                e.Handled = true;   // prevent the newline from being inserted
            }
        }
        // Shift+Enter: do nothing — TextBox AcceptsReturn handles the newline naturally
    }

    // ── "Choose device" from reconnect prompt — switches to Settings tab ─
    private void ChooseDeviceButton_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is MainViewModel vm)
            vm.DismissReconnectCommand.Execute(null);
        TabSettings.IsChecked = true;
    }

    // ── Audio settings ────────────────────────────────────────────────────
    private void RefreshAudioButton_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is MainViewModel vm) vm.RefreshAudio();
    }

    // ── Bubble context menu ───────────────────────────────────────────────
    // Context menus are in a separate visual tree — easiest to grab the data
    // via PlacementTarget and dispatch to the ViewModel commands.
    private DeskPhone.Models.SmsMessage? GetContextMessage(object sender)
    {
        if (sender is MenuItem mi
            && mi.Parent is ContextMenu cm
            && cm.PlacementTarget is FrameworkElement fe
            && fe.DataContext is DeskPhone.Models.SmsMessage msg)
            return msg;
        return null;
    }

    private void BubbleCopy_Click(object sender, RoutedEventArgs e)
    {
        var msg = GetContextMessage(sender);
        if (msg != null && DataContext is MainViewModel vm)
            vm.CopyBubble(msg);
    }

    private void BubbleDelete_Click(object sender, RoutedEventArgs e)
    {
        var msg = GetContextMessage(sender);
        if (msg != null && DataContext is MainViewModel vm)
            vm.DeleteMessageCommand.Execute(msg);
    }

    private void BubbleCall_Click(object sender, RoutedEventArgs e)
    {
        var msg = GetContextMessage(sender);
        if (msg != null)
            StartCallToPhone(msg.NormalizedPhone);
    }

    private void BubblePin_Click(object sender, RoutedEventArgs e)
    {
        var msg = GetContextMessage(sender);
        if (msg != null && DataContext is MainViewModel vm)
            vm.ToggleMessagePinned(msg);
    }

    // ── Bubble quick actions ──────────────────────────────────────────────
    // A normal click on a bubble opens its in-place action tray so copy,
    // forward, and message pinning stay attached to the selected message.
    private void BubbleTap_Click(object sender, System.Windows.Input.MouseButtonEventArgs e)
    {
        if (e.OriginalSource is DependencyObject source &&
            (FindAncestor<System.Windows.Controls.Primitives.ButtonBase>(source) != null
             || FindAncestor<System.Windows.Documents.Hyperlink>(source) != null
             || FindAncestor<System.Windows.Controls.RichTextBox>(source) != null))
        {
            return;
        }

        if (sender is FrameworkElement fe
            && fe.DataContext is DeskPhone.Models.SmsMessage msg
            && DataContext is MainViewModel vm)
        {
            vm.ToggleBubbleActions(msg);
            e.Handled = true;
        }
    }

    private void BubbleActionCopyButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { DataContext: DeskPhone.Models.SmsMessage msg }
            && DataContext is MainViewModel vm)
        {
            vm.CopyBubble(msg);
            e.Handled = true;
        }
    }

    // ── Context-menu forward → open compose pre-filled ────────────────────
    private void BubbleForward_Click(object sender, RoutedEventArgs e)
    {
        var msg = GetContextMessage(sender);
        if (msg != null && DataContext is MainViewModel vm)
        {
            vm.ForwardBubble(msg);
            TabMessages.IsChecked = true;
            Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Loaded, new Action(() =>
                FocusTextBox(ComposeRecipientTextBox)));
        }
    }

    private void BubbleActionForwardButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { DataContext: DeskPhone.Models.SmsMessage msg }
            && DataContext is MainViewModel vm)
        {
            vm.ForwardBubble(msg);
            TabMessages.IsChecked = true;
            Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Loaded, new Action(() =>
                FocusTextBox(ComposeRecipientTextBox)));
            e.Handled = true;
        }
    }

    private void BubbleActionCallButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { DataContext: DeskPhone.Models.SmsMessage msg })
        {
            StartCallToPhone(msg.NormalizedPhone);
            e.Handled = true;
        }
    }

    private void BubbleActionDeleteButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { DataContext: DeskPhone.Models.SmsMessage msg }
            && DataContext is MainViewModel vm)
        {
            vm.DeleteMessageCommand.Execute(msg);
            e.Handled = true;
        }
    }

    private void BubbleActionPinButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { DataContext: DeskPhone.Models.SmsMessage msg }
            && DataContext is MainViewModel vm)
        {
            vm.ToggleMessagePinned(msg);
            e.Handled = true;
        }
    }

    private void CallContactsList_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (DataContext is not MainViewModel vm || vm.SelectedCallContact is null)
            return;

        vm.DialCommand.Execute(null);
        e.Handled = true;
    }

    private void CallHistoryList_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (e.OriginalSource is DependencyObject source &&
            FindAncestor<System.Windows.Controls.Primitives.ButtonBase>(source) != null)
        {
            return;
        }

        if (sender is not System.Windows.Controls.ListBox { SelectedItem: DeskPhone.Models.CallRecord record })
            return;

        if (StartCallToPhone(record.Number))
            e.Handled = true;
    }

    private void PinnedMessageEntry_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not FrameworkElement { DataContext: DeskPhone.Models.SmsMessage msg })
            return;

        if (DataContext is not MainViewModel vm || vm.SelectedConversation?.Messages.Contains(msg) != true)
            return;

        ScrollMessageIntoView(msg);

        e.Handled = true;
    }

    private void ScrollMessageIntoView(DeskPhone.Models.SmsMessage msg)
    {
        Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Loaded, new Action(() =>
        {
            MessageList.ScrollIntoView(msg);
            MessageList.UpdateLayout();
            (MessageList.ItemContainerGenerator.ContainerFromItem(msg) as FrameworkElement)?.BringIntoView();
            if (DataContext is MainViewModel vm)
                vm.RevealBubbleActions(msg);
        }));
    }

    // ── Scroll-to-bottom FAB ─────────────────────────────────────────────
    private void MessageAttachmentImage_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ClickCount < 2)
            return;

        if ((sender as FrameworkElement)?.DataContext is not DeskPhone.Models.MessageAttachment attachment)
            return;

        OpenFullScreenImageViewer(attachment);
        e.Handled = true;
    }

    private void OpenFullScreenImageViewer(DeskPhone.Models.MessageAttachment attachment)
    {
        var source = attachment.Image;
        if (source == null)
            return;

        var rotation = 0d;
        var rotateTransform = new RotateTransform(rotation);
        var viewerImage = new System.Windows.Controls.Image
        {
            Source = source,
            Stretch = Stretch.Uniform,
            RenderTransform = rotateTransform,
            RenderTransformOrigin = new System.Windows.Point(0.5, 0.5)
        };

        var viewer = new Window
        {
            Title = attachment.DisplayName,
            Owner = this,
            WindowStyle = WindowStyle.None,
            ResizeMode = ResizeMode.NoResize,
            WindowState = WindowState.Maximized,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            ShowInTaskbar = false,
            Background = System.Windows.Media.Brushes.Black,
            Foreground = System.Windows.Media.Brushes.White
        };

        var root = new Grid
        {
            Background = System.Windows.Media.Brushes.Black
        };

        var closeButton = CreateImageViewerButton("X", "Close", 46);
        closeButton.Margin = new Thickness(0, 18, 20, 0);
        closeButton.HorizontalAlignment = System.Windows.HorizontalAlignment.Right;
        closeButton.VerticalAlignment = System.Windows.VerticalAlignment.Top;
        closeButton.Click += (_, _) => viewer.Close();
        System.Windows.Controls.Panel.SetZIndex(closeButton, 2);

        var stage = new Grid
        {
            ClipToBounds = true
        };
        stage.Children.Add(viewerImage);

        var tools = new StackPanel
        {
            Orientation = System.Windows.Controls.Orientation.Horizontal,
            HorizontalAlignment = System.Windows.HorizontalAlignment.Center,
            VerticalAlignment = System.Windows.VerticalAlignment.Bottom,
            Margin = new Thickness(0, 0, 0, 20)
        };
        System.Windows.Controls.Panel.SetZIndex(tools, 2);

        void Rotate(double delta)
        {
            rotation = (rotation + delta + 360) % 360;
            rotateTransform.Angle = rotation;
        }

        var rotateLeftButton = CreateImageViewerButton("Rotate left", "Rotate left", 118);
        rotateLeftButton.Click += (_, _) => Rotate(-90);
        var rotateRightButton = CreateImageViewerButton("Rotate right", "Rotate right", 126);
        rotateRightButton.Click += (_, _) => Rotate(90);
        tools.Children.Add(rotateLeftButton);
        tools.Children.Add(rotateRightButton);

        root.Children.Add(stage);
        root.Children.Add(closeButton);
        root.Children.Add(tools);

        viewer.KeyDown += (_, args) =>
        {
            if (args.Key == Key.Escape)
            {
                viewer.Close();
                args.Handled = true;
            }
            else if (args.Key == Key.Left)
            {
                Rotate(-90);
                args.Handled = true;
            }
            else if (args.Key == Key.Right)
            {
                Rotate(90);
                args.Handled = true;
            }
        };

        viewer.Content = root;
        viewer.Show();
        viewer.Activate();
        viewer.Focus();
    }

    private static System.Windows.Controls.Button CreateImageViewerButton(string content, string tooltip, double width) => new()
    {
        Content = content,
        Width = width,
        Height = 46,
        Margin = new Thickness(6, 0, 6, 0),
        Padding = new Thickness(14, 0, 14, 0),
        BorderThickness = new Thickness(0),
        Background = new SolidColorBrush(System.Windows.Media.Color.FromArgb(40, 255, 255, 255)),
        Foreground = System.Windows.Media.Brushes.White,
        FontWeight = System.Windows.FontWeights.SemiBold,
        Cursor = System.Windows.Input.Cursors.Hand,
        ToolTip = tooltip
    };

    private void MessageScrollViewer_ScrollChanged(object sender, ScrollChangedEventArgs e)
    {
        var scrollViewer = EnsureMessageScrollViewer();
        if (scrollViewer == null || scrollViewer.ScrollableHeight <= 0)
        {
            ScrollToBottomBtn.Visibility = Visibility.Collapsed;
            return;
        }
        var distanceFromBottom = scrollViewer.ScrollableHeight - scrollViewer.VerticalOffset;
        ScrollToBottomBtn.Visibility = distanceFromBottom > 200 ? Visibility.Visible : Visibility.Collapsed;
    }

    private void ScrollToBottomBtn_Click(object sender, RoutedEventArgs e)
    {
        QueueScrollToNewestMessage();
    }

    // ── Auto-scroll to bottom when conversation changes ───────────────────
    // Called from ViewModel via event (or from code-behind after conversation select)
    internal void ScrollToBottom() => QueueScrollToNewestMessage();

    private void QueueScrollToNewestMessage()
    {
        QueueScrollToNewestMessagePass(System.Windows.Threading.DispatcherPriority.Loaded);
        QueueScrollToNewestMessagePass(System.Windows.Threading.DispatcherPriority.ContextIdle);
        _ = Dispatcher.InvokeAsync(async () =>
        {
            await Task.Delay(120);
            ScrollToNewestMessageNow();
            await Task.Delay(260);
            ScrollToNewestMessageNow();
        });
    }

    private void QueueScrollToNewestMessagePass(System.Windows.Threading.DispatcherPriority priority)
    {
        Dispatcher.BeginInvoke(priority, new Action(ScrollToNewestMessageNow));
    }

    private void ScrollToNewestMessageNow()
    {
        MessageList.UpdateLayout();
        if (MessageList.Items.Count > 0)
        {
            var newest = MessageList.Items[^1];
            MessageList.ScrollIntoView(newest);
            MessageList.UpdateLayout();
            (MessageList.ItemContainerGenerator.ContainerFromItem(newest) as FrameworkElement)?.BringIntoView();
        }

        EnsureMessageScrollViewer()?.ScrollToBottom();
    }

    private ScrollViewer? EnsureMessageScrollViewer()
    {
        if (_messageScrollViewer != null)
            return _messageScrollViewer;

        _messageScrollViewer = FindDescendant<ScrollViewer>(MessageList);
        if (_messageScrollViewer != null)
            _messageScrollViewer.ScrollChanged += MessageScrollViewer_ScrollChanged;
        return _messageScrollViewer;
    }

    private static T? FindDescendant<T>(DependencyObject? root) where T : DependencyObject
    {
        if (root == null) return null;

        for (int i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++)
        {
            var child = VisualTreeHelper.GetChild(root, i);
            if (child is T match)
                return match;

            var nested = FindDescendant<T>(child);
            if (nested != null)
                return nested;
        }

        return null;
    }

    private static T? FindAncestor<T>(DependencyObject? start) where T : DependencyObject
    {
        var current = start;
        while (current != null)
        {
            if (current is T match)
                return match;

            current = GetAncestorParent(current);
        }

        return null;
    }

    private static DependencyObject? GetAncestorParent(DependencyObject current)
    {
        if (current is Visual || current is System.Windows.Media.Media3D.Visual3D)
            return VisualTreeHelper.GetParent(current);

        if (current is FrameworkContentElement frameworkContent)
            return frameworkContent.Parent
                ?? ContentOperations.GetParent(frameworkContent)
                ?? frameworkContent.TemplatedParent;

        if (current is ContentElement contentElement)
            return ContentOperations.GetParent(contentElement);

        return LogicalTreeHelper.GetParent(current);
    }

    // ── Window close ──────────────────────────────────────────────────────
    // Use synchronous Shutdown() so BT disconnects before the process exits.
    // DisposeAsync() also calls Shutdown() but async void can race with process exit.
    protected override void OnClosed(EventArgs e)
    {
        var logWindow = _logWindow;
        _logWindow = null;
        if (logWindow != null)
        {
            try { logWindow.Close(); }
            catch { }
        }

        base.OnClosed(e);
        if (DataContext is MainViewModel vm)
            vm.Shutdown();
    }
}
