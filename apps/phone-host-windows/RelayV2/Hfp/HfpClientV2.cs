using System.Text;
using DeskPhone.RelayV2.Bt;
using Microsoft.Extensions.Logging;
using Polly;
using Polly.Retry;

namespace DeskPhone.RelayV2.Hfp;

// HFP call-control client (no audio path — this host never claims codec
// negotiation; audio stays with the OS/carkit exactly as before). All wire
// parsing is delegated to AtTokenizer and all state to CallStateMachine, so
// this class is only: connect, handshake, supervised read loop, serialized
// writes, and a liveness probe for the half-open-socket Windows quirk.
//
// ONE line reader per connection, created in AttachAsync and shared by the
// handshake and the read loop. Two readers on the same stream (the original
// draft) is a silent data-loss bug: a buffered reader reads AHEAD of the
// lines it returns, so any URC the phone sends right behind the handshake's
// final OK could be stranded in the first reader's buffer and never seen by
// the second. AttachAsync is internal so tests drive the full handshake+loop
// over a fixture stream with zero Bluetooth hardware.
public sealed class HfpClientV2 : IAsyncDisposable
{
    // Named constants — every one of these was a bare number in the legacy
    // HfpService, each individually re-discovered in production.
    private static readonly TimeSpan ReadIdleProbe = TimeSpan.FromSeconds(30); // silence before liveness probe
    private static readonly TimeSpan ProbeReply    = TimeSpan.FromSeconds(10); // probe unanswered => dead socket
    private static readonly TimeSpan WriteDeadline = TimeSpan.FromSeconds(8);  // ghost-socket write hang guard

    private readonly ILogger _log;
    private readonly AtTokenizer _tokenizer = new();
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private readonly ResiliencePipeline _connectRetry;

    private RfcommConnection? _conn;
    private Stream? _stream;
    private StreamReader? _reader;
    private CancellationTokenSource? _loopCts;
    private Task? _loopTask;

    public CallStateMachine Calls { get; }
    public bool IsConnected { get; private set; }
    public event Action? Disconnected;

    public HfpClientV2(ILogger log, CallStateMachine? machine = null)
    {
        _log = log;
        Calls = machine ?? new CallStateMachine();
        // Standard Polly retry replaces the hand-rolled attempt loops: 5 tries,
        // exponential backoff with jitter, then give up to the caller.
        _connectRetry = new ResiliencePipelineBuilder()
            .AddRetry(new RetryStrategyOptions
            {
                MaxRetryAttempts = 5,
                Delay = TimeSpan.FromSeconds(2),
                BackoffType = DelayBackoffType.Exponential,
                UseJitter = true,
            })
            .Build();
    }

    public async Task ConnectAsync(ulong bluetoothAddress, CancellationToken ct = default)
    {
        await _connectRetry.ExecuteAsync(async token =>
        {
            var conn = await RfcommConnection.ConnectAsync(bluetoothAddress, RfcommConnection.HfpUuid, token);
            try
            {
                await AttachAsync(conn.Stream, token);
            }
            catch
            {
                await conn.DisposeAsync(); // don't leak a half-handshaken socket into the next retry
                throw;
            }
            _conn = conn;
        }, ct);
    }

    /// Attach to an already-open duplex stream: run the SLC handshake, then
    /// start the supervised read loop — both on the same reader. Internal so
    /// protocol tests exercise the real handshake + loop over a fixture.
    internal async Task AttachAsync(Stream stream, CancellationToken ct)
    {
        _stream = stream;
        _reader = new StreamReader(stream, Encoding.ASCII, false, 1024, leaveOpen: true);
        await HandshakeAsync(ct);
        IsConnected = true;
        _loopCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _loopTask = ReadLoopAsync(_loopCts.Token); // supervised: loop end fires Disconnected
    }

    // The SLC (service level connection) handshake, deliberately minimal:
    // BRSF without codec-negotiation (bit 7 clear — never claim audio),
    // CIND definition + values, CMER on, CLIP on, CCWA on (optional — some
    // handsets reject call-waiting; an ERROR there must not fail the link).
    private async Task HandshakeAsync(CancellationToken ct)
    {
        async Task<List<string>> Command(string cmd, bool acceptError = false)
        {
            await RawWriteAsync(cmd + "\r", ct);
            var lines = new List<string>();
            while (true)
            {
                var line = await _reader!.ReadLineAsync(ct) ?? throw new EndOfStreamException("phone closed during handshake");
                if (line.Length == 0) continue;
                if (line == "OK") return lines;
                if (line == "ERROR" || line.StartsWith("+CME ERROR", StringComparison.Ordinal))
                {
                    if (acceptError) return lines;
                    throw new InvalidOperationException($"{cmd} -> {line}");
                }
                lines.Add(line);
            }
        }

        await Command("AT+BRSF=20"); // our features: 0x14 = CLIP + remote volume, NO codec negotiation
        var cindDef = await Command("AT+CIND=?");
        foreach (var line in cindDef)
            if (line.StartsWith("+CIND:", StringComparison.Ordinal))
                _tokenizer.LoadCindDefinition(line[6..]);
        await Command("AT+CIND?");
        await Command("AT+CMER=3,0,0,1"); // event reporting on
        await Command("AT+CLIP=1");
        await Command("AT+CCWA=1", acceptError: true);
    }

    private async Task ReadLoopAsync(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                // Race the read against the idle-probe window. Never cancel the
                // read itself (aborting it kills the socket on WinRT); a probe
                // going unanswered is the liveness verdict.
                var readTask = _reader!.ReadLineAsync(ct).AsTask();
                var winner = await Task.WhenAny(readTask, Task.Delay(ReadIdleProbe, ct));
                if (winner != readTask)
                {
                    await RawWriteAsync("AT+NREC=0\r", ct); // benign probe; any reply proves liveness
                    var probeWinner = await Task.WhenAny(readTask, Task.Delay(ProbeReply, ct));
                    if (probeWinner != readTask)
                        throw new TimeoutException("liveness probe unanswered — half-open socket");
                }
                var line = await readTask;
                if (line == null) throw new EndOfStreamException("phone closed HFP link");
                if (line.Length == 0) continue;

                var evt = _tokenizer.Tokenize(line);
                if (evt is AtEvent.Unknown u && u.Line.Length > 0)
                    _log.LogDebug("HFP unknown line: {Line}", u.Line);
                Calls.Handle(evt);
                Calls.Tick();
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "HFP read loop ended");
        }
        finally
        {
            IsConnected = false;
            Calls.Handle(new AtEvent.IndicatorChange(HfpIndicators.Call, 0));
            Disconnected?.Invoke();
        }
    }

    // ── Call actions — same AT commands as before, now serialized + deadlined ──

    public Task DialAsync(string number, CancellationToken ct = default)
    {
        Calls.NoteDialing(number);
        return RawWriteAsync($"ATD{Sanitize(number)};\r", ct);
    }
    public Task AnswerAsync(CancellationToken ct = default) => RawWriteAsync("ATA\r", ct);
    public Task HangUpAsync(CancellationToken ct = default) => RawWriteAsync("AT+CHUP\r", ct);
    public Task SetMuteAsync(bool mute, CancellationToken ct = default) => RawWriteAsync($"AT+CMUT={(mute ? 1 : 0)}\r", ct);

    private static string Sanitize(string number)
    {
        var sb = new StringBuilder();
        foreach (var c in number)
            if (char.IsDigit(c) || c is '+' or '*' or '#') sb.Append(c);
        return sb.ToString();
    }

    private async Task RawWriteAsync(string text, CancellationToken ct)
    {
        var stream = _stream ?? throw new InvalidOperationException("not connected");
        await _writeLock.WaitAsync(ct);
        try
        {
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
            deadline.CancelAfter(WriteDeadline);
            await stream.WriteAsync(Encoding.ASCII.GetBytes(text), deadline.Token);
            await stream.FlushAsync(deadline.Token);
        }
        finally { _writeLock.Release(); }
    }

    public async ValueTask DisposeAsync()
    {
        _loopCts?.Cancel();
        if (_loopTask is not null)
        {
            try { await _loopTask.WaitAsync(TimeSpan.FromSeconds(3)); } catch { }
        }
        _reader?.Dispose();
        if (_conn != null) await _conn.DisposeAsync();
        IsConnected = false;
    }
}
