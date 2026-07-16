namespace DeskPhone.RelayV2.Hfp;

// Typed AT events — the tokenizer's output. The legacy HfpService parsed
// unsolicited result codes inline with string.Split/substring at each use
// site; here the wire text becomes ONE typed event stream that the state
// machine (and tests) consume.

public abstract record AtEvent
{
    /// RING — incoming call alert (repeats every few seconds while ringing).
    public sealed record Ring : AtEvent;

    /// +CLIP: "number",type[,...] — caller ID delivered while ringing.
    public sealed record CallerId(string Number) : AtEvent;

    /// +CIEV: index,value — indicator change. Resolved against the CIND map
    /// captured at handshake, so consumers see names, not magic indexes.
    public sealed record IndicatorChange(string Name, int Value) : AtEvent;

    /// +CCWA: "number",type — call waiting while another call is active.
    public sealed record CallWaiting(string Number) : AtEvent;

    /// +BSIR / +BCS / other codec-negotiation traffic we deliberately ignore
    /// (this host never claims the audio path), surfaced for logging only.
    public sealed record Ignored(string Line) : AtEvent;

    /// OK / ERROR / +CME ERROR — command completion for the in-flight command.
    public sealed record Completion(bool Ok, string? Error = null) : AtEvent;

    /// Anything unrecognized — logged, never fatal. A new handset's exotic
    /// URC must never crash the read loop.
    public sealed record Unknown(string Line) : AtEvent;
}

// Standard HFP indicator names (from the CIND=? handshake). Only the ones
// the call state machine actually consumes are listed; others pass through
// as-is.
public static class HfpIndicators
{
    public const string Call = "call";           // 0 = no active call, 1 = active
    public const string CallSetup = "callsetup"; // 0 idle, 1 incoming, 2 dialing, 3 alerting
    public const string CallHeld = "callheld";
    public const string Service = "service";
    public const string Signal = "signal";
    public const string Battery = "battchg";
}
