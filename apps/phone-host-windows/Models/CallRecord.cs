namespace DeskPhone.Models;

public enum CallDirection { Incoming, Outgoing, Missed }

public class CallRecord
{
    public string        Number    { get; set; } = "";
    public string?       Name      { get; set; }
    public CallDirection Direction { get; set; }
    public DateTime      Time      { get; set; }
    public TimeSpan      Duration  { get; set; }
    public bool          IsPhoneSynced { get; set; }
    public string?       PhoneLogTimestamp { get; set; }
    public string?       PhoneLogSourceObject { get; set; }
    public string?       SourceDeviceAddress { get; set; }

    public string DirectionIcon => Direction switch
    {
        CallDirection.Incoming => "\uE0B5",
        CallDirection.Outgoing => "\uE0B2",
        CallDirection.Missed   => "\uE0B4",
        _                      => "\uE0B0"
    };

    public string DirectionLabel => Direction switch
    {
        CallDirection.Incoming => "Incoming",
        CallDirection.Outgoing => "Outgoing",
        CallDirection.Missed   => "Missed",
        _                      => ""
    };

    public string FormattedNumber => Conversation.FormatPhone(Number);

    public string DisplayNumber => string.IsNullOrWhiteSpace(Name) ? FormattedNumber : Name!;

    public string DurationDisplay => Duration.TotalSeconds < 1
        ? ""
        : $"{(int)Duration.TotalMinutes}:{Duration.Seconds:D2}";

    /// <summary>
    /// Single subtitle line for the call history item.
    /// Combines duration (if any) and direction label — avoids leading spaces
    /// when duration is empty (e.g. missed calls).
    /// </summary>
    public string SubtitleDisplay
    {
        get
        {
            var dir = DirectionLabel;
            var dur = DurationDisplay;
            return string.IsNullOrEmpty(dur) ? dir : $"{dur}  ·  {dir}";
        }
    }

    public string TimeDisplay => Time.Date == DateTime.Today
        ? Time.ToString("h:mm tt")
        : Time.ToString("MMM d  h:mm tt");
}
