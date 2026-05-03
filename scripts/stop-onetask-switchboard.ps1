$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$stateDir = Join-Path $repo ".launcher"
$pidFile = Join-Path $stateDir "onetask-switchboard.pid"
$urlFile = Join-Path $stateDir "onetask-switchboard.url"

if (-not (Test-Path $pidFile)) {
    Write-Host "OneTask Switchboard tester is not running."
    exit 0
}

$pidText = (Get-Content $pidFile -Raw).Trim()
if ($pidText -match "^\d+$") {
    $process = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue
    if ($process) {
        Stop-Process -Id $process.Id -Force
        Write-Host "Stopped OneTask Switchboard tester."
    } else {
        Write-Host "OneTask Switchboard tester process was already gone."
    }
}

Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $urlFile -Force -ErrorAction SilentlyContinue
