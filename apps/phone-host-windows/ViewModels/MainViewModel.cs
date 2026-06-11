using DeskPhone.Models;
using DeskPhone.Services;
using InTheHand.Net;
using Microsoft.Toolkit.Uwp.Notifications;
using System.IO;
using System.Collections.Concurrent;
using System.Collections.ObjectModel;
using System.Windows.Threading;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using MediaBrush = System.Windows.Media.Brush;
using MediaColor = System.Windows.Media.Color;
using MediaSolidColorBrush = System.Windows.Media.SolidColorBrush;

namespace DeskPhone.ViewModels;

/// <summary>
/// Single ViewModel for the whole app.
/// Owns all services, exposes observable properties for the UI,
/// and handles every user command.
/// </summary>
public enum AppTab { Messages, Calls, Contacts, Settings, Log, DeveloperTools }
public enum SettingsSection { Connection, Appearance, Sync, Audio }
public enum ConversationSortMode { Chronological, UnreadFirst }
public enum ConversationFilter { All, Unread, Pinned, Muted, Blocked }
public enum CallHistoryFilter { All, Missed, Incoming, Outgoing }

public class MainViewModel : INotifyPropertyChanged, IAsyncDisposable
{
    public event Action<SmsMessage>? RequestScrollToMessage;

    // ── Services ─────────────────────────────────────────────────────────
    private readonly BluetoothScanner      _bt       = new();
    private          HfpService?           _hfp;
    private          MapService?           _map;
    private readonly AudioService          _audio    = new();
    private readonly NotificationService   _notif    = new();
    private readonly AppSettingsService    _settings = new();
    private readonly MapNotificationService _mns      = new();
    private readonly MessageStoreService   _store    = new();
    private readonly BackupService         _backup   = new();
    private readonly ControlApiService     _api      = new();
    private readonly RelayService          _relay    = new();
    private readonly ContactStoreService   _contactStore = new();
    private readonly ContactSyncService    _contactSync  = new();
    private readonly PbapService _pbap      = new();
    private readonly PbapCallLogStoreService _pbapCallLogStore = new();
    private readonly CallLogSyncService _callLogSync = new();
    private readonly CallAudioRouteService _audioRoute = new();

    private CancellationTokenSource _sessionCts = new();
    // App-lifetime CTS — cancelled only in Shutdown(), never by ResetConnectionSessionAsync.
    // Owned by the persistent connection watchdog so the watchdog survives failed reconnects.
    private readonly CancellationTokenSource _appCts = new();
    private readonly SemaphoreSlim _messageSyncLock = new(1, 1);
    private readonly SemaphoreSlim _messageDeleteReconcileLock = new(1, 1);
    private readonly SemaphoreSlim _messagePollWakeSignal = new(0, 1);
    private readonly ConcurrentQueue<string> _priorityMessageHandles = new();
    private static readonly TimeSpan MessagePollInterval = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan BusyMessagePollRetryInterval = TimeSpan.FromSeconds(5);
    // 30 s: short enough that the phone reconnects within one watchdog cycle after it
    // comes back into range.  The in-flight guards (_autoReconnectInFlight, IsConnecting)
    // prevent concurrent reconnects, so this no longer needs to cover the MAP retry
    // cycle (that was the old reason for 90 s).
    private static readonly TimeSpan AutoReconnectRetryWindow = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan PhoneReadStatePollInterval = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan MessageDeleteReconcileInterval = TimeSpan.FromMinutes(1);
    private const int AutomaticDeleteReconcilePhoneWindowPerFolder = 150;
    private const int AutomaticDeleteReconcilePruneWindowPerFolder = 100;
    private DateTime _nextMessageDeleteReconcileUtc = DateTime.MinValue;
    private DateTime _nextPhoneReadStateRefreshUtc = DateTime.MinValue;
    private int _messagePollWakeRequests = 0;
    private int _pendingPriorityMessageSync = 0;
    private int _autoReconnectInFlight = 0;
    private DateTime _nextAutoReconnectUtc = DateTime.MinValue;
    private string _lastAudioRouteLogLine = "";

    // Background poll loop — runs entirely off the UI thread.
    // Only marshals back to Dispatcher when there are actual new messages to show.
    private Task? _pollLoop;
    private Task? _fullHistoryLoop;
    private int _queuedFullHistoryRestart;
    private Task? _contactPollLoop;
    private string? _connectedDeviceAddress;

    // Prevents concurrent ConnectAsync calls (API + UI can both trigger connect).
    private readonly SemaphoreSlim _connectLock = new(1, 1);

    // MMS handles purged from store on load (failed parse last session) — re-fetched after connect.
    private List<string> _pendingMmsHandles = new();

    // Incremented whenever a real OBEX op starts, decremented when it finishes.
    // The full-history loader checks this to know when to pause.
    private int _realOpCount = 0;
    private bool IsRealOpActive => _realOpCount > 0;


    // ── Backing flat message store ────────────────────────────────────────
    // All messages (received + sent) stored flat; conversations are derived on-the-fly.
    // Accessed from both UI thread and background poll — always replace the reference
    // atomically inside _msgLock; never mutate the list in place.
    private List<SmsMessage> _allMessages = new();
    private readonly object _msgLock = new();
    private SmsMessage? _lastDeletedMessage;
    private List<ContactEntry> _contacts = new();
    private readonly object _contactLock = new();
    private Dictionary<string, string> _contactNamesByPhone = new(StringComparer.OrdinalIgnoreCase);
    private Dictionary<string, ContactEntry> _contactsByPhone = new(StringComparer.OrdinalIgnoreCase);

    // ── Conversation sort mode ────────────────────────────────────────────
    private ConversationSortMode _convSortMode = ConversationSortMode.Chronological;
    public ConversationSortMode ConvSortMode
    {
        get => _convSortMode;
        set
        {
            if (_convSortMode == value) return;
            _convSortMode = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(IsUnreadFirstSortMode));
            _settings.Current.ConversationSortMode = value.ToString();
            _settings.Save();
            SortConversations();
        }
    }
    public bool IsUnreadFirstSortMode => _convSortMode == ConversationSortMode.UnreadFirst;

    private ConversationFilter _conversationFilter = ConversationFilter.All;
    public ConversationFilter ActiveConversationFilter
    {
        get => _conversationFilter;
        set
        {
            if (_conversationFilter == value) return;
            _conversationFilter = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(IsConversationFilterAll));
            OnPropertyChanged(nameof(IsConversationFilterUnread));
            OnPropertyChanged(nameof(IsConversationFilterPinned));
            OnPropertyChanged(nameof(IsConversationFilterMuted));
            OnPropertyChanged(nameof(IsConversationFilterBlocked));
            ApplySearch();
        }
    }

    public bool IsConversationFilterAll => ActiveConversationFilter == ConversationFilter.All;
    public bool IsConversationFilterUnread => ActiveConversationFilter == ConversationFilter.Unread;
    public bool IsConversationFilterPinned => ActiveConversationFilter == ConversationFilter.Pinned;
    public bool IsConversationFilterMuted => ActiveConversationFilter == ConversationFilter.Muted;
    public bool IsConversationFilterBlocked => ActiveConversationFilter == ConversationFilter.Blocked;

    private CallHistoryFilter _callHistoryFilter = CallHistoryFilter.All;
    public CallHistoryFilter ActiveCallHistoryFilter
    {
        get => _callHistoryFilter;
        set
        {
            if (_callHistoryFilter == value) return;
            _callHistoryFilter = value;
            if (value == CallHistoryFilter.Missed)
                ClearMissedCallAlert();
            OnPropertyChanged();
            OnPropertyChanged(nameof(IsCallHistoryFilterAll));
            OnPropertyChanged(nameof(IsCallHistoryFilterMissed));
            OnPropertyChanged(nameof(IsCallHistoryFilterIncoming));
            OnPropertyChanged(nameof(IsCallHistoryFilterOutgoing));
            NotifyCallHistoryViewsChanged();
        }
    }

    public bool IsCallHistoryFilterAll => ActiveCallHistoryFilter == CallHistoryFilter.All;
    public bool IsCallHistoryFilterMissed => ActiveCallHistoryFilter == CallHistoryFilter.Missed;
    public bool IsCallHistoryFilterIncoming => ActiveCallHistoryFilter == CallHistoryFilter.Incoming;
    public bool IsCallHistoryFilterOutgoing => ActiveCallHistoryFilter == CallHistoryFilter.Outgoing;

    private int _newMissedCallCount;
    public int NewMissedCallCount
    {
        get => _newMissedCallCount;
        set
        {
            if (_newMissedCallCount == value) return;
            _newMissedCallCount = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(HasMissedCallAlert));
            OnPropertyChanged(nameof(MissedCallAlertText));
        }
    }

    public bool HasMissedCallAlert => NewMissedCallCount > 0;
    public string MissedCallAlertText => NewMissedCallCount == 1 ? "1 new missed call" : $"{NewMissedCallCount} new missed calls";
    private string _lastMissedCallAlertKey = "";
    private DateTime _lastMissedCallAlertUtc = DateTime.MinValue;

    private int _visibleConversationCount;
    public int VisibleConversationCount
    {
        get => _visibleConversationCount;
        private set
        {
            if (_visibleConversationCount == value) return;
            _visibleConversationCount = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(HasVisibleConversations));
            OnPropertyChanged(nameof(ConversationEmptyStateText));
        }
    }

    public bool HasVisibleConversations => VisibleConversationCount > 0;
    public string ConversationEmptyStateText => Conversations.Count == 0
        ? "No messages yet"
        : ActiveConversationFilter == ConversationFilter.Blocked
            ? "No blocked conversations"
            : "No matching conversations";

    // ── Observable collections ────────────────────────────────────────────
    public ObservableCollection<Conversation>                  Conversations   { get; } = new();
    public ObservableCollection<CallRecord>                    CallHistory     { get; } = new();
    private List<CallRecord>? _lastDeletedCallRecords;
    private bool _lastDeletedCallDeleteAll;
    public ObservableCollection<AudioService.AudioDevice>      PlaybackDevices { get; } = new();
    public ObservableCollection<AudioService.AudioDevice>      RecordingDevices { get; } = new();
    public ObservableCollection<AppSettingsService.KnownDevice> KnownDevices  { get; } = new();
    public ObservableCollection<BluetoothDeviceModel>          Devices         { get; } = new();
    public ObservableCollection<ChangelogEntry>                Changelog       { get; } = new();
    public ObservableCollection<ContactOption>                 ComposeContacts { get; } = new();
    public ObservableCollection<ContactOption>                 CallContacts    { get; } = new();
    public ObservableCollection<ContactEntry>                  EditableContacts { get; } = new();
    public ObservableCollection<MessageAttachment>             ComposeAttachments { get; } = new();

    public IEnumerable<CallRecord> FilteredCallHistory =>
        CallHistory
            .Where(MatchesCallHistoryFilter)
            .OrderByDescending(r => r.Time)
            .ToList();

    public bool HasFilteredCallHistory => FilteredCallHistory.Any();

    // ── Window title ──────────────────────────────────────────────────────
    // Read the build stamp directly from the EXE filename so the title bar
    // always matches exactly what file is on disk — no guessing which build is running.
    // EXE name format: DeskPhone_v1.1.0_2026-04-19_1423.exe → title: DeskPhone 2026-04-19 14:23
    private static readonly BuildIdentity CurrentBuild = LoadBuildIdentity();
    private static readonly string BuildStamp = CurrentBuild.Stamp;
    public string WindowTitle => "DeskPhone";
    public string BuildBadge => BuildStamp;
    public string BuildNumberLabel => $"Build Number: {CurrentBuild.Number}";
    public string BuildTimeLabel => $"Build Time: {CurrentBuild.DisplayTime}";
    public string BuildFolderToolTip => "Open builds folder";

    private sealed record BuildIdentity(string Number, string DisplayTime)
    {
        public string Stamp => $"{Number}  {DisplayTime}";
    }

    private static BuildIdentity LoadBuildIdentity()
    {
        var fromInfo = LoadBuildIdentityFromInfoFile();
        if (fromInfo is not null) return fromInfo;

        var fromChangelog = LoadBuildIdentityFromChangelog();
        if (fromChangelog is not null) return fromChangelog;

        return new BuildIdentity("unknown", "unknown");
    }

    private static BuildIdentity? LoadBuildIdentityFromInfoFile()
    {
        try
        {
            var path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "build-info.json");
            if (!File.Exists(path)) return null;

            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            var root = doc.RootElement;
            var version = root.TryGetProperty("version", out var versionElement)
                ? versionElement.GetString()
                : "";
            var timestamp = root.TryGetProperty("timestamp", out var timestampElement)
                ? timestampElement.GetString()
                : "";

            return string.IsNullOrWhiteSpace(version)
                ? null
                : new BuildIdentity(version!, FormatBuildTimestamp(timestamp));
        }
        catch
        {
            return null;
        }
    }

    private static BuildIdentity? LoadBuildIdentityFromChangelog()
    {
        try
        {
            var path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "changelog.json");
            if (!File.Exists(path)) return null;

            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            if (doc.RootElement.ValueKind != JsonValueKind.Array || doc.RootElement.GetArrayLength() == 0)
            {
                return null;
            }

            var latest = doc.RootElement[0];
            var version = latest.TryGetProperty("version", out var versionElement)
                ? versionElement.GetString()
                : "";
            var timestamp = latest.TryGetProperty("timestamp", out var timestampElement)
                ? timestampElement.GetString()
                : "";

            return string.IsNullOrWhiteSpace(version)
                ? null
                : new BuildIdentity(version!, FormatBuildTimestamp(timestamp));
        }
        catch
        {
            return null;
        }
    }

    private static string FormatBuildTimestamp(string? raw)
    {
        if (DateTime.TryParse(raw, out var parsed))
        {
            return parsed.ToString("MM/dd/yy h:mm tt").ToLowerInvariant();
        }

        return string.IsNullOrWhiteSpace(raw) ? "unknown" : raw;
    }

    // ── Connection status ─────────────────────────────────────────────────
    private string _connectionStatus = "Not connected";
    public string ConnectionStatus
    {
        get => _connectionStatus;
        set { _connectionStatus = value; OnPropertyChanged(); }
    }

    private AppTab _selectedTab = AppTab.Messages;
    public AppTab SelectedTab
    {
        get => _selectedTab;
        set { _selectedTab = value; OnPropertyChanged(); }
    }

    private bool _isFullyConnected;
    public bool IsFullyConnected
    {
        get => _isFullyConnected;
        set { _isFullyConnected = value; OnPropertyChanged(); }
    }

    private string _statusHfp = "Not connected";
    public string StatusHfp
    {
        get => _statusHfp;
        set
        {
            _statusHfp = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(CallsConnectionLabel));
            UpdateConnectionStatus();
            // HFP fired a disconnect or error at runtime — trigger a reconnect immediately
            // rather than waiting for the MAP poll loop to notice (which may never happen
            // if MAP's RFCOMM is in a ghost-connected state and IsConnected stays true).
            // QueueAutoReconnect's own guards (IsConnecting, _nextAutoReconnectUtc,
            // _autoReconnectInFlight) make this call safe to fire freely.
            if (!ConnectionTextLooksConnected(value))
                QueueAutoReconnect("HFP status: " + value);
        }
    }

    // ── Call audio routing ────────────────────────────────────────────────────
    // The Microsoft Bluetooth stack on Windows ARM64 has no inbox driver for the
    // PC-as-HFU-connecting-to-phone-AG role.  Without that, no Bluetooth HFP audio
    // endpoint is created for FIG-F52 and SCO audio cannot reach WASAPI.  See
    // scratch/option3_research/README.md for the full story.
    //
    // What DeskPhone *can* do is observe the user's chosen Windows communications
    // playback device.  If the user has plugged in a USB-and-Bluetooth speakerphone
    // (e.g. Jabra Speak 510, Poly Sync 20+) and paired it to the phone, that
    // device's own firmware implements the HFU role we lack — the speakerphone
    // appears to Windows as a normal USB sound card and call audio Just Works.
    // We surface a status banner so users know whether they're in the
    // phone-speaker fallback mode or routed through real speakerphone hardware.
    private string _callAudioRouteSummary = "Audio plays on the phone";
    public string CallAudioRouteSummary
    {
        get => _callAudioRouteSummary;
        private set { _callAudioRouteSummary = value; OnPropertyChanged(); }
    }

    private bool _isCallAudioRouteExternal;
    public bool IsCallAudioRouteExternal
    {
        get => _isCallAudioRouteExternal;
        private set { _isCallAudioRouteExternal = value; OnPropertyChanged(); }
    }

    private string _callAudioRouteDeviceName = "";
    public string CallAudioRouteDeviceName
    {
        get => _callAudioRouteDeviceName;
        private set { _callAudioRouteDeviceName = value; OnPropertyChanged(); }
    }

    private string _statusMap = "Not connected";
    public string StatusMap
    {
        get => _statusMap;
        set
        {
            _statusMap = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(MessagesConnectionLabel));
            UpdateConnectionStatus();
        }
    }

    private void UpdateConnectionStatus()
    {
        bool callsOk = ConnectionTextLooksConnected(StatusHfp);
        bool msgsOk  = ConnectionTextLooksConnected(StatusMap);
        IsFullyConnected = callsOk && msgsOk;
        ConnectionStatus = (callsOk, msgsOk) switch
        {
            (true, true)   => "Connected",
            (true, false)  => "Calls only (messages reconnecting...)",
            (false, true)  => "Messages only (calls reconnecting...)",
            _              => "Not connected"
        };
        OnPropertyChanged(nameof(ConnectionRailSubtitle));
        OnPropertyChanged(nameof(QuickConnectDeviceSummary));
        OnPropertyChanged(nameof(CanQuickReconnect));
    }

    // ── Reconnect prompt ──────────────────────────────────────────────────
    private bool _showReconnectPrompt;
    public bool ShowReconnectPrompt
    {
        get => _showReconnectPrompt;
        set { _showReconnectPrompt = value; OnPropertyChanged(); }
    }

    private string _reconnectDeviceName = "";
    public string ReconnectDeviceName
    {
        get => _reconnectDeviceName;
        set
        {
            _reconnectDeviceName = value ?? "";
            OnPropertyChanged();
            OnPropertyChanged(nameof(ReconnectPromptText));
        }
    }

    public string ReconnectPromptText => $"Reconnect to {ReconnectDeviceName}?";

    private bool _showBuildUpdatePrompt;
    public bool ShowBuildUpdatePrompt
    {
        get => _showBuildUpdatePrompt;
        set { _showBuildUpdatePrompt = value; OnPropertyChanged(); }
    }

    private bool _showBuildUpdateIndicator;
    public bool ShowBuildUpdateIndicator
    {
        get => _showBuildUpdateIndicator;
        set { _showBuildUpdateIndicator = value; OnPropertyChanged(); }
    }

    private string _pendingBuildVersion = "";
    public string PendingBuildVersion
    {
        get => _pendingBuildVersion;
        set
        {
            _pendingBuildVersion = value ?? "";
            OnPropertyChanged();
            OnPropertyChanged(nameof(BuildUpdateTitle));
        }
    }

    private string _pendingBuildPath = "";
    public string PendingBuildPath
    {
        get => _pendingBuildPath;
        set { _pendingBuildPath = value ?? ""; OnPropertyChanged(); }
    }

    public string BuildUpdateTitle => string.IsNullOrWhiteSpace(PendingBuildVersion)
        ? "New Build Available"
        : $"New Build Available: {PendingBuildVersion}";

    public string BuildUpdateBody => "Do you want to use it instead? Connected device will disconnect and reconnect in the new build.";

    // ── Device scanning ───────────────────────────────────────────────────
    private BluetoothDeviceModel? _selectedDevice;
    public BluetoothDeviceModel? SelectedDevice
    {
        get => _selectedDevice;
        set { _selectedDevice = value; OnPropertyChanged(); OnPropertyChanged(nameof(CanConnect)); }
    }

    private string _statusBt = "Idle";
    public string StatusBt
    {
        get => _statusBt;
        set { _statusBt = value; OnPropertyChanged(); }
    }

    private bool _isScanning;
    public bool IsScanning
    {
        get => _isScanning;
        set { _isScanning = value; OnPropertyChanged(); OnPropertyChanged(nameof(CanConnect)); }
    }

    private bool _isConnecting;
    public bool IsConnecting
    {
        get => _isConnecting;
        set
        {
            _isConnecting = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(CanConnect));
            OnPropertyChanged(nameof(CanQuickReconnect));
            OnPropertyChanged(nameof(QuickConnectDeviceSummary));
            OnPropertyChanged(nameof(ConnectionRailSubtitle));
        }
    }

    public bool CanConnect => SelectedDevice != null && !IsConnecting && !IsScanning;

    // ── Call state ────────────────────────────────────────────────────────
    private CallInfo _currentCall = new();
    public CallInfo CurrentCall
    {
        get => _currentCall;
        set
        {
            _currentCall = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(IsCallActive));
            OnPropertyChanged(nameof(IsRinging));
            OnPropertyChanged(nameof(IsIdle));
            OnPropertyChanged(nameof(CallBannerText));
        }
    }

    public bool IsRinging    => CurrentCall.Status == CallStatus.IncomingRinging;
    public bool IsCallActive => CurrentCall.Status is CallStatus.Active or CallStatus.Dialing;
    public bool IsIdle       => CurrentCall.Status == CallStatus.Idle;

    public string CallBannerText => CurrentCall.Status switch
    {
        CallStatus.IncomingRinging => $"Incoming: {CurrentCall.DisplayNumber}",
        CallStatus.Dialing         => $"Calling {CurrentCall.DisplayNumber}...",
        CallStatus.Active          => $"{CurrentCall.DisplayNumber}  {CurrentCall.ElapsedDisplay}",
        CallStatus.Ending          => "Ending call...",
        _                          => ""
    };

    private bool _isMuted;
    public bool IsMuted
    {
        get => _isMuted;
        set { _isMuted = value; OnPropertyChanged(); }
    }

    private string _dialNumber = "";
    public string DialNumber
    {
        get => _dialNumber;
        set
        {
            if (string.Equals(_dialNumber, value, StringComparison.Ordinal))
                return;

            _dialNumber = value ?? "";
            if (SelectedCallContact != null &&
                !string.Equals(SelectedCallContact.PhoneNumber, ContactStoreService.NormalizePhone(_dialNumber), StringComparison.OrdinalIgnoreCase))
            {
                _selectedCallContact = null;
                OnPropertyChanged(nameof(SelectedCallContact));
            }

            OnPropertyChanged();
            OnPropertyChanged(nameof(CallContactSearch));
            OnPropertyChanged(nameof(DialMatchingContact));
            OnPropertyChanged(nameof(CanSaveDialContact));
            OnPropertyChanged(nameof(CanEditDialContact));
            IsCallSuggestionsOpen = !string.IsNullOrWhiteSpace(_dialNumber);
            RefreshCallContacts();
        }
    }

    private bool _isLoadingMessages;
    public bool IsLoadingMessages
    {
        get => _isLoadingMessages;
        set { _isLoadingMessages = value; OnPropertyChanged(); }
    }

    private bool _showLiveLog = false;
    public bool ShowLiveLog
    {
        get => _showLiveLog;
        set { _showLiveLog = value; OnPropertyChanged(); }
    }

    public bool HasUndoMessageDelete => _lastDeletedMessage != null;
    public string UndoMessageDeleteText => _lastDeletedMessage == null
        ? ""
        : $"Message deleted from {GetMessageSenderDisplay(_lastDeletedMessage)}";

    public bool HasUndoCallHistoryDelete => _lastDeletedCallRecords?.Count > 0;
    public string UndoCallHistoryDeleteText => _lastDeletedCallRecords == null || _lastDeletedCallRecords.Count == 0
        ? ""
        : _lastDeletedCallDeleteAll
            ? $"{_lastDeletedCallRecords.Count} call history entries deleted"
            : $"Call deleted: {FormatCallRecordLabel(_lastDeletedCallRecords[0])}";

    private bool _showMessagesListPane = true;
    public bool ShowMessagesListPane
    {
        get => _showMessagesListPane;
        set
        {
            if (_showMessagesListPane == value) return;
            _showMessagesListPane = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(HasHiddenMessageSurfacePanes));
        }
    }

    private bool _showConversationCallHistoryPane = true;
    public bool ShowConversationCallHistoryPane
    {
        get => _showConversationCallHistoryPane;
        set
        {
            if (!value)
                value = true;

            if (_showConversationCallHistoryPane == value) return;
            _showConversationCallHistoryPane = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(HasHiddenMessageSurfacePanes));
        }
    }

    private bool _showConversationDialerPane;
    public bool ShowConversationDialerPane
    {
        get => _showConversationDialerPane;
        set
        {
            if (_showConversationDialerPane == value) return;
            _showConversationDialerPane = value;
            OnPropertyChanged();
        }
    }

    public bool HasHiddenMessageSurfacePanes => !ShowMessagesListPane;

    private bool _showRecentCallsPane = true;
    public bool ShowRecentCallsPane
    {
        get => _showRecentCallsPane;
        set
        {
            if (_showRecentCallsPane == value) return;
            _showRecentCallsPane = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(HasHiddenCallSurfacePanes));
        }
    }

    private bool _showDialerPane = true;
    public bool ShowDialerPane
    {
        get => _showDialerPane;
        set
        {
            if (_showDialerPane == value) return;
            _showDialerPane = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(HasHiddenCallSurfacePanes));
        }
    }

    public bool HasHiddenCallSurfacePanes => !ShowRecentCallsPane || !ShowDialerPane;

    public bool PauseHistoryActivity
    {
        get => _settings.Current.PauseHistoryActivity;
        set
        {
            var wasPaused = _settings.Current.PauseHistoryActivity;
            if (wasPaused != value)
            {
                _settings.Current.PauseHistoryActivity = value;

                if (wasPaused && !value)
                    ResetActiveDeviceHistoryOffsets("History activated by user");

                _settings.Save();
                _backup.IsPaused = value;
                OnPropertyChanged();
                if (!value && _map != null && _map.IsConnected)
                    StartOrQueueFullHistoryLoader(_sessionCts.Token, "History activated by user");
            }
        }
    }

    // ── Conversation selection ────────────────────────────────────────────
    private Conversation? _selectedConversation;
    public Conversation? SelectedConversation
    {
        get => _selectedConversation;
        set
        {
            CloseBubbleActions();

            // Save draft for the conversation we're leaving
            if (_selectedConversation != null && !string.IsNullOrEmpty(_composeBody))
                _drafts[_selectedConversation.PhoneNumber] = _composeBody;
            else if (_selectedConversation != null)
                _drafts.Remove(_selectedConversation.PhoneNumber);

            _selectedConversation = value;
            OnPropertyChanged();
            // Pre-fill compose To: with the conversation's phone number
            if (value != null)
            {
                ShowComposePanel = false;
                ComposeToNumber = value.PhoneNumber;
                // Restore draft for the new conversation
                ComposeBody = _drafts.TryGetValue(value.PhoneNumber, out var draft) ? draft : "";
                MarkConversationRead(value);
            }

            RefreshConversationSearchResults(jumpToNewest: false);
            NotifySelectedConversationDetailsChanged();
        }
    }

    public IEnumerable<CallRecord> SelectedConversationCallHistory
        => SelectedConversation == null
            ? Enumerable.Empty<CallRecord>()
            : CallHistory
                .Where(r => SamePhone(r.Number, SelectedConversation.PhoneNumber))
                .Where(MatchesCallHistoryFilter)
                .OrderByDescending(r => r.Time)
                .Take(6)
                .ToList();

    public IEnumerable<SmsMessage> SelectedConversationPinnedMessages
        => SelectedConversation == null
            ? Enumerable.Empty<SmsMessage>()
            : SelectedConversation.Messages
                .Where(m => m.IsPinned)
                .OrderByDescending(m => m.Timestamp)
                .ToList();

    public bool HasSelectedConversationCalls => SelectedConversationCallHistory.Any();
    public bool HasSelectedConversationPinnedMessages => SelectedConversationPinnedMessages.Any();
    public string SelectedConversationPinnedSummary
    {
        get
        {
            var count = SelectedConversationPinnedMessages.Count();
            return count == 1 ? "1 pinned message" : $"{count} pinned messages";
        }
    }

    private void ResetActiveDeviceHistoryOffsets(string reason)
    {
        var active = _connectedDeviceAddress ?? _settings.MostRecentDevice?.Address;
        if (string.IsNullOrWhiteSpace(active))
            return;

        var device = _settings.Current.KnownDevices.FirstOrDefault(d =>
            MessageStoreService.SameDevice(d.Address, active));
        if (device == null)
            return;

        if (device.HistoryOffsetInbox == 0 && device.HistoryOffsetSent == 0)
            return;

        AppendDebugThreadSafe($"[FULLHIST] {reason}; resetting saved offsets from Inbox={device.HistoryOffsetInbox}, Sent={device.HistoryOffsetSent}");
        device.HistoryOffsetInbox = 0;
        device.HistoryOffsetSent = 0;
    }

    public string SelectedConversationCallSummary
        => SelectedConversation == null
            ? "Select a conversation to see recent calls."
            : HasSelectedConversationCalls
                ? $"{SelectedConversationCallHistory.Count()} recent calls with {SelectedConversation.DisplayName}"
                : $"No recent calls with {SelectedConversation.DisplayName}";

    public ContactEntry? SelectedConversationMatchingContact => FindContactByPhone(SelectedConversation?.PhoneNumber);
    public bool CanAddSelectedConversationContact => SelectedConversation != null && SelectedConversationMatchingContact == null;
    public bool CanEditSelectedConversationContact => SelectedConversationMatchingContact != null;

    public ContactEntry? ComposeMatchingContact => FindContactByPhone(ComposeContactActionNumber);
    public bool CanSaveComposeContact => !string.IsNullOrWhiteSpace(ComposeContactActionNumber) && ComposeMatchingContact == null;
    public bool CanEditComposeContact => ComposeMatchingContact != null;

    public ContactEntry? DialMatchingContact => FindContactByPhone(DialNumber);
    public bool CanSaveDialContact => !string.IsNullOrWhiteSpace(ContactStoreService.NormalizePhone(DialNumber)) && DialMatchingContact == null;
    public bool CanEditDialContact => DialMatchingContact != null;

    private CallRecord? _selectedCallRecord;
    public CallRecord? SelectedCallRecord
    {
        get => _selectedCallRecord;
        set
        {
            if (ReferenceEquals(_selectedCallRecord, value))
                return;

            _selectedCallRecord = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(HasSelectedCallRecord));
            OnPropertyChanged(nameof(SelectedCallRecordTitle));
            OnPropertyChanged(nameof(SelectedCallRecordPhone));
            OnPropertyChanged(nameof(SelectedCallRecordTime));
            OnPropertyChanged(nameof(SelectedCallRecordDirection));
            OnPropertyChanged(nameof(SelectedCallRecordDuration));
            OnPropertyChanged(nameof(SelectedCallRecordMatchingContact));
            OnPropertyChanged(nameof(CanSaveSelectedCallRecordContact));
            OnPropertyChanged(nameof(CanEditSelectedCallRecordContact));
            OnPropertyChanged(nameof(IsSelectedCallRecordBlocked));
            OnPropertyChanged(nameof(SelectedCallRecordBlockLabel));
            OnPropertyChanged(nameof(SelectedCallRecordBlockTooltip));
        }
    }

    public bool HasSelectedCallRecord => SelectedCallRecord != null;
    public string SelectedCallRecordTitle => SelectedCallRecord?.DisplayNumber ?? "Select a recent call";
    public string SelectedCallRecordPhone => SelectedCallRecord?.FormattedNumber ?? "";
    public string SelectedCallRecordTime => SelectedCallRecord == null
        ? "Click a recent call to view its details and actions."
        : SelectedCallRecord.Time.ToString("ddd, MMM d 'at' h:mm tt");
    public string SelectedCallRecordDirection => SelectedCallRecord?.DirectionLabel ?? "";
    public string SelectedCallRecordDuration => SelectedCallRecord == null
        ? ""
        : string.IsNullOrWhiteSpace(SelectedCallRecord.DurationDisplay)
            ? "No connected duration"
            : $"Duration {SelectedCallRecord.DurationDisplay}";
    public ContactEntry? SelectedCallRecordMatchingContact => FindContactByPhone(SelectedCallRecord?.Number);
    public bool CanSaveSelectedCallRecordContact => !string.IsNullOrWhiteSpace(ContactStoreService.NormalizePhone(SelectedCallRecord?.Number)) && SelectedCallRecordMatchingContact == null;
    public bool CanEditSelectedCallRecordContact => SelectedCallRecordMatchingContact != null;
    public bool IsSelectedCallRecordBlocked => _settings.IsConversationBlocked(SelectedCallRecord?.Number);
    public string SelectedCallRecordBlockLabel => IsSelectedCallRecordBlocked ? "Unblock" : "Block";
    public string SelectedCallRecordBlockTooltip => IsSelectedCallRecordBlocked
        ? "Allow alerts from this number again."
        : "Locally block alerts from this number and file matching conversations under Blocked.";

    private bool _hasVoicemailAlert;
    public bool HasVoicemailAlert
    {
        get => _hasVoicemailAlert;
        set
        {
            if (_hasVoicemailAlert == value) return;
            _hasVoicemailAlert = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(VoicemailAlertText));
        }
    }

    private string _voicemailAlertText = "";
    public string VoicemailAlertText => string.IsNullOrWhiteSpace(_voicemailAlertText)
        ? "New voicemail"
        : _voicemailAlertText;

    private void ApplyVoicemailAlertState(bool hasAlert, string? alertText, bool persistForCurrentDevice)
    {
        HasVoicemailAlert = hasAlert;
        _voicemailAlertText = hasAlert ? (alertText ?? "") : "";
        OnPropertyChanged(nameof(VoicemailAlertText));

        if (!persistForCurrentDevice)
            return;

        _settings.SetVoicemailAlertState(ActiveOrPendingDeviceAddress, hasAlert, _voicemailAlertText);
    }

    private void RestoreVoicemailAlertForCurrentDevice()
    {
        var state = _settings.GetDeviceAlertState(ActiveOrPendingDeviceAddress);
        ApplyVoicemailAlertState(state?.HasVoicemailAlert == true, state?.VoicemailAlertText, persistForCurrentDevice: false);
    }

    public bool CanMarkSelectedConversationRead => SelectedConversation != null && SelectedConversation.IsUnread;
    public bool CanMarkSelectedConversationUnread => SelectedConversation != null && !SelectedConversation.IsUnread;
    public bool IsSelectedConversationPinned => SelectedConversation?.IsPinned == true;
    public bool AreSelectedConversationAlertsMuted => SelectedConversation?.AreAlertsMuted == true;
    public bool IsSelectedConversationBlocked => SelectedConversation?.IsBlocked == true;
    public string SelectedConversationPinLabel => IsSelectedConversationPinned ? "Unpin" : "Pin";
    public string SelectedConversationAlertsLabel => AreSelectedConversationAlertsMuted ? "Unmute alerts" : "Mute alerts";
    public string SelectedConversationBlockLabel => IsSelectedConversationBlocked ? "Unblock" : "Block";
    public string SelectedConversationPinTooltip => IsSelectedConversationPinned
        ? "Remove this conversation from the pinned group."
        : "Keep this conversation at the top of the list.";
    public string SelectedConversationAlertsTooltip => AreSelectedConversationAlertsMuted
        ? "Turn banners and tray alerts back on for this conversation."
        : "Stop banners and tray alerts for this conversation.";
    public string SelectedConversationBlockTooltip => IsSelectedConversationBlocked
        ? "Allow alerts from this conversation again. Phone-side spam blocking is not exposed by Bluetooth MAP here."
        : "Locally block this conversation's alerts and file it under Blocked. Phone-side spam reporting is not exposed by Bluetooth MAP here.";

    private void MarkConversationRead(Conversation conv)
    {
        List<string> handlesToSync;
        bool changed = false;
        lock (_msgLock)
        {
            handlesToSync = _allMessages
                .Where(m => MessageBelongsToActiveDevice(m) && !m.IsSent && m.NormalizedPhone == conv.PhoneNumber && !m.IsRead)
                .Select(m => m.Handle)
                .Where(h => !string.IsNullOrWhiteSpace(h))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList()!;

            foreach (var msg in _allMessages.Where(m => MessageBelongsToActiveDevice(m) && !m.IsSent && m.NormalizedPhone == conv.PhoneNumber))
            {
                if (!msg.IsRead)
                {
                    msg.IsRead = true;
                    changed = true;
                }
            }

            foreach (var sent in _allMessages.Where(m => MessageBelongsToActiveDevice(m) && m.IsSent && m.NormalizedPhone == conv.PhoneNumber))
            {
                if (!sent.IsRead)
                {
                    sent.IsRead = true;
                    changed = true;
                }
            }
        }
        if (!changed && !conv.IsUnread && handlesToSync.Count == 0)
            return;

        conv.IsUnread = false;
        SaveMessagesAsync();
        if (handlesToSync.Count > 0)
            _ = PushConversationReadStateToPhoneAsync(handlesToSync, isRead: true);
        OnPropertyChanged(nameof(CanMarkSelectedConversationRead));
        OnPropertyChanged(nameof(CanMarkSelectedConversationUnread));
    }

    private void MarkConversationUnread(Conversation conv)
    {
        string? handleToSync = null;
        bool hasUnreadIncoming = false;
        lock (_msgLock)
        {
            foreach (var sent in _allMessages.Where(m => MessageBelongsToActiveDevice(m) && m.IsSent && m.NormalizedPhone == conv.PhoneNumber))
                sent.IsRead = true;

            var newestIncoming = _allMessages
                .Where(m => MessageBelongsToActiveDevice(m) && !m.IsSent && m.NormalizedPhone == conv.PhoneNumber)
                .OrderByDescending(m => m.Timestamp)
                .FirstOrDefault();
            if (newestIncoming != null)
            {
                newestIncoming.IsRead = false;
                handleToSync = string.IsNullOrWhiteSpace(newestIncoming.Handle) ? null : newestIncoming.Handle;
                hasUnreadIncoming = true;
            }
        }
        conv.IsUnread = hasUnreadIncoming;
        SaveMessagesAsync();
        if (!string.IsNullOrWhiteSpace(handleToSync))
            _ = PushConversationReadStateToPhoneAsync(new[] { handleToSync }, isRead: false);
        OnPropertyChanged(nameof(CanMarkSelectedConversationRead));
        OnPropertyChanged(nameof(CanMarkSelectedConversationUnread));
    }

    private Conversation? ResolveConversation(object? candidate) => candidate as Conversation ?? SelectedConversation;

    private Conversation? ResolveConversationByPhone(string? phone)
    {
        var normalized = ContactStoreService.NormalizePhone(phone);
        if (string.IsNullOrWhiteSpace(normalized))
            return null;

        return Conversations.FirstOrDefault(conversation => SamePhone(conversation.PhoneNumber, normalized));
    }

    private void MarkConversationReadFromWeb(string phone)
    {
        var conversation = ResolveConversationByPhone(phone);
        if (conversation != null)
            MarkConversationRead(conversation);
    }

    private void MarkConversationUnreadFromWeb(string phone)
    {
        var conversation = ResolveConversationByPhone(phone);
        if (conversation != null)
            MarkConversationUnread(conversation);
    }

    private void ToggleConversationPinnedFromWeb(string phone)
        => ToggleConversationPinned(ResolveConversationByPhone(phone));

    private void ToggleConversationAlertsMutedFromWeb(string phone)
        => ToggleConversationAlertsMuted(ResolveConversationByPhone(phone));

    private void ToggleConversationBlockedFromWeb(string phone)
        => ToggleConversationBlocked(ResolveConversationByPhone(phone));

    private void ToggleConversationPinned(Conversation? conversation)
    {
        if (conversation == null)
            return;

        var shouldPin = !conversation.IsPinned;
        if (!_settings.SetConversationPinned(conversation.PhoneNumber, shouldPin))
            return;

        conversation.IsPinned = shouldPin;
        conversation.NotifyChanged();
        SortConversations();
        ApplySearch();
        NotifySelectedConversationDetailsChanged();
    }

    private SmsMessage? _activeBubbleMessage;

    public void ToggleBubbleActions(SmsMessage? msg)
    {
        if (msg == null)
            return;

        if (_activeBubbleMessage != null && !ReferenceEquals(_activeBubbleMessage, msg))
            _activeBubbleMessage.IsActionTrayOpen = false;

        if (ReferenceEquals(_activeBubbleMessage, msg))
        {
            msg.IsActionTrayOpen = !msg.IsActionTrayOpen;
            if (!msg.IsActionTrayOpen)
                _activeBubbleMessage = null;
            return;
        }

        msg.IsActionTrayOpen = true;
        _activeBubbleMessage = msg;
    }

    public void CloseBubbleActions()
    {
        if (_activeBubbleMessage == null)
            return;

        _activeBubbleMessage.IsActionTrayOpen = false;
        _activeBubbleMessage = null;
    }

    public void RevealBubbleActions(SmsMessage? msg)
    {
        if (msg == null)
            return;

        if (_activeBubbleMessage != null && !ReferenceEquals(_activeBubbleMessage, msg))
            _activeBubbleMessage.IsActionTrayOpen = false;

        msg.IsActionTrayOpen = true;
        _activeBubbleMessage = msg;
    }

    public void ToggleMessagePinned(SmsMessage? msg)
    {
        if (msg == null)
            return;

        msg.IsPinned = !msg.IsPinned;
        CloseBubbleActions();
        NotifySelectedConversationDetailsChanged();
        SaveMessagesAsync();
    }

    private SmsMessage? FindMessageForWebId(string? id)
    {
        if (string.IsNullOrWhiteSpace(id))
            return null;

        lock (_msgLock)
        {
            return _allMessages.FirstOrDefault(message =>
                string.Equals(message.LocalId, id, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(message.Handle, id, StringComparison.OrdinalIgnoreCase));
        }
    }

    private void ToggleConversationAlertsMuted(Conversation? conversation)
    {
        if (conversation == null)
            return;

        var shouldMute = !conversation.AreAlertsMuted;
        if (!_settings.SetConversationAlertsMuted(conversation.PhoneNumber, shouldMute))
            return;

        conversation.AreAlertsMuted = shouldMute;
        conversation.NotifyChanged();

        if (shouldMute && SamePhone(MessageBannerPhoneNumber, conversation.PhoneNumber))
            DismissMessageBanner();

        ApplySearch();
        NotifySelectedConversationDetailsChanged();
    }

    private void ToggleConversationBlocked(Conversation? conversation)
    {
        if (conversation == null)
            return;

        var shouldBlock = !conversation.IsBlocked;
        if (!_settings.SetConversationBlocked(conversation.PhoneNumber, shouldBlock))
            return;

        conversation.IsBlocked = shouldBlock;
        if (shouldBlock)
        {
            if (!conversation.AreAlertsMuted)
                _settings.SetConversationAlertsMuted(conversation.PhoneNumber, true);
            conversation.AreAlertsMuted = true;
            if (SamePhone(MessageBannerPhoneNumber, conversation.PhoneNumber))
                DismissMessageBanner();
        }

        conversation.NotifyChanged();
        ApplySearch();
        NotifySelectedConversationDetailsChanged();
    }

    private void ToggleCallRecordBlocked(CallRecord? record)
    {
        var normalized = ContactStoreService.NormalizePhone(record?.Number);
        if (string.IsNullOrWhiteSpace(normalized))
            return;

        var shouldBlock = !_settings.IsConversationBlocked(normalized);
        if (!_settings.SetConversationBlocked(normalized, shouldBlock))
            return;

        if (shouldBlock)
            _settings.SetConversationAlertsMuted(normalized, true);

        foreach (var conversation in Conversations.Where(c => SamePhone(c.PhoneNumber, normalized)))
        {
            conversation.IsBlocked = shouldBlock;
            if (shouldBlock)
                conversation.AreAlertsMuted = true;
            conversation.NotifyChanged();
        }

        if (shouldBlock && SamePhone(MessageBannerPhoneNumber, normalized))
            DismissMessageBanner();

        ApplySearch();
        NotifyCallHistoryViewsChanged();
        OnPropertyChanged(nameof(IsSelectedCallRecordBlocked));
        OnPropertyChanged(nameof(SelectedCallRecordBlockLabel));
        OnPropertyChanged(nameof(SelectedCallRecordBlockTooltip));
    }

    private void ToggleCallNumberBlockedFromWeb(string phone)
    {
        var normalized = ContactStoreService.NormalizePhone(phone);
        if (string.IsNullOrWhiteSpace(normalized))
            return;

        ToggleCallRecordBlocked(new CallRecord { Number = normalized });
    }

    private void SaveMessagesAsync()
    {
        List<SmsMessage> snapshot;
        lock (_msgLock)
            snapshot = _allMessages.ToList();
        _ = Task.Run(() => _store.Save(snapshot));
    }

    private async Task PushConversationReadStateToPhoneAsync(IEnumerable<string> handles, bool isRead)
    {
        if (_map == null || !_map.IsConnected) return;

        int successCount = 0;
        foreach (var handle in handles
                     .Where(h => !string.IsNullOrWhiteSpace(h))
                     .Distinct(StringComparer.OrdinalIgnoreCase))
        {
            try
            {
                if (await _map.SetMessageReadStatusAsync(handle, isRead, _sessionCts.Token))
                    successCount++;
            }
            catch (OperationCanceledException) { return; }
            catch (Exception ex) { AppendDebugThreadSafe($"[READSTATE PUSH] {handle}: {ex.Message}"); }
        }

        if (successCount > 0)
            await RefreshPhoneReadStatesAsync(_sessionCts.Token);
    }

    private async Task<int> RefreshPhoneReadStatesAsync(CancellationToken ct)
    {
        if (_map == null || !_map.IsConnected) return 0;

        IReadOnlyDictionary<string, bool> recentStates;
        try
        {
            recentStates = await _map.GetRecentReadStatesByHandleAsync(25, ct);
        }
        catch (OperationCanceledException) { return 0; }
        catch (Exception ex)
        {
            AppendDebugThreadSafe($"[READSTATE SYNC] {ex.Message}");
            return 0;
        }

        int changed = 0;
        lock (_msgLock)
        {
            foreach (var msg in _allMessages.Where(MessageBelongsToActiveDevice))
            {
                bool desiredRead = msg.IsSent ? true : msg.IsRead;
                if (!string.IsNullOrWhiteSpace(msg.Handle) && recentStates.TryGetValue(msg.Handle, out var phoneIsRead))
                    desiredRead = msg.IsSent ? true : phoneIsRead;

                if (msg.IsRead != desiredRead)
                {
                    msg.IsRead = desiredRead;
                    changed++;
                }
            }
        }

        if (changed > 0)
        {
            SaveMessagesAsync();
            Dispatch(RebuildConversations);
        }

        return changed;
    }

    private void MarkIncomingUnread(IEnumerable<SmsMessage> incoming)
    {
        var selectedPhone = SelectedConversation?.PhoneNumber;
        foreach (var phone in incoming
                     .Where(m => !m.IsSent && !string.IsNullOrEmpty(m.NormalizedPhone))
                     .Select(m => m.NormalizedPhone)
                     .Distinct())
        {
            if (phone == selectedPhone) continue;
            var conv = Conversations.FirstOrDefault(c => c.PhoneNumber == phone);
            if (conv != null) conv.IsUnread = true;
        }
    }

    private void NotifySelectedConversationDetailsChanged()
    {
        OnPropertyChanged(nameof(FilteredCallHistory));
        OnPropertyChanged(nameof(HasFilteredCallHistory));
        OnPropertyChanged(nameof(SelectedConversationCallHistory));
        OnPropertyChanged(nameof(SelectedConversationPinnedMessages));
        OnPropertyChanged(nameof(HasSelectedConversationCalls));
        OnPropertyChanged(nameof(HasSelectedConversationPinnedMessages));
        OnPropertyChanged(nameof(SelectedConversationPinnedSummary));
        OnPropertyChanged(nameof(SelectedConversationCallSummary));
        OnPropertyChanged(nameof(SelectedConversationMatchingContact));
        OnPropertyChanged(nameof(CanAddSelectedConversationContact));
        OnPropertyChanged(nameof(CanEditSelectedConversationContact));
        OnPropertyChanged(nameof(CanMarkSelectedConversationRead));
        OnPropertyChanged(nameof(CanMarkSelectedConversationUnread));
        OnPropertyChanged(nameof(IsSelectedConversationPinned));
        OnPropertyChanged(nameof(AreSelectedConversationAlertsMuted));
        OnPropertyChanged(nameof(IsSelectedConversationBlocked));
        OnPropertyChanged(nameof(SelectedConversationPinLabel));
        OnPropertyChanged(nameof(SelectedConversationAlertsLabel));
        OnPropertyChanged(nameof(SelectedConversationBlockLabel));
        OnPropertyChanged(nameof(SelectedConversationPinTooltip));
        OnPropertyChanged(nameof(SelectedConversationAlertsTooltip));
        OnPropertyChanged(nameof(SelectedConversationBlockTooltip));
    }

    private void NotifyCallHistoryViewsChanged()
    {
        OnPropertyChanged(nameof(FilteredCallHistory));
        OnPropertyChanged(nameof(HasFilteredCallHistory));
        NotifySelectedConversationDetailsChanged();
    }

    private bool MatchesCallHistoryFilter(CallRecord record) => ActiveCallHistoryFilter switch
    {
        CallHistoryFilter.Missed => record.Direction == CallDirection.Missed,
        CallHistoryFilter.Incoming => record.Direction == CallDirection.Incoming,
        CallHistoryFilter.Outgoing => record.Direction == CallDirection.Outgoing,
        _ => true
    };

    private void ClearMissedCallAlert()
    {
        if (NewMissedCallCount == 0)
            return;

        NewMissedCallCount = 0;
    }

    private void SurfaceMissedCallAlert(string? number, string? displayName)
    {
        var normalized = ContactStoreService.NormalizePhone(number);
        var label = string.IsNullOrWhiteSpace(displayName)
            ? Conversation.FormatPhone(number ?? "")
            : displayName;
        var key = $"{normalized}|{DateTime.Now:yyyyMMddHHmm}";

        if (string.Equals(key, _lastMissedCallAlertKey, StringComparison.OrdinalIgnoreCase) &&
            DateTime.UtcNow - _lastMissedCallAlertUtc < TimeSpan.FromMinutes(2))
            return;

        _lastMissedCallAlertKey = key;
        _lastMissedCallAlertUtc = DateTime.UtcNow;
        NewMissedCallCount++;
        _notif.ShowMissedCall(label);
    }

    private bool ShouldSurfaceConversationAlert(string? phoneOrAddress)
       => !_settings.AreConversationAlertsMuted(phoneOrAddress)
           && !_settings.IsConversationBlocked(phoneOrAddress);

    private static bool IsVoicemailNotice(SmsMessage message)
    {
        var text = $"{message.From} {message.Body}".ToLowerInvariant();
        return text.Contains("voicemail") ||
               text.Contains("voice mail") ||
               text.Contains("new voice message") ||
               text.Contains("visual voicemail");
    }

    private void ShowMessageNotification(SmsMessage message)
    {
        if (IsVoicemailNotice(message))
        {
            var alertText = string.IsNullOrWhiteSpace(message.PreviewBody)
                ? $"Voicemail from {GetMessageSenderDisplay(message)}"
                : message.PreviewBody;
            ApplyVoicemailAlertState(true, alertText, persistForCurrentDevice: true);
            _notif.ShowVoicemail(GetMessageSenderDisplay(message), message.PreviewBody);
        }
        else
            _notif.ShowNewMessage(
                GetMessageSenderDisplay(message),
                message.NormalizedPhone ?? message.From ?? "",
                message.PreviewBody);
    }

    // ── Toast notification activation ─────────────────────────────────────
    // Called by App.xaml.cs via ToastNotificationManagerCompat.OnActivated.
    // Fires on the UI dispatcher thread, already dispatched by App.xaml.cs.
    // Handles: reply (free-text), quickreply (chip tap), openphone (body/Open click).
    public void HandleToastActivation(ToastNotificationActivatedEventArgsCompat e)
    {
        // ToastArguments.Parse uses an internal format that is not always compatible
        // with the plain key=value&key=value strings we embed in button arguments.
        // Parse manually so the split is guaranteed to work.
        var query = (e.Argument ?? "")
            .Split('&')
            .Select(pair => pair.Split(new[] { '=' }, 2))
            .Where(parts => parts.Length == 2)
            .ToDictionary(
                parts => Uri.UnescapeDataString(parts[0]),
                parts => Uri.UnescapeDataString(parts[1]),
                StringComparer.OrdinalIgnoreCase);

        if (!query.TryGetValue("action", out var action)) return;

        switch (action)
        {
            case "reply":
            {
                // "Send" button — phone number in query, typed text in UserInput
                query.TryGetValue("phone", out var phone);
                e.UserInput.TryGetValue("replyInput", out var inputObj);
                var body = inputObj?.ToString();
                if (!string.IsNullOrWhiteSpace(phone) && !string.IsNullOrWhiteSpace(body))
                    _ = SendMessageFromNotificationAsync(phone, body);
                break;
            }
            case "quickreply":
            {
                // Quick-reply chip — phone and body already decoded by manual parser
                query.TryGetValue("phone", out var phone);
                query.TryGetValue("body",  out var body);
                if (!string.IsNullOrWhiteSpace(phone) && !string.IsNullOrWhiteSpace(body))
                    _ = SendMessageFromNotificationAsync(phone, body);
                break;
            }
            case "openphone":
                OpenShamashPhonePage();
                break;
        }
    }

    private void OpenShamashPhonePage()
    {
        try
        {
            // Opens the Shamash Pro 4 web app at the phone/messages view.
            Process.Start(new ProcessStartInfo(
                "https://onetaskfocuser.netlify.app/?view=deskphone") { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            AppendDebug($"[NOTIF] Could not open phone page: {ex.Message}");
        }
    }

    private async Task SendMessageFromNotificationAsync(string phone, string body)
    {
        if (_map == null || !_map.IsConnected)
        {
            AppendDebug("[NOTIF REPLY] MAP not connected — reply discarded");
            return;
        }
        try
        {
            var ok = await _map.SendMessageAsync(phone, body, ct: _sessionCts.Token);
            AppendDebug(ok
                ? $"[NOTIF REPLY] Sent to {phone}: {body}"
                : $"[NOTIF REPLY] Send failed for {phone}");
            if (ok)
            {
                // Refresh so the sent bubble appears in the conversation list
                _ = Task.Run(async () =>
                {
                    await Task.Delay(1500, _sessionCts.Token);
                    await RefreshMessagesAsync();
                }, _sessionCts.Token);
            }
        }
        catch (Exception ex)
        {
            AppendDebug($"[NOTIF REPLY] Error: {ex.Message}");
        }
    }

    private void HandlePhoneIndicator(string indicatorName, int value)
    {
        var normalized = indicatorName.Trim().ToLowerInvariant();
        switch (normalized)
        {
            case "message":
            case "messages":
            case "msg":
            case "msgwaiting":
            case "messagewaiting":
            case "voicemail":
            case "voicemessage":
                if (value > 0)
                {
                    ApplyVoicemailAlertState(true, "New voicemail", persistForCurrentDevice: true);
                }
                else
                {
                    ApplyVoicemailAlertState(false, null, persistForCurrentDevice: true);
                }
                AppendDebug($"[HFP INDICATOR] {indicatorName}={value} -> voicemail {(value > 0 ? "on" : "off")}");
                break;
        }
    }

    // ── Audio ─────────────────────────────────────────────────────────────
    private string _audioInfo = "";
    public string AudioInfo
    {
        get => _audioInfo;
        set { _audioInfo = value; OnPropertyChanged(); }
    }

    private string _pairingGuidance = "";
    public string PairingGuidance
    {
        get => _pairingGuidance;
        set { _pairingGuidance = value; OnPropertyChanged(); OnPropertyChanged(nameof(HasPairingGuidance)); }
    }
    public bool HasPairingGuidance => !string.IsNullOrEmpty(_pairingGuidance);

    private bool _showContactImportPrompt;
    public bool ShowContactImportPrompt
    {
        get => _showContactImportPrompt;
        set { _showContactImportPrompt = value; OnPropertyChanged(); }
    }

    private string _contactSyncStatus = "No contact sync activity yet";
    public string ContactSyncStatus
    {
        get => _contactSyncStatus;
        set { _contactSyncStatus = value; OnPropertyChanged(); }
    }

    private string _contactSyncFolderPath = "";
    public string ContactSyncFolderPath
    {
        get => _contactSyncFolderPath;
        set { _contactSyncFolderPath = value; OnPropertyChanged(); }
    }

    private string _messageBackupExportStatus = "Save the current DeskPhone message history to a JSON file wherever you want. Automatic rolling backups still continue separately.";
    public string MessageBackupExportStatus
    {
        get => _messageBackupExportStatus;
        set { _messageBackupExportStatus = value; OnPropertyChanged(); }
    }

    private static readonly MediaBrush PbapSuccessBrush = new MediaSolidColorBrush(MediaColor.FromRgb(0x13, 0x73, 0x33));
    private static readonly MediaBrush PbapPendingBrush = new MediaSolidColorBrush(MediaColor.FromRgb(0x8A, 0x5A, 0x00));
    private static readonly MediaBrush PbapWarningBrush = new MediaSolidColorBrush(MediaColor.FromRgb(0xB3, 0x26, 0x1E));

    private PbapAvailabilityKind _pbapAvailability = PbapAvailabilityKind.NotRun;
    public PbapAvailabilityKind PbapAvailability
    {
        get => _pbapAvailability;
        private set
        {
            if (_pbapAvailability == value) return;
            _pbapAvailability = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(IsPbapAvailable));
            OnPropertyChanged(nameof(IsPbapPending));
            OnPropertyChanged(nameof(PbapBadgeText));
            OnPropertyChanged(nameof(PbapBadgeForeground));
        }
    }

    private string _pbapStatus = "PBAP call-log sync has not run for the current phone yet.";
    public string PbapStatus
    {
        get => _pbapStatus;
        private set
        {
            if (_pbapStatus == value) return;
            _pbapStatus = value;
            OnPropertyChanged();
        }
    }

    private string _pbapGuidanceTitle = "";
    public string PbapGuidanceTitle
    {
        get => _pbapGuidanceTitle;
        private set
        {
            if (_pbapGuidanceTitle == value) return;
            _pbapGuidanceTitle = value;
            OnPropertyChanged();
        }
    }

    private string _pbapGuidance = "";
    public string PbapGuidance
    {
        get => _pbapGuidance;
        private set
        {
            if (_pbapGuidance == value) return;
            _pbapGuidance = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(HasPbapGuidance));
        }
    }

    public bool HasPbapGuidance => !string.IsNullOrWhiteSpace(PbapGuidance);

    public bool IsPbapAvailable => PbapAvailability == PbapAvailabilityKind.Connected;

    public bool IsPbapPending =>
        PbapAvailability == PbapAvailabilityKind.NotRun ||
        PbapAvailability == PbapAvailabilityKind.Checking;

    public string PbapBadgeText => PbapAvailability switch
    {
        PbapAvailabilityKind.Connected => "Connected",
        PbapAvailabilityKind.Checking => "Checking",
        PbapAvailabilityKind.NotRun => "Not checked",
        PbapAvailabilityKind.PermissionRequired => "Permission needed",
        PbapAvailabilityKind.NotAdvertised => "Not offered",
        PbapAvailabilityKind.ConnectionLost => "Phone dropped",
        PbapAvailabilityKind.ImportFailed => "Needs attention",
        _ => "Unavailable"
    };

    public MediaBrush PbapBadgeForeground => PbapAvailability switch
    {
        PbapAvailabilityKind.Connected => PbapSuccessBrush,
        PbapAvailabilityKind.Checking or PbapAvailabilityKind.NotRun => PbapPendingBrush,
        _ => PbapWarningBrush
    };

    private void SetPbapStatus(PbapAvailabilityKind kind, string summary, string guidance = "", string? guidanceTitle = null)
    {
        PbapAvailability = kind;
        PbapStatus = summary;

        if (string.IsNullOrWhiteSpace(guidance))
        {
            PbapGuidanceTitle = "";
            PbapGuidance = "";
            return;
        }

        PbapGuidanceTitle = guidanceTitle ?? kind switch
        {
            PbapAvailabilityKind.PermissionRequired => "What to enable on the phone",
            PbapAvailabilityKind.NotAdvertised => "Why PBAP may be missing",
            PbapAvailabilityKind.ConnectionLost => "Keep the phone connected",
            PbapAvailabilityKind.ImportFailed => "PBAP opened but sync still failed",
            _ => "Next step"
        };
        PbapGuidance = guidance;
    }

    private int _pendingContactFiles;
    public int PendingContactFiles
    {
        get => _pendingContactFiles;
        set
        {
            _pendingContactFiles = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(ContactImportPromptText));
        }
    }

    public int ContactCount
    {
        get
        {
            lock (_contactLock) return _contacts.Count;
        }
    }

    public string ContactCountText => $"Saved contacts: {ContactCount}";
    public string ComposeContactActionNumber => ContactStoreService.NormalizePhone(ComposeToNumber);

    private string _composeRecipientInput = "";
    public string ComposeRecipientInput
    {
        get => _composeRecipientInput;
        set
        {
            if (string.Equals(_composeRecipientInput, value, StringComparison.Ordinal))
                return;

            _composeRecipientInput = value ?? "";
            _selectedComposeContact = null;
            ComposeToNumber = _composeRecipientInput;
            IsComposeSuggestionsOpen = !string.IsNullOrWhiteSpace(_composeRecipientInput);
            OnPropertyChanged();
            OnPropertyChanged(nameof(SelectedComposeContact));
            RefreshComposeContacts();
            QueueDraftPersist();
        }
    }

    public string CallContactSearch
    {
        get => DialNumber;
        set => DialNumber = value;
    }

    private string _settingsContactSearch = "";
    public string SettingsContactSearch
    {
        get => _settingsContactSearch;
        set
        {
            if (string.Equals(_settingsContactSearch, value, StringComparison.Ordinal))
                return;

            _settingsContactSearch = value;
            OnPropertyChanged();
            RefreshEditableContacts();
        }
    }

    private ContactOption? _selectedComposeContact;
    public ContactOption? SelectedComposeContact
    {
        get => _selectedComposeContact;
        set
        {
            _selectedComposeContact = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(HasSelectedComposeContact));
            OnPropertyChanged(nameof(SelectedComposeContactName));
            OnPropertyChanged(nameof(SelectedComposeContactPhone));
            if (value != null)
            {
                ComposeToNumber = value.PhoneNumber;
                _composeRecipientInput = value.DisplayName;
                OnPropertyChanged(nameof(ComposeRecipientInput));
            }
        }
    }

    private SettingsSection _selectedSettingsSection = SettingsSection.Connection;
    public SettingsSection SelectedSettingsSection
    {
        get => _selectedSettingsSection;
        set
        {
            if (_selectedSettingsSection == value) return;
            _selectedSettingsSection = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(IsConnectionSettingsSectionSelected));
            OnPropertyChanged(nameof(IsAppearanceSettingsSectionSelected));
            OnPropertyChanged(nameof(IsSyncSettingsSectionSelected));
            OnPropertyChanged(nameof(IsAudioSettingsSectionSelected));
            OnPropertyChanged(nameof(SettingsSectionTitle));
            OnPropertyChanged(nameof(SettingsSectionDescription));
        }
    }

    public bool IsConnectionSettingsSectionSelected
    {
        get => SelectedSettingsSection == SettingsSection.Connection;
        set { if (value) SelectedSettingsSection = SettingsSection.Connection; }
    }

    public bool IsAppearanceSettingsSectionSelected
    {
        get => SelectedSettingsSection == SettingsSection.Appearance;
        set { if (value) SelectedSettingsSection = SettingsSection.Appearance; }
    }

    public bool IsSyncSettingsSectionSelected
    {
        get => SelectedSettingsSection == SettingsSection.Sync;
        set { if (value) SelectedSettingsSection = SettingsSection.Sync; }
    }

    public bool IsAudioSettingsSectionSelected
    {
        get => SelectedSettingsSection == SettingsSection.Audio;
        set { if (value) SelectedSettingsSection = SettingsSection.Audio; }
    }

    public string SettingsSectionTitle => SelectedSettingsSection switch
    {
        SettingsSection.Connection => "Connection",
        SettingsSection.Appearance => "Appearance",
        SettingsSection.Sync => "Contact Sync",
        SettingsSection.Audio => "Audio",
        _ => "Settings"
    };

    public string SettingsSectionDescription => SelectedSettingsSection switch
    {
        SettingsSection.Connection => "Primary phone access, saved devices, pairing, and reconnect flow.",
        SettingsSection.Appearance => "Theme and shell-level behavior that should live in one place.",
        SettingsSection.Sync => "VCF import and per-phone contact sync state.",
        SettingsSection.Audio => "Bluetooth playback visibility and audio routing diagnostics.",
        _ => ""
    };

    public bool IsDarkModeEnabled
    {
        get => _settings.Current.DarkModeEnabled
            ?? string.Equals(_settings.Current.PreferredPalette, "BlueGold", StringComparison.OrdinalIgnoreCase);
        set
        {
            var currentDarkMode = _settings.Current.DarkModeEnabled
                ?? string.Equals(_settings.Current.PreferredPalette, "BlueGold", StringComparison.OrdinalIgnoreCase);
            if (currentDarkMode == value)
                return;

            _settings.SetDarkMode(value);
            ThemeService.ApplyPalette(_settings.Current.PreferredPalette);
            OnPropertyChanged();
            OnPropertyChanged(nameof(ThemeModeLabel));
        }
    }

    public string ThemeModeLabel => IsDarkModeEnabled
        ? "Material 3 dark mode is on. Changes apply immediately and stay after restart."
        : "Material 3 light mode is on. Changes apply immediately and stay after restart.";

    public bool SyncThemeWithShamash
    {
        get => _settings.Current.SyncThemeWithShamash;
        set
        {
            if (_settings.Current.SyncThemeWithShamash == value)
                return;

            _settings.Current.SyncThemeWithShamash = value;
            _settings.Save();
            if (!value)
                ThemeService.ApplyPalette(_settings.Current.PreferredPalette);
            OnPropertyChanged();
            OnPropertyChanged(nameof(ThemeSyncLabel));
        }
    }

    public string ThemeSyncLabel => SyncThemeWithShamash
        ? "DeskPhone follows the active Shamash/OneTask color scheme when that app is open."
        : "DeskPhone ignores Shamash/OneTask theme changes and keeps its own appearance setting.";

    private string _themeSyncRefreshStatus = "";
    public string ThemeSyncRefreshStatus
    {
        get => _themeSyncRefreshStatus;
        private set
        {
            if (_themeSyncRefreshStatus == value)
                return;

            _themeSyncRefreshStatus = value;
            OnPropertyChanged();
        }
    }

    private double _uiScaleDraftPercent = 100;

    public double UiScalePercent
    {
        get => _settings.GetUiScalePercent();
        set
        {
            if (!_settings.SetUiScalePercent(value))
            {
                SyncUiScaleDraftPercent();
                return;
            }

            SyncUiScaleDraftPercent(_settings.GetUiScalePercent());
            OnPropertyChanged();
            OnPropertyChanged(nameof(UiScale));
        }
    }

    public double UiScale => UiScalePercent / 100d;

    public double UiScaleDraftPercent
    {
        get => _uiScaleDraftPercent;
        set
        {
            if (Math.Abs(_uiScaleDraftPercent - value) < 0.01)
                return;

            _uiScaleDraftPercent = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(UiScaleLabel));
            OnPropertyChanged(nameof(UiScaleDescription));
            OnPropertyChanged(nameof(IsDefaultUiScale));
        }
    }

    public string UiScaleLabel => $"{UiScaleDraftPercent:0}%";

    public string UiScaleDescription => "Use small, crisp interface scale steps. Message text is kept readable separately so the frame does not need oversized zoom.";

    public bool IsDefaultUiScale => Math.Abs(UiScaleDraftPercent - 100d) < 0.01;

    public void CommitUiScaleDraftPercent()
        => UiScalePercent = UiScaleDraftPercent;

    public void ResetUiScale()
    {
        UiScaleDraftPercent = 100;
        CommitUiScaleDraftPercent();
    }

    private void SyncUiScaleDraftPercent(double? percent = null)
    {
        var actualPercent = percent ?? _settings.GetUiScalePercent();
        if (Math.Abs(_uiScaleDraftPercent - actualPercent) < 0.01)
            return;

        _uiScaleDraftPercent = actualPercent;
        OnPropertyChanged(nameof(UiScaleDraftPercent));
        OnPropertyChanged(nameof(UiScaleLabel));
        OnPropertyChanged(nameof(UiScaleDescription));
        OnPropertyChanged(nameof(IsDefaultUiScale));
    }

    public bool IsNavigationRailCollapsed
    {
        get => _settings.Current.IsNavigationRailCollapsed;
        set
        {
            if (_settings.Current.IsNavigationRailCollapsed == value)
                return;

            _settings.Current.IsNavigationRailCollapsed = value;
            _settings.Save();
            OnPropertyChanged();
            OnPropertyChanged(nameof(ShowNavigationRailLabels));
            OnPropertyChanged(nameof(NavigationRailToggleGlyph));
            OnPropertyChanged(nameof(NavigationRailToggleLabel));
        }
    }

    public bool ShowNavigationRailLabels => !IsNavigationRailCollapsed;

    public string NavigationRailToggleGlyph => IsNavigationRailCollapsed ? "\uE9BD" : "\uE5CB";

    public string NavigationRailToggleLabel => IsNavigationRailCollapsed ? "Expand sidebar" : "Collapse sidebar";

    public void ToggleNavigationRail() => IsNavigationRailCollapsed = !IsNavigationRailCollapsed;

    public AppSettingsService.KnownDevice? QuickConnectDevice => _settings.DefaultDevice;

    public bool HasQuickConnectDevice => QuickConnectDevice != null;
    public bool CanQuickReconnect => HasQuickConnectDevice && !IsConnecting;

    public string QuickConnectDeviceName => QuickConnectDevice?.Name ?? "No default phone selected";
    public string QuickConnectSidebarLabel => HasQuickConnectDevice ? $"Connect {QuickConnectDeviceName}" : "Select default phone";
    public string ConnectionRailSubtitle => HasQuickConnectDevice ? QuickConnectDeviceSummary : "Set a default phone in Connection Settings.";
    public string CallsConnectionLabel => GetConnectionChannelLabel(StatusHfp, "Calls");
    public string MessagesConnectionLabel => GetConnectionChannelLabel(StatusMap, "Messages");

    public string QuickConnectDeviceSummary
    {
        get
        {
            var device = QuickConnectDevice;
            if (device == null)
                return "No default phone selected. DeskPhone will not auto-connect to a random saved phone.";

            var connectionState = IsFullyConnected
                ? "connected"
                : IsConnecting
                    ? "connecting"
                    : "ready";
            return $"Preferred Phone [{device.Name}] {connectionState}";
        }
    }

    public IEnumerable<AppSettingsService.KnownDevice> OtherKnownDevices =>
        _settings.Current.KnownDevices
            .OrderByDescending(d => d.IsDefault)
            .ThenByDescending(d => d.LastSeen)
            .ToList();

    public bool HasOtherKnownDevices => OtherKnownDevices.Any();

    public bool HasSelectedComposeContact => SelectedComposeContact != null;
    public string SelectedComposeContactName => SelectedComposeContact?.DisplayName ?? "";
    public string SelectedComposeContactPhone => SelectedComposeContact?.FormattedPhone ?? "";

    private bool _isComposeSuggestionsOpen;
    public bool IsComposeSuggestionsOpen
    {
        get => _isComposeSuggestionsOpen;
        set
        {
            if (_isComposeSuggestionsOpen == value) return;
            _isComposeSuggestionsOpen = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(ShowComposeContactSuggestions));
        }
    }

    public bool ShowComposeContactSuggestions => IsComposeSuggestionsOpen && ComposeContacts.Count > 0;

    private ContactOption? _selectedCallContact;
    public ContactOption? SelectedCallContact
    {
        get => _selectedCallContact;
        set
        {
            _selectedCallContact = value;
            OnPropertyChanged();
            if (value != null)
                DialNumber = value.PhoneNumber;
        }
    }

    private bool _isCallSuggestionsOpen;
    public bool IsCallSuggestionsOpen
    {
        get => _isCallSuggestionsOpen;
        set
        {
            if (_isCallSuggestionsOpen == value) return;
            _isCallSuggestionsOpen = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(ShowCallContactSuggestions));
        }
    }

    public bool ShowCallContactSuggestions => IsCallSuggestionsOpen && CallContacts.Count > 0;

    private ContactEntry? _selectedEditableContact;
    public ContactEntry? SelectedEditableContact
    {
        get => _selectedEditableContact;
        set
        {
            _selectedEditableContact = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(CanDeleteSelectedContact));
            OnPropertyChanged(nameof(HasSelectedEditableContact));
            OnPropertyChanged(nameof(SelectedEditableContactDisplayName));
            OnPropertyChanged(nameof(SelectedEditableContactOptions));
            LoadContactEditor(value);
        }
    }

    public bool CanDeleteSelectedContact => SelectedEditableContact != null;
    public bool HasSelectedEditableContact => SelectedEditableContact != null;
    public string SelectedEditableContactDisplayName => SelectedEditableContact?.DisplayName ?? "No contact selected";
    public IEnumerable<ContactOption> SelectedEditableContactOptions =>
        SelectedEditableContact == null
            ? Enumerable.Empty<ContactOption>()
            : SelectedEditableContact.PhoneNumbers
                .Select(ContactStoreService.NormalizePhone)
                .Where(phone => !string.IsNullOrWhiteSpace(phone))
                .Select(phone => phone!)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Select(phone => new ContactOption
                {
                    Contact = SelectedEditableContact,
                    PhoneNumber = phone
                });

    private string _contactEditorName = "";
    public string ContactEditorName
    {
        get => _contactEditorName;
        set { _contactEditorName = value; OnPropertyChanged(); }
    }

    private string _contactEditorPhone = "";
    public string ContactEditorPhone
    {
        get => _contactEditorPhone;
        set { _contactEditorPhone = value; OnPropertyChanged(); }
    }

    private string _contactEditorTitle = "Add Contact";
    public string ContactEditorTitle
    {
        get => _contactEditorTitle;
        set { _contactEditorTitle = value; OnPropertyChanged(); }
    }

    public string ContactImportPromptText =>
        PendingContactFiles switch
        {
            <= 0 => "No new contact files waiting.",
            1 => "1 new contact file is ready from this phone. Upload new contacts from this phone?",
            _ => $"{PendingContactFiles} new contact files are ready from this phone. Upload new contacts from this phone?"
        };

    // ── Message compose ───────────────────────────────────────────────────
    private string _composeToNumber = "";
    public string ComposeToNumber
    {
        get => _composeToNumber;
        set
        {
            if (string.Equals(_composeToNumber, value, StringComparison.Ordinal))
                return;

            _composeToNumber = value ?? "";
            OnPropertyChanged();
            OnPropertyChanged(nameof(ComposeContactActionNumber));
            OnPropertyChanged(nameof(ComposeMatchingContact));
            OnPropertyChanged(nameof(CanSaveComposeContact));
            OnPropertyChanged(nameof(CanEditComposeContact));
            QueueDraftPersist();
        }
    }

    private string _composeBody = "";
    public string ComposeBody
    {
        get => _composeBody;
        set
        {
            if (string.Equals(_composeBody, value, StringComparison.Ordinal))
                return;

            _composeBody = value ?? "";
            OnPropertyChanged();
            QueueDraftPersist();
        }
    }

    public bool HasComposeAttachments => ComposeAttachments.Count > 0;

    public string ComposeAttachmentNotice => HasComposeAttachments
        ? "Attachments will send as MMS when this phone accepts Bluetooth MAP media sending."
        : "";

    private bool _isSendingMessage;
    public bool IsSendingMessage
    {
        get => _isSendingMessage;
        set
        {
            _isSendingMessage = value;
            OnPropertyChanged();
            Dispatch(() => CommandManager.InvalidateRequerySuggested());
        }
    }

    // ── Debug log ─────────────────────────────────────────────────────────
    private readonly StringBuilder _debugBuilder = new();
    private string _debugText = "";
    public string DebugText
    {
        get => _debugText;
        private set { _debugText = value; OnPropertyChanged(); }
    }

    private static readonly string LogFilePath =
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "DeskPhone", "deskphone.log");

    // ── Search ───────────────────────────────────────────────────────────
    private string _searchQuery = "";
    public string SearchQuery
    {
        get => _searchQuery;
        set { _searchQuery = value; OnPropertyChanged(); ApplySearch(); }
    }

    private string _conversationSearchQuery = "";
    private List<SmsMessage> _conversationSearchResults = new();
    private int _conversationSearchIndex = -1;

    public string ConversationSearchQuery
    {
        get => _conversationSearchQuery;
        set
        {
            if (_conversationSearchQuery == value) return;
            _conversationSearchQuery = value;
            OnPropertyChanged();
            RefreshConversationSearchResults(jumpToNewest: true);
        }
    }

    public string ConversationSearchStatus
    {
        get
        {
            if (string.IsNullOrWhiteSpace(ConversationSearchQuery)) return "";
            if (_conversationSearchResults.Count == 0) return "No matches";
            return $"{_conversationSearchIndex + 1} of {_conversationSearchResults.Count}";
        }
    }

    public bool HasConversationSearchQuery => !string.IsNullOrWhiteSpace(ConversationSearchQuery);
    public bool HasConversationSearchResults => _conversationSearchResults.Count > 0;

    private void ApplySearch()
    {
        var q = _searchQuery.Trim().ToLowerInvariant();
        var visibleCount = 0;
        foreach (var conv in Conversations)
        {
            var hiddenByQuery = !string.IsNullOrEmpty(q)
                && !conv.DisplayName.ToLowerInvariant().Contains(q)
                && !conv.PhoneNumber.Contains(q)
                && !conv.Messages.Any(m => (m.Body ?? "").ToLowerInvariant().Contains(q));
            var hiddenByFilter = ActiveConversationFilter switch
            {
                ConversationFilter.Unread => !conv.IsUnread,
                ConversationFilter.Pinned => !conv.IsPinned,
                ConversationFilter.Muted => !conv.AreAlertsMuted,
                ConversationFilter.Blocked => !conv.IsBlocked,
                _ => conv.IsBlocked
            };
            conv.IsHidden = hiddenByQuery || hiddenByFilter;
            if (!conv.IsHidden)
                visibleCount++;
        }

        VisibleConversationCount = visibleCount;
    }

    private void RefreshConversationSearchResults(bool jumpToNewest)
    {
        var q = _conversationSearchQuery.Trim();
        _conversationSearchResults = string.IsNullOrWhiteSpace(q) || SelectedConversation == null
            ? new List<SmsMessage>()
            : SelectedConversation.Messages
                .Where(m => (m.Body ?? "").Contains(q, StringComparison.OrdinalIgnoreCase))
                .OrderBy(m => m.Timestamp)
                .ToList();

        _conversationSearchIndex = _conversationSearchResults.Count == 0
            ? -1
            : jumpToNewest
                ? _conversationSearchResults.Count - 1
                : Math.Min(Math.Max(_conversationSearchIndex, 0), _conversationSearchResults.Count - 1);

        NotifyConversationSearchStateChanged();

        if (_conversationSearchIndex >= 0)
            RequestScrollToMessage?.Invoke(_conversationSearchResults[_conversationSearchIndex]);
    }

    private void MoveConversationSearch(int delta)
    {
        if (_conversationSearchResults.Count == 0)
        {
            RefreshConversationSearchResults(jumpToNewest: true);
            return;
        }

        _conversationSearchIndex = (_conversationSearchIndex + delta + _conversationSearchResults.Count) % _conversationSearchResults.Count;
        NotifyConversationSearchStateChanged();
        RequestScrollToMessage?.Invoke(_conversationSearchResults[_conversationSearchIndex]);
    }

    private void ClearConversationSearch()
    {
        ConversationSearchQuery = "";
        _conversationSearchResults.Clear();
        _conversationSearchIndex = -1;
        NotifyConversationSearchStateChanged();
    }

    private void NotifyConversationSearchStateChanged()
    {
        OnPropertyChanged(nameof(ConversationSearchStatus));
        OnPropertyChanged(nameof(HasConversationSearchQuery));
        OnPropertyChanged(nameof(HasConversationSearchResults));
        CommandManager.InvalidateRequerySuggested();
    }

    // ── Drafts ───────────────────────────────────────────────────────────
    private readonly Dictionary<string, string> _drafts = new();

    private bool _isRestoringDrafts;
    private readonly DispatcherTimer _draftPersistTimer = new() { Interval = TimeSpan.FromMilliseconds(600) };

    // ── Compose panel ────────────────────────────────────────────────────
    private bool _showComposePanel;
    public bool ShowComposePanel
    {
        get => _showComposePanel;
        set
        {
            if (_showComposePanel == value)
                return;

            _showComposePanel = value;
            OnPropertyChanged();
            QueueDraftPersist();
        }
    }

    private void QueueDraftPersist()
    {
        if (_isRestoringDrafts)
            return;

        if (Application.Current?.Dispatcher.CheckAccess() == true)
        {
            _draftPersistTimer.Stop();
            _draftPersistTimer.Start();
        }
        else
        {
            Dispatch(() =>
            {
                _draftPersistTimer.Stop();
                _draftPersistTimer.Start();
            });
        }
    }

    private void RestoreDraftsFromSettings()
    {
        _isRestoringDrafts = true;
        try
        {
            _drafts.Clear();
            foreach (var draft in _settings.Current.MessageDrafts.Where(d => !d.IsNewMessage))
            {
                var phone = ContactStoreService.NormalizePhone(draft.PhoneNumber);
                if (!string.IsNullOrWhiteSpace(phone) && !string.IsNullOrEmpty(draft.Body))
                    _drafts[phone] = draft.Body;
            }

            var newDraft = _settings.Current.MessageDrafts
                .Where(d => d.IsNewMessage)
                .OrderByDescending(d => d.UpdatedAt)
                .FirstOrDefault(d => !string.IsNullOrWhiteSpace(d.Body) || !string.IsNullOrWhiteSpace(d.PhoneNumber) || !string.IsNullOrWhiteSpace(d.RecipientInput));

            if (newDraft != null)
            {
                _composeToNumber = newDraft.PhoneNumber ?? "";
                _composeRecipientInput = string.IsNullOrWhiteSpace(newDraft.RecipientInput)
                    ? newDraft.PhoneNumber ?? ""
                    : newDraft.RecipientInput;
                _composeBody = newDraft.Body ?? "";
                _showComposePanel = true;
                OnPropertyChanged(nameof(ComposeToNumber));
                OnPropertyChanged(nameof(ComposeRecipientInput));
                OnPropertyChanged(nameof(ComposeBody));
                OnPropertyChanged(nameof(ShowComposePanel));
                OnPropertyChanged(nameof(ComposeContactActionNumber));
                OnPropertyChanged(nameof(ComposeMatchingContact));
                OnPropertyChanged(nameof(CanSaveComposeContact));
                OnPropertyChanged(nameof(CanEditComposeContact));
                RefreshComposeContacts();
            }
        }
        finally
        {
            _isRestoringDrafts = false;
        }
    }

    private void PersistDraftSnapshot()
    {
        if (_isRestoringDrafts)
            return;

        try
        {
            if (SelectedConversation != null)
            {
                if (string.IsNullOrEmpty(ComposeBody))
                    _drafts.Remove(SelectedConversation.PhoneNumber);
                else
                    _drafts[SelectedConversation.PhoneNumber] = ComposeBody;
            }

            var drafts = _drafts
                .Where(pair => !string.IsNullOrWhiteSpace(pair.Key) && !string.IsNullOrEmpty(pair.Value))
                .Select(pair => new AppSettingsService.MessageDraft
                {
                    PhoneNumber = pair.Key,
                    Body = pair.Value,
                    IsNewMessage = false,
                    UpdatedAt = DateTime.Now
                })
                .ToList();

            if (ShowComposePanel &&
                (!string.IsNullOrWhiteSpace(ComposeToNumber) ||
                 !string.IsNullOrWhiteSpace(ComposeRecipientInput) ||
                 !string.IsNullOrEmpty(ComposeBody)))
            {
                drafts.Add(new AppSettingsService.MessageDraft
                {
                    PhoneNumber = ComposeToNumber,
                    RecipientInput = ComposeRecipientInput,
                    Body = ComposeBody,
                    IsNewMessage = true,
                    UpdatedAt = DateTime.Now
                });
            }

            _settings.Current.MessageDrafts = drafts;
            _settings.Save();
        }
        catch
        {
            // Draft persistence must never block typing or shutdown.
        }
    }

    // ── Copied toast ──────────────────────────────────────────────────────
    private string _copiedToast = "";
    public string CopiedToast
    {
        get => _copiedToast;
        private set { _copiedToast = value; OnPropertyChanged(); }
    }

    public void CopyBubble(SmsMessage? msg)
    {
        if (msg == null || string.IsNullOrEmpty(msg.Body)) return;
        System.Windows.Clipboard.SetText(msg.Body);
        CloseBubbleActions();
        CopiedToast = "✓ Copied";
        var t = new System.Windows.Threading.DispatcherTimer
            { Interval = TimeSpan.FromSeconds(1.5) };
        t.Tick += (_, _) => { CopiedToast = ""; t.Stop(); };
        t.Start();
    }

    public void ForwardBubble(SmsMessage? msg)
    {
        if (msg == null) return;
        CloseBubbleActions();
        ComposeToNumber = "";
        ComposeRecipientInput = "";
        ComposeBody     = msg.Body;
        ShowComposePanel = true;
    }

    // ── Message notification target ───────────────────────────────────────
    private readonly DispatcherTimer _messageBannerTimer = new() { Interval = TimeSpan.FromSeconds(18) };
    private bool _showMessageBanner;
    private string _messageBannerTitle = "";
    private string _messageBannerBody = "";
    private string _messageBannerPhoneNumber = "";

    public bool ShowMessageBanner
    {
        get => _showMessageBanner;
        private set { _showMessageBanner = value; OnPropertyChanged(); }
    }

    public string MessageBannerTitle
    {
        get => _messageBannerTitle;
        private set { _messageBannerTitle = value; OnPropertyChanged(); }
    }

    public string MessageBannerBody
    {
        get => _messageBannerBody;
        private set { _messageBannerBody = value; OnPropertyChanged(); }
    }

    public string MessageBannerPhoneNumber => _messageBannerPhoneNumber;

    public void ShowIncomingMessageBanner(SmsMessage? message)
    {
        if (message == null ||
            string.IsNullOrWhiteSpace(message.NormalizedPhone) ||
            !ShouldSurfaceConversationAlert(message.NormalizedPhone))
            return;

        _messageBannerPhoneNumber = message.NormalizedPhone;
        OnPropertyChanged(nameof(MessageBannerPhoneNumber));
        MessageBannerTitle = "";
        MessageBannerBody = "";
        ShowMessageBanner = false;
    }

    public void DismissMessageBanner(bool clearTarget = true)
    {
        _messageBannerTimer.Stop();
        ShowMessageBanner = false;

        if (!clearTarget)
            return;

        _messageBannerPhoneNumber = "";
        OnPropertyChanged(nameof(MessageBannerPhoneNumber));
        MessageBannerTitle = "";
        MessageBannerBody = "";
    }

    // ── Commands ──────────────────────────────────────────────────────────
    public ICommand ScanCommand                 { get; }
    public ICommand ConnectCommand              { get; }
    public ICommand ReconnectCommand            { get; }   // quick-connect to most-recent device
    public ICommand ConnectToSavedDeviceCommand { get; }   // connect to a specific saved device
    public ICommand SetDefaultSavedDeviceCommand { get; }  // choose the phone used by auto-connect
    public ICommand DismissReconnectCommand     { get; }   // hide the startup prompt
    public ICommand AnswerCommand               { get; }
    public ICommand HangUpCommand               { get; }
    public ICommand MuteMicCommand              { get; }
    public ICommand DialCommand                 { get; }
    public ICommand DialVoicemailCommand        { get; }
    public ICommand DialPadCommand              { get; }
    public ICommand RefreshMessagesCommand      { get; }
    public ICommand OpenBtSettingsCommand       { get; }
    public ICommand SendMessageCommand          { get; }
    public ICommand AddComposeAttachmentCommand { get; }
    public ICommand RemoveComposeAttachmentCommand { get; }
    public ICommand OpenSoundSettingsCommand    { get; }
    public ICommand OpenShamashUiCommand        { get; }   // web UI in embedded shell
    public ICommand OpenAudioConsoleCommand     { get; }   // /audio-bridge in embedded shell

    /// <summary>Hosts a loopback page in the embedded WebView2 shell; falls back
    /// to the default browser when the WebView2 runtime is unavailable.</summary>
    private void OpenWebShell(string url)
    {
        try { new WebShellWindow(url).Show(); }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[web-shell] {ex.Message}");
            OpenInDefaultBrowser(url);
        }
    }

    private static void OpenInDefaultBrowser(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
    }
    public ICommand ForgetDeviceCommand         { get; }   // remove a device from saved list
    public ICommand SwitchTabCommand            { get; }
    public ICommand SaveImageCommand            { get; }   // save MMS photo to Downloads
    public ICommand SaveAttachmentCommand       { get; }
    public ICommand CopyMessageCommand          { get; }   // copy text to clipboard
    public ICommand DeleteMessageCommand        { get; }   // delete message from store
    public ICommand UndoLastDeletedMessageCommand { get; }
    public ICommand RetryMessageCommand         { get; }   // retry failed outgoing text
    public ICommand ImportPendingContactsCommand { get; }
    public ICommand SkipPendingContactsCommand   { get; }
    public ICommand OpenContactSyncFolderCommand { get; }
    public ICommand ImportStarterVcfCommand      { get; }
    public ICommand ExportMessagesBackupCommand  { get; }
    public ICommand PickComposeContactCommand    { get; }
    public ICommand PickCallContactCommand       { get; }
    public ICommand DialContactCommand           { get; }
    public ICommand SaveAsContactCommand         { get; }
    public ICommand NewContactCommand            { get; }
    public ICommand EditContactCommand           { get; }
    public ICommand SaveContactCommand           { get; }
    public ICommand DeleteContactCommand         { get; }
    public ICommand DeleteCallRecordCommand      { get; }
    public ICommand DeleteAllCallHistoryCommand  { get; }
    public ICommand UndoCallHistoryDeleteCommand  { get; }
    public ICommand ToggleCallRecordBlockedCommand { get; }
    public ICommand MarkConversationReadCommand  { get; }
    public ICommand MarkConversationUnreadCommand { get; }
    public ICommand ToggleConversationPinnedCommand { get; }
    public ICommand ToggleConversationAlertsMutedCommand { get; }
    public ICommand ToggleConversationBlockedCommand { get; }
    public ICommand ToggleConversationSortCommand { get; }
    public ICommand SetConversationFilterCommand { get; }
    public ICommand ConversationSearchNextCommand { get; }
    public ICommand ConversationSearchPreviousCommand { get; }
    public ICommand ClearConversationSearchCommand { get; }
    public ICommand SetCallHistoryFilterCommand { get; }
    public ICommand AcceptBuildUpdateCommand     { get; }
    public ICommand SnoozeBuildUpdateCommand     { get; }
    public ICommand ShowBuildUpdatePromptCommand { get; }
    public ICommand CloseMessagesListPaneCommand { get; }
    public ICommand OpenMessagesListPaneCommand  { get; }
    public ICommand CloseConversationCallsPaneCommand { get; }
    public ICommand OpenConversationCallsPaneCommand  { get; }
    public ICommand ToggleConversationDialerPaneCommand { get; }
    public ICommand CloseConversationDialerPaneCommand { get; }
    public ICommand CloseRecentCallsPaneCommand  { get; }
    public ICommand OpenRecentCallsPaneCommand   { get; }
    public ICommand CloseDialerPaneCommand       { get; }
    public ICommand OpenDialerPaneCommand        { get; }
    public ICommand ConnectQuickDeviceCommand    { get; }
    public ICommand ToggleNavigationRailCommand  { get; }
    public ICommand OpenBuildsFolderCommand      { get; }
    public ICommand RefreshThemeSyncCommand      { get; }

    // ── Constructor ───────────────────────────────────────────────────────
    public MainViewModel()
    {
        ThemeService.Apply(_settings.Current.PreferredPalette);
        _uiScaleDraftPercent = _settings.GetUiScalePercent();

        // Load persisted conversation sort mode
        if (Enum.TryParse<ConversationSortMode>(_settings.Current.ConversationSortMode, out var savedSort))
            _convSortMode = savedSort;

        // Initialise log file
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(LogFilePath)!);
            File.WriteAllText(LogFilePath,
                $"=== DeskPhone started {DateTime.Now:yyyy-MM-dd HH:mm:ss} ==={Environment.NewLine}");
        }
        catch { }

        // Backup service
        _backup.LogLine += s => AppendDebugThreadSafe(s);
        _backup.IsPaused = _settings.Current.PauseHistoryActivity;

        // Start MAP Push Notification Server
        _mns.NewMessage += (handle, folder) => RequestMessageSync($"MNS new message handle={handle}", handle);
        _mns.LogLine    += s => Dispatch(() => AppendDebug(s));
        _pbap.LogLine   += s => Dispatch(() => AppendDebug(s));
        _mns.Start();

        LoadChangelog();
        _messageBannerTimer.Tick += (_, _) => DismissMessageBanner(clearTarget: false);
        _draftPersistTimer.Tick += (_, _) =>
        {
            _draftPersistTimer.Stop();
            PersistDraftSnapshot();
        };

        // ── Call audio routing observer ──────────────────────────────────────
        // Watches the Windows default communications playback device and updates
        // the CallAudioRoute* properties so the UI can show whether call audio
        // will play on the phone speaker or through an attached speakerphone.
        _audioRoute.RouteChanged += snap => Dispatch(() =>
        {
            CallAudioRouteDeviceName = snap.DeviceName;
            IsCallAudioRouteExternal = snap.IsExternalSpeakerphone;
            CallAudioRouteSummary    = snap.Summary;
        });
        _audioRoute.Start();

        // ── Control API (localhost:8765) ──────────────────────────────────
        _api.GetStatus = () =>
        {
            SmsMessage? lastMessage;
            int messageCount;
            int conversationCount = 0;
            List<CallRecord> recentCalls = new();
            List<object> knownDevices = new();
            List<object> scannedDevices = new();
            string selectedDeviceAddress = "";
            lock (_msgLock)
            {
                messageCount = _allMessages.Count;
                lastMessage = _allMessages
                    .OrderByDescending(m => m.Timestamp)
                    .FirstOrDefault();
            }
            Dispatch(() =>
            {
                conversationCount = Conversations.Count;
                recentCalls = CallHistory
                    .OrderByDescending(c => c.Time)
                    .Take(8)
                    .Select(CloneCallRecord)
                    .ToList();
                knownDevices = KnownDevices.Select(d => new
                {
                    address = d.Address,
                    name = d.Name,
                    isDefault = d.IsDefault,
                    lastSeen = d.LastSeen
                }).Cast<object>().ToList();
                scannedDevices = Devices.Select(d => new
                {
                    address = d.Address.ToString(),
                    name = d.Name,
                    isPaired = d.IsPaired
                }).Cast<object>().ToList();
                selectedDeviceAddress = SelectedDevice?.Address.ToString() ?? "";
            });

            var currentCall = CurrentCall;
            return System.Text.Json.JsonSerializer.Serialize(new
            {
                hostConnector   = "DeskPhone Windows Host",
                hostPlatform    = "windows",
                hostControlContract = "deskphone-host-control/v1",
                hostScope       = "loopback",
                phoneTransport  = new
                {
                    calls    = "HFP",
                    messages = "MAP",
                    contacts = "PBAP"
                },
                connected        = IsFullyConnected,
                hfp              = StatusHfp,
                map              = StatusMap,
                callState        = currentCall.Status.ToString(),
                callNumber       = currentCall.Number ?? "",
                isRinging        = currentCall.Status == CallStatus.IncomingRinging,
                isCallActive     = currentCall.Status is CallStatus.Active or CallStatus.Dialing,
                isMuted          = IsMuted,
                conversationCount,
                messageCount,
                lastMessage      = lastMessage != null
                    ? new { from = lastMessage.IsSent ? "Me" : lastMessage.From, preview = lastMessage.PreviewBody }
                    : null as object,
                recentCalls      = recentCalls.Select(MapCallRecordForApi),
                isSendingMessage = IsSendingMessage,
                showReconnectPrompt = ShowReconnectPrompt,
                syncThemeWithShamash = SyncThemeWithShamash,
                pauseHistoryActivity = PauseHistoryActivity,
                isDarkModeEnabled = IsDarkModeEnabled,
                themeSyncLabel = ThemeSyncLabel,
                themeSyncRefreshStatus = ThemeSyncRefreshStatus,
                showBuildUpdatePrompt = ShowBuildUpdatePrompt,
                showBuildUpdateIndicator = ShowBuildUpdateIndicator,
                pendingBuildVersion = PendingBuildVersion,
                pendingBuildTitle = BuildUpdateTitle,
                pendingBuildBody = BuildUpdateBody,
                hasUndoMessageDelete = HasUndoMessageDelete,
                undoMessageDeleteText = UndoMessageDeleteText,
                hasUndoCallHistoryDelete = HasUndoCallHistoryDelete,
                undoCallHistoryDeleteText = UndoCallHistoryDeleteText,
                bluetoothStatus = StatusBt,
                isScanning = IsScanning,
                isConnecting = IsConnecting,
                selectedDeviceAddress,
                knownDevices,
                scannedDevices,
                appVisible       = true,
                build            = BuildStamp
            });
        };
        _api.GetMessages = (limit, includeAttachmentData) =>
        {
            List<SmsMessage> snapshot;
            lock (_msgLock)
                snapshot = _allMessages
                    .Where(MessageBelongsToActiveDevice)
                    .OrderByDescending(m => m.Timestamp)
                    .Take(Math.Clamp(limit, 50, 5000))
                    .ToList();

            return System.Text.Json.JsonSerializer.Serialize(snapshot.Select(m => new
            {
                id        = m.LocalId ?? m.Handle,
                handle    = m.Handle,
                from      = m.IsSent ? "Me" : m.From,
                to        = m.IsSent ? m.NormalizedPhone : "",
                number    = m.NormalizedPhone,
                body      = m.Body,
                preview   = m.PreviewBody,
                timestamp = m.Timestamp,
                isSent    = m.IsSent,
                isRead    = m.IsRead,
                isPinned  = m.IsPinned,
                pinActionLabel = m.PinActionLabel,
                sendStatus = m.SendStatus,
                sendStatusLabel = m.SendStatusLabel,
                outgoingStatusLabel = m.OutgoingStatusLabel,
                outgoingStatusIcon = m.OutgoingStatusIcon,
                sourceDeviceAddress = m.SourceDeviceAddress,
                isMms     = m.IsMms,
                attachments = m.Attachments.Select(a => new
                {
                    fileName = a.DisplayName,
                    contentType = a.ContentType,
                    isImage = a.IsImage,
                    isContactCard = a.IsContactCard,
                    size = a.Data.Length,
                    // Stable id so the relay path can deliver the image out-of-band
                    // (uploaded to phone-media/{mediaId}); the webapp fetches it by id
                    // when dataUrl is absent (relay) and uses dataUrl inline on LAN.
                    mediaId = a.IsImage && a.Data.Length > 0 ? MediaId(a.Data) : null,
                    dataUrl = includeAttachmentData && a.IsImage && a.Data.Length > 0
                        ? $"data:{a.ContentType};base64,{Convert.ToBase64String(a.Data)}"
                        : null
                })
            }));
        };
        _api.GetCalls = () =>
        {
            var snapshot = GetCallHistorySnapshotForApi(1000);
            return System.Text.Json.JsonSerializer.Serialize(snapshot.Select(MapCallRecordForApi));
        };
        _api.GetContacts = () =>
        {
            var snapshot = GetContactsSnapshot();
            return System.Text.Json.JsonSerializer.Serialize(snapshot.Select(c => new
            {
                id = $"{c.SourceDeviceAddress}|{c.DisplayName}|{c.PrimaryPhone}",
                displayName = c.DisplayName,
                phoneNumbers = c.PhoneNumbers
                    .Select(ContactStoreService.NormalizePhone)
                    .Where(p => !string.IsNullOrWhiteSpace(p))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList(),
                primaryPhone = ContactStoreService.NormalizePhone(c.PrimaryPhone),
                sourceDeviceAddress = c.SourceDeviceAddress,
                sourceFileName = c.SourceFileName,
                importedAt = c.ImportedAt
            }));
        };
        _api.Connect = () => { Dispatch(() => _ = ReconnectToMostRecentAsync()); return Task.CompletedTask; };
        _api.Answer  = () => { Dispatch(() => _ = AnswerAsync()); return Task.CompletedTask; };
        _api.HangUp  = () => { Dispatch(() => _ = HangUpAsync()); return Task.CompletedTask; };
        _api.Refresh = () => { Dispatch(() => _ = RefreshMessagesAsync(forceDeleteReconcile: true)); return Task.CompletedTask; };
        _api.RefreshAudio = () => { Dispatch(RefreshAudio); return Task.CompletedTask; };
        _api.OpenBluetoothSettings = () => { Process.Start("control.exe", "/name Microsoft.DevicesAndPrinters"); return Task.CompletedTask; };
        _api.OpenSoundSettings = () => { Process.Start("mmsys.cpl"); return Task.CompletedTask; };
        _api.OpenBuildsFolder = () => { OpenBuildsFolder(); return Task.CompletedTask; };
        _api.OpenEventLog = () => { OpenEventLog(); return Task.CompletedTask; };
        _api.OpenContactSyncFolder = () => { Dispatch(OpenContactSyncFolder); return Task.CompletedTask; };
        _api.ExportMessagesBackup = () => { Dispatch(() => _ = ExportMessagesBackupAsync()); return Task.CompletedTask; };
        _api.ResetUiScale = () => { Dispatch(ResetUiScale); return Task.CompletedTask; };
        _api.RefreshThemeSync = () => { Dispatch(RefreshThemeSync); return Task.CompletedTask; };
        _api.ImportStarterVcf = () => { Dispatch(() => _ = ImportStarterVcfAsync()); return Task.CompletedTask; };
        _api.ImportPendingContacts = () => { Dispatch(() => _ = ImportPendingContactsAsync()); return Task.CompletedTask; };
        _api.SkipPendingContacts = () => { Dispatch(SkipPendingContacts); return Task.CompletedTask; };
        _api.SetSyncThemeWithShamash = enabled => { Dispatch(() => SyncThemeWithShamash = enabled); return Task.CompletedTask; };
        _api.SetPauseHistoryActivity = paused => { Dispatch(() => PauseHistoryActivity = paused); return Task.CompletedTask; };
        _api.SetDarkModeEnabled = enabled => { Dispatch(() => IsDarkModeEnabled = enabled); return Task.CompletedTask; };
        _api.OpenLiveLog = () => { Dispatch(() => ShowLiveLog = true); return Task.CompletedTask; };
        _api.OpenWebUi = () => { Dispatch(() => OpenInDefaultBrowser("https://onetaskfocuser.netlify.app/?suite=phone")); return Task.CompletedTask; };
        _api.OpenAudioConsole = () => { Dispatch(() => OpenWebShell("http://127.0.0.1:8765/audio-bridge")); return Task.CompletedTask; };
        _api.ClearLog = () => { Dispatch(ClearDebugLog); return Task.CompletedTask; };
        _api.RunUiAuditor = () => { RunUiAuditor(); return Task.CompletedTask; };
        _api.ToggleMute = () => { Dispatch(() => MuteMicCommand.Execute(null)); return Task.CompletedTask; };
        _api.AcceptBuildUpdate = () => { Dispatch(() => _ = AcceptBuildUpdateAsync()); return Task.CompletedTask; };
        _api.SnoozeBuildUpdate = () => { Dispatch(SnoozeBuildUpdate); return Task.CompletedTask; };
        _api.ShowBuildUpdatePrompt = () => { Dispatch(ShowPendingBuildUpdatePrompt); return Task.CompletedTask; };
        _api.ToggleMessagePin = id => { Dispatch(() => ToggleMessagePinned(FindMessageForWebId(id))); return Task.CompletedTask; };
        _api.DeleteMessage = id => { Dispatch(() => _ = DeleteMessageAsync(FindMessageForWebId(id))); return Task.CompletedTask; };
        _api.UndoMessageDelete = () => { Dispatch(() => _ = UndoLastDeletedMessageAsync()); return Task.CompletedTask; };
        _api.ScanDevices = () => { Task task = Task.CompletedTask; Dispatch(() => task = ScanAsync()); return task; };
        _api.ConnectSavedDevice = address => { Task task = Task.CompletedTask; Dispatch(() => task = ConnectToAddressAsync(address)); return task; };
        _api.SetDefaultSavedDevice = address => { Dispatch(() => { _settings.SetDefaultDevice(address); RefreshKnownDevices(); }); return Task.CompletedTask; };
        _api.ForgetSavedDevice = address => { Dispatch(() => { _settings.ForgetDevice(address); RefreshKnownDevices(); }); return Task.CompletedTask; };
        _api.ConnectScannedDevice = address => { Task task = Task.CompletedTask; Dispatch(() => task = ConnectScannedDeviceAsync(address)); return task; };
        _api.SaveContact = (id, name, phone) => { Dispatch(() => SaveContactFromWeb(id, name, phone)); return Task.CompletedTask; };
        _api.DeleteContact = (id, phone) => { Dispatch(() => DeleteContactFromWeb(id, phone)); return Task.CompletedTask; };
        _api.MarkConversationRead = phone => { Dispatch(() => MarkConversationReadFromWeb(phone)); return Task.CompletedTask; };
        _api.MarkConversationUnread = phone => { Dispatch(() => MarkConversationUnreadFromWeb(phone)); return Task.CompletedTask; };
        _api.ToggleConversationPin = phone => { Dispatch(() => ToggleConversationPinnedFromWeb(phone)); return Task.CompletedTask; };
        _api.ToggleConversationMute = phone => { Dispatch(() => ToggleConversationAlertsMutedFromWeb(phone)); return Task.CompletedTask; };
        _api.ToggleConversationBlock = phone => { Dispatch(() => ToggleConversationBlockedFromWeb(phone)); return Task.CompletedTask; };
        _api.ToggleCallBlock = phone => { Dispatch(() => ToggleCallNumberBlockedFromWeb(phone)); return Task.CompletedTask; };
        _api.DeleteCallEntry = id => { Dispatch(() => DeleteCallRecordFromWeb(id)); return Task.CompletedTask; };
        _api.DeleteAllCallHistory = () => { Dispatch(DeleteAllCallHistoryFromWeb); return Task.CompletedTask; };
        _api.UndoCallHistoryDelete = () => { Dispatch(UndoCallHistoryDelete); return Task.CompletedTask; };
        _api.Dial    = number =>
        {
            Dispatch(() =>
            {
                DialNumber = number;
                _ = DialAsync();
            });
            return Task.CompletedTask;
        };
        _api.Send = (to, body) =>
        {
            // Marshal to the UI thread but return the REAL send outcome (not an
            // optimistic true) so LAN/relay callers can see and log failures.
            var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            Dispatch(async () =>
            {
                try
                {
                    ComposeToNumber = to;
                    ComposeRecipientInput = to;
                    ComposeBody = body;
                    tcs.TrySetResult(await SendMessageAsync());
                }
                catch (Exception ex) { tcs.TrySetException(ex); }
            });
            return tcs.Task;
        };
        _api.SendWithAttachments = (to, body, attachments) =>
        {
            var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            Dispatch(async () =>
            {
                try
                {
                    ComposeToNumber = to;
                    ComposeRecipientInput = to;
                    ComposeBody = body;
                    ClearComposeAttachments();
                    foreach (var attachment in attachments)
                    {
                        ComposeAttachments.Add(new MessageAttachment
                        {
                            ContentType = attachment.ContentType,
                            FileName = attachment.FileName,
                            Data = attachment.Data.ToArray()
                        });
                    }
                    NotifyComposeAttachmentsChanged();
                    tcs.TrySetResult(await SendMessageAsync());
                }
                catch (Exception ex) { tcs.TrySetException(ex); }
            });
            return tcs.Task;
        };
        _api.Shutdown = () => Dispatch(Shutdown);
        _api.LogLine = s => AppendDebugThreadSafe(s);
        _api.OfferBuildUpdate = (exePath, buildVersion) => OfferBuildUpdateAsync(exePath, buildVersion);
        _api.ShowApp = () =>
        {
            var ok = false;
            Dispatch(() =>
            {
                if (Application.Current.MainWindow is DeskPhone.MainWindow window)
                    ok = window.BringToFront();
            });
            return Task.FromResult(ok);
        };
        _api.Handoff = (target, value) =>
        {
            var ok = false;
            Dispatch(() =>
            {
                if (Application.Current.MainWindow is DeskPhone.MainWindow window)
                    ok = window.OpenHandoffTarget(target, value);
            });
            return Task.FromResult(ok);
        };
        _api.SetStageBounds = (x, y, width, height, showChrome, token) =>
        {
            Dispatch(() =>
            {
                if (Application.Current.MainWindow is DeskPhone.MainWindow window)
                    window.SetStageBounds(x, y, width, height, showChrome, token);
            });
            return Task.FromResult(true);
        };
        _api.PulseStage = token =>
        {
            var ok = true;
            Dispatch(() =>
            {
                if (Application.Current.MainWindow is DeskPhone.MainWindow window)
                    ok = window.PulseStage(token);
            });
            return Task.FromResult(ok);
        };
        _api.ExitStage = (token, force) =>
        {
            var ok = true;
            Dispatch(() =>
            {
                if (Application.Current.MainWindow is DeskPhone.MainWindow window)
                    ok = window.ExitStageMode(token, force);
            });
            return Task.FromResult(ok);
        };
        _api.ApplyTheme = (palette, colors) =>
        {
            Dispatch(() =>
            {
                if (!_settings.Current.SyncThemeWithShamash) return;
                var mapped = MapCommandCenterPalette(palette);
                if (mapped == null) return;
                ThemeService.ApplyPalette(mapped);
                ThemeService.ApplyBridgeColors(colors);
                _settings.Current.PreferredPalette = mapped;
                _settings.Current.DarkModeEnabled = string.Equals(mapped, "BlueGold", StringComparison.OrdinalIgnoreCase);
                _settings.Save();
                OnPropertyChanged(nameof(IsDarkModeEnabled));
                OnPropertyChanged(nameof(ThemeModeLabel));
            });
            return Task.FromResult(true);
        };
        _api.Start();
        AppendDebug($"[API] {_api.StartupResult}");

        // ── Cloud relay (same data sources as the local API) ──────────────
        _relay.GetStatus   = _api.GetStatus;
        _relay.GetMessages = _api.GetMessages;
        _relay.GetCalls    = _api.GetCalls;
        _relay.GetContacts = _api.GetContacts;
        _relay.Dial        = _api.Dial;
        _relay.HangUp      = _api.HangUp;
        _relay.Answer      = _api.Answer;
        _relay.ToggleMute  = _api.ToggleMute;
        _relay.Send        = _api.Send;
        _relay.Refresh     = _api.Refresh;
        _relay.MarkRead    = _api.MarkConversationRead;
        _relay.MarkUnread  = _api.MarkConversationUnread;
        _relay.LogLine     = s => AppendDebugThreadSafe(s);
        _relay.GetLanUrl   = () => _api.LanUrl ?? "";
        _relay.GetRelayMedia = BuildRelayMedia;
        _relay.Configure(_settings.Current.RelayKey, _settings.Current.RelayUrl);
        _api.GetRelayStatus = () =>
        {
            var key   = _settings.Current.RelayKey;
            var url   = string.IsNullOrWhiteSpace(_settings.Current.RelayUrl)
                        ? "https://onetaskfocuser.netlify.app/.netlify/functions/phone-relay"
                        : _settings.Current.RelayUrl;
            return $"{{\"enabled\":{(_relay.IsEnabled ? "true" : "false")},\"key\":\"{key}\",\"relayUrl\":\"{url}\"}}";
        };
        _relay.Start();
        if (_relay.IsEnabled)
            AppendDebug($"[RELAY] Active — remote browsers can now reach the phone");
        else
            AppendDebug("[RELAY] No relay key set — add one in Settings → Connection to enable remote access");

        // ── Initialize Commands ──────────────────────────────────────────
        ScanCommand          = new RelayCommand(_ => _ = ScanAsync());
        ConnectCommand       = new RelayCommand(_ => _ = ConnectAsync());
        ReconnectCommand     = new RelayCommand(_ => _ = ReconnectToMostRecentAsync());
        ConnectToSavedDeviceCommand = new RelayCommand(addr => { if (addr is string a) _ = ConnectToAddressAsync(a); });
        SetDefaultSavedDeviceCommand = new RelayCommand(addr =>
        {
            if (addr is string a)
            {
                _settings.SetDefaultDevice(a);
                RefreshKnownDevices();
            }
        });
        DismissReconnectCommand     = new RelayCommand(_ => ShowReconnectPrompt = false);

        AnswerCommand        = new RelayCommand(_ => _ = AnswerAsync());
        HangUpCommand        = new RelayCommand(_ => _ = HangUpAsync());
        MuteMicCommand       = new RelayCommand(_ => { IsMuted = !IsMuted; if (_hfp != null) _ = _hfp.ToggleMuteAsync(IsMuted); });

        DialCommand          = new RelayCommand(_ => _ = DialAsync());
        DialVoicemailCommand = new RelayCommand(_ => _ = DialVoicemailAsync());
        DialPadCommand       = new RelayCommand(p => DialNumber += p as string);

        RefreshMessagesCommand = new RelayCommand(_ => _ = RefreshMessagesAsync(forceDeleteReconcile: true));
        OpenBtSettingsCommand  = new RelayCommand(_ => Process.Start("control.exe", "/name Microsoft.DevicesAndPrinters"));
        SendMessageCommand     = new RelayCommand(_ => _ = SendMessageAsync());
        AddComposeAttachmentCommand = new RelayCommand(_ => AddComposeAttachments());
        RemoveComposeAttachmentCommand = new RelayCommand(a => RemoveComposeAttachment(a as MessageAttachment));
        OpenSoundSettingsCommand = new RelayCommand(_ => Process.Start("mmsys.cpl"));
        // The Shamash UI opens in the DEFAULT BROWSER, not the embedded shell:
        // the user's signed-in session (Firebase) lives in their browser profile,
        // and the production app reaches this host directly via loopback.
        OpenShamashUiCommand     = new RelayCommand(_ => OpenInDefaultBrowser("https://onetaskfocuser.netlify.app/?suite=phone"));
        OpenAudioConsoleCommand  = new RelayCommand(_ => OpenWebShell("http://127.0.0.1:8765/audio-bridge"));
        ForgetDeviceCommand    = new RelayCommand(addr => { if (addr is string a) { _settings.ForgetDevice(a); RefreshKnownDevices(); } });
        SwitchTabCommand       = new RelayCommand(t => { if (t is string s && Enum.TryParse<AppTab>(s, out var tab)) SelectedTab = tab; });
        SaveImageCommand       = new RelayCommand(m => _ = SaveImageToDownloadsAsync(m as SmsMessage));
        SaveAttachmentCommand  = new RelayCommand(a => _ = SaveAttachmentToDownloadsAsync(a as MessageAttachment));
        CopyMessageCommand     = new RelayCommand(m => System.Windows.Clipboard.SetText((m as SmsMessage)?.Body ?? ""));
        DeleteMessageCommand   = new RelayCommand(m => _ = DeleteMessageAsync(m as SmsMessage));
        UndoLastDeletedMessageCommand = new RelayCommand(_ => _ = UndoLastDeletedMessageAsync());
        RetryMessageCommand    = new RelayCommand(m => _ = RetryMessageAsync(m as SmsMessage));
        ImportPendingContactsCommand = new RelayCommand(_ => _ = ImportPendingContactsAsync());
        SkipPendingContactsCommand   = new RelayCommand(_ => SkipPendingContacts());
        OpenContactSyncFolderCommand = new RelayCommand(_ => OpenContactSyncFolder());
        ImportStarterVcfCommand      = new RelayCommand(_ => _ = ImportStarterVcfAsync());
        ExportMessagesBackupCommand  = new RelayCommand(_ => _ = ExportMessagesBackupAsync());
        PickComposeContactCommand    = new RelayCommand(c => PickComposeContact(c as ContactOption));
        PickCallContactCommand       = new RelayCommand(c => PickCallContact(c as ContactOption));
        DialContactCommand           = new RelayCommand(c => _ = DialContactAsync(c as ContactOption));
        SaveAsContactCommand         = new RelayCommand(n => SaveAsContact(n as string));
        ToggleNavigationRailCommand  = new RelayCommand(_ => ToggleNavigationRail());
        OpenBuildsFolderCommand      = new RelayCommand(_ => OpenBuildsFolder());
        RefreshThemeSyncCommand      = new RelayCommand(_ => RefreshThemeSync());
        NewContactCommand            = new RelayCommand(_ => BeginNewContact(openEditor: true));
        EditContactCommand           = new RelayCommand(c => BeginEditContact(c as ContactEntry ?? SelectedEditableContact, openEditor: true));
        SaveContactCommand           = new RelayCommand(_ => SaveContactEdit());
        DeleteContactCommand         = new RelayCommand(_ => DeleteSelectedContact(), _ => CanDeleteSelectedContact);
        DeleteCallRecordCommand      = new RelayCommand(record => DeleteCallRecord(record as CallRecord));
        DeleteAllCallHistoryCommand  = new RelayCommand(_ => DeleteAllCallHistory(), _ => CallHistory.Count > 0);
        UndoCallHistoryDeleteCommand = new RelayCommand(_ => UndoCallHistoryDelete());
        ToggleCallRecordBlockedCommand = new RelayCommand(record => ToggleCallRecordBlocked(record as CallRecord ?? SelectedCallRecord));
        MarkConversationReadCommand  = new RelayCommand(c => { var conv = ResolveConversation(c); if (conv != null) MarkConversationRead(conv); });
        MarkConversationUnreadCommand = new RelayCommand(c => { var conv = ResolveConversation(c); if (conv != null) MarkConversationUnread(conv); });
        ToggleConversationPinnedCommand = new RelayCommand(c => ToggleConversationPinned(ResolveConversation(c)));
        ToggleConversationAlertsMutedCommand = new RelayCommand(c => ToggleConversationAlertsMuted(ResolveConversation(c)));
        ToggleConversationBlockedCommand = new RelayCommand(c => ToggleConversationBlocked(ResolveConversation(c)));
        ToggleConversationSortCommand = new RelayCommand(_ =>
            ConvSortMode = ConvSortMode == ConversationSortMode.UnreadFirst
                ? ConversationSortMode.Chronological
                : ConversationSortMode.UnreadFirst);
        SetConversationFilterCommand = new RelayCommand(filter =>
        {
            if (filter is string s && Enum.TryParse<ConversationFilter>(s, out var parsed))
                ActiveConversationFilter = parsed;
        });
        ConversationSearchNextCommand = new RelayCommand(_ => MoveConversationSearch(1), _ => HasConversationSearchResults);
        ConversationSearchPreviousCommand = new RelayCommand(_ => MoveConversationSearch(-1), _ => HasConversationSearchResults);
        ClearConversationSearchCommand = new RelayCommand(_ => ClearConversationSearch(), _ => HasConversationSearchQuery);
        SetCallHistoryFilterCommand = new RelayCommand(filter =>
        {
            if (filter is string s && Enum.TryParse<CallHistoryFilter>(s, out var parsed))
                ActiveCallHistoryFilter = parsed;
        });
        AcceptBuildUpdateCommand     = new RelayCommand(_ => _ = AcceptBuildUpdateAsync());
        SnoozeBuildUpdateCommand     = new RelayCommand(_ => SnoozeBuildUpdate());
        ShowBuildUpdatePromptCommand = new RelayCommand(_ => ShowPendingBuildUpdatePrompt());
        CloseMessagesListPaneCommand = new RelayCommand(_ => ShowMessagesListPane = false);
        OpenMessagesListPaneCommand  = new RelayCommand(_ => ShowMessagesListPane = true);
        CloseConversationCallsPaneCommand = new RelayCommand(_ => ShowConversationCallHistoryPane = false);
        OpenConversationCallsPaneCommand  = new RelayCommand(_ => ShowConversationCallHistoryPane = true);
        ToggleConversationDialerPaneCommand = new RelayCommand(_ => ShowConversationDialerPane = !ShowConversationDialerPane);
        CloseConversationDialerPaneCommand = new RelayCommand(_ => ShowConversationDialerPane = false);
        CloseRecentCallsPaneCommand  = new RelayCommand(_ =>
        {
            if (!ShowDialerPane) return;
            ShowRecentCallsPane = false;
        });
        OpenRecentCallsPaneCommand   = new RelayCommand(_ => ShowRecentCallsPane = true);
        CloseDialerPaneCommand       = new RelayCommand(_ =>
        {
            if (!ShowRecentCallsPane) return;
            ShowDialerPane = false;
        });
        OpenDialerPaneCommand        = new RelayCommand(_ => ShowDialerPane = true);
        ConnectQuickDeviceCommand    = new RelayCommand(_ =>
        {
            var device = QuickConnectDevice;
            if (device != null)
                _ = ConnectToAddressAsync(device.Address, device.Name);
        }, _ => CanQuickReconnect);

        _notif.OnTrayDoubleClick += () => Dispatch(() =>
        {
            if (Application.Current.MainWindow is DeskPhone.MainWindow window &&
                window.OpenMessageBannerTarget(showCompose: false))
            {
                return;
            }

            Application.Current.MainWindow?.Show();
            if (Application.Current.MainWindow != null)
            {
                Application.Current.MainWindow.WindowState = WindowState.Normal;
                Application.Current.MainWindow.Activate();
            }
        });
        // Balloon tip click is now only used for CALL notifications (incoming/missed).
        // Message notifications use Windows Toast and are handled by HandleToastActivation.
        // Clicking a call balloon → open DeskPhone to handle the call.
        _notif.OnBalloonTipClicked += () => Dispatch(() =>
        {
            Application.Current.MainWindow?.Show();
            if (Application.Current.MainWindow != null)
            {
                Application.Current.MainWindow.WindowState = WindowState.Normal;
                Application.Current.MainWindow.Activate();
            }
        });

        // 1-second call timer
        var callTimer = new System.Windows.Threading.DispatcherTimer
        { Interval = TimeSpan.FromSeconds(1) };
        callTimer.Tick += (_, _) =>
        {
            if (CurrentCall.Status == CallStatus.Active)
                OnPropertyChanged(nameof(CallBannerText));
        };
        callTimer.Start();

        // Poll loop is started after connect — see StartPollLoop()

        // Surface MMS image-decode failures in the debug log so we can diagnose
        // "no images" issues without a debugger.
        Models.SmsMessage.ImageDecodeError += (handle, err) =>
            AppendDebugThreadSafe($"[IMG] Decode FAILED handle={handle}: {err}");

        // Load saved messages from disk, rebuild conversations, refresh devices,
        // then auto-connect to the most-recent saved device.
        _ = InitializeDataAsync();
    }

    private void LoadChangelog()
    {
        try
        {
            var path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "changelog.json");
            if (!File.Exists(path)) return;

            var json = File.ReadAllText(path);
            var entries = System.Text.Json.JsonSerializer.Deserialize<List<ChangelogEntry>>(json, new System.Text.Json.JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });

            if (entries != null)
            {
                Dispatch(() => {
                    Changelog.Clear();
                    foreach (var entry in entries) Changelog.Add(entry);
                });
            }
        }
        catch { /* ignored */ }
    }

    private async Task InitializeDataAsync()
    {
        lock (_contactLock)
        {
            _contacts = _contactStore.Load();
            RebuildContactLookupLocked();
        }
        ContactSyncStatus = $"Loaded {ContactCount} saved contacts";
        OnPropertyChanged(nameof(ContactCount));
        OnPropertyChanged(nameof(ContactCountText));
        RefreshAllContactCollections();
        BeginNewContact();
        RestoreDraftsFromSettings();

        // Load messages from disk and rebuild the conversation list
        _allMessages = _store.Load(out _pendingMmsHandles);
        AppendDebug($"[STORE] Loaded {_allMessages.Count} messages, {_pendingMmsHandles.Count} pending MMS re-fetch");
        AppendDebug($"[STORE] MMS with attachment: {_allMessages.Count(m => m.HasImageAttachment)}");
        Dispatch(() => RebuildConversations());

        // Refresh device/audio lists in the UI
        RefreshKnownDevices();
        RefreshAudioDevices();
        LoadPbapCallHistoryCache();

        var handoff = _settings.ConsumePendingBuildHandoffForCurrentProcess();
        if (handoff != null)
        {
            AppendDebug($"[STARTUP] Resuming build handoff into {handoff.BuildVersion}");
            await ExecutePendingBuildHandoffAsync(handoff);
            return;
        }

        // ── Auto-connect to most-recent saved device ─────────────────────
        // Runs immediately on startup so the user doesn't need to click Connect
        // after every build deploy or app restart.
        var recent = _settings.DefaultDevice;
        if (recent != null)
        {
            AppendDebug($"[STARTUP] Auto-connecting to {recent.Name} ({recent.Address})…");
            await ReconnectToMostRecentAsync();
        }

        // ── Persistent connection watchdog ────────────────────────────────
        // Started after the initial auto-connect attempt so it doesn't race it.
        // The watchdog uses _appCts (not _sessionCts) so it survives any number
        // of failed reconnect attempts — each attempt cancels _sessionCts and
        // kills the MAP poll loop, but the watchdog keeps firing every 30 s.
        StartConnectionWatchdog(_appCts.Token);
    }

    private Task<bool> OfferBuildUpdateAsync(string exePath, string buildVersion)
    {
        if (string.IsNullOrWhiteSpace(exePath) || !File.Exists(exePath))
            return Task.FromResult(false);

        PendingBuildPath = exePath;
        PendingBuildVersion = string.IsNullOrWhiteSpace(buildVersion) ? "new build" : buildVersion;

        Dispatch(() =>
        {
            ShowBuildUpdateIndicator = false;
            ShowBuildUpdatePrompt = true;
            try
            {
                var window = Application.Current?.MainWindow;
                if (window == null) return;
                window.Show();
                if (window.WindowState == WindowState.Minimized)
                    window.WindowState = WindowState.Normal;
                window.Activate();
                window.Topmost = true;
                window.Topmost = false;
            }
            catch { }
        });

        AppendDebug($"[DEPLOY] Offered {PendingBuildVersion} at {exePath}");
        return Task.FromResult(true);
    }

    private void SnoozeBuildUpdate()
    {
        if (string.IsNullOrWhiteSpace(PendingBuildPath))
            return;

        ShowBuildUpdatePrompt = false;
        ShowBuildUpdateIndicator = true;
    }

    private void ShowPendingBuildUpdatePrompt()
    {
        if (string.IsNullOrWhiteSpace(PendingBuildPath))
            return;

        ShowBuildUpdateIndicator = false;
        ShowBuildUpdatePrompt = true;
    }

    private async Task AcceptBuildUpdateAsync()
    {
        var pendingPath = PendingBuildPath;
        if (string.IsNullOrWhiteSpace(pendingPath) || !File.Exists(pendingPath))
        {
            AppendDebug("[DEPLOY] Pending build path is missing; cannot switch builds.");
            ShowBuildUpdatePrompt = false;
            ShowBuildUpdateIndicator = false;
            PendingBuildPath = "";
            PendingBuildVersion = "";
            return;
        }

        var handoffName = SelectedDevice?.Name
            ?? _settings.Current.KnownDevices.FirstOrDefault(d =>
                d.Address.Equals(_connectedDeviceAddress ?? "", StringComparison.OrdinalIgnoreCase))?.Name
            ?? _settings.MostRecentDevice?.Name
            ?? "";

        _settings.SavePendingBuildHandoff(
            pendingPath,
            PendingBuildVersion,
            _connectedDeviceAddress,
            handoffName);

        AppendDebug($"[DEPLOY] Switching to {PendingBuildVersion} and handing off connected device {_connectedDeviceAddress ?? "(none)"}");

        if (!LaunchDelayedProcess(pendingPath))
        {
            AppendDebug("[DEPLOY] Failed to launch the new build.");
            return;
        }

        ShowBuildUpdatePrompt = false;
        ShowBuildUpdateIndicator = false;
        PendingBuildPath = "";
        PendingBuildVersion = "";

        await Task.Delay(150);
        Dispatch(() =>
        {
            Shutdown();
            Application.Current?.Shutdown();
        });
    }

    private async Task ExecutePendingBuildHandoffAsync(AppSettingsService.PendingBuildHandoff handoff)
    {
        ShowBuildUpdatePrompt = false;
        ShowBuildUpdateIndicator = false;

        if (string.IsNullOrWhiteSpace(handoff.DeviceAddress))
        {
            AppendDebug("[STARTUP] Build handoff did not include an active device; starting normally.");
            return;
        }

        AppendDebug($"[STARTUP] Clean reconnect to {handoff.DeviceName} ({handoff.DeviceAddress}) requested by prior build");
        await ResetConnectionSessionAsync();
        await Task.Delay(700);
        await ConnectToAddressAsync(handoff.DeviceAddress, string.IsNullOrWhiteSpace(handoff.DeviceName) ? null : handoff.DeviceName);
    }

    private static bool LaunchDelayedProcess(string exePath)
    {
        try
        {
            var escaped = exePath.Replace("'", "''");
            Process.Start(new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-NoProfile -WindowStyle Hidden -Command \"Start-Sleep -Milliseconds 900; Start-Process -FilePath '{escaped}'\"",
                UseShellExecute = false,
                CreateNoWindow = true
            });
            return true;
        }
        catch
        {
            return false;
        }
    }

    private async Task SaveImageToDownloadsAsync(SmsMessage? msg)
    {
        var firstImage = msg?.ImageAttachments.FirstOrDefault();
        if (msg == null || firstImage == null || firstImage.Data.Length == 0) return;
        try
        {
            var downloads = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
            var fileName  = string.IsNullOrWhiteSpace(firstImage.DisplayName)
                ? $"MMS_{msg.Timestamp:yyyyMMdd_HHmmss}.jpg"
                : firstImage.DisplayName;
            var fullPath  = Path.Combine(downloads, fileName);
            await File.WriteAllBytesAsync(fullPath, firstImage.Data);
            AppendDebug($"[IMG] Saved: {fullPath}");
            Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{fullPath}\"") { UseShellExecute = true });
        }
        catch (Exception ex) { AppendDebug($"[IMG] Save failed: {ex.Message}"); }
    }

    private async Task SaveAttachmentToDownloadsAsync(MessageAttachment? attachment)
    {
        if (attachment == null || attachment.Data.Length == 0)
            return;

        try
        {
            var downloads = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
            Directory.CreateDirectory(downloads);
            var fileName = string.IsNullOrWhiteSpace(attachment.DisplayName)
                ? "MMS_attachment.bin"
                : attachment.DisplayName;
            var fullPath = Path.Combine(downloads, fileName);
            await File.WriteAllBytesAsync(fullPath, attachment.Data);
            AppendDebug($"[ATTACH] Saved: {fullPath}");
            Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{fullPath}\"") { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            AppendDebug($"[ATTACH] Save failed: {ex.Message}");
        }
    }

    private void RebuildContactLookupLocked()
    {
        var activeContacts = _contacts
            .Where(ContactBelongsToActiveDevice)
            .ToList();

        _contactNamesByPhone = activeContacts
            .SelectMany(c => c.PhoneNumbers.Select(p => new { Phone = ContactStoreService.NormalizePhone(p), c.DisplayName }))
            .Where(x => !string.IsNullOrEmpty(x.Phone) && !string.IsNullOrWhiteSpace(x.DisplayName))
            .GroupBy(x => x.Phone, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().DisplayName, StringComparer.OrdinalIgnoreCase);

        _contactsByPhone = activeContacts
            .SelectMany(c => c.PhoneNumbers.Select(p => new { Phone = ContactStoreService.NormalizePhone(p), Contact = c }))
            .Where(x => !string.IsNullOrEmpty(x.Phone))
            .GroupBy(x => x.Phone, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Contact, StringComparer.OrdinalIgnoreCase);
    }

    private string ActiveDeviceAddress =>
        MessageStoreService.NormalizeDeviceAddress(_connectedDeviceAddress ?? _settings.MostRecentDevice?.Address);

    private string ActiveOrPendingDeviceAddress =>
        MessageStoreService.NormalizeDeviceAddress(
            _connectedDeviceAddress
            ?? SelectedDevice?.Address.ToString()
            ?? _settings.DefaultDevice?.Address
            ?? _settings.MostRecentDevice?.Address);

    private bool IsActiveDeviceRecord(string? sourceDeviceAddress)
    {
        var active = ActiveDeviceAddress;
        if (string.IsNullOrWhiteSpace(active))
            return true;

        return MessageStoreService.SameDevice(sourceDeviceAddress, active);
    }

    private bool MessageBelongsToActiveDevice(SmsMessage message) =>
        IsActiveDeviceRecord(message.SourceDeviceAddress);

    private bool ContactBelongsToActiveDevice(ContactEntry contact) =>
        IsActiveDeviceRecord(contact.SourceDeviceAddress);

    private bool CallRecordBelongsToActiveDevice(CallRecord record) =>
        IsActiveDeviceRecord(record.SourceDeviceAddress);

    private void TagMessagesWithActiveDevice(IEnumerable<SmsMessage> messages)
    {
        var active = ActiveDeviceAddress;
        if (string.IsNullOrWhiteSpace(active))
            return;

        foreach (var message in messages)
        {
            if (string.IsNullOrWhiteSpace(message.SourceDeviceAddress))
                message.SourceDeviceAddress = active;
        }
    }

    private void MigrateLegacyDeviceScope(string currentDeviceAddress)
    {
        var current = MessageStoreService.NormalizeDeviceAddress(currentDeviceAddress);
        if (string.IsNullOrWhiteSpace(current))
            return;

        var otherKnownDevices = _settings.Current.KnownDevices
            .Select(d => MessageStoreService.NormalizeDeviceAddress(d.Address))
            .Where(address => !string.IsNullOrWhiteSpace(address) && !MessageStoreService.SameDevice(address, current))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var target = otherKnownDevices.Count == 1
            ? otherKnownDevices[0]
            : _settings.Current.KnownDevices
                .Select(d => MessageStoreService.NormalizeDeviceAddress(d.Address))
                .Where(address => !string.IsNullOrWhiteSpace(address))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Count() == 1
                    ? current
                    : "";

        if (string.IsNullOrWhiteSpace(target))
            return;

        int messageCount;
        int contactCount;
        lock (_msgLock)
        {
            messageCount = 0;
            foreach (var message in _allMessages.Where(m => string.IsNullOrWhiteSpace(m.SourceDeviceAddress)))
            {
                message.SourceDeviceAddress = target;
                messageCount++;
            }
        }

        lock (_contactLock)
        {
            contactCount = 0;
            foreach (var contact in _contacts.Where(c => string.IsNullOrWhiteSpace(c.SourceDeviceAddress)))
            {
                contact.SourceDeviceAddress = target;
                contactCount++;
            }

            if (contactCount > 0)
                RebuildContactLookupLocked();
        }

        if (messageCount > 0)
            SaveMessagesAsync();
        if (contactCount > 0)
            _contactStore.Save(_contacts);
        if (messageCount > 0 || contactCount > 0)
            AppendDebugThreadSafe($"[DEVICE-SCOPE] Assigned {messageCount} legacy message(s) and {contactCount} legacy contact(s) to cached device {FormatDeviceAddressForLog(target)}.");
    }

    private List<ContactEntry> GetContactsSnapshot()
    {
        lock (_contactLock)
        {
            return _contacts
                .Where(ContactBelongsToActiveDevice)
                .Select(c => new ContactEntry
                {
                    DisplayName = c.DisplayName,
                    PhoneNumbers = c.PhoneNumbers.ToList(),
                    SourceDeviceAddress = c.SourceDeviceAddress,
                    SourceFileName = c.SourceFileName,
                    ImportedAt = c.ImportedAt
                })
                .OrderBy(c => c.DisplayName, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }
    }

    private List<CallRecord> GetCallHistorySnapshotForApi(int take)
    {
        List<CallRecord> snapshot = new();
        Dispatch(() =>
        {
            snapshot = CallHistory
                .OrderByDescending(c => c.Time)
                .Take(take)
                .Select(CloneCallRecord)
                .ToList();
        });
        return snapshot;
    }

    private static string BuildCallRecordWebId(CallRecord c)
        => $"{c.SourceDeviceAddress}|{c.PhoneLogTimestamp}|{c.Number}|{c.Direction}|{c.Time:O}";

    private static object MapCallRecordForApi(CallRecord c) => new
    {
        id = BuildCallRecordWebId(c),
        number = c.Number,
        name = c.Name ?? "",
        displayName = c.DisplayNumber,
        direction = c.Direction.ToString(),
        directionLabel = c.DirectionLabel,
        time = c.Time,
        timestamp = c.Time,
        timeDisplay = c.TimeDisplay,
        durationSeconds = (int)Math.Round(c.Duration.TotalSeconds),
        durationDisplay = c.DurationDisplay,
        subtitle = c.SubtitleDisplay,
        isPhoneSynced = c.IsPhoneSynced,
        isMissed = c.Direction == CallDirection.Missed,
        sourceDeviceAddress = c.SourceDeviceAddress ?? ""
    };

    private static bool ContactMatches(ContactEntry contact, string query)
    {
        if (string.IsNullOrWhiteSpace(query)) return true;
        var q = query.Trim().ToLowerInvariant();
        return contact.DisplayName.ToLowerInvariant().Contains(q)
            || contact.PhoneNumbers.Any(p => p.Contains(q, StringComparison.OrdinalIgnoreCase))
            || Conversation.FormatPhone(contact.PrimaryPhone).ToLowerInvariant().Contains(q);
    }

    private static bool ContactOptionMatches(ContactOption option, string query)
    {
        if (string.IsNullOrWhiteSpace(query)) return true;
        return option.SearchText.Contains(query.Trim(), StringComparison.OrdinalIgnoreCase);
    }

    private static string? MapCommandCenterPalette(string? palette)
    {
        if (string.IsNullOrWhiteSpace(palette))
            return null;

        return palette.Trim().ToLowerInvariant() switch
        {
            "material" or "google" or "light" => "Google",
            "claude" or "cream" => "Claude",
            "navygold" or "navy-gold" or "bluegold" or "dark" or "materialdark" => "BlueGold",
            _ => null
        };
    }

    private static void ReplaceCollection<T>(ObservableCollection<T> target, IEnumerable<T> source)
    {
        target.Clear();
        foreach (var item in source) target.Add(item);
    }

    private IEnumerable<ContactOption> GetContactOptions()
        => GetContactsSnapshot()
            .SelectMany(c => c.PhoneNumbers
                .Select(ContactStoreService.NormalizePhone)
                .Where(p => !string.IsNullOrWhiteSpace(p))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Select(p => new ContactOption { Contact = c, PhoneNumber = p }));

    private void RefreshComposeContacts()
    {
        ReplaceCollection(ComposeContacts, GetContactOptions().Where(c => ContactOptionMatches(c, ComposeRecipientInput)));
        OnPropertyChanged(nameof(ShowComposeContactSuggestions));
    }

    private void RefreshCallContacts()
    {
        ReplaceCollection(CallContacts, GetContactOptions().Where(c => ContactOptionMatches(c, DialNumber)));
        OnPropertyChanged(nameof(ShowCallContactSuggestions));
    }

    private void RefreshEditableContacts()
        => ReplaceCollection(EditableContacts, GetContactsSnapshot().Where(c => ContactMatches(c, SettingsContactSearch)));

    private void RefreshAllContactCollections()
    {
        Dispatch(() =>
        {
            RefreshComposeContacts();
            RefreshCallContacts();
            RefreshEditableContacts();
        });
    }

    private string? LookupContactName(string? phoneOrAddress)
    {
        var normalized = ContactStoreService.NormalizePhone(phoneOrAddress);
        if (string.IsNullOrEmpty(normalized)) return null;
        lock (_contactLock)
        {
            if (_contactNamesByPhone.TryGetValue(normalized, out var name))
                return name;
        }

        return FindContactByPhone(normalized)?.DisplayName;
    }

    private string? LookupPhoneSyncedCallerName(string? phoneOrAddress)
    {
        var normalized = ContactStoreService.NormalizePhone(phoneOrAddress);
        if (string.IsNullOrWhiteSpace(normalized))
            return null;

        return CallHistory
            .Where(record => ContactStoreService.PhoneNumbersLikelyMatch(record.Number, normalized))
            .OrderByDescending(record => record.Time)
            .Select(record => record.Name?.Trim())
            .FirstOrDefault(name => !string.IsNullOrWhiteSpace(name) && !LooksLikePhonePlaceholderName(name, normalized));
    }

    private string? LookupBestCallerName(string? phoneOrAddress)
    {
        var contactName = LookupContactName(phoneOrAddress);
        if (!string.IsNullOrWhiteSpace(contactName))
            return contactName;

        return LookupPhoneSyncedCallerName(phoneOrAddress);
    }

    public ContactEntry? FindContactForNumber(string? phoneOrAddress) => FindContactByPhone(phoneOrAddress);

    public Conversation? FindConversationForPhone(string? phoneOrAddress)
    {
        var normalized = ContactStoreService.NormalizePhone(phoneOrAddress);
        if (string.IsNullOrWhiteSpace(normalized))
            return null;

        return Conversations.FirstOrDefault(c => SamePhone(c.PhoneNumber, normalized));
    }

    public void PrepareComposeForPhone(string? phoneOrAddress, bool clearBody = true)
    {
        var normalized = ContactStoreService.NormalizePhone(phoneOrAddress);
        if (string.IsNullOrWhiteSpace(normalized))
            return;

        var contactOption = GetContactOptions().FirstOrDefault(option => SamePhone(option.PhoneNumber, normalized));
        if (contactOption != null)
        {
            SelectedComposeContact = contactOption;
        }
        else
        {
            SelectedComposeContact = null;
            ComposeToNumber = normalized;
            _composeRecipientInput = Conversation.FormatPhone(normalized);
            OnPropertyChanged(nameof(ComposeRecipientInput));
        }

        IsComposeSuggestionsOpen = false;

        if (clearBody)
            ComposeBody = "";
    }

    private ContactEntry? FindContactByPhone(string? phoneOrAddress)
    {
        var normalized = ContactStoreService.NormalizePhone(phoneOrAddress);
        if (string.IsNullOrWhiteSpace(normalized)) return null;

        lock (_contactLock)
        {
            if (_contactsByPhone.TryGetValue(normalized, out var exact))
                return exact;

            exact = _contacts.FirstOrDefault(c =>
                ContactBelongsToActiveDevice(c) &&
                c.PhoneNumbers.Any(p => ContactStoreService.NormalizePhone(p) == normalized));
            if (exact != null)
                return exact;

            return _contacts
                .Where(ContactBelongsToActiveDevice)
                .Select(contact => new
                {
                    Contact = contact,
                    Score = contact.PhoneNumbers
                        .Select(phone => ContactStoreService.GetPhoneMatchScore(phone, normalized))
                        .DefaultIfEmpty(0)
                        .Max(),
                    LengthDelta = contact.PhoneNumbers
                        .Select(phone => Math.Abs(ContactStoreService.NormalizePhone(phone).Length - normalized.Length))
                        .DefaultIfEmpty(int.MaxValue)
                        .Min()
                })
                .Where(match => match.Score > 0)
                .OrderByDescending(match => match.Score)
                .ThenBy(match => match.LengthDelta)
                .ThenByDescending(match => match.Contact.ImportedAt)
                .Select(match => match.Contact)
                .FirstOrDefault();
        }
    }

    private string GetMessageSenderDisplay(SmsMessage msg)
    {
        var name = LookupContactName(msg.NormalizedPhone);
        if (msg.IsSent)
            return string.IsNullOrWhiteSpace(name) ? msg.DisplayFrom : $"Me > {name}";
        return string.IsNullOrWhiteSpace(name) ? msg.DisplayFrom : name;
    }

    private static string BuildMessageBannerBody(SmsMessage message)
    {
        var text = string.IsNullOrWhiteSpace(message.Body)
            ? (message.HasImageAttachment ? "Photo" : message.PreviewBody)
            : message.Body.Trim();

        if (string.IsNullOrWhiteSpace(text))
            text = "New message";

        const int maxBannerCharacters = 320;
        return text.Length > maxBannerCharacters
            ? text[..maxBannerCharacters].TrimEnd() + "…"
            : text;
    }

    private void ApplyContactNamesToCallHistory()
    {
        if (CallHistory.Count == 0) return;
        var refreshed = CallHistory.Select(r => new CallRecord
        {
            Number = r.Number,
            Name = LookupBestCallerName(r.Number) ?? r.Name,
            Direction = r.Direction,
            Time = r.Time,
            Duration = r.Duration,
            IsPhoneSynced = r.IsPhoneSynced,
            PhoneLogTimestamp = r.PhoneLogTimestamp,
            PhoneLogSourceObject = r.PhoneLogSourceObject,
            SourceDeviceAddress = r.SourceDeviceAddress
        }).ToList();

        CallHistory.Clear();
        foreach (var item in refreshed) CallHistory.Add(item);
        NotifySelectedConversationDetailsChanged();
    }

    private void RefreshContactBackedUi()
    {
        Dispatch(() =>
        {
            RebuildConversations();
            ApplyContactNamesToCallHistory();
            RefreshAllContactCollections();
            if (!string.IsNullOrWhiteSpace(CurrentCall.Number))
            {
                var name = LookupBestCallerName(CurrentCall.Number);
                if (!string.IsNullOrWhiteSpace(name) &&
                    !string.Equals(CurrentCall.DisplayName, name, StringComparison.OrdinalIgnoreCase))
                {
                    CurrentCall.DisplayName = name;
                    OnPropertyChanged(nameof(CurrentCall));
                    OnPropertyChanged(nameof(CallBannerText));
                }
            }
            OnPropertyChanged(nameof(ContactCount));
            OnPropertyChanged(nameof(ContactCountText));
            OnPropertyChanged(nameof(ComposeMatchingContact));
            OnPropertyChanged(nameof(CanSaveComposeContact));
            OnPropertyChanged(nameof(CanEditComposeContact));
            OnPropertyChanged(nameof(DialMatchingContact));
            OnPropertyChanged(nameof(CanSaveDialContact));
            OnPropertyChanged(nameof(CanEditDialContact));
            OnPropertyChanged(nameof(SelectedCallRecordMatchingContact));
            OnPropertyChanged(nameof(CanSaveSelectedCallRecordContact));
            OnPropertyChanged(nameof(CanEditSelectedCallRecordContact));
            OnPropertyChanged(nameof(SelectedCallRecordTitle));
        });
    }

    private void RefreshContactSyncState()
    {
        if (string.IsNullOrWhiteSpace(_connectedDeviceAddress))
        {
            ContactSyncStatus = $"Loaded {ContactCount} saved contacts. Connect a phone to expose that phone's contact-sync folder and outbound queue.";
            return;
        }

        var state = _contactSync.GetState(_connectedDeviceAddress);
        ContactSyncFolderPath = state.RootPath;
        PendingContactFiles = state.PendingFileCount;
        ContactSyncStatus =
            $"Incoming: {state.PendingFileCount} pending file(s), {state.ImportedFileCount} imported, {state.IgnoredFileCount} ignored. Outgoing: {state.PendingOutboundUpsertCount} add or update op(s) and {state.PendingOutboundDeleteCount} delete op(s) queued in {state.PendingOutboundPath}. PBAP is read-only for contacts, so phone-side apply requires a helper that consumes this queue.";
        ShowContactImportPrompt = state.PendingFileCount > 0;
    }

    private async Task ImportPendingContactsAsync()
    {
        if (string.IsNullOrWhiteSpace(_connectedDeviceAddress)) return;

        while (!_sessionCts.IsCancellationRequested)
        {
            List<ContactEntry> snapshot;
            lock (_contactLock) snapshot = _contacts.ToList();

            var result = _contactSync.ImportPendingFiles(_connectedDeviceAddress, snapshot, maxFiles: 4);
            if (result.ProcessedFiles == 0)
            {
                RefreshContactSyncState();
                break;
            }

            lock (_contactLock)
            {
                _contacts = result.MergedContacts;
                RebuildContactLookupLocked();
            }

            _contactStore.Save(result.MergedContacts);
            AppendDebug($"[CONTACTS] Sync import applied {result.AddedContacts} add(s), {result.UpdatedContacts} update(s), {result.DeletedContacts} delete(s), and {result.SkippedContacts} skipped item(s) from {result.ProcessedFiles} file(s)");

            RefreshContactBackedUi();
            RefreshContactSyncState();

            if (result.PendingFilesRemaining <= 0) break;
            await Task.Delay(400);
        }
    }

    private void SkipPendingContacts()
    {
        if (string.IsNullOrWhiteSpace(_connectedDeviceAddress)) return;
        var skippedFiles = _contactSync.SkipPendingFiles(_connectedDeviceAddress);
        AppendDebug($"[CONTACTS] Ignored {skippedFiles} pending contact file(s)");
        RefreshContactSyncState();
    }

    private void OpenContactSyncFolder()
    {
        try
        {
            if (string.IsNullOrWhiteSpace(_connectedDeviceAddress))
                return;

            RefreshContactSyncState();
            if (!string.IsNullOrWhiteSpace(ContactSyncFolderPath))
                Process.Start(new ProcessStartInfo("explorer.exe", $"\"{ContactSyncFolderPath}\"") { UseShellExecute = true });
        }
        catch (Exception ex) { AppendDebug($"[CONTACTS] Open folder failed: {ex.Message}"); }
    }

    private void OpenBuildsFolder()
    {
        try
        {
            var buildsFolder = FindBuildsFolder();
            if (string.IsNullOrWhiteSpace(buildsFolder) || !Directory.Exists(buildsFolder))
            {
                AppendDebug("[BUILD] Builds folder not found.");
                return;
            }

            Process.Start(new ProcessStartInfo("explorer.exe", $"\"{buildsFolder}\"")
            {
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            AppendDebug($"[BUILD] Open builds folder failed: {ex.Message}");
        }
    }

    private void OpenEventLog()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(LogFilePath)!);
            if (!File.Exists(LogFilePath))
                File.WriteAllText(LogFilePath, "");

            Process.Start(new ProcessStartInfo(LogFilePath)
            {
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            AppendDebug($"[LOG] Open event log failed: {ex.Message}");
        }
    }

    private void RunUiAuditor()
    {
        try
        {
            var auditorExe = FindUiAuditorExe();
            if (string.IsNullOrWhiteSpace(auditorExe))
            {
                AppendDebug("[AUDITOR] DeskPhone UI Auditor was not found in this build.");
                return;
            }

            Process.Start(new ProcessStartInfo(auditorExe)
            {
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            AppendDebug($"[AUDITOR] Open UI Auditor failed: {ex.Message}");
        }
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

    private void RefreshThemeSync()
    {
        if (!SyncThemeWithShamash)
        {
            ThemeSyncRefreshStatus = "Turn theme sync on first.";
            return;
        }

        try
        {
            var url = $"http://127.0.0.1:3002/?deskphoneThemeRefresh={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            ThemeSyncRefreshStatus = "Asked Shamash/OneTask to resend its theme.";
            AppendDebug("[THEME] Requested Shamash/OneTask theme refresh.");
        }
        catch (Exception ex)
        {
            ThemeSyncRefreshStatus = "Could not open Shamash/OneTask.";
            AppendDebug($"[THEME] Theme refresh request failed: {ex.Message}");
        }
    }

    private static string? FindBuildsFolder()
    {
        var current = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
        while (current is not null)
        {
            if (current.Name.Equals("deployed-builds", StringComparison.OrdinalIgnoreCase))
            {
                return current.FullName;
            }

            var candidate = Path.Combine(current.FullName, "deployed-builds");
            if (Directory.Exists(candidate))
            {
                return candidate;
            }

            current = current.Parent;
        }

        return null;
    }

    private async Task ImportStarterVcfAsync()
    {
        try
        {
            var dlg = new Microsoft.Win32.OpenFileDialog
            {
                Filter = "vCard files (*.vcf)|*.vcf|All files (*.*)|*.*",
                Title = "Import starter VCF"
            };
            if (dlg.ShowDialog() != true) return;

            List<ContactEntry> snapshot;
            lock (_contactLock) snapshot = _contacts.ToList();

            var result = await Task.Run(() => _contactSync.ImportFile(dlg.FileName, _connectedDeviceAddress, snapshot));

            lock (_contactLock)
            {
                _contacts = result.MergedContacts;
                RebuildContactLookupLocked();
            }

            _contactStore.Save(result.MergedContacts);
            AppendDebug($"[CONTACTS] Starter import complete: {result.AddedContacts} add(s), {result.UpdatedContacts} update(s), {result.DeletedContacts} delete(s), {result.SkippedContacts} skipped");
            RefreshContactBackedUi();
            RefreshContactSyncState();
        }
        catch (Exception ex) { AppendDebug($"[CONTACTS] Starter import failed: {ex.Message}"); }
    }

    private async Task ExportMessagesBackupAsync()
    {
        try
        {
            List<SmsMessage> snapshot;
            lock (_msgLock)
                snapshot = _allMessages
                    .OrderByDescending(message => message.Timestamp)
                    .ToList();

            var dlg = new Microsoft.Win32.SaveFileDialog
            {
                Filter = "JSON files (*.json)|*.json|All files (*.*)|*.*",
                Title = "Save messages backup",
                FileName = $"DeskPhone_messages_{DateTime.Now:yyyy-MM-dd_HHmmss}.json",
                DefaultExt = ".json",
                AddExtension = true,
                OverwritePrompt = true
            };

            if (dlg.ShowDialog() != true)
                return;

            await Task.Run(() => _store.Export(dlg.FileName, snapshot));
            MessageBackupExportStatus = $"Saved {snapshot.Count} message(s) to {dlg.FileName}";
            AppendDebug($"[BACKUP] Exported {snapshot.Count} message(s) to {dlg.FileName}");
        }
        catch (Exception ex)
        {
            MessageBackupExportStatus = $"Backup export failed: {ex.Message}";
            AppendDebug($"[BACKUP] Export failed: {ex.Message}");
        }
    }

    private void PickComposeContact(ContactOption? contact)
    {
        if (contact == null) return;
        SelectedComposeContact = contact;
        ComposeToNumber = contact.PhoneNumber;
        _composeRecipientInput = contact.DisplayName;
        OnPropertyChanged(nameof(ComposeRecipientInput));
        IsComposeSuggestionsOpen = false;
    }

    private void AddComposeAttachments()
    {
        var dlg = new Microsoft.Win32.OpenFileDialog
        {
            Title = "Attach to message",
            Filter = "Pictures, contacts, and files|*.jpg;*.jpeg;*.png;*.gif;*.webp;*.vcf;*.pdf;*.txt;*.doc;*.docx|All files (*.*)|*.*",
            Multiselect = true
        };
        if (dlg.ShowDialog() != true) return;

        foreach (var path in dlg.FileNames)
        {
            try
            {
                var info = new FileInfo(path);
                if (!info.Exists || info.Length <= 0) continue;
                ComposeAttachments.Add(new MessageAttachment
                {
                    ContentType = GuessComposeAttachmentContentType(info.Extension),
                    FileName = info.Name,
                    Data = File.ReadAllBytes(path)
                });
            }
            catch (Exception ex)
            {
                AppendDebug($"[MMS ATTACH] Could not stage attachment: {ex.Message}");
            }
        }

        NotifyComposeAttachmentsChanged();
    }

    private void RemoveComposeAttachment(MessageAttachment? attachment)
    {
        if (attachment == null) return;
        ComposeAttachments.Remove(attachment);
        NotifyComposeAttachmentsChanged();
    }

    private void ClearComposeAttachments()
    {
        if (ComposeAttachments.Count == 0) return;
        ComposeAttachments.Clear();
        NotifyComposeAttachmentsChanged();
    }

    private void NotifyComposeAttachmentsChanged()
    {
        OnPropertyChanged(nameof(HasComposeAttachments));
        OnPropertyChanged(nameof(ComposeAttachmentNotice));
    }

    private static string GuessComposeAttachmentContentType(string extension)
        => extension.TrimStart('.').ToLowerInvariant() switch
        {
            "jpg" or "jpeg" => "image/jpeg",
            "png" => "image/png",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "vcf" => "text/vcard",
            "txt" => "text/plain",
            "pdf" => "application/pdf",
            "doc" => "application/msword",
            "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            _ => "application/octet-stream"
        };

    private void PickCallContact(ContactOption? contact)
    {
        if (contact == null) return;
        SelectedCallContact = contact;
        DialNumber = contact.PhoneNumber;
        OnPropertyChanged(nameof(CallContactSearch));
        IsCallSuggestionsOpen = false;
    }

    private async Task DialContactAsync(ContactOption? contact)
    {
        if (contact == null) return;
        PickCallContact(contact);
        await DialAsync();
    }

    private void SaveAsContact(string? rawNumber)
    {
        var normalized = ContactStoreService.NormalizePhone(rawNumber);
        if (string.IsNullOrWhiteSpace(normalized)) return;
        BeginNewContact(normalized, openEditor: true);
    }

    private void BeginNewContact(string? phone = null, bool openEditor = false)
    {
        if (openEditor)
            SettingsContactSearch = "";

        SelectedEditableContact = null;
        ContactEditorTitle = "Add Contact";
        ContactEditorName = "";
        ContactEditorPhone = string.IsNullOrWhiteSpace(phone) ? "" : phone;
        if (openEditor)
            OpenContactsEditor();
    }

    private void BeginEditContact(ContactEntry? contact, bool openEditor = false)
    {
        if (contact == null)
        {
            BeginNewContact(openEditor: openEditor);
            return;
        }

        if (openEditor)
            SettingsContactSearch = "";

        RefreshEditableContacts();
        SelectedEditableContact = ResolveEditableContactSelection(contact);
        if (openEditor)
            OpenContactsEditor();
    }

    private void OpenContactsEditor()
    {
        SelectedTab = AppTab.Contacts;
    }

    private ContactEntry ResolveEditableContactSelection(ContactEntry contact)
    {
        var normalized = ContactStoreService.NormalizePhone(contact.PrimaryPhone);
        return EditableContacts.FirstOrDefault(existing =>
                   string.Equals(existing.DisplayName, contact.DisplayName, StringComparison.OrdinalIgnoreCase)
                   && ContactStoreService.PhoneNumbersLikelyMatch(existing.PrimaryPhone, normalized))
               ?? CloneContact(contact);
    }

    private void DeleteSelectedContact()
    {
        var contact = SelectedEditableContact;
        if (contact == null)
            return;

        var snapshot = CloneContact(contact);
        var promptName = string.IsNullOrWhiteSpace(snapshot.DisplayName)
            ? Conversation.FormatPhone(snapshot.PrimaryPhone)
            : snapshot.DisplayName;

        var confirmed = System.Windows.MessageBox.Show(
            $"Delete {promptName} from DeskPhone?\n\nDeskPhone will also queue a phone-side delete where a real per-phone sync helper is available. PBAP itself cannot write contacts.",
            "Delete Contact",
            MessageBoxButton.YesNo,
            MessageBoxImage.Warning,
            MessageBoxResult.No);

        if (confirmed != MessageBoxResult.Yes)
            return;

        var normalizedPhone = ContactStoreService.NormalizePhone(snapshot.PrimaryPhone);
        bool removed;
        lock (_contactLock)
        {
            removed = _contacts.RemoveAll(c =>
                ContactBelongsToActiveDevice(c) &&
                c.PhoneNumbers.Any(p => string.Equals(ContactStoreService.NormalizePhone(p), normalizedPhone, StringComparison.OrdinalIgnoreCase))) > 0;

            if (removed)
            {
                RebuildContactLookupLocked();
                _contactStore.Save(_contacts);
            }
        }

        if (!removed)
            return;

        AppendDebug($"[CONTACTS] Deleted local contact {promptName} ({normalizedPhone})");
        QueueContactDeleteForSync(snapshot);
        RefreshContactBackedUi();
        BeginNewContact(openEditor: true);
    }

    private void DeleteCallRecord(CallRecord? record)
    {
        if (record == null)
            return;

        var snapshot = CloneCallRecord(record);
        var removedCount = RemoveCallHistoryEntries(new[] { snapshot }, clearAll: false);
        if (removedCount == 0)
            return;

        AppendDebug($"[CALL-HISTORY] Deleted local call entry {FormatCallRecordLabel(snapshot)}");
        QueueCallLogDeleteForSync(snapshot);
        SetLastDeletedCallHistory(new[] { snapshot }, deleteAll: false);
    }

    private CallRecord? FindCallRecordForWebId(string? id)
    {
        if (string.IsNullOrWhiteSpace(id))
            return null;

        return CallHistory.FirstOrDefault(record =>
            string.Equals(BuildCallRecordWebId(record), id, StringComparison.OrdinalIgnoreCase));
    }

    private void DeleteCallRecordFromWeb(string id)
        => DeleteCallRecord(FindCallRecordForWebId(id));

    private void DeleteAllCallHistory()
    {
        if (CallHistory.Count == 0)
            return;

        var confirmed = System.Windows.MessageBox.Show(
            $"Delete all {CallHistory.Count} call history entries from DeskPhone?\n\nThis clears the local call log immediately and queues phone-side delete requests for known devices where a real helper can consume the outbox. PBAP itself cannot write call-log deletes.",
            "Delete All Call History",
            MessageBoxButton.YesNo,
            MessageBoxImage.Warning,
            MessageBoxResult.No);

        if (confirmed != MessageBoxResult.Yes)
            return;

        var snapshots = CallHistory
            .Select(CloneCallRecord)
            .ToList();

        var removedCount = RemoveCallHistoryEntries(snapshots, clearAll: true);
        if (removedCount == 0)
            return;

        AppendDebug($"[CALL-HISTORY] Deleted all {removedCount} local call history entries");
        QueueCallLogDeleteAllForSync(snapshots);
        SetLastDeletedCallHistory(snapshots, deleteAll: true);
    }

    private void DeleteAllCallHistoryFromWeb()
    {
        if (CallHistory.Count == 0)
            return;

        var snapshots = CallHistory
            .Select(CloneCallRecord)
            .ToList();

        var removedCount = RemoveCallHistoryEntries(snapshots, clearAll: true);
        if (removedCount == 0)
            return;

        AppendDebug($"[CALL-HISTORY] Deleted all {removedCount} local call history entries from DeskPhone Web");
        QueueCallLogDeleteAllForSync(snapshots);
        SetLastDeletedCallHistory(snapshots, deleteAll: true);
    }

    private void UndoCallHistoryDelete()
    {
        var snapshots = _lastDeletedCallRecords;
        if (snapshots == null || snapshots.Count == 0)
            return;

        if (_lastDeletedCallDeleteAll)
        {
            foreach (var deviceAddress in snapshots
                         .Select(ResolveCallLogSyncTarget)
                         .Where(address => !string.IsNullOrWhiteSpace(address))
                         .Distinct(StringComparer.OrdinalIgnoreCase))
            {
                var canceled = _callLogSync.CancelPendingDeleteAllOperation(deviceAddress);
                if (canceled > 0)
                    AppendDebug($"[CALL-HISTORY] Canceled {canceled} pending delete-all operation(s) for {FormatDeviceAddressForLog(deviceAddress)}.");
            }
        }
        else
        {
            foreach (var group in snapshots.GroupBy(ResolveCallLogSyncTarget, StringComparer.OrdinalIgnoreCase))
            {
                if (string.IsNullOrWhiteSpace(group.Key))
                    continue;

                var canceled = _callLogSync.CancelPendingDeleteOperations(group.Key, group);
                if (canceled > 0)
                    AppendDebug($"[CALL-HISTORY] Canceled {canceled} pending delete operation(s) for {FormatDeviceAddressForLog(group.Key)}.");
            }
        }

        var merged = CallHistory
            .Select(CloneCallRecord)
            .Concat(snapshots.Select(CloneCallRecord))
            .GroupBy(BuildCallRecordDeleteKey, StringComparer.OrdinalIgnoreCase)
            .Select(group => group
                .OrderByDescending(record => record.Time)
                .First())
            .ToList();

        ReplaceCallHistory(merged);
        var restoredPbapEntries = _pbapCallLogStore.RestoreEntries(_pbapCallLogStore.Load(), snapshots);
        _pbapCallLogStore.Save(restoredPbapEntries);
        AppendDebug(_lastDeletedCallDeleteAll
            ? $"[CALL-HISTORY] Restored {snapshots.Count} deleted call history entries."
            : $"[CALL-HISTORY] Restored deleted call entry {FormatCallRecordLabel(snapshots[0])}.");
        SetLastDeletedCallHistory(null, deleteAll: false);
    }

    private void SetLastDeletedCallHistory(IEnumerable<CallRecord>? records, bool deleteAll)
    {
        _lastDeletedCallRecords = records?.Select(CloneCallRecord).ToList();
        _lastDeletedCallDeleteAll = deleteAll;
        OnPropertyChanged(nameof(HasUndoCallHistoryDelete));
        OnPropertyChanged(nameof(UndoCallHistoryDeleteText));
    }

    private void LoadContactEditor(ContactEntry? contact)
    {
        if (contact == null) return;
        ContactEditorTitle = "Edit Contact";
        ContactEditorName = contact.DisplayName;
        ContactEditorPhone = contact.PrimaryPhone;
    }

    private void SaveContactEdit()
    {
        var name = (ContactEditorName ?? "").Trim();
        var phone = ContactStoreService.NormalizePhone(ContactEditorPhone);
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(phone)) return;

        ContactEntry? previousSnapshot = null;
        ContactEntry? savedSnapshot = null;

        lock (_contactLock)
        {
            var existing = _selectedEditableContact == null
                ? null
                : _contacts.FirstOrDefault(c =>
                    ContactBelongsToActiveDevice(c) &&
                    string.Equals(c.DisplayName, _selectedEditableContact.DisplayName, StringComparison.OrdinalIgnoreCase) &&
                    c.PhoneNumbers.Any(p => ContactStoreService.NormalizePhone(p) == ContactStoreService.NormalizePhone(_selectedEditableContact.PrimaryPhone)));

            var duplicate = _contacts.FirstOrDefault(c =>
                ContactBelongsToActiveDevice(c) &&
                !ReferenceEquals(c, existing) &&
                c.PhoneNumbers.Any(p => ContactStoreService.NormalizePhone(p) == phone));

            if (duplicate != null && existing == null)
            {
                previousSnapshot = CloneContact(duplicate);
                duplicate.DisplayName = name;
                duplicate.PhoneNumbers = new List<string> { phone };
                savedSnapshot = CloneContact(duplicate);
            }
            else if (existing != null)
            {
                previousSnapshot = CloneContact(existing);
                existing.DisplayName = name;
                existing.PhoneNumbers = new List<string> { phone };
                savedSnapshot = CloneContact(existing);
            }
            else
            {
                var created = new ContactEntry
                {
                    DisplayName = name,
                    PhoneNumbers = new List<string> { phone },
                    ImportedAt = DateTime.Now,
                    SourceDeviceAddress = _connectedDeviceAddress ?? "",
                    SourceFileName = "manual"
                };
                _contacts.Add(created);
                savedSnapshot = CloneContact(created);
            }

            RebuildContactLookupLocked();
            _contactStore.Save(_contacts);
        }

        AppendDebug($"[CONTACTS] Saved contact {name} ({phone})");
        QueueContactUpsertForSync(savedSnapshot, previousSnapshot);
        RefreshContactBackedUi();
        BeginNewContact();
    }

    private void SaveContactFromWeb(string? id, string? displayName, string? rawPhone)
    {
        var name = (displayName ?? "").Trim();
        var phone = ContactStoreService.NormalizePhone(rawPhone);
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(phone))
            return;

        ContactEntry? previousSnapshot = null;
        ContactEntry? savedSnapshot;

        lock (_contactLock)
        {
            var existing = FindContactForWebLocked(id, phone);
            if (existing != null)
            {
                previousSnapshot = CloneContact(existing);
                existing.DisplayName = name;
                existing.PhoneNumbers = new List<string> { phone };
                savedSnapshot = CloneContact(existing);
            }
            else
            {
                var created = new ContactEntry
                {
                    DisplayName = name,
                    PhoneNumbers = new List<string> { phone },
                    ImportedAt = DateTime.Now,
                    SourceDeviceAddress = _connectedDeviceAddress ?? "",
                    SourceFileName = "manual"
                };
                _contacts.Add(created);
                savedSnapshot = CloneContact(created);
            }

            RebuildContactLookupLocked();
            _contactStore.Save(_contacts);
        }

        AppendDebug($"[CONTACTS] Saved contact {name} ({phone}) from DeskPhone Web");
        QueueContactUpsertForSync(savedSnapshot, previousSnapshot);
        RefreshContactBackedUi();
    }

    private void DeleteContactFromWeb(string? id, string? rawPhone)
    {
        ContactEntry? snapshot = null;
        var phone = ContactStoreService.NormalizePhone(rawPhone);

        lock (_contactLock)
        {
            var existing = FindContactForWebLocked(id, phone);
            if (existing == null)
                return;

            snapshot = CloneContact(existing);
            var normalizedPhone = ContactStoreService.NormalizePhone(existing.PrimaryPhone);
            _contacts.RemoveAll(c =>
                ContactBelongsToActiveDevice(c) &&
                c.PhoneNumbers.Any(p => string.Equals(ContactStoreService.NormalizePhone(p), normalizedPhone, StringComparison.OrdinalIgnoreCase)));
            RebuildContactLookupLocked();
            _contactStore.Save(_contacts);
        }

        AppendDebug($"[CONTACTS] Deleted local contact {snapshot.DisplayName} ({snapshot.PrimaryPhone}) from DeskPhone Web");
        QueueContactDeleteForSync(snapshot);
        RefreshContactBackedUi();
        BeginNewContact();
    }

    private ContactEntry? FindContactForWebLocked(string? id, string? normalizedPhone)
    {
        return _contacts.FirstOrDefault(c =>
            ContactBelongsToActiveDevice(c) &&
            ((!string.IsNullOrWhiteSpace(id) && string.Equals(BuildContactWebId(c), id, StringComparison.OrdinalIgnoreCase)) ||
             (!string.IsNullOrWhiteSpace(normalizedPhone) && c.PhoneNumbers.Any(p =>
                 string.Equals(ContactStoreService.NormalizePhone(p), normalizedPhone, StringComparison.OrdinalIgnoreCase)))));
    }

    private static string BuildContactWebId(ContactEntry contact)
        => $"{contact.SourceDeviceAddress}|{contact.DisplayName}|{ContactStoreService.NormalizePhone(contact.PrimaryPhone)}";

    private void QueueContactUpsertForSync(ContactEntry? savedContact, ContactEntry? previousContact)
    {
        if (savedContact == null)
            return;

        var targetDeviceAddress = ResolveContactSyncTarget(savedContact, previousContact);
        if (string.IsNullOrWhiteSpace(targetDeviceAddress))
        {
            AppendDebug("[CONTACTS] Saved locally. No phone-side contact sync target is available for this contact yet.");
            return;
        }

        var result = _contactSync.QueueUpsertOperation(targetDeviceAddress, savedContact, previousContact);
        if (!result.Succeeded)
        {
            AppendDebug($"[CONTACTS] {result.Message}");
            return;
        }

        AppendDebug($"[CONTACTS] Queued {result.QueuedCount} outbound contact sync operation(s) for {FormatDeviceAddressForLog(result.DeviceAddress)}. Pending outbound queue: {result.PendingQueueCount}");
        RefreshContactSyncState();
    }

    private void QueueContactDeleteForSync(ContactEntry? deletedContact)
    {
        if (deletedContact == null)
            return;

        var targetDeviceAddress = ResolveContactSyncTarget(deletedContact);
        if (string.IsNullOrWhiteSpace(targetDeviceAddress))
        {
            AppendDebug("[CONTACTS] Deleted locally. No phone-side contact sync target is available for this contact yet.");
            return;
        }

        var result = _contactSync.QueueDeleteOperation(targetDeviceAddress, deletedContact);
        if (!result.Succeeded)
        {
            AppendDebug($"[CONTACTS] {result.Message}");
            return;
        }

        AppendDebug($"[CONTACTS] Queued {result.QueuedCount} outbound contact delete operation(s) for {FormatDeviceAddressForLog(result.DeviceAddress)}. Pending outbound queue: {result.PendingQueueCount}");
        RefreshContactSyncState();
    }

    private int RemoveCallHistoryEntries(IReadOnlyCollection<CallRecord> records, bool clearAll)
    {
        if (records.Count == 0)
            return 0;

        int removedCount;
        if (clearAll)
        {
            var snapshots = CallHistory.Select(CloneCallRecord).ToList();
            removedCount = CallHistory.Count;
            CallHistory.Clear();
            var remainingPbapEntries = _pbapCallLogStore.DeleteEntries(_pbapCallLogStore.Load(), snapshots);
            _pbapCallLogStore.Save(remainingPbapEntries);
            SelectedCallRecord = null;
        }
        else
        {
            var deleteKeys = records
                .Select(BuildCallRecordDeleteKey)
                .Where(key => !string.IsNullOrWhiteSpace(key))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            removedCount = 0;
            for (var i = CallHistory.Count - 1; i >= 0; i--)
            {
                if (!deleteKeys.Contains(BuildCallRecordDeleteKey(CallHistory[i])))
                    continue;

                CallHistory.RemoveAt(i);
                removedCount++;
            }

            if (removedCount == 0)
                return 0;

            var remainingPbapEntries = _pbapCallLogStore.DeleteEntries(_pbapCallLogStore.Load(), records);
            _pbapCallLogStore.Save(remainingPbapEntries);

            if (SelectedCallRecord != null && deleteKeys.Contains(BuildCallRecordDeleteKey(SelectedCallRecord)))
                SelectedCallRecord = null;
        }

        NotifySelectedConversationDetailsChanged();
        CommandManager.InvalidateRequerySuggested();
        return removedCount;
    }

    private void QueueCallLogDeleteForSync(CallRecord record)
    {
        var targetDeviceAddress = ResolveCallLogSyncTarget(record);
        if (string.IsNullOrWhiteSpace(targetDeviceAddress))
        {
            AppendDebug("[CALL-HISTORY] Deleted locally. No phone-side call-log sync target is available for this record yet.");
            return;
        }

        var result = _callLogSync.QueueDeleteOperation(targetDeviceAddress, record);
        if (!result.Succeeded)
        {
            AppendDebug($"[CALL-HISTORY] {result.Message}");
            return;
        }

        AppendDebug($"[CALL-HISTORY] Queued {result.QueuedCount} outbound call-log delete operation(s) for {FormatDeviceAddressForLog(result.DeviceAddress)}. Pending outbound queue: {result.PendingQueueCount}. PBAP remains read-only, so a helper must consume the queue to delete on the phone.");
    }

    private void QueueCallLogDeleteAllForSync(IReadOnlyCollection<CallRecord> deletedRecords)
    {
        var deviceAddresses = deletedRecords
            .Select(ResolveCallLogSyncTarget)
            .Where(address => !string.IsNullOrWhiteSpace(address))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (deviceAddresses.Count == 0)
        {
            AppendDebug("[CALL-HISTORY] Cleared locally. No phone-side call-log sync target is available yet.");
            return;
        }

        foreach (var deviceAddress in deviceAddresses)
        {
            var result = _callLogSync.QueueDeleteAllOperation(deviceAddress);
            if (!result.Succeeded)
            {
                AppendDebug($"[CALL-HISTORY] {result.Message}");
                continue;
            }

            AppendDebug($"[CALL-HISTORY] Queued {result.QueuedCount} outbound delete-all call-log operation(s) for {FormatDeviceAddressForLog(result.DeviceAddress)}. Pending outbound queue: {result.PendingQueueCount}. PBAP remains read-only, so a helper must consume the queue to delete on the phone.");
        }
    }

    private string? ResolveCallLogSyncTarget(CallRecord? record)
    {
        if (!string.IsNullOrWhiteSpace(record?.SourceDeviceAddress))
            return record.SourceDeviceAddress;

        if (!string.IsNullOrWhiteSpace(_connectedDeviceAddress))
            return _connectedDeviceAddress;

        return null;
    }

    private static string BuildCallRecordDeleteKey(CallRecord record)
    {
        var phone = ContactStoreService.NormalizePhone(record.Number);
        var timestamp = !string.IsNullOrWhiteSpace(record.PhoneLogTimestamp)
            ? record.PhoneLogTimestamp.Trim()
            : record.Time.ToUniversalTime().ToString("O");
        var device = (record.SourceDeviceAddress ?? "").Trim();
        return $"{device}|{record.Direction}|{phone}|{timestamp}";
    }

    private static string FormatCallRecordLabel(CallRecord record)
    {
        var who = string.IsNullOrWhiteSpace(record.Name)
            ? Conversation.FormatPhone(record.Number)
            : record.Name!;
        return $"{who} at {record.Time:g}";
    }

    private string? ResolveContactSyncTarget(ContactEntry? primaryContact, ContactEntry? secondaryContact = null)
    {
        if (!string.IsNullOrWhiteSpace(primaryContact?.SourceDeviceAddress))
            return primaryContact.SourceDeviceAddress;

        if (!string.IsNullOrWhiteSpace(secondaryContact?.SourceDeviceAddress))
            return secondaryContact.SourceDeviceAddress;

        if (!string.IsNullOrWhiteSpace(_connectedDeviceAddress))
            return _connectedDeviceAddress;

        return null;
    }

    private static ContactEntry CloneContact(ContactEntry contact) => new()
    {
        DisplayName = contact.DisplayName,
        PhoneNumbers = contact.PhoneNumbers.ToList(),
        SourceDeviceAddress = contact.SourceDeviceAddress,
        SourceFileName = contact.SourceFileName,
        ImportedAt = contact.ImportedAt
    };

    private static string FormatDeviceAddressForLog(string? deviceAddress)
        => string.IsNullOrWhiteSpace(deviceAddress) ? "unknown device" : deviceAddress;

    private async Task DeleteMessageAsync(SmsMessage? msg)
    {
        if (msg == null) return;
        var snapshot = CloneSmsMessage(msg);

        if (!string.IsNullOrWhiteSpace(msg.Handle))
        {
            if (_map == null || !_map.IsConnected)
            {
                AppendDebug("[DELETE] Message delete needs an active Messages connection so the phone and PC stay in sync.");
                return;
            }

            Interlocked.Increment(ref _realOpCount);
            try
            {
                var ok = await _map.SetMessageDeletedStatusAsync(msg.Handle, isDeleted: true, _sessionCts.Token);
                if (!ok)
                {
                    AppendDebug($"[DELETE] Phone rejected delete for message {msg.Handle}.");
                    return;
                }
            }
            catch (OperationCanceledException) { return; }
            catch (Exception ex)
            {
                AppendDebug($"[DELETE] {ex.Message}");
                return;
            }
            finally
            {
                Interlocked.Decrement(ref _realOpCount);
            }
        }

        if (RemoveMessageFromLocalStore(msg))
        {
            SetLastDeletedMessage(snapshot);
            AppendDebug(string.IsNullOrWhiteSpace(msg.Handle)
                ? "[DELETE] Removed a local-only message. Undo is available."
                : $"[DELETE] Deleted message {msg.Handle} on the phone and removed it locally. Undo is available.");
            _nextMessageDeleteReconcileUtc = DateTime.MinValue;
        }
    }

    private async Task UndoLastDeletedMessageAsync()
    {
        var snapshot = _lastDeletedMessage;
        if (snapshot == null)
            return;

        if (!string.IsNullOrWhiteSpace(snapshot.Handle))
        {
            if (_map == null || !_map.IsConnected)
            {
                AppendDebug("[UNDO DELETE] Reconnect Messages before undoing a phone-backed message delete.");
                return;
            }

            Interlocked.Increment(ref _realOpCount);
            try
            {
                var ok = await _map.SetMessageDeletedStatusAsync(snapshot.Handle, isDeleted: false, _sessionCts.Token);
                if (!ok)
                {
                    AppendDebug($"[UNDO DELETE] Phone rejected undelete for message {snapshot.Handle}.");
                    return;
                }
            }
            catch (OperationCanceledException) { return; }
            catch (Exception ex)
            {
                AppendDebug($"[UNDO DELETE] {ex.Message}");
                return;
            }
            finally
            {
                Interlocked.Decrement(ref _realOpCount);
            }
        }

        RestoreMessageToLocalStore(snapshot);
        SetLastDeletedMessage(null);
        AppendDebug(string.IsNullOrWhiteSpace(snapshot.Handle)
            ? "[UNDO DELETE] Restored local-only message."
            : $"[UNDO DELETE] Restored message {snapshot.Handle} locally and on the phone.");
    }

    private void SetLastDeletedMessage(SmsMessage? message)
    {
        _lastDeletedMessage = message;
        OnPropertyChanged(nameof(HasUndoMessageDelete));
        OnPropertyChanged(nameof(UndoMessageDeleteText));
    }

    private static SmsMessage CloneSmsMessage(SmsMessage source) => new()
    {
        Handle = source.Handle,
        LocalId = source.LocalId,
        SourceDeviceAddress = source.SourceDeviceAddress,
        From = source.From,
        Body = source.Body,
        Timestamp = source.Timestamp,
        IsRead = source.IsRead,
        IsSent = source.IsSent,
        IsMms = source.IsMms,
        SendStatus = source.SendStatus,
        IsPinned = source.IsPinned,
        AttachmentData = source.AttachmentData?.ToArray(),
        Attachments = source.Attachments
            .Select(attachment => new MessageAttachment
            {
                ContentType = attachment.ContentType,
                FileName = attachment.FileName,
                Data = attachment.Data.ToArray()
            })
            .ToList()
    };

    private void RestoreMessageToLocalStore(SmsMessage message)
    {
        lock (_msgLock)
        {
            var exists = _allMessages.Any(m =>
                MessageStoreService.SameDevice(m.SourceDeviceAddress, message.SourceDeviceAddress) &&
                ((!string.IsNullOrWhiteSpace(message.Handle) &&
                  string.Equals(m.Handle, message.Handle, StringComparison.OrdinalIgnoreCase)) ||
                 (!string.IsNullOrWhiteSpace(message.LocalId) &&
                  string.Equals(m.LocalId, message.LocalId, StringComparison.OrdinalIgnoreCase))));

            if (!exists)
                _allMessages.Add(CloneSmsMessage(message));
        }

        SaveMessagesAsync();
        Dispatch(RebuildConversations);
    }

    private bool RemoveMessageFromLocalStore(SmsMessage msg)
    {
        bool removed;
        lock (_msgLock)
        {
            var before = _allMessages.Count;
            if (!string.IsNullOrEmpty(msg.Handle))
                _allMessages.RemoveAll(m => MessageStoreService.SameDevice(m.SourceDeviceAddress, msg.SourceDeviceAddress) && string.Equals(m.Handle, msg.Handle, StringComparison.OrdinalIgnoreCase));
            else if (!string.IsNullOrEmpty(msg.LocalId))
                _allMessages.RemoveAll(m => MessageStoreService.SameDevice(m.SourceDeviceAddress, msg.SourceDeviceAddress) && string.Equals(m.LocalId, msg.LocalId, StringComparison.OrdinalIgnoreCase));
            else
                _allMessages.Remove(msg);

            removed = _allMessages.Count != before;
        }

        if (!removed)
            return false;

        SaveMessagesAsync();
        Dispatch(RebuildConversations);
        return true;
    }

    private async Task<int> ReconcilePhoneMessageDeletesAsync(CancellationToken ct, bool force = false)
    {
        if (_map == null || !_map.IsConnected)
            return 0;

        var now = DateTime.UtcNow;
        if (!force && now < _nextMessageDeleteReconcileUtc)
            return 0;

        if (!await _messageDeleteReconcileLock.WaitAsync(0, ct))
            return 0;

        try
        {
            _nextMessageDeleteReconcileUtc = now + MessageDeleteReconcileInterval;

            var phoneHandles = force
                ? await _map.GetVisibleMessageHandlesAsync(ct)
                : await _map.GetRecentVisibleMessageHandlesAsync(AutomaticDeleteReconcilePhoneWindowPerFolder, ct);

            int removedCount = 0;
            lock (_msgLock)
            {
                var handlesToRemove = force
                    ? _allMessages
                        .Where(m => MessageBelongsToActiveDevice(m) && !string.IsNullOrWhiteSpace(m.Handle) && !phoneHandles.Contains(m.Handle))
                        .Select(m => m.Handle)
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToHashSet(StringComparer.OrdinalIgnoreCase)
                    : _allMessages
                        .Where(m => MessageBelongsToActiveDevice(m) && !string.IsNullOrWhiteSpace(m.Handle))
                        .GroupBy(m => m.IsSent)
                        .SelectMany(g => g
                            .OrderByDescending(m => m.Timestamp)
                            .Take(AutomaticDeleteReconcilePruneWindowPerFolder))
                        .Where(m => !phoneHandles.Contains(m.Handle))
                        .Select(m => m.Handle)
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToHashSet(StringComparer.OrdinalIgnoreCase);

                if (handlesToRemove.Count == 0)
                    return 0;

                var filtered = _allMessages
                    .Where(m => !MessageBelongsToActiveDevice(m) || string.IsNullOrWhiteSpace(m.Handle) || !handlesToRemove.Contains(m.Handle))
                    .ToList();
                removedCount = _allMessages.Count - filtered.Count;
                if (removedCount == 0)
                    return 0;

                _allMessages = filtered;
            }

            SaveMessagesAsync();
            Dispatch(RebuildConversations);
            AppendDebugThreadSafe(force
                ? $"[DELETE SYNC] Removed {removedCount} message(s) after a full phone-history reconcile."
                : $"[DELETE SYNC] Removed {removedCount} recent message(s) that no longer exist in the phone's live history window.");
            return removedCount;
        }
        catch (OperationCanceledException) { return 0; }
        catch (Exception ex)
        {
            AppendDebugThreadSafe($"[DELETE SYNC] {ex.Message}");
            return 0;
        }
        finally
        {
            _messageDeleteReconcileLock.Release();
        }
    }

    // ── Reconnect to most-recent saved device (no scan required) ─────────
    private async Task ReconnectToMostRecentAsync()
    {
        var recent = _settings.DefaultDevice;
        if (recent is null)
        {
            AppendDebug("[CONNECT] No default phone selected; auto-connect skipped.");
            return;
        }
        ShowReconnectPrompt = false;
        await ConnectToAddressAsync(recent.Address, recent.Name);
    }

    // ── Connect to a device by saved address (skips BT scan) ─────────────
    private async Task ConnectToAddressAsync(string addressStr, string? name = null)
    {
        try
        {
            var addr   = BluetoothAddress.Parse(addressStr);
            var device = name != null
                ? new BluetoothDeviceModel(addr, name, isPaired: true)
                : new BluetoothDeviceModel(addr, addressStr, isPaired: true);

            SelectedDevice = device;
            await ConnectAsync();
        }
        catch (Exception ex)
        {
            AppendDebug($"[CONNECT-SAVED FAIL] {ex.Message}");
            ConnectionStatus = "Connection failed — try scanning for device";
        }
    }

    // ── BT Scan ───────────────────────────────────────────────────────────
    private async Task ConnectScannedDeviceAsync(string address)
    {
        var device = Devices.FirstOrDefault(d =>
            d.Address.ToString().Equals(address, StringComparison.OrdinalIgnoreCase));
        if (device == null)
        {
            StatusBt = "Scanned device not found - scan again";
            return;
        }

        SelectedDevice = device;
        await ConnectAsync();
    }

    private async Task ResetConnectionSessionAsync()
    {
        AppendDebug("[CONNECT] Clean Bluetooth profile disconnect before reconnect.");
        _sessionCts.Cancel();
        // 2 s: give background tasks time to observe the cancellation and exit before
        // we dispose the services they're using.  200 ms was too short — tasks mid-RFCOMM
        // would race the dispose, and the OS wouldn't have released the socket channel
        // by the time the next ConnectAsync started, causing WSAEADDRINUSE on every retry.
        await Task.Delay(2000);

        if (_hfp is not null)
        {
            try
            {
                if (_hfp.CurrentCall.Status != CallStatus.Idle)
                    await _hfp.HangUpAsync();
            }
            catch { }
            try { await _hfp.DisposeAsync(); } catch { }
            _hfp = null;
        }

        if (_map is not null)
        {
            try { await _map.DisposeAsync(); } catch { }
            _map = null;
        }

        _connectedDeviceAddress = null;
        ApplyVoicemailAlertState(false, null, persistForCurrentDevice: false);
        StatusHfp = "Not connected";
        StatusMap = "Not connected";
        SetPbapStatus(PbapAvailabilityKind.NotRun, "PBAP call-log sync has not run for the current phone yet.");
        _sessionCts = new CancellationTokenSource();
    }

    private async Task ScanAsync()
    {
        if (!BluetoothScanner.IsBluetoothAvailable())
        {
            StatusBt = "Bluetooth not available — is your adapter on?";
            return;
        }

        IsScanning = true;
        Devices.Clear();
        PairingGuidance = "";
        StatusBt = "Scanning...";

        try
        {
            var found = await _bt.DiscoverDevicesAsync(_sessionCts.Token);
            foreach (var d in found) Devices.Add(d);
            StatusBt = found.Count == 0 ? "No devices found" : $"{found.Count} device(s) found";

            if (found.Count > 0)
            {
                SelectedDevice = found.FirstOrDefault(d =>
                    d.Name.Contains("fig", StringComparison.OrdinalIgnoreCase) ||
                    d.Name.Contains("phone", StringComparison.OrdinalIgnoreCase))
                    ?? found[0];
            }

            if (SelectedDevice != null && !SelectedDevice.IsPaired)
                PairingGuidance = BuildPairingGuidance(paired: false);
        }
        catch (Exception ex) { StatusBt = $"Scan error: {ex.Message}"; }
        finally { IsScanning = false; }
    }

    // ── Connect ───────────────────────────────────────────────────────────
    private async Task ConnectAsync()
    {
        if (SelectedDevice is null) return;

        if (!SelectedDevice.IsPaired)
        {
            PairingGuidance = BuildPairingGuidance(paired: false);
            StatusBt = "Device not paired — see instructions below";
            return;
        }

        // Prevent concurrent connects (UI button + API /connect can both fire).
        if (!await _connectLock.WaitAsync(0)) return;

        IsConnecting = true;
        PairingGuidance = "";
        ConnectionStatus = "Connecting...";

        try
        {
        await ResetConnectionSessionAsync();
        var ct = _sessionCts.Token;

        // ── Calls (HFP) ────────────────────────────────────────────────
        _hfp = new HfpService();
        _hfp.StatusChanged    += s    => Dispatch(() => StatusHfp = s);
        _hfp.AtLogLine        += s    => Dispatch(() => AppendDebug(s));
        _hfp.CallStateChanged += call => Dispatch(() => HandleCallStateChange(call));
        // Desk-mode auto-engage runs off the UI thread — audio device setup can
        // block for ~100 ms and must never stall the dispatcher.
        _hfp.CallStateChanged += call => Task.Run(() =>
            _api.CallAudio.OnCallStateChanged(call.Status == CallStatus.Active));
        _hfp.IndicatorChanged += (name, value) => Dispatch(() => HandlePhoneIndicator(name, value));

        try
        {
            await _hfp.ConnectAsync(SelectedDevice.Address, ct);
            _settings.SaveDevice(SelectedDevice.Address.ToString(), SelectedDevice.Name);
            _connectedDeviceAddress = SelectedDevice.Address.ToString();
            Dispatch(() => RefreshKnownDevices());
            Dispatch(RestoreVoicemailAlertForCurrentDevice);
            _ = Task.Run(async () =>
            {
                try
                {
                    Dispatch(() => SetPbapStatus(PbapAvailabilityKind.Checking, "Checking whether DeskPhone can open PBAP call-log access..."));
                    var result = await _pbap.ConnectAsync(SelectedDevice.Address, ct);
                    if (!result.IsConnected)
                    {
                        Dispatch(() => SetPbapStatus(result.Kind, result.Summary, result.Guidance));
                        AppendDebugThreadSafe($"[PBAP] {result.Summary}");
                        return;
                    }

                    Dispatch(() => SetPbapStatus(PbapAvailabilityKind.Checking, "PBAP connected. Importing phone call log..."));
                    AppendDebugThreadSafe($"[PBAP] {result.Summary}");

                    var importResult = await _pbap.ImportCallLogsAsync(SelectedDevice.Address, ct);
                    if (importResult.Succeeded)
                    {
                        var existing = _pbapCallLogStore.Load();
                        var replaced = _pbapCallLogStore.ReplaceDeviceEntries(existing, SelectedDevice.Address.ToString(), importResult.Entries);
                        var filtered = _callLogSync.ApplyPendingOutboundDeletes(SelectedDevice.Address.ToString(), replaced.merged);
                        var suppressedCount = replaced.merged.Count - filtered.Count;
                        _pbapCallLogStore.Save(filtered);
                        Dispatch(() =>
                        {
                            MergePbapCallHistoryCache(filtered);
                            SyncContactsFromPhoneCallerNames(importResult.Entries);
                        });
                        var summary = $"{importResult.Summary} Added {replaced.addedCount} new entries, removed {replaced.removedCount} stale cached entries, and kept {suppressedCount} locally deleted item(s) hidden from reimport.";
                        Dispatch(() => SetPbapStatus(PbapAvailabilityKind.Connected, summary));
                        AppendDebugThreadSafe($"[PBAP] {summary}");
                    }
                    else
                    {
                        Dispatch(() => SetPbapStatus(importResult.Kind, importResult.Summary, importResult.Guidance));
                        AppendDebugThreadSafe($"[PBAP] {importResult.Summary}");
                    }
                }
                catch (OperationCanceledException) { }
                catch (Exception ex)
                {
                    AppendDebugThreadSafe($"[PBAP] Connection task failed: {ex.Message}");
                    Dispatch(() => SetPbapStatus(
                        PbapAvailabilityKind.Error,
                        $"PBAP connection failed: {ex.Message}",
                        "Reconnect the phone and try again. If PBAP keeps failing while calls and messages still work, unpair and pair the phone again."));
                }
            }, ct);
        }
        catch (Exception ex)
        {
            var msg = FriendlyBtError(ex, "Calls");
            StatusHfp = msg;
            SetPbapStatus(PbapAvailabilityKind.Error, "PBAP connection check skipped because calls never established a stable Bluetooth link.");
            AppendDebug($"[CALLS ERROR] {ex.GetType().Name}: {ex.Message}");
            PairingGuidance = BuildPairingGuidance(paired: true, errorHint: ex.Message);
        }

        // ── Messages (MAP) ──────────────────────────────────────────────
        // All MAP work runs on a background thread so the WPF dispatcher stays
        // responsive during RFCOMM connect + initial sync (which can take 5–30s).
        // Status/log events are wired through Dispatch() so UI updates are safe.
        _map = new MapService();
        _map.StatusChanged += s => Dispatch(() => StatusMap = s);
        _map.MapLogLine    += s => Dispatch(() => AppendDebug(s));
        _map.InboxChangeDetected += HandleInboxChangeDetected;

        var mapDevice = SelectedDevice;   // capture before leaving UI thread
        _ = Task.Run(async () =>
        {
            try
            {
                await _map.ConnectAsync(mapDevice.Address, ct);
                if (!string.IsNullOrWhiteSpace(_connectedDeviceAddress))
                    MigrateLegacyDeviceScope(_connectedDeviceAddress);
                Dispatch(() =>
                {
                    RestoreVoicemailAlertForCurrentDevice();
                    lock (_contactLock)
                        RebuildContactLookupLocked();
                    RefreshAllContactCollections();
                    RebuildConversations();
                    RefreshContactSyncState();
                });

                // Seed known handles so the initial probe skips bodies we already have.
                List<SmsMessage> snapshot;
                lock (_msgLock) { snapshot = _allMessages.Where(MessageBelongsToActiveDevice).ToList(); }
                _map.SeedKnownHandles(snapshot.Select(m => m.Handle));

                // Initial sync — fast (listing-only probe) if nothing new, otherwise
                // downloads up to 5 bodies per folder.
                await RefreshMessagesAsync();

                // Re-fetch MMS that failed to parse last session.
                if (_pendingMmsHandles.Count > 0)
                {
                    AppendDebugThreadSafe($"[MMS] Re-fetching {_pendingMmsHandles.Count} unparsed MMS from last session");
                    var refetched = await _map.FetchHandlesAsync(_pendingMmsHandles, ct);
                    TagMessagesWithActiveDevice(refetched);
                    _pendingMmsHandles.Clear();
                    if (refetched.Count > 0)
                    {
                        List<SmsMessage> merged;
                        lock (_msgLock)
                        {
                            (merged, _) = _store.Merge(_allMessages, refetched);
                            _allMessages = merged;
                        }
                        _ = Task.Run(() => _store.Save(_allMessages.ToList()));
                        Dispatch(() => RebuildConversations());
                    }
                }

                var mapNotificationsEnabled = await _map.RegisterForNotificationsAsync(true, ct);
                AppendDebugThreadSafe(mapNotificationsEnabled
                    ? "[POLL] MAP event notifications enabled; delta polling remains the safety net."
                    : "[POLL] MAP event notifications unavailable; using adaptive delta polling fallback.");
                StartPollLoop(ct);
                StartOrQueueFullHistoryLoader(ct, "Messages connected");
                StartContactSyncLoop(ct);
            }
            catch (Exception ex)
            {
                var msg = FriendlyBtError(ex, "Messages");
                Dispatch(() => StatusMap = msg);
                AppendDebugThreadSafe($"[MESSAGES ERROR] {ex.GetType().Name}: {ex.Message}");
            }
        }, ct);

        } // end outer try
        finally
        {
            IsConnecting = false;
            _notif.UpdateStatus(
                ConnectionTextLooksConnected(StatusHfp),
                ConnectionTextLooksConnected(StatusMap));
            RefreshAudioDevices();
            _connectLock.Release();
        }
    }

    // ── Call state machine ────────────────────────────────────────────────
    private void HandleCallStateChange(CallInfo newCall)
    {
        if (!string.IsNullOrWhiteSpace(newCall.Number))
        {
            var normalizedPhone = ContactStoreService.NormalizePhone(newCall.Number);
            var resolvedName = LookupBestCallerName(newCall.Number);
            if (!string.IsNullOrWhiteSpace(resolvedName) &&
                (string.IsNullOrWhiteSpace(newCall.DisplayName)
                 || LooksLikePhonePlaceholderName(newCall.DisplayName, normalizedPhone)))
            {
                newCall.DisplayName = resolvedName;
            }
        }

        var prev = CurrentCall;
        CurrentCall = newCall;

        if (newCall.Status == CallStatus.IncomingRinging &&
            prev.Status   != CallStatus.IncomingRinging)
        {
            // Only show notification if we have a phone number (wait for +CLIP event)
            // If number is missing, the next state update will have it and show the notification then
            if (!string.IsNullOrWhiteSpace(newCall.Number))
                _notif.ShowIncomingCall(newCall.DisplayNumber, newCall.Number);
        }
        else if (newCall.Status == CallStatus.IncomingRinging &&
                 prev.Status   == CallStatus.IncomingRinging &&
                 string.IsNullOrWhiteSpace(prev.Number) &&
                 !string.IsNullOrWhiteSpace(newCall.Number))
        {
            // Number just arrived from +CLIP event while call is ringing—show notification now
            _notif.ShowIncomingCall(newCall.DisplayNumber, newCall.Number);
        }

        if (newCall.Status != CallStatus.IncomingRinging)
            _notif.StopCallAlert();

        // No software audio bridge — see scratch/option3_research/README.md.  Call
        // audio plays on the phone (or, if the user has a USB-paired speakerphone
        // set as the Windows default comms device, through that hardware).

        if (newCall.Status == CallStatus.Idle && prev.Status != CallStatus.Idle)
        {
            var duration = prev.Status == CallStatus.Active && prev.StartTime != default
                ? DateTime.Now - prev.StartTime
                : TimeSpan.Zero;

            var terminalDirection = newCall.Direction == CallDirection.Missed
                ? CallDirection.Missed
                : prev.Direction;

            var direction = terminalDirection == CallDirection.Incoming && duration == TimeSpan.Zero
                ? CallDirection.Missed
                : terminalDirection;

            var number = newCall.Number ?? prev.Number ?? prev.DisplayNumber;

            MergeLiveCallRecord(new CallRecord
            {
                Number    = number,
                Name      = prev.DisplayName,
                Direction = direction,
                Time      = DateTime.Now,
                Duration  = duration,
                SourceDeviceAddress = _connectedDeviceAddress
            });

            if (direction == CallDirection.Missed)
                SurfaceMissedCallAlert(number, prev.DisplayName);
        }

        RefreshAudioDevices();
    }

    private void LoadPbapCallHistoryCache()
    {
        var cached = _pbapCallLogStore.Load();
        if (cached.Count == 0) return;

        MergePbapCallHistoryCache(cached);
        SyncContactsFromPhoneCallerNames(cached);
        AppendDebug($"[CALL-HISTORY] Loaded {cached.Count} PBAP cached records into merged call history");
    }

    private void MergePbapCallHistoryCache(IEnumerable<PbapCallLogEntry> cachedEntries)
    {
        var importedCount = 0;
        var mergedExistingCount = 0;
        var merged = CallHistory.Select(CloneCallRecord).ToList();

        foreach (var entry in cachedEntries.OrderByDescending(entry => entry.Time))
        {
            var imported = MapPbapCallLogEntry(entry);
            var exact = merged.FirstOrDefault(record =>
                record.IsPhoneSynced &&
                string.Equals(record.PhoneLogTimestamp, imported.PhoneLogTimestamp, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(ContactStoreService.NormalizePhone(record.Number), ContactStoreService.NormalizePhone(imported.Number), StringComparison.OrdinalIgnoreCase) &&
                record.Direction == imported.Direction);

            if (exact is not null)
            {
                MergeImportedIntoExistingRecord(exact, imported);
                mergedExistingCount++;
                continue;
            }

            var liveMatch = merged.FirstOrDefault(record =>
                SamePhone(record.Number, imported.Number) &&
                record.Direction == imported.Direction &&
                IsSameCallWindow(record.Time, imported.Time));

            if (liveMatch is not null)
            {
                MergeImportedIntoExistingRecord(liveMatch, imported);
                mergedExistingCount++;
                continue;
            }

            merged.Add(imported);
            importedCount++;
        }

        ReplaceCallHistory(merged);
        AppendDebug($"[CALL-HISTORY] PBAP merge applied: {importedCount} inserted, {mergedExistingCount} matched, {merged.Count} total");
    }

    private void SyncContactsFromPhoneCallerNames(IEnumerable<PbapCallLogEntry> entries)
    {
        var candidates = entries
            .Select(entry => new
            {
                Phone = ContactStoreService.NormalizePhone(entry.Number),
                Name = entry.Name?.Trim(),
                entry.SourceDeviceAddress,
                entry.SourceObject,
                entry.Time,
                entry.ImportedAt
            })
            .Where(entry =>
                !string.IsNullOrWhiteSpace(entry.Phone) &&
                !string.IsNullOrWhiteSpace(entry.Name) &&
                !LooksLikePhonePlaceholderName(entry.Name, entry.Phone))
            .GroupBy(entry => entry.Phone!, StringComparer.OrdinalIgnoreCase)
            .Select(group => group
                .OrderByDescending(entry => entry.Time)
                .ThenByDescending(entry => entry.ImportedAt)
                .First())
            .ToList();

        if (candidates.Count == 0)
            return;

        int added = 0;
        int updated = 0;

        lock (_contactLock)
        {
            foreach (var candidate in candidates)
            {
                var existing = _contacts.FirstOrDefault(contact =>
                    MessageStoreService.SameDevice(contact.SourceDeviceAddress, candidate.SourceDeviceAddress) &&
                    contact.PhoneNumbers.Any(phone =>
                        ContactStoreService.PhoneNumbersLikelyMatch(phone, candidate.Phone)));

                var sourceFileName = string.IsNullOrWhiteSpace(candidate.SourceObject)
                    ? "pbap:call-log"
                    : $"pbap:{candidate.SourceObject}";

                if (existing == null)
                {
                    _contacts.Add(new ContactEntry
                    {
                        DisplayName = candidate.Name!,
                        PhoneNumbers = new List<string> { candidate.Phone! },
                        SourceDeviceAddress = candidate.SourceDeviceAddress ?? "",
                        SourceFileName = sourceFileName,
                        ImportedAt = DateTime.Now
                    });
                    added++;
                    continue;
                }

                bool changed = false;

                if (CanReplaceStoredContactName(existing, candidate.Name!, candidate.Phone!))
                {
                    existing.DisplayName = candidate.Name!;
                    changed = true;
                }

                if (string.IsNullOrWhiteSpace(existing.SourceDeviceAddress)
                    && !string.IsNullOrWhiteSpace(candidate.SourceDeviceAddress))
                {
                    existing.SourceDeviceAddress = candidate.SourceDeviceAddress;
                    changed = true;
                }

                if ((string.IsNullOrWhiteSpace(existing.SourceFileName)
                        || existing.SourceFileName.StartsWith("pbap:", StringComparison.OrdinalIgnoreCase))
                    && !string.Equals(existing.SourceFileName, sourceFileName, StringComparison.OrdinalIgnoreCase))
                {
                    existing.SourceFileName = sourceFileName;
                    changed = true;
                }

                if (changed)
                {
                    existing.ImportedAt = DateTime.Now;
                    updated++;
                }
            }

            if (added > 0 || updated > 0)
            {
                RebuildContactLookupLocked();
                _contactStore.Save(_contacts);
            }
        }

        if (added > 0 || updated > 0)
        {
            AppendDebug($"[CONTACTS] Auto-synced {added} new contact(s) and refreshed {updated} existing contact(s) from phone caller names");
            RefreshContactBackedUi();
            RefreshContactSyncState();
        }
    }

    private static bool CanReplaceStoredContactName(ContactEntry contact, string incomingName, string normalizedPhone)
    {
        if (string.Equals(contact.DisplayName, incomingName, StringComparison.OrdinalIgnoreCase))
            return false;

        if (LooksLikePhonePlaceholderName(contact.DisplayName, normalizedPhone))
            return true;

        return contact.SourceFileName.StartsWith("pbap:", StringComparison.OrdinalIgnoreCase);
    }

    private static bool LooksLikePhonePlaceholderName(string? name, string normalizedPhone)
    {
        if (string.IsNullOrWhiteSpace(name))
            return true;

        var trimmed = name.Trim();
        if (string.Equals(trimmed, normalizedPhone, StringComparison.OrdinalIgnoreCase))
            return true;

        if (string.Equals(trimmed, Conversation.FormatPhone(normalizedPhone), StringComparison.OrdinalIgnoreCase))
            return true;

        var normalizedName = ContactStoreService.NormalizePhone(trimmed);
        return !string.IsNullOrWhiteSpace(normalizedName)
            && string.Equals(normalizedName, normalizedPhone, StringComparison.OrdinalIgnoreCase);
    }

    private void MergeLiveCallRecord(CallRecord liveRecord)
    {
        var match = CallHistory.FirstOrDefault(record =>
            record.IsPhoneSynced &&
            SamePhone(record.Number, liveRecord.Number) &&
            record.Direction == liveRecord.Direction &&
            IsSameCallWindow(record.Time, liveRecord.Time));

        if (match is not null)
        {
            MergeLiveIntoExistingRecord(match, liveRecord);
            ReplaceCallHistory(CallHistory.Select(CloneCallRecord));
            AppendDebug($"[CALL-HISTORY] Live call merged into synced history for {liveRecord.Number}");
            CommandManager.InvalidateRequerySuggested();
            return;
        }

        CallHistory.Insert(0, liveRecord);
        NotifySelectedConversationDetailsChanged();
        AppendDebug($"[CALL-HISTORY] Added live-only call record for {liveRecord.Number}");
        CommandManager.InvalidateRequerySuggested();
    }

    private static CallRecord MapPbapCallLogEntry(PbapCallLogEntry entry) => new()
    {
        Number = entry.Number,
        Name = entry.Name,
        Direction = entry.Direction,
        Time = entry.Time,
        Duration = TimeSpan.Zero,
        IsPhoneSynced = true,
        PhoneLogTimestamp = entry.RawTimestamp,
        PhoneLogSourceObject = entry.SourceObject,
        SourceDeviceAddress = entry.SourceDeviceAddress
    };

    private static void MergeImportedIntoExistingRecord(CallRecord target, CallRecord imported)
    {
        if (string.IsNullOrWhiteSpace(target.Number))
            target.Number = imported.Number;
        if (!string.IsNullOrWhiteSpace(imported.Name) &&
            (string.IsNullOrWhiteSpace(target.Name)
             || LooksLikePhonePlaceholderName(target.Name, ContactStoreService.NormalizePhone(imported.Number))))
            target.Name = imported.Name;
        if (!target.IsPhoneSynced || target.Time == default)
            target.Time = imported.Time;
        else if (target.Duration == TimeSpan.Zero)
            target.Time = imported.Time;

        target.IsPhoneSynced = true;
        target.PhoneLogTimestamp = imported.PhoneLogTimestamp;
        target.PhoneLogSourceObject = imported.PhoneLogSourceObject;
        target.SourceDeviceAddress = imported.SourceDeviceAddress;
    }

    private static void MergeLiveIntoExistingRecord(CallRecord target, CallRecord liveRecord)
    {
        if (string.IsNullOrWhiteSpace(target.Number))
            target.Number = liveRecord.Number;
        if (!string.IsNullOrWhiteSpace(liveRecord.Name) &&
            (string.IsNullOrWhiteSpace(target.Name)
             || LooksLikePhonePlaceholderName(target.Name, ContactStoreService.NormalizePhone(liveRecord.Number))))
            target.Name = liveRecord.Name;
        if (liveRecord.Duration > target.Duration)
            target.Duration = liveRecord.Duration;
    }

    private void ReplaceCallHistory(IEnumerable<CallRecord> records)
    {
        var ordered = records
            .Where(CallRecordBelongsToActiveDevice)
            .OrderByDescending(record => record.Time)
            .ThenByDescending(record => record.IsPhoneSynced)
            .ToList();

        CallHistory.Clear();
        foreach (var record in ordered)
            CallHistory.Add(record);

        NotifySelectedConversationDetailsChanged();
        CommandManager.InvalidateRequerySuggested();
    }

    private static CallRecord CloneCallRecord(CallRecord record) => new()
    {
        Number = record.Number,
        Name = record.Name,
        Direction = record.Direction,
        Time = record.Time,
        Duration = record.Duration,
        IsPhoneSynced = record.IsPhoneSynced,
        PhoneLogTimestamp = record.PhoneLogTimestamp,
        PhoneLogSourceObject = record.PhoneLogSourceObject,
        SourceDeviceAddress = record.SourceDeviceAddress
    };

    private static bool SamePhone(string? left, string? right) =>
        ContactStoreService.PhoneNumbersLikelyMatch(left, right);

    private static bool IsSameCallWindow(DateTime left, DateTime right) =>
        Math.Abs((left - right).TotalMinutes) <= 2;

    // ── Call controls ─────────────────────────────────────────────────────
    private async Task AnswerAsync()
    {
        if (_hfp is null) return;
        _notif.StopCallAlert();
        try   { await _hfp.AnswerAsync(); }
        catch (Exception ex) { AppendDebug($"[ANSWER ERROR] {ex.Message}"); }
    }

    private async Task HangUpAsync()
    {
        if (_hfp is null) return;
        _notif.StopCallAlert();
        try   { await _hfp.HangUpAsync(); }
        catch (Exception ex) { AppendDebug($"[HANGUP ERROR] {ex.Message}"); }
    }

    private async Task DialAsync()
    {
        if (_hfp is null) return;

        var target = ResolveDialTarget();
        if (string.IsNullOrWhiteSpace(target)) return;

        try   { await _hfp.DialAsync(target); DialNumber = ""; }
        catch (Exception ex) { AppendDebug($"[DIAL ERROR] {ex.Message}"); }
    }

    private string ResolveDialTarget()
    {
        var directNumber = ContactStoreService.NormalizePhone(DialNumber);
        if (!string.IsNullOrWhiteSpace(directNumber))
            return directNumber;

        var contactNumber = SelectedCallContact?.PhoneNumber
                            ?? CallContacts.FirstOrDefault()?.PhoneNumber;
        return ContactStoreService.NormalizePhone(contactNumber);
    }

    private async Task DialVoicemailAsync()
    {
        ApplyVoicemailAlertState(false, null, persistForCurrentDevice: true);
        DialNumber = "*86";
        await DialAsync();
    }

    private int _priorityPauseCounter = 0;
    private bool _isHistoryPriorityPaused;
    private void HandleInboxChangeDetected() =>
        BeginHistoryPriorityPause("incoming message", TimeSpan.FromSeconds(10));

    private void BeginHistoryPriorityPause(string reason, TimeSpan duration)
    {
        // If already paused manually by user (counter is 0), don't interfere
        if (PauseHistoryActivity && _priorityPauseCounter == 0) return;

        _ = Task.Run(async () =>
        {
            Interlocked.Increment(ref _priorityPauseCounter);
            _isHistoryPriorityPaused = true;
            AppendDebugThreadSafe($"[POLL] Priority window: pausing full history load for {duration.TotalSeconds:0}s ({reason})");

            await Task.Delay(duration);

            if (Interlocked.Decrement(ref _priorityPauseCounter) == 0)
            {
                _isHistoryPriorityPaused = false;
                AppendDebugThreadSafe("[POLL] Priority window complete: resuming full history load");
            }
        });
    }

    // ── Picture-text relay media (resized previews, uploaded out-of-band) ─────
    private readonly object _mediaCacheLock = new();
    private readonly Dictionary<string, string?> _mediaPreviewCache = new();
    private const int RelayMediaScanLimit = 150;

    // Build (mediaId, dataUrl) previews for image attachments in the recent relay
    // window. Each image is resized once and cached; RelayService uploads any that
    // haven't been sent to phone-media/{id} yet.
    private List<(string id, string dataUrl)> BuildRelayMedia()
    {
        List<SmsMessage> snapshot;
        lock (_msgLock)
            snapshot = _allMessages
                .Where(MessageBelongsToActiveDevice)
                .OrderByDescending(m => m.Timestamp)
                .Take(RelayMediaScanLimit)
                .ToList();

        var result = new List<(string, string)>();
        foreach (var m in snapshot)
        foreach (var a in m.Attachments)
        {
            if (!a.IsImage || a.Data.Length == 0) continue;
            var id = MediaId(a.Data);
            string? url;
            lock (_mediaCacheLock)
            {
                if (!_mediaPreviewCache.TryGetValue(id, out url))
                {
                    url = DownscaleImageToDataUrl(a.Data);
                    if (_mediaPreviewCache.Count > 400) _mediaPreviewCache.Clear();
                    _mediaPreviewCache[id] = url;
                }
            }
            if (!string.IsNullOrEmpty(url)) result.Add((id, url!));
        }
        return result;
    }

    // Short stable id from the original image bytes — must match the serializer's mediaId.
    private static string MediaId(byte[] data)
        => Convert.ToHexString(System.Security.Cryptography.SHA1.HashData(data), 0, 8).ToLowerInvariant();

    // Resize an image to a phone-screen-sized JPEG data: URL (keeps it under Firestore's
    // 1 MiB doc cap). Returns null if the bytes aren't a decodable image.
    private static string? DownscaleImageToDataUrl(byte[] data, int maxDim = 1280, int quality = 72)
    {
        try
        {
            using var ms = new MemoryStream(data);
            var decoder = System.Windows.Media.Imaging.BitmapDecoder.Create(
                ms,
                System.Windows.Media.Imaging.BitmapCreateOptions.PreservePixelFormat,
                System.Windows.Media.Imaging.BitmapCacheOption.OnLoad);
            var frame = decoder.Frames[0];
            double scale = Math.Min(1.0, (double)maxDim / Math.Max(frame.PixelWidth, frame.PixelHeight));
            System.Windows.Media.Imaging.BitmapSource src = frame;
            if (scale < 1.0)
            {
                var t = new System.Windows.Media.Imaging.TransformedBitmap(
                    frame, new System.Windows.Media.ScaleTransform(scale, scale));
                t.Freeze();
                src = t;
            }
            var encoder = new System.Windows.Media.Imaging.JpegBitmapEncoder { QualityLevel = quality };
            encoder.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(src));
            using var outMs = new MemoryStream();
            encoder.Save(outMs);
            return $"data:image/jpeg;base64,{Convert.ToBase64String(outMs.ToArray())}";
        }
        catch
        {
            return null;
        }
    }

    private void RequestMessageSync(string reason, string? handle = null)
    {
        if (!string.IsNullOrWhiteSpace(handle))
            _priorityMessageHandles.Enqueue(handle.Trim());

        Interlocked.Increment(ref _messagePollWakeRequests);
        Interlocked.Exchange(ref _pendingPriorityMessageSync, 1);

        try
        {
            if (_messagePollWakeSignal.CurrentCount == 0)
                _messagePollWakeSignal.Release();
        }
        catch (SemaphoreFullException) { }

        if (!string.IsNullOrWhiteSpace(reason))
            AppendDebugThreadSafe($"[POLL] Immediate message sync requested: {reason}");
    }

    private void StartSendConfirmationFollowUp(string? localId)
    {
        BeginHistoryPriorityPause("send confirmation", TimeSpan.FromSeconds(20));

        _ = Task.Run(async () =>
        {
            var delays = new[] { 0, 1000, 2500, 5000, 9000, 15000 };
            foreach (var delay in delays)
            {
                if (delay > 0)
                    await Task.Delay(delay);

                if (_map?.IsConnected != true)
                    return;

                if (!string.IsNullOrWhiteSpace(localId))
                {
                    lock (_msgLock)
                    {
                        var pending = _allMessages.FirstOrDefault(m =>
                            string.Equals(m.LocalId, localId, StringComparison.OrdinalIgnoreCase));
                        if (pending == null || string.IsNullOrWhiteSpace(pending.SendStatus) || pending.IsSendFailed)
                            return;
                    }
                }

                RequestMessageSync("send confirmation");
            }
        });
    }

    private List<string> DrainPriorityMessageHandles()
    {
        var handles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        while (_priorityMessageHandles.TryDequeue(out var handle))
            if (!string.IsNullOrWhiteSpace(handle))
                handles.Add(handle.Trim());

        return handles.ToList();
    }

    // ── Background poll loop ──────────────────────────────────────────────
    // Runs entirely on a thread-pool thread — zero UI-thread involvement until
    // new messages actually arrive, at which point we Dispatch a tiny update.
    private void StartPollLoop(CancellationToken ct)
    {
        _pollLoop = Task.Run(async () =>
        {
            AppendDebugThreadSafe("[POLL] Background poll loop started");
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    var wokeEarly = await _messagePollWakeSignal.WaitAsync(MessagePollInterval, ct);
                    var coalescedWakeRequests = wokeEarly
                        ? Interlocked.Exchange(ref _messagePollWakeRequests, 0)
                        : 0;
                    if (ct.IsCancellationRequested) break;
                    if (_map == null || !_map.IsConnected)
                    {
                        Dispatch(() => StatusMap = "Messages disconnected");
                        QueueAutoReconnect("message sync stopped");
                        await Task.Delay(BusyMessagePollRetryInterval, ct);
                        continue;
                    }
                    if (IsRealOpActive)
                    {
                        if (coalescedWakeRequests > 0)
                            RequestMessageSync($"deferred while Bluetooth was busy ({coalescedWakeRequests} request(s))");
                        await Task.Delay(BusyMessagePollRetryInterval, ct);
                        continue;
                    }
                    // Pause MAP sync during active calls.  Android handles HFP + MAP over a
                    // single adapter; hammering MAP RFCOMM while SCO audio is live can make
                    // the phone unresponsive on the AT channel, causing spurious call drops.
                    if (CurrentCall.Status != CallStatus.Idle)
                    {
                        if (coalescedWakeRequests > 0)
                            RequestMessageSync("deferred — call in progress");
                        await Task.Delay(BusyMessagePollRetryInterval, ct);
                        continue;
                    }

                    if (!await _messageSyncLock.WaitAsync(0, ct))
                    {
                        if (coalescedWakeRequests > 0)
                            RequestMessageSync($"deferred while message sync was busy ({coalescedWakeRequests} request(s))");
                        continue;
                    }

                    Interlocked.Increment(ref _realOpCount);
                    // Per-round OBEX timeout: if the round doesn't finish the socket is
                    // silently dead (ghost connection).  60 s, not 20: this budget covers the
                    // WHOLE round, and a legitimate round with several MMS body downloads can
                    // exceed 20 s — cancelling it would abort the MAP socket and force a
                    // spurious full reconnect.  60 s still beats the 30-120 s Windows RFCOMM
                    // ghost window.  Using a linked CTS (not ct) so the timeout OCE falls to
                    // catch (Exception ex) → QueueAutoReconnect via the
                    // when (ct.IsCancellationRequested) guard above — it does NOT break the loop.
                    using var syncCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                    syncCts.CancelAfter(TimeSpan.FromSeconds(60));
                    try
                    {
                        var priorityHandles = DrainPriorityMessageHandles();
                        var priorityMessages = priorityHandles.Count > 0
                            ? await _map.FetchHandlesAsync(priorityHandles, syncCts.Token)
                            : new List<SmsMessage>();

                        var fromPhone = await _map.PerformDeltaSyncAsync(syncCts.Token);
                        if (priorityMessages.Count > 0)
                            fromPhone.InsertRange(0, priorityMessages);

                        TagMessagesWithActiveDevice(fromPhone);
                        int newCount = 0;
                        if (fromPhone.Count > 0)
                        {
                            // Merge on background thread — no UI involvement yet
                            List<SmsMessage> merged;
                            lock (_msgLock)
                            {
                                (merged, newCount) = _store.Merge(_allMessages, fromPhone);
                                _allMessages = merged;
                            }

                            // A phone-side sent message can replace a local "Confirming" bubble
                            // without increasing newCount, so always refresh after phone data arrives.
                            _ = Task.Run(() => _store.Save(merged), ct);
                            Dispatch(() =>
                            {
                                RebuildConversations();
                            });

                            if (newCount > 0)
                            {
                                Dispatch(() =>
                                {
                                    MarkIncomingUnread(fromPhone);
                                    // Only notify for messages that are UNREAD on the phone.
                                    // Without the !m.IsRead guard, messages that arrived while
                                    // DeskPhone was closed but were already read elsewhere
                                    // (phone, other device) would still fire a Windows alert
                                    // on every reconnect — which is what caused the "always
                                    // sends an alert upon open" bug.
                                    var newestIncoming = fromPhone
                                        .Where(m => !m.IsSent && !m.IsRead && ShouldSurfaceConversationAlert(m.NormalizedPhone))
                                        .OrderByDescending(m => m.Timestamp)
                                        .FirstOrDefault();
                                    if (newestIncoming != null)
                                        ShowIncomingMessageBanner(newestIncoming);
                                    if (newestIncoming != null)
                                        ShowMessageNotification(newestIncoming);
                                });
                                HandleInboxChangeDetected();
                                _nextPhoneReadStateRefreshUtc = DateTime.MinValue;
                            }
                        }

                        var now = DateTime.UtcNow;
                        if (newCount > 0 || now >= _nextPhoneReadStateRefreshUtc)
                        {
                            await RefreshPhoneReadStatesAsync(syncCts.Token);
                            _nextPhoneReadStateRefreshUtc = now.Add(PhoneReadStatePollInterval);
                        }
                        await ReconcilePhoneMessageDeletesAsync(syncCts.Token);
                    }
                    finally
                    {
                        Interlocked.Exchange(ref _pendingPriorityMessageSync, 0);
                        Interlocked.Decrement(ref _realOpCount);
                        _messageSyncLock.Release();
                    }
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
                catch (Exception ex)
                {
                    // Catches both real errors AND sync-round timeouts (OperationCanceledException
                    // whose token is NOT ct — those fall here because the when-guard above fails).
                    AppendDebugThreadSafe($"[POLL ERROR] {ex.Message}");
                    Dispatch(() => StatusMap = FriendlyBtError(ex, "Messages"));
                    QueueAutoReconnect("message sync failed");
                }
            }
            AppendDebugThreadSafe("[POLL] Background poll loop stopped");
        }, ct);
    }

    private void QueueAutoReconnect(string reason)
    {
        if (!HasQuickConnectDevice || IsConnecting || CurrentCall.Status != CallStatus.Idle)
            return;

        var now = DateTime.UtcNow;
        if (now < _nextAutoReconnectUtc)
            return;

        if (Interlocked.Exchange(ref _autoReconnectInFlight, 1) == 1)
            return;

        _nextAutoReconnectUtc = now.Add(AutoReconnectRetryWindow);
        AppendDebugThreadSafe($"[CONNECT] Auto-reconnect queued: {reason}");

        Dispatch(async () =>
        {
            try
            {
                ConnectionStatus = "Reconnecting...";
                ShowReconnectPrompt = false;
                await ReconnectToMostRecentAsync();
                if (IsFullyConnected)
                    _nextAutoReconnectUtc = DateTime.MinValue;
            }
            catch (Exception ex)
            {
                AppendDebug($"[CONNECT] Auto-reconnect failed: {ex.Message}");
            }
            finally
            {
                Interlocked.Exchange(ref _autoReconnectInFlight, 0);
            }
        });
    }

    /// <summary>
    /// Persistent watchdog that runs for the full lifetime of the app (uses _appCts,
    /// not _sessionCts).  Every 30 s: if not fully connected and not already in the
    /// middle of a connect attempt, queue a reconnect.
    ///
    /// This closes the "dead poll loop" bug: a failed reconnect attempt cancels
    /// _sessionCts (killing the MAP poll loop), and if MAP never re-establishes,
    /// nothing would call QueueAutoReconnect again — the watchdog fills that gap.
    /// </summary>
    private void StartConnectionWatchdog(CancellationToken ct)
    {
        _ = Task.Run(async () =>
        {
            AppendDebugThreadSafe("[WATCHDOG] Connection watchdog started (30 s interval)");
            while (!ct.IsCancellationRequested)
            {
                try { await Task.Delay(TimeSpan.FromSeconds(30), ct); }
                catch (OperationCanceledException) { break; }

                if (!IsFullyConnected && !IsConnecting)
                    QueueAutoReconnect("watchdog: not fully connected");
            }
            AppendDebugThreadSafe("[WATCHDOG] Connection watchdog stopped");
        }, ct);
    }

    private void StartContactSyncLoop(CancellationToken ct)
    {
        _contactPollLoop = Task.Run(async () =>
        {
            AppendDebugThreadSafe("[CONTACTS] Background contact sync loop started");
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    await Task.Delay(5000, ct);
                    if (ct.IsCancellationRequested) break;
                    if (string.IsNullOrWhiteSpace(_connectedDeviceAddress)) continue;

                    Dispatch(RefreshContactSyncState);
                }
                catch (OperationCanceledException) { break; }
                catch (Exception ex) { AppendDebugThreadSafe($"[CONTACTS] Poll error: {ex.Message}"); }
            }

            AppendDebugThreadSafe("[CONTACTS] Background contact sync loop stopped");
        }, ct);
    }

    // ── Full history loader ────────────────────────────────────────────────
    private string _fullHistoryStatus = "";
    public string FullHistoryStatus
    {
        get => _fullHistoryStatus;
        private set { _fullHistoryStatus = value; OnPropertyChanged(); }
    }

    private void StartFullHistoryLoader(CancellationToken ct)
    {
        if (_map == null || PauseHistoryActivity) return;
        if (_fullHistoryLoop is { IsCompleted: false })
        {
            AppendDebugThreadSafe("[FULLHIST] Loader already running; not starting a second history sync.");
            return;
        }

        _fullHistoryLoop = Task.Run(async () =>
        {
            try
            {
                // Small delay so the initial sync and poll loop settle first
                await Task.Delay(3000, ct);

                var knownHandles = new HashSet<string>(
                    StringComparer.OrdinalIgnoreCase);
                lock (_msgLock)
                {
                    foreach (var m in _allMessages.Where(MessageBelongsToActiveDevice))
                        if (!string.IsNullOrEmpty(m.Handle))
                            knownHandles.Add(m.Handle);
                }

                Dispatch(() => FullHistoryStatus = "Loading history…");

                // Get start offsets for the currently connected device
                int startInbox = 0, startSent = 0;
                var currentDevice = _settings.Current.KnownDevices.FirstOrDefault(d => d.Address.Equals(_connectedDeviceAddress, StringComparison.OrdinalIgnoreCase));
                if (currentDevice != null)
                {
                    // If the local store is completely empty, reset offsets to 0 (resync everything)
                    if (knownHandles.Count == 0)
                    {
                        currentDevice.HistoryOffsetInbox = 0;
                        currentDevice.HistoryOffsetSent = 0;
                        AppendDebugThreadSafe("[FULLHIST] Local store is empty — resetting offsets for full resync");
                    }

                    var savedOffsetTotal = currentDevice.HistoryOffsetInbox + currentDevice.HistoryOffsetSent;
                    if (savedOffsetTotal > 1000 && savedOffsetTotal > knownHandles.Count + 500)
                    {
                        AppendDebugThreadSafe($"[FULLHIST] Saved offsets look stale for local cache ({savedOffsetTotal} scanned vs {knownHandles.Count} cached handles); restarting history scan from top");
                        currentDevice.HistoryOffsetInbox = 0;
                        currentDevice.HistoryOffsetSent = 0;
                    }

                    startInbox = currentDevice.HistoryOffsetInbox;
                    startSent = currentDevice.HistoryOffsetSent;
                    AppendDebugThreadSafe($"[FULLHIST] Resuming from offsets Inbox={startInbox}, Sent={startSent}");
                }

                await _map.FullHistoryLoadAsync(
                    knownHandles,
                    isPaused: () => {
                        if (PauseHistoryActivity) throw new OperationCanceledException("Paused by user");
                        return IsRealOpActive || _isHistoryPriorityPaused || Volatile.Read(ref _pendingPriorityMessageSync) != 0;
                    },
                    onBatch: (batch, batchIdx, total) =>
                    {
                        TagMessagesWithActiveDevice(batch);
                        List<SmsMessage> merged;
                        lock (_msgLock)
                        {
                            (merged, _) = _store.Merge(_allMessages, batch);
                            _allMessages = merged;
                        }
                        var snapshot = _allMessages.ToList();
                        _ = Task.Run(() =>
                        {
                            _store.Save(snapshot);
                            // Milestone backup every 500 history downloads
                            int downloaded = (batchIdx + 1) * 25;
                            if (downloaded % 500 == 0)
                                _backup.CreateBackup($"hist{downloaded}");
                        });
                        Dispatch(() =>
                        {
                            RebuildConversations();
                            // total is -1 when unknown (interleaved mode) — show count instead
                            FullHistoryStatus = total > 0
                                ? $"Loading history {Math.Min((batchIdx + 1) * 25 * 100 / total, 100)}%…"
                                : $"Loading history ({(batchIdx + 1) * 25} msgs)…";
                        });
                    },
                    startInboxOffset: startInbox,
                    startSentOffset: startSent,
                    onProgress: (i, os) =>
                    {
                        if (currentDevice != null)
                        {
                            currentDevice.HistoryOffsetInbox = i;
                            currentDevice.HistoryOffsetSent = os;
                            _settings.Save(); // Persist progress
                        }
                    },
                    ct: ct);

                Dispatch(() =>
                {
                    FullHistoryStatus = "";
                });
            }
            catch (OperationCanceledException) { }
            catch (Exception ex)
            {
                AppendDebugThreadSafe($"[FULLHIST ERROR] {ex.Message}");
                Dispatch(() =>
                {
                    FullHistoryStatus = "";
                });
            }
        }, ct);
    }

    private void StartOrQueueFullHistoryLoader(CancellationToken ct, string reason)
    {
        if (_map == null || PauseHistoryActivity || ct.IsCancellationRequested) return;

        var running = _fullHistoryLoop;
        if (running is { IsCompleted: false })
        {
            if (Interlocked.Exchange(ref _queuedFullHistoryRestart, 1) == 0)
            {
                AppendDebugThreadSafe($"[FULLHIST] {reason}; waiting for current history loop to stop before restarting.");
                _ = running.ContinueWith(_ =>
                {
                    Interlocked.Exchange(ref _queuedFullHistoryRestart, 0);
                    if (ct.IsCancellationRequested || PauseHistoryActivity || _map == null || !_map.IsConnected)
                        return;

                    StartFullHistoryLoader(ct);
                }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
            }

            return;
        }

        StartFullHistoryLoader(ct);
    }

    // Thread-safe debug append (poll loop runs off-thread)
    private void AppendDebugThreadSafe(string line)
        => Dispatch(() => AppendDebug(line));

    // ── Messages ──────────────────────────────────────────────────────────
    // Called for the initial sync and manual refresh — runs on the caller's thread.
    // The poll loop does NOT call this; it calls PerformDeltaSyncAsync directly.
    private async Task RefreshMessagesAsync(bool forceDeleteReconcile = false)
    {
        if (_map == null || !_map.IsConnected) return;
        bool syncLockTaken = false;
        bool realOpStarted = false;
        try
        {
            await _messageSyncLock.WaitAsync(_sessionCts.Token);
            syncLockTaken = true;
            IsLoadingMessages = true;
            System.Threading.Interlocked.Increment(ref _realOpCount);
            realOpStarted = true;

            var fromPhone = await _map.PerformDeltaSyncAsync(_sessionCts.Token);
            TagMessagesWithActiveDevice(fromPhone);
            if (fromPhone.Count > 0)
            {
                List<SmsMessage> merged;
                int newCount;
                lock (_msgLock)
                {
                    (merged, newCount) = _store.Merge(_allMessages, fromPhone);
                    _allMessages = merged;
                }
                _ = Task.Run(() => _store.Save(merged));
                Dispatch(() =>
                {
                    RebuildConversations();
                    if (newCount > 0)
                    {
                        MarkIncomingUnread(fromPhone);
                        var newestIncoming = fromPhone
                            .Where(m => !m.IsSent && !m.IsRead && ShouldSurfaceConversationAlert(m.NormalizedPhone))
                            .OrderByDescending(m => m.Timestamp)
                            .FirstOrDefault();
                        if (newestIncoming != null)
                            ShowIncomingMessageBanner(newestIncoming);
                        if (newestIncoming != null)
                            ShowMessageNotification(newestIncoming);
                    }
                });
            }

            await RefreshPhoneReadStatesAsync(_sessionCts.Token);
            await ReconcilePhoneMessageDeletesAsync(_sessionCts.Token, force: forceDeleteReconcile);
        }
        catch (Exception ex) { AppendDebug($"[SYNC ERROR] {ex.Message}"); }
        finally
        {
            IsLoadingMessages = false;
            if (realOpStarted)
                System.Threading.Interlocked.Decrement(ref _realOpCount);
            if (syncLockTaken)
                _messageSyncLock.Release();
        }
    }



    private async Task<bool> SendMessageAsync()
    {
        if (string.IsNullOrWhiteSpace(ComposeToNumber)) return false;
        if (string.IsNullOrWhiteSpace(ComposeBody) && !HasComposeAttachments) return false;

        // The messages link may be mid-reconnect.  Do NOT silently drop the send —
        // record it as Failed so it appears in the conversation with a Retry button
        // instead of vanishing while the sender (UI, LAN, or relay) believes it went out.
        var mapReady = _map is not null && _map.IsConnected;

        IsSendingMessage = true;
        System.Threading.Interlocked.Increment(ref _realOpCount);
        var to   = ComposeToNumber.Trim();
        var body = NormalizeOutgoingMessageBody(ComposeBody);
        var stagedAttachments = ComposeAttachments
            .Select(attachment => new MessageAttachment
            {
                ContentType = attachment.ContentType,
                FileName = attachment.FileName,
                Data = attachment.Data.ToArray()
            })
            .ToList();
        var sent = new SmsMessage
        {
            From      = $"Me > {to}",
            Body      = body,
            Timestamp = DateTime.Now,
            IsRead    = true,
            IsSent    = true,
            SourceDeviceAddress = ActiveDeviceAddress,
            LocalId   = Guid.NewGuid().ToString("N"),
            SendStatus = mapReady ? "Sending" : "Failed"
        };
        sent.Attachments = stagedAttachments
            .Select(attachment => new MessageAttachment
            {
                ContentType = attachment.ContentType,
                FileName = attachment.FileName,
                Data = attachment.Data.ToArray()
            })
            .ToList();
        sent.IsMms = stagedAttachments.Count > 0;

        List<SmsMessage> snapshot;
        lock (_msgLock)
        {
            _allMessages.Insert(0, sent);
            snapshot = _allMessages.ToList();
        }
        _ = Task.Run(() => _store.Save(snapshot));

        var digits = new string(to.Where(char.IsDigit).ToArray());
        if (digits.Length == 11 && digits.StartsWith("1")) digits = digits[1..];
        var recipientPhone = digits;

        Dispatch(() =>
        {
            RebuildConversations();
            ComposeBody      = "";
            ClearComposeAttachments();
            ShowComposePanel = false;
            _drafts.Remove(recipientPhone);
            PersistDraftSnapshot();

            var conv = Conversations.FirstOrDefault(c => c.PhoneNumber == recipientPhone);
            if (conv != null) SelectedConversation = conv;
        });

        if (!mapReady)
        {
            AppendDebug("[SEND FAILED] Messages connection not ready — message saved as Failed; Retry will resend after reconnect");
            IsSendingMessage = false;
            System.Threading.Interlocked.Decrement(ref _realOpCount);
            return false;
        }

        var sendOk = false;
        try
        {
            var ok = await _map!.SendMessageAsync(to, body, stagedAttachments, _sessionCts.Token);
            sendOk = ok;
            if (ok)
            {
                AppendDebug("[SEND] Bluetooth accepted message; waiting for phone sent-folder confirmation");
                sent.SendStatus = "Confirming";
                lock (_msgLock)
                {
                    snapshot = _allMessages.ToList();
                }
                _ = Task.Run(() => _store.Save(snapshot));
                Dispatch(RebuildConversations);

                // Pull phone sync forward repeatedly until the phone's sent folder proves it.
                StartSendConfirmationFollowUp(sent.LocalId);
            }
            else
            {
                sent.SendStatus = "Failed";
                lock (_msgLock)
                {
                    snapshot = _allMessages.ToList();
                }
                _ = Task.Run(() => _store.Save(snapshot));
                AppendDebug("[SEND FAILED] Phone rejected the message — OBEX session may be stale; reconnecting automatically");
                // Stale OBEX session: the RFCOMM channel stays open so MAP still reports
                // "connected", but the phone's MAP server killed the session internally.
                // Trigger a reconnect so the next send attempt has a fresh session.
                Dispatch(() => _ = ReconnectToMostRecentAsync());
            }
        }
        catch (Exception ex)
        {
            sent.SendStatus = "Failed";
            lock (_msgLock)
            {
                snapshot = _allMessages.ToList();
            }
            _ = Task.Run(() => _store.Save(snapshot));
            AppendDebug($"[SEND ERROR] {ex.Message} — reconnecting automatically");
            // Stream exception during send means the OBEX connection is dead.
            // Reconnect so the next send has a live session.
            Dispatch(() => _ = ReconnectToMostRecentAsync());
        }
        finally
        {
            IsSendingMessage = false;
            System.Threading.Interlocked.Decrement(ref _realOpCount);
        }
        return sendOk;
    }

    // ── Conversation builder ──────────────────────────────────────────────
    /// <summary>
    /// Groups _allMessages by normalized phone number and syncs the Conversations
    /// collection without clearing it — preserves selection and scroll position.
    /// Must be called on the UI thread.
    /// </summary>
    private async Task RetryMessageAsync(SmsMessage? message)
    {
        if (message == null || !message.IsSent || !message.IsSendFailed)
            return;

        if (_map is null || !_map.IsConnected)
        {
            AppendDebug("[SEND RETRY] Messages connection is not active.");
            return;
        }

        var to = message.NormalizedPhone;
        if (string.IsNullOrWhiteSpace(to))
            to = message.From.Replace("Me >", "", StringComparison.OrdinalIgnoreCase).Trim();
        if (string.IsNullOrWhiteSpace(to) || string.IsNullOrWhiteSpace(message.Body))
            return;

        IsSendingMessage = true;
        message.SendStatus = "Sending";
        message.Timestamp = DateTime.Now;
        message.SourceDeviceAddress = ActiveDeviceAddress;
        if (string.IsNullOrWhiteSpace(message.LocalId))
            message.LocalId = Guid.NewGuid().ToString("N");

        SaveMessagesAsync();
        Dispatch(RebuildConversations);

        System.Threading.Interlocked.Increment(ref _realOpCount);
        try
        {
            var ok = await _map.SendMessageAsync(to, message.Body, ct: _sessionCts.Token);
            if (!ok)
            {
                message.SendStatus = "Failed";
                SaveMessagesAsync();
                AppendDebug("[SEND RETRY FAILED] Phone rejected the message.");
                return;
            }

            AppendDebug("[SEND RETRY] Bluetooth accepted message; waiting for phone sent-folder confirmation");
            message.SendStatus = "Confirming";
            SaveMessagesAsync();
            Dispatch(RebuildConversations);
            StartSendConfirmationFollowUp(message.LocalId);
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            message.SendStatus = "Failed";
            SaveMessagesAsync();
            AppendDebug($"[SEND RETRY ERROR] {ex.Message}");
        }
        finally
        {
            IsSendingMessage = false;
            System.Threading.Interlocked.Decrement(ref _realOpCount);
            Dispatch(RebuildConversations);
        }
    }

    private static string NormalizeOutgoingMessageBody(string value)
    {
        var normalized = (value ?? "")
            .Replace("\r\n", "\n")
            .Replace('\r', '\n')
            .Trim(' ', '\t');
        return normalized.Replace("\n", "\r\n");
    }

    private void ApplyConversationPreferences(Conversation conversation)
    {
        conversation.IsPinned = _settings.IsConversationPinned(conversation.PhoneNumber);
        conversation.AreAlertsMuted = _settings.AreConversationAlertsMuted(conversation.PhoneNumber);
        conversation.IsBlocked = _settings.IsConversationBlocked(conversation.PhoneNumber);
    }

    private void SortConversations()
    {
        IOrderedEnumerable<Conversation> sorted;
        if (_convSortMode == ConversationSortMode.UnreadFirst)
        {
            // Pinned always first, then unread (newest first), then read (newest first)
            sorted = Conversations
                .OrderByDescending(c => c.IsPinned)
                .ThenByDescending(c => c.IsUnread)
                .ThenByDescending(c => c.LastTimestamp);
        }
        else
        {
            sorted = Conversations
                .OrderByDescending(c => c.IsPinned)
                .ThenByDescending(c => c.LastTimestamp);
        }

        var sortedList = sorted.ToList();
        for (int i = 0; i < sortedList.Count; i++)
        {
            int ci = Conversations.IndexOf(sortedList[i]);
            if (ci != i) Conversations.Move(ci, i);
        }
    }

    private void RebuildConversations()
    {
        var selectedPhone = SelectedConversation?.PhoneNumber;

        var grouped = _allMessages
            .Where(m => MessageBelongsToActiveDevice(m) && !string.IsNullOrEmpty(m.NormalizedPhone))
            .GroupBy(m => m.NormalizedPhone)
            .OrderByDescending(g => g.Max(m => m.Timestamp))
            .ToList();

        var existingByPhone = Conversations.ToDictionary(c => c.PhoneNumber);
        var newPhones = new HashSet<string>(grouped.Select(g => g.Key));

        // Remove conversations that are no longer in data
        for (int i = Conversations.Count - 1; i >= 0; i--)
            if (!newPhones.Contains(Conversations[i].PhoneNumber))
                Conversations.RemoveAt(i);

        // Rebuild existing map after removals
        existingByPhone = Conversations.ToDictionary(c => c.PhoneNumber);

        // Update or add each conversation
        foreach (var g in grouped)
        {
            if (!existingByPhone.TryGetValue(g.Key, out var conv))
            {
                conv = new Conversation { PhoneNumber = g.Key };
                Conversations.Add(conv);
            }

            conv.ContactName = LookupContactName(g.Key);
            conv.IsUnread = g.Any(m => !m.IsSent && !m.IsRead);
            ApplyConversationPreferences(conv);

            conv.Messages.Clear();
            var sortedMessages = g.OrderBy(m => m.Timestamp).ToList();
            
            for (int i = 0; i < sortedMessages.Count; i++)
            {
                var cur = sortedMessages[i];
                var prev = i > 0 ? sortedMessages[i - 1] : null;
                var next = i < sortedMessages.Count - 1 ? sortedMessages[i + 1] : null;

                // Group if same sender and within 1 hour
                bool sameAsPrev = prev != null && prev.IsSent == cur.IsSent && (cur.Timestamp - prev.Timestamp).TotalHours < 1;
                bool sameAsNext = next != null && next.IsSent == cur.IsSent && (next.Timestamp - cur.Timestamp).TotalHours < 1;

                cur.IsFirstInGroup = !sameAsPrev;
                cur.IsLastInGroup = !sameAsNext;

                // Date dividers
                if (prev == null || cur.Timestamp.Date != prev.Timestamp.Date)
                {
                    cur.ShowDateDivider = true;
                    if (cur.Timestamp.Date == DateTime.Today) cur.DateDividerText = "Today";
                    else if (cur.Timestamp.Date == DateTime.Today.AddDays(-1)) cur.DateDividerText = "Yesterday";
                    else if (cur.Timestamp.Date > DateTime.Today.AddDays(-7)) cur.DateDividerText = cur.Timestamp.ToString("dddd");
                    else cur.DateDividerText = cur.Timestamp.ToString("MMM d, yyyy");
                }
                else
                {
                    cur.ShowDateDivider = false;
                }

                conv.Messages.Add(cur);
            }
            conv.NotifyChanged();
        }

        // Re-sort without clearing so selection and scroll position survive updates.
        SortConversations();

        // Restore selection (SelectedConversation reference may have changed)
        if (selectedPhone != null)
        {
            var restored = Conversations.FirstOrDefault(c => c.PhoneNumber == selectedPhone);
            if (restored != null && restored != SelectedConversation)
                SelectedConversation = restored;
        }
        else if (!ShowComposePanel && Conversations.Count > 0)
        {
            SelectedConversation = Conversations[0];
        }

        ApplySearch();
        NotifySelectedConversationDetailsChanged();

        // Any message change (inbound, sent, read-state) just reshaped the
        // conversation list — push it to the cloud now so every signed-in browser
        // updates in ~1 s instead of on the 5 s heartbeat. PushNow self-throttles.
        _relay.PushNow();
    }

    // ── KnownDevices list (Settings tab) ─────────────────────────────────
    public void RefreshKnownDevices()
    {
        KnownDevices.Clear();
        foreach (var d in _settings.Current.KnownDevices.OrderByDescending(d => d.LastSeen))
            KnownDevices.Add(d);

        OnPropertyChanged(nameof(QuickConnectDevice));
        OnPropertyChanged(nameof(HasQuickConnectDevice));
        OnPropertyChanged(nameof(QuickConnectDeviceName));
        OnPropertyChanged(nameof(QuickConnectDeviceSummary));
        OnPropertyChanged(nameof(QuickConnectSidebarLabel));
        OnPropertyChanged(nameof(ConnectionRailSubtitle));
        OnPropertyChanged(nameof(CanQuickReconnect));
        OnPropertyChanged(nameof(OtherKnownDevices));
        OnPropertyChanged(nameof(HasOtherKnownDevices));
    }

    // ── Audio ──────────────────────────────────────────────────────────────
    private (string? Address, string? Name) GetAudioRouteTarget()
    {
        if (!string.IsNullOrWhiteSpace(_connectedDeviceAddress))
        {
            var known = _settings.Current.KnownDevices.FirstOrDefault(device =>
                device.Address.Equals(_connectedDeviceAddress, StringComparison.OrdinalIgnoreCase));

            return (_connectedDeviceAddress, known?.Name ?? _settings.MostRecentDevice?.Name);
        }

        if (SelectedDevice is not null)
            return (SelectedDevice.Address.ToString(), SelectedDevice.Name);

        var recent = _settings.MostRecentDevice;
        return (recent?.Address, recent?.Name);
    }

    private void RefreshAudioDevices()
    {
        try
        {
            var target = GetAudioRouteTarget();
            var snapshot = _audio.GetRouteSnapshot(target.Address, target.Name);

            Dispatch(() =>
            {
                PlaybackDevices.Clear();
                foreach (var device in snapshot.PlaybackDevices)
                    PlaybackDevices.Add(device);

                RecordingDevices.Clear();
                foreach (var device in snapshot.RecordingDevices)
                    RecordingDevices.Add(device);

                AudioInfo = snapshot.Summary;
            });

            if (!string.IsNullOrWhiteSpace(target.Address) &&
                !string.Equals(_lastAudioRouteLogLine, snapshot.LogLine, StringComparison.Ordinal))
            {
                _lastAudioRouteLogLine = snapshot.LogLine;
                AppendDebug(snapshot.LogLine);
            }
        }
        catch (Exception ex) { AudioInfo = $"Audio error: {ex.Message}"; }
    }

    // ── Friendly error messages ────────────────────────────────────────────
    private static string FriendlyBtError(Exception ex, string feature)
    {
        var m = ex.Message.ToLowerInvariant();
        if (m.Contains("not authenticated") || m.Contains("authentication"))
            return $"{feature}: phone not fully paired — pair in Windows Settings first";
        if (m.Contains("refused") || m.Contains("no connection") || m.Contains("10061"))
            return $"{feature}: phone rejected — check permissions on phone";
        if (m.Contains("timeout") || m.Contains("10060"))
            return $"{feature}: timed out — is phone nearby with Bluetooth on?";
        if (m.Contains("access") || m.Contains("denied") || m.Contains("10013"))
            return $"{feature}: access denied — accept permissions on phone";
        if (m.Contains("host") || m.Contains("unreachable") || m.Contains("10065"))
            return $"{feature}: can't reach phone — is it in range?";
        if (m.Contains("rejected by phone"))
            return $"{feature}: phone is holding old session — toggle Bluetooth on your phone to reset, then reconnect";
        return $"{feature} failed: {ex.Message}";
    }

    private static string BuildPairingGuidance(bool paired, string? errorHint = null)
    {
        if (!paired)
            return
                "This device isn't paired yet.\n\n" +
                "1. Click \"Open Bluetooth Settings\" below\n" +
                "2. Add device > Bluetooth > select your phone\n" +
                "3. Confirm the PIN on both devices\n" +
                "4. On the phone: allow Calls, Contacts, and Messages\n" +
                "5. Return here and click Connect";

        var hint = errorHint?.ToLowerInvariant() ?? "";
        if (hint.Contains("refused") || hint.Contains("10061") || hint.Contains("access"))
            return
                "Paired but connection refused.\n\n" +
                "On your phone:\n" +
                "  Bluetooth Settings > find this PC > tap the gear icon\n" +
                "  Enable: Phone calls, Text messages, Media audio\n" +
                "  Tap Connect on the phone side, then Connect here";

        return
            "Connection failed. Try:\n\n" +
            "1. Phone: Bluetooth > this PC > tap Connect\n" +
            "2. Then click Connect here within a few seconds\n" +
            "3. Accept permission dialogs on the phone";
    }

    // ── Public helpers ────────────────────────────────────────────────────
    public void RefreshAudio()    => RefreshAudioDevices();
    public void ClearDebugLog()   { _debugBuilder.Clear(); DebugText = ""; }

    private static bool SameDevice(AppSettingsService.KnownDevice left, AppSettingsService.KnownDevice? right)
        => right != null && left.Address.Equals(right.Address, StringComparison.OrdinalIgnoreCase);

    private static bool IsPreferredFigDevice(AppSettingsService.KnownDevice device)
        => device.Name.Contains("fig-newton", StringComparison.OrdinalIgnoreCase)
           || device.Name.Contains("fig", StringComparison.OrdinalIgnoreCase);

    private static int DevicePriority(AppSettingsService.KnownDevice device)
        => IsPreferredFigDevice(device) ? 1 : 0;

    private static string FormatDeviceLastSeen(AppSettingsService.KnownDevice device)
    {
        var when = device.LastSeen;
        if (when.Date == DateTime.Today)
            return $"seen today at {when:h:mm tt}";
        if (when.Date == DateTime.Today.AddDays(-1))
            return $"seen yesterday at {when:h:mm tt}";
        return $"seen {when:MMM d} at {when:h:mm tt}";
    }

    private static string GetConnectionChannelLabel(string status, string label)
    {
        if (ConnectionTextLooksConnected(status))
            return $"{label}: Connected";
        if (status.Contains("reconnecting", StringComparison.OrdinalIgnoreCase))
            return $"{label}: Reconnecting";
        if (status.Contains("connecting", StringComparison.OrdinalIgnoreCase))
            return $"{label}: Connecting";
        if (status.Contains("failed", StringComparison.OrdinalIgnoreCase)
            || status.Contains("rejected", StringComparison.OrdinalIgnoreCase)
            || status.Contains("timed out", StringComparison.OrdinalIgnoreCase)
            || status.Contains("denied", StringComparison.OrdinalIgnoreCase))
            return $"{label}: Needs attention";
        return $"{label}: Not connected";
    }

    private static bool ConnectionTextLooksConnected(string? status)
    {
        var text = (status ?? "").Trim();
        if (string.IsNullOrWhiteSpace(text))
            return false;

        if (text.Contains("not connected", StringComparison.OrdinalIgnoreCase)
            || text.Contains("disconnected", StringComparison.OrdinalIgnoreCase)
            || text.Contains("failed", StringComparison.OrdinalIgnoreCase)
            || text.Contains("rejected", StringComparison.OrdinalIgnoreCase)
            || text.Contains("timed out", StringComparison.OrdinalIgnoreCase)
            || text.Contains("denied", StringComparison.OrdinalIgnoreCase)
            || text.Contains("can't reach", StringComparison.OrdinalIgnoreCase)
            || text.Contains("cannot reach", StringComparison.OrdinalIgnoreCase)
            || text.Contains("error", StringComparison.OrdinalIgnoreCase))
            return false;

        return text.Contains("connected", StringComparison.OrdinalIgnoreCase);
    }

    // ── Debug log ─────────────────────────────────────────────────────────
    private void AppendDebug(string line)
    {
        var formatted = $"{DateTime.Now:HH:mm:ss.fff}  {line}";
        _debugBuilder.AppendLine(formatted);

        var text = _debugBuilder.ToString();
        var newline = text.IndexOf('\n', text.Length / 2);
        if (_debugBuilder.Length > 40_000 && newline > 0)
        {
            _debugBuilder.Clear();
            _debugBuilder.Append(text[(newline + 1)..]);
        }

        DebugText = _debugBuilder.ToString();
        try { File.AppendAllText(LogFilePath, formatted + Environment.NewLine); }
        catch { }
    }

    // ── Helpers ───────────────────────────────────────────────────────────
    private static void Dispatch(Action a)
    {
        if (Application.Current?.Dispatcher.CheckAccess() == true) a();
        else Application.Current?.Dispatcher.Invoke(a);
    }

    // ── INotifyPropertyChanged ────────────────────────────────────────────
    public event PropertyChangedEventHandler? PropertyChanged;
    private void OnPropertyChanged([CallerMemberName] string? name = null)
        => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));

    // Guard so Shutdown is idempotent — safe to call from both OnClosed and process-exit hooks.
    private int _shutdownStarted = 0;

    /// <summary>
    /// Synchronous shutdown — blocks up to 3 seconds for a clean BT disconnect.
    /// Safe to call multiple times (idempotent) and from any thread (process-exit hooks).
    /// </summary>
    public void Shutdown()
    {
        if (System.Threading.Interlocked.Exchange(ref _shutdownStarted, 1) != 0) return;

        try
        {
            // Cancel all background work immediately so nothing races the disconnect.
            _sessionCts.Cancel();
            _appCts.Cancel();   // stops the persistent connection watchdog
            _api.Stop();
            _notif.StopCallAlert();
            _backup.CreateExitBackup();
            PersistDraftSnapshot();

            // Run the async BT disconnect synchronously with a 3-second hard timeout.
            // Using Task.Run + .Wait() so we get a real thread rather than deadlocking
            // the dispatcher thread (which may already be shutting down).
            var disconnectTask = Task.Run(async () =>
            {
                if (_hfp is not null)
                {
                    try
                    {
                        if (_hfp.CurrentCall.Status != CallStatus.Idle)
                            await _hfp.HangUpAsync();
                    }
                    catch { }
                    try { await _hfp.DisposeAsync(); } catch { }
                }
                if (_map  is not null) try { await _map.DisposeAsync();  } catch { }
                try { await _mns.DisposeAsync();        } catch { }
                try { _audioRoute.Dispose();             } catch { }
            });
            disconnectTask.Wait(TimeSpan.FromSeconds(3));
        }
        catch { }
        finally
        {
            try { _sessionCts.Dispose(); } catch { }
            try { _appCts.Dispose();     } catch { }
            try { _backup.Dispose();     } catch { }
            try { _audio.Dispose();      } catch { }
            try { _notif.Dispose();      } catch { }
        }
    }

    public async ValueTask DisposeAsync()
    {
        Shutdown(); // delegates to the synchronous path
        await Task.CompletedTask;
    }
}

// ── Minimal ICommand implementation ──────────────────────────────────────────
public class RelayCommand : ICommand
{
    private readonly Action<object?> _execute;
    private readonly Func<object?, bool>? _canExecute;

    public RelayCommand(Action<object?> execute, Func<object?, bool>? canExecute = null)
    {
        _execute    = execute;
        _canExecute = canExecute;
    }

    public bool CanExecute(object? p) => _canExecute?.Invoke(p) ?? true;
    public void Execute(object? p)    => _execute(p);
    public event EventHandler? CanExecuteChanged
    {
        add    => CommandManager.RequerySuggested += value;
        remove => CommandManager.RequerySuggested -= value;
    }
}
