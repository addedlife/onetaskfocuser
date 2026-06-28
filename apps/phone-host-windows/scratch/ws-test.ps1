$ErrorActionPreference = 'Stop'
$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ct = [Threading.CancellationToken]::None
$ws.ConnectAsync([Uri]'ws://127.0.0.1:8765/call-audio.ws', $ct).Wait()
"ws state: $($ws.State)"

# ── downlink: expect binary PCM frames from the carkit input ──
$buf = New-Object byte[] 65536
$seg = New-Object 'ArraySegment[byte]' -ArgumentList @(,$buf)
$frames = 0; $total = 0; $nonzero = $false
$sw = [Diagnostics.Stopwatch]::StartNew()
while ($frames -lt 12 -and $sw.ElapsedMilliseconds -lt 9000) {
    $r = $ws.ReceiveAsync($seg, $ct).Result
    if ($r.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Binary) {
        $frames++; $total += $r.Count
        for ($i = 0; $i -lt [Math]::Min($r.Count, 400); $i++) { if ($buf[$i] -ne 0) { $nonzero = $true; break } }
    }
}
"downlink: frames=$frames bytes=$total ms=$($sw.ElapsedMilliseconds) signal=$nonzero"

# ── uplink: 1 s of 440 Hz sine @ 10% amplitude in 100 ms frames ──
$rate = 16000
for ($f = 0; $f -lt 10; $f++) {
    $bytes = New-Object byte[] 3200
    for ($i = 0; $i -lt 1600; $i++) {
        $t = ($f * 1600 + $i) / $rate
        $v = [int]([math]::Sin(2 * [math]::PI * 440 * $t) * 3276)
        $bytes[$i*2]   = $v -band 0xFF
        $bytes[$i*2+1] = ($v -shr 8) -band 0xFF
    }
    $useg = New-Object 'ArraySegment[byte]' -ArgumentList @(,$bytes)
    $ws.SendAsync($useg, [System.Net.WebSockets.WebSocketMessageType]::Binary, $true, $ct).Wait()
    Start-Sleep -Milliseconds 95
}
"uplink: sent 32000 bytes (1.0 s sine)"

$mid = (Invoke-WebRequest 'http://127.0.0.1:8765/call-audio/state' -UseBasicParsing).Content | ConvertFrom-Json
"state during ws: uplinkActive=$($mid.uplink.active) uplinkDevice='$($mid.uplink.deviceName)' uplinkBytes=$($mid.uplink.bytesReceived) downlinkRunning=$($mid.downlink.running) downlinkDevice='$($mid.downlink.deviceName)' subs=$($mid.downlink.subscribers)"

$ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', $ct).Wait()
Start-Sleep -Milliseconds 1200
$post = (Invoke-WebRequest 'http://127.0.0.1:8765/call-audio/state' -UseBasicParsing).Content | ConvertFrom-Json
"state after close: uplinkActive=$($post.uplink.active) downlinkRunning=$($post.downlink.running) subs=$($post.downlink.subscribers)"
