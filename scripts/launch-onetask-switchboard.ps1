param(
    [switch]$NoOpen
)

$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$stateDir = Join-Path $repo ".launcher"
$pidFile = Join-Path $stateDir "onetask-switchboard.pid"
$urlFile = Join-Path $stateDir "onetask-switchboard.url"
$logFile = Join-Path $stateDir "onetask-switchboard.log"
$errFile = Join-Path $stateDir "onetask-switchboard.err.log"

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

function Test-PortOpen {
    param([int]$Port)
    try {
        $client = [System.Net.Sockets.TcpClient]::new()
        $result = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        $open = $result.AsyncWaitHandle.WaitOne(150)
        if ($open) { $client.EndConnect($result) }
        $client.Close()
        return $open
    } catch {
        return $false
    }
}

if (Test-Path $pidFile) {
    $oldPid = (Get-Content $pidFile -Raw).Trim()
    if ($oldPid -match "^\d+$") {
        $oldProcess = Get-Process -Id ([int]$oldPid) -ErrorAction SilentlyContinue
        if ($oldProcess) {
            $existingUrl = if (Test-Path $urlFile) { (Get-Content $urlFile -Raw).Trim() } else { "http://127.0.0.1:3002/?suite=switchboard" }
            if (-not $NoOpen) { Start-Process $existingUrl }
            Write-Host "OneTask Switchboard tester is already running: $existingUrl"
            exit 0
        }
    }
}

$ports = @(3002, 3000, 5173, 5174, 5175)
$port = $ports | Where-Object { -not (Test-PortOpen $_) } | Select-Object -First 1
if (-not $port) {
    throw "No free local preview port found. Tried: $($ports -join ', ')"
}

$url = "http://127.0.0.1:$port/?suite=switchboard"
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) {
    $npmCommand = Get-Command npm -ErrorAction Stop
}
$npm = $npmCommand.Source

$args = @("run", "dev", "--", "--host", "127.0.0.1", "--port", "$port", "--strictPort")
$process = Start-Process -FilePath $npm `
    -ArgumentList $args `
    -WorkingDirectory $repo `
    -WindowStyle Hidden `
    -RedirectStandardOutput $logFile `
    -RedirectStandardError $errFile `
    -PassThru

Set-Content -Path $pidFile -Value $process.Id -Encoding ASCII
Set-Content -Path $urlFile -Value $url -Encoding ASCII

$deadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $deadline) {
    if (Test-PortOpen $port) { break }
    Start-Sleep -Milliseconds 250
}

if (-not (Test-PortOpen $port)) {
    throw "OneTask Switchboard tester did not start on port $port. See $errFile"
}

if (-not $NoOpen) {
    Start-Process $url
}

Write-Host "OneTask Switchboard tester running: $url"
