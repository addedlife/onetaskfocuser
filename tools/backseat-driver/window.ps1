# BackSeatDriver — the steering window.
#
# A single always-on-top bar, one per Claude Code session. Type, press Enter, and the
# text is written to ~/.claude/backseat/<session>/inbox as one .note file, which the
# PostToolUse hook picks up at the next tool boundary and folds into the running turn.
# One file per note so the drain never has to truncate a file the window may be writing.
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
$StoreDir = Join-Path $env:APPDATA 'Claude\claude-code-sessions'
$Utf8     = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path $Inbox)) { New-Item -ItemType Directory -Path $Inbox -Force | Out-Null }
[System.IO.File]::WriteAllText((Join-Path $Root 'window.pid'), "$PID", $Utf8)

$meta     = try { Get-Content $MetaPath -Raw -EA Stop | ConvertFrom-Json } catch { $null }
$projName = if ($meta -and $meta.cwd) { Split-Path $meta.cwd -Leaf } else { '' }

# --- Session store ------------------------------------------------------------
# The desktop app keeps a JSON file per session at
#   %APPDATA%\Claude\claude-code-sessions\<accountId>\<orgId>\local_<uuid>.json
# holding the real side-rail `title`, and a `cliSessionId` that maps straight to the
# engine session id hooks are given. Authoritative local source for the header and for
# the on-screen check, so neither has to be inferred.
$script:StoreFile = $null

function Get-StoreFiles {
  Get-ChildItem $StoreDir -Recurse -Filter 'local_*.json' -EA SilentlyContinue |
    Sort-Object LastWriteTime -Descending
}

function Find-StoreFile {
  # A couple of hundred files live here, so substring-test the raw text before paying
  # for a JSON parse, newest-first — a session's own file is normally the newest.
  foreach ($f in Get-StoreFiles) {
    try {
      $txt = [System.IO.File]::ReadAllText($f.FullName)
      if ($txt -notmatch [regex]::Escape($SessionId)) { continue }
      $o = $txt | ConvertFrom-Json
      if ($o.cliSessionId -eq $SessionId) { return $f.FullName }
    } catch { continue }
  }
  return $null
}

function Read-Store {
  param([string]$Path)
  if (-not $Path -or -not (Test-Path $Path)) { return $null }
  try { return [System.IO.File]::ReadAllText($Path) | ConvertFrom-Json } catch { return $null }
}

# Fallback only — a pure CLI session has no store file. The side-rail title is derived
# from the first user message, so that message is the closest local stand-in.
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
        if ($t -and $t -notmatch '^\s*<') { return $t }
      }
    } finally { $sr.Dispose() }
  } catch { }
  return $null
}

function Format-Headline {
  param([string]$Text, [int]$Max = 30)
  if (-not $Text) { return $null }
  $t = ($Text -replace '\s+', ' ').Trim()
  if ($t.Length -gt $Max) { $t = $t.Substring(0, $Max - 1).TrimEnd() + [string][char]0x2026 }
  return $t
}

$script:StoreFile = Find-StoreFile
$fullTitle = $null
if ($script:StoreFile) { $fullTitle = (Read-Store $script:StoreFile).title }
if (-not $fullTitle) {
  $fullTitle = Get-FirstUserMessage ($(if ($meta) { $meta.transcriptPath } else { $null }))
}
if (-not $fullTitle) { $fullTitle = if ($projName) { $projName } else { 'Claude Code' } }

# --- Layout -------------------------------------------------------------------
# One bar, one row: title | input | status pill | close. There is no separate status
# line and no collapse toggle — at this height the window IS the collapsed bar, so a
# minimise would only ever hide the single thing it exists to show.
# Glyphs are XML entities so the XAML stays pure ASCII and survives a lost UTF-8 BOM.
[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="BackSeatDriver" Width="460" Height="48"
        WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        Topmost="True" ShowInTaskbar="False" ResizeMode="NoResize"
        WindowStartupLocation="Manual" SizeToContent="Manual">
  <Border x:Name="Shell" CornerRadius="9" Background="#FF16181C"
          BorderBrush="#FF2E333B" BorderThickness="1">
    <Grid Margin="11,0,7,0">
      <Grid.ColumnDefinitions>
        <ColumnDefinition Width="Auto"/>
        <ColumnDefinition Width="*"/>
        <ColumnDefinition Width="Auto"/>
        <ColumnDefinition Width="Auto"/>
      </Grid.ColumnDefinitions>

      <TextBlock Grid.Column="0" x:Name="TitleText" Text="" Foreground="#FF767D87"
                 FontFamily="Segoe UI" FontSize="11" VerticalAlignment="Center"
                 MaxWidth="150" TextTrimming="CharacterEllipsis" Margin="0,0,9,0"/>

      <Border Grid.Column="1" CornerRadius="6" Background="#FF1E2126"
              BorderBrush="#FF2E333B" BorderThickness="1" Height="30"
              VerticalAlignment="Center">
        <Grid>
          <TextBlock x:Name="Hint" Text="steer..." Foreground="#FF5A616B"
                     FontFamily="Segoe UI" FontSize="12.5" Margin="9,0,9,0"
                     VerticalAlignment="Center" IsHitTestVisible="False"/>
          <TextBox x:Name="Input" Background="Transparent" Foreground="#FFE6E8EB"
                   CaretBrush="#FF16A394" BorderThickness="0" Padding="8,0,8,0"
                   FontFamily="Segoe UI" FontSize="12.5" AcceptsReturn="False"
                   VerticalContentAlignment="Center"/>
        </Grid>
      </Border>

      <TextBlock Grid.Column="2" x:Name="Pill" Text="" Foreground="#FFD9A441"
                 FontFamily="Segoe UI" FontSize="11.5" FontWeight="SemiBold"
                 VerticalAlignment="Center" Margin="8,0,2,0"/>

      <Border Grid.Column="3" x:Name="CloseBtn" Width="24" Height="24" CornerRadius="6"
              Background="Transparent" Cursor="Hand" VerticalAlignment="Center"
              Margin="4,0,0,0">
        <TextBlock x:Name="CloseGlyph" Text="&#215;" Foreground="#FF8A9099"
                   FontFamily="Segoe UI" FontSize="15"
                   HorizontalAlignment="Center" VerticalAlignment="Center"/>
      </Border>
    </Grid>
  </Border>
</Window>
'@

$win = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))

$Shell      = $win.FindName('Shell')
$TitleText  = $win.FindName('TitleText')
$InputBox   = $win.FindName('Input')
$Hint       = $win.FindName('Hint')
$Pill       = $win.FindName('Pill')
$CloseBtn   = $win.FindName('CloseBtn')
$CloseGlyph = $win.FindName('CloseGlyph')

$TitleText.Text    = Format-Headline $fullTitle
$TitleText.ToolTip = $fullTitle
$win.ToolTip       = $fullTitle

# Bottom-right, cascaded by a stable hash of the session id so several open sessions
# don't land their bars in exactly the same spot.
$wa = [System.Windows.SystemParameters]::WorkArea
$slot = 0
foreach ($c in $SessionId.ToCharArray()) { $slot = ($slot + [int]$c) % 6 }
$win.Left = $wa.Right  - $win.Width - 22
$win.Top  = $wa.Bottom - $win.Height - 22 - ($slot * 58)

# PowerShell will not reliably coerce a hex string into a Brush on property assignment,
# so every runtime colour change goes through an explicit converter.
$BrushOf = @{}
$bc = [System.Windows.Media.BrushConverter]::new()
foreach ($hex in '#FFD9A441', '#FF16A394', '#FF767D87', '#FF3A2A2C', '#FFE06C75',
                 '#FF8A9099', '#00FFFFFF') {
  $BrushOf[$hex] = $bc.ConvertFromString($hex)
}

$script:FoldedAt     = $null
$script:LastConsumed = if (Test-Path $Consumed) { (Get-Item $Consumed).LastWriteTimeUtc } else { $null }

function Send-Note {
  $text = $InputBox.Text
  if ([string]::IsNullOrWhiteSpace($text)) { return }
  $name = '{0}-{1:x4}.note' -f [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(), (Get-Random -Max 65535)
  try {
    [System.IO.File]::WriteAllText((Join-Path $Inbox $name), $text.Trim(), $Utf8)
    $InputBox.Clear()
  } catch {
    $Pill.Text = '!'
    $Pill.ToolTip = "couldn't queue: $($_.Exception.Message)"
  }
}

# Enter sends. The box is single-line (AcceptsReturn="False"), so Enter has no other job.
$InputBox.Add_PreviewKeyDown({
  if ($_.Key -eq 'Return') { Send-Note; $_.Handled = $true }
})
# Placeholder shows only while the box is empty.
$InputBox.Add_TextChanged({
  $Hint.Visibility = if ($InputBox.Text.Length -gt 0) { 'Collapsed' } else { 'Visible' }
})

# Same swallow as before: without it DragMove() captures the mouse and the matching
# MouseUp never arrives, so the button silently does nothing.
$CloseBtn.Add_MouseLeftButtonDown({ $_.Handled = $true })
$CloseBtn.Add_MouseLeftButtonUp({ $_.Handled = $true; Write-Life 'closed by user (x)'; $win.Close() })
$CloseBtn.Add_MouseEnter({
  $CloseBtn.Background   = $BrushOf['#FF3A2A2C']
  $CloseGlyph.Foreground = $BrushOf['#FFE06C75']
})
$CloseBtn.Add_MouseLeave({
  $CloseBtn.Background   = $BrushOf['#00FFFFFF']
  $CloseGlyph.Foreground = $BrushOf['#FF8A9099']
})

# There is no title bar left to grab, so the shell itself is the drag handle. The TextBox
# handles its own mouse-down for the caret, so dragging never starts from inside it.
$Shell.Add_MouseLeftButtonDown({ try { $win.DragMove() } catch { } })

# Recede a little when it isn't the focused window — it lives on top of everything.
$win.Add_Activated({   $win.Opacity = 1.0 })
$win.Add_Deactivated({ $win.Opacity = 0.72 })

# --- Liveness ----------------------------------------------------------------
# The engine writes ~/.claude/sessions/<pid>.json per session. If this session's entry
# is gone, or its pid is dead, the window is an orphan — SessionEnd never fires when the
# app is killed outright, so this is what actually closes it.
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
# The visible session is whichever store file holds the highest `lastFocusedAt`. Only
# the most recently written can hold that maximum, so the scan is bounded.
function Test-SessionOnScreen {
  if (-not $script:StoreFile) { return $null }
  $me = Read-Store $script:StoreFile
  if (-not $me -or -not $me.lastFocusedAt) { return $null }

  $max = [double]$me.lastFocusedAt
  foreach ($f in (Get-StoreFiles | Select-Object -First 12)) {
    if ($f.FullName -eq $script:StoreFile) { continue }
    $o = Read-Store $f.FullName
    if ($o -and $o.lastFocusedAt -and ([double]$o.lastFocusedAt) -gt $max) {
      $max = [double]$o.lastFocusedAt
    }
  }
  return ([double]$me.lastFocusedAt -ge $max)
}

$script:Ticks   = 0
$script:Missing = 0
$script:Shown   = $true   # set before the timer starts, so the first tick sees it

# Every path that can end this window records why. A window that vanishes with no
# explanation is otherwise indistinguishable from one that crashed.
function Write-Life {
  param([string]$Reason)
  try {
    [System.IO.File]::AppendAllText(
      (Join-Path $Root 'window-life.log'),
      ('[{0}] tick {1}: {2}{3}' -f (Get-Date -Format 'HH:mm:ss'), $script:Ticks, $Reason, [Environment]::NewLine),
      $Utf8)
  } catch { }
}
Write-Life "opened (pid $PID)"

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds(1)

# An unhandled exception inside a WPF dispatcher callback terminates the process
# outright — no stderr, no exit code, the window just vanishes. With
# $ErrorActionPreference = 'Stop' any non-terminating error in here becomes exactly
# that, so the whole tick body is wrapped and anything unexpected is logged instead.
$timer.Add_Tick({
 try {
  $script:Ticks++

  if (Test-Path $DeadPath) { Write-Life 'dead marker present'; $timer.Stop(); $win.Close(); return }

  # Liveness and focus are polled every other tick; both touch the filesystem.
  if ($script:Ticks % 2 -eq 0) {
    $alive = Test-SessionAlive
    if ($alive -eq $false) { Write-Life 'session process is gone'; $timer.Stop(); $win.Close(); return }
    if ($null -eq $alive) {
      # Tolerate a short indeterminate window at startup, then treat it as gone.
      $script:Missing++
      if ($script:Missing -gt 30) { Write-Life 'no session entry for 60s'; $timer.Stop(); $win.Close(); return }
    } else {
      $script:Missing = 0
    }

    # The store file may not exist yet when the window opens; keep looking until it does.
    if (-not $script:StoreFile -and $script:Ticks % 10 -eq 0) {
      $script:StoreFile = Find-StoreFile
    }

    $onScreen = Test-SessionOnScreen
    if ($onScreen -eq $true -and -not $script:Shown) {
      $win.Show()
      $win.Topmost = $true      # re-assert; it can be dropped while hidden
      $script:Shown = $true
    } elseif ($onScreen -eq $false -and $script:Shown) {
      $win.Hide()
      $script:Shown = $false
    }

    # Follow renames — the store title is the same one shown in the side rail.
    if ($script:StoreFile -and $script:Ticks % 6 -eq 0) {
      $t = (Read-Store $script:StoreFile).title
      if ($t -and $t -ne $win.ToolTip) {
        $win.ToolTip       = $t
        $TitleText.ToolTip = $t
        $TitleText.Text    = Format-Headline $t
      }
    }
  }

  # One pill carries all the feedback there is room for: a count while notes wait, then
  # a brief tick once they have been folded into the turn.
  if (Test-Path $Consumed) {
    $mt = (Get-Item $Consumed).LastWriteTimeUtc
    if ($script:LastConsumed -and $mt -gt $script:LastConsumed) { $script:FoldedAt = Get-Date }
    $script:LastConsumed = $mt
  }

  $pending = @(Get-ChildItem (Join-Path $Inbox '*.note') -EA SilentlyContinue).Count
  if ($pending -gt 0) {
    $Pill.Text       = [string]$pending
    $Pill.Foreground = $BrushOf['#FFD9A441']
    $Pill.ToolTip    = 'waiting for the next tool call'
  } elseif ($script:FoldedAt -and ((Get-Date) - $script:FoldedAt).TotalSeconds -lt 6) {
    $Pill.Text       = [string][char]0x2713
    $Pill.Foreground = $BrushOf['#FF16A394']
    $Pill.ToolTip    = "folded in at $($script:FoldedAt.ToString('HH:mm:ss'))"
  } else {
    $Pill.Text    = ''
    $Pill.ToolTip = $null
  }
 } catch {
   try {
     $msg = '[{0}] tick {1}: {2}: {3}{4}    at line {5}: {6}{4}' -f `
       (Get-Date -Format 'HH:mm:ss'), $script:Ticks, $_.Exception.GetType().Name,
       $_.Exception.Message, [Environment]::NewLine,
       $_.InvocationInfo.ScriptLineNumber, $_.InvocationInfo.Line.Trim()
     [System.IO.File]::AppendAllText((Join-Path $Root 'window-error.log'), $msg, $Utf8)
   } catch { }
 }
})
$timer.Start()

$win.Add_Closed({
  $timer.Stop()
  try { Remove-Item (Join-Path $Root 'window.pid') -Force -EA SilentlyContinue } catch { }
  [System.Windows.Threading.Dispatcher]::CurrentDispatcher.InvokeShutdown()
})

$win.Add_ContentRendered({ $InputBox.Focus() | Out-Null })

# Show() + a dispatcher loop, deliberately NOT ShowDialog(). ShowDialog is modal, and
# hiding a modal window ends its dialog loop — so the first time this window hid itself
# because another session was on screen, ShowDialog returned, the script ran off the end
# and the process exited. Silently: no error, no exit code, the window never came back.
$script:Shown = $true
$win.Show()
[System.Windows.Threading.Dispatcher]::Run()
