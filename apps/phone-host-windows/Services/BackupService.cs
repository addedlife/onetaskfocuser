using System.IO;

namespace DeskPhone.Services;

/// <summary>
/// Automatically backs up messages.json to a timestamped file in
/// %APPDATA%\DeskPhone\backups\  every hour and on clean app exit.
/// Keeps the 14 most recent backups and rotates older ones out.
/// </summary>
public class BackupService : IDisposable
{
    private static readonly string SourcePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "DeskPhone", "messages.json");

    private static readonly string BackupDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "DeskPhone", "backups");

    private const int MaxBackups = 14;

    private readonly System.Timers.Timer _timer;
    public event Action<string>? LogLine;

    public BackupService()
    {
        // Hourly timer
        _timer = new System.Timers.Timer(TimeSpan.FromHours(1).TotalMilliseconds)
        { AutoReset = true };
        _timer.Elapsed += (_, _) => CreateBackup("hourly");
        _timer.Start();

        // One backup shortly after startup so we always have something fresh
        _ = Task.Delay(TimeSpan.FromMinutes(2)).ContinueWith(_ => CreateBackup("startup"));
    }

    /// <summary>Call on clean app exit to capture final state before shutdown.</summary>
    public void CreateExitBackup() => CreateBackup("exit");

    public bool IsPaused { get; set; }

    public void CreateBackup(string label = "manual")
    {
        if (IsPaused) return;
        try
        {
            if (!File.Exists(SourcePath)) return;

            Directory.CreateDirectory(BackupDir);

            var stamp    = DateTime.Now.ToString("yyyy-MM-dd_HHmmss");
            var destName = $"messages_{stamp}_{label}.json";
            var destPath = Path.Combine(BackupDir, destName);

            File.Copy(SourcePath, destPath, overwrite: true);
            LogLine?.Invoke($"[BACKUP] Saved: {destName}");

            // Rotate — delete oldest beyond MaxBackups
            var files = Directory.GetFiles(BackupDir, "messages_*.json")
                .OrderByDescending(f => File.GetLastWriteTime(f))
                .ToList();

            foreach (var old in files.Skip(MaxBackups))
            {
                try
                {
                    File.Delete(old);
                    LogLine?.Invoke($"[BACKUP] Rotated out: {Path.GetFileName(old)}");
                }
                catch { }
            }
        }
        catch (Exception ex)
        {
            LogLine?.Invoke($"[BACKUP] Failed: {ex.Message}");
        }
    }

    public void Dispose()
    {
        _timer.Stop();
        _timer.Dispose();
    }
}
