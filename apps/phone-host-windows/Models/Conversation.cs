using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace DeskPhone.Models;

/// <summary>
/// A conversation thread — all messages exchanged with one phone number.
/// The UI binds to ObservableCollection&lt;Conversation&gt; rather than flat SmsMessages,
/// giving iMessage-style thread grouping.
/// </summary>
public class Conversation : INotifyPropertyChanged
{
    // Canonical 10-digit phone number (digits only, no country code).
    // This is the unique key for grouping — "+1 (555) 123-4567" → "5551234567"
    public string PhoneNumber { get; set; } = "";
    public string? ContactName { get; set; }

    // All messages in this thread, oldest → newest
    public ObservableCollection<SmsMessage> Messages { get; } = new();

    public SmsMessage? LastMessage   => Messages.Count > 0 ? Messages[^1] : null;
    public DateTime    LastTimestamp => LastMessage?.Timestamp ?? DateTime.MinValue;

    // ── Display helpers ───────────────────────────────────────────────────
    public string DisplayName  => string.IsNullOrWhiteSpace(ContactName) ? FormatPhone(PhoneNumber) : ContactName;
    public string FormattedPhone => FormatPhone(PhoneNumber);
    public string PreviewText  => LastMessage?.PreviewBody ?? "";
    public bool   HasMessages  => Messages.Count > 0;

    // Hidden by search filter
    private bool _isHidden;
    public bool IsHidden
    {
        get => _isHidden;
        set { _isHidden = value; OnPropertyChanged(); }
    }

    private bool _isUnread;
    public bool IsUnread
    {
        get => _isUnread;
        set { _isUnread = value; OnPropertyChanged(); }
    }

    private bool _isPinned;
    public bool IsPinned
    {
        get => _isPinned;
        set { _isPinned = value; OnPropertyChanged(); }
    }

    private bool _areAlertsMuted;
    public bool AreAlertsMuted
    {
        get => _areAlertsMuted;
        set { _areAlertsMuted = value; OnPropertyChanged(); }
    }

    private bool _isBlocked;
    public bool IsBlocked
    {
        get => _isBlocked;
        set { _isBlocked = value; OnPropertyChanged(); }
    }

    public string AvatarInitial
    {
        get
        {
            var d = DisplayName;
            foreach (var c in d) if (char.IsLetter(c)) return c.ToString().ToUpper();
            foreach (var c in d) if (char.IsDigit(c))  return c.ToString();
            return "?";
        }
    }

    public string TimestampDisplay
    {
        get
        {
            if (LastMessage is null) return "";
            var ts   = LastMessage.Timestamp;
            var diff = DateTime.Now - ts;
            if (diff.TotalMinutes < 2) return "now";
            if (diff.TotalHours   < 1) return $"{(int)diff.TotalMinutes}m";
            if (diff.TotalDays    < 1) return ts.ToString("h:mm tt");
            if (diff.TotalDays    < 7) return ts.ToString("ddd");
            return ts.ToString("MMM d");
        }
    }

    /// <summary>
    /// Call after Messages is updated so the UI list row refreshes its preview text,
    /// timestamp chip, etc. without rebuilding the whole collection.
    /// </summary>
    public void NotifyChanged()
    {
        OnPropertyChanged(nameof(LastMessage));
        OnPropertyChanged(nameof(LastTimestamp));
        OnPropertyChanged(nameof(PreviewText));
        OnPropertyChanged(nameof(TimestampDisplay));
        OnPropertyChanged(nameof(HasMessages));
        OnPropertyChanged(nameof(AvatarInitial));
        OnPropertyChanged(nameof(DisplayName));
        OnPropertyChanged(nameof(IsHidden));
        OnPropertyChanged(nameof(IsUnread));
        OnPropertyChanged(nameof(IsPinned));
        OnPropertyChanged(nameof(AreAlertsMuted));
        OnPropertyChanged(nameof(IsBlocked));
    }

    // Format 10-digit US number as (555) 123-4567; pass through anything else as-is
    public static string FormatPhone(string digits)
    {
        if (string.IsNullOrEmpty(digits)) return "Unknown";
        if (digits.Length == 10)
            return $"({digits[..3]}) {digits[3..6]}-{digits[6..]}";
        return digits;
    }

    // ── INotifyPropertyChanged ────────────────────────────────────────────
    public event PropertyChangedEventHandler? PropertyChanged;
    private void OnPropertyChanged([CallerMemberName] string? name = null)
        => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
