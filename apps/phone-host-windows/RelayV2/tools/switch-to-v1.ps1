# Switch the phone bridge back from the NEW system (RelayV2 tester) to the
# OLD one (DeskPhone v1). Owner-facing: launched from the Desktop shortcut
# "Phone - OLD system (back to normal)". Stops v2 first, then starts v1 via
# its normal Desktop shortcut, and confirms it's answering before declaring
# success.
param([switch]$Quiet)

$ErrorActionPreference = 'SilentlyContinue'

function Say([string]$msg) { Write-Host ("  " + $msg) -ForegroundColor Cyan }
function Popup([string]$msg, [string]$title) {
    if ($Quiet) { Write-Host "POPUP: $title - $msg"; return }
    Add-Type -AssemblyName PresentationFramework
    [void][System.Windows.MessageBox]::Show($msg, $title, 'OK', 'Information')
}

Write-Host ''
Write-Host '  ===== Switching back to the OLD phone system (DeskPhone) =====' -ForegroundColor Yellow
Write-Host ''

# Already on the old system? Then there is nothing to do.
$v1Running = Get-Process -Name 'DeskPhone' -ErrorAction SilentlyContinue
$v2Running = Get-Process -Name 'DeskPhone.RelayV2' -ErrorAction SilentlyContinue
if ($v1Running -and -not $v2Running) {
    Popup 'You are already on the OLD system - nothing needed to change.' 'Already on OLD system'
    exit 0
}

# ── 1. Stop the NEW system ───────────────────────────────────────────────────
if ($v2Running) {
    Say 'Stopping the new system...'
    $v2Running | Stop-Process -Force
    Start-Sleep -Seconds 2
    Say 'New system stopped.'
} else {
    Say 'New system is not running.'
}

# ── 2. Start the OLD system (its own Desktop shortcut is the front door) ────
if (-not $v1Running) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $shortcut = Join-Path $desktop 'DeskPhone.lnk'
    if (Test-Path $shortcut) {
        Say 'Starting the old DeskPhone...'
        Start-Process $shortcut
    } else {
        # Fallback: newest archived build (deploy.ps1 keeps them numbered).
        $repo = 'C:\Users\ydanz\OneDrive\Documents\Shamash Pro 4 App\apps\phone-host-windows'
        $newest = Get-ChildItem (Join-Path $repo 'deployed-builds') -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^b(\d+)$' } |
            Sort-Object { [int]($_.Name.Substring(1)) } -Descending |
            Select-Object -First 1
        $exe = $null
        if ($newest) { $exe = Get-ChildItem $newest.FullName -Filter 'DeskPhone.exe' -Recurse | Select-Object -First 1 }
        if ($exe) {
            Say 'Starting the old DeskPhone (from the latest build archive)...'
            Start-Process $exe.FullName -WorkingDirectory $exe.DirectoryName
        } else {
            Popup 'Could not find the old DeskPhone to start. Use your usual DeskPhone icon to open it manually.' 'Please start DeskPhone yourself'
            exit 1
        }
    }
}

# ── 3. Confirm it's answering before declaring victory ───────────────────────
$alive = $false
foreach ($i in 1..45) {
    Start-Sleep -Seconds 1
    try {
        Invoke-RestMethod -Uri 'http://localhost:8765/health' -TimeoutSec 2 | Out-Null
        $alive = $true; break
    } catch {}
    if ($i % 10 -eq 0) { Say "...still starting ($i seconds)" }
}

if ($alive) {
    Popup 'You are back on the OLD phone system - everything is as it was.' 'OLD system restored'
} else {
    Popup 'The old DeskPhone was started but is not answering yet. Give it a minute; if the phone stays disconnected, open DeskPhone from its usual icon.' 'OLD system starting slowly'
}
