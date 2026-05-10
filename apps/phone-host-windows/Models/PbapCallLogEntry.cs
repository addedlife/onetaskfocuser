namespace DeskPhone.Models;

public class PbapCallLogEntry
{
    public string Number { get; set; } = "";
    public string? Name { get; set; }
    public CallDirection Direction { get; set; }
    public DateTime Time { get; set; }
    public string RawTimestamp { get; set; } = "";
    public string SourceObject { get; set; } = "";
    public string SourceDeviceAddress { get; set; } = "";
    public DateTime ImportedAt { get; set; }
}
