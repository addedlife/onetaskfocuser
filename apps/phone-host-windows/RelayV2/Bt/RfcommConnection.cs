using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.Rfcomm;
using Windows.Networking.Sockets;

namespace DeskPhone.RelayV2.Bt;

// WinRT-only RFCOMM transport. The legacy stack used TWO Bluetooth libraries
// side by side (32feet sockets for PBAP/MAP/MNS + WinRT for HFP) bridged by
// an SDP-probe hack; v2 uses the one sanctioned public API for everything,
// which also removes the GC.Collect() socket-release workaround (32feet's
// finalizer-held native handles were what made that "necessary").
public sealed class RfcommConnection : IAsyncDisposable
{
    public static readonly Guid HfpUuid  = Guid.Parse("0000111F-0000-1000-8000-00805F9B34FB");
    public static readonly Guid PbapUuid = Guid.Parse("0000112F-0000-1000-8000-00805F9B34FB");
    public static readonly Guid MapUuid  = Guid.Parse("00001132-0000-1000-8000-00805F9B34FB");
    public static readonly Guid MnsUuid  = Guid.Parse("00001133-0000-1000-8000-00805F9B34FB");

    private readonly StreamSocket _socket;
    public Stream Stream { get; }

    private RfcommConnection(StreamSocket socket, Stream stream)
    {
        _socket = socket;
        Stream = stream;
    }

    /// Connect to a service on a paired phone by Bluetooth address.
    /// Windows quirk, documented rather than hidden: SDP results are cached
    /// and only refresh over an active baseband link, so the first
    /// GetRfcommServicesForIdAsync with Cached can return nothing. Uncached
    /// mode forces a live SDP query (bringing the link up as a side effect),
    /// which is the sanctioned form of what the legacy BluetoothDeviceConnector
    /// hack did with a throwaway probe-and-discard loop.
    public static async Task<RfcommConnection> ConnectAsync(ulong bluetoothAddress, Guid serviceUuid, CancellationToken ct = default)
    {
        using var device = await BluetoothDevice.FromBluetoothAddressAsync(bluetoothAddress)
            ?? throw new InvalidOperationException($"no Bluetooth device at address {bluetoothAddress:X12}");

        var services = await device.GetRfcommServicesForIdAsync(
            RfcommServiceId.FromUuid(serviceUuid), BluetoothCacheMode.Uncached);
        if (services.Error != BluetoothError.Success || services.Services.Count == 0)
            throw new InvalidOperationException($"service {serviceUuid} not available on {device.Name} ({services.Error})");

        var socket = new StreamSocket();
        try
        {
            await socket.ConnectAsync(
                services.Services[0].ConnectionHostName,
                services.Services[0].ConnectionServiceName);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
        var stream = new DuplexWinRtStream(socket);
        return new RfcommConnection(socket, stream);
    }

    public ValueTask DisposeAsync()
    {
        try { Stream.Dispose(); } catch { }
        try { _socket.Dispose(); } catch { }
        return ValueTask.CompletedTask;
    }

    // StreamSocket exposes separate input/output WinRT streams; OBEX and AT
    // both want one bidirectional System.IO.Stream.
    private sealed class DuplexWinRtStream : Stream
    {
        private readonly Stream _in;
        private readonly Stream _out;
        public DuplexWinRtStream(StreamSocket socket)
        {
            _in = socket.InputStream.AsStreamForRead();
            _out = socket.OutputStream.AsStreamForWrite();
        }
        public override bool CanRead => true;
        public override bool CanWrite => true;
        public override bool CanSeek => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override int Read(byte[] buffer, int offset, int count) => _in.Read(buffer, offset, count);
        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken ct) => _in.ReadAsync(buffer, offset, count, ct);
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default) => _in.ReadAsync(buffer, ct);
        public override void Write(byte[] buffer, int offset, int count) => _out.Write(buffer, offset, count);
        public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken ct) => _out.WriteAsync(buffer, offset, count, ct);
        public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken ct = default) => _out.WriteAsync(buffer, ct);
        public override void Flush() => _out.Flush();
        public override Task FlushAsync(CancellationToken ct) => _out.FlushAsync(ct);
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        protected override void Dispose(bool disposing)
        {
            if (disposing) { try { _in.Dispose(); } catch { } try { _out.Dispose(); } catch { } }
            base.Dispose(disposing);
        }
    }
}
