using NAudio.Wave;
using NAudio.Wave.SampleProviders;
using System.Drawing;

// Alias Windows.Forms types to avoid ambiguity with System.Windows.Application
using WinForms = System.Windows.Forms;

namespace DeskPhone.Services;

/// <summary>
/// Handles system-tray balloon tips, ringtone playback, and SMS chimes.
/// Uses Windows Forms NotifyIcon (project has UseWindowsForms=true).
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
    public void ShowIncomingCall(string number)
    {
        _tray.ShowBalloonTip(10000, "Incoming Call", number,
            WinForms.ToolTipIcon.Info);
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

    // ── SMS notification ──────────────────────────────────────────────────
    public void ShowNewMessage(string from, string preview)
    {
        var text = string.IsNullOrWhiteSpace(preview) ? "Photo" : preview;
        _tray.ShowBalloonTip(15000, $"Message from {from}", text,
            WinForms.ToolTipIcon.Info);
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
