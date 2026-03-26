# sync-from-live.ps1 - Downloads the REAL deployed code from the live site
# This is the ONLY way to know what's actually running in production.
# Run this before any work session to make sure local files match reality.

$ErrorActionPreference = "Stop"
$sandbox = $PSScriptRoot
$liveUrl = "https://onetaskfocuser.netlify.app"
$liveDir = Join-Path $sandbox "_live_snapshot"

Write-Host ""
Write-Host "=== SYNC FROM LIVE ===" -ForegroundColor Cyan
Write-Host "Downloading from: $liveUrl"
Write-Host "Snapshot folder:   $liveDir"
Write-Host ""

# Step 1: Download index.html to discover all JS files
if (Test-Path $liveDir) { Remove-Item $liveDir -Recurse -Force }
New-Item -ItemType Directory -Path $liveDir | Out-Null
New-Item -ItemType Directory -Path (Join-Path $liveDir "js") | Out-Null

$indexPath = Join-Path $liveDir "index.html"
Invoke-WebRequest -Uri "$liveUrl/index.html" -OutFile $indexPath -UseBasicParsing
Write-Host "  Downloaded index.html" -ForegroundColor Green

# Step 2: Parse index.html to find all JS files
$indexContent = Get-Content $indexPath -Raw
$jsFiles = [regex]::Matches($indexContent, 'src="js/([^"?]+)') | ForEach-Object { $_.Groups[1].Value }
Write-Host "  Found $($jsFiles.Count) JS files in index.html" -ForegroundColor Green

# Step 3: Download each JS file
foreach ($js in $jsFiles) {
    $outPath = Join-Path $liveDir "js\$js"
    try {
        Invoke-WebRequest -Uri "$liveUrl/js/$js" -OutFile $outPath -UseBasicParsing
        Write-Host "  Downloaded js/$js" -ForegroundColor Green
    } catch {
        Write-Host "  FAILED js/$js" -ForegroundColor Red
    }
}

# Step 4: Compare live vs sandbox
Write-Host ""
Write-Host "=== DIFF: LIVE vs SANDBOX ===" -ForegroundColor Cyan

$allFiles = @("index.html") + ($jsFiles | ForEach-Object { "js/$_" })
$hasDiffs = $false

foreach ($f in $allFiles) {
    $livePath = Join-Path $liveDir $f
    $sandboxPath = Join-Path $sandbox $f

    if (-not (Test-Path $sandboxPath)) {
        Write-Host "  MISSING in sandbox: $f" -ForegroundColor Red
        $hasDiffs = $true
        continue
    }
    if (-not (Test-Path $livePath)) {
        Write-Host "  EXTRA in sandbox only: $f" -ForegroundColor Yellow
        continue
    }

    $liveHash = (Get-FileHash $livePath -Algorithm SHA256).Hash
    $sandboxHash = (Get-FileHash $sandboxPath -Algorithm SHA256).Hash

    if ($liveHash -eq $sandboxHash) {
        Write-Host "  IDENTICAL: $f" -ForegroundColor DarkGray
    } else {
        Write-Host "  CHANGED:   $f" -ForegroundColor Yellow
        $hasDiffs = $true
    }
}

# Check for sandbox JS files NOT in live
$sandboxJsFiles = Get-ChildItem (Join-Path $sandbox "js") -Filter "*.js" | ForEach-Object { $_.Name }
foreach ($sjs in $sandboxJsFiles) {
    if ($sjs -notin $jsFiles -and $sjs -ne "08-app-clean.js") {
        Write-Host "  EXTRA in sandbox (not in live): js/$sjs" -ForegroundColor Magenta
    }
}

if (-not $hasDiffs) {
    Write-Host ""
    Write-Host "  Sandbox is IDENTICAL to live. Nothing to deploy." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "  Sandbox has changes. Review above, then run safe-deploy.ps1 to deploy." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Snapshot saved to: $liveDir" -ForegroundColor Cyan
Write-Host ""
