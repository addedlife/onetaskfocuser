namespace DeskPhone.Models;

public class CallInfo
{
    public CallStatus    Status      { get; set; } = CallStatus.Idle;
    /// <summary>
    /// Direction is stamped when the call is first established and never changed.
    /// Incoming = phone is ringing, Outgoing = we dialed, Missed = default.
    /// This survives the Dialing→Active mutation so history is always correct.
    /// </summary>
    public CallDirection Direction   { get; set; } = CallDirection.Incoming;
    public string?       Number      { get; set; }
    public string?       DisplayName { get; set; }
    public DateTime      StartTime   { get; set; }

    public string DisplayNumber => DisplayName ?? (Number != null ? Conversation.FormatPhone(Number) : "Unknown");

    public string ElapsedDisplay
    {
        get
        {
            if (Status != CallStatus.Active) return string.Empty;
            var e = DateTime.Now - StartTime;
            return $"{(int)e.TotalMinutes:D2}:{e.Seconds:D2}";
        }
    }
}

public enum CallStatus
{
    Idle,
    IncomingRinging,
    Dialing,
    Active,
    Ending
}
