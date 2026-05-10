# deploy.ps1 -- runs after every Release build
# Hard requirements enforced here:
#   1. Release builds only
#   2. Detailed changelog entry must already exist for the current build
#   3. Successful deploy must create a Git commit so the build is rewindable
#   4. Previous deployed build must remain launchable beside the latest build
#   5. Desktop shortcuts must always expose both Latest and Previous build launch paths

param([string]$TargetPath)

$ErrorActionPreference = "Stop"

function FailDeploy([string]$Message) {
    Write-Host "[DEPLOY] ERROR: $Message"
    exit 1
}

function Normalize-Text([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return "" }
    return ($Text -replace "\s+", " ").Trim()
}

function Set-DesktopShortcut(
    [string]$ShortcutPath,
    [string]$TargetPath,
    [string]$WorkingDirectory,
    [string]$Description,
    [string]$IconPath
) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = $TargetPath
    $shortcut.WorkingDirectory = $WorkingDirectory
    $shortcut.Description = $Description
    if (-not [string]::IsNullOrWhiteSpace($IconPath)) {
        $shortcut.IconLocation = $IconPath
    }
    $shortcut.Save()
}

function Set-LaunchProtocol(
    [string]$Protocol,
    [string]$TargetPath
) {
    $protocolRoot = "HKCU:\Software\Classes\$Protocol"
    New-Item -Path $protocolRoot -Force | Out-Null
    Set-Item -Path $protocolRoot -Value "URL:DeskPhone"
    New-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value "" -Force | Out-Null

    $commandRoot = Join-Path $protocolRoot "shell\open\command"
    New-Item -Path $commandRoot -Force | Out-Null
    Set-Item -Path $commandRoot -Value "`"$TargetPath`" `"%1`""
}

function Get-BuildNumberFromTag([string]$Tag) {
    if ($Tag -match "^b(\d+)$") {
        return [int]$Matches[1]
    }

    return -1
}

function Offer-BuildToRunningInstance([string]$BuildPath, [string]$BuildTag) {
    try {
        $encodedExe = [Uri]::EscapeDataString($BuildPath)
        $encodedTag = [Uri]::EscapeDataString($BuildTag)
        $uri = "http://localhost:8765/offer-update?exe=$encodedExe&build=$encodedTag"
        $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $uri -TimeoutSec 5
        return $response.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

function Assert-DetailedChangelogEntry([string]$VersionTag) {
    $changelogFile = Join-Path $PSScriptRoot "changelog.json"
    if (-not (Test-Path $changelogFile)) {
        FailDeploy "changelog.json is missing."
    }

    $entries = Get-Content $changelogFile -Raw | ConvertFrom-Json
    if ($entries.GetType().Name -eq "Object") { $entries = @($entries) }

    $matchingEntries = @($entries | Where-Object { $_.version -eq $VersionTag })
    if ($matchingEntries.Count -eq 0) {
        FailDeploy "Add a detailed changelog entry for $VersionTag before running Release deploy."
    }

    $entry = $matchingEntries[0]
    $notes = Normalize-Text ([string]$entry.notes)
    $devNotes = Normalize-Text ([string]$entry.devNotes)

    if ($notes.Length -lt 24) {
        FailDeploy "Changelog notes for $VersionTag are too short."
    }

    if ($devNotes.Length -lt 48) {
        FailDeploy "Changelog devNotes for $VersionTag are too short."
    }

    if ($notes -match "^Build \d+ automated deployment\.?$") {
        FailDeploy "Changelog notes for $VersionTag still look like a placeholder."
    }
}

if ([string]::IsNullOrWhiteSpace($TargetPath)) {
    FailDeploy "TargetPath is required."
}

if ($TargetPath -notmatch "\\Release\\") {
    FailDeploy "Deploy is hardcoded for Release builds only. Build with -c Release."
}

$numFile = Join-Path $PSScriptRoot "build.num"
if (-not (Test-Path $numFile)) {
    FailDeploy "build.num is missing."
}

$buildNum = [int](Get-Content $numFile -Raw).Trim()
$nextBuildNum = $buildNum + 1
$nextBuildNum | Set-Content $numFile
Write-Host "[DEPLOY] This was build #$buildNum; next will be #$nextBuildNum"

$versionTag = "b$buildNum"
Assert-DetailedChangelogEntry $versionTag

$exeFile = [System.IO.Path]::ChangeExtension($TargetPath, ".exe")
if (-not (Test-Path $exeFile)) {
    $outDir = Split-Path $TargetPath
    $exeFile = Get-ChildItem $outDir -Filter "DeskPhone*.exe" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1 -ExpandProperty FullName
}

if ([string]::IsNullOrWhiteSpace($exeFile) -or -not (Test-Path $exeFile)) {
    FailDeploy "Could not find EXE in $(Split-Path $TargetPath)"
}

Write-Host "[DEPLOY] EXE: $exeFile"

$outputDir = Split-Path $exeFile
$archiveRoot = Join-Path $PSScriptRoot "deployed-builds"
$archiveDir = Join-Path $archiveRoot $versionTag
$archiveExe = Join-Path $archiveDir "DeskPhone.exe"
$launcherProject = Join-Path $PSScriptRoot "Tools\DeskPhoneLauncher\DeskPhoneLauncher.csproj"
$launcherDir = Join-Path $archiveRoot "launcher"
$launcherExe = Join-Path $launcherDir "DeskPhoneLauncher.exe"
$auditorProject = Join-Path $PSScriptRoot "Tools\DeskPhoneUiAuditor\DeskPhoneUiAuditor.csproj"
$auditorDir = Join-Path $archiveDir "Tools\DeskPhoneUiAuditor"
$auditorExe = Join-Path $auditorDir "DeskPhoneUiAuditor.exe"
$latestIconPath = Join-Path $PSScriptRoot "Assets\\Icons\\deskphone-latest-filled.ico"
$previousIconPath = Join-Path $PSScriptRoot "Assets\\Icons\\deskphone-previous-filled.ico"

New-Item -ItemType Directory -Path $archiveRoot -Force | Out-Null

if (Test-Path $archiveDir) {
    Remove-Item -LiteralPath $archiveDir -Recurse -Force
}

New-Item -ItemType Directory -Path $archiveDir -Force | Out-Null

$exeBaseName = [System.IO.Path]::GetFileNameWithoutExtension($exeFile)
Get-ChildItem $outputDir -Force | ForEach-Object {
    if ($_.PSIsContainer) {
        Copy-Item $_.FullName -Destination $archiveDir -Recurse -Force
        return
    }

    if ($_.Name -like "DeskPhone_b*") {
        return
    }

    Copy-Item $_.FullName -Destination $archiveDir -Force
}

if (-not (Test-Path $archiveExe)) {
    FailDeploy "Archived EXE was not created at $archiveExe"
}

Write-Host "[DEPLOY] Archived build to $archiveDir"
Write-Host "[DEPLOY] Previous builds remain available; running instances are left untouched."

if (-not (Test-Path $auditorProject)) {
    FailDeploy "DeskPhone UI Auditor project is missing at $auditorProject"
}

& dotnet publish $auditorProject -c Release -o $auditorDir --no-self-contained /p:DebugType=None /p:DebugSymbols=false
if ($LASTEXITCODE -ne 0) {
    FailDeploy "DeskPhone UI Auditor publish failed."
}

if (-not (Test-Path $auditorExe)) {
    FailDeploy "DeskPhone UI Auditor EXE was not created at $auditorExe"
}

Write-Host "[DEPLOY] UI Auditor: $auditorExe"

if (-not (Test-Path $launcherProject)) {
    FailDeploy "DeskPhone launcher project is missing at $launcherProject"
}

New-Item -ItemType Directory -Path $launcherDir -Force | Out-Null
& dotnet publish $launcherProject -c Release -o $launcherDir --nologo | Write-Host
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $launcherExe)) {
    FailDeploy "Stable launcher publish failed."
}

Write-Host "[DEPLOY] Stable launcher: $launcherExe"

$desktops = @(
    [Environment]::GetFolderPath("Desktop"),
    "C:\Users\$env:USERNAME\Desktop"
) | Select-Object -Unique

$pinnedTaskbar = Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"

foreach ($desk in $desktops) {
    Get-ChildItem $desk -Filter "DeskPhone_b*.lnk" -ErrorAction SilentlyContinue |
        Remove-Item -Force -ErrorAction SilentlyContinue
}

if (Test-Path $pinnedTaskbar) {
    Set-DesktopShortcut `
        -ShortcutPath (Join-Path $pinnedTaskbar "DeskPhone.lnk") `
        -TargetPath $launcherExe `
        -WorkingDirectory $launcherDir `
        -Description "DeskPhone latest deployed build" `
        -IconPath $latestIconPath
}

$previousArchiveDir = Get-ChildItem $archiveRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne $versionTag } |
    Sort-Object @{ Expression = { Get-BuildNumberFromTag $_.Name } ; Descending = $true } |
    Select-Object -First 1

$latestShortcutPath = Join-Path $desktops[0] "DeskPhone.lnk"
Set-DesktopShortcut `
    -ShortcutPath $latestShortcutPath `
    -TargetPath $launcherExe `
    -WorkingDirectory $launcherDir `
    -Description "DeskPhone" `
    -IconPath $(if (Test-Path $latestIconPath) { $latestIconPath } else { $archiveExe })
Set-LaunchProtocol -Protocol "deskphone" -TargetPath $launcherExe

$previousShortcutPath = Join-Path $desktops[0] "DeskPhone Previous Build.lnk"
if ($previousArchiveDir) {
    $previousExe = Get-ChildItem $previousArchiveDir.FullName -Filter "DeskPhone.exe" -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1 -ExpandProperty FullName

    if ([string]::IsNullOrWhiteSpace($previousExe) -or -not (Test-Path $previousExe)) {
        $previousExe = Get-ChildItem $previousArchiveDir.FullName -Filter "DeskPhone_b*.exe" -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1 -ExpandProperty FullName
    }

    if (-not [string]::IsNullOrWhiteSpace($previousExe) -and (Test-Path $previousExe)) {
        Set-DesktopShortcut `
            -ShortcutPath $previousShortcutPath `
            -TargetPath $previousExe `
            -WorkingDirectory $previousArchiveDir.FullName `
            -Description "DeskPhone Previous Build" `
            -IconPath $(if (Test-Path $previousIconPath) { $previousIconPath } else { $previousExe })
        Write-Host "[DEPLOY] Previous build shortcut: $previousExe"
    }
    else {
        Remove-Item -LiteralPath $previousShortcutPath -Force -ErrorAction SilentlyContinue
    }
}
else {
    Set-DesktopShortcut `
        -ShortcutPath $previousShortcutPath `
        -TargetPath $archiveExe `
        -WorkingDirectory $archiveDir `
        -Description "DeskPhone Previous Build (same as latest until another release exists)" `
        -IconPath $(if (Test-Path $previousIconPath) { $previousIconPath } else { $archiveExe })
}

$changelogFile = Join-Path $PSScriptRoot "changelog.json"
if (-not (Test-Path $changelogFile)) {
    FailDeploy "changelog.json is missing."
}

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$entries = Get-Content $changelogFile -Raw | ConvertFrom-Json
if ($entries.GetType().Name -eq "Object") { $entries = @($entries) }

$matchingEntries = @($entries | Where-Object { $_.version -eq $versionTag })
if ($matchingEntries.Count -eq 0) {
    FailDeploy "Add a detailed changelog entry for $versionTag before running Release deploy."
}

$entry = $matchingEntries[0]
$notes = Normalize-Text ([string]$entry.notes)
$devNotes = Normalize-Text ([string]$entry.devNotes)

if ($notes.Length -lt 24) {
    FailDeploy "Changelog notes for $versionTag are too short."
}

if ($devNotes.Length -lt 48) {
    FailDeploy "Changelog devNotes for $versionTag are too short."
}

if ($notes -match "^Build \d+ automated deployment\.?$") {
    FailDeploy "Changelog notes for $versionTag still look like a placeholder."
}

$entry.timestamp = $timestamp
$entries = @($entry) + @($entries | Where-Object { $_ -ne $entry })
$entries | ConvertTo-Json -Depth 5 | Set-Content $changelogFile
Copy-Item $changelogFile -Destination (Join-Path $archiveDir "changelog.json") -Force
Write-Host "[DEPLOY] Verified detailed changelog entry for $versionTag"

$buildInfo = [ordered]@{
    version = $versionTag
    timestamp = $timestamp
    executable = "DeskPhone.exe"
}
$buildInfo | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $archiveDir "build-info.json")
Write-Host "[DEPLOY] Wrote build-info.json for $versionTag"

$insideGit = & git -C $PSScriptRoot rev-parse --is-inside-work-tree 2>$null
if (($LASTEXITCODE -ne 0) -or ($insideGit.Trim() -ne "true")) {
    FailDeploy "Deploy requires a Git worktree so the build is rewindable."
}

$pathsToStage = @(
    ".gitignore",
    "App.xaml",
    "App.xaml.cs",
    "AGENTS.md",
    "Assets",
    "Converters.cs",
    "docs",
    "MainWindow.xaml",
    "MainWindow.xaml.cs",
    "deploy.ps1",
    "DeskPhone.csproj",
    "GlobalUsings.cs",
    "build.num",
    "changelog.json",
    "Helpers",
    "LogWindow.xaml",
    "LogWindow.xaml.cs",
    "Models",
    "Services",
    "Themes",
    "Tools",
    "ViewModels"
)

& git -C $PSScriptRoot add -- $pathsToStage
if ($LASTEXITCODE -ne 0) {
    FailDeploy "git add failed."
}

& git -C $PSScriptRoot diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    FailDeploy "No staged source changes detected; refusing to deploy without a rewindable commit."
}

if ($LASTEXITCODE -ne 1) {
    FailDeploy "Unable to inspect staged Git changes."
}

$commitTitle = "release($versionTag): $notes"
if ($commitTitle.Length -gt 72) {
    $commitTitle = $commitTitle.Substring(0, 69) + "..."
}

& git -C $PSScriptRoot commit -m $commitTitle -m $devNotes
if ($LASTEXITCODE -ne 0) {
    FailDeploy "git commit failed."
}

Write-Host "[DEPLOY] Created Git commit for $versionTag"
Write-Host "[DEPLOY] Latest shortcut: $latestShortcutPath"
Write-Host "[DEPLOY] Previous shortcut: $previousShortcutPath"

$runningDeskPhone = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq "DeskPhone" -or $_.Name -like "DeskPhone_b*" })
if ($runningDeskPhone.Count -gt 0) {
    if (Offer-BuildToRunningInstance -BuildPath $archiveExe -BuildTag $versionTag) {
        Write-Host "[DEPLOY] Running build notified about $versionTag; new build will open only if the user accepts the handoff prompt."
    }
    else {
        Write-Host "[DEPLOY] Running build detected, but it did not accept the update offer. The new build was not auto-launched."
    }
}
else {
    Start-Process $launcherExe
    Write-Host "[DEPLOY] Launched via stable launcher: $launcherExe"
}

exit 0
