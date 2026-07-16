using System.Collections.Concurrent;
using DeskPhone.RelayV2.Bt;
using DeskPhone.RelayV2.Hfp;

namespace DeskPhone.RelayV2;

// The one in-memory snapshot the API serves and the relay pushes. Immutable
// reads (lists are replaced wholesale, never mutated in place), so no reader
// ever sees a half-updated sync.
public sealed class HostState
{
    public volatile bool PhoneConnected;
    public string PhoneName { get; set; } = "";

    public IReadOnlyList<MapMessage> Messages { get; private set; } = Array.Empty<MapMessage>();
    public IReadOnlyList<VCardEntry> Contacts { get; private set; } = Array.Empty<VCardEntry>();
    public IReadOnlyList<object> Calls { get; private set; } = Array.Empty<object>();
    public CallSnapshot? ActiveCall { get; set; }
    public DateTimeOffset LastSyncAt { get; private set; }

    private readonly ConcurrentQueue<string> _log = new();

    public void ReplaceMessages(IReadOnlyList<MapMessage> messages) { Messages = messages; LastSyncAt = DateTimeOffset.UtcNow; }
    public void ReplaceContacts(IReadOnlyList<VCardEntry> contacts) { Contacts = contacts; LastSyncAt = DateTimeOffset.UtcNow; }
    public void ReplaceCalls(IReadOnlyList<object> calls) { Calls = calls; LastSyncAt = DateTimeOffset.UtcNow; }

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
        lastSyncAt = LastSyncAt.ToUnixTimeMilliseconds(),
        host = "windows-relayv2",
    };
}
