namespace DeskPhone.RelayV2.Hfp;

public enum CallState { Idle, IncomingRinging, Dialing, Active, Ending }

public enum CallOutcome { None, Answered, Missed, Ended }

public sealed record CallSnapshot(CallState State, string Number, DateTimeOffset ChangedAt, CallOutcome LastOutcome);

// The ONE call-state machine. The legacy HfpService derived call state from
// indicator changes inline, and disambiguated "missed vs answered" by racing
// a detached 800ms Task.Run against a revision counter — a heuristic that
// worked but was untestable and racy (CurrentCall was mutated from multiple
// closures with no lock). Here:
//   - every transition is an explicit, pure function of (state, event)
//   - the one genuinely ambiguous case (callsetup→0 while ringing can mean
//     EITHER "missed" or "answered, call=1 arrives a beat later") is modeled
//     as an explicit PendingRingResolution holdoff with an injectable clock,
//     driven by Tick() — no detached timers, fully deterministic in tests
//   - all mutation happens under one lock; consumers get immutable snapshots
public sealed class CallStateMachine
{
    // How long after callsetup→0-while-ringing we wait for call→1 before
    // declaring the call missed. Same 800ms the legacy stack converged on in
    // production (b285-b294 era) — kept, but now as a named, tested constant.
    public static readonly TimeSpan RingResolutionHoldoff = TimeSpan.FromMilliseconds(800);

    private readonly object _lock = new();
    private readonly Func<DateTimeOffset> _now;

    private CallState _state = CallState.Idle;
    private string _number = "";
    private DateTimeOffset _changedAt;
    private CallOutcome _lastOutcome = CallOutcome.None;
    private DateTimeOffset? _ringResolutionDeadline;

    public event Action<CallSnapshot>? StateChanged;
    /// Fired when a completed call should be recorded (missed/answered/ended).
    public event Action<CallOutcome, string>? CallResolved;

    public CallStateMachine(Func<DateTimeOffset>? clock = null)
    {
        _now = clock ?? (() => DateTimeOffset.UtcNow);
        _changedAt = _now();
    }

    public CallSnapshot Snapshot()
    {
        lock (_lock) return new CallSnapshot(_state, _number, _changedAt, _lastOutcome);
    }

    /// Feed one tokenized AT event through the machine.
    public void Handle(AtEvent evt)
    {
        lock (_lock)
        {
            switch (evt)
            {
                case AtEvent.Ring:
                    if (_state is CallState.Idle or CallState.Ending)
                        TransitionLocked(CallState.IncomingRinging);
                    break;

                case AtEvent.CallerId(var number):
                    if (_state == CallState.IncomingRinging && number.Length > 0)
                        _number = number;
                    break;

                case AtEvent.IndicatorChange(HfpIndicators.CallSetup, var setup):
                    HandleCallSetupLocked(setup);
                    break;

                case AtEvent.IndicatorChange(HfpIndicators.Call, var call):
                    HandleCallLocked(call);
                    break;
            }
        }
    }

    /// Advance time-based resolution. Call periodically (the read loop's
    /// cadence is plenty) — and directly in tests with a fake clock.
    public void Tick()
    {
        lock (_lock)
        {
            if (_ringResolutionDeadline is { } deadline && _now() >= deadline)
            {
                // call=1 never arrived inside the holdoff: it really was missed.
                _ringResolutionDeadline = null;
                ResolveLocked(CallOutcome.Missed);
                TransitionLocked(CallState.Idle);
            }
        }
    }

    /// The local user initiated an outbound dial (ATD sent).
    public void NoteDialing(string number)
    {
        lock (_lock)
        {
            _number = number;
            TransitionLocked(CallState.Dialing);
        }
    }

    private void HandleCallSetupLocked(int setup)
    {
        switch (setup)
        {
            case 1: // incoming
                if (_state is CallState.Idle or CallState.Ending) TransitionLocked(CallState.IncomingRinging);
                break;
            case 2: // outgoing dialing
            case 3: // outgoing alerting
                if (_state is CallState.Idle or CallState.Ending) TransitionLocked(CallState.Dialing);
                break;
            case 0:
                if (_state == CallState.IncomingRinging)
                {
                    // Ambiguous: either the caller gave up (missed) or the call
                    // was just answered and call=1 is about to arrive. Arm the
                    // holdoff instead of deciding now.
                    _ringResolutionDeadline = _now() + RingResolutionHoldoff;
                }
                else if (_state == CallState.Dialing)
                {
                    // Outbound setup ended without call=1: remote rejected/failed.
                    ResolveLocked(CallOutcome.Ended);
                    TransitionLocked(CallState.Idle);
                }
                break;
        }
    }

    private void HandleCallLocked(int call)
    {
        if (call == 1)
        {
            // A live call always wins any pending ring resolution — this is the
            // "answered" leg of the ambiguity.
            var ringWasPending = _ringResolutionDeadline != null;
            _ringResolutionDeadline = null;
            if (_state != CallState.Active)
            {
                if (_state == CallState.IncomingRinging || ringWasPending)
                    ResolveLocked(CallOutcome.Answered);
                TransitionLocked(CallState.Active);
            }
        }
        else // call == 0
        {
            if (_state == CallState.Active)
            {
                ResolveLocked(CallOutcome.Ended);
                TransitionLocked(CallState.Idle);
            }
        }
    }

    private void ResolveLocked(CallOutcome outcome)
    {
        _lastOutcome = outcome;
        var number = _number;
        // Fire outside the state mutation but inside the lock is fine — the
        // handlers are queue-posts, never re-entrant machine calls.
        CallResolved?.Invoke(outcome, number);
    }

    private void TransitionLocked(CallState next)
    {
        if (_state == next) return;
        _state = next;
        _changedAt = _now();
        if (next == CallState.Idle) _number = "";
        StateChanged?.Invoke(new CallSnapshot(_state, _number, _changedAt, _lastOutcome));
    }
}
