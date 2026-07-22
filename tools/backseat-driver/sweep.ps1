# BackSeatDriver — close orphaned steering windows.
#
# Windows are normally shut down through their session's `dead` marker or the liveness
# check. Neither reaches a window left over from an older build of window.ps1, or one
# whose state directory was deleted out from under it — it has nothing left to poll and
# no working close button, so it simply sits on screen forever.
#
# This finds them by COMMAND LINE rather than by pid file, which is the only method that
# works when the state directory is gone.
#
#   .\sweep.ps1            close windows with no live session behind them
#   .\sweep.ps1 -All       close every BackSeatDriver window
#   .\sweep.ps1 -WhatIf    list what would be closed, change nothing
[CmdletBinding()]
param([switch]$All, [switch]$WhatIf)

$ErrorActionPreference = 'Stop'
$SessDir = Join-Path $env:USERPROFILE '.claude\sessions'

# Engine sessions that are actually running right now.
$live = @{}
foreach ($f in Get-ChildItem (Join-Path $SessDir '*.json') -EA SilentlyContinue) {
  try {
    $j = Get-Content $f.FullName -Raw -EA Stop | ConvertFrom-Json
    if ($j.sessionId -and (Get-Process -Id $j.pid -EA SilentlyContinue)) { $live[$j.sessionId] = $true }
  } catch { }
}

$windows = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -EA SilentlyContinue |
  Where-Object { $_.CommandLine -like '*backseat*window.ps1*' }

if (-not $windows) { Write-Host 'no BackSeatDriver windows running'; return }

foreach ($w in $windows) {
  $sid = if ($w.CommandLine -match '-SessionId\s+(\S+)') { $Matches[1] } else { '<unknown>' }
  $orphan = -not $live.ContainsKey($sid)
  $act = $All -or $orphan
  $why = if ($orphan) { 'no live session' } else { 'session is live' }

  if (-not $act) {
    Write-Host ("keep  pid={0,-6} {1}  ({2})" -f $w.ProcessId, $sid.Substring(0, [Math]::Min(8, $sid.Length)), $why)
    continue
  }
  if ($WhatIf) {
    Write-Host ("would close  pid={0,-6} {1}  ({2})" -f $w.ProcessId, $sid.Substring(0, [Math]::Min(8, $sid.Length)), $why)
    continue
  }
  Stop-Process -Id $w.ProcessId -Force -EA SilentlyContinue
  Write-Host ("closed  pid={0,-6} {1}  ({2})" -f $w.ProcessId, $sid.Substring(0, [Math]::Min(8, $sid.Length)), $why)

  # Drop the stale pid file so the next SessionStart doesn't think a window is alive.
  $pf = Join-Path $env:USERPROFILE ".claude\backseat\$sid\window.pid"
  Remove-Item $pf -Force -EA SilentlyContinue
}
