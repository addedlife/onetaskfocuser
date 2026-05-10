using System.IO;
using System.Text.Json;

namespace DeskPhone.Services;

/// <summary>
/// Persists which conversations the user has read.
/// Stored as a set of "read" phone numbers (normalized, 10-digit).
/// A phone number NOT in the set = conversation has unread messages.
/// </summary>
public class ReadStateService
{
    private static readonly string StorePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "DeskPhone", "readstate.json");

    private HashSet<string> _readPhones = new(StringComparer.OrdinalIgnoreCase);

    public ReadStateService()
    {
        try
        {
            if (File.Exists(StorePath))
            {
                var json = File.ReadAllText(StorePath);
                var list = JsonSerializer.Deserialize<List<string>>(json);
                if (list != null)
                    _readPhones = new HashSet<string>(list, StringComparer.OrdinalIgnoreCase);
            }
        }
        catch { }
    }

    public bool IsRead(string phone) => _readPhones.Contains(phone);

    public void MarkRead(string phone)
    {
        if (_readPhones.Add(phone)) Save();
    }

    public void MarkUnread(string phone)
    {
        if (_readPhones.Remove(phone)) Save();
    }

    private void Save()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(StorePath)!);
            var json = JsonSerializer.Serialize(_readPhones.ToList());
            File.WriteAllText(StorePath, json);
        }
        catch { }
    }
}
