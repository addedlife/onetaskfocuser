# safe-deploy.ps1 - The ONLY way to deploy OneTaskFocuser
# This script FORCES a sync check before deploying. It cannot be bypassed.
#
# What it does:
# 1. Downloads the LIVE deployed code from the internet
# 2. Compares it against your local sandbox/ files
# 3. Shows you EXACTLY what will change
# 4. Asks for confirmation
# 5. Deploys ONLY from sandbox/
# 6. Logs the deploy to DEPLOY_LOG.json so there is a permanent record

$ErrorActionPreference = "Stop"
$sandbox = $PSScriptRoot
$liveUrl = "https://onetaskfocuser.netlify.app"
$token = "nfc_sFsYCTMmnimttJVAVcw6fjvS6GR4mFreac04"
$siteId = "c603b156-f9ee-4b67-bcf4-d4b7f64fbccd"
$logFile = Join-Path $sandbox "DEPLOY_LOG.json"
$tempDir = "C:\Users\ydanz\deploy_staging"
$liveDir = Join-Path $sandbox "_live_snapshot"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "     SAFE DEPLOY - OneTaskFocuser       " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ================================================================
# PHASE 1: SYNC - Download live site and compare
# ================================================================
Write-Host "PHASE 1: Downloading live site for comparison..." -ForegroundColor Yellow

if (Test-Path $liveDir) { Remove-Item $liveDir -Recurse -Force }
New-Item -ItemType Directory -Path $liveDir | Out-Null
New-Item -ItemType Directory -Path (Join-Path $liveDir "js") | Out-Null

# Download live index.html
$indexPath = Join-Path $liveDir "index.html"
Invoke-WebRequest -Uri "$liveUrl/index.html" -OutFile $indexPath -UseBasicParsing

# Parse for JS files
$indexContent = Get-Content $indexPath -Raw
$liveJsFiles = [regex]::Matches($indexContent, 'src="js/([^"?]+)') | ForEach-Object { $_.Groups[1].Value }

# Download each
foreach ($js in $liveJsFiles) {
    $outPath = Join-Path $liveDir "js\$js"
    Invoke-WebRequest -Uri "$liveUrl/js/$js" -OutFile $outPath -UseBasicParsing
}

Write-Host "  Downloaded $($liveJsFiles.Count) JS files from live site." -ForegroundColor Green
Write-Host ""

# ================================================================
# PHASE 2: DIFF - Show exactly what will change
# ================================================================
Write-Host "PHASE 2: Comparing LIVE vs SANDBOX..." -ForegroundColor Yellow

$allFiles = @("index.html") + ($liveJsFiles | ForEach-Object { "js/$_" })
$changedFiles = @()
$identicalFiles = @()

foreach ($f in $allFiles) {
    $livePath = Join-Path $liveDir $f
    $sandboxPath = Join-Path $sandbox $f

    if (-not (Test-Path $sandboxPath)) {
        Write-Host "  !! MISSING in sandbox: $f" -ForegroundColor Red
        $changedFiles += $f
        continue
    }

    $liveHash = (Get-FileHash $livePath -Algorithm SHA256).Hash
    $sandboxHash = (Get-FileHash $sandboxPath -Algorithm SHA256).Hash

    if ($liveHash -eq $sandboxHash) {
        $identicalFiles += $f
    } else {
        $liveSize = (Get-Item $livePath).Length
        $sandboxSize = (Get-Item $sandboxPath).Length
        $sizeDiff = $sandboxSize - $liveSize
        if ($sizeDiff -gt 0) { $sizeStr = "+$sizeDiff bytes" } else { $sizeStr = "$sizeDiff bytes" }
        Write-Host "  CHANGED: $f ($sizeStr)" -ForegroundColor Yellow
        $changedFiles += $f
    }
}

# Check for files in sandbox index.html NOT in live
$sandboxIndexContent = Get-Content (Join-Path $sandbox "index.html") -Raw
$sandboxJsFiles = [regex]::Matches($sandboxIndexContent, 'src="js/([^"?]+)') | ForEach-Object { $_.Groups[1].Value }
$newFiles = $sandboxJsFiles | Where-Object { $_ -notin $liveJsFiles }
$removedFiles = $liveJsFiles | Where-Object { $_ -notin $sandboxJsFiles }

if ($newFiles.Count -gt 0) {
    Write-Host "  NEW FILES (adding to live): $($newFiles -join ', ')" -ForegroundColor Magenta
}
if ($removedFiles.Count -gt 0) {
    Write-Host "  REMOVED FROM LIVE: $($removedFiles -join ', ')" -ForegroundColor Magenta
}

Write-Host ""
Write-Host "  $($identicalFiles.Count) files identical, $($changedFiles.Count) files changed" -ForegroundColor Cyan

if ($changedFiles.Count -eq 0 -and $newFiles.Count -eq 0 -and $removedFiles.Count -eq 0) {
    Write-Host ""
    Write-Host "  Nothing to deploy - sandbox matches live exactly." -ForegroundColor Green
    exit 0
}

# ================================================================
# PHASE 3: CONFIRM - Human must say yes
# ================================================================
Write-Host ""
Write-Host "--- DEPLOY SUMMARY ---" -ForegroundColor Cyan
Write-Host "  Source:  $sandbox" -ForegroundColor White
Write-Host "  Target:  $liveUrl" -ForegroundColor White
Write-Host "  Changes: $($changedFiles -join ', ')" -ForegroundColor Yellow
if ($newFiles.Count -gt 0) { Write-Host "  Adding:  $($newFiles -join ', ')" -ForegroundColor Magenta }
if ($removedFiles.Count -gt 0) { Write-Host "  Removing: $($removedFiles -join ', ')" -ForegroundColor Magenta }
Write-Host ""

$confirm = Read-Host "Type YES to deploy, anything else to abort"
if ($confirm -ne "YES") {
    Write-Host ""
    Write-Host "  Deploy ABORTED." -ForegroundColor Red
    exit 1
}

# ================================================================
# PHASE 4: DEPLOY - From sandbox ONLY
# ================================================================
Write-Host ""
Write-Host "PHASE 4: Deploying from sandbox..." -ForegroundColor Yellow

if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempDir | Out-Null

# Copy ONLY from sandbox - never from legacy folder
Copy-Item (Join-Path $sandbox "index.html") "$tempDir\" -Force
Copy-Item (Join-Path $sandbox "netlify.toml") "$tempDir\" -Force
Copy-Item (Join-Path $sandbox "js") "$tempDir\js" -Recurse -Force
Copy-Item (Join-Path $sandbox "netlify") "$tempDir\netlify" -Recurse -Force
if (Test-Path (Join-Path $sandbox "shailos")) {
    Copy-Item (Join-Path $sandbox "shailos") "$tempDir\shailos" -Recurse -Force
}

# Remove non-deploy files from staging
$junkFiles = @("08-app-clean.js")
foreach ($junk in $junkFiles) {
    $junkPath = Join-Path $tempDir "js\$junk"
    if (Test-Path $junkPath) { Remove-Item $junkPath -Force }
}

# Build file digest map (Netlify SHA1 API)
$files = @{}
Get-ChildItem -Path $tempDir -Recurse -File | ForEach-Object {
    $relativePath = $_.FullName.Substring($tempDir.Length).Replace('\', '/')
    $hash = (Get-FileHash -Path $_.FullName -Algorithm SHA1).Hash.ToLower()
    $files[$relativePath] = $hash
}

Write-Host "  Files in deploy:" -ForegroundColor Green
$files.GetEnumerator() | Sort-Object Key | ForEach-Object { Write-Host "    $($_.Key)" }

# Create deploy
$body = @{ files = $files } | ConvertTo-Json -Depth 3
$headers = @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" }
$result = Invoke-RestMethod -Uri "https://api.netlify.com/api/v1/sites/$siteId/deploys" -Method Post -Headers $headers -Body $body
$deployId = $result.id
Write-Host "  Deploy ID: $deployId" -ForegroundColor Green
Write-Host "  Uploading $($result.required.Count) changed files..." -ForegroundColor Green

# Upload required files
foreach ($sha in $result.required) {
    $entry = $files.GetEnumerator() | Where-Object { $_.Value -eq $sha } | Select-Object -First 1
    if ($entry) {
        $filePath = Join-Path $tempDir ($entry.Key.Replace('/', '\'))
        $fileBytes = [System.IO.File]::ReadAllBytes($filePath)
        $uploadHeaders = @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/octet-stream" }
        Invoke-RestMethod -Uri "https://api.netlify.com/api/v1/deploys/$deployId/files$($entry.Key)" -Method Put -Headers $uploadHeaders -Body $fileBytes | Out-Null
        Write-Host "    Uploaded: $($entry.Key)" -ForegroundColor Green
    }
}

# Wait and verify
Start-Sleep 8
$check = Invoke-RestMethod -Uri "https://api.netlify.com/api/v1/deploys/$deployId" -Headers @{ "Authorization" = "Bearer $token" }
if ($check.state -eq "ready") {
    Write-Host ""
    Write-Host "  Deploy state: READY" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "  Deploy state: $($check.state)" -ForegroundColor Yellow
}

# Cleanup
Remove-Item $tempDir -Recurse -Force

# ================================================================
# PHASE 5: LOG - Record what was deployed
# ================================================================
$logEntry = @{
    timestamp = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
    deployId = $deployId
    state = $check.state
    changedFiles = $changedFiles
    newFiles = @($newFiles)
    removedFiles = @($removedFiles)
    fileHashes = @{}
}

# Record SHA256 of every file we deployed
foreach ($f in $allFiles) {
    $sp = Join-Path $sandbox $f
    if (Test-Path $sp) {
        $logEntry.fileHashes[$f] = (Get-FileHash $sp -Algorithm SHA256).Hash
    }
}

# Append to log
$log = @()
if (Test-Path $logFile) {
    $log = @(Get-Content $logFile -Raw | ConvertFrom-Json)
}
$log += $logEntry
$log | ConvertTo-Json -Depth 5 | Set-Content $logFile -Encoding UTF8

Write-Host ""
Write-Host "  Deploy logged to DEPLOY_LOG.json" -ForegroundColor Cyan
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "     DEPLOY COMPLETE                    " -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
