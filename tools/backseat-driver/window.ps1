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
$StoreDir = Join-Path $env:APPDATA 'Claude\claude-code-sessions'
$Utf8     = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path $Inbox)) { New-Item -ItemType Directory -Path $Inbox -Force | Out-Null }
[System.IO.File]::WriteAllText((Join-Path $Root 'window.pid'), "$PID", $Utf8)

$meta      = try { Get-Content $MetaPath -Raw -EA Stop | ConvertFrom-Json } catch { $null }
$projName  = if ($meta -and $meta.cwd) { Split-Path $meta.cwd -Leaf } else { '' }

# --- Session store ------------------------------------------------------------
# The desktop app keeps a JSON file per session at
#   %APPDATA%\Claude\claude-code-sessions\<accountId>\<orgId>\local_<uuid>.json
# holding the real side-rail `title`, a `cliSessionId` that maps straight to the
# engine session id, and `lastFocusedAt`. That is the authoritative local source for
# both the header and the on-screen check, so neither has to be inferred.
$script:StoreFile = $null

function Get-StoreFiles {
  Get-ChildItem $StoreDir -Recurse -Filter 'local_*.json' -EA SilentlyContinue |
    Sort-Object LastWriteTime -Descending
}

function Find-StoreFile {
  # A couple of hundred files live here, so substring-test the raw text before paying
  # for a JSON parse, and search newest-first — the session's own file is normally the
  # most recently written one.
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

# --- Title fallback ------------------------------------------------------------
# Only used when there is no store file — a CLI session, for instance, has no entry
# there. The side-rail title is derived from the first user message, so that message
# is the closest local stand-in.
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

function Format-Headline {
  param([string]$Text)
  if (-not $Text) { return $null }
  $t = ($Text -replace '\s+', ' ').Trim()
  if ($t.Length -gt 54) { $t = $t.Substring(0, 53).TrimEnd() + '…' }
  return $t
}

$script:StoreFile = Find-StoreFile
$headline = $null
if ($script:StoreFile) {
  $headline = Format-Headline (Read-Store $script:StoreFile).title
}
if (-not $headline) {
  $headline = Format-Headline (Get-FirstUserMessage ($(if ($meta) { $meta.transcriptPath } else { $null })))
}
if (-not $headline) {
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
                   TextTrimming="CharacterEllipsis" Margin="0,0,56,0"/>
        <!-- Glyphs are XML entities, not literal characters: the source stays pure
             ASCII, so they survive even if the file loses its UTF-8 BOM. -->
        <StackPanel Orientation="Horizontal" HorizontalAlignment="Right"
                    VerticalAlignment="Top" Margin="0,-4,-4,0">
          <TextBlock x:Name="MiniStatus" Text="" Foreground="#FFD9A441"
                     FontFamily="Segoe UI" FontSize="10.5" VerticalAlignment="Center"
                     Margin="0,0,8,0" Visibility="Collapsed"/>
          <Border x:Name="MinBtn" Width="24" Height="24" CornerRadius="6"
                  Background="Transparent" Cursor="Hand"
                  ToolTip="Collapse to a bar">
            <TextBlock x:Name="MinGlyph" Text="&#8722;" Foreground="#FF8A9099"
                       FontFamily="Segoe UI" FontSize="15"
                       HorizontalAlignment="Center" VerticalAlignment="Center"/>
          </Border>
          <Border x:Name="CloseBtn" Width="24" Height="24" CornerRadius="6"
                  Background="Transparent" Cursor="Hand">
            <TextBlock x:Name="CloseGlyph" Text="&#215;" Foreground="#FF8A9099"
                       FontFamily="Segoe UI" FontSize="15"
                       HorizontalAlignment="Center" VerticalAlignment="Center"/>
          </Border>
        </StackPanel>
      </Grid>

      <TextBlock Grid.Row="1" x:Name="SubText" Text="" Foreground="#FF767D87"
                 FontFamily="Segoe UI" FontSize="10.5" Margin="0,1,0,8"
                 TextTrimming="CharacterEllipsis"/>

      <Border Grid.Row="2" x:Name="Body" CornerRadius="7" Background="#FF1E2126"
              BorderBrush="#FF2E333B" BorderThickness="1">
        <TextBox x:Name="Input" Background="Transparent" Foreground="#FFE6E8EB"
                 CaretBrush="#FF16A394" BorderThickness="0" Padding="9,7,9,7"
                 FontFamily="Segoe UI" FontSize="12.5" AcceptsReturn="True"
                 TextWrapping="Wrap" VerticalScrollBarVisibility="Auto"
                 VerticalContentAlignment="Top"/>
      </Border>

      <Grid Grid.Row="3" x:Name="Footer" Margin="0,9,0,0">
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
$MinBtn     = $win.FindName('MinBtn')
$MinGlyph   = $win.FindName('MinGlyph')
$MiniStatus = $win.FindName('MiniStatus')
$DragBar    = $win.FindName('DragBar')
$Body       = $win.FindName('Body')
$Footer     = $win.FindName('Footer')

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
foreach ($hex in '#FFD9A441', '#FF16A394', '#FF767D87', '#FF3A2A2C', '#FFE06C75', '#FF8A9099', '#00FFFFFF', '#FF23272E') {
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
$CloseBtn.Add_MouseLeftButtonUp({ $_.Handled = $true; Write-Life 'closed by user (x)'; $win.Close() })
$CloseBtn.Add_MouseEnter({
  $CloseBtn.Background   = $BrushOf['#FF3A2A2C']
  $CloseGlyph.Foreground = $BrushOf['#FFE06C75']
})
$CloseBtn.Add_MouseLeave({
  $CloseBtn.Background   = $BrushOf['#00FFFFFF']
  $CloseGlyph.Foreground = $BrushOf['#FF8A9099']
})

$DragBar.Add_MouseLeftButtonDown({ try { $win.DragMove() } catch { } })

# --- Collapse ------------------------------------------------------------------
# Deliberately a collapse to a title bar, NOT WindowState = Minimized. This window sets
# ShowInTaskbar = False, so a real minimize would send it somewhere with no taskbar
# button to bring it back — an unrecoverable close wearing a minimize button.
# Collapsed, it keeps showing the pending-note count, which is the one thing still worth
# knowing when the input is out of the way.
$script:Collapsed  = $false
$script:FullHeight = $win.Height

function Set-Collapsed {
  param([bool]$On)
  if ($script:Collapsed -eq $On) { return }
  $script:Collapsed = $On

  if ($On) {
    $script:FullHeight = $win.Height
    foreach ($el in @($SubText, $Body, $Footer)) { $el.Visibility = 'Collapsed' }
    $win.MinHeight  = 0
    $win.ResizeMode = 'NoResize'
    $bar = 46
    # Keep the bottom edge planted so it stays hugging the corner it was docked in.
    $win.Top    = $win.Top + ($script:FullHeight - $bar)
    $win.Height = $bar
    $MinGlyph.Text     = '+'
    $MinBtn.ToolTip    = 'Expand'
    $TitleText.Margin  = '0,0,110,0'
  } else {
    $win.Height = $script:FullHeight
    $win.Top    = $win.Top - ($script:FullHeight - 46)
    foreach ($el in @($SubText, $Body, $Footer)) { $el.Visibility = 'Visible' }
    $win.MinHeight  = 180
    $win.ResizeMode = 'CanResize'
    $MinGlyph.Text     = [string][char]0x2212
    $MinBtn.ToolTip    = 'Collapse to a bar'
    $TitleText.Margin  = '0,0,56,0'
    $MiniStatus.Visibility = 'Collapsed'
    $InputBox.Focus() | Out-Null
  }
}

# Same swallow as the close button: without it DragMove() captures the mouse and the
# matching MouseUp never arrives.
$MinBtn.Add_MouseLeftButtonDown({ $_.Handled = $true })
$MinBtn.Add_MouseLeftButtonUp({ $_.Handled = $true; Set-Collapsed (-not $script:Collapsed) })
$MinBtn.Add_MouseEnter({
  $MinBtn.Background   = $BrushOf['#FF23272E']
  $MinGlyph.Foreground = $BrushOf['#FFE6E8EB']
})
$MinBtn.Add_MouseLeave({
  $MinBtn.Background   = $BrushOf['#00FFFFFF']
  $MinGlyph.Foreground = $BrushOf['#FF8A9099']
})

# Double-clicking the bar toggles too — the usual gesture for a collapsed title bar.
$DragBar.Add_MouseLeftButtonUp({
  if ($_.ClickCount -eq 2) { Set-Collapsed (-not $script:Collapsed) }
})

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
# The visible session is simply the one with the highest `lastFocusedAt`. Only the
# handful of most recently written store files can hold that maximum, so the scan is
# bounded rather than parsing all ~200 every tick.
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
      $t = Format-Headline (Read-Store $script:StoreFile).title
      if ($t -and $t -ne $TitleText.Text) {
        $TitleText.Text = $t
        $TitleText.ToolTip = $t
      }
    }
  }

  $pending = @(Get-ChildItem (Join-Path $Inbox '*.note') -EA SilentlyContinue).Count

  # Collapsed, the header is the only surface left, so the pending count moves there.
  if ($script:Collapsed) {
    if ($pending -gt 0) {
      $MiniStatus.Text = "$pending waiting"
      $MiniStatus.Visibility = 'Visible'
    } else {
      $MiniStatus.Visibility = 'Collapsed'
    }
  }

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
# and the process exited. Silently: no error, no exit code, the window just never came
# back. With Show(), visibility is decoupled from the message loop's lifetime.
$script:Shown = $true
$win.Show()
[System.Windows.Threading.Dispatcher]::Run()
