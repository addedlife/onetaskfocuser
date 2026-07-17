# Switch the phone bridge from the OLD system (DeskPhone v1 + tablet) to the
# NEW one (RelayV2 tester). Owner-facing: launched from the Desktop shortcut
# "Phone - NEW system (test)". Plain-English progress, popup at the end.
#
# Order matters: (1) pin the phone to the PC in the OLD system's arbitration
# doc so the TABLET releases the Bluetooth link on its own (it obeys the
# 'preferred' pin — no more powering it off by hand), (2) stop v1 on this PC,
# (3) start v2, which keeps retrying until the tablet has actually let go.
param([switch]$Quiet)

$ErrorActionPreference = 'SilentlyContinue'
$repo = 'C:\Users\ydanz\OneDrive\Documents\Shamash Pro 4 App\apps\phone-host-windows'
$ownerUrl = 'https://firestore.googleapis.com/v1/projects/onetaskonly-app/databases/(default)/documents/phone-relay/owner'
$apiKey = 'AIzaSyB5UiDE9s0xjWeYa4OQ1LLJ63EwPVoSLrA'  # public web key; the owner doc is open by design
$stateDir = Join-Path $env:LOCALAPPDATA 'DeskPhoneRelayV2'

function Say([string]$msg) { Write-Host ("  " + $msg) -ForegroundColor Cyan }
function Popup([string]$msg, [string]$title) {
    if ($Quiet) { Write-Host "POPUP: $title - $msg"; return }
    Add-Type -AssemblyName PresentationFramework
    [void][System.Windows.MessageBox]::Show($msg, $title, 'OK', 'Information')
}

Write-Host ''
Write-Host '  ===== Switching to the NEW phone system (v2 tester) =====' -ForegroundColor Yellow
Write-Host ''

# ── 1. Ask the tablet to hand the phone to this PC ──────────────────────────
# Writes preferred='pc' into the OLD system's arbitration doc. The tablet
# watches that doc and releases the Bluetooth link cooperatively (~15-30s).
$parked = $false
try {
    $owner = Invoke-RestMethod -Uri "${ownerUrl}?key=$apiKey" -TimeoutSec 10
    $prev = $owner.fields.preferred.stringValue
    if (-not $prev) { $prev = 'tablet' }
    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
    Set-Content -Path (Join-Path $stateDir 'prev-preferred.txt') -Value $prev -Encoding Ascii
    $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $body = '{"fields":{"preferred":{"stringValue":"pc"},"preferredAtMs":{"integerValue":"' + $nowMs + '"}}}'
    Invoke-RestMethod -Method Patch -ContentType 'application/json' -Body $body -TimeoutSec 10 `
        -Uri "${ownerUrl}?key=$apiKey&updateMask.fieldPaths=preferred&updateMask.fieldPaths=preferredAtMs" | Out-Null
    $parked = $true
    Say "Tablet asked to hand the phone over (its normal setting '$prev' will be restored when you switch back)."
} catch {
    Say 'Could not reach the handoff switchboard - if the tablet is on, it may keep holding the phone.'
    Say 'Fallback: turn the tablet screen off, or close its phone app, then continue.'
}

# ── 2. Stop the OLD system on this PC ────────────────────────────────────────
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

# ── 3. Find your phone's Bluetooth address (from the old system's settings) ──
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

# ── 4. Start the NEW system ──────────────────────────────────────────────────
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

# ── 5. Wait until it's alive, then until the phone links up ─────────────────
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
Say 'New system is running. Waiting for the tablet to let go and the phone to link up...'
Say '(this is normally under a minute, worst case two)'

$connected = $false
foreach ($i in 1..120) {
    Start-Sleep -Seconds 1
    try {
        $s = Invoke-RestMethod -Uri 'http://127.0.0.1:8766/status' -TimeoutSec 2
        if ($s.connected) { $connected = $true; break }
    } catch {}
    if ($i % 15 -eq 0) { Say "...still connecting ($i seconds)" }
}

# ── 6. Open the tester page and report honestly ──────────────────────────────
Start-Process 'https://onetaskonly-app.firebaseapp.com/?standalone=relaytester'

if ($connected) {
    Say 'Phone connected!'
    Popup "You are now on the NEW phone system, and the tablet has handed the phone over. The tester page just opened in your browser. When you are done testing, click 'Phone - OLD system' to put everything back." 'NEW system is live'
} elseif ($parked) {
    Popup "The new system is running but the phone has not linked up yet - the tablet may still be letting go. Give it another minute or two. If it never connects, click 'Phone - OLD system' to go back and tell Claude." 'NEW system started (phone still connecting)'
} else {
    Popup "The new system is running, but the tablet could not be reached to hand the phone over - it is probably still holding it. Turn the tablet's screen off (or close its phone app) and the connection should complete by itself. 'Phone - OLD system' always takes you back." 'NEW system started (tablet may still hold the phone)'
}
