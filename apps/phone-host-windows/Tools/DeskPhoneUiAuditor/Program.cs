using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;
using AutomationCondition = System.Windows.Automation.Condition;
using WpfApplication = System.Windows.Application;
using WpfButton = System.Windows.Controls.Button;
using WpfCheckBox = System.Windows.Controls.CheckBox;
using WpfColor = System.Windows.Media.Color;
using WpfFontFamily = System.Windows.Media.FontFamily;
using WpfOrientation = System.Windows.Controls.Orientation;

namespace DeskPhoneUiAuditor;

internal static partial class Program
{
    private const int MaxElements = 6000;
    private static readonly TimeSpan StartTimeout = TimeSpan.FromSeconds(12);

    [STAThread]
    public static int Main(string[] args)
    {
        var options = AuditOptions.Parse(args);
        return options.ShowGui ? RunGui() : RunAudit(options).ExitCode;
    }

    private static int RunGui()
    {
        var app = new WpfApplication();
        var window = new Window
        {
            Title = "DeskPhone UI Auditor",
            Width = 640,
            Height = 430,
            MinWidth = 540,
            MinHeight = 380,
            WindowStartupLocation = WindowStartupLocation.CenterScreen,
            Background = new SolidColorBrush(WpfColor.FromRgb(248, 250, 252)),
            FontFamily = new WpfFontFamily("Segoe UI Variable Text, Segoe UI")
        };

        var runButton = new WpfButton
        {
            Content = "Run Audit",
            Height = 38,
            MinWidth = 118,
            Padding = new Thickness(18, 0, 18, 0)
        };
        var openReportButton = new WpfButton
        {
            Content = "Open Report",
            Height = 34,
            MinWidth = 108,
            IsEnabled = false
        };
        var openFolderButton = new WpfButton
        {
            Content = "Open Folder",
            Height = 34,
            MinWidth = 108,
            IsEnabled = false
        };
        var startLatestBox = new WpfCheckBox
        {
            Content = "Start latest DeskPhone if it is not already open",
            IsChecked = true,
            Margin = new Thickness(0, 0, 0, 8)
        };
        var strictBox = new WpfCheckBox
        {
            Content = "Strict mode for release checks",
            Margin = new Thickness(0, 0, 0, 16)
        };
        var statusText = new TextBlock
        {
            Text = "Ready.",
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 16, 0, 0),
            Foreground = new SolidColorBrush(WpfColor.FromRgb(51, 65, 85))
        };
        var pathText = new TextBlock
        {
            TextWrapping = TextWrapping.Wrap,
            FontFamily = new WpfFontFamily("Cascadia Code, Consolas"),
            FontSize = 12,
            Foreground = new SolidColorBrush(WpfColor.FromRgb(71, 85, 105)),
            Margin = new Thickness(0, 8, 0, 0)
        };

        string? latestSummary = null;
        string? latestFolder = null;

        runButton.Click += async (_, _) =>
        {
            runButton.IsEnabled = false;
            openReportButton.IsEnabled = false;
            openFolderButton.IsEnabled = false;
            statusText.Text = "Running UI audit...";
            pathText.Text = "";

            var auditOptions = new AuditOptions(
                "DeskPhone",
                null,
                null,
                startLatestBox.IsChecked == true,
                strictBox.IsChecked == true,
                false);

            var result = await Task.Run(() => RunAudit(auditOptions));
            latestSummary = result.SummaryPath;
            latestFolder = result.OutputDirectory;

            statusText.Text = result.ExitCode == 0
                ? $"Audit complete. Findings: {result.FindingCount}."
                : $"Audit finished with attention needed. Findings: {result.FindingCount}.";
            pathText.Text = latestSummary ?? "";
            openReportButton.IsEnabled = !string.IsNullOrWhiteSpace(latestSummary) && File.Exists(latestSummary);
            openFolderButton.IsEnabled = !string.IsNullOrWhiteSpace(latestFolder) && Directory.Exists(latestFolder);
            runButton.IsEnabled = true;
        };

        openReportButton.Click += (_, _) => OpenPath(latestSummary);
        openFolderButton.Click += (_, _) => OpenPath(latestFolder);

        var actionRow = new StackPanel
        {
            Orientation = WpfOrientation.Horizontal,
            Margin = new Thickness(0, 18, 0, 0)
        };
        actionRow.Children.Add(runButton);
        actionRow.Children.Add(Spacer(12));
        actionRow.Children.Add(openReportButton);
        actionRow.Children.Add(Spacer(8));
        actionRow.Children.Add(openFolderButton);

        var root = new StackPanel
        {
            Margin = new Thickness(28)
        };
        root.Children.Add(new TextBlock
        {
            Text = "DeskPhone UI Auditor",
            FontSize = 26,
            FontWeight = FontWeights.SemiBold,
            Foreground = new SolidColorBrush(WpfColor.FromRgb(15, 23, 42)),
            Margin = new Thickness(0, 0, 0, 8)
        });
        root.Children.Add(new TextBlock
        {
            Text = "Runs a repeatable UI check for clipped text, overlapping controls, small click targets, missing accessible names, and WPF blur risks.",
            TextWrapping = TextWrapping.Wrap,
            LineHeight = 22,
            Foreground = new SolidColorBrush(WpfColor.FromRgb(71, 85, 105)),
            Margin = new Thickness(0, 0, 0, 22)
        });
        root.Children.Add(startLatestBox);
        root.Children.Add(strictBox);
        root.Children.Add(actionRow);
        root.Children.Add(statusText);
        root.Children.Add(pathText);

        window.Content = root;
        return app.Run(window);
    }

    private static Border Spacer(double width)
        => new() { Width = width };

    private static void OpenPath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return;
        }

        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = path,
                UseShellExecute = true
            });
        }
        catch
        {
        }
    }

    private static AuditRunResult RunAudit(AuditOptions options)
    {
        var repoRoot = FindRepoRoot();
        var outputRoot = Path.GetFullPath(options.OutputRoot ?? Path.Combine(repoRoot, "artifacts", "ui-audits"));
        var outputDir = Path.Combine(outputRoot, DateTime.Now.ToString("yyyyMMdd-HHmmss"));
        var summaryPath = Path.Combine(outputDir, "summary.md");
        Directory.CreateDirectory(outputDir);

        var findings = new List<Finding>();

        try
        {
            var process = WaitForDeskPhoneProcess(options.ProcessName, options.TitleContains, options.StartLatest ? TimeSpan.FromSeconds(2) : TimeSpan.FromSeconds(6))
                ?? (options.StartLatest ? StartLatestBuild(repoRoot) : null);

            if (process is null)
            {
                findings.Add(new Finding("High", "WindowNotFound", "DeskPhone window was not found. Start DeskPhone or rerun with --start-latest.", null, null));
                WriteReports(outputDir, repoRoot, null, null, null, null, [], findings, AuditStaticXaml(repoRoot));
                Console.WriteLine($"DeskPhone UI audit complete with {findings.Count} finding(s): {Path.Combine(outputDir, "summary.md")}");
                return new AuditRunResult(options.Strict ? 2 : 0, findings.Count, summaryPath, outputDir);
            }

            if (!WaitForMainWindow(process, StartTimeout))
            {
                findings.Add(new Finding("High", "WindowNotReady", $"Process {process.ProcessName} started but did not expose a main window.", null, process.Id));
                WriteReports(outputDir, repoRoot, process, null, null, null, [], findings, AuditStaticXaml(repoRoot));
                Console.WriteLine($"DeskPhone UI audit complete with {findings.Count} finding(s): {Path.Combine(outputDir, "summary.md")}");
                return new AuditRunResult(options.Strict ? 2 : 0, findings.Count, summaryPath, outputDir);
            }

            RestoreWindow(process.MainWindowHandle);

            var window = AutomationElement.FromHandle(process.MainWindowHandle);
            var dpi = ReadDpi(process.MainWindowHandle);
            var windowBounds = RectDto.From(window.Current.BoundingRectangle);
            var screenshot = CaptureWindowScreenshot(windowBounds, outputDir, findings);
            var elements = CollectElements(window, findings);
            var staticAudit = AuditStaticXaml(repoRoot);

            AnalyzeElements(elements, findings);
            findings.AddRange(staticAudit.Findings);

            WriteReports(outputDir, repoRoot, process, window.Current.Name, dpi, screenshot, elements, findings, staticAudit);
            Console.WriteLine($"DeskPhone UI audit complete with {findings.Count} finding(s): {Path.Combine(outputDir, "summary.md")}");
            var exitCode = options.Strict && findings.Any(f => f.Severity is "High" or "Medium") ? 2 : 0;
            return new AuditRunResult(exitCode, findings.Count, summaryPath, outputDir);
        }
        catch (Exception ex)
        {
            findings.Add(new Finding("High", "AuditCrashed", ex.Message, null, null));
            WriteReports(outputDir, repoRoot, null, null, null, null, [], findings, AuditStaticXaml(repoRoot));
            Console.WriteLine($"DeskPhone UI audit failed safely: {Path.Combine(outputDir, "summary.md")}");
            return new AuditRunResult(1, findings.Count, summaryPath, outputDir);
        }
    }

    private static Process? FindDeskPhoneProcess(string processName, string? titleContains)
    {
        var candidates = Process.GetProcesses()
            .Where(p => HasVisibleWindow(p) && IsDeskPhoneProcess(p, processName))
            .OrderByDescending(p => p.StartTimeSafe())
            .ToList();

        if (!string.IsNullOrWhiteSpace(titleContains))
        {
            candidates = candidates
                .Where(p => p.MainWindowTitle.Contains(titleContains, StringComparison.OrdinalIgnoreCase))
                .ToList();
        }

        return candidates.FirstOrDefault();
    }

    private static Process? WaitForDeskPhoneProcess(string processName, string? titleContains, TimeSpan timeout)
    {
        var stopwatch = Stopwatch.StartNew();
        while (stopwatch.Elapsed < timeout)
        {
            var process = FindDeskPhoneProcess(processName, titleContains);
            if (process is not null)
            {
                return process;
            }

            Thread.Sleep(250);
        }

        return FindDeskPhoneProcess(processName, titleContains);
    }

    private static bool IsDeskPhoneProcess(Process process, string requestedName)
    {
        return process.ProcessName.Equals(requestedName, StringComparison.OrdinalIgnoreCase)
            || process.ProcessName.StartsWith($"{requestedName}_b", StringComparison.OrdinalIgnoreCase);
    }

    private static bool HasVisibleWindow(Process process)
    {
        try
        {
            return process.MainWindowHandle != IntPtr.Zero;
        }
        catch
        {
            return false;
        }
    }

    private static Process? StartLatestBuild(string repoRoot)
    {
        var archiveRoot = Path.Combine(repoRoot, "deployed-builds");
        if (!Directory.Exists(archiveRoot))
        {
            return null;
        }

        var latestExe = Directory.EnumerateDirectories(archiveRoot, "b*")
            .Select(path => new { Path = path, Build = ParseBuildNumber(Path.GetFileName(path)) })
            .Where(item => item.Build >= 0)
            .OrderByDescending(item => item.Build)
            .Select(item => Path.Combine(item.Path, "DeskPhone.exe"))
            .FirstOrDefault(File.Exists);

        if (latestExe is null)
        {
            return null;
        }

        return Process.Start(new ProcessStartInfo
        {
            FileName = latestExe,
            WorkingDirectory = Path.GetDirectoryName(latestExe) ?? repoRoot,
            UseShellExecute = true
        });
    }

    private static bool WaitForMainWindow(Process process, TimeSpan timeout)
    {
        var stopwatch = Stopwatch.StartNew();
        while (stopwatch.Elapsed < timeout)
        {
            process.Refresh();
            if (process.MainWindowHandle != IntPtr.Zero)
            {
                return true;
            }

            Thread.Sleep(250);
        }

        return false;
    }

    private static List<ElementDto> CollectElements(AutomationElement window, List<Finding> findings)
    {
        var elements = new List<ElementDto>();
        var queue = new Queue<(AutomationElement Element, int Depth)>();
        queue.Enqueue((window, 0));

        while (queue.Count > 0 && elements.Count < MaxElements)
        {
            var (current, depth) = queue.Dequeue();
            ElementDto? snapshot = null;

            try
            {
                snapshot = ElementDto.From(current, depth);
                elements.Add(snapshot);
            }
            catch (ElementNotAvailableException)
            {
                continue;
            }
            catch (COMException)
            {
                continue;
            }

            try
            {
                var children = current.FindAll(TreeScope.Children, AutomationCondition.TrueCondition);
                for (var i = 0; i < children.Count; i++)
                {
                    queue.Enqueue((children[i], depth + 1));
                }
            }
            catch (ElementNotAvailableException)
            {
            }
            catch (COMException ex)
            {
                findings.Add(new Finding("Low", "TreeReadSkipped", $"Skipped part of the UI tree near {snapshot.ControlType}: {ex.Message}", snapshot.AutomationId, snapshot.ProcessId));
            }
        }

        if (elements.Count >= MaxElements)
        {
            findings.Add(new Finding("Medium", "TreeTooLarge", $"Stopped after {MaxElements} UI elements so the audit cannot hang the app.", null, null));
        }

        return elements;
    }

    private static void AnalyzeElements(IReadOnlyList<ElementDto> elements, List<Finding> findings)
    {
        foreach (var element in elements)
        {
            if (!element.HasValidBounds)
            {
                if (element.IsActionable)
                {
                    findings.Add(new Finding("Medium", "InvalidActionBounds", $"Actionable {element.ControlType} has no usable screen bounds.", element.AutomationId, element.ProcessId));
                }
                continue;
            }

            if (element.IsActionable && !element.IsOffscreen && (element.Bounds.Width < 32 || element.Bounds.Height < 32))
            {
                findings.Add(new Finding("Medium", "SmallClickTarget", $"{Describe(element)} is {element.Bounds.Width:0}x{element.Bounds.Height:0}; desktop action targets should stay at least 32x32.", element.AutomationId, element.ProcessId));
            }

            if (element.IsActionable && string.IsNullOrWhiteSpace(element.Name) && string.IsNullOrWhiteSpace(element.AutomationId))
            {
                findings.Add(new Finding("Medium", "UnnamedAction", $"{DescribeWithBounds(element)} has no UI Automation name or automation id, so screen readers and automated tests cannot identify it reliably.", null, element.ProcessId));
            }

            if (element.ControlType is "Text" or "Header" or "DataItem"
                && !string.IsNullOrWhiteSpace(element.Name)
                && !LooksIntentionallyTruncated(element.Name)
                && element.Name.Length > 24
                && element.Bounds.Width < Math.Min(520, element.Name.Length * 5.2))
            {
                findings.Add(new Finding("Low", "PossibleTextClipping", $"{Describe(element)} may be too narrow for its text.", element.AutomationId, element.ProcessId));
            }
        }

        var actionables = elements
            .Where(e => e is { HasValidBounds: true, IsActionable: true, IsOffscreen: false })
            .ToList();

        for (var i = 0; i < actionables.Count; i++)
        {
            for (var j = i + 1; j < actionables.Count; j++)
            {
                var first = actionables[i];
                var second = actionables[j];

                if (first.ProcessId != second.ProcessId || IsContainerOverlap(first.Bounds, second.Bounds))
                {
                    continue;
                }

                var intersection = RectDto.Intersection(first.Bounds, second.Bounds);
                if (intersection.Area < 96)
                {
                    continue;
                }

                var firstRatio = intersection.Area / first.Bounds.Area;
                var secondRatio = intersection.Area / second.Bounds.Area;
                if (firstRatio > 0.38 || secondRatio > 0.38)
                {
                    findings.Add(new Finding("Medium", "OverlappingActions", $"{Describe(first)} overlaps {Describe(second)} by {intersection.Width:0}x{intersection.Height:0}.", first.AutomationId, first.ProcessId));
                }
            }
        }
    }

    private static StaticAudit AuditStaticXaml(string repoRoot)
    {
        var findings = new List<Finding>();
        var files = new[]
        {
            Path.Combine(repoRoot, "MainWindow.xaml"),
            Path.Combine(repoRoot, "App.xaml"),
            Path.Combine(repoRoot, "Themes", "Styles.xaml")
        }.Where(File.Exists).ToList();

        var mainWindow = files.FirstOrDefault(path => Path.GetFileName(path).Equals("MainWindow.xaml", StringComparison.OrdinalIgnoreCase));
        if (mainWindow is not null)
        {
            var text = File.ReadAllText(mainWindow);
            if (!text.Contains("UseLayoutRounding=\"True\"", StringComparison.Ordinal))
            {
                findings.Add(new Finding("Medium", "MissingLayoutRounding", "MainWindow.xaml does not opt into pixel-rounded layout.", "MainWindow.xaml", null));
            }

            if (!text.Contains("SnapsToDevicePixels=\"True\"", StringComparison.Ordinal))
            {
                findings.Add(new Finding("Medium", "MissingPixelSnapping", "MainWindow.xaml does not opt into device-pixel snapping.", "MainWindow.xaml", null));
            }

            if (!text.Contains("TextOptions.TextFormattingMode=\"Display\"", StringComparison.Ordinal))
            {
                findings.Add(new Finding("Medium", "MissingDisplayTextFormatting", "MainWindow.xaml does not force display text formatting, which can make WPF text look soft at some DPI/layout positions.", "MainWindow.xaml", null));
            }
        }

        foreach (var file in files)
        {
            var text = File.ReadAllText(file);
            foreach (var value in TransformRiskRegex().Matches(text).Select(match => match.Value).Distinct(StringComparer.Ordinal))
            {
                findings.Add(new Finding("Low", "PossibleBlurSource", $"{Path.GetFileName(file)} contains {value}; transforms/effects can soften text and icons.", Path.GetFileName(file), null));
            }

            foreach (var value in FractionalLayoutRegex().Matches(text).Select(match => match.Value).Distinct(StringComparer.Ordinal))
            {
                findings.Add(new Finding("Low", "FractionalLayoutValue", $"{Path.GetFileName(file)} contains fractional layout value {value}; fractional pixels can render softer on some displays.", Path.GetFileName(file), null));
            }
        }

        return new StaticAudit(files.Select(Path.GetFileName).Where(name => name is not null).Cast<string>().ToList(), findings);
    }

    private static bool IsContainerOverlap(RectDto first, RectDto second)
    {
        return Contains(first, second, 0.92) || Contains(second, first, 0.92);
    }

    private static bool Contains(RectDto outer, RectDto inner, double tolerance)
    {
        var intersection = RectDto.Intersection(outer, inner);
        return inner.Area > 0 && intersection.Area / inner.Area >= tolerance;
    }

    private static string? CaptureWindowScreenshot(RectDto bounds, string outputDir, List<Finding> findings)
    {
        if (!bounds.HasArea)
        {
            findings.Add(new Finding("Medium", "ScreenshotSkipped", "Window bounds were invalid, so the screenshot was skipped.", null, null));
            return null;
        }

        try
        {
            var screenshotPath = Path.Combine(outputDir, "deskphone.png");
            using var bitmap = new Bitmap((int)Math.Ceiling(bounds.Width), (int)Math.Ceiling(bounds.Height));
            using var graphics = Graphics.FromImage(bitmap);
            graphics.CopyFromScreen((int)Math.Floor(bounds.X), (int)Math.Floor(bounds.Y), 0, 0, bitmap.Size, CopyPixelOperation.SourceCopy);
            bitmap.Save(screenshotPath, ImageFormat.Png);
            return screenshotPath;
        }
        catch (Exception ex)
        {
            findings.Add(new Finding("Low", "ScreenshotFailed", $"Could not capture screenshot: {ex.Message}", null, null));
            return null;
        }
    }

    private static DpiInfo? ReadDpi(IntPtr hwnd)
    {
        try
        {
            var dpi = GetDpiForWindow(hwnd);
            return dpi > 0 ? new DpiInfo(dpi, Math.Round(dpi / 96.0 * 100, 1)) : null;
        }
        catch
        {
            return null;
        }
    }

    private static void WriteReports(
        string outputDir,
        string repoRoot,
        Process? process,
        string? windowTitle,
        DpiInfo? dpi,
        string? screenshot,
        IReadOnlyList<ElementDto> elements,
        IReadOnlyList<Finding> findings,
        StaticAudit staticAudit)
    {
        var report = new AuditReport(
            DateTimeOffset.Now,
            Environment.MachineName,
            repoRoot,
            process?.ProcessName,
            process?.Id,
            windowTitle,
            dpi,
            screenshot,
            elements.Count,
            findings.OrderBy(SeverityRank).ThenBy(f => f.Code).ToList(),
            elements,
            staticAudit);

        var jsonOptions = new JsonSerializerOptions
        {
            WriteIndented = true,
            NumberHandling = JsonNumberHandling.AllowNamedFloatingPointLiterals
        };
        File.WriteAllText(Path.Combine(outputDir, "audit.json"), JsonSerializer.Serialize(report, jsonOptions));
        File.WriteAllText(Path.Combine(outputDir, "summary.md"), BuildMarkdown(report));
    }

    private static string BuildMarkdown(AuditReport report)
    {
        var builder = new StringBuilder();
        builder.AppendLine("# DeskPhone UI Audit");
        builder.AppendLine();
        builder.AppendLine($"Generated: {report.GeneratedAt:yyyy-MM-dd h:mm tt zzz}");
        builder.AppendLine($"Machine: {report.MachineName}");
        builder.AppendLine($"Process: {(report.ProcessName is null ? "not found" : $"{report.ProcessName} ({report.ProcessId})")}");
        builder.AppendLine($"Window: {Escape(report.WindowTitle ?? "not found")}");
        builder.AppendLine($"DPI: {(report.Dpi is null ? "unknown" : $"{report.Dpi.Value.Dpi} ({report.Dpi.Value.ScalePercent:0.#}%)")}");
        builder.AppendLine($"Elements scanned: {report.ElementCount}");
        if (!string.IsNullOrWhiteSpace(report.ScreenshotPath))
        {
            builder.AppendLine($"Screenshot: `{report.ScreenshotPath}`");
        }

        builder.AppendLine();
        builder.AppendLine("## Findings");
        if (report.Findings.Count == 0)
        {
            builder.AppendLine("No findings.");
        }
        else
        {
            foreach (var finding in report.Findings)
            {
                builder.AppendLine($"- **{finding.Severity}** `{finding.Code}`: {Escape(finding.Message)}");
            }
        }

        builder.AppendLine();
        builder.AppendLine("## What This Auditor Checks");
        builder.AppendLine("- UI Automation tree visibility, names, action targets, and rough overlap risks.");
        builder.AppendLine("- Screenshot capture for quick visual review.");
        builder.AppendLine("- WPF blur risks such as missing pixel rounding/text formatting, transforms, effects, and fractional layout values.");
        builder.AppendLine();
        builder.AppendLine("## Files Scanned");
        foreach (var file in report.StaticAudit.ScannedFiles)
        {
            builder.AppendLine($"- `{file}`");
        }

        return builder.ToString();
    }

    private static int SeverityRank(Finding finding) => finding.Severity switch
    {
        "High" => 0,
        "Medium" => 1,
        _ => 2
    };

    private static string Describe(ElementDto element)
    {
        var name = string.IsNullOrWhiteSpace(element.Name) ? element.AutomationId : element.Name;
        return string.IsNullOrWhiteSpace(name) ? element.ControlType : $"{element.ControlType} \"{name}\"";
    }

    private static string DescribeWithBounds(ElementDto element)
        => element.HasValidBounds
            ? $"{Describe(element)} at {element.Bounds.X:0},{element.Bounds.Y:0} size {element.Bounds.Width:0}x{element.Bounds.Height:0}"
            : Describe(element);

    private static bool LooksIntentionallyTruncated(string text)
        => text.Contains('…') || text.Contains("...", StringComparison.Ordinal) || text.Contains("â€¦", StringComparison.Ordinal);

    private static string Escape(string value) => value.Replace("|", "\\|", StringComparison.Ordinal);

    private static string FindRepoRoot()
    {
        var current = new DirectoryInfo(Environment.CurrentDirectory);
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "DeskPhone.csproj")))
            {
                return current.FullName;
            }

            current = current.Parent;
        }

        return Environment.CurrentDirectory;
    }

    private static int ParseBuildNumber(string name)
    {
        return name.Length > 1 && name[0] == 'b' && int.TryParse(name[1..], out var build) ? build : -1;
    }

    [LibraryImport("user32.dll")]
    private static partial uint GetDpiForWindow(IntPtr hwnd);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool SetForegroundWindow(IntPtr hWnd);

    private static void RestoreWindow(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero)
        {
            return;
        }

        ShowWindow(hwnd, 9);
        SetForegroundWindow(hwnd);
        Thread.Sleep(350);
    }

    [GeneratedRegex("\\b(?:LayoutTransform|RenderTransform|ScaleTransform|DropShadowEffect|Effect=)\\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex TransformRiskRegex();

    [GeneratedRegex("\\b(?:Width|Height|MinWidth|MinHeight|Margin|Padding|FontSize|CornerRadius)=\"[^\"]*\\d+\\.\\d+", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex FractionalLayoutRegex();
}

internal sealed record AuditRunResult(int ExitCode, int FindingCount, string SummaryPath, string OutputDirectory);

internal sealed record AuditOptions(string ProcessName, string? TitleContains, string? OutputRoot, bool StartLatest, bool Strict, bool ShowGui)
{
    public static AuditOptions Parse(string[] args)
    {
        var processName = "DeskPhone";
        string? title = null;
        string? output = null;
        var startLatest = false;
        var strict = false;
        var showGui = args.Length == 0;

        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--gui":
                    showGui = true;
                    break;
                case "--process" when i + 1 < args.Length:
                    processName = args[++i];
                    break;
                case "--title" when i + 1 < args.Length:
                    title = args[++i];
                    break;
                case "--output" when i + 1 < args.Length:
                    output = args[++i];
                    break;
                case "--start-latest":
                    startLatest = true;
                    break;
                case "--strict":
                    strict = true;
                    break;
            }
        }

        return new AuditOptions(processName, title, output, startLatest, strict, showGui);
    }
}

internal sealed record AuditReport(
    DateTimeOffset GeneratedAt,
    string MachineName,
    string RepoRoot,
    string? ProcessName,
    int? ProcessId,
    string? WindowTitle,
    DpiInfo? Dpi,
    string? ScreenshotPath,
    int ElementCount,
    IReadOnlyList<Finding> Findings,
    IReadOnlyList<ElementDto> Elements,
    StaticAudit StaticAudit);

internal readonly record struct DpiInfo(uint Dpi, double ScalePercent);

internal sealed record StaticAudit(IReadOnlyList<string> ScannedFiles, IReadOnlyList<Finding> Findings);

internal sealed record Finding(string Severity, string Code, string Message, string? ElementId, int? ProcessId);

internal sealed record ElementDto(
    string ControlType,
    string Name,
    string AutomationId,
    int ProcessId,
    RectDto Bounds,
    bool IsEnabled,
    bool IsOffscreen,
    bool IsActionable,
    int Depth)
{
    public bool HasValidBounds => Bounds.HasArea;

    public static ElementDto From(AutomationElement element, int depth)
    {
        var controlType = element.Current.ControlType.ProgrammaticName.Replace("ControlType.", "", StringComparison.Ordinal);
        var automationId = element.Current.AutomationId ?? "";
        var name = element.Current.Name ?? "";
        var bounds = RectDto.From(element.Current.BoundingRectangle);
        var isActionable = IsActionableControl(controlType) || SupportsAction(element);

        return new ElementDto(
            controlType,
            name,
            automationId,
            element.Current.ProcessId,
            bounds,
            element.Current.IsEnabled,
            element.Current.IsOffscreen,
            isActionable,
            depth);
    }

    private static bool IsActionableControl(string controlType)
    {
        return controlType is "Button" or "SplitButton" or "Hyperlink" or "Edit" or "ComboBox"
            or "ListItem" or "MenuItem" or "CheckBox" or "RadioButton" or "TabItem"
            or "Slider" or "Spinner";
    }

    private static bool SupportsAction(AutomationElement element)
    {
        try
        {
            return element.TryGetCurrentPattern(InvokePattern.Pattern, out _)
                || element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out _)
                || element.TryGetCurrentPattern(ValuePattern.Pattern, out _)
                || element.TryGetCurrentPattern(TogglePattern.Pattern, out _);
        }
        catch
        {
            return false;
        }
    }
}

internal readonly record struct RectDto(double X, double Y, double Width, double Height)
{
    public bool HasArea => IsFinite(X) && IsFinite(Y) && IsFinite(Width) && IsFinite(Height) && Width > 0 && Height > 0;
    public double Right => X + Width;
    public double Bottom => Y + Height;
    public double Area => HasArea ? Width * Height : 0;

    public static RectDto From(System.Windows.Rect rect)
    {
        return new RectDto(rect.X, rect.Y, rect.Width, rect.Height);
    }

    public static RectDto Intersection(RectDto first, RectDto second)
    {
        if (!first.HasArea || !second.HasArea)
        {
            return new RectDto(0, 0, 0, 0);
        }

        var x = Math.Max(first.X, second.X);
        var y = Math.Max(first.Y, second.Y);
        var right = Math.Min(first.Right, second.Right);
        var bottom = Math.Min(first.Bottom, second.Bottom);
        return right <= x || bottom <= y ? new RectDto(0, 0, 0, 0) : new RectDto(x, y, right - x, bottom - y);
    }

    private static bool IsFinite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
}

internal static class ProcessExtensions
{
    public static DateTime StartTimeSafe(this Process process)
    {
        try
        {
            return process.StartTime;
        }
        catch
        {
            return DateTime.MinValue;
        }
    }
}
