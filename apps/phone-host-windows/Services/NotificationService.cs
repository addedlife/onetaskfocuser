using NAudio.Wave;
using NAudio.Wave.SampleProviders;
using System.Drawing;
using Microsoft.Toolkit.Uwp.Notifications;

// Alias Windows.Forms types to avoid ambiguity with System.Windows.Application
using WinForms = System.Windows.Forms;

namespace DeskPhone.Services;

/// <summary>
/// Handles Windows Toast notifications (interactive, with quick-reply), system-tray
/// balloon tips for calls, ringtone playback, and SMS chimes.
///
/// SMS/MMS notifications use Windows 10/11 Toast so the user can reply directly from
/// the notification without opening any app.  Call alerts still use balloon tips
/// because they fire while a call is in-progress and need the lightweight path.
/// </summary>
public class NotificationService : IDisposable
{
    private readonly WinForms.NotifyIcon  _tray;
    private CancellationTokenSource?      _ringCts;

    public event Action? OnTrayDoubleClick;
    public event Action? OnBalloonTipClicked;

    public NotificationService()
    {
        _tray = new WinForms.NotifyIcon
        {
            Icon    = CreatePhoneIcon(),
            Text    = "DeskPhone",
            Visible = true
        };
        _tray.DoubleClick += (_, _) => OnTrayDoubleClick?.Invoke();
        _tray.BalloonTipClicked += (_, _) => OnBalloonTipClicked?.Invoke();

        var menu = new WinForms.ContextMenuStrip();
        menu.Items.Add("Open DeskPhone", null, (_, _) => OnTrayDoubleClick?.Invoke());
        menu.Items.Add("Exit",           null, (_, _) => System.Windows.Application.Current.Shutdown());
        _tray.ContextMenuStrip = menu;
    }

    // ── Call notifications ────────────────────────────────────────────────
    // Shows a toast with quick-reply chips so the user can text back without answering.
    // displayNumber is the formatted name/number for the title; rawPhone is the
    // digits-only number used in the action argument for sending the reply.
    public void ShowIncomingCall(string displayNumber, string rawPhone)
    {
        try
        {
            var p = Uri.EscapeDataString(rawPhone ?? "");
            new ToastContentBuilder()
                .AddArgument("action", "openphone")
                .AddText($"Incoming Call: {displayNumber}")
                .AddText("Tap a reply to text back instead of answering.")
                .AddButton(
                    new ToastButton("👍 On my way", $"action=quickreply&phone={p}&body={Uri.EscapeDataString("On my way!")}"))
                .AddButton(
                    new ToastButton("Can't talk", $"action=quickreply&phone={p}&body={Uri.EscapeDataString("Can't talk right now, will call back")}"))
                .Show();
        }
        catch
        {
            _tray.ShowBalloonTip(10000, "Incoming Call", displayNumber,
                WinForms.ToolTipIcon.Info);
        }
        StartRingtone();
    }

    public void StopCallAlert() => StopRingtone();

    public void ShowMissedCall(string number)
    {
        _tray.ShowBalloonTip(10000, "Missed Call", number,
            WinForms.ToolTipIcon.Warning);
        PlayChime();
    }

    public void ShowCallEnded() =>
        _tray.ShowBalloonTip(3000, "DeskPhone", "Call ended",
            WinForms.ToolTipIcon.None);

    // ── SMS notification — Windows 10/11 interactive Toast ───────────────
    // Clicking the notification body → opens OneTask phone page (handled by
    //   HandleToastActivation in MainViewModel via action=openphone).
    // "Send" button → sends the typed reply silently in DeskPhone (background activation).
    // Quick-reply chips → send predefined responses silently.
    public void ShowNewMessage(string from, string phone, string preview)
    {
        try
        {
            var text = string.IsNullOrWhiteSpace(preview) ? "📷 Photo" : preview;

            // Encode phone for safe embedding in the action argument string.
            // Using plain key=value pairs so ToastArguments can parse them back.
            var p = Uri.EscapeDataString(phone ?? "");

            new ToastContentBuilder()
                // Body click → open OneTask phone/messages view in the browser
                .AddArgument("action", "openphone")
                .AddText($"Message from {from}")
                .AddText(text)
                // Free-text reply box (reply → "Send" button below)
                .AddInputTextBox("replyInput", "Reply…")
                // "Send" — foreground activation; app handles it via HandleToastActivation
                .AddButton(
                    new ToastButton("Send", $"action=reply&phone={p}"))
                // Quick-reply chips — one tap, sends immediately
                .AddButton(
                    new ToastButton("👍 On my way", $"action=quickreply&phone={p}&body={Uri.EscapeDataString("On my way!")}"))
                .AddButton(
                    new ToastButton("Can't talk", $"action=quickreply&phone={p}&body={Uri.EscapeDataString("Can't talk right now, will call back")}"))
                .Show();
        }
        catch
        {
            // Fallback: if Toast fails (e.g. Notification Center disabled), use balloon tip
            var text = string.IsNullOrWhiteSpace(preview) ? "Photo" : preview;
            _tray.ShowBalloonTip(15000, $"Message from {from}", text, WinForms.ToolTipIcon.Info);
        }

        PlayChime();
    }

    public void ShowVoicemail(string from, string preview)
    {
        var text = string.IsNullOrWhiteSpace(preview) ? $"From {from}" : preview;
        _tray.ShowBalloonTip(15000, "Voicemail", text,
            WinForms.ToolTipIcon.Info);
        PlayChime();
    }

    // ── Repeating ringtone (two-tone phone ring) ─────────────────────────
    // FIXED: Uses CancellationToken.WaitHandle instead of Thread.Sleep
    // so the tone stops instantly when cancelled. Also has a 30-second
    // safety timeout so the ringtone never plays forever.
    private void StartRingtone()
    {
        StopRingtone();
        _ringCts = new CancellationTokenSource();
        // Safety: kill ringtone after 30 seconds no matter what
        _ringCts.CancelAfter(TimeSpan.FromSeconds(30));
        var ct = _ringCts.Token;

        _ = Task.Run(async () =>
        {
            try
            {
                while (!ct.IsCancellationRequested)
                {
                    PlayTone(880, 800, ct);
                    if (ct.IsCancellationRequested) break;
                    await Task.Delay(200, ct);
                    PlayTone(660, 600, ct);
                    if (ct.IsCancellationRequested) break;
                    await Task.Delay(1200, ct);
                }
            }
            catch (OperationCanceledException) { /* expected when stopped */ }
        }, ct);
    }

    private void StopRingtone()
    {
        try
        {
            _ringCts?.Cancel();
            _ringCts?.Dispose();
        }
        catch { }
        _ringCts = null;
    }

    private static void PlayTone(double frequency, int durationMs,
                                  CancellationToken ct = default)
    {
        try
        {
            using var player = new WaveOutEvent();
            var sine = new SignalGenerator(44100, 1)
            {
                Type      = SignalGeneratorType.Sin,
                Frequency = frequency,
                Gain      = 0.25
            };
            player.Init(sine.Take(TimeSpan.FromMilliseconds(durationMs)));
            player.Play();
            // WaitOne returns immediately when ct is cancelled — instant stop
            ct.WaitHandle.WaitOne(durationMs);
            player.Stop();
        }
        catch { }
    }

    private static void PlayChime()
    {
        _ = Task.Run(() =>
        {
            try { System.Media.SystemSounds.Exclamation.Play(); }
            catch { }
        });
    }

    // ── Tray tooltip ──────────────────────────────────────────────────────
    public void UpdateStatus(bool callsConnected, bool messagesConnected)
    {
        _tray.Text = callsConnected ? "DeskPhone - Connected" : "DeskPhone - Not connected";
    }

    // ── Programmatic phone icon (blue circle with white handset) ──────────
    // Draws a 32×32 icon so the tray shows a recognisable phone symbol
    // instead of the generic Windows application icon.
    private static Icon CreatePhoneIcon()
    {
        try
        {
            using var bmp = new Bitmap(32, 32, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);

                // Blue circle background
                using var circleBrush = new SolidBrush(Color.FromArgb(0xFF, 0x1A, 0x73, 0xE8));
                g.FillEllipse(circleBrush, 1, 1, 30, 30);

                // White phone handset using a font glyph (Segoe MDL2 Assets ✆ U+E717)
                // Fall back to Wingdings if MDL2 not available
                using var fontMdl2 = new Font("Segoe MDL2 Assets", 16f, FontStyle.Regular, GraphicsUnit.Pixel);
                using var fontFallback = new Font("Segoe UI Symbol", 16f, FontStyle.Regular, GraphicsUnit.Pixel);
                var phoneChar = "\uE717";  // Segoe MDL2 "Phone" glyph
                var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                using var whiteBrush = new SolidBrush(Color.White);

                // Try MDL2; if the glyph doesn't render (box), Segoe UI Symbol has ✆
                g.DrawString(phoneChar, fontMdl2, whiteBrush, new RectangleF(0, 0, 32, 32), sf);
            }
            return Icon.FromHandle(bmp.GetHicon());
        }
        catch
        {
            return SystemIcons.Application;
        }
    }

    public void Dispose()
    {
        StopRingtone();
        _tray.Visible = false;
        _tray.Dispose();
    }
}
