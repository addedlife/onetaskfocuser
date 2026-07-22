# BackSeatDriver — reopen a steering window.
#
# The window is normally opened once, by the SessionStart hook. Close it — deliberately
# or by mistake — and nothing brings it back until the next session starts, which is the
# one thing you cannot do without losing the context the window exists to protect.
#
#   .\reopen.ps1                 reopen for the session currently on screen
#   .\reopen.ps1 -SessionId <id> reopen for a specific engine session
#   .\reopen.ps1 -List           show sessions that could have one
#
# Deliberately NOT automatic: the drain hook could notice a missing window and respawn
# it after every tool call, but then closing it on purpose would be impossible.
[CmdletBinding()]
param([string]$SessionId, [switch]$List)

$ErrorActionPreference = 'Stop'

$StoreDir = Join-Path $env:APPDATA 'Claude\claude-code-sessions'
$SessDir  = Join-Path $env:USERPROFILE '.claude\sessions'
$Here     = $PSScriptRoot
$Utf8     = New-Object System.Text.UTF8Encoding($false)

# Match the real invocation form, not any command line that merely mentions the path --
# a shell running a search for that text would otherwise register as an open window and
# this script would refuse to reopen.
function Get-BsdWindows {
  param([string]$Session)
  $tail = if ($Session) { [regex]::Escape($Session) + '\b' } else { '\S+' }
  $rx = '-File\s+"?[^"]*backseat[\\/]window\.ps1"?\s+-SessionId\s+' + $tail
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -EA SilentlyContinue |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match $rx }
}

# Engine sessions with a live process — only these can receive steering at all.
$live = @{}
foreach ($f in Get-ChildItem (Join-Path $SessDir '*.json') -EA SilentlyContinue) {
  try {
    $j = Get-Content $f.FullName -Raw -EA Stop | ConvertFrom-Json
    if ($j.sessionId -and (Get-Process -Id $j.pid -EA SilentlyContinue)) { $live[$j.sessionId] = $true }
  } catch { }
}

# Store entries, newest-focused first, limited to sessions that are actually running.
$entries = @()
foreach ($f in (Get-ChildItem $StoreDir -Recurse -Filter 'local_*.json' -EA SilentlyContinue |
                Sort-Object LastWriteTime -Descending | Select-Object -First 40)) {
  try {
    $o = [System.IO.File]::ReadAllText($f.FullName) | ConvertFrom-Json
    if ($o.cliSessionId -and $live.ContainsKey($o.cliSessionId)) {
      $entries += [pscustomobject]@{
        Cli = $o.cliSessionId; Title = $o.title; Cwd = $o.cwd
        Focused = [double]($o.lastFocusedAt | ForEach-Object { if ($_) { $_ } else { 0 } })
      }
    }
  } catch { }
}
$entries = $entries | Sort-Object Focused -Descending

if ($List) {
  if (-not $entries) { Write-Host 'no live sessions found'; return }
  foreach ($e in $entries) {
    $has = Get-BsdWindows -Session $e.Cli
    $state = if ($has) { 'window open' } else { 'no window' }
    Write-Host ("{0}  {1,-44} {2}" -f $e.Cli.Substring(0,8), $e.Title, $state)
  }
  return
}

if (-not $SessionId) {
  if (-not $entries) { Write-Warning 'no live session found to reopen for'; return }
  $SessionId = $entries[0].Cli      # the one on screen
}

$existing = Get-BsdWindows -Session $SessionId
if ($existing) {
  Write-Host "a window is already open for $($SessionId.Substring(0,8)) (pid $($existing.ProcessId))"
  return
}

# Rebuild the state directory if it was cleaned up, so reopen works standalone rather
# than only as an undo for a window closed moments ago.
$root = Join-Path $env:USERPROFILE ".claude\backseat\$SessionId"
New-Item -ItemType Directory -Path (Join-Path $root 'inbox') -Force | Out-Null
Remove-Item (Join-Path $root 'dead') -Force -EA SilentlyContinue

if (-not (Test-Path (Join-Path $root 'meta.json'))) {
  $e = $entries | Where-Object { $_.Cli -eq $SessionId } | Select-Object -First 1
  $cwd = if ($e) { $e.Cwd } else { '' }
  # Transcript path mirrors the cwd with :, \, / and spaces all folded to '-'.
  $slug = ($cwd -replace '[:\\/ ]', '-')
  $tp   = Join-Path $env:USERPROFILE ".claude\projects\$slug\$SessionId.jsonl"
  $meta = [ordered]@{ sessionId = $SessionId; cwd = $cwd; transcriptPath = $tp; startedAt = 0 }
  [System.IO.File]::WriteAllText((Join-Path $root 'meta.json'), ($meta | ConvertTo-Json -Compress), $Utf8)
}

$win = Join-Path $Here 'window.ps1'
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$win`"", '-SessionId', $SessionId)

$title = ($entries | Where-Object { $_.Cli -eq $SessionId } | Select-Object -First 1).Title
# Built in two steps on purpose: PowerShell 5.1 cannot parse a double-quoted string
# containing a $(...) subexpression that itself contains double quotes.
$suffix = ''
if ($title) { $suffix = " - $title" }
Write-Host "reopened BackSeatDriver for $($SessionId.Substring(0,8))$suffix"
