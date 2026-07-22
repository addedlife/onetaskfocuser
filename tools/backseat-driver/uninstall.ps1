# BackSeatDriver — uninstaller.
#
# Removes only the hook groups whose command path points into
# ~/.claude/hooks/backseat, so any other hooks in settings.json survive untouched.
# Backs settings.json up first, same as the installer.
[CmdletBinding()]
param([switch]$KeepScripts)

$ErrorActionPreference = 'Stop'

$dst      = Join-Path $env:USERPROFILE '.claude\hooks\backseat'
$settings = Join-Path $env:USERPROFILE '.claude\settings.json'
$state    = Join-Path $env:USERPROFILE '.claude\backseat'
$marker   = '/.claude/hooks/backseat/'

if (Test-Path $settings) {
  $backup = "$settings.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
  Copy-Item $settings $backup -Force
  Write-Host "backed up settings -> $backup"

  $cfg = Get-Content $settings -Raw | ConvertFrom-Json
  if ($cfg.PSObject.Properties.Name -contains 'hooks') {
    foreach ($evt in @($cfg.hooks.PSObject.Properties.Name)) {
      $kept = @($cfg.hooks.$evt) | Where-Object {
        $cmds = @($_.hooks | ForEach-Object { $_.command })
        -not ($cmds -match [regex]::Escape($marker))
      }
      if ($kept.Count -eq 0) {
        $cfg.hooks.PSObject.Properties.Remove($evt)
      } else {
        $cfg.hooks.$evt = $kept
      }
    }
    if (@($cfg.hooks.PSObject.Properties.Name).Count -eq 0) {
      $cfg.PSObject.Properties.Remove('hooks')
    }
  }
  $cfg | ConvertTo-Json -Depth 12 | Set-Content $settings -Encoding utf8
  Write-Host "removed BackSeatDriver hooks from $settings"
}

# Any window still on screen belongs to a session that no longer has a drain behind it.
Get-ChildItem (Join-Path $state '*\window.pid') -EA SilentlyContinue | ForEach-Object {
  $wpid = (Get-Content $_.FullName -EA SilentlyContinue)
  if ($wpid) { Stop-Process -Id $wpid -Force -EA SilentlyContinue }
}

if (-not $KeepScripts) {
  Remove-Item $dst -Recurse -Force -EA SilentlyContinue
  Write-Host "removed $dst"
}

Write-Host 'BackSeatDriver uninstalled. State under ~/.claude/backseat was left in place;'
Write-Host 'delete it by hand if you want the archived steering logs gone too.'
