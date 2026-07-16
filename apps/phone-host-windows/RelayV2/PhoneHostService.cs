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
    private static readonly TimeSpan FullResyncEvery = TimeSpan.FromMinutes(10);
    private const int DeltaWindow = 50;        // listing rows per folder per sync round
    private const int MaxBodiesPerDelta = 10;  // body downloads per folder per round (history loader gets the rest)
    private const int HistoryPageSize = 50;
    private const int HistoryPushEvery = 25;   // state pushes while history streams in
    private const int MediaPushMaxBytes = 1_000_000; // ~1.33MB as base64, under the function's 1.5MB cap

    private readonly ILogger<PhoneHostService> _log;
    private readonly HostState _state;
    private readonly RelayClientV2 _relay;
    private readonly ulong _phoneAddress;   // 0 = unconfigured: API + relay still run, Bluetooth stays off
    private readonly bool _forceLeader;     // bench override for offline testing without the cloud election
    private bool _relayOnline;

    private HfpClientV2? _hfp;
    private MapClientV2? _map;
    private MnsServerV2? _mns;
    private readonly SemaphoreSlim _syncGate = new(1, 1); // coalesces MNS event bursts
    private Task? _historyTask;
    private bool _muted;
    private string _lastCallDirection = "incoming";

    public PhoneHostService(ILogger<PhoneHostService> log, HostState state, RelayClientV2 relay, IConfiguration config)
    {
        _log = log;
        _state = state;
        _relay = relay;
        var addr = config["RELAYV2_PHONE_BT_ADDRESS"];
        _phoneAddress = string.IsNullOrWhiteSpace(addr) ? 0UL : Convert.ToUInt64(addr.Replace(":", ""), 16);
        _forceLeader = config["RELAYV2_FORCE_LEADER"] == "1";
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        _relay.IsPhoneConnected = () => _state.PhoneConnected;
        _relay.LinkQuality = () => _state.PhoneConnected ? 100 : 0;
        _relay.CommandReceived += ExecuteCommandAsync;
        try
        {
            await _relay.StartAsync(ct);
            _relayOnline = true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Missing secret / no network: the tester still runs local-only so
            // Bluetooth work can be exercised on the bench.
            _log.LogWarning(ex, "cloud relay unavailable — running local-only");
            _state.Log("cloud relay offline (secret/network) — local-only mode");
        }

        if (_phoneAddress == 0)
            _state.Log("RELAYV2_PHONE_BT_ADDRESS not set — Bluetooth disabled; API/relay still serving");

        var lastFullResync = DateTimeOffset.MinValue;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var leaderNow = _forceLeader || _relay.IAmLeader;
                if (_phoneAddress != 0 && leaderNow && !_state.PhoneConnected)
                {
                    await ConnectPhoneAsync(ct);
                    lastFullResync = DateTimeOffset.UtcNow;
                }
                else if (!leaderNow && _state.PhoneConnected)
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
            if (snap.State == CallState.Dialing) _lastCallDirection = "outgoing";
            else if (snap.State == CallState.IncomingRinging) _lastCallDirection = "incoming";
            _ = PushStateAsync(ct);
        };
        _hfp.Calls.CallResolved += (outcome, number) =>
        {
            // Answered resolves again as Ended at hang-up — record once, at
            // the end, when the whole call is known. Missed records instantly.
            var kind = outcome switch
            {
                CallOutcome.Missed => "missed",
                CallOutcome.Ended => _lastCallDirection,
                _ => null,
            };
            if (kind == null) return;
            _state.AddLiveCall(new CallLogEntry("", number, kind, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));
            _ = PushStateAsync(ct);
        };
        _hfp.Disconnected += () =>
        {
            _state.PhoneConnected = false;
            _state.Log("HFP disconnected");
            _ = PushStateAsync(ct);
        };
        await _hfp.ConnectAsync(_phoneAddress, ct);

        // MNS starts lazily, only on the host that actually holds the phone:
        // RFCOMM service 0x1133 is machine-wide, so binding it at app startup
        // would collide with a live v1 DeskPhone (or Phone Link) on the same PC.
        _state.Log("starting MNS listener...");
        _mns = new MnsServerV2(_log);
        _mns.EventReceived += payload => { _ = SyncMessagesAsync(ct); };
        await _mns.StartAsync(ct);

        _state.Log("connecting MAP...");
        _map = new MapClientV2(_log);
        await _map.ConnectAsync(_phoneAddress, ct);
        await _map.RegisterForNotificationsAsync(ct);

        _state.PhoneConnected = true;
        _state.Log("phone connected");

        await SyncMessagesAsync(ct);
        await SyncPhonebookAsync(ct);

        // Full history streams in behind the delta window, one page at a time.
        if (_historyTask is null or { IsCompleted: true })
            _historyTask = LoadHistoryAsync(ct);
    }

    private async Task DisconnectPhoneAsync()
    {
        if (_mns != null) { await _mns.DisposeAsync(); _mns = null; }
        if (_map != null) { await _map.DisposeAsync(); _map = null; }
        if (_hfp != null) { await _hfp.DisposeAsync(); _hfp = null; }
        _state.PhoneConnected = false;
    }

    // ── Message sync ─────────────────────────────────────────────────────────

    private async Task SyncMessagesAsync(CancellationToken ct)
    {
        if (_map is not { IsConnected: true } map) return;
        if (!await _syncGate.WaitAsync(0, ct)) return; // a sync is already running; MNS bursts coalesce
        try
        {
            foreach (var folder in new[] { "inbox", "sent" })
            {
                var listing = await map.ListFolderAsync(folder, DeltaWindow, ct: ct);
                var isSent = folder == "sent";
                // The listing rows already carry read flags — refresh them on
                // every round with zero extra Bluetooth traffic (sent = read).
                _state.ApplyReadStates(listing.Select(e => (e.Handle, isSent || e.IsRead)));

                var plan = MessageDeltaPlanner.PlanFetches(_state.KnownHandles, listing, MaxBodiesPerDelta);
                foreach (var entry in plan)
                {
                    ct.ThrowIfCancellationRequested();
                    await FetchAndStoreAsync(map, entry, folder, ct);
                }
                if (plan.Count > 0)
                    _state.Log($"synced {plan.Count} new {folder} message(s)");
            }
            await PushStateAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _log.LogWarning(ex, "message sync failed");
        }
        finally { _syncGate.Release(); }
    }

    private async Task FetchAndStoreAsync(MapClientV2 map, MapListingEntry entry, string folder, CancellationToken ct)
    {
        try
        {
            var parsed = await map.FetchAsync(entry.Handle, entry.IsMms, ct);
            var isSent = folder == "sent";
            var body = parsed.Body.Length > 0 ? parsed.Body : entry.Subject;
            var msg = new MapMessage(
                Handle: entry.Handle,
                Sender: entry.Sender.Length > 0 ? entry.Sender : parsed.Sender,
                Recipient: entry.Recipient,
                Body: body,
                Time: entry.Time,
                IsRead: isSent || entry.IsRead,
                Incoming: !isSent,
                IsMms: entry.IsMms,
                Folder: folder,
                Attachments: parsed.Attachments);
            _state.UpsertMessages(new[] { msg });

            if (_relayOnline)
                foreach (var (att, i) in parsed.Attachments.Select((a, i) => (a, i)))
                {
                    if (att.Data.Length > MediaPushMaxBytes || !att.ContentType.StartsWith("image/", StringComparison.Ordinal))
                        continue;
                    var mediaId = $"{SanitizeId(entry.Handle)}_{i}";
                    var dataUrl = $"data:{att.ContentType};base64,{Convert.ToBase64String(att.Data)}";
                    try { await _relay.PushMediaAsync(mediaId, dataUrl, ct); }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    { _log.LogWarning(ex, "media push failed for {Id}", mediaId); }
                }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _log.LogWarning(ex, "fetch {Handle} failed", entry.Handle);
        }
    }

    // Full history, paginated. Every MapClient operation takes the OBEX lock
    // individually, so a user send or MNS-triggered delta naturally interleaves
    // between pages — no explicit pause plumbing needed.
    private async Task LoadHistoryAsync(CancellationToken ct)
    {
        try
        {
            var total = 0;
            foreach (var folder in new[] { "inbox", "sent" })
            {
                var offset = 0;
                while (!ct.IsCancellationRequested)
                {
                    if (_map is not { IsConnected: true } map) return;
                    var page = await map.ListFolderAsync(folder, HistoryPageSize, offset, ct);
                    if (page.Count == 0) break;

                    var plan = MessageDeltaPlanner.PlanFetches(_state.KnownHandles, page, int.MaxValue);
                    foreach (var entry in plan)
                    {
                        ct.ThrowIfCancellationRequested();
                        await FetchAndStoreAsync(map, entry, folder, ct);
                        total++;
                        if (total % HistoryPushEvery == 0) await PushStateAsync(ct);
                        await Task.Delay(50, ct); // breathe between downloads
                    }

                    offset += page.Count;
                    if (page.Count < HistoryPageSize) break;
                    await Task.Delay(200, ct);
                }
            }
            _state.Log($"history load complete ({total} older messages)");
            await PushStateAsync(ct);
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "history load stopped");
        }
    }

    private async Task SyncPhonebookAsync(CancellationToken ct)
    {
        try
        {
            var pbap = new PbapClientV2(_log);
            var pull = await pbap.PullAllAsync(_phoneAddress, ct);
            _state.ReplaceContacts(pull.Contacts);
            var calls = new List<CallLogEntry>();
            void Add(IEnumerable<VCardEntry> entries, string kind)
            {
                foreach (var e in entries)
                    calls.Add(new CallLogEntry(e.Name, e.Numbers.FirstOrDefault() ?? "", kind, e.CallTime?.ToUnixTimeMilliseconds()));
            }
            Add(pull.IncomingCalls, "incoming");
            Add(pull.OutgoingCalls, "outgoing");
            Add(pull.MissedCalls, "missed");
            _state.ReplaceCallLog(calls);
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
        if (!_relayOnline) return;
        var messages = _state.Messages.Take(300).Select(m => (object)new
        {
            id = m.Handle,
            address = m.Sender,
            recipient = m.Recipient,
            body = m.Body,
            timestamp = m.Time?.ToUnixTimeMilliseconds(),
            isRead = m.IsRead,
            incoming = m.Incoming,
            isMms = m.IsMms,
            media = m.Attachments
                .Select((a, i) => new { id = $"{SanitizeId(m.Handle)}_{i}", contentType = a.ContentType, fileName = a.FileName })
                .ToList(),
        }).ToList();
        var contacts = _state.Contacts.Select(c => (object)new { name = c.Name, numbers = c.Numbers }).ToList();
        var calls = _state.Calls.Take(300).Select(c => (object)new
        {
            name = c.Name,
            number = c.Number,
            kind = c.Kind,
            timestamp = c.Timestamp,
        }).ToList();
        await _relay.PushStateAsync(_state.StatusPayload(), messages, calls, contacts, ct);
    }

    // ── Commands ─────────────────────────────────────────────────────────────

    /// Send a message (text, or MMS with attachments), then delta-sync so the
    /// phone's own Sent copy lands in the store. Used by both the local API
    /// and the cloud /send command path.
    public async Task<bool> SendUserMessageAsync(string to, string body, IReadOnlyList<MapAttachment>? attachments = null)
    {
        if (_map is not { IsConnected: true } map) throw new InvalidOperationException("phone not connected");
        var ok = await map.SendMessageAsync(to, body, attachments);
        await SyncMessagesAsync(CancellationToken.None);
        return ok;
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
            case "/toggle-mute":
                if (_hfp != null)
                {
                    _muted = !_muted;
                    await _hfp.SetMuteAsync(_muted);
                }
                break;
            case "/send":
                if (query["to"] is { Length: > 0 } to)
                    await SendUserMessageAsync(to, query["body"] ?? "");
                break;
            case "/delete-message":
                if (_map != null && query["handle"] is { Length: > 0 } delHandle)
                {
                    if (await _map.SetDeletedStatusAsync(delHandle, true))
                    {
                        _state.RemoveMessage(delHandle);
                        await PushStateAsync(CancellationToken.None);
                    }
                }
                break;
            case "/mark-conversation-read":
            case "/mark-conversation-unread":
                await SetConversationReadAsync(query["cid"] ?? "", uri.AbsolutePath.EndsWith("-read", StringComparison.Ordinal));
                break;
            case "/refresh":
                await SyncMessagesAsync(CancellationToken.None);
                await SyncPhonebookAsync(CancellationToken.None);
                break;
            case "/connect":
                if (!_state.PhoneConnected && _phoneAddress != 0) await ConnectPhoneAsync(CancellationToken.None);
                break;
            default:
                _state.Log($"unhandled command path {uri.AbsolutePath}");
                break;
        }
    }

    // Conversation id is a phone number; match messages by digit suffix so
    // "+1 (574) 555-0000" and "5745550000" land in the same conversation.
    private async Task SetConversationReadAsync(string cid, bool read)
    {
        if (_map is not { IsConnected: true } map || cid.Length == 0) return;
        var targets = _state.Messages
            .Where(m => m.Incoming && m.IsRead != read && SameConversation(m.Sender, cid))
            .Take(read ? 25 : 1) // read clears the whole thread; unread flags just the newest
            .ToList();
        foreach (var m in targets)
        {
            if (await map.SetReadStatusAsync(m.Handle, read))
                _state.ApplyReadStates(new[] { (m.Handle, read) });
        }
        if (targets.Count > 0) await PushStateAsync(CancellationToken.None);
    }

    private static bool SameConversation(string a, string b)
    {
        static string Digits(string s) => new(s.Where(char.IsDigit).ToArray());
        var da = Digits(a);
        var db = Digits(b);
        if (da.Length == 0 || db.Length == 0) return false;
        var tail = Math.Min(10, Math.Min(da.Length, db.Length));
        return da[^tail..] == db[^tail..];
    }

    private static string SanitizeId(string handle) =>
        new(handle.Select(ch => char.IsLetterOrDigit(ch) ? ch : '-').ToArray());
}
