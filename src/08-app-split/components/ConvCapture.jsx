import React, { useMemo, useRef, useState } from 'react';
import { aiParseConversation, fmtMs, uid } from '../../01-core.js';
import { NC_FONT_STACK } from '../ui-tokens.jsx';

function ConvCapture({ onClose, onApply, tasks, shailos, pris, aiOpts, T, callMode=false }) {
  // callMode starts in 'ready' phase (waiting for user to share screen)
  const [phase, setPhase] = useState(callMode ? 'ready' : 'recording');
  const [liveText, setLiveText] = useState('');
  const [items, setItems] = useState([]);
  const [err, setErr] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const phaseRef = useRef(callMode ? 'ready' : 'recording');
  const streamRef = useRef(null);
  const mediaRecRef = useRef(null);
  const chunksRef = useRef([]);
  const mediaStopPRef = useRef(null);
  const segBufRef = useRef('');
  const liveRef = useRef('');
  const recogRef = useRef(null);
  const elapsedTmrRef = useRef(null);

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

  // Mic mode: start recording immediately on mount
  useEffect(() => {
    if (callMode) return; // call mode waits for user gesture (startCallCapture)
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

    const t = setTimeout(async () => {
      if (phaseRef.current !== 'recording') return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (phaseRef.current !== 'recording') { stream.getTracks().forEach(t => t.stop()); return; }
        startMediaRecorder(stream);
      } catch(_) { setErr('Mic permission denied. Enable mic and try again.'); }
    }, 300);

    return () => {
      clearTimeout(t);
      clearInterval(elapsedTmrRef.current);
      if (recogRef.current) { try { recogRef.current.onend = null; recogRef.current.abort(); } catch(_) {} }
      if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') { try { mediaRecRef.current.stop(); } catch(_) {} }
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); }
    };
  }, []); // eslint-disable-line

  // Call mode: triggered by user clicking "Start capturing"
  async function startCallCapture() {
    setErr('');
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 44100 },
        video: { width: 1, height: 1 },
      });
      const audioTracks = displayStream.getAudioTracks();
      if (!audioTracks.length) {
        displayStream.getTracks().forEach(t => t.stop());
        setErr('No audio captured. Make sure to check "Share tab audio" in the browser dialog.');
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
        pending = await savePendingRecording(webmBlob, callMode ? 'conversation_call' : 'conversation_mic', {
          source: 'main',
          label: callMode ? 'Conversation call capture' : 'Conversation mic capture',
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
        setErr(callMode ? 'No audio was captured from the call. Make sure audio was playing and you checked "Share tab audio".' : 'Nothing was captured. Check mic permissions and try again.');
        setItems([]);
        goPhase('review');
        return;
      }

      const parsed = await aiParseConversation(transcript, tasks, shailos, aiOpts);
      const allItems = [];
      const add = (cat, arr) => (arr || []).forEach(item => allItems.push({ id: uid(), cat, approved: true, ...item }));
      add('tasks', parsed.tasks);
      add('shailos', parsed.shailos);
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

  function applyApproved() {
    items.filter(it => it.approved).forEach(it => {
      if (it.cat === 'tasks')         onApply(it.text, it.priority || 'eventually');
      else if (it.cat === 'shailos') onApply(it.text || it.synopsis || it.content || 'Shaila', 'shaila');
      else if (it.cat === 'scheduleItems') onApply(it.when ? `${it.text} (${it.when})` : it.text, 'today');
      else if (it.cat === 'reminders') onApply(it.text, 'eventually');
      // completions + gotBacks are info-only for now
    });
    onClose();
  }

  const approvedCount = items.filter(it => it.approved).length;
  const mm = String(Math.floor(elapsed / 60)).padStart(1, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const fmtElapsed = `${mm}:${ss}`;

  const SECTIONS = [
    { cat: 'tasks',        color: '#5B7BE8', emoji: '✓',  label: 'New Tasks' },
    { cat: 'shailos',      color: '#C8A84C', emoji: '❓', label: 'Shailos' },
    { cat: 'gotBacks',     color: '#2ECC71', emoji: '📬', label: 'Got Back to Asker' },
    { cat: 'completions',  color: '#27AE60', emoji: '☑',  label: 'Mark Complete' },
    { cat: 'scheduleItems',color: '#9B59B6', emoji: '📅', label: 'Schedule' },
    { cat: 'reminders',    color: '#E67E22', emoji: '🔔', label: 'Reminders' },
  ];

  const overlayS = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 };
  const cardS    = { background: T.card, borderRadius: 16, maxWidth: 560, width: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', fontFamily: 'inherit' };
  const btnClose = { background: 'none', border: 'none', cursor: 'pointer', color: T.tFaint, fontSize: 22, lineHeight: 1, padding: 4, fontFamily: NC_FONT_STACK };

  // ── Call mode: waiting for user to share screen ───────────────────────────
  if (phase === 'ready') return (
    <div style={overlayS} onClick={onClose}>
      <div style={cardS} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '22px 24px 18px', borderBottom: `1px solid ${T.brd}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 18, fontWeight: 500, color: T.t }}>Capture Call Audio</span>
            <button style={btnClose} onClick={onClose}>×</button>
          </div>
          <div style={{ fontSize: 14, color: T.tSoft, fontFamily: NC_FONT_STACK, lineHeight: 1.55, marginBottom: 14 }}>
            Click <strong>Start capturing</strong>, then in the browser dialog:<br/>
            1. Select the tab or window playing the call<br/>
            2. Check <em>"Share tab audio"</em> before clicking Share
          </div>
          {err && <div style={{ fontSize: 13, color: '#E74C3C', fontFamily: NC_FONT_STACK, marginBottom: 8 }}>{err}</div>}
        </div>
        <div style={{ padding: '18px 24px', display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button onClick={startCallCapture} style={{ background: '#5B7BE8', color: '#fff', border: 'none', borderRadius: 12, padding: '13px 28px', fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: NC_FONT_STACK }}>
            Start capturing
          </button>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${T.brd}`, borderRadius: 12, padding: '13px 18px', fontSize: 14, color: T.tSoft, cursor: 'pointer', fontFamily: NC_FONT_STACK }}>
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
        <div style={{ padding: '22px 24px 18px', borderBottom: `1px solid ${T.brd}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={{ fontSize: 18, fontWeight: 500, color: T.t }}>{callMode ? 'Capturing Call Audio' : 'Recording Conversation'}</span>
            <button style={btnClose} onClick={onClose}>×</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#E74C3C', animation: 'conv-pulse 1.4s ease infinite' }}/>
            <span style={{ fontSize: 13, color: T.tSoft, fontFamily: NC_FONT_STACK, fontVariantNumeric: 'tabular-nums' }}>{fmtElapsed}</span>
            <span style={{ fontSize: 13, color: T.tFaint, fontFamily: NC_FONT_STACK }}>Speak freely — AI will extract everything</span>
          </div>
          {liveText && (
            <div style={{ fontSize: 13, color: T.tFaint, fontFamily: NC_FONT_STACK, lineHeight: 1.5, maxHeight: 72, overflowY: 'auto', background: T.bgW, borderRadius: 8, padding: '8px 12px', border: `1px solid ${T.brdS}` }}>
              {liveText}
            </div>
          )}
          {err && <div style={{ fontSize: 13, color: '#E74C3C', fontFamily: NC_FONT_STACK, marginTop: 8 }}>{err}</div>}
        </div>
        <div style={{ padding: '20px 24px', display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button onClick={stopAndProcess} style={{ background: '#E74C3C', color: '#fff', border: 'none', borderRadius: 12, padding: '13px 30px', fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: NC_FONT_STACK }}>
            Stop &amp; Process
          </button>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${T.brd}`, borderRadius: 12, padding: '13px 18px', fontSize: 14, color: T.tSoft, cursor: 'pointer', fontFamily: NC_FONT_STACK }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  if (phase === 'processing') return (
    <div style={overlayS}>
      <div style={{ ...cardS, alignItems: 'center', justifyContent: 'center', padding: '56px 32px', textAlign: 'center' }}>
        <div style={{ fontSize: 38, marginBottom: 16 }}>🎙️</div>
        <div style={{ fontSize: 18, fontWeight: 500, color: T.t, marginBottom: 8, fontFamily: NC_FONT_STACK }}>Processing conversation…</div>
        <div style={{ fontSize: 13, color: T.tFaint, fontFamily: NC_FONT_STACK }}>Transcribing and extracting items</div>
      </div>
    </div>
  );

  // ── Review phase ──────────────────────────────────────────────────────────
  return (
    <div style={overlayS} onClick={onClose}>
      <div style={cardS} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '20px 24px 14px', borderBottom: `1px solid ${T.brd}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 500, color: T.t }}>Found in this conversation</div>
              <div style={{ fontSize: 13, color: T.tFaint, fontFamily: NC_FONT_STACK, marginTop: 3 }}>
                {items.length} item{items.length !== 1 ? 's' : ''} — check what to add
              </div>
            </div>
            <button style={btnClose} onClick={onClose}>×</button>
          </div>
          {err && <div style={{ fontSize: 13, color: '#E74C3C', fontFamily: NC_FONT_STACK, marginTop: 8 }}>{err}</div>}
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '12px 24px 4px' }}>
          {items.length === 0 && (
            <div style={{ textAlign: 'center', padding: '36px 0', color: T.tFaint, fontFamily: NC_FONT_STACK, fontSize: 14 }}>
              No actionable items found in this conversation.
            </div>
          )}
          {SECTIONS.map(({ cat, color, emoji, label }) => {
            const sItems = items.filter(it => it.cat === cat);
            if (!sItems.length) return null;
            return (
              <div key={cat} style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                  <div style={{ width: 3, height: 18, background: color, borderRadius: 2, flexShrink: 0 }}/>
                  <span style={{ fontSize: 13, fontWeight: 500, color: T.t, fontFamily: NC_FONT_STACK, letterSpacing: 0 }}>{emoji} {label}</span>
                  <span style={{ fontSize: 12, background: color + '22', color: color, borderRadius: 10, padding: '1px 7px', fontFamily: NC_FONT_STACK, fontWeight: 500 }}>{sItems.length}</span>
                </div>
                {sItems.map(it => (
                  <div key={it.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '7px 0', borderBottom: `1px solid ${T.brdS}` }}>
                    <input type="checkbox" checked={it.approved} onChange={() => toggleApproved(it.id)}
                      style={{ marginTop: 5, accentColor: color, flexShrink: 0, cursor: 'pointer', width: 14, height: 14 }}/>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <input
                        value={it.text || it.synopsis || ''}
                        onChange={e => updateText(it.id, e.target.value)}
                        style={{ width: '100%', background: 'none', border: 'none', borderBottom: `1px solid ${T.brdS}`, color: T.t, fontSize: 14, fontFamily: NC_FONT_STACK, padding: '2px 0', outline: 'none', boxSizing: 'border-box' }}
                      />
                      {!['completions', 'gotBacks'].includes(cat) && (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
                          <select value={it.cat} onChange={e => updateCategory(it.id, e.target.value)}
                            style={{ fontSize: 13, background: T.bgW, border: `1px solid ${T.brd}`, borderRadius: 6, color: T.tSoft, padding: '2px 6px', cursor: 'pointer', fontFamily: NC_FONT_STACK }}>
                            <option value="tasks">Task</option>
                            <option value="shailos">Shaila</option>
                            <option value="scheduleItems">Schedule</option>
                            <option value="reminders">Reminder</option>
                          </select>
                          <span style={{ fontSize: 12, color: T.tFaint, fontFamily: NC_FONT_STACK }}>Save as</span>
                        </div>
                      )}
                      {it.cat === 'tasks' && (
                        <select value={it.priority || 'eventually'} onChange={e => updatePriority(it.id, e.target.value)}
                          style={{ marginTop: 5, fontSize: 13, background: T.bgW, border: `1px solid ${T.brd}`, borderRadius: 6, color: T.tSoft, padding: '2px 6px', cursor: 'pointer', fontFamily: NC_FONT_STACK }}>
                          {pris.filter(p => !p.deleted).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                          <option value="shaila">Shaila</option>
                        </select>
                      )}
                      {it.cat === 'scheduleItems' && it.when && (
                        <div style={{ fontSize: 13, color: T.tFaint, fontFamily: NC_FONT_STACK, marginTop: 3 }}>When: {it.when}</div>
                      )}
                      {(it.cat === 'completions' || it.cat === 'gotBacks') && (
                        <div style={{ fontSize: 13, color: T.tFaint, fontFamily: NC_FONT_STACK, marginTop: 2, fontStyle: 'italic' }}>Info only — no action taken</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 24px 18px', borderTop: `1px solid ${T.brd}`, display: 'flex', gap: 10, flexShrink: 0 }}>
          <button onClick={applyApproved} disabled={approvedCount === 0}
            style={{ flex: 1, background: approvedCount > 0 ? '#5B7BE8' : T.brdS, color: approvedCount > 0 ? '#fff' : T.tFaint, border: 'none', borderRadius: 10, padding: '12px', fontSize: 14, fontWeight: 500, cursor: approvedCount > 0 ? 'pointer' : 'default', fontFamily: NC_FONT_STACK, transition: 'background 0.15s' }}>
            Add {approvedCount > 0 ? approvedCount : 0} item{approvedCount !== 1 ? 's' : ''}
          </button>
          <button onClick={onClose}
            style={{ padding: '12px 18px', background: 'none', border: `1px solid ${T.brd}`, borderRadius: 10, fontSize: 14, color: T.tSoft, cursor: 'pointer', fontFamily: NC_FONT_STACK }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export { ConvCapture };
