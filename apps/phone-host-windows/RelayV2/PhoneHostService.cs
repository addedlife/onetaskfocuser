using DeskPhone.RelayV2.Bt;
using DeskPhone.RelayV2.Hfp;
using DeskPhone.RelayV2.Relay;

namespace DeskPhone.RelayV2;

// The supervised orchestrator: owns the HFP/MAP/MNS/PBAP lifecycles, drives
// delta-sync off MNS events, and feeds the relay client. A single
// BackgroundService replaces the legacy constellation of fire-and-forget
// Task.Run loops — if this service's loop dies, the Host notices and the
// process exits nonzero instead of limping along half-alive.
public sealed class PhoneHostService : BackgroundService
{
    private static readonly TimeSpan ReconnectDelay = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan FullResyncEvery = TimeSpan.FromMinutes(10);
    private const int InboxWindow = 150;

    private readonly ILogger<PhoneHostService> _log;
    private readonly HostState _state;
    private readonly RelayClientV2 _relay;
    private readonly ulong _phoneAddress;

    private HfpClientV2? _hfp;
    private MapClientV2? _map;
    private MnsServerV2? _mns;
    private readonly SemaphoreSlim _syncGate = new(1, 1); // coalesces MNS event bursts

    public PhoneHostService(ILogger<PhoneHostService> log, HostState state, RelayClientV2 relay, IConfiguration config)
    {
        _log = log;
        _state = state;
        _relay = relay;
        var addr = config["RELAYV2_PHONE_BT_ADDRESS"]
            ?? throw new InvalidOperationException("RELAYV2_PHONE_BT_ADDRESS not configured (12 hex digits, e.g. A1B2C3D4E5F6)");
        _phoneAddress = Convert.ToUInt64(addr.Replace(":", ""), 16);
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        _relay.IsPhoneConnected = () => _state.PhoneConnected;
        _relay.LinkQuality = () => _state.PhoneConnected ? 100 : 0;
        _relay.CommandReceived += ExecuteCommandAsync;
        await _relay.StartAsync(ct);

        // MNS server up first so the phone can connect back the moment we register.
        _mns = new MnsServerV2(_log);
        _mns.EventReceived += payload => { _ = SyncMessagesAsync(ct); };
        await _mns.StartAsync(ct);

        var lastFullResync = DateTimeOffset.MinValue;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                if (_relay.IAmLeader && !_state.PhoneConnected)
                {
                    await ConnectPhoneAsync(ct);
                    lastFullResync = DateTimeOffset.UtcNow;
                }
                else if (!_relay.IAmLeader && _state.PhoneConnected)
                {
                    // Cooperative release: the cloud elected the other host.
                    // Wait for any live call to end, then let go.
                    if (_state.ActiveCall is null || _state.ActiveCall.State is CallState.Idle)
                    {
                        _log.LogInformation("leadership lost — releasing Bluetooth link");
                        await DisconnectPhoneAsync();
                    }
                }
                else if (_state.PhoneConnected && DateTimeOffset.UtcNow - lastFullResync > FullResyncEvery)
                {
                    await SyncMessagesAsync(ct);
                    await SyncPhonebookAsync(ct);
                    lastFullResync = DateTimeOffset.UtcNow;
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _log.LogWarning(ex, "host loop iteration failed");
                _state.Log($"loop error: {ex.Message}");
            }
            await Task.Delay(TimeSpan.FromSeconds(5), ct);
        }
        await DisconnectPhoneAsync();
    }

    private async Task ConnectPhoneAsync(CancellationToken ct)
    {
        _log.LogInformation("connecting to phone {Addr:X12}...", _phoneAddress);
        _state.Log("connecting HFP...");
        _hfp = new HfpClientV2(_log);
        _hfp.Calls.StateChanged += snap =>
        {
            _state.ActiveCall = snap;
            _ = PushStateAsync(ct);
        };
        _hfp.Disconnected += () =>
        {
            _state.PhoneConnected = false;
            _state.Log("HFP disconnected");
            _ = PushStateAsync(ct);
        };
        await _hfp.ConnectAsync(_phoneAddress, ct);

        _state.Log("connecting MAP...");
        _map = new MapClientV2(_log);
        await _map.ConnectAsync(_phoneAddress, ct);
        await _map.RegisterForNotificationsAsync(ct);

        _state.PhoneConnected = true;
        _state.Log("phone connected");

        await SyncMessagesAsync(ct);
        await SyncPhonebookAsync(ct);
    }

    private async Task DisconnectPhoneAsync()
    {
        if (_map != null) { await _map.DisposeAsync(); _map = null; }
        if (_hfp != null) { await _hfp.DisposeAsync(); _hfp = null; }
        _state.PhoneConnected = false;
    }

    private async Task SyncMessagesAsync(CancellationToken ct)
    {
        if (_map is not { IsConnected: true }) return;
        if (!await _syncGate.WaitAsync(0, ct)) return; // a sync is already running; MNS bursts coalesce
        try
        {
            var listing = await _map.ListInboxAsync(InboxWindow, ct);
            _state.ReplaceMessages(listing);
            _state.Log($"synced {listing.Count} messages");
            await PushStateAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _log.LogWarning(ex, "message sync failed");
        }
        finally { _syncGate.Release(); }
    }

    private async Task SyncPhonebookAsync(CancellationToken ct)
    {
        try
        {
            var pbap = new PbapClientV2(_log);
            var pull = await pbap.PullAllAsync(_phoneAddress, ct);
            _state.ReplaceContacts(pull.Contacts);
            var calls = new List<object>();
            void Add(IEnumerable<VCardEntry> entries, string kind)
            {
                foreach (var e in entries)
                    calls.Add(new
                    {
                        name = e.Name,
                        number = e.Numbers.FirstOrDefault() ?? "",
                        kind,
                        timestamp = e.CallTime?.ToUnixTimeMilliseconds(),
                    });
            }
            Add(pull.IncomingCalls, "incoming");
            Add(pull.OutgoingCalls, "outgoing");
            Add(pull.MissedCalls, "missed");
            _state.ReplaceCalls(calls);
            _state.Log($"synced {pull.Contacts.Count} contacts, {calls.Count} call-log entries");
            await PushStateAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _log.LogWarning(ex, "phonebook sync failed");
        }
    }

    private async Task PushStateAsync(CancellationToken ct)
    {
        var messages = _state.Messages.Select(m => (object)new
        {
            id = m.Handle,
            address = m.Sender,
            body = m.Body,
            timestamp = m.Time?.ToUnixTimeMilliseconds(),
            isRead = m.IsRead,
            incoming = m.Incoming,
        }).ToList();
        var contacts = _state.Contacts.Select(c => (object)new
        {
            name = c.Name,
            numbers = c.Numbers,
        }).ToList();
        await _relay.PushStateAsync(_state.StatusPayload(), messages, _state.Calls, contacts, ct);
    }

    /// One executor for BOTH command sources (cloud relay + local API), same
    /// contract as the legacy design — a command is a path string.
    public async Task ExecuteCommandAsync(string path)
    {
        _state.Log($"command: {path}");
        var uri = new Uri("http://x" + (path.StartsWith('/') ? path : "/" + path));
        var query = System.Web.HttpUtility.ParseQueryString(uri.Query);
        switch (uri.AbsolutePath)
        {
            case "/dial":
                if (_hfp != null && query["n"] is { Length: > 0 } number) await _hfp.DialAsync(number);
                break;
            case "/answer":
                if (_hfp != null) await _hfp.AnswerAsync();
                break;
            case "/hangup":
                if (_hfp != null) await _hfp.HangUpAsync();
                break;
            case "/send":
                if (_map != null && query["to"] is { Length: > 0 } to)
                    await _map.SendSmsAsync(to, query["body"] ?? "");
                await SyncMessagesAsync(CancellationToken.None);
                break;
            case "/refresh":
                await SyncMessagesAsync(CancellationToken.None);
                await SyncPhonebookAsync(CancellationToken.None);
                break;
            case "/connect":
                if (!_state.PhoneConnected) await ConnectPhoneAsync(CancellationToken.None);
                break;
            default:
                _state.Log($"unhandled command path {uri.AbsolutePath}");
                break;
        }
    }
}
