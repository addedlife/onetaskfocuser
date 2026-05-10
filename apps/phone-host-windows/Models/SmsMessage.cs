using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text.Json.Serialization;
using System.Windows;
using DeskPhone.Services;

namespace DeskPhone.Models;

public class SmsMessage : INotifyPropertyChanged
{
    public string   Handle    { get; set; } = "";   // MAP handle (phone's internal ID)
    public string?  LocalId   { get; set; }         // stable GUID for locally-created sent msgs
    public string   SourceDeviceAddress { get; set; } = "";
    public string   From      { get; set; } = "";
    public string   Body      { get; set; } = "";
    public DateTime Timestamp { get; set; }
    public bool     IsRead    { get; set; }
    public bool     IsSent    { get; set; }
    public bool     IsMms     { get; set; }

    private string _sendStatus = "";
    public string SendStatus
    {
        get => _sendStatus;
        set
        {
            if (_sendStatus == value) return;
            _sendStatus = value ?? "";
            OnPropertyChanged();
            OnPropertyChanged(nameof(HasSendStatus));
            OnPropertyChanged(nameof(SendStatusLabel));
            OnPropertyChanged(nameof(SendStatusIcon));
            OnPropertyChanged(nameof(OutgoingStatusLabel));
            OnPropertyChanged(nameof(OutgoingStatusIcon));
            OnPropertyChanged(nameof(IsSendFailed));
            OnPropertyChanged(nameof(IsSending));
        }
    }

    [JsonIgnore] public bool HasSendStatus => IsSent && !string.IsNullOrWhiteSpace(SendStatus);
    [JsonIgnore] public bool IsSending => string.Equals(SendStatus, "Sending", StringComparison.OrdinalIgnoreCase);
    [JsonIgnore] public bool IsSendFailed => string.Equals(SendStatus, "Failed", StringComparison.OrdinalIgnoreCase);
    [JsonIgnore] public string SendStatusLabel => SendStatus switch
    {
        "Sending" => "Sending",
        "Confirming" => "Confirming",
        "Failed" => "Failed",
        _ => ""
    };
    [JsonIgnore] public string SendStatusIcon => SendStatus switch
    {
        "Sending" => "\uE425",
        "Confirming" => "\uE8B5",
        "Failed" => "\uE000",
        _ => ""
    };
    [JsonIgnore] public string OutgoingStatusLabel => SendStatus switch
    {
        "Sending" => "Sending",
        "Confirming" => "Confirming on phone",
        "Failed" => "Failed",
        _ => "Sent"
    };
    [JsonIgnore] public string OutgoingStatusIcon => SendStatus switch
    {
        "Sending" => "\uE425",
        "Confirming" => "\uE8B5",
        "Failed" => "\uE000",
        _ => "\uE5CA"
    };

    private bool _isPinned;
    public bool IsPinned
    {
        get => _isPinned;
        set
        {
            if (_isPinned == value) return;
            _isPinned = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(PinActionLabel));
        }
    }

    [JsonIgnore]
    public string PinActionLabel => IsPinned ? "Unpin" : "Pin";

    private List<MessageAttachment> _attachments = new();
    public List<MessageAttachment> Attachments
    {
        get => _attachments;
        set
        {
            _attachments = value ?? new List<MessageAttachment>();
            _bubbleImage = null;
            _bubbleImageLoaded = false;
            OnPropertyChanged();
            OnPropertyChanged(nameof(ImageAttachments));
            OnPropertyChanged(nameof(HasImageAttachment));
            OnPropertyChanged(nameof(NonImageAttachments));
            OnPropertyChanged(nameof(HasNonImageAttachments));
            OnPropertyChanged(nameof(IsImageOnlyMms));
            OnPropertyChanged(nameof(BubbleImage));
            OnPropertyChanged(nameof(PreviewBody));
        }
    }

    // Legacy single-image slot. New MMS parsing stores every part in Attachments,
    // while this remains readable so older saved messages still render.
    private byte[]? _attachmentData;
    public byte[]? AttachmentData
    {
        get => _attachmentData;
        set
        {
            if (_attachmentData == value) return;
            _attachmentData = value;
            _bubbleImage = null;          // invalidate cached bitmap
            _bubbleImageLoaded = false;
            OnPropertyChanged();
            OnPropertyChanged(nameof(HasImageAttachment));
            OnPropertyChanged(nameof(ImageAttachments));
            OnPropertyChanged(nameof(IsImageOnlyMms));
            OnPropertyChanged(nameof(BubbleImage));
            OnPropertyChanged(nameof(PreviewBody));
        }
    }

    public void AddAttachment(MessageAttachment attachment)
    {
        if (attachment.Data.Length == 0) return;
        _attachments.Add(attachment);
        if (attachment.IsImage && (_attachmentData == null || _attachmentData.Length == 0))
            _attachmentData = attachment.Data;
        _bubbleImage = null;
        _bubbleImageLoaded = false;
        OnPropertyChanged(nameof(Attachments));
        OnPropertyChanged(nameof(ImageAttachments));
        OnPropertyChanged(nameof(HasImageAttachment));
        OnPropertyChanged(nameof(NonImageAttachments));
        OnPropertyChanged(nameof(HasNonImageAttachments));
        OnPropertyChanged(nameof(IsImageOnlyMms));
        OnPropertyChanged(nameof(BubbleImage));
        OnPropertyChanged(nameof(PreviewBody));
    }

    // ── Grouping UI Hints ────────────────────────────────────────────────
    [JsonIgnore] public bool IsFirstInGroup { get; set; }
    [JsonIgnore] public bool IsLastInGroup { get; set; }
    [JsonIgnore] public bool ShowDateDivider { get; set; }
    [JsonIgnore] public string DateDividerText { get; set; } = "";

    private bool _isActionTrayOpen;
    [JsonIgnore]
    public bool IsActionTrayOpen
    {
        get => _isActionTrayOpen;
        set
        {
            if (_isActionTrayOpen == value) return;
            _isActionTrayOpen = value;
            OnPropertyChanged();
        }
    }

    [JsonIgnore]
    public CornerRadius BubbleRadius => new CornerRadius(
        IsSent ? 20 : (IsFirstInGroup ? 20 : 4),
        IsSent ? (IsFirstInGroup ? 20 : 4) : 20,
        IsSent ? (IsLastInGroup ? 20 : 4) : 20,
        IsSent ? 20 : (IsLastInGroup ? 20 : 4)
    );

    [JsonIgnore]
    public Thickness BubbleMargin => new Thickness(
        IsSent ? 44 : 0,
        IsFirstInGroup ? 8 : 2,
        IsSent ? 0 : 44,
        IsLastInGroup ? 8 : 2
    );


    /// <summary>
    /// Canonical 10-digit phone number used to group messages into conversation threads.
    /// Strips country code, tel: prefix, formatting — leaves only digits (max 10).
    /// Sent messages ("Me > 5551234567") return the recipient's number.
    /// </summary>
    public string NormalizedPhone
    {
        get => ContactStoreService.NormalizePhone(From);
    }

    /// <summary>Short time string for inside a chat bubble (e.g. "3:42 PM").</summary>
    public string BubbleTimeDisplay => Timestamp.ToString("h:mm tt");

    public string PreviewBody =>
        string.IsNullOrEmpty(Body) && HasImageAttachment ? "📷 Photo" :
        Body.Length > 80 ? Body[..80] + "…" : Body;

    /// <summary>First letter of the sender's name/number for the avatar circle.</summary>
    public string AvatarInitial
    {
        get
        {
            // Use DisplayFrom so "tel:+15551234567" doesn't produce "T"
            var display = DisplayFrom;
            if (string.IsNullOrEmpty(display) || display == "Unknown") return "?";
            // Prefer the first letter (for contact names like "John")
            foreach (var c in display)
                if (char.IsLetter(c)) return c.ToString().ToUpper();
            // Fall back to first digit (for plain phone numbers)
            foreach (var c in display)
                if (char.IsDigit(c)) return c.ToString();
            return "?";
        }
    }

    /// <summary>Cleaned-up sender for display — removes "tel:" prefix, trims.</summary>
    public string DisplayFrom
    {
        get
        {
            if (string.IsNullOrEmpty(From)) return "Unknown";
            var s = From.Trim();
            if (s.StartsWith("tel:", StringComparison.OrdinalIgnoreCase))
                s = s[4..].Trim();
            return s;
        }
    }

    public string TimestampDisplay
    {
        get
        {
            var diff = DateTime.Now - Timestamp;
            if (diff.TotalMinutes < 1)  return "just now";
            if (diff.TotalHours   < 1)  return $"{(int)diff.TotalMinutes}m ago";
            if (diff.TotalDays    < 1)  return Timestamp.ToString("h:mm tt");
            if (diff.TotalDays    < 7)  return Timestamp.ToString("ddd h:mm tt");
            return Timestamp.ToString("MMM d");
        }
    }

    /// <summary>True when this MMS has an actual image attachment to display.</summary>
    [JsonIgnore]
    public bool HasImageAttachment => ImageAttachments.Any();

    [JsonIgnore]
    public bool HasNonImageAttachments => NonImageAttachments.Any();

    [JsonIgnore]
    public bool IsImageOnlyMms =>
        HasImageAttachment &&
        !HasNonImageAttachments &&
        string.IsNullOrWhiteSpace(Body);

    [JsonIgnore]
    public IEnumerable<MessageAttachment> ImageAttachments =>
        _attachments.Any(a => a.IsImage)
            ? _attachments.Where(a => a.IsImage)
            : _attachmentData is { Length: > 0 }
                ? new[] { MessageAttachment.FromLegacyImage(_attachmentData, Handle, Timestamp) }
                : Enumerable.Empty<MessageAttachment>();

    [JsonIgnore]
    public IEnumerable<MessageAttachment> NonImageAttachments =>
        _attachments.Where(a => !a.IsImage);

    [JsonIgnore]
    public string ImageAttachmentSummary
    {
        get
        {
            var count = ImageAttachments.Count();
            return count == 1 ? "Photo" : $"{count} photos";
        }
    }

    // ── BubbleImage — cached, created on first access ─────────────────────
    // Cached so we don't decode 600 KB JPEG on every WPF binding evaluation.
    // Cache is invalidated when AttachmentData is set.
    private System.Windows.Media.Imaging.BitmapImage? _bubbleImage;
    private bool _bubbleImageLoaded;

    /// <summary>
    /// Optional hook so callers (ViewModel) can log image-decode errors.
    /// Receives the handle and the exception message.
    /// </summary>
    public static event Action<string, string>? ImageDecodeError;

    [System.Text.Json.Serialization.JsonIgnore]
    public System.Windows.Media.Imaging.BitmapImage? BubbleImage
    {
        get
        {
            if (_bubbleImageLoaded) return _bubbleImage;
            _bubbleImageLoaded = true;

            var imageData = ImageAttachments.FirstOrDefault()?.Data;
            if (imageData == null || imageData.Length == 0)
                return null;

            try
            {
                var image = new System.Windows.Media.Imaging.BitmapImage();
                using (var ms = new System.IO.MemoryStream(imageData))
                {
                    image.BeginInit();
                    image.CacheOption = System.Windows.Media.Imaging.BitmapCacheOption.OnLoad;
                    image.StreamSource = ms;
                    image.EndInit();
                }
                image.Freeze();
                _bubbleImage = image;
            }
            catch (Exception ex)
            {
                _bubbleImage = null;
                ImageDecodeError?.Invoke(Handle, ex.Message);
            }
            return _bubbleImage;
        }
    }

    // ── INotifyPropertyChanged ─────────────────────────────────────────────
    public event PropertyChangedEventHandler? PropertyChanged;
    private void OnPropertyChanged([CallerMemberName] string? name = null)
        => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

public class MessageAttachment
{
    public string ContentType { get; set; } = "application/octet-stream";
    public string FileName { get; set; } = "";
    public byte[] Data { get; set; } = Array.Empty<byte>();

    [JsonIgnore]
    public bool IsImage => ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) || LooksLikeImage(Data);

    [JsonIgnore]
    public string DisplayName => string.IsNullOrWhiteSpace(FileName) ? BuildDefaultFileName() : FileName;

    [JsonIgnore]
    public bool IsContactCard =>
        ContentType.Contains("vcard", StringComparison.OrdinalIgnoreCase) ||
        ContentType.Contains("contact", StringComparison.OrdinalIgnoreCase) ||
        DisplayName.EndsWith(".vcf", StringComparison.OrdinalIgnoreCase);

    [JsonIgnore]
    public string TypeLabel => IsContactCard
        ? "Contact card"
        : ContentType.StartsWith("audio/", StringComparison.OrdinalIgnoreCase)
            ? "Audio"
            : ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase)
                ? "Video"
                : ContentType.StartsWith("text/", StringComparison.OrdinalIgnoreCase)
                    ? "Text file"
                    : "Attachment";

    [JsonIgnore]
    public string IconGlyph => IsContactCard
        ? "\uE0D0"
        : ContentType.StartsWith("audio/", StringComparison.OrdinalIgnoreCase)
            ? "\uE405"
            : ContentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase)
                ? "\uE04B"
                : ContentType.StartsWith("application/pdf", StringComparison.OrdinalIgnoreCase)
                    ? "\uE873"
                    : "\uE226";

    [JsonIgnore]
    public string SizeLabel
    {
        get
        {
            if (Data.Length >= 1024 * 1024)
                return $"{Data.Length / (1024d * 1024d):0.#} MB";
            if (Data.Length >= 1024)
                return $"{Data.Length / 1024d:0.#} KB";
            return $"{Data.Length} B";
        }
    }

    private System.Windows.Media.Imaging.BitmapImage? _image;
    private bool _imageLoaded;

    [JsonIgnore]
    public System.Windows.Media.Imaging.BitmapImage? Image
    {
        get
        {
            if (_imageLoaded) return _image;
            _imageLoaded = true;
            if (!IsImage || Data.Length == 0) return null;

            try
            {
                var image = new System.Windows.Media.Imaging.BitmapImage();
                using (var ms = new System.IO.MemoryStream(Data))
                {
                    image.BeginInit();
                    image.CacheOption = System.Windows.Media.Imaging.BitmapCacheOption.OnLoad;
                    image.StreamSource = ms;
                    image.EndInit();
                }
                image.Freeze();
                _image = image;
            }
            catch
            {
                _image = null;
            }

            return _image;
        }
    }

    public static MessageAttachment FromLegacyImage(byte[] data, string handle, DateTime timestamp) => new()
    {
        ContentType = GuessImageContentType(data),
        FileName = $"MMS_{timestamp:yyyyMMdd_HHmmss}_{SafeHandleSuffix(handle)}.{GuessImageExtension(data)}",
        Data = data
    };

    private string BuildDefaultFileName()
        => IsImage ? $"MMS_photo.{GuessImageExtension(Data)}" : IsContactCard ? "contact.vcf" : "MMS_attachment.bin";

    private static string SafeHandleSuffix(string value)
    {
        var clean = new string((value ?? "").Where(char.IsLetterOrDigit).TakeLast(8).ToArray());
        return string.IsNullOrWhiteSpace(clean) ? "image" : clean;
    }

    private static bool LooksLikeImage(byte[] data)
        => data.Length >= 4 &&
           ((data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF) ||
            (data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47) ||
            (data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x38) ||
            (data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46));

    private static string GuessImageContentType(byte[] data)
        => GuessImageExtension(data) switch
        {
            "png" => "image/png",
            "gif" => "image/gif",
            "webp" => "image/webp",
            _ => "image/jpeg"
        };

    private static string GuessImageExtension(byte[] data)
    {
        if (data.Length >= 4 && data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47) return "png";
        if (data.Length >= 4 && data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x38) return "gif";
        if (data.Length >= 4 && data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46) return "webp";
        return "jpg";
    }
}
