# BackSeatDriver — installer.
#
# Copies the hook scripts to ~/.claude/hooks/backseat and registers four hooks in the
# GLOBAL settings file, so BackSeatDriver runs in every Claude Code session on this
# machine rather than only in the repo it happens to live in.
#
# Idempotent: re-running replaces the BackSeatDriver entries and leaves every other
# hook alone. settings.json is backed up next to itself before it is touched.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$src      = $PSScriptRoot
$dst      = Join-Path $env:USERPROFILE '.claude\hooks\backseat'
$settings = Join-Path $env:USERPROFILE '.claude\settings.json'

New-Item -ItemType Directory -Path $dst -Force | Out-Null
foreach ($f in 'lib.sh', 'start.sh', 'drain.sh', 'stop.sh', 'end.sh', 'window.ps1') {
  Copy-Item (Join-Path $src $f) (Join-Path $dst $f) -Force
}
Write-Host "copied scripts -> $dst"

# Hooks run under Git Bash, which reads C:/... happily but not C:\...
$bashDst = ($dst -replace '\\', '/')

function New-HookGroup {
  param([string]$Script, [int]$Timeout, [string]$Matcher)
  $entry = [ordered]@{
    type    = 'command'
    command = "$bashDst/$Script"
    timeout = $Timeout
  }
  $group = [ordered]@{}
  if ($Matcher) { $group['matcher'] = $Matcher }
  $group['hooks'] = @([pscustomobject]$entry)
  [pscustomobject]$group
}

# Everything BackSeatDriver owns is identifiable by this substring in the command path,
# which is what makes the install idempotent and the uninstall surgical.
$marker = '/.claude/hooks/backseat/'

function Merge-Event {
  param($HooksObj, [string]$EventName, $NewGroup)
  $existing = @()
  if ($HooksObj.PSObject.Properties.Name -contains $EventName) {
    $existing = @($HooksObj.$EventName) | Where-Object {
      $cmds = @($_.hooks | ForEach-Object { $_.command })
      -not ($cmds -match [regex]::Escape($marker))
    }
  }
  $merged = @($existing) + @($NewGroup)
  if ($HooksObj.PSObject.Properties.Name -contains $EventName) {
    $HooksObj.$EventName = $merged
  } else {
    $HooksObj | Add-Member -NotePropertyName $EventName -NotePropertyValue $merged
  }
}

if (Test-Path $settings) {
  $backup = "$settings.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
  Copy-Item $settings $backup -Force
  Write-Host "backed up settings -> $backup"
  $cfg = Get-Content $settings -Raw | ConvertFrom-Json
} else {
  $cfg = [pscustomobject]@{}
}

if (-not ($cfg.PSObject.Properties.Name -contains 'hooks')) {
  $cfg | Add-Member -NotePropertyName 'hooks' -NotePropertyValue ([pscustomobject]@{})
}

Merge-Event $cfg.hooks 'SessionStart' (New-HookGroup -Script 'start.sh' -Timeout 20 -Matcher $null)
Merge-Event $cfg.hooks 'PostToolUse'  (New-HookGroup -Script 'drain.sh' -Timeout 10 -Matcher '*')
Merge-Event $cfg.hooks 'Stop'         (New-HookGroup -Script 'stop.sh'  -Timeout 10 -Matcher $null)
Merge-Event $cfg.hooks 'SessionEnd'   (New-HookGroup -Script 'end.sh'   -Timeout 10 -Matcher $null)

$cfg | ConvertTo-Json -Depth 12 |
  Set-Content $settings -Encoding utf8

Write-Host "registered SessionStart / PostToolUse / Stop / SessionEnd in $settings"
Write-Host ''
Write-Host 'BackSeatDriver installed. Hooks load at session start, so this takes effect'
Write-Host 'in the NEXT Claude Code session, not the one running now.'
