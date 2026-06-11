using System.IO;
using System.Text.Json;
using System.Threading.Channels;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace DeskPhone.Services;

/// <summary>
/// DeskPhone's call-audio engine.  Three independent capabilities, all built on
/// the same WASAPI plumbing:
///
///  1. DOWNLINK — capture a chosen Windows INPUT (the carkit speakerphone's USB
///     mic, a 3.5 mm line-in, or any mic) and fan it out to HTTP/WebSocket
///     subscribers as 16 kHz mono 16-bit LE PCM.
///  2. UPLINK — accept 16 kHz mono 16-bit LE PCM from a browser (your voice) and
///     play it on a chosen Windows OUTPUT (the carkit's speaker, which the phone
///     hears as the carkit mic).
///  3. DESK MODE — two local low-latency lanes so AirPods (or any PC headset)
///     carry the call while phone + carkit sit on the desk:
///        lane A: carkit input  → desk output  (you hear the caller)
///        lane B: desk mic      → carkit output (the caller hears you)
///
/// Why a carkit device at all: Windows blocks third-party apps from taking
/// Bluetooth call audio directly (PhoneLineTransportDevice is Phone-Link-only
/// since 22H2 — proven in scratch/PhoneLineProbe), so a carkit-class device or
/// 3.5 mm loopback is what physically lands call audio on a Windows endpoint.
///
/// Resampling is done with NAudio's managed WDL resampler (no Media Foundation
/// dependency), so lanes work the same on ARM64 as on x64.
/// </summary>
public sealed class CallAudioBridgeService : IDisposable
{
    public const int OutputSampleRate = 16000;   // downlink/uplink wire format: mono 16-bit LE

    public Action<string>? Log { get; set; }

    public sealed record InputDevice(string Id, string Name, bool IsDefault);

    // ── Persisted configuration ───────────────────────────────────────────
    public sealed class Config
    {
        public string CarkitInputId  { get; set; } = "";   // call audio arrives here
        public string CarkitOutputId { get; set; } = "";   // your voice plays out here (phone-side)
        public string DeskOutputId   { get; set; } = "";   // AirPods / headset render
        public string DeskMicId      { get; set; } = "";   // AirPods / headset capture
        public bool   AutoEngageDeskMode { get; set; } = false;
    }

    private static readonly string ConfigPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "DeskPhone", "call-audio.json");

    public Config Settings { get; private set; } = new();

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
    private double _resamplePos;
    private float _lastLevel;
    private bool _disposed;

    public bool IsRunning { get; private set; }
    public string CurrentDeviceName => _deviceName;
    public string CurrentDeviceId => _deviceId;
    public float LastLevel => _lastLevel;
    public int SubscriberCount { get { lock (_lock) return _subs.Count; } }

    public CallAudioBridgeService()
    {
        try
        {
            if (File.Exists(ConfigPath))
                Settings = JsonSerializer.Deserialize<Config>(File.ReadAllText(ConfigPath)) ?? new Config();
        }
        catch { Settings = new Config(); }
    }

    public void SaveConfig()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(ConfigPath)!);
            File.WriteAllText(ConfigPath, JsonSerializer.Serialize(Settings,
                new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception ex) { Log?.Invoke($"[call-audio] config save failed: {ex.Message}"); }
    }

    // ── Device enumeration ────────────────────────────────────────────────
    public List<InputDevice> ListInputs()  => ListEndpoints(DataFlow.Capture);
    public List<InputDevice> ListOutputs() => ListEndpoints(DataFlow.Render);

    private List<InputDevice> ListEndpoints(DataFlow flow)
    {
        var list = new List<InputDevice>();
        string defaultId = "";
        try { defaultId = _enum.GetDefaultAudioEndpoint(flow, Role.Communications).ID; }
        catch { /* no default device for this flow */ }

        foreach (var d in _enum.EnumerateAudioEndPoints(flow, DeviceState.Active))
        {
            try { list.Add(new InputDevice(d.ID, d.FriendlyName, d.ID == defaultId)); }
            catch { /* skip devices that throw on property read */ }
        }
        return list;
    }

    private MMDevice ResolveDevice(string? id, DataFlow flow)
        => string.IsNullOrWhiteSpace(id)
            ? _enum.GetDefaultAudioEndpoint(flow, Role.Communications)
            : _enum.GetDevice(id);

    // ═══════════════════════════════════════════════════════════════════════
    //  1) DOWNLINK — capture → 16 kHz mono PCM fan-out
    // ═══════════════════════════════════════════════════════════════════════
    public void Start(string? deviceId)
    {
        lock (_lock)
        {
            if (_disposed) return;
            StopCaptureLocked();

            MMDevice device;
            try { device = ResolveDevice(deviceId, DataFlow.Capture); }
            catch (Exception ex)
            {
                Log?.Invoke($"[call-audio] device open failed: {ex.Message}");
                throw;
            }

            _deviceId   = device.ID;
            _deviceName = device.FriendlyName;
            _resamplePos = 0;

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

    public void Stop() { lock (_lock) StopCaptureLocked(); }

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

    private void OnDataAvailable(object? sender, WaveInEventArgs e)
    {
        var fmt = _capture?.WaveFormat;
        if (fmt is null || e.BytesRecorded == 0) return;

        float[] mono = DownmixToMonoFloat(e.Buffer, e.BytesRecorded, fmt);
        if (mono.Length == 0) return;

        float peak = 0;
        for (int i = 0; i < mono.Length; i++) { var a = Math.Abs(mono[i]); if (a > peak) peak = a; }
        _lastLevel = peak;

        byte[] pcm = ResampleToPcm16(mono, fmt.SampleRate);
        if (pcm.Length == 0) return;

        lock (_lock)
        {
            foreach (var sub in _subs)
            {
                if (!sub.Queue.Writer.TryWrite(pcm))
                {
                    sub.Queue.Reader.TryRead(out _);   // drop oldest so latency stays bounded
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

        return Array.Empty<float>();
    }

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
        int estimate = (int)(mono.Length / step) + 2;
        var outBuf = new byte[estimate * 2];
        int written = 0;

        while (pos < mono.Length - 1)
        {
            int i = (int)pos;
            double frac = pos - i;
            float s = (float)(mono[i] * (1 - frac) + mono[i + 1] * frac);
            WriteSample(outBuf, written, s);
            written += 2;
            pos += step;
        }

        _resamplePos = pos - mono.Length;
        if (_resamplePos < 0) _resamplePos = 0;

        if (written == outBuf.Length) return outBuf;
        var exact = new byte[written];
        Array.Copy(outBuf, exact, written);
        return exact;
    }

    private static void WriteSample(byte[] dst, int offset, float sample)
    {
        short v = (short)Math.Clamp((int)(sample * 32767f), short.MinValue, short.MaxValue);
        dst[offset]     = (byte)(v & 0xFF);
        dst[offset + 1] = (byte)((v >> 8) & 0xFF);
    }

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
                try { Start(string.IsNullOrWhiteSpace(Settings.CarkitInputId) ? null : Settings.CarkitInputId); }
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
                StopCaptureLocked();
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

    // ═══════════════════════════════════════════════════════════════════════
    //  2) UPLINK — 16 kHz mono PCM in → chosen output device
    // ═══════════════════════════════════════════════════════════════════════
    private WasapiOut? _uplinkOut;
    private BufferedWaveProvider? _uplinkBuffer;
    private string _uplinkDeviceName = "";
    private long _uplinkBytes;

    public bool UplinkActive { get; private set; }
    public string UplinkDeviceName => _uplinkDeviceName;
    public long UplinkBytesReceived => Interlocked.Read(ref _uplinkBytes);

    /// <summary>Start the uplink renderer on <paramref name="deviceId"/>, the
    /// configured carkit output, or the default communications output.</summary>
    public void StartUplink(string? deviceId = null)
    {
        lock (_lock)
        {
            if (_disposed) return;
            StopUplinkLocked();

            var resolved = !string.IsNullOrWhiteSpace(deviceId) ? deviceId
                         : !string.IsNullOrWhiteSpace(Settings.CarkitOutputId) ? Settings.CarkitOutputId
                         : null;

            MMDevice device;
            try { device = ResolveDevice(resolved, DataFlow.Render); }
            catch (Exception ex)
            {
                Log?.Invoke($"[call-audio] uplink device open failed: {ex.Message}");
                throw;
            }

            var wire = new WaveFormat(OutputSampleRate, 16, 1);
            var buffer = new BufferedWaveProvider(wire)
            {
                BufferDuration = TimeSpan.FromMilliseconds(600),
                DiscardOnBufferOverflow = true,     // a slow device must not grow latency
                ReadFully = true                    // emit silence on underrun, keep device hot
            };

            var output = new WasapiOut(device, AudioClientShareMode.Shared, true, 60);
            output.Init(BuildAdaptedProvider(buffer, device));
            output.PlaybackStopped += (_, e) =>
            {
                if (e.Exception is not null)
                    Log?.Invoke($"[call-audio] uplink playback stopped: {e.Exception.Message}");
            };
            output.Play();

            _uplinkOut = output;
            _uplinkBuffer = buffer;
            _uplinkDeviceName = device.FriendlyName;
            _uplinkBytes = 0;
            UplinkActive = true;
            Log?.Invoke($"[call-audio] uplink started on '{_uplinkDeviceName}'");
        }
    }

    public void WriteUplink(byte[] pcm, int offset, int count)
    {
        var buf = _uplinkBuffer;
        if (buf is null || count <= 0) return;
        try
        {
            buf.AddSamples(pcm, offset, count);
            Interlocked.Add(ref _uplinkBytes, count);
        }
        catch (Exception ex) { Log?.Invoke($"[call-audio] uplink write failed: {ex.Message}"); }
    }

    public void StopUplink() { lock (_lock) StopUplinkLocked(); }

    private void StopUplinkLocked()
    {
        if (_uplinkOut is null) return;
        try { _uplinkOut.Stop(); _uplinkOut.Dispose(); } catch { }
        _uplinkOut = null;
        _uplinkBuffer = null;
        _uplinkDeviceName = "";
        UplinkActive = false;
        Log?.Invoke("[call-audio] uplink stopped");
    }

    /// <summary>Adapts a buffered source to a render device's mix format using
    /// NAudio's managed WDL resampler — no Media Foundation, so it behaves the
    /// same on ARM64 as on x64 and avoids per-device DMO surprises.</summary>
    private static IWaveProvider BuildAdaptedProvider(BufferedWaveProvider source, MMDevice device)
    {
        var mix = device.AudioClient.MixFormat;
        ISampleProvider sp = source.ToSampleProvider();

        if (sp.WaveFormat.SampleRate != mix.SampleRate)
            sp = new WdlResamplingSampleProvider(sp, mix.SampleRate);

        if (sp.WaveFormat.Channels == 1 && mix.Channels >= 2)
            sp = new MonoToStereoSampleProvider(sp);
        else if (sp.WaveFormat.Channels == 2 && mix.Channels == 1)
            sp = new StereoToMonoSampleProvider(sp);

        return new SampleToWaveProvider(sp);   // IEEE float — WASAPI shared accepts this
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  3) DESK MODE — two local lanes (carkit↔headset) for at-the-desk calls
    // ═══════════════════════════════════════════════════════════════════════
    private sealed class AudioLane : IDisposable
    {
        private readonly WasapiCapture _capture;
        private readonly WasapiOut _output;
        private readonly BufferedWaveProvider _buffer;
        private float _level;

        public string Name { get; }
        public string SourceName { get; }
        public string TargetName { get; }
        public float Level => _level;
        public bool Faulted { get; private set; }

        public AudioLane(string name, MMDevice source, MMDevice target, Action<string>? log)
        {
            Name = name;
            SourceName = source.FriendlyName;
            TargetName = target.FriendlyName;

            _capture = new WasapiCapture(source) { ShareMode = AudioClientShareMode.Shared };
            _buffer = new BufferedWaveProvider(_capture.WaveFormat)
            {
                BufferDuration = TimeSpan.FromMilliseconds(400),
                DiscardOnBufferOverflow = true,
                ReadFully = true
            };

            _capture.DataAvailable += (_, e) =>
            {
                if (e.BytesRecorded == 0) return;
                _level = QuickPeak(e.Buffer, e.BytesRecorded, _capture.WaveFormat);
                try { _buffer.AddSamples(e.Buffer, 0, e.BytesRecorded); } catch { }
            };
            _capture.RecordingStopped += (_, e) =>
            {
                if (e.Exception is not null) { Faulted = true; log?.Invoke($"[desk-mode] lane '{name}' capture fault: {e.Exception.Message}"); }
            };

            _output = new WasapiOut(target, AudioClientShareMode.Shared, true, 60);
            _output.Init(BuildAdaptedProvider(_buffer, target));
            _output.PlaybackStopped += (_, e) =>
            {
                if (e.Exception is not null) { Faulted = true; log?.Invoke($"[desk-mode] lane '{name}' render fault: {e.Exception.Message}"); }
            };

            _capture.StartRecording();
            _output.Play();
        }

        private static float QuickPeak(byte[] buf, int bytes, WaveFormat fmt)
        {
            // Sample sparsely — this is a UI meter, not DSP.
            float peak = 0;
            if (fmt.Encoding == WaveFormatEncoding.IeeeFloat && fmt.BitsPerSample == 32)
            {
                for (int i = 0; i + 4 <= bytes; i += 64)
                {
                    var a = Math.Abs(BitConverter.ToSingle(buf, i));
                    if (a > peak) peak = a;
                }
            }
            else if (fmt.Encoding == WaveFormatEncoding.Pcm && fmt.BitsPerSample == 16)
            {
                for (int i = 0; i + 2 <= bytes; i += 32)
                {
                    var a = Math.Abs((int)BitConverter.ToInt16(buf, i)) / 32768f;
                    if (a > peak) peak = a;
                }
            }
            return peak;
        }

        public void Dispose()
        {
            try { _capture.StopRecording(); } catch { }
            try { _capture.Dispose(); } catch { }
            try { _output.Stop(); } catch { }
            try { _output.Dispose(); } catch { }
        }
    }

    private AudioLane? _laneHear;   // carkit input → desk output
    private AudioLane? _laneTalk;   // desk mic     → carkit output

    public bool DeskModeEngaged { get; private set; }

    public sealed record LaneStatus(string Name, string Source, string Target, float Level, bool Faulted);

    public List<LaneStatus> DeskLaneStatus()
    {
        var list = new List<LaneStatus>();
        var hear = _laneHear;
        var talk = _laneTalk;
        if (hear is not null) list.Add(new LaneStatus(hear.Name, hear.SourceName, hear.TargetName, hear.Level, hear.Faulted));
        if (talk is not null) list.Add(new LaneStatus(talk.Name, talk.SourceName, talk.TargetName, talk.Level, talk.Faulted));
        return list;
    }

    /// <summary>Start the configured desk lanes. Each lane starts only when both
    /// of its devices are configured; a half-configured desk still half-works.</summary>
    public string EngageDeskMode()
    {
        lock (_lock)
        {
            if (_disposed) return "engine disposed";
            ReleaseDeskModeLocked();

            var notes = new List<string>();

            if (!string.IsNullOrWhiteSpace(Settings.CarkitInputId) &&
                !string.IsNullOrWhiteSpace(Settings.DeskOutputId))
            {
                try
                {
                    _laneHear = new AudioLane("hear",
                        _enum.GetDevice(Settings.CarkitInputId),
                        _enum.GetDevice(Settings.DeskOutputId), Log);
                    notes.Add($"hear: {_laneHear.SourceName} → {_laneHear.TargetName}");
                }
                catch (Exception ex) { notes.Add($"hear lane failed: {ex.Message}"); Log?.Invoke($"[desk-mode] hear lane failed: {ex.Message}"); }
            }
            else notes.Add("hear lane skipped (carkit input / desk output not configured)");

            if (!string.IsNullOrWhiteSpace(Settings.DeskMicId) &&
                !string.IsNullOrWhiteSpace(Settings.CarkitOutputId))
            {
                try
                {
                    _laneTalk = new AudioLane("talk",
                        _enum.GetDevice(Settings.DeskMicId),
                        _enum.GetDevice(Settings.CarkitOutputId), Log);
                    notes.Add($"talk: {_laneTalk.SourceName} → {_laneTalk.TargetName}");
                }
                catch (Exception ex) { notes.Add($"talk lane failed: {ex.Message}"); Log?.Invoke($"[desk-mode] talk lane failed: {ex.Message}"); }
            }
            else notes.Add("talk lane skipped (desk mic / carkit output not configured)");

            DeskModeEngaged = _laneHear is not null || _laneTalk is not null;
            var summary = string.Join("; ", notes);
            Log?.Invoke($"[desk-mode] engage → {summary}");
            return summary;
        }
    }

    public void ReleaseDeskMode() { lock (_lock) ReleaseDeskModeLocked(); }

    private void ReleaseDeskModeLocked()
    {
        if (_laneHear is null && _laneTalk is null) { DeskModeEngaged = false; return; }
        try { _laneHear?.Dispose(); } catch { }
        try { _laneTalk?.Dispose(); } catch { }
        _laneHear = null;
        _laneTalk = null;
        DeskModeEngaged = false;
        Log?.Invoke("[desk-mode] released");
    }

    /// <summary>Called by the ViewModel on HFP call-state transitions. When
    /// auto-engage is on, desk lanes follow the call.</summary>
    public void OnCallStateChanged(bool callActive)
    {
        if (!Settings.AutoEngageDeskMode) return;
        try
        {
            if (callActive && !DeskModeEngaged) EngageDeskMode();
            else if (!callActive && DeskModeEngaged) ReleaseDeskMode();
        }
        catch (Exception ex) { Log?.Invoke($"[desk-mode] auto-engage error: {ex.Message}"); }
    }

    // ── Cleanup ───────────────────────────────────────────────────────────
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        lock (_lock)
        {
            foreach (var s in _subs.ToArray()) s.Queue.Writer.TryComplete();
            _subs.Clear();
            StopCaptureLocked();
            StopUplinkLocked();
            ReleaseDeskModeLocked();
        }
        try { _enum.Dispose(); } catch { }
    }
}
