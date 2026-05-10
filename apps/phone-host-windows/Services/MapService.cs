using DeskPhone.Models;
using InTheHand.Net;
using InTheHand.Net.Bluetooth;
using InTheHand.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Collections.Concurrent;
using System.Xml;
using System.Linq;
using System.IO;

namespace DeskPhone.Services;

/// <summary>
/// MAP (Message Access Profile) service.
/// Connects to the phone's Message Access Server via RFCOMM + OBEX,
/// fetches the inbox message listing, then downloads individual messages.
///
/// Two-stream design:
///   Primary stream  — used for all real-time operations (sends, polls, initial sync).
///   History stream  — a SECOND RFCOMM connection opened for the background history
///                     loader, so history downloads never block real-time activity.
///   Each stream has its own lock so they run completely independently.
/// </summary>
public class MapService : IAsyncDisposable
{
    // MAP Message Access Server UUID 0x1132
    private static readonly Guid MapMasUuidStd = new("00001132-0000-1000-8000-00805F9B34FB");
    // Proprietary MediaTek MAP UUID found in Fig 52 logs
    private static readonly Guid MapMasUuidMtk = new("A82EFA21-AE5C-3DDE-9BBC-F16DA7B16C5A");


    public event Action<string>?            MapLogLine;
    public event Action<string>?            StatusChanged;
    public event Action?                    InboxChangeDetected;

    public bool IsConnected { get; private set; }

    // Primary stream — used for all real-time ops (sends, polls, initial sync)
    private BluetoothClient?  _client;
    private ObexClient?       _obex;
    private BluetoothAddress  _deviceAddress;

    // OBEX is a strict request-response protocol — only one operation may be
    // in-flight at a time.  Without this lock, auto-refresh and user-triggered
    // sends can collide on the same stream, corrupting both operations.
    private readonly SemaphoreSlim _obexLock = new(1, 1);

    private readonly ConcurrentDictionary<string, SmsMessage> _messageCache = new();

    // ── Connect ───────────────────────────────────────────────────────────
    public async Task ConnectAsync(BluetoothAddress deviceAddress, CancellationToken ct = default)
    {
        StatusChanged?.Invoke("Connecting MAP…");
        _deviceAddress = deviceAddress;

        // MAP v1.2: Connect with MASInstanceID 0.
        // Retry up to 4 times with full RFCOMM reconnect each attempt: the phone
        // may hold the previous MAP session open after an unclean app exit and
        // reject OBEX CONNECT — it also drops the RFCOMM socket after a rejection,
        // so we must open a fresh BluetoothClient each retry.
        var connParams = new byte[] { 0x0F, 0x01, 0x00 };
        bool ok = false;
        Exception? lastEx = null;

        const int MaxAttempts = 8;
        for (int attempt = 1; attempt <= MaxAttempts; attempt++)
        {
            try
            {
                _client?.Dispose();
                _client = new BluetoothClient();
                await Task.Run(() => _client.Connect(deviceAddress, MapMasUuidStd), ct);
                MapLogLine?.Invoke($"[MAP] RFCOMM connected (attempt {attempt})");

                _obex?.Dispose();
                _obex = new ObexClient(_client.GetStream());
                ok = await _obex.ConnectAsync(connParams, ct);
                if (ok) break;

                lastEx = null;
                MapLogLine?.Invoke($"[MAP] OBEX CONNECT rejected (attempt {attempt}/{MaxAttempts}) — waiting 5 s for phone to release old session…");
                StatusChanged?.Invoke($"MAP: waiting for phone to release session ({attempt}/{MaxAttempts})…");
            }
            catch (Exception ex)
            {
                lastEx = ex;
                MapLogLine?.Invoke($"[MAP] Connect attempt {attempt} error: {ex.Message}");
            }

            if (attempt < MaxAttempts)
                await Task.Delay(5000, ct);
        }

        if (!ok)
            throw lastEx ?? new Exception($"OBEX CONNECT rejected by phone ({MaxAttempts} attempts)");

        IsConnected = true;
        StatusChanged?.Invoke("MAP connected");
        MapLogLine?.Invoke($"[OBEX CONNECT OK] ConnID={_obex.ConnectionId}");
    }

    // ── Delta Sync ────────────────────────────────────────────────────────
    // Strategy:
    //   Initial sync:  fetch up to 20 inbox + 20 sent immediately (no probe needed).
    //   Subsequent:    probe for the newest handle in each folder using a 1-message
    //                  listing (4 OBEX round-trips, ~50ms). If unchanged → return empty.
    //                  If changed → fetch the N most recent from the changed folder(s).
    //
    // We track all seen handles so that new messages are never missed, even when the
    // newest handle hasn't changed (e.g. a new sent message that landed between two
    // probes, or a phone that returns handles in non-monotonic order).

    private string?         _lastInboxHandle;
    private string?         _lastSentHandle;
    private bool            _isInitialSync = true;
    private HashSet<string> _seenHandles   = new();

    public async Task<List<SmsMessage>> PerformDeltaSyncAsync(CancellationToken ct = default)
    {
        if (_isInitialSync)
        {
            _isInitialSync = false;

            // Initial sync: fetch ONLY the listing (handles + metadata) from both folders.
            // This is 2 OBEX GETs — no body downloads. Compare against seeded known handles.
            // If everything is already known → done instantly, no body downloads at all.
            // If anything is new → download only the unknown bodies (up to 5 per folder).
            MapLogLine?.Invoke("[DELTA-SYNC] Initial listing probe (no body downloads)");

            List<(string Handle, MsgMeta Meta)> inboxListing, sentListing;
            await _obexLock.WaitAsync(ct);
            try
            {
                // Cap at 50 per folder — prevents a 470KB listing download on first connect.
                // FullHistoryLoadAsync will pick up the rest in the background.
                inboxListing = await GetHandleListingCoreAsync("inbox", ct, maxCount: 50);
                sentListing  = await GetHandleListingCoreAsync("sent",  ct, maxCount: 50);
            }
            finally { _obexLock.Release(); }

            _lastInboxHandle = inboxListing.FirstOrDefault().Handle;
            _lastSentHandle  = sentListing.FirstOrDefault().Handle;

            // Which handles does the phone have that we don't?
            var newInbox = inboxListing.Where(h => !_seenHandles.Contains(h.Handle)).Take(5).ToList();
            var newSent  = sentListing.Where(h => !_seenHandles.Contains(h.Handle)).Take(5).ToList();

            foreach (var h in inboxListing) _seenHandles.Add(h.Handle);
            foreach (var h in sentListing)  _seenHandles.Add(h.Handle);

            if (newInbox.Count == 0 && newSent.Count == 0)
            {
                MapLogLine?.Invoke("[DELTA-SYNC] Initial probe — everything already in store, done");
                return new List<SmsMessage>();
            }

            // Download bodies only for the new handles (max 5 each, rest handled by history loader)
            MapLogLine?.Invoke($"[DELTA-SYNC] Initial probe: {newInbox.Count} new inbox, {newSent.Count} new sent — downloading bodies");
            var initialResults = new List<SmsMessage>();

            foreach (var (handle, meta) in newInbox)
            {
                ct.ThrowIfCancellationRequested();
                await _obexLock.WaitAsync(ct);
                try
                {
                    var msg = await GetMessageAsync(handle, ct, isMms: meta.Type == "MMS");
                    msg.From = meta.From; msg.Timestamp = meta.Timestamp; msg.IsRead = meta.IsRead;
                    initialResults.Add(msg);
                }
                catch (Exception ex) { MapLogLine?.Invoke($"[DELTA-SYNC] inbox {handle} failed: {ex.Message}"); }
                finally { _obexLock.Release(); }
                await Task.Delay(20, ct);
            }

            foreach (var (handle, meta) in newSent)
            {
                ct.ThrowIfCancellationRequested();
                await _obexLock.WaitAsync(ct);
                try
                {
                    var msg = await GetMessageAsync(handle, ct, isMms: meta.Type == "MMS");
                    var recipient = !string.IsNullOrEmpty(meta.To) ? meta.To : meta.From;
                    msg.From = $"Me > {recipient}"; msg.IsSent = true;
                    msg.Timestamp = meta.Timestamp; msg.IsRead = meta.IsRead;
                    initialResults.Add(msg);
                }
                catch (Exception ex) { MapLogLine?.Invoke($"[DELTA-SYNC] sent {handle} failed: {ex.Message}"); }
                finally { _obexLock.Release(); }
                await Task.Delay(20, ct);
            }

            MapLogLine?.Invoke($"[DELTA-SYNC] Initial complete ({initialResults.Count} new messages)");
            return initialResults;
        }

        // Subsequent: probe newest handle in both folders in one lock acquisition
        var (probeInbox, probeSent) = await ProbeBothFoldersAsync(ct);

        bool inboxChanged = probeInbox != null && probeInbox != _lastInboxHandle;
        bool sentChanged  = probeSent  != null && probeSent  != _lastSentHandle;

        if (!inboxChanged && !sentChanged)
        {
            MapLogLine?.Invoke("[DELTA-SYNC] No change");
            return new List<SmsMessage>();
        }

        // Something changed — pull a small window from the changed folder(s)
        var results = new List<SmsMessage>();

        if (inboxChanged)
        {
            InboxChangeDetected?.Invoke();
            MapLogLine?.Invoke($"[DELTA-SYNC] Inbox changed ({_lastInboxHandle} → {probeInbox}), fetching 5");
            var msgs = await GetInboxAsync(5, ct: ct);
            var newOnes = msgs.Where(m => !_seenHandles.Contains(m.Handle)).ToList();
            foreach (var m in newOnes) _seenHandles.Add(m.Handle);
            results.AddRange(newOnes.Count > 0 ? newOnes : msgs); // if all seen, still return them for timestamp updates
            _lastInboxHandle = probeInbox;
        }

        if (sentChanged)
        {
            MapLogLine?.Invoke($"[DELTA-SYNC] Sent changed ({_lastSentHandle} → {probeSent}), fetching 5");
            var msgs = await GetSentAsync(5, ct: ct);
            var newOnes = msgs.Where(m => !_seenHandles.Contains(m.Handle)).ToList();
            foreach (var m in newOnes) _seenHandles.Add(m.Handle);
            results.AddRange(newOnes.Count > 0 ? newOnes : msgs);
            _lastSentHandle = probeSent;
        }

        MapLogLine?.Invoke($"[DELTA-SYNC] Change sync complete ({results.Count} new/updated messages)");
        return results;
    }

    // Probe newest handle in BOTH inbox and sent in a single lock acquisition.
    // This cuts RFCOMM round-trips from 10 to 7 compared to two separate probe calls.
    // Returns (inboxHandle, sentHandle) — either may be null on error.
    private async Task<(string? inbox, string? sent)> ProbeBothFoldersAsync(CancellationToken ct)
    {
        if (_obex is null) return (null, null);
        await _obexLock.WaitAsync(ct);
        try
        {
            var appParams = new byte[] { 0x01, 0x02, 0x00, 0x01 }; // MaxListCount=1

            // Navigate once to telecom/msg — shared prefix for both folders
            await _obex.SetPathAsync("",        ct: ct);
            await _obex.SetPathAsync("telecom", ct: ct);
            await _obex.SetPathAsync("msg",     ct: ct);

            // inbox
            string? inboxHandle = null;
            try
            {
                await _obex.SetPathAsync("inbox", ct: ct);
                var xml = await _obex.GetAsync("x-bt/MAP-msg-listing", name: null, appParams: appParams, ct: ct);
                if (xml.Length == 0)
                    xml = await _obex.GetAsync("x-bt/MAP-msg-listing", name: null, appParams: null, ct: ct);
                inboxHandle = ParseMessageListing(Encoding.UTF8.GetString(xml)).FirstOrDefault().Handle;
            }
            catch (Exception ex) { MapLogLine?.Invoke($"[PROBE inbox] {ex.Message}"); }

            // sent — navigate from inbox via root shortcut (SetPath with empty = parent)
            string? sentHandle = null;
            try
            {
                // Back to msg, then into sent
                await _obex.SetPathAsync("",      ct: ct);   // back to root
                await _obex.SetPathAsync("telecom", ct: ct);
                await _obex.SetPathAsync("msg",   ct: ct);
                await _obex.SetPathAsync("sent",  ct: ct);
                var xml = await _obex.GetAsync("x-bt/MAP-msg-listing", name: null, appParams: appParams, ct: ct);
                if (xml.Length == 0)
                    xml = await _obex.GetAsync("x-bt/MAP-msg-listing", name: null, appParams: null, ct: ct);
                sentHandle = ParseMessageListing(Encoding.UTF8.GetString(xml)).FirstOrDefault().Handle;
            }
            catch (Exception ex) { MapLogLine?.Invoke($"[PROBE sent] {ex.Message}"); }

            return (inboxHandle, sentHandle);
        }
        finally { _obexLock.Release(); }
    }

    /// <summary>
    /// Seeds the seen-handle set from already-stored messages so the initial probe
    /// can correctly detect "nothing new" without re-downloading bodies we already have.
    /// Call this once right after ConnectAsync, before the first PerformDeltaSyncAsync.
    /// </summary>
    public void SeedKnownHandles(IEnumerable<string> handles)
    {
        int added = 0;
        foreach (var h in handles)
            if (!string.IsNullOrEmpty(h))
                if (_seenHandles.Add(h))
                    added++;
        MapLogLine?.Invoke($"[DELTA-SYNC] Loaded {added} cached handles from local store ({_seenHandles.Count} known total)");
    }

    public void RememberKnownHandle(string? handle)
    {
        if (string.IsNullOrWhiteSpace(handle))
            return;

        if (_seenHandles.Add(handle))
            MapLogLine?.Invoke($"[DELTA-SYNC] Registered 1 new handle locally ({_seenHandles.Count} known total)");
    }

    /// <summary>
    /// Force-fetch specific message handles by ID — used to re-download MMS that
    /// failed to parse in a previous session (no attachment data extracted).
    /// </summary>
    public async Task<List<SmsMessage>> FetchHandlesAsync(IEnumerable<string> handles, CancellationToken ct = default)
    {
        var results = new List<SmsMessage>();
        foreach (var handle in handles)
        {
            if (ct.IsCancellationRequested) break;
            try
            {
                MapLogLine?.Invoke($"[FETCH] Re-fetching handle {handle}");
                var msg = await GetMessageAsync(handle, ct, isMms: true);
                if (msg != null)
                {
                    _seenHandles.Add(handle);
                    results.Add(msg);
                    MapLogLine?.Invoke($"[FETCH] {handle} — attachment={msg.AttachmentData?.Length.ToString() ?? "null"} body='{msg.Body}'");
                }
            }
            catch (Exception ex) { MapLogLine?.Invoke($"[FETCH] {handle} error: {ex.Message}"); }
        }
        return results;
    }

    public async Task<bool> RegisterForNotificationsAsync(bool enable, CancellationToken ct = default)
    {
        if (_obex is null) return false;

        var appParams = new byte[]
        {
            0x0E, 0x01, enable ? (byte)0x01 : (byte)0x00 // NotificationStatus on/off
        };

        await _obexLock.WaitAsync(ct);
        try
        {
            var code = await _obex.PutAsync(
                "x-bt/MAP-NotificationRegistration",
                name: null,
                body: new byte[] { 0x30 },
                appParams: appParams,
                ct: ct);

            var ok = code == 0xA0;
            MapLogLine?.Invoke(ok
                ? $"[MNS] Notification registration {(enable ? "enabled" : "disabled")}"
                : $"[MNS] Notification registration {(enable ? "enable" : "disable")} rejected: 0x{code:X2}");
            return ok;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            MapLogLine?.Invoke($"[MNS] Notification registration failed: {ex.Message}");
            return false;
        }
        finally { _obexLock.Release(); }
    }

    // ── Full history background loader ────────────────────────────────────
    // Strategy:
    //   1. Fetch the complete message listing (handles + metadata) for both inbox and sent.
    //      This is one OBEX GET per folder — the phone sends the XML listing (may be large).
    //   2. Filter out handles already in _seenHandles (we have those bodies already).
    //   3. Walk the remaining handles oldest-first in batches of 25.
    //      Between each batch: release the OBEX lock so any real operation can jump in.
    //      The caller supplies a pausePredicate; if true we wait 500ms before retrying.
    //   4. Report progress via the onBatch callback after each batch completes.
    //
    // The caller is responsible for merging results into the store and triggering UI rebuilds.

    public async Task FullHistoryLoadAsync(
        IReadOnlySet<string>               knownHandles,
        Func<bool>                         isPaused,    // true when a real op (send/refresh) is active
        Action<List<SmsMessage>, int, int> onBatch,     // (batch, batchIndex, totalUnknown)
        int                                startInboxOffset = 0,
        int                                startSentOffset  = 0,
        Action<int, int>?                  onProgress       = null, // (inboxOffset, sentOffset)
        CancellationToken                  ct = default)
    {
        if (_obex is null) return;

        // The phone only allows one MAP session at a time, so we share the primary
        // OBEX stream. To keep sends and polls near-live, every lock acquisition is
        // short: listing pages are 100 handles each (~0.5–1 s per page), and each
        // message body is fetched with its own lock acquire/release (~0.1–0.2 s).
        // A send waits at most one page or one body download — never 90+ seconds.

        MapLogLine?.Invoke("[FULLHIST] Starting paginated history load (interleaved list+download)");

        // Strategy: interleave listing and body downloads.
        // For each page of 100 handles: get the listing, immediately download bodies
        // for any unknown handles in that page, call onBatch, then move to the next page.
        // This means new messages appear in the UI as each listing page is processed —
        // no waiting for all 3000+ handles to be listed before anything shows up.

        const ushort PageSize  = 50;
        const int    BatchSize = 25;
        const int    CachedPageYieldMs = 250;

        int  totalDownloaded = 0;
        int  batchIndex      = 0;
        var  batchBuffer     = new List<SmsMessage>();

        async Task FlushBatch()
        {
            if (batchBuffer.Count == 0) return;
            MapLogLine?.Invoke($"[FULLHIST] Batch {batchIndex + 1}: {batchBuffer.Count} msgs (total {totalDownloaded})");
            onBatch(new List<SmsMessage>(batchBuffer), batchIndex, -1); // -1 = total unknown not yet known
            batchBuffer.Clear();
            batchIndex++;
        }

        // Per-folder pagination state so we can alternate inbox/sent pages
        var folders  = new[] { "inbox", "sent" };
        var offsets  = new ushort[] { (ushort)startInboxOffset, (ushort)startSentOffset };
        var seen     = folders.Select(_ => new HashSet<string>(StringComparer.OrdinalIgnoreCase)).ToArray();
        var done     = new bool[folders.Length];
        var retriedFromTop = new bool[folders.Length];

        try
        {
            // Alternate between folders each page so inbox and sent both stream in together
            while (!done.All(d => d))
            {
                for (int fi = 0; fi < folders.Length; fi++)
                {
                    if (done[fi]) continue;

                    ct.ThrowIfCancellationRequested();
                    while (isPaused()) { await Task.Delay(300, ct); }

                    var folder = folders[fi];

                    // ── Get one page of handles ───────────────────────────
                    await _obexLock.WaitAsync(ct);
                    List<(string Handle, MsgMeta Meta)> page;
                    try { page = await GetHandleListingCoreAsync(folder, ct, maxCount: PageSize, offset: offsets[fi]); }
                    finally { _obexLock.Release(); }

                    if (page.Count == 0)
                    {
                        if (offsets[fi] > 0 && !retriedFromTop[fi])
                        {
                            MapLogLine?.Invoke($"[FULLHIST] {folder}: saved offset {offsets[fi]} returned no handles; retrying from top once");
                            offsets[fi] = 0;
                            retriedFromTop[fi] = true;
                            seen[fi].Clear();
                            onProgress?.Invoke(offsets[0], offsets[1]);
                            continue;
                        }

                        done[fi] = true;
                        continue;
                    }

                    var newInPage = page.Where(h => !seen[fi].Contains(h.Handle)).ToList();
                    if (newInPage.Count == 0)
                    {
                        MapLogLine?.Invoke($"[FULLHIST] {folder}: repeated page at offset {offsets[fi]}, stopping folder to avoid loop");
                        done[fi] = true;
                        continue;
                    }

                    foreach (var h in newInPage) seen[fi].Add(h.Handle);
                    offsets[fi] += (ushort)page.Count;
                    MapLogLine?.Invoke($"[FULLHIST] {folder}: page +{newInPage.Count} (total {offsets[fi]})");
                    onProgress?.Invoke(offsets[0], offsets[1]);

                    if (page.Count < PageSize) done[fi] = true;  // last page for this folder

                    // ── Download bodies for unknown handles in this page ──
                    var unknown = newInPage
                        .Where(h => !knownHandles.Contains(h.Handle) && !string.IsNullOrEmpty(h.Handle))
                        .ToList();

                    if (unknown.Count == 0)
                    {
                        await Task.Delay(CachedPageYieldMs, ct);
                        continue;
                    }

                    foreach (var (handle, meta) in unknown)
                    {
                        ct.ThrowIfCancellationRequested();
                        while (isPaused()) { MapLogLine?.Invoke("[FULLHIST] Yielding for real op"); await Task.Delay(300, ct); }

                        await _obexLock.WaitAsync(ct);
                        try
                        {
                            var msg = await GetMessageAsync(handle, ct, isMms: meta.Type == "MMS");

                            bool isSent = meta.Folder.Contains("sent", StringComparison.OrdinalIgnoreCase) || meta.IsSent;
                            if (isSent)
                            {
                                var recipient = !string.IsNullOrEmpty(meta.To) ? meta.To : meta.From;
                                msg.From = $"Me > {recipient}"; msg.IsSent = true;
                            }
                            else { msg.From = meta.From; msg.IsSent = meta.IsSent; }

                            msg.Timestamp = meta.Timestamp; msg.IsRead = meta.IsRead;
                            _seenHandles.Add(handle);
                            batchBuffer.Add(msg);
                            totalDownloaded++;
                        }
                        catch (Exception ex) { MapLogLine?.Invoke($"[FULLHIST] {handle} failed: {ex.Message}"); }
                        finally { _obexLock.Release(); }

                        await Task.Delay(50, ct);

                        if (batchBuffer.Count >= BatchSize)
                            await FlushBatch();
                    }

                    await Task.Delay(100, ct);
                }
            }

            await FlushBatch(); // flush any remainder
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            MapLogLine?.Invoke($"[FULLHIST] Error: {ex.Message}");
            await FlushBatch();
            return;
        }

        if (totalDownloaded == 0)
            MapLogLine?.Invoke("[FULLHIST] No unknown handles — already have full history");
        else
            MapLogLine?.Invoke($"[FULLHIST] Complete — {totalDownloaded} messages downloaded");
    }

    // Fetch just the handle+metadata listing for a folder. Lock must already be held by caller.
    // maxCount caps the number of handles returned. offset supports pagination via MAP ListStartOffset.
    private async Task<List<(string Handle, MsgMeta Meta)>> GetHandleListingCoreAsync(
        string folderName, CancellationToken ct, ushort maxCount = 0xFFFF, ushort offset = 0)
    {
        await _obex!.SetPathAsync("",         ct: ct);
        await _obex.SetPathAsync("telecom",   ct: ct);
        await _obex.SetPathAsync("msg",       ct: ct);
        await _obex.SetPathAsync(folderName,  ct: ct);

        // Build app-params: always include MaxListCount; add ListStartOffset (Tag 0x02) if paginating.
        byte[] appParams = offset > 0
            ? new byte[]
              {
                  0x01, 0x02, (byte)(maxCount >> 8), (byte)(maxCount & 0xFF),  // MaxListCount
                  0x02, 0x02, (byte)(offset   >> 8), (byte)(offset   & 0xFF)   // ListStartOffset
              }
            : new byte[] { 0x01, 0x02, (byte)(maxCount >> 8), (byte)(maxCount & 0xFF) };

        var xml = await _obex.GetAsync("x-bt/MAP-msg-listing", name: null, appParams: appParams, ct: ct);
        if (xml.Length == 0)
            xml = await _obex.GetAsync("x-bt/MAP-msg-listing", name: null, appParams: null, ct: ct);

        bool isSentFolder = string.Equals(folderName, "sent", StringComparison.OrdinalIgnoreCase);
        return ParseMessageListing(Encoding.UTF8.GetString(xml))
            .Select(h => (h.Handle, h.Meta with { Folder = folderName, IsSent = isSentFolder || h.Meta.IsSent }))
            .ToList();
    }

    /// <summary>
    /// Fetches a small recent metadata window so the app can refresh read/unread state
    /// even when there are no new messages to download.
    /// </summary>
    public async Task<IReadOnlyDictionary<string, bool>> GetRecentReadStatesByHandleAsync(
        int maxCountPerFolder = 25,
        CancellationToken ct = default)
    {
        if (_obex is null) throw new InvalidOperationException("Not connected");

        await _obexLock.WaitAsync(ct);
        try
        {
            var byHandle = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);

            foreach (var folder in new[] { "inbox", "sent" })
            {
                var listing = await GetHandleListingCoreAsync(folder, ct, maxCount: (ushort)Math.Max(1, maxCountPerFolder));
                foreach (var (handle, meta) in listing)
                {
                    if (string.IsNullOrWhiteSpace(handle)) continue;
                    byHandle[handle] = meta.IsSent ? true : meta.IsRead;
                }
            }

            return byHandle;
        }
        finally { _obexLock.Release(); }
    }

    /// <summary>
    /// Returns a lightweight recent handle window from inbox and sent so DeskPhone can
    /// reconcile phone-side deletes without walking the entire phone history.
    /// </summary>
    public async Task<HashSet<string>> GetRecentVisibleMessageHandlesAsync(
        int maxCountPerFolder = 150,
        CancellationToken ct = default)
    {
        if (_obex is null) throw new InvalidOperationException("Not connected");

        ushort pageSize = (ushort)Math.Max(1, Math.Min(maxCountPerFolder, ushort.MaxValue));
        var handles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        await _obexLock.WaitAsync(ct);
        try
        {
            foreach (var folder in new[] { "inbox", "sent" })
            {
                var listing = await GetHandleListingCoreAsync(folder, ct, maxCount: pageSize);
                foreach (var (handle, _) in listing)
                    if (!string.IsNullOrWhiteSpace(handle))
                        handles.Add(handle);
            }

            return handles;
        }
        finally { _obexLock.Release(); }
    }

    /// <summary>
    /// Returns the full set of message handles currently exposed by the phone in the
    /// visible inbox and sent folders. Used to reconcile phone-side deletions back to
    /// the desktop store even when the newest-handle probe does not change.
    /// </summary>
    public async Task<HashSet<string>> GetVisibleMessageHandlesAsync(CancellationToken ct = default)
    {
        if (_obex is null) throw new InvalidOperationException("Not connected");

        const ushort PageSize = 100;
        var handles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var folder in new[] { "inbox", "sent" })
        {
            ushort offset = 0;
            while (true)
            {
                List<(string Handle, MsgMeta Meta)> page;
                await _obexLock.WaitAsync(ct);
                try
                {
                    page = await GetHandleListingCoreAsync(folder, ct, maxCount: PageSize, offset: offset);
                }
                finally { _obexLock.Release(); }

                if (page.Count == 0)
                    break;

                foreach (var (handle, _) in page)
                    if (!string.IsNullOrWhiteSpace(handle))
                        handles.Add(handle);

                if (page.Count < PageSize)
                    break;

                offset += (ushort)page.Count;
                await Task.Delay(30, ct);
            }
        }

        return handles;
    }

    // ── Fetch inbox messages ──────────────────────────────────────────────
    /// <summary>
    /// Returns up to <paramref name="maxCount"/> messages from the inbox, newest first.
    /// Pass <paramref name="skipHandles"/> to skip re-downloading bodies already in cache.
    /// </summary>
    public async Task<List<SmsMessage>> GetInboxAsync(
        int                    maxCount    = 30,
        IReadOnlySet<string>?  skipHandles = null,
        CancellationToken      ct          = default)
        => await GetFolderAsync("inbox", maxCount, skipHandles, ct);

    /// <summary>
    /// Returns up to <paramref name="maxCount"/> messages from the sent folder, newest first.
    /// Pass <paramref name="skipHandles"/> to skip re-downloading bodies already in cache.
    /// </summary>
    public async Task<List<SmsMessage>> GetSentAsync(
        int                    maxCount    = 30,
        IReadOnlySet<string>?  skipHandles = null,
        CancellationToken      ct          = default)
        => await GetFolderAsync("sent", maxCount, skipHandles, ct);

    // ── Generic folder fetch (inbox, sent, …) ─────────────────────────────
    // Gets the listing under one lock acquisition, then fetches each body
    // with its OWN lock acquire/release so real ops (send, poll) can jump in
    // between individual message downloads — no more multi-minute freezes.
    private async Task<List<SmsMessage>> GetFolderAsync(
        string                 folderName,
        int                    maxCount,
        IReadOnlySet<string>?  skipHandles,
        CancellationToken      ct)
    {
        if (_obex is null) throw new InvalidOperationException("Not connected");

        // Step 1: get listing (handles + metadata) under one lock
        List<(string Handle, MsgMeta Meta)> handles;
        await _obexLock.WaitAsync(ct);
        try   { handles = await GetHandleListingCoreAsync(folderName, ct, maxCount: (ushort)maxCount); }
        finally { _obexLock.Release(); }

        MapLogLine?.Invoke($"[{folderName.ToUpper()} listing] {handles.Count} handles, taking {maxCount}");

        bool isSent = string.Equals(folderName, "sent", StringComparison.OrdinalIgnoreCase);
        var messages = new List<SmsMessage>();

        // Step 2: fetch each body with its own lock acquire/release
        foreach (var (handle, meta) in handles.Take(maxCount))
        {
            ct.ThrowIfCancellationRequested();

            if (skipHandles?.Contains(handle) == true)
            {
                MapLogLine?.Invoke($"[MSG {handle} skipped — already cached]");
                continue;
            }

            await _obexLock.WaitAsync(ct);
            try
            {
                var body = await GetMessageAsync(handle, ct, isMms: meta.Type == "MMS");

                if (isSent)
                {
                    var recipient = !string.IsNullOrEmpty(meta.To) ? meta.To : meta.From;
                    body.From   = $"Me > {recipient}";
                    body.IsSent = true;
                }
                else
                {
                    body.From   = meta.From;
                    body.IsSent = meta.IsSent;
                }

                body.Timestamp = meta.Timestamp;
                body.IsRead    = meta.IsRead;
                messages.Add(body);
                MapLogLine?.Invoke($"[MSG {handle} OK — {body.From}]");
            }
            catch (Exception ex) { MapLogLine?.Invoke($"[MSG {handle} FAIL — {ex.Message}]"); }
            finally { _obexLock.Release(); }

            // Tiny yield so the event loop breathes between downloads
            await Task.Delay(30, ct);
        }

        return messages;
    }

    /// <summary>
    /// Grabs the handle of the newest message in the sent folder.
    /// Used right after SendMessage to tag the local sent copy with the phone's real Handle,
    /// so subsequent syncs can dedup it by Handle instead of fuzzy-matching.
    /// </summary>
    public async Task<string?> GetNewestSentHandleAsync(CancellationToken ct = default)
    {
        if (_obex is null) return null;
        await _obexLock.WaitAsync(ct);
        try
        {
            var appParams = new byte[] { 0x01, 0x02, 0x00, 0x01 }; // MaxListCount=1
            await _obex.SetPathAsync("",       ct: ct);
            await _obex.SetPathAsync("telecom",ct: ct);
            await _obex.SetPathAsync("msg",    ct: ct);
            await _obex.SetPathAsync("sent",   ct: ct);
            var xml = await _obex.GetAsync("x-bt/MAP-msg-listing", name: null, appParams: appParams, ct: ct);
            if (xml.Length == 0)
                xml = await _obex.GetAsync("x-bt/MAP-msg-listing", name: null, appParams: null, ct: ct);
            var list = ParseMessageListing(Encoding.UTF8.GetString(xml));
            return list.FirstOrDefault().Handle;
        }
        catch { return null; }
        finally { _obexLock.Release(); }
    }

    // ── Send an outgoing SMS via MAP OBEX PUT ─────────────────────────────
    /// <summary>
    /// Pushes a read/unread change back to the phone using MAP SetMessageStatus.
    /// </summary>
    public Task<bool> SetMessageReadStatusAsync(string handle, bool isRead, CancellationToken ct = default)
        => SetMessageStatusAsync(handle, statusIndicator: 0x00, enabled: isRead, "read", "unread", "READSTATE", ct);

    /// <summary>
    /// Pushes a deleted/undeleted change back to the phone using MAP SetMessageStatus.
    /// The MAP profile uses deletedStatus=yes to move a message out of inbox/sent into
    /// the phone's Deleted folder, which is the behavior DeskPhone expects for delete.
    /// </summary>
    public Task<bool> SetMessageDeletedStatusAsync(string handle, bool isDeleted, CancellationToken ct = default)
        => SetMessageStatusAsync(handle, statusIndicator: 0x01, enabled: isDeleted, "deleted", "undeleted", "DELETE", ct);

    private async Task<bool> SetMessageStatusAsync(
        string handle,
        byte statusIndicator,
        bool enabled,
        string enabledLabel,
        string disabledLabel,
        string logLabel,
        CancellationToken ct = default)
    {
        if (_obex is null) throw new InvalidOperationException("Not connected");
        if (string.IsNullOrWhiteSpace(handle)) return false;

        await _obexLock.WaitAsync(ct);
        try
        {
            await _obex.SetPathAsync("",        ct: ct);
            await _obex.SetPathAsync("telecom", ct: ct);
            await _obex.SetPathAsync("msg",     ct: ct);

            var appParams = new byte[]
            {
                0x17, 0x01, statusIndicator,
                0x18, 0x01, enabled ? (byte)0x01 : (byte)0x00
            };

            var code = await _obex.PutAsync(
                "x-bt/messageStatus",
                handle,
                new byte[] { 0x30 },
                appParams,
                ct: ct);

            bool ok = code == 0xA0;
            MapLogLine?.Invoke(ok
                ? $"[MAP {logLabel} OK] {handle} => {(enabled ? enabledLabel : disabledLabel)}"
                : $"[MAP {logLabel} FAIL] {handle} => {(enabled ? enabledLabel : disabledLabel)} (0x{code:X2})");
            return ok;
        }
        finally { _obexLock.Release(); }
    }

    // â”€â”€ Send an outgoing SMS via MAP OBEX PUT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    public async Task<bool> SendMessageAsync(string toNumber, string text,
                                              IReadOnlyList<MessageAttachment>? attachments = null,
                                              CancellationToken ct = default)
    {
        if (_obex is null) throw new InvalidOperationException("Not connected");
        await _obexLock.WaitAsync(ct);
        try
        {
            MapLogLine?.Invoke($"[MAP SEND] → {toNumber}");

            // Navigate to telecom/msg — MAP spec says PushMessage is PUT here
            var sp0 = await _obex.SetPathAsync("",        ct: ct);  // reset to root
            var sp1 = await _obex.SetPathAsync("telecom", ct: ct);
            var sp2 = await _obex.SetPathAsync("msg",     ct: ct);
            MapLogLine?.Invoke($"[MAP SEND SETPATH root={sp0} telecom={sp1} msg={sp2}]");

            // App-Parameters for PushMessage (MAP spec §3.1.3.3).
            // Format: Tag (1 byte), Length (1 byte), Value (Length bytes).
            //   0x0C Transparent = 0x00 → save a copy in Sent folder on phone
            //   0x0D Retry       = 0x01 → phone retries over cellular if it fails
            //   0x14 Charset     = 0x01 → body is UTF-8
            var appParams = new byte[]
            {
                0x0C, 0x01, 0x00,   // Transparent = 0 (save to Sent)
                0x0D, 0x01, 0x01,   // Retry = 1
                0x14, 0x01, 0x01    // Charset = UTF-8
            };

            // Try SMS_GSM first (universal default), then SMS_CDMA if phone rejects.
            // 0xC6 = "Not Acceptable" — the only error worth retrying with a different type.
            var hasAttachments = attachments is { Count: > 0 };
            foreach (var msgType in hasAttachments ? new[] { "MMS" } : new[] { "SMS_GSM", "SMS_CDMA", "MMS" })
            {
                var bmsg = hasAttachments
                    ? $"[binary MIME MMS payload for {attachments!.Count} attachment(s)]"
                    : BuildBMessage(toNumber, text, msgType);
                var bytes = hasAttachments
                    ? BuildMmsBMessage(toNumber, text, attachments!)
                    : Encoding.UTF8.GetBytes(bmsg);

                MapLogLine?.Invoke($"[MAP SEND bMessage type={msgType} ({bytes.Length} bytes)]");
                MapLogLine?.Invoke(bmsg.Replace("\r\n", "↵"));

                // Name header = "outbox" — MAP spec §5.4.2 says the Name header in
                // PushMessage identifies which subfolder of the current path receives the message.
                var code = await _obex!.PutAsync("x-bt/message", "outbox", bytes, appParams, ct: ct);
                bool ok  = code == 0xA0;

                if (ok)
                {
                    MapLogLine?.Invoke($"[MAP SEND OK type={msgType}]");
                    return true;
                }

                var reason = code switch
                {
                    0xC0 => "Bad Request (0xC0) — bMessage format rejected by phone",
                    0xC1 => "Unauthorized (0xC1) — phone requires MAP notification registration first",
                    0xC3 => "Forbidden (0xC3) — phone refused; kosher content restrictions may block sending",
                    0xC4 => "Not Found (0xC4) — outbox folder not found; folder navigation may have failed",
                    0xC6 => "Not Acceptable (0xC6) — phone rejected message type or content",
                    0xD3 => "Not Implemented (0xD3) — phone MAP server does not support PushMessage (send)",
                    0x00 => "No response — Bluetooth stream closed",
                    _    => $"OBEX error 0x{code:X2}"
                };
                MapLogLine?.Invoke($"[MAP SEND FAILED type={msgType}] {reason}");

                // Only retry a different message type on "Not Acceptable" (0xC6).
                // Any other failure code is definitive — no point retrying.
                if (code != 0xC6) break;
            }

            return false;
        }
        finally { _obexLock.Release(); }
    }

    // Build a bMessage envelope — the format MAP uses to wrap an SMS for sending.
    //
    // Structure per MAP spec §5.2.2 for PushMessage (outgoing from HFU to phone):
    //   BEGIN:BMSG … headers …
    //   BEGIN:BENV
    //     BEGIN:VCARD  ← RECIPIENT goes INSIDE the BENV, not outside it
    //       TEL:number
    //     END:VCARD
    //     BEGIN:BBODY
    //       LENGTH:…   ← byte count of BEGIN:MSG…END:MSG block (inclusive of CRLFs)
    //       BEGIN:MSG
    //         body text
    //       END:MSG
    //     END:BBODY
    //   END:BENV
    //   END:BMSG
    //
    // Common mistake: placing VCARD before BENV (instead of inside it) → phone returns 0xC6.
    private static string BuildBMessage(string toNumber, string text, string msgType = "SMS_GSM")
    {
        // LENGTH per MAP spec §5.2.2: byte count from "BEGIN:MSG\r\n" through "END:MSG\r\n"
        var msgSection = "BEGIN:MSG\r\n" + text + "\r\n" + "END:MSG\r\n";
        int length     = Encoding.UTF8.GetByteCount(msgSection);

        return
            "BEGIN:BMSG\r\n" +
            "VERSION:1.0\r\n" +
            "STATUS:UNREAD\r\n" +
            $"TYPE:{msgType}\r\n" +
            "FOLDER:telecom/msg/outbox\r\n" +
            "BEGIN:BENV\r\n" +
            "BEGIN:VCARD\r\n" +       // ← recipient VCARD is inside BENV (MAP spec §5.2.2)
            "VERSION:2.1\r\n" +
            $"TEL:{toNumber}\r\n" +
            "END:VCARD\r\n" +
            "BEGIN:BBODY\r\n" +
            "CHARSET:UTF-8\r\n" +
            "ENCODING:8BIT\r\n" +
            $"LENGTH:{length}\r\n" +
            msgSection +
            "END:BBODY\r\n" +
            "END:BENV\r\n" +
            "END:BMSG\r\n";
    }

    // ── Fetch a single message by handle ─────────────────────────────────
    // isMms=true → Attachment=Yes so the phone sends the full MIME body.
    // isMms=false → Attachment=No to keep SMS fast (body only, no binary blob).
    private static byte[] BuildMmsBMessage(string toNumber, string text, IReadOnlyList<MessageAttachment> attachments)
    {
        var boundary = $"deskphone-{Guid.NewGuid():N}";
        var mime = new StringBuilder();
        mime.Append($"Content-Type: multipart/mixed; boundary=\"{boundary}\"\r\n");
        mime.Append("MIME-Version: 1.0\r\n\r\n");

        if (!string.IsNullOrWhiteSpace(text))
        {
            mime.Append($"--{boundary}\r\n");
            mime.Append("Content-Type: text/plain; charset=utf-8\r\n");
            mime.Append("Content-Transfer-Encoding: 8bit\r\n\r\n");
            mime.Append(text);
            mime.Append("\r\n");
        }

        foreach (var attachment in attachments)
        {
            mime.Append($"--{boundary}\r\n");
            mime.Append($"Content-Type: {attachment.ContentType}; name=\"{EscapeMimeValue(attachment.DisplayName)}\"\r\n");
            mime.Append("Content-Transfer-Encoding: base64\r\n");
            mime.Append($"Content-Disposition: attachment; filename=\"{EscapeMimeValue(attachment.DisplayName)}\"\r\n\r\n");
            mime.Append(WrapBase64(Convert.ToBase64String(attachment.Data)));
            mime.Append("\r\n");
        }

        mime.Append($"--{boundary}--\r\n");

        var mimeBytes = Encoding.UTF8.GetBytes(mime.ToString());
        var prefix = Encoding.UTF8.GetBytes(
            "BEGIN:BMSG\r\n" +
            "VERSION:1.0\r\n" +
            "STATUS:UNREAD\r\n" +
            "TYPE:MMS\r\n" +
            "FOLDER:telecom/msg/outbox\r\n" +
            "BEGIN:BENV\r\n" +
            "BEGIN:VCARD\r\n" +
            "VERSION:2.1\r\n" +
            $"TEL:{toNumber}\r\n" +
            "END:VCARD\r\n" +
            "BEGIN:BBODY\r\n" +
            "ENCODING:8BIT\r\n" +
            $"LENGTH:{mimeBytes.Length + Encoding.UTF8.GetByteCount("BEGIN:MSG\r\nEND:MSG\r\n")}\r\n" +
            "BEGIN:MSG\r\n");
        var suffix = Encoding.UTF8.GetBytes("\r\nEND:MSG\r\nEND:BBODY\r\nEND:BENV\r\nEND:BMSG\r\n");

        var payload = new byte[prefix.Length + mimeBytes.Length + suffix.Length];
        Buffer.BlockCopy(prefix, 0, payload, 0, prefix.Length);
        Buffer.BlockCopy(mimeBytes, 0, payload, prefix.Length, mimeBytes.Length);
        Buffer.BlockCopy(suffix, 0, payload, prefix.Length + mimeBytes.Length, suffix.Length);
        return payload;
    }

    private static string WrapBase64(string value)
    {
        const int lineLength = 76;
        var sb = new StringBuilder(value.Length + (value.Length / lineLength + 1) * 2);
        for (int i = 0; i < value.Length; i += lineLength)
        {
            sb.Append(value, i, Math.Min(lineLength, value.Length - i));
            sb.Append("\r\n");
        }
        return sb.ToString();
    }

    private static string EscapeMimeValue(string value)
        => (value ?? "attachment.bin").Replace("\"", "");

    private async Task<SmsMessage> GetMessageAsync(string handle, CancellationToken ct, bool isMms = false)
    {
        var appParams = isMms
            ? new byte[] { 0x0A, 0x01, 0x01 }          // Attachment=Yes (MMS: need full MIME)
            : new byte[]
              {
                  0x0A, 0x01, 0x00,   // Attachment=No  (SMS: body text only)
                  0x14, 0x01, 0x01    // Charset=UTF-8
              };

        var raw = await _obex!.GetAsync(
            "x-bt/message",
            name:      handle,
            appParams: appParams,
            ct:        ct);

        if (raw.Length == 0)
        {
            MapLogLine?.Invoke($"[MSG {handle}] Retrying without app-params…");
            raw = await _obex!.GetAsync("x-bt/message", name: handle, appParams: null, ct: ct);
        }

        MapLogLine?.Invoke($"[MSG {handle}] raw={raw.Length} bytes isMms={isMms}");
        return ParseBMessage(raw, handle, MapLogLine);
    }

    // ── bMessage parser ───────────────────────────────────────────────────
    private static SmsMessage ParseBMessage(byte[] rawBytes, string handle, Action<string>? log = null)
    {
        var msg = new SmsMessage { Handle = handle };

        // Decode as UTF-8 for the bMessage envelope (headers are always ASCII/UTF-8)
        var bmsg = Encoding.UTF8.GetString(rawBytes);

        // ── Case 1: standard bMessage envelope (BEGIN:BMSG ... END:BMSG) ─────
        // TYPE:MMS header inside indicates MMS content in the body.
        var beginTag = "BEGIN:MSG"u8.ToArray();
        var endTag   = "END:MSG"u8.ToArray();
        int startIdx = IndexOf(rawBytes, beginTag);

        bool isMms = bmsg.Contains("TYPE:MMS", StringComparison.OrdinalIgnoreCase);
        msg.IsMms = isMms;

        if (startIdx >= 0)
        {
            // Skip past "BEGIN:MSG\r\n" or "BEGIN:MSG\n"
            int afterBegin = startIdx + beginTag.Length;
            if (afterBegin < rawBytes.Length && rawBytes[afterBegin] == '\r') afterBegin++;
            if (afterBegin < rawBytes.Length && rawBytes[afterBegin] == '\n') afterBegin++;

            int endIdx = IndexOf(rawBytes, endTag, afterBegin);
            if (endIdx > afterBegin)
            {
                var msgBodyBytes = rawBytes[afterBegin..endIdx];

                if (isMms)
                {
                    // Parse the MIME multipart document from the raw bytes
                    ParseMimeParts(msgBodyBytes, msg, log);
                }
                else
                {
                    msg.Body = CleanMessageBody(Encoding.UTF8.GetString(msgBodyBytes).Trim());
                }
                return msg;
            }
        }

        // ── Case 2: Fig 52 sends raw MIME directly (no bMessage envelope) ────
        // Detected by top-level MIME headers: Content-Type with multipart or vnd.wap
        bool isRawMime = bmsg.Contains("multipart", StringComparison.OrdinalIgnoreCase)
                      || bmsg.Contains("vnd.wap",   StringComparison.OrdinalIgnoreCase);

        if (isRawMime)
        {
            msg.IsMms = true;
            log?.Invoke($"[MMS] Raw MIME detected (no bMessage wrapper) — handle={handle}");
            ParseMimeParts(rawBytes, msg, log);
            return msg;
        }

        // ── Case 3: plain text fallback ───────────────────────────────────────
        msg.Body = CleanMessageBody(bmsg.Trim());
        return msg;
    }

    private static string CleanMessageBody(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return body;
        // Strip carrier bug: ~ followed by exactly 15 alphanumeric characters at the end
        // Pattern: ~[a-zA-Z0-9]{15} followed by optional whitespace to end-of-string
        return Regex.Replace(body, @"~[a-zA-Z0-9]{15}\s*$", "").Trim();
    }

    // ── Binary byte search helper ─────────────────────────────────────────
    private static int IndexOf(byte[] haystack, byte[] needle, int startAt = 0)
    {
        for (int i = startAt; i <= haystack.Length - needle.Length; i++)
        {
            bool found = true;
            for (int j = 0; j < needle.Length; j++)
                if (haystack[i + j] != needle[j]) { found = false; break; }
            if (found) return i;
        }
        return -1;
    }

    // ── MIME multipart parser for MMS bodies ─────────────────────────────
    // MMS bodies from MAP arrive as MIME multipart documents.
    // Structure: MIME headers, blank line, then parts separated by a boundary.
    // Each part has its own Content-Type and Content-Transfer-Encoding headers.
    // We scan for: text/plain (message text) and image/* (photo attachment).
    private static void ParseMimeParts(byte[] mimeBytes, SmsMessage msg, Action<string>? log = null)
    {
        // Decode as Latin-1 to preserve binary bytes faithfully in a string
        var mime = Encoding.Latin1.GetString(mimeBytes);

        log?.Invoke($"[MMS] ParseMimeParts: {mimeBytes.Length} bytes, first 120 chars: {new string(mime.Take(120).ToArray()).Replace("\r","\\r").Replace("\n","\\n")}");

        // Find the boundary from the top-level Content-Type header
        var boundaryMatch = Regex.Match(mime,
            @"[Cc]ontent-[Tt]ype\s*:.*?boundary=""?([^""\r\n;]+)""?",
            RegexOptions.Singleline);

        if (!boundaryMatch.Success)
        {
            log?.Invoke("[MMS] No boundary found — trying single-part extract");
            ExtractPayloadFromPart(mime, Encoding.Latin1.GetBytes(mime), msg, log);
            return;
        }

        var boundaryRaw = boundaryMatch.Groups[1].Value.Trim();
        var boundary    = "--" + boundaryRaw;
        log?.Invoke($"[MMS] boundary='{boundaryRaw}' → splitting on '{boundary}'");

        // Split into parts by boundary
        var parts = mime.Split(new[] { boundary }, StringSplitOptions.RemoveEmptyEntries);
        log?.Invoke($"[MMS] Split into {parts.Length} parts");

        foreach (var part in parts)
        {
            if (part.TrimStart().StartsWith("--") || part.Trim() == "--") continue; // terminal boundary
            ExtractPayloadFromPart(part, Encoding.Latin1.GetBytes(part), msg, log);
        }

        // If we found an image but no text body, leave Body empty (UI shows image only)
        // If we found neither, show a placeholder
        if (!msg.Attachments.Any() && string.IsNullOrEmpty(msg.Body))
        {
            log?.Invoke("[MMS] No image or text extracted — setting placeholder");
            msg.Body = "[MMS — content format not recognized]";
        }
        else
        {
            log?.Invoke($"[MMS] Done — AttachmentData={msg.AttachmentData?.Length.ToString() ?? "null"} Body='{msg.Body}'");
        }
    }

    // ── Extract text or image from a single MIME part ─────────────────────
    private static void ExtractPayloadFromPart(string part, byte[] partBytes, SmsMessage msg, Action<string>? log = null)
    {
        // Find the header/body split (blank line)
        int headerEnd = part.IndexOf("\r\n\r\n", StringComparison.Ordinal);
        if (headerEnd < 0) headerEnd = part.IndexOf("\n\n", StringComparison.Ordinal);
        if (headerEnd < 0) headerEnd = 0;

        var headers = part[..headerEnd];
        int bodyOffset = headerEnd + (part[headerEnd..].StartsWith("\r\n\r\n") ? 4 : 2);

        var contentType = Regex.Match(headers,
            @"[Cc]ontent-[Tt]ype\s*:\s*([^\r\n;]+)", RegexOptions.Singleline)
            .Groups[1].Value.Trim().ToLowerInvariant();

        var encoding = Regex.Match(headers,
            @"[Cc]ontent-[Tt]ransfer-[Ee]ncoding\s*:\s*([^\r\n]+)", RegexOptions.Singleline)
            .Groups[1].Value.Trim().ToLowerInvariant();

        log?.Invoke($"[MMS] Part: ct='{contentType}' enc='{encoding}' hdrEnd={headerEnd} bodyOff={bodyOffset} partLen={part.Length}");

        // ── Image part ────────────────────────────────────────────────────
        if (contentType.StartsWith("image/") || IsImageMagic(partBytes, bodyOffset))
        {
            byte[]? imageBytes = null;

            if (encoding == "base64")
            {
                var b64 = part[bodyOffset..].Trim();
                b64 = Regex.Replace(b64, @"\s+", "");
                // Strip any trailing MIME boundary marker
                var terminatorIdx = b64.IndexOf("--", StringComparison.Ordinal);
                if (terminatorIdx > 0) b64 = b64[..terminatorIdx];
                log?.Invoke($"[MMS] Base64 block: {b64.Length} chars, first 20: {b64[..Math.Min(20,b64.Length)]}");
                try { imageBytes = Convert.FromBase64String(b64); }
                catch (Exception ex) { log?.Invoke($"[MMS] Base64 decode error: {ex.Message}"); }
            }
            else
            {
                var bodyStart = Encoding.Latin1.GetByteCount(part[..bodyOffset]);
                if (bodyStart < partBytes.Length)
                    imageBytes = partBytes[bodyStart..];
                log?.Invoke($"[MMS] Binary image: {imageBytes?.Length ?? 0} bytes");
            }

            if (imageBytes != null && IsImageMagic(imageBytes, 0))
            {
                log?.Invoke($"[MMS] Image magic OK — {imageBytes.Length} bytes stored");
                msg.AddAttachment(new MessageAttachment
                {
                    ContentType = string.IsNullOrWhiteSpace(contentType) ? GuessImageContentType(imageBytes) : contentType,
                    FileName = ExtractMimeFileName(headers, contentType, msg.Attachments.Count + 1),
                    Data = imageBytes
                });
            }
            else
            {
                log?.Invoke($"[MMS] Image magic FAILED — bytes={imageBytes?.Length ?? 0}, first4={string.Join(",", imageBytes?.Take(4).Select(b => b.ToString("X2")) ?? Array.Empty<string>())}");
            }
            return;
        }

        if (contentType.StartsWith("text/plain") && string.IsNullOrEmpty(msg.Body))
        {
            var bodyStr = part[bodyOffset..].Trim();
            if (!bodyStr.StartsWith("<smil", StringComparison.OrdinalIgnoreCase))
                msg.Body = CleanMessageBody(bodyStr);
            return;
        }

        // ── Fallback: scan all large base64 blocks for embedded images ────
        if (!string.IsNullOrWhiteSpace(contentType) &&
            !contentType.StartsWith("multipart/", StringComparison.OrdinalIgnoreCase) &&
            !contentType.Contains("smil", StringComparison.OrdinalIgnoreCase))
        {
            var attachmentBytes = DecodeAttachmentBytes(part, partBytes, bodyOffset, encoding, log);
            if (attachmentBytes.Length > 0)
            {
                var fileName = ExtractMimeFileName(headers, contentType, msg.Attachments.Count + 1);
                log?.Invoke($"[MMS] Non-image attachment stored: ct='{contentType}' file='{fileName}' bytes={attachmentBytes.Length}");
                msg.AddAttachment(new MessageAttachment
                {
                    ContentType = contentType,
                    FileName = fileName,
                    Data = attachmentBytes
                });
                return;
            }
        }

        if (!msg.HasImageAttachment)
        {
            foreach (Match m in Regex.Matches(part, @"([A-Za-z0-9+/=]{60,}(?:\s+[A-Za-z0-9+/=]{10,})*)"))
            {
                try
                {
                    var b64 = Regex.Replace(m.Groups[1].Value, @"\s+", "");
                    while (b64.Length % 4 != 0) b64 += "=";
                    var bytes = Convert.FromBase64String(b64);
                    if (IsImageMagic(bytes, 0))
                    {
                        log?.Invoke($"[MMS] Fallback base64 scan found image: {bytes.Length} bytes");
                        msg.AddAttachment(new MessageAttachment
                        {
                            ContentType = GuessImageContentType(bytes),
                            FileName = ExtractMimeFileName(headers, GuessImageContentType(bytes), msg.Attachments.Count + 1),
                            Data = bytes
                        });
                        return;
                    }
                }
                catch { }
            }
        }
    }

    // ── Image magic byte check (JPEG, PNG, GIF, WebP) ────────────────────
    private static byte[] DecodeAttachmentBytes(string part, byte[] partBytes, int bodyOffset, string encoding, Action<string>? log = null)
    {
        if (bodyOffset < 0)
            return Array.Empty<byte>();

        if (string.Equals(encoding, "base64", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                var b64 = part[Math.Min(bodyOffset, part.Length)..].Trim();
                b64 = Regex.Replace(b64, @"\s+", "");
                while (b64.Length % 4 != 0) b64 += "=";
                return Convert.FromBase64String(b64);
            }
            catch (Exception ex)
            {
                log?.Invoke($"[MMS] Attachment base64 decode error: {ex.Message}");
                return Array.Empty<byte>();
            }
        }

        var bodyStart = Encoding.Latin1.GetByteCount(part[..Math.Min(bodyOffset, part.Length)]);
        return bodyStart >= partBytes.Length ? Array.Empty<byte>() : partBytes[bodyStart..];
    }

    private static bool IsImageMagic(byte[] data, int offset)
    {
        if (data.Length - offset < 4) return false;
        return (data[offset] == 0xFF && data[offset+1] == 0xD8 && data[offset+2] == 0xFF) // JPEG
            || (data[offset] == 0x89 && data[offset+1] == 0x50 && data[offset+2] == 0x4E && data[offset+3] == 0x47) // PNG
            || (data[offset] == 0x47 && data[offset+1] == 0x49 && data[offset+2] == 0x46 && data[offset+3] == 0x38) // GIF
            || (data[offset] == 0x52 && data[offset+1] == 0x49 && data[offset+2] == 0x46 && data[offset+3] == 0x46); // WebP (RIFF)
    }

    private static string ExtractMimeFileName(string headers, string contentType, int partNumber)
    {
        var fileName = Regex.Match(headers,
                @"[Ff]ilename=""?([^""\r\n;]+)""?",
                RegexOptions.Singleline)
            .Groups[1].Value.Trim();

        if (string.IsNullOrWhiteSpace(fileName))
            fileName = Regex.Match(headers,
                    @"[Nn]ame=""?([^""\r\n;]+)""?",
                    RegexOptions.Singleline)
                .Groups[1].Value.Trim();

        if (!string.IsNullOrWhiteSpace(fileName))
            return SanitizeAttachmentFileName(fileName);

        return $"MMS_attachment_{partNumber:00}.{GuessAttachmentExtension(contentType)}";
    }

    private static string SanitizeAttachmentFileName(string value)
    {
        var invalid = Path.GetInvalidFileNameChars().ToHashSet();
        var clean = new string(value.Select(ch => invalid.Contains(ch) ? '_' : ch).ToArray()).Trim();
        return string.IsNullOrWhiteSpace(clean) ? "MMS_attachment.bin" : clean;
    }

    private static string GuessAttachmentExtension(string contentType)
        => contentType.ToLowerInvariant() switch
        {
            var type when type.Contains("png") => "png",
            var type when type.Contains("gif") => "gif",
            var type when type.Contains("webp") => "webp",
            var type when type.Contains("jpeg") || type.Contains("jpg") => "jpg",
            var type when type.Contains("vcard") => "vcf",
            var type when type.Contains("pdf") => "pdf",
            var type when type.Contains("plain") => "txt",
            var type when type.StartsWith("audio/") => "audio",
            var type when type.StartsWith("video/") => "video",
            _ => "bin"
        };

    private static string GuessImageContentType(byte[] data)
    {
        if (data.Length >= 4 && data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47) return "image/png";
        if (data.Length >= 4 && data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x38) return "image/gif";
        if (data.Length >= 4 && data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46) return "image/webp";
        return "image/jpeg";
    }

    private static string GuessImageExtension(string contentType)
        => contentType.ToLowerInvariant() switch
        {
            var type when type.Contains("png") => "png",
            var type when type.Contains("gif") => "gif",
            var type when type.Contains("webp") => "webp",
            _ => "jpg"
        };

    // ── Message-listing XML parser ────────────────────────────────────────
    private static List<(string Handle, MsgMeta Meta)> ParseMessageListing(string xml)
    {
        var result = new List<(string, MsgMeta)>();

        try
        {
            var doc = new XmlDocument();
            // Some phones omit the XML declaration; be lenient
            if (!xml.TrimStart().StartsWith('<')) return result;
            doc.LoadXml(xml);

            var nodes = doc.SelectNodes("//msg");
            if (nodes is null) return result;

            foreach (XmlNode n in nodes)
            {
                var handle = n.Attributes?["handle"]?.Value ?? "";
                if (string.IsNullOrEmpty(handle)) continue;

                var meta = new MsgMeta
                {
                    From      = n.Attributes?["sender_addressing"]?.Value   ?? "",
                    To        = n.Attributes?["recipient_addressing"]?.Value ?? "",
                    IsRead    = n.Attributes?["read"]?.Value  == "yes",
                    IsSent    = n.Attributes?["sent"]?.Value  == "yes",
                    Timestamp = ParseMapDate(n.Attributes?["datetime"]?.Value),
                    Type      = n.Attributes?["type"]?.Value                ?? ""
                };
                result.Add((handle, meta));
            }
        }
        catch { /* malformed XML — return whatever we got */ }

        return result;
    }

    // MAP datetime format: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSS±HHMM
    private static DateTime ParseMapDate(string? s)
    {
        if (s is null) return DateTime.Now;
        if (DateTime.TryParseExact(s.Length >= 15 ? s[..15] : s,
                "yyyyMMddTHHmmss", null,
                System.Globalization.DateTimeStyles.None, out var dt))
            return dt;
        return DateTime.Now;
    }

    private record MsgMeta(string From = "", string To = "", bool IsRead = false,
                            bool IsSent = false, DateTime Timestamp = default, string Type = "")
    {
        public MsgMeta() : this("", "", false, false, DateTime.Now, "") { }
        public string Folder { get; init; } = "";
    }




    public async ValueTask DisposeAsync()
    {
        if (_obex is not null)
        {
            try { await RegisterForNotificationsAsync(false); } catch { }
            try { await _obex.DisconnectAsync(); } catch { }
            _obex.Dispose();
        }
        _client?.Dispose();
        IsConnected = false;
    }
}
