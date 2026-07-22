# BackSeatDriver — the steering window.
#
# A small always-on-top WPF panel, one per Claude Code session. Whatever is typed
# here is written to ~/.claude/backseat/<session>/inbox as a single .note file, which
# the PostToolUse hook picks up at the next tool boundary and folds into the running
# turn. One file per note so the drain never has to truncate a file the window might
# be writing to.
#
# WPF via PowerShell is deliberate: it ships with Windows, so this needs no runtime,
# no build step, and no install beyond copying files.
param(
  [Parameter(Mandatory = $true)][string]$SessionId
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
try { Add-Type -AssemblyName System.Xaml } catch { }

$Root     = Join-Path $env:USERPROFILE ".claude\backseat\$SessionId"
$Inbox    = Join-Path $Root 'inbox'
$MetaPath = Join-Path $Root 'meta.json'
$DeadPath = Join-Path $Root 'dead'
$Consumed = Join-Path $Root 'consumed.md'
$SessDir  = Join-Path $env:USERPROFILE '.claude\sessions'
$MainLog  = Join-Path $env:APPDATA 'Claude\logs\main.log'
$Utf8     = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path $Inbox)) { New-Item -ItemType Directory -Path $Inbox -Force | Out-Null }
[System.IO.File]::WriteAllText((Join-Path $Root 'window.pid'), "$PID", $Utf8)

$meta      = try { Get-Content $MetaPath -Raw -EA Stop | ConvertFrom-Json } catch { $null }
$projName  = if ($meta -and $meta.cwd) { Split-Path $meta.cwd -Leaf } else { '' }

# --- Title -------------------------------------------------------------------
# The title shown in the desktop side rail is stored SERVER-side (the sessions API);
# it is nowhere on disk, and get_session refuses to report the current session. What
# is local is the transcript, and the side-rail title is derived from its first user
# message — so that message is the honest local stand-in. Consequence worth knowing:
# renaming the session in the app will not move this header.
function Get-FirstUserMessage {
  param([string]$Path)
  if (-not $Path -or -not (Test-Path $Path)) { return $null }
  try {
    $sr = [System.IO.StreamReader]::new($Path)
    try {
      while ($null -ne ($line = $sr.ReadLine())) {
        if ($line -notmatch '"type":"user"') { continue }
        $j = $null
        try { $j = $line | ConvertFrom-Json } catch { continue }
        if (-not $j.message -or $j.isMeta) { continue }
        $c = $j.message.content
        $t = $null
        if ($c -is [string]) { $t = $c }
        elseif ($c) { $t = ($c | Where-Object { $_.type -eq 'text' } | Select-Object -First 1).text }
        # Skip hook/system injections, which arrive as user turns wrapped in tags.
        if ($t -and $t -notmatch '^\s*<') { return $t }
      }
    } finally { $sr.Dispose() }
  } catch { }
  return $null
}

$first = Get-FirstUserMessage ($(if ($meta) { $meta.transcriptPath } else { $null }))
if ($first) {
  $first = ($first -replace '\s+', ' ').Trim()
  if ($first.Length -gt 54) { $first = $first.Substring(0, 53).TrimEnd() + '…' }
  $headline = $first
} else {
  $headline = if ($projName) { $projName } else { 'Claude Code' }
}

[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="BackSeatDriver" Width="400" Height="252"
        WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        Topmost="True" ShowInTaskbar="False" ResizeMode="CanResize"
        WindowStartupLocation="Manual" MinWidth="300" MinHeight="180">
  <Border CornerRadius="10" Background="#FF16181C" BorderBrush="#FF2E333B" BorderThickness="1">
    <Grid Margin="14,11,14,12">
      <Grid.RowDefinitions>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="*"/>
        <RowDefinition Height="Auto"/>
      </Grid.RowDefinitions>

      <Grid Grid.Row="0" x:Name="DragBar" Background="Transparent">
        <TextBlock x:Name="TitleText" Text="Claude Code" Foreground="#FFE6E8EB"
                   FontFamily="Segoe UI" FontSize="13" FontWeight="SemiBold"
                   TextTrimming="CharacterEllipsis" Margin="0,0,28,0"/>
        <Border x:Name="CloseBtn" Width="24" Height="24" CornerRadius="6"
                Background="Transparent" HorizontalAlignment="Right"
                VerticalAlignment="Top" Margin="0,-4,-4,0" Cursor="Hand">
          <TextBlock x:Name="CloseGlyph" Text="&#215;" Foreground="#FF8A9099"
                     FontFamily="Segoe UI" FontSize="15"
                     HorizontalAlignment="Center" VerticalAlignment="Center"/>
        </Border>
      </Grid>

      <TextBlock Grid.Row="1" x:Name="SubText" Text="" Foreground="#FF767D87"
                 FontFamily="Segoe UI" FontSize="10.5" Margin="0,1,0,8"
                 TextTrimming="CharacterEllipsis"/>

      <Border Grid.Row="2" CornerRadius="7" Background="#FF1E2126"
              BorderBrush="#FF2E333B" BorderThickness="1">
        <TextBox x:Name="Input" Background="Transparent" Foreground="#FFE6E8EB"
                 CaretBrush="#FF16A394" BorderThickness="0" Padding="9,7,9,7"
                 FontFamily="Segoe UI" FontSize="12.5" AcceptsReturn="True"
                 TextWrapping="Wrap" VerticalScrollBarVisibility="Auto"
                 VerticalContentAlignment="Top"/>
      </Border>

      <Grid Grid.Row="3" Margin="0,9,0,0">
        <TextBlock x:Name="Status" Text="idle" Foreground="#FF767D87"
                   FontFamily="Segoe UI" FontSize="10.5" VerticalAlignment="Center"
                   TextTrimming="CharacterEllipsis" Margin="0,0,86,0"/>
        <Border x:Name="SendBtn" HorizontalAlignment="Right" CornerRadius="6"
                Background="#FF16A394" Padding="13,5,13,5" Cursor="Hand">
          <TextBlock Text="Send" Foreground="#FFFFFFFF" FontFamily="Segoe UI"
                     FontSize="11.5" FontWeight="SemiBold"/>
        </Border>
      </Grid>
    </Grid>
  </Border>
</Window>
'@

$win = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))

$TitleText  = $win.FindName('TitleText')
$SubText    = $win.FindName('SubText')
$InputBox   = $win.FindName('Input')
$Status     = $win.FindName('Status')
$SendBtn    = $win.FindName('SendBtn')
$CloseBtn   = $win.FindName('CloseBtn')
$CloseGlyph = $win.FindName('CloseGlyph')
$DragBar    = $win.FindName('DragBar')

$TitleText.Text = $headline
$TitleText.ToolTip = $headline
$SubText.Text = $projName

# Bottom-right, cascaded by a stable hash of the session id so several open sessions
# don't land their windows in exactly the same spot.
$wa = [System.Windows.SystemParameters]::WorkArea
$slot = 0
foreach ($c in $SessionId.ToCharArray()) { $slot = ($slot + [int]$c) % 6 }
$win.Left = $wa.Right  - $win.Width  - 22 - ($slot * 16)
$win.Top  = $wa.Bottom - $win.Height - 22 - ($slot * 34)

# PowerShell will not reliably coerce a hex string into a Brush on property assignment,
# so every runtime colour change goes through an explicit converter.
$BrushOf = @{}
$bc = [System.Windows.Media.BrushConverter]::new()
foreach ($hex in '#FFD9A441', '#FF16A394', '#FF767D87', '#FF3A2A2C', '#FFE06C75', '#FF8A9099', '#00FFFFFF') {
  $BrushOf[$hex] = $bc.ConvertFromString($hex)
}

$script:LastSent = $null

function Send-Note {
  $text = $InputBox.Text
  if ([string]::IsNullOrWhiteSpace($text)) { return }
  $name = '{0}-{1:x4}.note' -f [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(), (Get-Random -Max 65535)
  try {
    [System.IO.File]::WriteAllText((Join-Path $Inbox $name), $text.Trim(), $Utf8)
    $InputBox.Clear()
    $script:LastSent = Get-Date
  } catch {
    $Status.Text = "couldn't queue: $($_.Exception.Message)"
  }
}

$SendBtn.Add_MouseLeftButtonUp({ Send-Note })

# The close button must swallow MouseLeftButtonDown. Without that the event bubbles to
# DragBar, whose handler calls DragMove() — that captures the mouse and enters a modal
# drag loop, so the matching MouseUp never arrives and the × silently does nothing.
$CloseBtn.Add_MouseLeftButtonDown({ $_.Handled = $true })
$CloseBtn.Add_MouseLeftButtonUp({ $_.Handled = $true; $win.Close() })
$CloseBtn.Add_MouseEnter({
  $CloseBtn.Background   = $BrushOf['#FF3A2A2C']
  $CloseGlyph.Foreground = $BrushOf['#FFE06C75']
})
$CloseBtn.Add_MouseLeave({
  $CloseBtn.Background   = $BrushOf['#00FFFFFF']
  $CloseGlyph.Foreground = $BrushOf['#FF8A9099']
})

$DragBar.Add_MouseLeftButtonDown({ try { $win.DragMove() } catch { } })

# Ctrl+Enter sends; plain Enter stays a newline so multi-line steering is natural.
$InputBox.Add_PreviewKeyDown({
  if ($_.Key -eq 'Return' -and
      ([System.Windows.Input.Keyboard]::Modifiers -band [System.Windows.Input.ModifierKeys]::Control)) {
    Send-Note
    $_.Handled = $true
  }
})

# Recede a little when it isn't the focused window — it lives on top of everything.
$win.Add_Activated({   $win.Opacity = 1.0 })
$win.Add_Deactivated({ $win.Opacity = 0.72 })

# --- Liveness ----------------------------------------------------------------
# The engine writes ~/.claude/sessions/<pid>.json per session. If this session's entry
# is gone, or its pid is dead, the window is an orphan — SessionEnd never fires when
# the app is killed outright, so this is what actually closes it.
function Test-SessionAlive {
  foreach ($f in Get-ChildItem (Join-Path $SessDir '*.json') -EA SilentlyContinue) {
    $j = $null
    try { $j = Get-Content $f.FullName -Raw -EA Stop | ConvertFrom-Json } catch { continue }
    if ($j -and $j.sessionId -eq $SessionId) {
      return [bool](Get-Process -Id $j.pid -EA SilentlyContinue)
    }
  }
  return $null   # no entry found — indeterminate, not proof of death
}

# --- On-screen check ---------------------------------------------------------
# The app logs `ping internal session local_X to CLI session <engine uuid>`, which maps
# our engine session id to the app's internal one, and `setFocusedSession: sessionId=`
# whenever the visible session changes. Together those answer "is my session the one on
# screen right now". Tail only the end of the log — it is several MB and growing.
$script:LocalId = $null

function Read-LogTail {
  param([string]$Path, [int]$Bytes = 131072)
  if (-not (Test-Path $Path)) { return $null }
  try {
    # ReadWrite share is required: the app holds this file open for writing.
    $fs = [System.IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
    try {
      if ($fs.Length -gt $Bytes) { [void]$fs.Seek(-$Bytes, 'End') }
      $sr = [System.IO.StreamReader]::new($fs)
      return $sr.ReadToEnd()
    } finally { $fs.Dispose() }
  } catch { return $null }
}

function Test-SessionOnScreen {
  $tail = Read-LogTail $MainLog
  if (-not $tail) { return $null }

  if (-not $script:LocalId) {
    $m = [regex]::Matches($tail, "ping internal session (local_[0-9a-fA-F-]+) to CLI session $([regex]::Escape($SessionId))")
    if ($m.Count -gt 0) { $script:LocalId = $m[$m.Count - 1].Groups[1].Value }
  }
  if (-not $script:LocalId) { return $null }

  $f = [regex]::Matches($tail, 'setFocusedSession: sessionId=(local_[0-9a-fA-F-]+|null)')
  if ($f.Count -eq 0) { return $null }

  $last = $f[$f.Count - 1].Groups[1].Value
  # null shows up when the app blurs as well as when nothing is selected. Treating it
  # as "not on screen" would hide the window every time you alt-tab away, which defeats
  # the point of an always-on-top pad, so it is left indeterminate.
  if ($last -eq 'null') { return $null }
  return ($last -eq $script:LocalId)
}

$script:Ticks   = 0
$script:Missing = 0

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds(1)
$timer.Add_Tick({
  $script:Ticks++

  if (Test-Path $DeadPath) { $timer.Stop(); $win.Close(); return }

  # Liveness and focus are polled every other tick; both touch the filesystem.
  if ($script:Ticks % 2 -eq 0) {
    $alive = Test-SessionAlive
    if ($alive -eq $false) { $timer.Stop(); $win.Close(); return }
    if ($null -eq $alive) {
      # Tolerate a short indeterminate window at startup, then treat it as gone.
      $script:Missing++
      if ($script:Missing -gt 30) { $timer.Stop(); $win.Close(); return }
    } else {
      $script:Missing = 0
    }

    $onScreen = Test-SessionOnScreen
    if ($onScreen -eq $true -and $win.Visibility -ne 'Visible') {
      $win.Visibility = 'Visible'
      $win.Topmost = $true      # re-assert; it can be dropped while hidden
    } elseif ($onScreen -eq $false -and $win.Visibility -eq 'Visible') {
      $win.Visibility = 'Hidden'
    }
  }

  $pending = @(Get-ChildItem (Join-Path $Inbox '*.note') -EA SilentlyContinue).Count

  if ($pending -gt 0) {
    $noun = if ($pending -eq 1) { 'note' } else { 'notes' }
    $Status.Text = "$pending $noun waiting for the next tool call"
    $Status.Foreground = $BrushOf['#FFD9A441']
  }
  elseif (Test-Path $Consumed) {
    $t = (Get-Item $Consumed).LastWriteTime
    $Status.Text = "folded in at $($t.ToString('HH:mm:ss'))"
    $Status.Foreground = $BrushOf['#FF16A394']
  }
  elseif ($script:LastSent) {
    $Status.Text = 'queued'
    $Status.Foreground = $BrushOf['#FF767D87']
  }
  else {
    $Status.Text = 'idle — Ctrl+Enter to send'
    $Status.Foreground = $BrushOf['#FF767D87']
  }
})
$timer.Start()

$win.Add_Closed({
  $timer.Stop()
  try { Remove-Item (Join-Path $Root 'window.pid') -Force -EA SilentlyContinue } catch { }
})

$win.Add_ContentRendered({ $InputBox.Focus() | Out-Null })
$win.ShowDialog() | Out-Null
