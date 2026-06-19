import React, { useEffect, useMemo, useRef, useState } from 'react';
import { aiParseCalendarEvent, aiParseConversation, fmtMs, uid } from '../../01-core.js';
import { deletePendingRecording, savePendingRecording, transcribePendingRecording, updatePendingRecordingError } from '../../09-transcription-pen.js';
import { cleanTheme, ELEV, gvIconButton, ICON, NC_FONT_STACK, NC_TYPE, RADIUS, SP, suiteIcon } from '../ui-tokens.jsx';

function ConvCapture({ onClose, onApply, onCreateCalendarEvent, onRefreshCalendar, tasks, shailos, pris, aiOpts, T, callMode=false }) {
  const C = cleanTheme(T);
  // callMode (phone call)  → 'ready' phase (waiting for user to share screen).
  // mic mode ("Record anything") → 'choose' phase so the user can pick between
  // their microphone or capturing another screen's/app's audio output.
  const [phase, setPhase] = useState(callMode ? 'ready' : 'choose');
  const [liveText, setLiveText] = useState('');
  const [items, setItems] = useState([]);
  const [err, setErr] = useState('');
  const [applying, setApplying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  // Tracks which source the current recording is using ('mic' | 'system'),
  // so the recording UI and transcription label can reflect it.
  const [source, setSource] = useState(callMode ? 'system' : 'mic');
  const phaseRef = useRef(callMode ? 'ready' : 'choose');
  const streamRef = useRef(null);
  const mediaRecRef = useRef(null);
  const chunksRef = useRef([]);
  const mediaStopPRef = useRef(null);
  const segBufRef = useRef('');
  const liveRef = useRef('');
  const recogRef = useRef(null);
  const elapsedTmrRef = useRef(null);

  function normalizeMissingScheduleDetails(item) {
    const missing = new Set();
    if (!String(item?.date || '').trim()) missing.add('date');
    if (!String(item?.time || '').trim()) missing.add('time');
    if (!Number(item?.durationMinutes)) missing.add('duration');
    return Array.from(missing).filter(Boolean);
  }

  function normalizeScheduleItem(item) {
    const durationMinutes = Number(item?.durationMinutes);
    const next = {
      ...item,
      date: String(item?.date || '').trim(),
      time: String(item?.time || '').trim(),
      when: String(item?.when || '').trim(),
      durationMinutes: Number.isFinite(durationMinutes) && durationMinutes > 0 ? Math.round(durationMinutes) : '',
      unclearReason: String(item?.unclearReason || '').trim(),
    };
    next.missingDetails = normalizeMissingScheduleDetails(next);
    return next;
  }

  function goPhase(p) { phaseRef.current = p; setPhase(p); }

  function startMediaRecorder(stream) {
    streamRef.current = stream;
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    const mr = new MediaRecorder(stream, { mimeType });
    mediaRecRef.current = mr;
    mr.ondataavailable = e => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
    mr.start(200);
    elapsedTmrRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
  }

  // Mic capture: triggered when the user picks "My microphone" on the choose
  // screen (or immediately in legacy flows). Records the user's own voice via
  // getUserMedia and live-transcribes with the browser's SpeechRecognition.
  function startMicCapture() {
    setErr('');
    setSource('mic');
    goPhase('recording');
    chunksRef.current = [];
    segBufRef.current = '';
    liveRef.current = '';

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      const r = new SR();
      recogRef.current = r;
      r.continuous = true; r.interimResults = true; r.lang = 'en-US';
      r.onresult = e => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) segBufRef.current = (segBufRef.current + ' ' + e.results[i][0].transcript).trim();
          else interim = e.results[i][0].transcript;
        }
        const full = (segBufRef.current + (interim ? ' ' + interim : '')).trim();
        liveRef.current = full;
        setLiveText(full);
      };
      r.onend = () => { if (phaseRef.current === 'recording') { try { r.start(); } catch(_) {} } };
      try { r.start(); } catch(_) {}
    }

    setTimeout(async () => {
      if (phaseRef.current !== 'recording') return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (phaseRef.current !== 'recording') { stream.getTracks().forEach(t => t.stop()); return; }
        startMediaRecorder(stream);
      } catch(_) { setErr('Mic permission denied. Enable mic and try again.'); }
    }, 300);
  }

  // Unmount cleanup — always tear down recognizer, recorder, stream and timers.
  useEffect(() => {
    return () => {
      clearInterval(elapsedTmrRef.current);
      if (recogRef.current) { try { recogRef.current.onend = null; recogRef.current.abort(); } catch(_) {} }
      if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') { try { mediaRecRef.current.stop(); } catch(_) {} }
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); }
    };
  }, []); // eslint-disable-line

  // System-audio capture: triggered by "Start capturing" (call mode) or by
  // picking "Other screen's audio" on the choose screen. Captures another
  // tab/window/app's audio output via getDisplayMedia — no mic involved.
  async function startCallCapture() {
    setErr('');
    setSource('system');
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 44100 },
        video: { width: 1, height: 1 },
      });
      const audioTracks = displayStream.getAudioTracks();
      if (!audioTracks.length) {
        displayStream.getTracks().forEach(t => t.stop());
        setErr('No audio captured. Make sure to check "Share tab/system audio" in the browser dialog.');
        return;
      }
      // Stop the video track immediately — we only need audio
      displayStream.getVideoTracks().forEach(t => t.stop());
      const audioStream = new MediaStream(audioTracks);
      chunksRef.current = [];
      startMediaRecorder(audioStream);
      goPhase('recording');
    } catch(e) {
      if (e.name !== 'NotAllowedError') setErr('Could not capture audio: ' + e.message);
    }
  }

  async function stopAndProcess() {
    clearInterval(elapsedTmrRef.current);
    const webSpeechText = liveRef.current || segBufRef.current || '';
    if (recogRef.current) { try { recogRef.current.onend = null; recogRef.current.abort(); } catch(_) {} recogRef.current = null; }
    if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') {
      mediaStopPRef.current = new Promise(res => { mediaRecRef.current.onstop = res; });
      try { mediaRecRef.current.stop(); } catch(_) { mediaStopPRef.current = null; }
    }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    goPhase('processing');
    let pending = null;

    try {
      if (mediaStopPRef.current) { await mediaStopPRef.current; mediaStopPRef.current = null; }
      const webmBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
      let transcript = webSpeechText;

      if (webmBlob.size >= 500 && aiOpts) {
        pending = await savePendingRecording(webmBlob, source === 'system' ? 'conversation_call' : 'conversation_mic', {
          source: 'main',
          label: source === 'system' ? 'Conversation system-audio capture' : 'Conversation mic capture',
        });
        // If Gemini transcription fails, fall back to Web Speech text — never kill the whole flow
        try {
          const geminiTranscript = await transcribePendingRecording(
            pending.id, aiOpts,
            `Transcribe this audio recording exactly verbatim. The speaker uses Yeshivish — Orthodox Jewish English with Hebrew and Yiddish terminology. Common words: shaila/shailos, halacha, gemara, Shabbos, davening, daven, bracha, mutar, assur, kashrus, Rashi, Rambam, psak, teshuvah, beis din, shiur, kollel, bochur, yeshiva, Hashem, Baruch Hashem, kiddush, Yom Tov, Pesach, Sukkos, Shavuos, chavrusa, beis medrash, machlokes, pshat, tzaddik, tzedakah, chasuna, mazel tov, maariv, mincha, shacharis, tefillin, mezuzah, sukkah, mikvah, niddah, safeik, treif, fleishig, milchig, pareve, shidduch, simcha.\n\nReturn only the verbatim transcript. No summary, no rephrasing, no meta-commentary.`
          );
          if (geminiTranscript?.trim()) transcript = geminiTranscript.trim();
        } catch(transcriptErr) {
          // Transcription failed — keep Web Speech fallback if available, otherwise continue with empty
          console.warn('[ConvCapture] Gemini transcription failed, using Web Speech fallback:', transcriptErr.message);
        }
      }

      if (!transcript.trim()) {
        setErr(source === 'system' ? 'No audio was captured. Make sure audio was playing and you checked "Share tab/system audio".' : 'Nothing was captured. Check mic permissions and try again.');
        setItems([]);
        goPhase('review');
        return;
      }

      const parsed = await aiParseConversation(transcript, tasks, shailos, aiOpts);

      const existingTaskTexts = new Set(
        (tasks || []).map(t => (t.text || '').trim().toLowerCase()).filter(Boolean)
      );
      const existingShailaTexts = new Set(
        (shailos || []).flatMap(s => [
          (s.synopsis || '').trim().toLowerCase(),
          (s.content || '').trim().toLowerCase(),
          (s.text || '').trim().toLowerCase()
        ].filter(Boolean))
      );

      const filteredTasks = (parsed.tasks || []).filter(t => {
        const txt = (t.text || '').trim().toLowerCase();
        return txt && !existingTaskTexts.has(txt);
      });
      const filteredShailos = (parsed.shailos || []).filter(s => {
        const syn = (s.synopsis || '').trim().toLowerCase();
        const content = (s.content || '').trim().toLowerCase();
        if (syn && existingShailaTexts.has(syn)) return false;
        if (content && existingShailaTexts.has(content)) return false;
        return true;
      });

      const allItems = [];
      const add = (cat, arr) => (arr || []).forEach(item => {
        const next = cat === 'scheduleItems' ? normalizeScheduleItem(item) : item;
        allItems.push({ id: uid(), cat, approved: true, ...next });
      });
      add('tasks', filteredTasks);
      add('shailos', filteredShailos);
      add('gotBacks', parsed.gotBacks);
      add('completions', parsed.completions);
      add('scheduleItems', parsed.scheduleItems);
      add('reminders', parsed.reminders);
      setItems(allItems);
      if (pending?.id) await deletePendingRecording(pending.id);
      goPhase('review');
    } catch(e) {
      if (typeof pending !== 'undefined' && pending?.id) {
        await updatePendingRecordingError(pending.id, e.message || String(e)).catch(() => {});
      }
      setErr('Could not process: ' + e.message);
      setItems([]);
      goPhase('review');
    }
  }

  function toggleApproved(id) { setItems(prev => prev.map(it => it.id === id ? {...it, approved: !it.approved} : it)); }
  function updateText(id, text) { setItems(prev => prev.map(it => it.id === id ? {...it, text} : it)); }
  function updatePriority(id, priority) { setItems(prev => prev.map(it => it.id === id ? {...it, priority} : it)); }
  function updateCategory(id, cat) { setItems(prev => prev.map(it => it.id === id ? {...it, cat} : it)); }
  function updateScheduleField(id, field, value) {
    setItems(prev => prev.map(it => {
      if (it.id !== id) return it;
      const next = normalizeScheduleItem({ ...it, [field]: value });
      return next;
    }));
  }

  function scheduleDescription(it) {
    const parts = [];
    if (it.date) parts.push(`date: ${it.date}`);
    if (it.time) parts.push(`start time: ${it.time}`);
    if (it.durationMinutes) parts.push(`duration: ${it.durationMinutes} minutes`);
    if (it.when) parts.push(`spoken timing: ${it.when}`);
    return parts.length ? `${it.text} (${parts.join(', ')})` : it.text;
  }

  function scheduleMissingDetails(it) {
    return normalizeMissingScheduleDetails(it);
  }

  async function applyApproved() {
    if (applying) return;
    const approved = items.filter(it => it.approved);
    let shouldClose = false;
    setApplying(true); setErr('');
    try {
      const scheduleItems = approved.filter(it => it.cat === 'scheduleItems');
      if (scheduleItems.length && !onCreateCalendarEvent) throw new Error('Reconnect Google to add calendar events.');
      const incomplete = scheduleItems.find(it => scheduleMissingDetails(it).length);
      if (incomplete) {
        const missing = scheduleMissingDetails(incomplete).join(', ');
        throw new Error(`Fill ${missing} for "${incomplete.text || 'schedule item'}" before adding it to Calendar.`);
      }
      for (const it of scheduleItems) {
        const eventBody = await aiParseCalendarEvent(scheduleDescription(it), aiOpts);
        await onCreateCalendarEvent(eventBody);
      }
      if (scheduleItems.length) onRefreshCalendar?.();
      approved.forEach(it => {
        if (it.cat === 'tasks')         onApply(it.text, it.priority || 'eventually');
        else if (it.cat === 'shailos') onApply(it.text || it.synopsis || it.content || 'Shaila', 'shaila');
        else if (it.cat === 'reminders') onApply(it.text, 'eventually');
        // completions + gotBacks are info-only for now
      });
      shouldClose = true;
    } catch (e) {
      setErr(e.message || 'Could not add calendar event.');
    } finally {
      setApplying(false);
      if (shouldClose) onClose();
    }
  }

  const approvedCount = items.filter(it => it.approved).length;
  const mm = String(Math.floor(elapsed / 60)).padStart(1, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const fmtElapsed = `${mm}:${ss}`;

  const SECTIONS = [
    { cat: 'tasks',        color: C.accent,   label: 'New Tasks' },
    { cat: 'shailos',      color: '#C8A84C',  label: 'Shailos' },
    { cat: 'gotBacks',     color: '#2ECC71',  label: 'Got Back to Asker' },
    { cat: 'completions',  color: '#27AE60',  label: 'Mark Complete' },
    { cat: 'scheduleItems',color: '#9B59B6',  label: 'Schedule' },
    { cat: 'reminders',    color: C.warning,  label: 'Reminders' },
  ];

  const overlayS = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: SP.lg };
  const cardS    = { background: C.bg, borderRadius: RADIUS.md, maxWidth: 560, width: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: ELEV[4], fontFamily: 'inherit' };
  const CloseBtn = () => (
    <button onClick={onClose} style={gvIconButton({ width: 32, height: 32, borderRadius: RADIUS.pill }, C)}>
      {suiteIcon("close", ICON.md)}
    </button>
  );

  // ── Choose source: mic vs. another screen's audio ─────────────────────────
  if (phase === 'choose') return (
    <div style={overlayS} onClick={onClose}>
      <div style={cardS} onClick={e => e.stopPropagation()}>
        <div style={{ padding: `${SP.xl} ${SP.xl} ${SP.lg}`, borderBottom: `1px solid ${C.divider}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.md }}>
            <span style={{ fontSize: NC_TYPE.title, fontWeight: 500, color: C.text }}>Record anything</span>
            <CloseBtn />
          </div>
          <div style={{ fontSize: NC_TYPE.body, color: C.muted, fontFamily: NC_FONT_STACK, lineHeight: 1.55 }}>
            What should I listen to?
          </div>
          {err && <div style={{ fontSize: NC_TYPE.meta, color: C.danger, fontFamily: NC_FONT_STACK, marginTop: SP.sm }}>{err}</div>}
        </div>
        <div style={{ padding: `${SP.lg} ${SP.xl}`, display: 'flex', flexDirection: 'column', gap: SP.md }}>
          <button onClick={startMicCapture} style={{ display: 'flex', alignItems: 'center', gap: SP.md, textAlign: 'left', background: C.bgSoft, border: `1px solid ${C.divider}`, borderRadius: RADIUS.md, padding: `${SP.md} ${SP.lg}`, cursor: 'pointer', fontFamily: NC_FONT_STACK }}>
            <span style={{ fontSize: 22 }}>🎤</span>
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: NC_TYPE.body, fontWeight: 500, color: C.text }}>My microphone</span>
              <span style={{ fontSize: NC_TYPE.meta, color: C.faint }}>Record what you say out loud</span>
            </span>
          </button>
          <button onClick={startCallCapture} style={{ display: 'flex', alignItems: 'center', gap: SP.md, textAlign: 'left', background: C.bgSoft, border: `1px solid ${C.divider}`, borderRadius: RADIUS.md, padding: `${SP.md} ${SP.lg}`, cursor: 'pointer', fontFamily: NC_FONT_STACK }}>
            <span style={{ fontSize: 22 }}>🔊</span>
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: NC_TYPE.body, fontWeight: 500, color: C.text }}>Another screen's audio</span>
              <span style={{ fontSize: NC_TYPE.meta, color: C.faint }}>Capture a tab/window/app's sound — check "Share audio" in the dialog</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );

  // ── Call mode: waiting for user to share screen ───────────────────────────
  if (phase === 'ready') return (
    <div style={overlayS} onClick={onClose}>
      <div style={cardS} onClick={e => e.stopPropagation()}>
        <div style={{ padding: `${SP.xl} ${SP.xl} ${SP.lg}`, borderBottom: `1px solid ${C.divider}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.md }}>
            <span style={{ fontSize: NC_TYPE.title, fontWeight: 500, color: C.text }}>Capture Call Audio</span>
            <CloseBtn />
          </div>
          <div style={{ fontSize: NC_TYPE.body, color: C.muted, fontFamily: NC_FONT_STACK, lineHeight: 1.55, marginBottom: SP.md }}>
            Click <strong>Start capturing</strong>, then in the browser dialog:<br/>
            1. Select the tab or window playing the call<br/>
            2. Check <em>"Share tab audio"</em> before clicking Share
          </div>
          {err && <div style={{ fontSize: NC_TYPE.meta, color: C.danger, fontFamily: NC_FONT_STACK, marginBottom: SP.sm }}>{err}</div>}
        </div>
        <div style={{ padding: `${SP.lg} ${SP.xl}`, display: 'flex', gap: SP.sm, justifyContent: 'center' }}>
          <button onClick={startCallCapture} style={{ background: C.accent, color: '#fff', border: 'none', borderRadius: RADIUS.md, padding: `${SP.md} ${SP.xl}`, fontSize: NC_TYPE.body, fontWeight: 500, cursor: 'pointer', fontFamily: NC_FONT_STACK }}>
            Start capturing
          </button>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${C.divider}`, borderRadius: RADIUS.md, padding: `${SP.md} ${SP.lg}`, fontSize: NC_TYPE.body, color: C.muted, cursor: 'pointer', fontFamily: NC_FONT_STACK }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  if (phase === 'recording') return (
    <div style={overlayS} onClick={onClose}>
      <style>{`@keyframes conv-pulse{0%,100%{opacity:1}50%{opacity:.25}}`}</style>
      <div style={cardS} onClick={e => e.stopPropagation()}>
        <div style={{ padding: `${SP.xl} ${SP.xl} ${SP.lg}`, borderBottom: `1px solid ${C.divider}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.md }}>
            <span style={{ fontSize: NC_TYPE.title, fontWeight: 500, color: C.text }}>{source === 'system' ? 'Capturing Screen Audio' : 'Recording Conversation'}</span>
            <CloseBtn />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: SP.sm, marginBottom: SP.md }}>
            <div style={{ width: 10, height: 10, borderRadius: RADIUS.pill, background: C.danger, animation: 'conv-pulse 1.4s ease infinite' }}/>
            <span style={{ fontSize: NC_TYPE.meta, color: C.muted, fontFamily: NC_FONT_STACK, fontVariantNumeric: 'tabular-nums' }}>{fmtElapsed}</span>
            <span style={{ fontSize: NC_TYPE.meta, color: C.faint, fontFamily: NC_FONT_STACK }}>{source === 'system' ? 'Listening to the shared audio — AI will extract everything' : 'Speak freely — AI will extract everything'}</span>
          </div>
          {liveText && (
            <div style={{ fontSize: NC_TYPE.meta, color: C.faint, fontFamily: NC_FONT_STACK, lineHeight: 1.5, maxHeight: 72, overflowY: 'auto', background: C.bgSoft, borderRadius: RADIUS.sm, padding: `${SP.sm} ${SP.md}`, border: `1px solid ${C.divider}` }}>
              {liveText}
            </div>
          )}
          {err && <div style={{ fontSize: NC_TYPE.meta, color: C.danger, fontFamily: NC_FONT_STACK, marginTop: SP.sm }}>{err}</div>}
        </div>
        <div style={{ padding: `${SP.lg} ${SP.xl}`, display: 'flex', gap: SP.sm, justifyContent: 'center' }}>
          <button onClick={stopAndProcess} style={{ background: C.danger, color: '#fff', border: 'none', borderRadius: RADIUS.md, padding: `${SP.md} ${SP.xl}`, fontSize: NC_TYPE.body, fontWeight: 500, cursor: 'pointer', fontFamily: NC_FONT_STACK }}>
            Stop &amp; Process
          </button>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${C.divider}`, borderRadius: RADIUS.md, padding: `${SP.md} ${SP.lg}`, fontSize: NC_TYPE.body, color: C.muted, cursor: 'pointer', fontFamily: NC_FONT_STACK }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  if (phase === 'processing') return (
    <div style={overlayS}>
      <div style={{ ...cardS, alignItems: 'center', justifyContent: 'center', padding: `56px ${SP.xl}`, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: SP.lg }}>🎙️</div>
        <div style={{ fontSize: NC_TYPE.title, fontWeight: 500, color: C.text, marginBottom: SP.sm, fontFamily: NC_FONT_STACK }}>Processing conversation…</div>
        <div style={{ fontSize: NC_TYPE.meta, color: C.faint, fontFamily: NC_FONT_STACK }}>Transcribing and extracting items</div>
      </div>
    </div>
  );

  // ── Review phase ──────────────────────────────────────────────────────────
  return (
    <div style={overlayS} onClick={onClose}>
      <div style={cardS} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: `${SP.lg} ${SP.xl} ${SP.md}`, borderBottom: `1px solid ${C.divider}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: NC_TYPE.title, fontWeight: 500, color: C.text }}>Found in this conversation</div>
              <div style={{ fontSize: NC_TYPE.meta, color: C.faint, fontFamily: NC_FONT_STACK, marginTop: 3 }}>
                {items.length} item{items.length !== 1 ? 's' : ''} — check what to add
              </div>
            </div>
            <CloseBtn />
          </div>
          {err && <div style={{ fontSize: NC_TYPE.meta, color: C.danger, fontFamily: NC_FONT_STACK, marginTop: SP.sm }}>{err}</div>}
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: `${SP.md} ${SP.xl} ${SP.xs}` }}>
          {items.length === 0 && (
            <div style={{ textAlign: 'center', padding: '36px 0', color: C.faint, fontFamily: NC_FONT_STACK, fontSize: NC_TYPE.body }}>
              No actionable items found in this conversation.
            </div>
          )}
          {SECTIONS.map(({ cat, color, label }) => {
            const sItems = items.filter(it => it.cat === cat);
            if (!sItems.length) return null;
            return (
              <div key={cat} style={{ marginBottom: SP.lg }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm }}>
                  <div style={{ width: 3, height: 18, background: color, borderRadius: 2, flexShrink: 0 }}/>
                  <span style={{ fontSize: NC_TYPE.meta, fontWeight: 500, color: C.text, fontFamily: NC_FONT_STACK }}>{label}</span>
                  <span style={{ fontSize: NC_TYPE.small, background: color + '22', color, borderRadius: RADIUS.pill, padding: '1px 7px', fontFamily: NC_FONT_STACK, fontWeight: 500 }}>{sItems.length}</span>
                </div>
                {sItems.map(it => (
                  <div key={it.id} style={{ display: 'flex', alignItems: 'flex-start', gap: SP.sm, padding: '7px 0', borderBottom: `1px solid ${C.divider}` }}>
                    <input type="checkbox" checked={it.approved} onChange={() => toggleApproved(it.id)}
                      style={{ marginTop: 5, accentColor: color, flexShrink: 0, cursor: 'pointer', width: 14, height: 14 }}/>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <input
                        value={it.text || it.synopsis || ''}
                        onChange={e => updateText(it.id, e.target.value)}
                        style={{ width: '100%', background: 'none', border: 'none', borderBottom: `1px solid ${C.divider}`, color: C.text, fontSize: NC_TYPE.body, fontFamily: NC_FONT_STACK, padding: '2px 0', outline: 'none', boxSizing: 'border-box' }}
                      />
                      {!['completions', 'gotBacks'].includes(cat) && (
                        <div style={{ display: 'flex', gap: SP.sm, alignItems: 'center', flexWrap: 'wrap', marginTop: SP.xs }}>
                          <select value={it.cat} onChange={e => updateCategory(it.id, e.target.value)}
                            style={{ fontSize: NC_TYPE.meta, background: C.bgSoft, border: `1px solid ${C.divider}`, borderRadius: RADIUS.xs, color: C.muted, padding: '2px 6px', cursor: 'pointer', fontFamily: NC_FONT_STACK }}>
                            <option value="tasks">Task</option>
                            <option value="shailos">Shaila</option>
                            <option value="scheduleItems">Schedule</option>
                            <option value="reminders">Reminder</option>
                          </select>
                          <span style={{ fontSize: NC_TYPE.small, color: C.faint, fontFamily: NC_FONT_STACK }}>Save as</span>
                        </div>
                      )}
                      {it.cat === 'tasks' && (
                        <select value={it.priority || 'eventually'} onChange={e => updatePriority(it.id, e.target.value)}
                          style={{ marginTop: 5, fontSize: NC_TYPE.meta, background: C.bgSoft, border: `1px solid ${C.divider}`, borderRadius: RADIUS.xs, color: C.muted, padding: '2px 6px', cursor: 'pointer', fontFamily: NC_FONT_STACK }}>
                          {pris.filter(p => !p.deleted).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                          <option value="shaila">Shaila</option>
                        </select>
                      )}
                      {it.cat === 'scheduleItems' && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 82px', gap: SP.xs, marginTop: 7 }}>
                          <input
                            value={it.date || ''}
                            onChange={e => updateScheduleField(it.id, 'date', e.target.value)}
                            placeholder="Date"
                            style={{ minWidth: 0, background: C.bgSoft, border: `1px solid ${scheduleMissingDetails(it).includes('date') ? C.warning : C.divider}`, borderRadius: RADIUS.xs, color: C.text, fontSize: NC_TYPE.meta, fontFamily: NC_FONT_STACK, padding: '5px 7px', outline: 'none', boxSizing: 'border-box' }}
                          />
                          <input
                            value={it.time || ''}
                            onChange={e => updateScheduleField(it.id, 'time', e.target.value)}
                            placeholder="Time"
                            style={{ minWidth: 0, background: C.bgSoft, border: `1px solid ${scheduleMissingDetails(it).includes('time') ? C.warning : C.divider}`, borderRadius: RADIUS.xs, color: C.text, fontSize: NC_TYPE.meta, fontFamily: NC_FONT_STACK, padding: '5px 7px', outline: 'none', boxSizing: 'border-box' }}
                          />
                          <input
                            value={it.durationMinutes || ''}
                            onChange={e => updateScheduleField(it.id, 'durationMinutes', e.target.value)}
                            placeholder="Min"
                            inputMode="numeric"
                            style={{ minWidth: 0, background: C.bgSoft, border: `1px solid ${scheduleMissingDetails(it).includes('duration') ? C.warning : C.divider}`, borderRadius: RADIUS.xs, color: C.text, fontSize: NC_TYPE.meta, fontFamily: NC_FONT_STACK, padding: '5px 7px', outline: 'none', boxSizing: 'border-box' }}
                          />
                          <input
                            value={it.when || ''}
                            onChange={e => updateScheduleField(it.id, 'when', e.target.value)}
                            placeholder="Original wording / notes"
                            style={{ gridColumn: '1 / -1', minWidth: 0, background: 'transparent', border: `1px solid ${C.divider}`, borderRadius: RADIUS.xs, color: C.muted, fontSize: NC_TYPE.small, fontFamily: NC_FONT_STACK, padding: '5px 7px', outline: 'none', boxSizing: 'border-box' }}
                          />
                          {scheduleMissingDetails(it).length > 0 && (
                            <div style={{ gridColumn: '1 / -1', fontSize: NC_TYPE.small, color: C.warning, fontFamily: NC_FONT_STACK }}>
                              Needs {scheduleMissingDetails(it).join(', ')} before adding to Calendar{it.unclearReason ? ` - ${it.unclearReason}` : ''}.
                            </div>
                          )}
                        </div>
                      )}
                      {(it.cat === 'completions' || it.cat === 'gotBacks') && (
                        <div style={{ fontSize: NC_TYPE.meta, color: C.faint, fontFamily: NC_FONT_STACK, marginTop: 2, fontStyle: 'italic' }}>Info only — no action taken</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: `${SP.md} ${SP.xl} ${SP.lg}`, borderTop: `1px solid ${C.divider}`, display: 'flex', gap: SP.sm, flexShrink: 0 }}>
          <button onClick={applyApproved} disabled={approvedCount === 0 || applying}
            style={{ flex: 1, background: approvedCount > 0 && !applying ? C.accent : C.divider, color: approvedCount > 0 && !applying ? '#fff' : C.faint, border: 'none', borderRadius: RADIUS.sm, padding: SP.md, fontSize: NC_TYPE.body, fontWeight: 500, cursor: approvedCount > 0 && !applying ? 'pointer' : 'default', fontFamily: NC_FONT_STACK, transition: 'background 0.15s' }}>
            {applying ? 'Adding...' : `Add ${approvedCount > 0 ? approvedCount : 0} item${approvedCount !== 1 ? 's' : ''}`}
          </button>
          <button onClick={onClose}
            style={{ padding: `${SP.md} ${SP.lg}`, background: 'none', border: `1px solid ${C.divider}`, borderRadius: RADIUS.sm, fontSize: NC_TYPE.body, color: C.muted, cursor: 'pointer', fontFamily: NC_FONT_STACK }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export { ConvCapture };
