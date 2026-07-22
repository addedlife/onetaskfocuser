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
$Utf8     = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path $Inbox)) { New-Item -ItemType Directory -Path $Inbox -Force | Out-Null }
[System.IO.File]::WriteAllText((Join-Path $Root 'window.pid'), "$PID", $Utf8)

function Get-SessionTitle {
  # The engine writes ~/.claude/sessions/<pid>.json with a `name` for the session.
  # It may not exist yet when the window opens, so this is polled rather than read once.
  try {
    Get-ChildItem (Join-Path $env:USERPROFILE '.claude\sessions\*.json') -EA SilentlyContinue |
      ForEach-Object {
        $j = Get-Content $_.FullName -Raw -EA SilentlyContinue | ConvertFrom-Json -EA SilentlyContinue
        if ($j -and $j.sessionId -eq $SessionId -and $j.name) { return $j.name }
      } | Select-Object -First 1
  } catch { $null }
}

$meta      = try { Get-Content $MetaPath -Raw -EA Stop | ConvertFrom-Json } catch { $null }
$fallback  = if ($meta -and $meta.title) { $meta.title } else { 'Claude Code' }
$projName  = if ($meta -and $meta.cwd) { Split-Path $meta.cwd -Leaf } else { '' }

[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="BackSeatDriver" Width="400" Height="248"
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
                   TextTrimming="CharacterEllipsis" Margin="0,0,26,0"/>
        <TextBlock x:Name="CloseBtn" Text="&#215;" Foreground="#FF8A9099" FontFamily="Segoe UI"
                   FontSize="16" HorizontalAlignment="Right" VerticalAlignment="Top"
                   Margin="0,-3,0,0" Cursor="Hand" Padding="6,0,2,4"/>
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

$TitleText = $win.FindName('TitleText')
$SubText   = $win.FindName('SubText')
$InputBox     = $win.FindName('Input')
$Status    = $win.FindName('Status')
$SendBtn   = $win.FindName('SendBtn')
$CloseBtn  = $win.FindName('CloseBtn')
$DragBar   = $win.FindName('DragBar')

$TitleText.Text = $fallback
$short = if ($SessionId.Length -ge 8) { $SessionId.Substring(0, 8) } else { $SessionId }
$SubText.Text = if ($projName) { "$projName  ·  $short" } else { $short }

# Bottom-right, cascaded by a stable hash of the session id so several open sessions
# don't land their windows in exactly the same spot.
$wa = [System.Windows.SystemParameters]::WorkArea
$slot = 0
foreach ($c in $SessionId.ToCharArray()) { $slot = ($slot + [int]$c) % 6 }
$win.Left = $wa.Right  - $win.Width  - 22 - ($slot * 16)
$win.Top  = $wa.Bottom - $win.Height - 22 - ($slot * 34)

$script:LastSent = $null

# PowerShell will not reliably coerce a hex string into a Brush on property assignment,
# so the status colours go through an explicit converter.
$BrushOf = @{}
foreach ($hex in '#FFD9A441', '#FF16A394', '#FF767D87') {
  $BrushOf[$hex] = [System.Windows.Media.BrushConverter]::new().ConvertFromString($hex)
}

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
$CloseBtn.Add_MouseLeftButtonUp({ $win.Close() })
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

$script:Ticks = 0
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds(1)
$timer.Add_Tick({
  $script:Ticks++

  if (Test-Path $DeadPath) { $timer.Stop(); $win.Close(); return }

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

  # The session title is written asynchronously by the engine and can be renamed
  # later, so re-read it every 10s rather than once at startup.
  if ($script:Ticks % 10 -eq 0) {
    $t = Get-SessionTitle
    if ($t -and $t -ne $TitleText.Text) { $TitleText.Text = $t }
  }
})
$timer.Start()

$win.Add_Closed({
  $timer.Stop()
  try { Remove-Item (Join-Path $Root 'window.pid') -Force -EA SilentlyContinue } catch { }
})

$win.Add_ContentRendered({ $InputBox.Focus() | Out-Null })
$win.ShowDialog() | Out-Null
