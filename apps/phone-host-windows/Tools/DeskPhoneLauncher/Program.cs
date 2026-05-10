using System.Diagnostics;
using System.Net.Http;

namespace DeskPhoneLauncher;

internal static class Program
{
    private const string BridgeShowUrl = "http://127.0.0.1:8765/show";

    private static async Task<int> Main()
    {
        if (await TryShowRunningDeskPhoneAsync())
        {
            return 0;
        }

        var latestExe = FindLatestBuildExe();
        if (string.IsNullOrWhiteSpace(latestExe))
        {
            return 2;
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = latestExe,
            WorkingDirectory = Path.GetDirectoryName(latestExe) ?? "",
            UseShellExecute = true
        });

        return 0;
    }

    private static async Task<bool> TryShowRunningDeskPhoneAsync()
    {
        try
        {
            using var client = new HttpClient
            {
                Timeout = TimeSpan.FromMilliseconds(900)
            };

            using var response = await client.PostAsync(BridgeShowUrl, content: null);
            return response.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    private static string? FindLatestBuildExe()
    {
        var archiveRoot = FindArchiveRoot();
        if (archiveRoot is null || !archiveRoot.Exists)
        {
            return null;
        }

        return archiveRoot
            .EnumerateDirectories("b*")
            .Select(dir => new
            {
                Directory = dir,
                BuildNumber = TryParseBuildNumber(dir.Name)
            })
            .Where(item => item.BuildNumber >= 0)
            .OrderByDescending(item => item.BuildNumber)
            .SelectMany(item => item.Directory
                .EnumerateFiles("DeskPhone.exe")
                .Concat(item.Directory.EnumerateFiles("DeskPhone_b*.exe"))
                .OrderBy(file => file.Name.StartsWith("DeskPhone_b", StringComparison.OrdinalIgnoreCase) ? 1 : 0)
                .ThenByDescending(file => file.LastWriteTimeUtc))
            .Select(file => file.FullName)
            .FirstOrDefault();
    }

    private static DirectoryInfo? FindArchiveRoot()
    {
        var baseDir = new DirectoryInfo(AppContext.BaseDirectory);
        if (baseDir.Name.Equals("launcher", StringComparison.OrdinalIgnoreCase))
        {
            return baseDir.Parent;
        }

        var current = baseDir;
        while (current is not null)
        {
            var candidate = Path.Combine(current.FullName, "deployed-builds");
            if (Directory.Exists(candidate))
            {
                return new DirectoryInfo(candidate);
            }

            current = current.Parent;
        }

        return null;
    }

    private static int TryParseBuildNumber(string directoryName)
    {
        return directoryName.Length > 1
            && directoryName[0] == 'b'
            && int.TryParse(directoryName[1..], out var number)
                ? number
                : -1;
    }
}
