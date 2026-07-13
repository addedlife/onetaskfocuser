// ── Live call-audio feed client ─────────────────────────────────────────────
// Talks to the DeskPhone host's call-audio bridge on this machine's loopback
// (ControlApiService.cs): GET /call-audio/state for capability, and the
// ws://127.0.0.1:8765/call-audio.ws socket for the live downlink — raw
// 16 kHz mono 16-bit LE PCM binary frames, captured host-side from the carkit
// input. Loopback is exempt from the mixed-content rule (a secure page may
// call http/ws on 127.0.0.1), and DeskPhone's auth layer never gates loopback
// callers, so this works from the production https app with zero setup.
//
// Why this exists: recording a call used to mean getDisplayMedia screen-share
// fiddling ("check Share tab audio…") or juggling Windows input/output
// devices. When the PC host link is up, this module turns the host's own
// call-audio capture into a plain MediaStream any recorder can consume —
// plug-and-play: one click, no dialogs, no device switching.

const FEED_HOST = '127.0.0.1:8765';
const STATE_URL = `http://${FEED_HOST}/call-audio/state`;
const WS_URL = `ws://${FEED_HOST}/call-audio.ws`;

// Is a DeskPhone call-audio bridge running on THIS machine? Resolves fast
// (default 1.2 s) so UI can probe on open without a hanging spinner.
export async function probeCallAudioFeed(timeoutMs = 1200) {
  if (typeof fetch !== 'function' || typeof AbortController !== 'function') return { available: false, state: null };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(STATE_URL, { signal: ctl.signal });
    if (!res.ok) return { available: false, state: null };
    const state = await res.json();
    return { available: true, state };
  } catch (_) {
    return { available: false, state: null };
  } finally {
    clearTimeout(timer);
  }
}

// Open the live downlink as a MediaStream.
//   monitor — also play the feed on this device's speakers (listen while recording).
// Returns { stream, stop, deviceName }; `stop` tears down socket + audio graph.
// Rejects if the socket can't open or no PCM arrives within `firstAudioMs`.
export async function openCallAudioFeed({ monitor = false, sampleRate = 16000, firstAudioMs = 6000 } = {}) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error('This browser has no Web Audio support.');

  const probe = await probeCallAudioFeed();
  if (!probe.available) throw new Error('The PC phone link (DeskPhone) is not running on this computer.');
  const deviceName = probe.state?.downlink?.deviceName || '';

  const ctx = new AC();
  try { await ctx.resume(); } catch (_) {}
  const dest = ctx.createMediaStreamDestination();
  const gain = ctx.createGain();
  gain.gain.value = 1;
  gain.connect(dest);
  if (monitor) gain.connect(ctx.destination);

  // Sequential scheduling: each PCM chunk becomes an AudioBuffer queued at a
  // running cursor — the standard low-complexity way to play a live PCM feed;
  // voice-grade latency (< 200 ms) without an AudioWorklet.
  let cursor = 0;
  const playChunk = (pcm) => {
    const samples = pcm.byteLength >> 1;
    if (!samples) return;
    const view = new DataView(pcm);
    const buf = ctx.createBuffer(1, samples, sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < samples; i++) ch[i] = view.getInt16(i * 2, true) / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    const now = ctx.currentTime;
    if (cursor < now + 0.05) cursor = now + 0.05;   // (re)prime a small jitter cushion
    src.start(cursor);
    cursor += buf.duration;
  };

  const ws = new WebSocket(WS_URL);
  ws.binaryType = 'arraybuffer';

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try { ws.close(); } catch (_) {}
    try { dest.stream.getTracks().forEach(t => t.stop()); } catch (_) {}
    try { ctx.close(); } catch (_) {}
  };

  await new Promise((resolve, reject) => {
    const fail = (msg) => { stop(); reject(new Error(msg)); };
    const firstAudioTimer = setTimeout(
      () => fail('Connected to the PC link, but no call audio arrived — is the call (and the carkit input) live?'),
      firstAudioMs,
    );
    ws.onopen = () => { /* wait for the first PCM frame before resolving */ };
    ws.onerror = () => { clearTimeout(firstAudioTimer); fail('Could not open the call-audio socket on the PC link.'); };
    ws.onmessage = (e) => {
      if (!(e.data instanceof ArrayBuffer)) return;
      clearTimeout(firstAudioTimer);
      playChunk(e.data);
      ws.onmessage = (ev) => { if (ev.data instanceof ArrayBuffer && !stopped) playChunk(ev.data); };
      resolve();
    };
    ws.onclose = () => { if (!stopped) { clearTimeout(firstAudioTimer); reject(new Error('The call-audio socket closed.')); } };
  });

  return { stream: dest.stream, stop, deviceName };
}
