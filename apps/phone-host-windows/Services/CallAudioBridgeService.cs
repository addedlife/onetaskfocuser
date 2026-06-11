using System.Collections.Concurrent;
using System.Threading.Channels;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace DeskPhone.Services;

/// <summary>
/// Captures a chosen Windows audio INPUT device and fans the audio out to any
/// number of live HTTP subscribers as 16 kHz mono 16-bit little-endian PCM.
///
/// Why this exists
/// ───────────────
/// Windows blocks third-party apps from receiving Bluetooth call audio directly
/// (the PhoneLineTransportDevice / BthHFEnum SCO path is Phone-Link-only since
/// 22H2, and raw SCO is never exposed to user mode — proven in scratch/PhoneLineProbe).
/// The practical way to get live call audio onto the PC without an app on the
/// phone is to let a *carkit-class* device do the HFP work and present the audio
/// to Windows as an ordinary input:
///   • a USB/Bluetooth speakerphone (Jabra Speak, Anker PowerConf) that pairs to
///     the phone and exposes a USB mic, or
///   • a 3.5 mm headset-loopback cable feeding a PC line/mic input.
/// Either way the call audio lands on a Windows capture endpoint, and this service
/// streams that endpoint live to the webapp.  The internal mic works as a stand-in
/// for testing the whole pipeline before the hardware arrives.
/// </summary>
public sealed class CallAudioBridgeService : IDisposable
{
    public const int OutputSampleRate = 16000;   // mono, 16-bit — good for voice, light on bandwidth

    public Action<string>? Log { get; set; }

    public sealed record InputDevice(string Id, string Name, bool IsDefault);

    private sealed class Subscriber
    {
        public required Channel<byte[]> Queue { get; init; }
    }

    private readonly MMDeviceEnumerator _enum = new();
    private readonly object _lock = new();
    private readonly List<Subscriber> _subs = new();

    private WasapiCapture? _capture;
    private string _deviceId = "";
    private string _deviceName = "";
    private double _resamplePos;       // fractional read position carried across callbacks
    private float _lastLevel;          // 0..1 peak of the most recent block (for a UI meter)
    private bool _disposed;

    public bool IsRunning { get; private set; }
    public string CurrentDeviceName => _deviceName;
    public string CurrentDeviceId => _deviceId;
    public float LastLevel => _lastLevel;
    public int SubscriberCount { get { lock (_lock) return _subs.Count; } }

    // ── Device enumeration ────────────────────────────────────────────────
    public List<InputDevice> ListInputs()
    {
        var list = new List<InputDevice>();
        string defaultId = "";
        try { defaultId = _enum.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications).ID; }
        catch { /* no default capture device */ }

        foreach (var d in _enum.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active))
        {
            try { list.Add(new InputDevice(d.ID, d.FriendlyName, d.ID == defaultId)); }
            catch { /* skip a device that throws on property read */ }
        }
        return list;
    }

    // ── Capture lifecycle ─────────────────────────────────────────────────
    /// <summary>Start (or switch) capture on the given device id, or the default
    /// communications input when <paramref name="deviceId"/> is null/empty.</summary>
    public void Start(string? deviceId)
    {
        lock (_lock)
        {
            if (_disposed) return;
            StopCaptureLocked();

            MMDevice device;
            try
            {
                device = string.IsNullOrWhiteSpace(deviceId)
                    ? _enum.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications)
                    : _enum.GetDevice(deviceId);
            }
            catch (Exception ex)
            {
                Log?.Invoke($"[call-audio] device open failed: {ex.Message}");
                throw;
            }

            _deviceId   = device.ID;
            _deviceName = device.FriendlyName;
            _resamplePos = 0;

            // Shared-mode capture in the device's mix format (typically 32-bit float).
            var capture = new WasapiCapture(device) { ShareMode = AudioClientShareMode.Shared };
            capture.DataAvailable    += OnDataAvailable;
            capture.RecordingStopped += OnRecordingStopped;
            _capture = capture;
            capture.StartRecording();
            IsRunning = true;
            Log?.Invoke($"[call-audio] capture started on '{_deviceName}' " +
                        $"({capture.WaveFormat.SampleRate} Hz / {capture.WaveFormat.Channels}ch / {capture.WaveFormat.Encoding})");
        }
    }

    public void Stop()
    {
        lock (_lock) StopCaptureLocked();
    }

    private void StopCaptureLocked()
    {
        if (_capture is null) return;
        try
        {
            _capture.DataAvailable    -= OnDataAvailable;
            _capture.RecordingStopped -= OnRecordingStopped;
            _capture.StopRecording();
            _capture.Dispose();
        }
        catch { /* best-effort teardown */ }
        _capture = null;
        IsRunning = false;
        _lastLevel = 0;
        Log?.Invoke("[call-audio] capture stopped");
    }

    private void OnRecordingStopped(object? sender, StoppedEventArgs e)
    {
        if (e.Exception is not null)
            Log?.Invoke($"[call-audio] recording stopped with error: {e.Exception.Message}");
    }

    // ── Capture callback: downmix → resample → 16-bit PCM → fan out ────────
    private void OnDataAvailable(object? sender, WaveInEventArgs e)
    {
        var fmt = _capture?.WaveFormat;
        if (fmt is null || e.BytesRecorded == 0) return;

        float[] mono = DownmixToMonoFloat(e.Buffer, e.BytesRecorded, fmt);
        if (mono.Length == 0) return;

        // Track peak level for a UI meter.
        float peak = 0;
        for (int i = 0; i < mono.Length; i++) { var a = Math.Abs(mono[i]); if (a > peak) peak = a; }
        _lastLevel = peak;

        byte[] pcm = ResampleToPcm16(mono, fmt.SampleRate);
        if (pcm.Length == 0) return;

        // Fan out a copy to every subscriber; drop oldest if a subscriber is
        // slow so live latency never grows unbounded.
        lock (_lock)
        {
            foreach (var sub in _subs)
            {
                if (!sub.Queue.Writer.TryWrite(pcm))
                {
                    sub.Queue.Reader.TryRead(out _);   // make room
                    sub.Queue.Writer.TryWrite(pcm);
                }
            }
        }
    }

    private static float[] DownmixToMonoFloat(byte[] buffer, int bytes, WaveFormat fmt)
    {
        int ch = Math.Max(1, fmt.Channels);

        if (fmt.Encoding == WaveFormatEncoding.IeeeFloat && fmt.BitsPerSample == 32)
        {
            int frames = bytes / (4 * ch);
            var mono = new float[frames];
            for (int f = 0; f < frames; f++)
            {
                float sum = 0;
                int baseByte = f * 4 * ch;
                for (int c = 0; c < ch; c++)
                    sum += BitConverter.ToSingle(buffer, baseByte + c * 4);
                mono[f] = sum / ch;
            }
            return mono;
        }

        if (fmt.Encoding == WaveFormatEncoding.Pcm && fmt.BitsPerSample == 16)
        {
            int frames = bytes / (2 * ch);
            var mono = new float[frames];
            for (int f = 0; f < frames; f++)
            {
                int sum = 0;
                int baseByte = f * 2 * ch;
                for (int c = 0; c < ch; c++)
                    sum += BitConverter.ToInt16(buffer, baseByte + c * 2);
                mono[f] = (sum / ch) / 32768f;
            }
            return mono;
        }

        // Unknown format — emit silence-length so the pipeline keeps timing.
        return Array.Empty<float>();
    }

    // Linear-interpolating resampler to OutputSampleRate; carries the fractional
    // read position across callbacks so block boundaries don't click.
    private byte[] ResampleToPcm16(float[] mono, int srcRate)
    {
        if (srcRate == OutputSampleRate)
        {
            var direct = new byte[mono.Length * 2];
            for (int i = 0; i < mono.Length; i++)
                WriteSample(direct, i * 2, mono[i]);
            return direct;
        }

        double step = (double)srcRate / OutputSampleRate;
        double pos = _resamplePos;
        var outBytes = new List<byte>(mono.Length * 2);

        while (pos < mono.Length - 1)
        {
            int i = (int)pos;
            double frac = pos - i;
            float s = (float)(mono[i] * (1 - frac) + mono[i + 1] * frac);
            int b = outBytes.Count;
            outBytes.Add(0); outBytes.Add(0);
            var arr = outBytes; // local
            short v = (short)Math.Clamp((int)(s * 32767f), short.MinValue, short.MaxValue);
            arr[b]     = (byte)(v & 0xFF);
            arr[b + 1] = (byte)((v >> 8) & 0xFF);
            pos += step;
        }

        // Carry the leftover fractional position into the next block.
        _resamplePos = pos - mono.Length;
        if (_resamplePos < 0) _resamplePos = 0;
        return outBytes.ToArray();
    }

    private static void WriteSample(byte[] dst, int offset, float sample)
    {
        short v = (short)Math.Clamp((int)(sample * 32767f), short.MinValue, short.MaxValue);
        dst[offset]     = (byte)(v & 0xFF);
        dst[offset + 1] = (byte)((v >> 8) & 0xFF);
    }

    // ── Subscriptions (one per live HTTP stream) ──────────────────────────
    /// <summary>Register a live subscriber. Auto-starts capture (default device)
    /// when the first one connects. Returns a reader of PCM chunks plus an unsubscribe.</summary>
    public (ChannelReader<byte[]> Reader, IDisposable Lease) AddSubscriber()
    {
        var queue = Channel.CreateBounded<byte[]>(new BoundedChannelOptions(32)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = false
        });
        var sub = new Subscriber { Queue = queue };

        lock (_lock)
        {
            _subs.Add(sub);
            if (!IsRunning)
            {
                try { Start(null); }
                catch (Exception ex) { Log?.Invoke($"[call-audio] auto-start failed: {ex.Message}"); }
            }
        }

        return (queue.Reader, new Lease(this, sub));
    }

    private void RemoveSubscriber(Subscriber sub)
    {
        lock (_lock)
        {
            _subs.Remove(sub);
            sub.Queue.Writer.TryComplete();
            if (_subs.Count == 0)
                StopCaptureLocked();   // release the mic when nobody is listening
        }
    }

    private sealed class Lease : IDisposable
    {
        private readonly CallAudioBridgeService _owner;
        private readonly Subscriber _sub;
        private bool _done;
        public Lease(CallAudioBridgeService owner, Subscriber sub) { _owner = owner; _sub = sub; }
        public void Dispose()
        {
            if (_done) return;
            _done = true;
            _owner.RemoveSubscriber(_sub);
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        lock (_lock)
        {
            foreach (var s in _subs.ToArray()) s.Queue.Writer.TryComplete();
            _subs.Clear();
            StopCaptureLocked();
        }
        try { _enum.Dispose(); } catch { }
    }
}
