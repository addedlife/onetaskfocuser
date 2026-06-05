using DeskPhone.Models;
using InTheHand.Net;
using System.IO;
using System.Text;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.Rfcomm;
using Windows.Networking.Sockets;

namespace DeskPhone.Services;

/// <summary>
/// HFP (Hands-Free Profile) service.
/// Opens an RFCOMM channel to the phone's HFP Audio Gateway service,
/// runs the AT-command handshake, then listens for call events.
///
/// Key lesson from debug log: when BOTH sides declare codec negotiation support,
/// the phone sends +BCS:<id> and WAITS for AT+BCS=<id> back before proceeding.
/// If we don't respond, the phone disconnects after ~5 seconds.
/// </summary>
public class HfpService : IAsyncDisposable
{
    // ── Events ─────────────────────────────────────────────────────────────
    public event Action<CallInfo>?  CallStateChanged;
    public event Action<string>?    AtLogLine;
    public event Action<string>?    StatusChanged;
    public event Action<string, int>? IndicatorChanged;

    // ── State ───────────────────────────────────────────────────────────────
    public bool      IsConnected      { get; private set; }
    public CallInfo  CurrentCall      { get; private set; } = new();

    /// <summary>
    /// Sample rate implied by the codec negotiated via +BCS.
    /// 1 = CVSD → 8000 Hz; 2 = mSBC → 16000 Hz.
    /// Reset to 8000 on each new connection.
    /// </summary>
    public int NegotiatedSampleRate { get; private set; } = 8000;

    // ── Private ─────────────────────────────────────────────────────────────
    private StreamSocket?              _socket;
    private StreamReader?             _reader;
    private StreamWriter?             _writer;
    private CancellationTokenSource?  _cts;
    private readonly SemaphoreSlim    _writeLock = new(1, 1);
    private long                      _callStateRevision;
    private DateTime                  _lastAudioConnectionRequestUtc = DateTime.MinValue;

    // Map CIND indicator index → name, populated during handshake
    private readonly Dictionary<int, string> _indicators = new();

    private void PublishCallStateChanged()
    {
        Interlocked.Increment(ref _callStateRevision);
        CallStateChanged?.Invoke(CloneCallInfo(CurrentCall));
    }

    private static CallInfo CloneCallInfo(CallInfo call) => new()
    {
        Status = call.Status,
        Direction = call.Direction,
        Number = call.Number,
        DisplayName = call.DisplayName,
        StartTime = call.StartTime
    };

    private void ReplaceCallState(CallInfo call)
    {
        CurrentCall = call;
        PublishCallStateChanged();
    }

    private void ForceIdleFromCurrentState()
    {
        _lastAudioConnectionRequestUtc = DateTime.MinValue;
        ReplaceCallState(new CallInfo
        {
            Status      = CallStatus.Idle,
            Direction   = CurrentCall.Direction,
            Number      = CurrentCall.Number,
            DisplayName = CurrentCall.DisplayName,
            StartTime   = CurrentCall.StartTime
        });
    }

    // HFP feature bitmask we advertise to the phone.
    // Bits (HFP 1.8):
    //   0 = EC/NR,  1 = 3-way,  2 = CLI,  3 = Voice recog,  4 = Remote vol
    //   5 = Enh call status,  6 = Enh call control,  7 = Codec negotiation
    //
    // We intentionally do NOT advertise codec negotiation (bit 7).
    // If we claim codec negotiation, the phone sends +BCS to our RFCOMM channel
    // and routes the SCO audio connection to us — but we have no audio driver,
    // so the audio path dies here.  BthHFEnum (the Windows HFP HF kernel driver)
    // has its own SLC and handles codec negotiation independently.  By NOT
    // claiming this capability, we stay out of the audio path entirely and let
    // BthHFEnum receive the SCO and create the WASAPI endpoint.
    private const int OurFeatures = 0b0000_0000_0000_0100;  // = 0x04 = 4 (CLI only)

    // ── Connect ──────────────────────────────────────────────────────────────
    public async Task ConnectAsync(BluetoothAddress deviceAddress,
                                   CancellationToken ct = default)
    {
        StatusChanged?.Invoke("Connecting HFP…");

        // Convert 32feet BluetoothAddress → ulong for the WinRT API.
        // BluetoothDevice.FromBluetoothAddressAsync expects the address as a
        // plain 48-bit integer (the same number, just as a ulong).
        ulong addrUlong = Convert.ToUInt64(
            deviceAddress.ToString().Replace(":", ""), 16);

        // ── Tell Windows to install bthaudio.sys (HFP audio driver) for this device ──
        // BluetoothSetServiceState with the HFP AG UUID asks Windows to register
        // the Bluetooth Hands-Free profile driver so it can accept the phone's SCO
        // audio channel.  This is harmless to call repeatedly; result is logged below.
        var (btssCode, btssDesc) = NativeBluetoothHelper.EnableHfpForDevice(addrUlong);
        AtLogLine?.Invoke($"[hfp profile enable: {btssDesc}]");

        var btDevice = await BluetoothDevice.FromBluetoothAddressAsync(addrUlong).AsTask(ct);
        if (btDevice is null) throw new Exception("Bluetooth device not found");

        // ── Diagnostic: dump every RFCOMM service the phone advertises via SDP ──
        // This shows up in the AT log and tells us exactly what the phone reports.
        // Useful for understanding why Windows may not enumerate HFP automatically.
        try
        {
            var allSvc = await btDevice.GetRfcommServicesAsync(BluetoothCacheMode.Uncached).AsTask(ct);
            AtLogLine?.Invoke($"[SDP: {allSvc.Services.Count} RFCOMM service(s) found, err={allSvc.Error}]");
            foreach (var s in allSvc.Services)
                AtLogLine?.Invoke($"  SDP ▸ {s.ServiceId.Uuid}  host={s.ConnectionHostName}  svc={s.ConnectionServiceName}");
        }
        catch (Exception ex) { AtLogLine?.Invoke($"[SDP dump failed: {ex.Message}]"); }

        var hfpAgUuid  = RfcommServiceId.FromUuid(new Guid("0000111F-0000-1000-8000-00805F9B34FB"));
        var svcResult  = await btDevice.GetRfcommServicesForIdAsync(
                             hfpAgUuid, BluetoothCacheMode.Uncached).AsTask(ct);
        if (svcResult.Error != BluetoothError.Success || svcResult.Services.Count == 0)
            throw new Exception($"HFP AG service not found on device (error: {svcResult.Error})");

        var hfpService = svcResult.Services[0];

        _socket = new StreamSocket();
        await _socket.ConnectAsync(
            hfpService.ConnectionHostName,
            hfpService.ConnectionServiceName,
            SocketProtectionLevel.BluetoothEncryptionAllowNullAuthentication).AsTask(ct);

        var netInputStream  = _socket.InputStream.AsStreamForRead();
        var netOutputStream = _socket.OutputStream.AsStreamForWrite();
        _reader = new StreamReader(netInputStream,  Encoding.ASCII, leaveOpen: true);
        _writer = new StreamWriter(netOutputStream, Encoding.ASCII, leaveOpen: true)
        {
            AutoFlush = true,
            NewLine   = "\r"
        };

        _lastAudioConnectionRequestUtc = DateTime.MinValue;

        await RunHandshakeAsync(ct);

        IsConnected = true;
        StatusChanged?.Invoke("HFP connected");

        _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _ = Task.Run(() => ReadLoopAsync(_cts.Token));
    }

    // ── Handshake ────────────────────────────────────────────────────────────
    private async Task RunHandshakeAsync(CancellationToken ct)
    {
        // 1. Exchange supported features
        await SendAsync($"AT+BRSF={OurFeatures}");
        await ExpectOkAsync("+BRSF", ct);

        // AT+BAC (codec announcement) intentionally omitted.
        // We don't advertise codec negotiation in BRSF, so sending AT+BAC would
        // be inconsistent and may confuse the phone.  BthHFEnum handles its own
        // codec announcement on its separate SLC.

        // 2. Ask which indicators the phone supports
        await SendAsync("AT+CIND=?");
        var cindDef = await ExpectOkAsync("+CIND:", ct);
        ParseCindDefinition(cindDef);

        // 3. Get current indicator values
        await SendAsync("AT+CIND?");
        var cindVal = await ExpectOkAsync("+CIND:", ct);
        ParseCindValues(cindVal);

        // 4. Enable unsolicited indicator reporting
        await SendAsync("AT+CMER=3,0,0,1");
        await ExpectOkAsync("OK", ct);

        // 5. Enable caller-ID
        await SendAsync("AT+CLIP=1");
        await ExpectOkAsync("OK", ct);

        // 6. Call waiting — optional, accept ERROR gracefully
        await SendAsync("AT+CCWA=1");
        await ExpectOkAsync("OK", ct, acceptError: true);

        // Note: codec negotiation (+BCS:) arrives AFTER the handshake as a
        // URC from the phone. It is handled in HandleUrcLineAsync below.
    }

    // ── Continuous read loop ──────────────────────────────────────────────────
    private async Task ReadLoopAsync(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                // 30 s read deadline.  Windows RFCOMM can hold a socket in a
                // half-open "connected" state for 30-120 s after the radio link
                // drops — the stream won't throw until we actually try to use it.
                // A per-iteration timeout lets us probe the link before declaring it dead.
                using var readCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                readCts.CancelAfter(TimeSpan.FromSeconds(30));

                string? line;
                try
                {
                    line = await _reader!.ReadLineAsync(readCts.Token);
                }
                catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                {
                    // 30 s passed with no URC from the phone.
                    // Send a benign keepalive AT command.  If the write throws
                    // (IOException / ObjectDisposedException), the socket is dead
                    // and the exception propagates to the outer catch below.
                    // If the write succeeds the phone replies "OK", which falls
                    // through HandleUrcLineAsync as an unrecognised line (logged, ignored).
                    AtLogLine?.Invoke("[keepalive] 30 s idle — probing HFP link with AT+NREC=0");
                    await SendAsync("AT+NREC=0");
                    continue;
                }

                if (line is null) break;           // stream closed normally

                line = line.Trim();
                if (string.IsNullOrEmpty(line)) continue;

                AtLogLine?.Invoke($"← {line}");
                await HandleUrcLineAsync(line, ct);
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            AtLogLine?.Invoke($"[read error] {ex.Message}");
            StatusChanged?.Invoke($"HFP read error: {ex.Message}");
        }
        finally
        {
            IsConnected = false;
            StatusChanged?.Invoke("HFP disconnected");

            // Safety net: if the phone dropped the connection mid-call without
            // sending a clean call=0 indicator, force the call to Idle so the
            // UI banner clears instead of staying frozen on "active call."
            if (CurrentCall.Status != CallStatus.Idle)
            {
                ForceIdleFromCurrentState();
            }
        }
    }

    // ── Handle unsolicited result codes (URCs) ───────────────────────────────
    private async Task HandleUrcLineAsync(string line, CancellationToken ct)
    {
        // ── Codec negotiation: phone says which codec it wants ──
        // We MUST respond within ~5 s or the phone disconnects.
        // +BCS:1 = CVSD (narrow-band), +BCS:2 = mSBC (wide-band / HD voice)
        if (line.StartsWith("+BCS:"))
        {
            // The phone should not send +BCS to us because we don't advertise
            // codec negotiation in our BRSF.  If it does anyway, do NOT respond
            // with AT+BCS= — that would route the SCO audio to this channel which
            // has no audio driver.  BthHFEnum handles +BCS on its own SLC.
            var codecId = line[5..].Trim();
            NegotiatedSampleRate = codecId == "2" ? 16000 : 8000;
            AtLogLine?.Invoke($"[codec negotiation: ignoring +BCS:{codecId} (BthHFEnum handles audio)]");
            return;
        }

        // ── Incoming call ──
        if (line == "RING")
        {
            if (CurrentCall.Status != CallStatus.IncomingRinging)
            {
                // Stamp Direction = Incoming at the moment ringing starts.
                // This survives the later Active mutation so history is correct.
                ReplaceCallState(new CallInfo
                {
                    Status    = CallStatus.IncomingRinging,
                    Direction = CallDirection.Incoming
                });
            }
            return;
        }

        // ── Caller ID ──
        if (line.StartsWith("+CLIP:"))
        {
            // +CLIP: "+15551234567",145,,,,0
            var parts  = line[6..].Split(',');
            var number = parts.Length > 0 ? parts[0].Trim().Trim('"') : "";

            // Only process if we have a valid number (reject empty strings)
            if (!string.IsNullOrWhiteSpace(number))
            {
                CurrentCall.Number      = number;
                CurrentCall.DisplayName = null;
                PublishCallStateChanged();
            }
            else
            {
                AtLogLine?.Invoke($"[+CLIP] Warning: No phone number in {line}");
            }
            return;
        }

        // ── Indicator change ──
        if (line.StartsWith("+CIEV:"))
        {
            var payload = line[6..].Trim();
            var parts   = payload.Split(',');
            if (parts.Length < 2) return;
            if (!int.TryParse(parts[0].Trim(), out int idx)) return;
            if (!int.TryParse(parts[1].Trim(), out int val)) return;
            if (_indicators.TryGetValue(idx, out var name))
                HandleIndicator(name, val);
            return;
        }

        // ── Call waiting ──
        if (line.StartsWith("+CCWA:"))
        {
            AtLogLine?.Invoke($"[call waiting] {line}");
            return;
        }

        // ── HF indicator update (newer phones) ──
        if (line.StartsWith("+BIND:") || line.StartsWith("+BIEV:"))
        {
            AtLogLine?.Invoke($"[HF indicator] {line}");
        }
    }

    // ── Indicator state machine ───────────────────────────────────────────────
    private void HandleIndicator(string name, int value)
    {
        if (!string.IsNullOrWhiteSpace(name))
            IndicatorChanged?.Invoke(name, value);

        switch (name.ToLowerInvariant())
        {
            case "call":
                if (value == 0 && CurrentCall.Status != CallStatus.Idle)
                {
                    // Call ended. Preserve direction in the Idle record so the
                    // ViewModel can read it when recording history.
                    ForceIdleFromCurrentState();
                }
                else if (value == 1 && CurrentCall.Status != CallStatus.Active)
                {
                    // Call connected. Keep the existing CallInfo (preserves Direction
                    // and Number) — only update status and start time.
                    CurrentCall.Status    = CallStatus.Active;
                    CurrentCall.StartTime = DateTime.Now;
                    PublishCallStateChanged();
                    MaybeRequestAudioConnection("call became active");
                }
                break;

            case "callsetup":
                switch (value)
                {
                    case 0:
                        // callsetup=0 means call setup is over.
                        // If the call indicator is already 0 (no active call) and we
                        // were ringing, the caller hung up before we answered — clear it.
                        if (CurrentCall.Status == CallStatus.IncomingRinging ||
                            CurrentCall.Status == CallStatus.Dialing)
                        {
                            var direction = CurrentCall.Direction;
                            var number    = CurrentCall.Number;
                            _lastAudioConnectionRequestUtc = DateTime.MinValue;
                            ReplaceCallState(new CallInfo
                            {
                                Status    = CallStatus.Idle,
                                Direction = direction == CallDirection.Outgoing
                                                ? CallDirection.Outgoing
                                                : CallDirection.Missed,
                                Number    = number
                            });
                        }
                        break;

                    case 1:         // incoming call setup
                        if (CurrentCall.Status != CallStatus.IncomingRinging)
                        {
                            ReplaceCallState(new CallInfo
                            {
                                Status    = CallStatus.IncomingRinging,
                                Direction = CallDirection.Incoming
                            });
                        }
                        break;

                    case 2:         // outgoing: dialing
                    case 3:         // outgoing: phone is alerting (ringing at far end)
                        if (CurrentCall.Status != CallStatus.Dialing)
                        {
                            // Outgoing call initiated from the phone side.
                            // Stamp Direction = Outgoing now so history is right.
                            ReplaceCallState(new CallInfo
                            {
                                Status    = CallStatus.Dialing,
                                Direction = CallDirection.Outgoing,
                                Number    = CurrentCall.Number
                            });
                        }
                        break;
                }
                break;
        }
    }

    // ── Public call-control ───────────────────────────────────────────────────
    public async Task AnswerAsync()
    {
        await SendAsync("ATA");
        MaybeRequestAudioConnection("answer requested");
    }
    public async Task HangUpAsync()
    {
        var hadCallToClear = CurrentCall.Status != CallStatus.Idle;
        if (hadCallToClear && CurrentCall.Status != CallStatus.Ending)
        {
            ReplaceCallState(new CallInfo
            {
                Status      = CallStatus.Ending,
                Direction   = CurrentCall.Direction,
                Number      = CurrentCall.Number,
                DisplayName = CurrentCall.DisplayName,
                StartTime   = CurrentCall.StartTime
            });
        }

        var revisionBeforeSend = Interlocked.Read(ref _callStateRevision);

        try
        {
            await SendAsync("AT+CHUP");
        }
        catch when (hadCallToClear)
        {
            // If the AG link is already in a bad state, still honor the local
            // hang-up request instead of leaving the UI stuck in Dialing/Ringing.
        }

        if (!hadCallToClear)
            return;

        _ = Task.Run(async () =>
        {
            await Task.Delay(1200);
            if (Interlocked.Read(ref _callStateRevision) != revisionBeforeSend) return;
            if (CurrentCall.Status == CallStatus.Idle) return;
            ForceIdleFromCurrentState();
        });
    }

    public async Task DialAsync(string number)
    {
        number = number.Replace(" ", "").Replace("-", "").Replace("(", "").Replace(")", "");
        // Stamp Direction = Outgoing immediately so history is correct even if
        // callsetup indicators arrive in a different order.
        ReplaceCallState(new CallInfo
        {
            Status    = CallStatus.Dialing,
            Direction = CallDirection.Outgoing,
            Number    = number
        });
        await SendAsync($"ATD{number};");
        MaybeRequestAudioConnection("outgoing dial requested");
    }

    public Task ToggleMuteAsync(bool mute) => SendAsync($"AT+CMUT={(mute ? 1 : 0)}");

    private void MaybeRequestAudioConnection(string reason)
    {
        // DeskPhone has no audio driver — sending AT+BCC from here causes the phone
        // to route SCO audio to this RFCOMM channel, which can't receive it, and
        // prevents BthHFEnum (the Windows HFP HF kernel driver) from establishing
        // its own SCO connection and creating a WASAPI audio endpoint.
        //
        // BthHFEnum handles AT+BCC on its own SLC.  We log the event for diagnostics
        // but do NOT send the command.
        AtLogLine?.Invoke($"[audio connection: deferring to BthHFEnum ({reason})]");
    }

    // ── CIND parsing ─────────────────────────────────────────────────────────
    private void ParseCindDefinition(string line)
    {
        var payload = line.StartsWith("+CIND:") ? line[6..] : line;
        int idx = 1;
        foreach (var chunk in payload.Split('('))
        {
            var nameEnd = chunk.IndexOf('"', 1);
            if (nameEnd < 2) continue;
            _indicators[idx++] = chunk[1..nameEnd];
        }
    }

    private void ParseCindValues(string line)
    {
        var payload = line.StartsWith("+CIND:") ? line[6..] : line;
        var parts   = payload.Trim().Split(',');
        for (int i = 0; i < parts.Length; i++)
            if (int.TryParse(parts[i].Trim(), out int val))
                HandleIndicator(_indicators.GetValueOrDefault(i + 1, ""), val);
    }

    // ── Low-level send / expect ───────────────────────────────────────────────
    private async Task SendAsync(string cmd)
    {
        AtLogLine?.Invoke($"→ {cmd}");
        await _writeLock.WaitAsync();
        try   { await _writer!.WriteLineAsync(cmd); }
        finally { _writeLock.Release(); }
    }

    /// <summary>
    /// Reads lines until it sees one starting with <paramref name="prefix"/> AND
    /// a following OK (or ERROR if <paramref name="acceptError"/> is true).
    /// Returns the matched prefix line. Never throws on ERROR when acceptError=true.
    /// </summary>
    private async Task<string> ExpectOkAsync(string prefix, CancellationToken ct,
                                              bool acceptError = false,
                                              int timeoutMs = 8000)
    {
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
        linked.CancelAfter(timeoutMs);

        string matched = "";

        while (!linked.Token.IsCancellationRequested)
        {
            var raw = await _reader!.ReadLineAsync(linked.Token) ?? "";
            var line = raw.Trim();
            if (string.IsNullOrEmpty(line)) continue;

            AtLogLine?.Invoke($"← {line}");

            if (line.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                matched = line;
                if (prefix == "OK") { break; }
                continue;
            }

            if (line == "OK")  { break; }
            if (line == "ERROR" || line.StartsWith("+CME ERROR"))
            {
                if (acceptError) break;
                AtLogLine?.Invoke($"[ERROR for {prefix} — continuing anyway]");
                break;
            }
        }

        return matched;
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────
    public async ValueTask DisposeAsync()
    {
        _cts?.Cancel();
        _writeLock.Dispose();
        _writer?.Dispose();
        _reader?.Dispose();
        _socket?.Dispose();
        await Task.CompletedTask;
    }
}
