namespace DeskPhone.Models;

public class ContactOption
{
    public ContactEntry Contact { get; set; } = new();
    public string PhoneNumber { get; set; } = "";

    public string DisplayName => Contact.DisplayName;
    public string FormattedPhone => Conversation.FormatPhone(PhoneNumber);
    public string SearchText => $"{DisplayName} {PhoneNumber} {FormattedPhone}";
}
