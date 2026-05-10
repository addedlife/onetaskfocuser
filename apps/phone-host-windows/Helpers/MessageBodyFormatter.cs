using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Documents;
using System.Windows.Input;

namespace DeskPhone.Helpers;

public static class MessageBodyFormatter
{
    private static readonly Regex TokenRegex = new(
        @"(?<url>(?:https?://|www\.)[^\s]+)|(?<phone>(?<!\w)(?:\+?1[\s\-.]?)?(?:\(?\d{3}\)?[\s\-.]?)\d{3}[\s\-.]?\d{4}(?!\w))",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public static event Action<string>? UrlClicked;
    public static event Action<string>? PhoneClicked;

    public static readonly DependencyProperty FormattedTextProperty =
        DependencyProperty.RegisterAttached(
            "FormattedText",
            typeof(string),
            typeof(MessageBodyFormatter),
            new PropertyMetadata("", OnFormattedTextChanged));

    public static readonly DependencyProperty IsOutgoingProperty =
        DependencyProperty.RegisterAttached(
            "IsOutgoing",
            typeof(bool),
            typeof(MessageBodyFormatter),
            new PropertyMetadata(false, OnFormattedTextChanged));

    public static string GetFormattedText(DependencyObject obj) => (string)obj.GetValue(FormattedTextProperty);
    public static void SetFormattedText(DependencyObject obj, string value) => obj.SetValue(FormattedTextProperty, value);

    public static bool GetIsOutgoing(DependencyObject obj) => (bool)obj.GetValue(IsOutgoingProperty);
    public static void SetIsOutgoing(DependencyObject obj, bool value) => obj.SetValue(IsOutgoingProperty, value);

    private static void OnFormattedTextChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is not System.Windows.Controls.RichTextBox rtb) return;

        var text = GetFormattedText(rtb) ?? "";
        var isOutgoing = GetIsOutgoing(rtb);
        rtb.Document = BuildDocument(text, isOutgoing);
        rtb.IsReadOnly = true;
        rtb.Focusable = false;
        rtb.IsReadOnlyCaretVisible = false;
        rtb.IsDocumentEnabled = true;
        rtb.BorderThickness = new Thickness(0);
        rtb.Background = System.Windows.Media.Brushes.Transparent;
        Stylus.SetIsFlicksEnabled(rtb, false);
        Stylus.SetIsPressAndHoldEnabled(rtb, false);
        Stylus.SetIsTapFeedbackEnabled(rtb, false);
        Stylus.SetIsTouchFeedbackEnabled(rtb, false);
    }

    private static FlowDocument BuildDocument(string text, bool isOutgoing)
    {
        var doc = new FlowDocument
        {
            PagePadding = new Thickness(0),
            TextAlignment = TextAlignment.Left
        };

        if (string.IsNullOrEmpty(text))
        {
            var paragraph = CreateParagraph();
            paragraph.Inlines.Add(new Run("\u00A0"));
            doc.Blocks.Add(paragraph);
            return doc;
        }

        var messageParagraph = CreateParagraph();
        var lines = text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        for (var i = 0; i < lines.Length; i++)
        {
            if (i > 0)
                messageParagraph.Inlines.Add(new LineBreak());

            AddLineInlines(messageParagraph, lines[i], isOutgoing);
        }
        doc.Blocks.Add(messageParagraph);

        return doc;
    }

    private static Paragraph CreateParagraph() => new()
    {
        Margin = new Thickness(0),
        LineStackingStrategy = LineStackingStrategy.BlockLineHeight,
        LineHeight = 20
    };

    private static void AddLineInlines(Paragraph paragraph, string text, bool isOutgoing = false)
    {
        if (text.Length == 0)
        {
            paragraph.Inlines.Add(new Run("\u00A0"));
            return;
        }

        int last = 0;
        foreach (Match match in TokenRegex.Matches(text))
        {
            if (match.Index > last)
                paragraph.Inlines.Add(new Run(text[last..match.Index]));

            if (match.Groups["url"].Success)
                paragraph.Inlines.Add(BuildUrlLink(match.Value, isOutgoing));
            else if (match.Groups["phone"].Success)
                paragraph.Inlines.Add(BuildPhoneLink(match.Value, isOutgoing));

            last = match.Index + match.Length;
        }

        if (last < text.Length)
            paragraph.Inlines.Add(new Run(text[last..]));
    }

    private static Hyperlink BuildUrlLink(string rawUrl, bool isOutgoing)
    {
        var target = rawUrl.StartsWith("http", StringComparison.OrdinalIgnoreCase)
            ? rawUrl
            : $"https://{rawUrl}";

        var link = new Hyperlink(new Run(rawUrl))
        {
            ToolTip = target,
            NavigateUri = Uri.TryCreate(target, UriKind.Absolute, out var uri) ? uri : null,
            Foreground = isOutgoing ? System.Windows.Media.Brushes.White : System.Windows.Media.Brushes.DodgerBlue
        };
        link.Click += (_, _) => UrlClicked?.Invoke(target);
        return link;
    }

    private static Hyperlink BuildPhoneLink(string rawPhone, bool isOutgoing)
    {
        var clean = Services.ContactStoreService.NormalizePhone(rawPhone);
        var shown = string.IsNullOrWhiteSpace(clean) ? rawPhone : Models.Conversation.FormatPhone(clean);

        var link = new Hyperlink(new Run(shown))
        {
            ToolTip = shown,
            Foreground = isOutgoing ? System.Windows.Media.Brushes.White : System.Windows.Media.Brushes.ForestGreen
        };
        link.Click += (_, _) => PhoneClicked?.Invoke(clean);
        return link;
    }
}
