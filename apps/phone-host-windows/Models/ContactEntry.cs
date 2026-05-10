using System.Text.Json.Serialization;

namespace DeskPhone.Models;

public class ContactEntry
{
    public string DisplayName { get; set; } = "";
    public List<string> PhoneNumbers { get; set; } = new();
    public string SourceDeviceAddress { get; set; } = "";
    public string SourceFileName { get; set; } = "";
    public DateTime ImportedAt { get; set; } = DateTime.Now;

    [JsonIgnore]
    public string PrimaryPhone => PhoneNumbers.FirstOrDefault() ?? "";
}
