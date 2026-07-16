using System.Collections.Concurrent;
using DeskPhone.RelayV2.Bt;
using DeskPhone.RelayV2.Hfp;

namespace DeskPhone.RelayV2;

// The one in-memory snapshot the API serves and the relay pushes. Messages
// are merged by handle (delta sync adds; nothing is wholesale-replaced, so a
// short listing window can never erase older history), and every public read
// is an immutable snapshot list — no reader ever sees a half-updated sync.
public sealed class HostState
{
    public volatile bool PhoneConnected;
    public string PhoneName { get; set; } = "";

    private readonly object _lock = new();
    private readonly Dictionary<string, MapMessage> _messages = new(StringComparer.OrdinalIgnoreCase);
    private IReadOnlyList<CallLogEntry> _pbapCalls = Array.Empty<CallLogEntry>();
    private readonly List<CallLogEntry> _liveCalls = new(); // HFP-resolved calls since this run started
    private const int LiveCallCap = 200;

    public IReadOnlyList<MapMessage> Messages { get; private set; } = Array.Empty<MapMessage>();
    public IReadOnlyList<VCardEntry> Contacts { get; private set; } = Array.Empty<VCardEntry>();
    public IReadOnlyList<CallLogEntry> Calls { get; private set; } = Array.Empty<CallLogEntry>();
    public CallSnapshot? ActiveCall { get; set; }
    public DateTimeOffset LastSyncAt { get; private set; }

    private readonly ConcurrentQueue<string> _log = new();

    // ── Messages ─────────────────────────────────────────────────────────────

    public void UpsertMessages(IEnumerable<MapMessage> incoming)
    {
        lock (_lock)
        {
            foreach (var m in incoming)
                if (m.Handle.Length > 0)
                    _messages[m.Handle] = m;
            RebuildMessagesLocked();
        }
    }

    /// Refresh read flags from a listing window — no body downloads involved.
    public void ApplyReadStates(IEnumerable<(string Handle, bool IsRead)> states)
    {
        lock (_lock)
        {
            var changed = false;
            foreach (var (handle, isRead) in states)
                if (_messages.TryGetValue(handle, out var m) && m.IsRead != isRead)
                {
                    _messages[handle] = m with { IsRead = isRead };
                    changed = true;
                }
            if (changed) RebuildMessagesLocked();
        }
    }

    public void RemoveMessage(string handle)
    {
        lock (_lock)
        {
            if (_messages.Remove(handle)) RebuildMessagesLocked();
        }
    }

    public MapMessage? FindMessage(string handle)
    {
        lock (_lock) return _messages.TryGetValue(handle, out var m) ? m : null;
    }

    /// Snapshot of every handle we already hold a body for (delta-sync input).
    public IReadOnlySet<string> KnownHandles
    {
        get { lock (_lock) return new HashSet<string>(_messages.Keys, StringComparer.OrdinalIgnoreCase); }
    }

    private void RebuildMessagesLocked()
    {
        Messages = _messages.Values
            .OrderByDescending(m => m.Time ?? DateTimeOffset.MinValue)
            .ToList();
        LastSyncAt = DateTimeOffset.UtcNow;
    }

    // ── Contacts / calls ─────────────────────────────────────────────────────

    public void ReplaceContacts(IReadOnlyList<VCardEntry> contacts)
    {
        Contacts = contacts;
        LastSyncAt = DateTimeOffset.UtcNow;
    }

    public void ReplaceCallLog(IReadOnlyList<CallLogEntry> pbapCalls)
    {
        lock (_lock)
        {
            _pbapCalls = pbapCalls;
            RebuildCallsLocked();
        }
    }

    /// A call the live HFP link just resolved (missed / completed) — shown
    /// immediately, without waiting for the next PBAP pull to include it.
    public void AddLiveCall(CallLogEntry entry)
    {
        lock (_lock)
        {
            _liveCalls.Add(entry);
            if (_liveCalls.Count > LiveCallCap) _liveCalls.RemoveAt(0);
            RebuildCallsLocked();
        }
    }

    private void RebuildCallsLocked()
    {
        Calls = _liveCalls.Concat(_pbapCalls)
            .OrderByDescending(c => c.Timestamp ?? 0)
            .ToList();
        LastSyncAt = DateTimeOffset.UtcNow;
    }

    // ── Log / status ─────────────────────────────────────────────────────────

    public void Log(string line)
    {
        _log.Enqueue($"{DateTimeOffset.Now:HH:mm:ss.fff} {line}");
        while (_log.Count > 500 && _log.TryDequeue(out _)) { }
    }
    public string[] LogTail(int n) => _log.ToArray()[^Math.Min(n, _log.Count)..];

    public object StatusPayload() => new
    {
        connected = PhoneConnected,
        deviceName = PhoneName,
        activeCall = ActiveCall == null ? null : new
        {
            state = ActiveCall.State.ToString(),
            number = ActiveCall.Number,
            changedAt = ActiveCall.ChangedAt.ToUnixTimeMilliseconds(),
        },
        messageCount = Messages.Count,
        lastSyncAt = LastSyncAt.ToUnixTimeMilliseconds(),
        host = "windows-relayv2",
    };
}
