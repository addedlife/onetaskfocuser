using System.Globalization;
using System.Windows;
using System.Windows.Data;

namespace DeskPhone;

/// <summary>
/// A collection of tiny helper classes that convert ViewModel values
/// into things WPF's UI layer can display (visibility, booleans, etc.)
/// These are "value converters" — they sit between the data and the UI.
/// </summary>

// Null → Collapsed, anything else → Visible
[ValueConversion(typeof(object), typeof(Visibility))]
public class NullToCollapsedConverter : IValueConverter
{
    public static readonly NullToCollapsedConverter Default = new();
    public object Convert(object v, Type t, object p, CultureInfo c)
        => v is null ? Visibility.Collapsed : Visibility.Visible;
    public object ConvertBack(object v, Type t, object p, CultureInfo c)
        => throw new NotImplementedException();
}

// 0 → Collapsed, >0 → Visible (used for "show dropdown only when devices found")
[ValueConversion(typeof(int), typeof(Visibility))]
public class CountToVisibilityConverter : IValueConverter
{
    public static readonly CountToVisibilityConverter Default = new();
    public object Convert(object v, Type t, object p, CultureInfo c)
        => v is int n && n > 0 ? Visibility.Visible : Visibility.Collapsed;
    public object ConvertBack(object v, Type t, object p, CultureInfo c)
        => throw new NotImplementedException();
}

// true → Visible, false → Collapsed
[ValueConversion(typeof(bool), typeof(Visibility))]
public class BoolToVisibilityConverter : IValueConverter
{
    public static readonly BoolToVisibilityConverter Default = new();
    public object Convert(object v, Type t, object p, CultureInfo c)
        => v is true ? Visibility.Visible : Visibility.Collapsed;
    public object ConvertBack(object v, Type t, object p, CultureInfo c)
        => throw new NotImplementedException();
}

// flips a bool (true→false, false→true)
[ValueConversion(typeof(bool), typeof(bool))]
public class InverseBoolConverter : IValueConverter
{
    public static readonly InverseBoolConverter Default = new();
    public object Convert(object v, Type t, object p, CultureInfo c)
        => v is bool b && !b;
    public object ConvertBack(object v, Type t, object p, CultureInfo c)
        => v is bool b && !b;
}

// Null or empty string → Collapsed, non-empty string → Visible
// Used to show/hide text bubbles based on whether the Body property has content.
[ValueConversion(typeof(string), typeof(Visibility))]
public class NullOrEmptyToCollapsedConverter : IValueConverter
{
    public static readonly NullOrEmptyToCollapsedConverter Default = new();
    public object Convert(object v, Type t, object p, CultureInfo c)
        => v is string s && !string.IsNullOrEmpty(s) ? Visibility.Visible : Visibility.Collapsed;
    public object ConvertBack(object v, Type t, object p, CultureInfo c)
        => throw new NotImplementedException();
}

// Sizes a message bubble as a share of the visible thread width instead of a fixed pixel cap.
[ValueConversion(typeof(double), typeof(double))]
public class BubbleWidthConverter : IValueConverter
{
    public static readonly BubbleWidthConverter Default = new();

    public object Convert(object v, Type t, object p, CultureInfo c)
    {
        if (v is not double width || double.IsNaN(width) || double.IsInfinity(width) || width <= 0)
            return 320d;

        var horizontalChrome = width < 420d ? 56d : 72d;
        var usableWidth = Math.Max(width - horizontalChrome, 150d);
        var widthShare = width < 360d ? 0.94d
            : width < 460d ? 0.9d
            : 0.82d;
        var targetWidth = usableWidth * widthShare;
        var floor = Math.Min(190d, usableWidth);
        var ceiling = Math.Min(620d, usableWidth);
        return Math.Clamp(targetWidth, floor, ceiling);
    }

    public object ConvertBack(object v, Type t, object p, CultureInfo c)
        => throw new NotImplementedException();
}

[ValueConversion(typeof(double), typeof(double))]
public class BubbleTextSizeConverter : IValueConverter
{
    public static readonly BubbleTextSizeConverter Default = new();

    public object Convert(object v, Type t, object p, CultureInfo c)
    {
        // Keep message body text comfortably readable without scaling the whole shell.
        if (v is not double width || double.IsNaN(width) || double.IsInfinity(width) || width <= 0)
            return 19d;

        if (width <= 340d)
            return 17d;
        if (width <= 520d)
            return 18d;

        return 19d;
    }

    public object ConvertBack(object v, Type t, object p, CultureInfo c)
        => throw new NotImplementedException();
}
