# BackSeatDriver — the steering window.
#
# Two states in one always-on-top window, one per Claude Code session:
#   collapsed  a 46px chip with a steering-wheel icon, badged with the pending count
#   expanded   a 460x66 bar: session title above, single-line input below
# Click the chip to expand; the minus button collapses it again. It stays expanded until
# you collapse it — sending does not put it away.
#
# Type, press Enter, and the text is written to ~/.claude/backseat/<session>/inbox as one
# .note file, which the PostToolUse hook picks up at the next tool boundary and folds into
# the running turn. One file per note so the drain never truncates a file being written.
#
# WPF via PowerShell is deliberate: it ships with Windows, so this needs no runtime, no
# build step, and no install beyond copying files.
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
$UiPath   = Join-Path $Root 'ui.json'
$DeadPath = Join-Path $Root 'dead'
$Consumed = Join-Path $Root 'consumed.md'
$SessDir  = Join-Path $env:USERPROFILE '.claude\sessions'
$StoreDir = Join-Path $env:APPDATA 'Claude\claude-code-sessions'
$Utf8     = New-Object System.Text.UTF8Encoding($false)

$BarW = 460; $BarH = 66; $ChipW = 46; $ChipH = 46

if (-not (Test-Path $Inbox)) { New-Item -ItemType Directory -Path $Inbox -Force | Out-Null }
[System.IO.File]::WriteAllText((Join-Path $Root 'window.pid'), "$PID", $Utf8)

$meta     = try { Get-Content $MetaPath -Raw -EA Stop | ConvertFrom-Json } catch { $null }
$projName = if ($meta -and $meta.cwd) { Split-Path $meta.cwd -Leaf } else { '' }
$ui       = try { Get-Content $UiPath -Raw -EA Stop | ConvertFrom-Json } catch { $null }

# --- Session store ------------------------------------------------------------
# The desktop app keeps a JSON file per session at
#   %APPDATA%\Claude\claude-code-sessions\<accountId>\<orgId>\local_<uuid>.json
# holding the real side-rail `title`, and a `cliSessionId` mapping straight to the engine
# session id hooks are given. Authoritative local source for the header and the on-screen
# check, so neither has to be inferred.
$script:StoreFile = $null

function Get-StoreFiles {
  Get-ChildItem $StoreDir -Recurse -Filter 'local_*.json' -EA SilentlyContinue |
    Sort-Object LastWriteTime -Descending
}

function Find-StoreFile {
  # A couple of hundred files live here, so substring-test the raw text before paying for
  # a JSON parse, newest-first — a session's own file is normally the newest.
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

# Fallback only — a pure CLI session has no store file. The side-rail title is derived from
# the first user message, so that message is the closest local stand-in.
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
  param([string]$Text, [int]$Max = 52)
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
# Chip and bar are siblings in one Grid; only one is ever visible, and the window resizes
# to match. Resizing is not cosmetic: with AllowsTransparency the window's whole rectangle
# still swallows clicks, so leaving it bar-sized while showing the chip would block a
# 460x66 patch of whatever is underneath.
# The wheel is drawn from primitives and the glyphs are XML entities, so the XAML needs no
# image assets and stays pure ASCII — proof against a lost UTF-8 BOM.
[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="BackSeatDriver" Width="460" Height="66"
        WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        Topmost="True" ShowInTaskbar="False" ResizeMode="NoResize"
        WindowStartupLocation="Manual" SizeToContent="Manual">
  <Grid>

    <Border x:Name="Chip" Width="46" Height="46" CornerRadius="23"
            Background="#FF16181C" BorderBrush="#FF2E333B" BorderThickness="1"
            HorizontalAlignment="Right" VerticalAlignment="Bottom"
            Cursor="Hand" Visibility="Collapsed" ToolTip="Open BackSeatDriver">
      <Grid>
        <Canvas Width="24" Height="24" HorizontalAlignment="Center" VerticalAlignment="Center">
          <Ellipse Canvas.Left="1.6" Canvas.Top="1.6" Width="20.8" Height="20.8"
                   Stroke="#FF16A394" StrokeThickness="1.7"/>
          <Ellipse Canvas.Left="8.5" Canvas.Top="8.5" Width="7" Height="7"
                   Stroke="#FF16A394" StrokeThickness="1.7"/>
          <Line X1="12" Y1="8.5" X2="12" Y2="1.8" Stroke="#FF16A394" StrokeThickness="1.7"/>
          <Line X1="8.97" Y1="13.75" X2="3.5" Y2="16.9" Stroke="#FF16A394" StrokeThickness="1.7"/>
          <Line X1="15.03" Y1="13.75" X2="20.5" Y2="16.9" Stroke="#FF16A394" StrokeThickness="1.7"/>
        </Canvas>
        <Border x:Name="ChipBadge" Width="17" Height="17" CornerRadius="8.5"
                Background="#FFD9A441" HorizontalAlignment="Right" VerticalAlignment="Top"
                Margin="0,1,1,0" Visibility="Collapsed">
          <TextBlock x:Name="ChipBadgeText" Text="" Foreground="#FF16181C"
                     FontFamily="Segoe UI" FontSize="9.5" FontWeight="Bold"
                     HorizontalAlignment="Center" VerticalAlignment="Center"/>
        </Border>
      </Grid>
    </Border>

    <Border x:Name="Shell" CornerRadius="9" Background="#FF16181C"
            BorderBrush="#FF2E333B" BorderThickness="1">
      <Grid Margin="11,4,6,7">
        <Grid.RowDefinitions>
          <RowDefinition Height="Auto"/>
          <RowDefinition Height="*"/>
        </Grid.RowDefinitions>

        <Grid Grid.Row="0">
          <TextBlock x:Name="TitleText" Text="" Foreground="#FF767D87"
                     FontFamily="Segoe UI" FontSize="10.5" VerticalAlignment="Center"
                     HorizontalAlignment="Left" TextTrimming="CharacterEllipsis"
                     Margin="1,0,80,0"/>
          <StackPanel Orientation="Horizontal" HorizontalAlignment="Right"
                      VerticalAlignment="Center">
            <TextBlock x:Name="Pill" Text="" Foreground="#FFD9A441"
                       FontFamily="Segoe UI" FontSize="11" FontWeight="SemiBold"
                       VerticalAlignment="Center" Margin="0,0,6,0"/>
            <Border x:Name="MinBtn" Width="20" Height="20" CornerRadius="5"
                    Background="Transparent" Cursor="Hand" ToolTip="Collapse to a chip">
              <TextBlock x:Name="MinGlyph" Text="&#8722;" Foreground="#FF8A9099"
                         FontFamily="Segoe UI" FontSize="14"
                         HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <Border x:Name="CloseBtn" Width="20" Height="20" CornerRadius="5"
                    Background="Transparent" Cursor="Hand" Margin="2,0,0,0">
              <TextBlock x:Name="CloseGlyph" Text="&#215;" Foreground="#FF8A9099"
                         FontFamily="Segoe UI" FontSize="14"
                         HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
          </StackPanel>
        </Grid>

        <Border Grid.Row="1" CornerRadius="6" Background="#FF1E2126"
                BorderBrush="#FF2E333B" BorderThickness="1" Height="30"
                VerticalAlignment="Bottom" Margin="0,4,1,0">
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
      </Grid>
    </Border>

  </Grid>
</Window>
'@

$win = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))

$Shell         = $win.FindName('Shell')
$Chip          = $win.FindName('Chip')
$ChipBadge     = $win.FindName('ChipBadge')
$ChipBadgeText = $win.FindName('ChipBadgeText')
$TitleText     = $win.FindName('TitleText')
$InputBox      = $win.FindName('Input')
$Hint          = $win.FindName('Hint')
$Pill          = $win.FindName('Pill')
$MinBtn        = $win.FindName('MinBtn')
$MinGlyph      = $win.FindName('MinGlyph')
$CloseBtn      = $win.FindName('CloseBtn')
$CloseGlyph    = $win.FindName('CloseGlyph')

$TitleText.Text    = Format-Headline $fullTitle
$TitleText.ToolTip = $fullTitle
$win.ToolTip       = $fullTitle

# Bottom-right, cascaded by a stable hash of the session id so several open sessions don't
# land in exactly the same spot.
$wa = [System.Windows.SystemParameters]::WorkArea
$slot = 0
foreach ($c in $SessionId.ToCharArray()) { $slot = ($slot + [int]$c) % 6 }
$win.Left = $wa.Right  - $BarW - 22
$win.Top  = $wa.Bottom - $BarH - 22 - ($slot * 76)

# PowerShell will not reliably coerce a hex string into a Brush on property assignment, so
# every runtime colour change goes through an explicit converter.
$BrushOf = @{}
$bc = [System.Windows.Media.BrushConverter]::new()
foreach ($hex in '#FFD9A441', '#FF16A394', '#FF767D87', '#FF3A2A2C', '#FFE06C75',
                 '#FF8A9099', '#00FFFFFF', '#FF23272E', '#FF1E2126', '#FF2E333B') {
  $BrushOf[$hex] = $bc.ConvertFromString($hex)
}

$script:FoldedAt     = $null
$script:LastConsumed = if (Test-Path $Consumed) { (Get-Item $Consumed).LastWriteTimeUtc } else { $null }
$script:Collapsed    = $false

# --- Collapse -----------------------------------------------------------------
# Still not WindowState = Minimized: ShowInTaskbar is False, so a real minimize would
# leave no taskbar button to restore it — an unrecoverable close wearing a minimize icon.
# The chip is the minimized state, and it stays on screen.
function Set-Collapsed {
  param([bool]$On, [bool]$Persist = $true)
  if ($script:Collapsed -eq $On) { return }
  $script:Collapsed = $On

  # Pin the bottom-right corner so the chip appears where the bar's corner was, and the
  # bar comes back exactly where it left.
  $right  = $win.Left + $win.Width
  $bottom = $win.Top  + $win.Height

  if ($On) {
    $Shell.Visibility = 'Collapsed'
    $Chip.Visibility  = 'Visible'
    $win.Width = $ChipW; $win.Height = $ChipH
  } else {
    $Chip.Visibility  = 'Collapsed'
    $Shell.Visibility = 'Visible'
    $win.Width = $BarW; $win.Height = $BarH
  }
  $win.Left = $right  - $win.Width
  $win.Top  = $bottom - $win.Height

  if (-not $On) { $InputBox.Focus() | Out-Null }

  if ($Persist) {
    try {
      [System.IO.File]::WriteAllText($UiPath, ('{{"collapsed":{0}}}' -f $On.ToString().ToLower()), $Utf8)
    } catch { }
  }
}

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
  elseif ($_.Key -eq 'Escape') { Set-Collapsed $true; $_.Handled = $true }
})
$InputBox.Add_TextChanged({
  $Hint.Visibility = if ($InputBox.Text.Length -gt 0) { 'Collapsed' } else { 'Visible' }
})

# Buttons must swallow MouseLeftButtonDown. Without it the event reaches the drag handler,
# DragMove() captures the mouse, and the matching MouseUp never arrives — the button
# silently does nothing, with no error to point at.
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

$MinBtn.Add_MouseLeftButtonDown({ $_.Handled = $true })
$MinBtn.Add_MouseLeftButtonUp({ $_.Handled = $true; Set-Collapsed $true })
$MinBtn.Add_MouseEnter({
  $MinBtn.Background   = $BrushOf['#FF23272E']
  $MinGlyph.Foreground = $BrushOf['#FFE6E8EB']
})
$MinBtn.Add_MouseLeave({
  $MinBtn.Background   = $BrushOf['#00FFFFFF']
  $MinGlyph.Foreground = $BrushOf['#FF8A9099']
})

# There is no title bar to grab, so the shell itself is the drag handle. The TextBox
# handles its own mouse-down for the caret, so a drag never starts from inside it.
$Shell.Add_MouseLeftButtonDown({ try { $win.DragMove() } catch { } })

# The chip has to be both a button and a drag handle. DragMove() consumes the MouseUp, so
# a click can't be detected afterwards — but it returns immediately when the press was not
# actually a drag, so comparing the window position across the call tells the two apart.
$Chip.Add_MouseLeftButtonDown({
  $l = $win.Left; $t = $win.Top
  try { $win.DragMove() } catch { }
  if ([math]::Abs($win.Left - $l) -lt 3 -and [math]::Abs($win.Top - $t) -lt 3) {
    Set-Collapsed $false
  }
})
$Chip.Add_MouseEnter({ $Chip.Background = $BrushOf['#FF1E2126']; $Chip.BorderBrush = $BrushOf['#FF16A394'] })
$Chip.Add_MouseLeave({ $Chip.Background = $BrushOf['#FF16181C']; $Chip.BorderBrush = $BrushOf['#FF2E333B'] })

# Recede a little when it isn't the focused window — it lives on top of everything.
$win.Add_Activated({   $win.Opacity = 1.0 })
$win.Add_Deactivated({ $win.Opacity = 0.72 })

# --- Liveness ----------------------------------------------------------------
# The engine writes ~/.claude/sessions/<pid>.json per session. If this session's entry is
# gone, or its pid is dead, the window is an orphan — SessionEnd never fires when the app
# is killed outright, so this is what actually closes it.
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
# The visible session is whichever store file holds the highest `lastFocusedAt`. Only the
# most recently written can hold that maximum, so the scan is bounded.
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

# An unhandled exception inside a WPF dispatcher callback terminates the process outright
# — no stderr, no exit code, the window just vanishes. With $ErrorActionPreference = 'Stop'
# any non-terminating error in here becomes exactly that, so the whole tick body is
# wrapped and anything unexpected is logged instead.
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

  if (Test-Path $Consumed) {
    $mt = (Get-Item $Consumed).LastWriteTimeUtc
    if ($script:LastConsumed -and $mt -gt $script:LastConsumed) { $script:FoldedAt = Get-Date }
    $script:LastConsumed = $mt
  }

  $pending = @(Get-ChildItem (Join-Path $Inbox '*.note') -EA SilentlyContinue).Count

  # Collapsed, the badge on the chip is the only surface left to report on.
  if ($script:Collapsed) {
    if ($pending -gt 0) {
      $ChipBadgeText.Text   = if ($pending -gt 9) { '9+' } else { [string]$pending }
      $ChipBadge.Visibility = 'Visible'
    } else {
      $ChipBadge.Visibility = 'Collapsed'
    }
    return
  }

  # Expanded, one pill carries all the feedback there is room for: a count while notes
  # wait, then a brief tick once they have been folded into the turn.
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

$win.Add_ContentRendered({ if (-not $script:Collapsed) { $InputBox.Focus() | Out-Null } })

# Show() + a dispatcher loop, deliberately NOT ShowDialog(). ShowDialog is modal, and
# hiding a modal window ends its dialog loop — so the first time this window hid itself
# because another session was on screen, ShowDialog returned, the script ran off the end
# and the process exited. Silently: no error, no exit code, the window never came back.
# Restore the state it was left in, without rewriting the file it was just read from.
# Done before the first show so the bar never flashes on its way to being a chip.
if ($ui -and $ui.collapsed) { Set-Collapsed $true $false }

# Decide visibility BEFORE showing. Showing unconditionally and letting the first timer
# tick hide it meant a window for a session that wasn't on screen appeared for a second
# and then vanished — a bare flash in an unrelated chat, with no time to even paint its
# title. Indeterminate (no store file yet) still shows: better present than missing.
$script:Shown = ((Test-SessionOnScreen) -ne $false)
if ($script:Shown) { $win.Show() } else { Write-Life 'started hidden (another session is on screen)' }

[System.Windows.Threading.Dispatcher]::Run()
