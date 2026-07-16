# Switch the phone bridge from the OLD system (DeskPhone v1) to the NEW one
# (RelayV2 tester). Owner-facing: launched from the Desktop shortcut
# "Phone - NEW system (test)". Plain-English progress, popup at the end.
# The two systems can never run against the phone at once — this script
# always stops v1 (gracefully first, forcefully if needed) BEFORE v2 starts.
param([switch]$Quiet)

$ErrorActionPreference = 'SilentlyContinue'
$repo = 'C:\Users\ydanz\OneDrive\Documents\Shamash Pro 4 App\apps\phone-host-windows'

function Say([string]$msg) { Write-Host ("  " + $msg) -ForegroundColor Cyan }
function Popup([string]$msg, [string]$title) {
    if ($Quiet) { Write-Host "POPUP: $title - $msg"; return }
    Add-Type -AssemblyName PresentationFramework
    [void][System.Windows.MessageBox]::Show($msg, $title, 'OK', 'Information')
}

Write-Host ''
Write-Host '  ===== Switching to the NEW phone system (v2 tester) =====' -ForegroundColor Yellow
Write-Host ''

# ── 1. Stop the OLD system ────────────────────────────────────────────────────
$v1 = Get-Process -Name 'DeskPhone' -ErrorAction SilentlyContinue
if ($v1) {
    Say 'Asking the old DeskPhone to close nicely...'
    try { Invoke-RestMethod -Method Post -Uri 'http://localhost:8765/shutdown' -TimeoutSec 5 | Out-Null } catch {}
    $waited = 0
    while ($waited -lt 15 -and (Get-Process -Name 'DeskPhone' -ErrorAction SilentlyContinue)) {
        Start-Sleep -Seconds 1; $waited++
    }
    $leftover = Get-Process -Name 'DeskPhone' -ErrorAction SilentlyContinue
    if ($leftover) {
        Say 'It did not close on its own - closing it now.'
        $leftover | Stop-Process -Force
        Start-Sleep -Seconds 2
    }
    Say 'Old system stopped.'
} else {
    Say 'Old system is not running - good.'
}

# A previous v2 instance left behind? Restart it fresh.
Get-Process -Name 'DeskPhone.RelayV2' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

# ── 2. Find your phone's Bluetooth address (from the old system's settings) ──
$settingsPath = Join-Path $env:APPDATA 'DeskPhone\settings.json'
$address = $null
if (Test-Path $settingsPath) {
    try { $address = (Get-Content $settingsPath -Raw | ConvertFrom-Json).LastDeviceAddress } catch {}
}
if (-not $address) {
    Popup "Could not find your phone's Bluetooth address in the old system's settings. Open the old DeskPhone once, connect the phone, then try again." 'Switch failed'
    exit 1
}
Say "Phone found: $address"

# ── 3. Start the NEW system ──────────────────────────────────────────────────
$exe = Join-Path $repo 'RelayV2\bin\ARM64\Release\net8.0-windows10.0.19041.0\DeskPhone.RelayV2.exe'
if (-not (Test-Path $exe)) {
    $exe = Join-Path $repo 'RelayV2\bin\ARM64\Debug\net8.0-windows10.0.19041.0\DeskPhone.RelayV2.exe'
}
if (-not (Test-Path $exe)) {
    Popup 'The new system has not been built on this PC yet. Ask Claude to rebuild RelayV2, then try again.' 'Switch failed'
    exit 1
}

$env:RELAYV2_PHONE_BT_ADDRESS = $address
$env:RELAYV2_FORCE_LEADER = '1'   # tester phase: this PC takes the phone without waiting for the cloud vote
$secret = [Environment]::GetEnvironmentVariable('PHONE_RELAY_V2_SECRET_WINDOWS', 'User')
if ($secret) { $env:PHONE_RELAY_V2_SECRET_WINDOWS = $secret }

Say 'Starting the new system...'
Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -WindowStyle Minimized

# ── 4. Wait until it's alive, then until the phone links up ─────────────────
$alive = $false
foreach ($i in 1..30) {
    Start-Sleep -Seconds 1
    try {
        $h = Invoke-RestMethod -Uri 'http://127.0.0.1:8766/health' -TimeoutSec 2
        if ($h.ok) { $alive = $true; break }
    } catch {}
}
if (-not $alive) {
    Popup 'The new system started but is not answering. Click the OLD system shortcut to go back, and tell Claude what happened.' 'Something went wrong'
    exit 1
}
Say 'New system is running. Connecting to your phone (this can take up to a minute)...'

$connected = $false
foreach ($i in 1..90) {
    Start-Sleep -Seconds 1
    try {
        $s = Invoke-RestMethod -Uri 'http://127.0.0.1:8766/status' -TimeoutSec 2
        if ($s.connected) { $connected = $true; break }
    } catch {}
    if ($i % 10 -eq 0) { Say "...still connecting ($i seconds)" }
}

# ── 5. Open the tester page and report honestly ──────────────────────────────
Start-Process 'https://onetaskonly-app.firebaseapp.com/?standalone=relaytester'

if ($connected) {
    Say 'Phone connected!'
    Popup "You are now on the NEW phone system. The tester page just opened in your browser. When you are done testing, click the 'Phone - OLD system' shortcut to go back." 'NEW system is live'
} else {
    Popup "The new system is running, but the phone has not linked up yet. Give it another minute - or if it never connects, click the 'Phone - OLD system' shortcut to go back and tell Claude." 'NEW system started (phone still connecting)'
}
