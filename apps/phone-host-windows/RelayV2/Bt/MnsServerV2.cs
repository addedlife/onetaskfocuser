using System.Text;
using DeskPhone.RelayV2.Obex;
using Microsoft.Extensions.Logging;
using Windows.Devices.Bluetooth.Rfcomm;
using Windows.Networking.Sockets;

namespace DeskPhone.RelayV2.Bt;

// MNS server — the RFCOMM service the PHONE connects back into to push
// "new message" events. Uses the same ObexEngine as the clients (server
// role) — the legacy stack's second, independent hand-rolled OBEX
// implementation is gone. Connections are bounded (one active phone session;
// a second concurrent connect replaces the first) instead of the legacy
// unbounded Task.Run-per-connection.
public sealed class MnsServerV2 : IAsyncDisposable
{
    private readonly ILogger _log;
    private StreamSocketListener? _listener;
    private RfcommServiceProvider? _provider;
    private CancellationTokenSource? _cts;
    private CancellationTokenSource? _sessionCts;

    /// Fired for every OBEX PUT the phone sends. Empty payloads are normal
    /// (observed MediaTek behavior: the PUT itself is the signal) — consumers
    /// treat every event as "something changed, go delta-sync".
    public event Action<byte[]>? EventReceived;

    public MnsServerV2(ILogger log) => _log = log;

    public async Task StartAsync(CancellationToken ct = default)
    {
        _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _provider = await RfcommServiceProvider.CreateAsync(RfcommServiceId.FromUuid(RfcommConnection.MnsUuid));
        _listener = new StreamSocketListener();
        _listener.ConnectionReceived += OnConnection;
        await _listener.BindServiceNameAsync(
            _provider.ServiceId.AsString(),
            SocketProtectionLevel.BluetoothEncryptionAllowNullAuthentication);
        _provider.StartAdvertising(_listener, true);
        _log.LogInformation("MNS server advertising");
    }

    private void OnConnection(StreamSocketListener sender, StreamSocketListenerConnectionReceivedEventArgs args)
    {
        // One phone session at a time: a new connection supersedes the old.
        _sessionCts?.Cancel();
        var sessionCts = CancellationTokenSource.CreateLinkedTokenSource(_cts!.Token);
        _sessionCts = sessionCts;

        _ = Task.Run(async () =>
        {
            var socket = args.Socket;
            try
            {
                using var input = socket.InputStream.AsStreamForRead();
                using var output = socket.OutputStream.AsStreamForWrite();
                var engine = new ObexEngine(new EchoStream(input, output));
                await engine.ServeAsync(payload =>
                {
                    _log.LogDebug("MNS event ({Bytes}B)", payload.Length);
                    EventReceived?.Invoke(payload);
                    return Task.CompletedTask;
                }, sessionCts.Token);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _log.LogInformation(ex, "MNS session ended");
            }
            finally
            {
                try { socket.Dispose(); } catch { }
            }
        }, sessionCts.Token);
    }

    public ValueTask DisposeAsync()
    {
        _sessionCts?.Cancel();
        _cts?.Cancel();
        _provider?.StopAdvertising();
        _listener?.Dispose();
        return ValueTask.CompletedTask;
    }

    // Minimal read/write pairing of the two WinRT half-streams into the one
    // bidirectional Stream ObexEngine expects.
    private sealed class EchoStream : Stream
    {
        private readonly Stream _in;
        private readonly Stream _out;
        public EchoStream(Stream input, Stream output) { _in = input; _out = output; }
        public override bool CanRead => true;
        public override bool CanWrite => true;
        public override bool CanSeek => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override int Read(byte[] buffer, int offset, int count) => _in.Read(buffer, offset, count);
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default) => _in.ReadAsync(buffer, ct);
        public override void Write(byte[] buffer, int offset, int count) => _out.Write(buffer, offset, count);
        public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken ct = default) => _out.WriteAsync(buffer, ct);
        public override void Flush() => _out.Flush();
        public override Task FlushAsync(CancellationToken ct) => _out.FlushAsync(ct);
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
    }
}
