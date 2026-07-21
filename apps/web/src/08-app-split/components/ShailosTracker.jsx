// ── Shailos Tracker — native surface ─────────────────────────────────────────
// Full port of the former standalone apps/shailos applet (App.tsx) into the
// main suite: same Firestore documents (users/{canonicalUid}/shailos), same AI
// pipeline (shailos-ai.js → /api/ai-proxy), same holding-pen IndexedDB store —
// but rendered natively with the app's theme tokens and real @material/web
// components instead of Tailwind inside an iframe. The iframe handshake
// (postMessage close / open-conv-capture, ?action= URL param) became plain
// props: onClose, onRecordCall, action.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import firebase from 'firebase/compat/app';
import { db } from '../../01-core.js';
import { cleanTheme, ELEV, GOLD, NC_FONT_STACK, NC_TYPE, RADIUS, suiteIcon, useViewportWidth, Z } from '../ui-tokens.jsx';
import { ActionBtn, AssistChip, ChipSet, CircularProgress, FilterChip, IconBtn, TextField } from '../m3.jsx';
import {
  findPotentialMatches, generateAnswerSummary, generateSynopsis,
  performResearch, transcribeAndParse, transcribeAudio,
} from '../shailos-ai.js';

const MIC_CONSTRAINTS = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

function mediaRecorderOptions() {
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return { mimeType: 'audio/webm;codecs=opus' };
  if (MediaRecorder.isTypeSupported('audio/webm')) return { mimeType: 'audio/webm' };
  return undefined;
}

// ── Holding pen — IndexedDB store for not-yet-transcribed audio ──────────────
// Same database name/shape as the standalone applet used, so recordings held
// before this integration are still there afterwards.
const PENDING_DB = 'onetask_shailos_pending_audio';
const PENDING_STORE = 'recordings';

function openPendingDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PENDING_DB, 1);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(PENDING_STORE)) idb.createObjectStore(PENDING_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open pending audio store'));
  });
}

async function withPendingStore(mode, fn) {
  const idb = await openPendingDb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(PENDING_STORE, mode);
    const store = tx.objectStore(PENDING_STORE);
    const req = fn(store);
    if (req) {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Pending audio operation failed'));
    } else {
      tx.oncomplete = () => resolve(undefined);
    }
    tx.onerror = () => reject(tx.error || new Error('Pending audio transaction failed'));
  }).finally(() => idb.close());
}

async function savePendingRecording(blob, kind) {
  const meta = {
    id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind,
    createdAt: Date.now(),
    mimeType: blob.type || 'audio/webm',
    size: blob.size,
  };
  await withPendingStore('readwrite', store => store.put({ ...meta, blob }));
  return meta;
}

async function listPendingRecordings() {
  const records = await withPendingStore('readonly', store => store.getAll());
  return (records || [])
    .map(({ blob, ...meta }) => meta)
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function getPendingRecording(id) {
  return (await withPendingStore('readonly', store => store.get(id))) || null;
}

async function updatePendingRecordingError(id, error) {
  const rec = await getPendingRecording(id);
  if (!rec) return;
  await withPendingStore('readwrite', store => store.put({ ...rec, error }));
}

async function deletePendingRecording(id) {
  await withPendingStore('readwrite', store => { store.delete(id); });
}

// ── Small helpers ────────────────────────────────────────────────────────────
const nowStamp = () => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const shortDate = (raw) => {
  const d = new Date(raw);
  return isNaN(d.getTime()) ? String(raw || '').slice(0, 10) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};
const tint = (hex, aa) => `${hex}${aa}`; // theme colors are 6-digit hex; aa = alpha byte

const Spin = ({ size = 15, color }) => (
  <CircularProgress indeterminate aria-label="Working" style={{ '--md-circular-progress-size': `${size}px`, ...(color ? { '--md-circular-progress-active-indicator-color': color } : {}), width: size, height: size, display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }} />
);

// ── Research report (JSON records; legacy markdown fallback) ────────────────
function ResearchReport({ text, C }) {
  const data = useMemo(() => {
    try { return JSON.parse(text); } catch { return null; }
  }, [text]);
  const Row = ({ label, url, summary }) => (
    <div style={{ display: 'flex', gap: 12, padding: summary ? '12px 20px' : '10px 20px', borderTop: `1px solid ${C.divider}`, alignItems: 'flex-start' }}>
      <span style={{ color: tint(C.accent, '66'), fontSize: 9, marginTop: 4, flexShrink: 0, userSelect: 'none' }}>●</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <a href={url} target="_blank" rel="noopener noreferrer"
          style={{ fontWeight: 600, color: C.accent, textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: tint(C.accent, '44'), fontSize: NC_TYPE.control, lineHeight: 1.4, fontFamily: NC_FONT_STACK, wordBreak: 'break-word' }}>{label}</a>
        {summary && <p style={{ margin: '4px 0 0', fontSize: NC_TYPE.meta, color: C.muted, lineHeight: 1.55, fontFamily: NC_FONT_STACK }}>{summary}</p>}
      </div>
    </div>
  );
  const SectionLabel = ({ children }) => (
    <div style={{ padding: '14px 20px 6px', borderTop: `1px solid ${C.divider}`, marginTop: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 800, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.12em', fontFamily: NC_FONT_STACK }}>{children}</span>
    </div>
  );
  return (
    <div style={{ background: C.bg, borderRadius: RADIUS.md, border: `1px solid ${C.divider}`, overflow: 'hidden', paddingBottom: 8 }}>
      {data ? (
        <>
          <p style={{ fontSize: 11, color: C.faint, padding: '14px 20px 6px', lineHeight: 1.6, margin: 0, fontFamily: NC_FONT_STACK }}>
            Searched: {(data.queries || []).join(' · ')}
          </p>
          {data.engine === 'sefaria' && (
            <p style={{ fontSize: 11, color: C.warning || C.faint, padding: '0 20px 10px', lineHeight: 1.6, margin: 0, fontFamily: NC_FONT_STACK }}>
              ⚠ Web search didn't answer on this pass, so it only searched Sefaria's own library — which barely digitizes contemporary teshuvos. Results skew toward Gemara/Rishonim; re-run the research to retry web coverage for psak-level contemporary sources.
            </p>
          )}
          {data.sources?.length > 0 && (<><SectionLabel>Sources</SectionLabel>{data.sources.map((s, i) => <Row key={i} label={s.label} url={s.url} summary={s.summary} />)}</>)}
          {data.seforim?.length > 0 && (<><SectionLabel>Seforim</SectionLabel>{data.seforim.map((s, i) => <Row key={i} label={s.label} url={s.url} />)}</>)}
        </>
      ) : (
        // Legacy fallback for old markdown-format records — strip syntax, show readable text
        <p style={{ fontSize: NC_TYPE.meta, color: C.muted, padding: '16px 20px', lineHeight: 1.8, whiteSpace: 'pre-line', margin: 0, fontFamily: NC_FONT_STACK }}>
          {String(text).replace(/\*\*/g, '').replace(/^\*|^##\s*|^-\s/gm, '').replace(/\[(.+?)\]\(.+?\)/g, '$1').trim()}
        </p>
      )}
    </div>
  );
}

// ── The tracker ──────────────────────────────────────────────────────────────
export function ShailosTracker({ T, user = null, action = null, onRecordCall = null }) {
  const C = cleanTheme(T);
  const viewportW = useViewportWidth();
  const wide = viewportW > 980;

  const [shailos, setShailos] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isCallRecording, setIsCallRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const researchingSetRef = useRef(new Set());
  const [, setResearchTick] = useState(0);
  const isResearching = (id) => researchingSetRef.current.has(id);
  const [isGeneratingSynopsis, setIsGeneratingSynopsis] = useState(null);
  const [pastedText, setPastedText] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedShaila, setSelectedShaila] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [pendingRecordings, setPendingRecordings] = useState([]);
  const [processingRecordingId, setProcessingRecordingId] = useState(null);
  const [potentialMatches, setPotentialMatches] = useState(null);
  // Field dictation — exactly two record buttons (shaila box + answer box),
  // explicit start/stop toggle, no auto-timeout guesswork.
  const [fieldRec, setFieldRec] = useState(null);      // field currently recording
  const [fieldRecSecs, setFieldRecSecs] = useState(0); // elapsed seconds while recording
  const [fieldBusy, setFieldBusy] = useState(null);    // field awaiting transcription
  const fieldRecRef = useRef(null);                    // { recorder, stream, timer, maxTimer }
  const [error, setError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const researchRef = useRef(null);
  const [mainRecSecs, setMainRecSecs] = useState(0); // elapsed time on the main Record Shaila/Call take
  const mainRecTimerRef = useRef(null);

  // Same canonical key the whole app stores under: email prefix.
  const USER_ID = user?.email?.split('@')[0]?.toLowerCase()?.trim() || 'unauthenticated';
  const shailosCol = () => db.collection('users').doc(USER_ID).collection('shailos');
  const Ts = () => firebase.firestore.Timestamp.now();

  const refreshPendingRecordings = async () => {
    try { setPendingRecordings(await listPendingRecordings()); }
    catch (err) { console.error('Pending recording load error:', err); }
  };
  useEffect(() => { refreshPendingRecordings(); }, []);

  // Stop any live recorder if the surface unmounts mid-recording.
  useEffect(() => () => {
    try { if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop(); } catch {}
    try { if (fieldRecRef.current?.recorder?.state === 'recording') fieldRecRef.current.recorder.stop(); } catch {}
  }, []);

  // Entry-point actions (were ?action= on the iframe URL).
  useEffect(() => {
    if (action === 'add-manual' && user) handleAddManually();
    if (action === 'record-shaila' && user && !isRecording && !isCallRecording) startRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, user]);

  // Live Firestore listener
  useEffect(() => {
    if (!user || !db || USER_ID === 'unauthenticated') return;
    const unsubscribe = shailosCol().orderBy('createdAt', 'desc').onSnapshot((snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setShailos(data);
      // Sync background-updated fields into selectedShaila without clobbering user edits
      setSelectedShaila(prev => {
        if (!prev) return prev;
        const updated = data.find(s => s.id === prev.id);
        if (!updated) return prev;
        if (updated.researchReport !== prev.researchReport || updated.answerSummary !== prev.answerSummary || updated.status !== prev.status) {
          // Don't downgrade a valid JSON report to a stale non-JSON value from cache.
          const isJson = (s) => { try { return !!s && JSON.parse(s) !== null; } catch { return false; } };
          const nextReport = (isJson(prev.researchReport) && !isJson(updated.researchReport)) ? prev.researchReport : updated.researchReport;
          return { ...prev, researchReport: nextReport, answerSummary: updated.answerSummary, status: updated.status };
        }
        return prev;
      });
    }, (err) => {
      console.error('[ShailosTracker] listener error:', err);
      setError('Could not load shailos: ' + (err?.message || err));
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, USER_ID]);

  // Auto-scroll to research findings when they arrive
  useEffect(() => {
    if (selectedShaila?.researchReport) scrollToResearch();
  }, [selectedShaila?.researchReport]);
  const scrollToResearch = () => {
    setTimeout(() => { researchRef.current?.scrollIntoView({ behavior: 'smooth' }); }, 100);
  };

  // ── Recording ──────────────────────────────────────────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      setupMediaRecorder(stream, [], undefined, 'shaila');
      setIsRecording(true);
    } catch (err) {
      console.error('Recording error:', err);
      setError('Microphone access denied or not available.');
    }
  };

  // Standalone fallback only — inside the suite, Record Call delegates to
  // ConvCapture (onRecordCall prop), the owner's preferred call pipeline.
  const startCallRecording = async () => {
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      if (!displayStream.getAudioTracks().length) {
        displayStream.getTracks().forEach(t => t.stop());
        throw new Error("No system audio track found. Did you check 'Share system audio'?");
      }
      const micStream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      const audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();
      audioContext.createMediaStreamSource(micStream).connect(destination);
      audioContext.createMediaStreamSource(displayStream).connect(destination);
      const allTracks = [...displayStream.getTracks(), ...micStream.getTracks()];
      setupMediaRecorder(destination.stream, allTracks, () => audioContext.close().catch(() => {}), 'call');
      setIsCallRecording(true);
    } catch (err) {
      console.error('Call recording error:', err);
      setError('Failed to start call recording. Ensure you share system audio.');
    }
  };

  const setupMediaRecorder = (stream, extraTracks = [], onCleanup, kind = 'shaila') => {
    const mediaRecorder = new MediaRecorder(stream, mediaRecorderOptions());
    mediaRecorderRef.current = mediaRecorder;
    audioChunksRef.current = [];
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunksRef.current.push(event.data);
    };
    mediaRecorder.onstop = async () => {
      if (mainRecTimerRef.current) { clearInterval(mainRecTimerRef.current); mainRecTimerRef.current = null; }
      const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' });
      stream.getTracks().forEach(track => track.stop());
      extraTracks.forEach(track => track.stop());
      onCleanup?.();
      try {
        const pending = await savePendingRecording(audioBlob, kind);
        await refreshPendingRecordings();
        processPendingRecording(pending.id);
      } catch (err) {
        console.error('Pending recording save error:', err);
        setError('Could not save recording before transcription. Please try again.');
      }
    };
    mediaRecorder.start(1000);
    setMainRecSecs(0);
    if (mainRecTimerRef.current) clearInterval(mainRecTimerRef.current);
    mainRecTimerRef.current = setInterval(() => setMainRecSecs(s => s + 1), 1000);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && (isRecording || isCallRecording)) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsCallRecording(false);
    }
  };

  const processPendingRecording = async (recordingId) => {
    const pending = await getPendingRecording(recordingId);
    if (!pending) { await refreshPendingRecordings(); return; }
    setIsProcessing(true);
    setProcessingRecordingId(recordingId);
    setError(null);
    try {
      if (pending.kind === 'quick_mic') {
        const transcription = await transcribeAudio(user, pending.blob, 'Transcribe this audio faithfully.');
        setPastedText((prev) => `${prev}${prev.trim() ? ' ' : ''}${transcription.trim()}`);
        setShowAddModal(true);
        await deletePendingRecording(recordingId);
        await refreshPendingRecordings();
        return;
      }
      const results = await transcribeAndParse(user, pending.blob, true);
      for (const result of results) {
        const matchIds = await findPotentialMatches(user, result, shailos);
        if (matchIds.length > 0) {
          setPotentialMatches({ newShaila: result, matches: shailos.filter(s => matchIds.includes(s.id)) });
          break; // one at a time
        } else {
          await saveShailos([result]);
        }
      }
      await deletePendingRecording(recordingId);
      await refreshPendingRecordings();
    } catch (err) {
      console.error('Processing error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      await updatePendingRecordingError(recordingId, msg).catch(() => {});
      await refreshPendingRecordings();
      setError('Transcription failed. The audio is saved in the holding pen below. ' + msg);
    } finally {
      setIsProcessing(false);
      setProcessingRecordingId(null);
    }
  };

  const deleteHeldRecording = async (recordingId) => {
    if (processingRecordingId === recordingId) return;
    await deletePendingRecording(recordingId);
    await refreshPendingRecordings();
  };

  // ── CRUD + AI ──────────────────────────────────────────────────────────────
  const handlePasteSubmit = async () => {
    if (!pastedText.trim()) return;
    setIsProcessing(true);
    setError(null);
    try {
      const results = await transcribeAndParse(user, pastedText, false);
      for (const result of results) {
        const matchIds = await findPotentialMatches(user, result, shailos);
        if (matchIds.length > 0) {
          setPotentialMatches({ newShaila: result, matches: shailos.filter(s => matchIds.includes(s.id)) });
          break;
        } else {
          await saveShailos([result]);
        }
      }
      setPastedText('');
      setShowAddModal(false);
    } catch (err) {
      console.error('Processing error:', err);
      setError('Parse failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGotBack = async (shaila) => {
    const newStatus = shaila.status === 'got_back' ? 'answered' : 'got_back';
    try {
      await shailosCol().doc(shaila.id).update({ status: newStatus, updatedAt: Ts() });
      if (selectedShaila?.id === shaila.id) setSelectedShaila({ ...selectedShaila, status: newStatus });
    } catch (err) {
      setError('Update failed: ' + (err?.message || err));
    }
  };

  const integrateShaila = async (existingShaila, newData) => {
    try {
      const updatedContent = `${existingShaila.content}\n\n[Follow-up ${shortDate(new Date())}]: ${newData.shailaContent}`;
      const updatedAnswer = newData.answer ? `${existingShaila.answer}\n\n[New Info]: ${newData.answer}` : existingShaila.answer;
      await shailosCol().doc(existingShaila.id).update({
        content: updatedContent,
        answer: updatedAnswer,
        status: (updatedAnswer && updatedAnswer.trim() !== '') ? 'answered' : existingShaila.status,
        updatedAt: Ts(),
      });
      setPotentialMatches(null);
    } catch (err) {
      setError('Integrate failed: ' + (err?.message || err));
    }
  };

  const saveShailos = async (shailosData) => {
    if (!user) return;
    await Promise.all(shailosData.map(data =>
      shailosCol().add({
        date: nowStamp(),
        askerName: data.askerName || 'Unknown',
        content: data.shailaContent || pastedText || 'Audio Transcript',
        parsedShaila: data.parsedShaila || '',
        synopsis: data.synopsis || (data.shailaContent ? data.shailaContent.substring(0, 50) + '...' : 'New Shaila'),
        answer: data.answer || '',
        answererName: data.answererName || '',
        reasons: data.reasons || '',
        status: data.answer && data.answer.trim() !== '' ? 'answered' : 'pending',
        createdAt: Ts(),
        userId: USER_ID,
      })
    ));
  };

  // One explicit toggle: tap ● to record, tap ■ to stop, then the take is
  // transcribed with the yeshivish dialect protocol (transcribe.yeshivish.v1
  // via transcribeAudio) and appended to the box. 10-minute safety cap only.
  const FIELD_REC_MAX_MS = 10 * 60 * 1000;
  const toggleFieldRecording = async (field) => {
    if (fieldBusy) return;
    if (fieldRec) {
      if (fieldRec === field && fieldRecRef.current?.recorder?.state === 'recording') fieldRecRef.current.recorder.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      const recorder = new MediaRecorder(stream, mediaRecorderOptions());
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        const rec = fieldRecRef.current;
        if (rec?.timer) clearInterval(rec.timer);
        if (rec?.maxTimer) clearTimeout(rec.maxTimer);
        fieldRecRef.current = null;
        stream.getTracks().forEach(t => t.stop());
        setFieldRec(null);
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        setFieldBusy(field);
        try {
          const transcription = (await transcribeAudio(user, blob, field === 'answer'
            ? 'Transcribe this audio exactly and faithfully. It is a halachic answer (psak) with reasons, possibly in Yeshivish English with Hebrew and Yiddish terms. Return only the transcript.'
            : 'Transcribe this audio exactly and faithfully. It is a halachic question (shaila), possibly in Yeshivish English with Hebrew and Yiddish terms. Return only the transcript.')).trim();
          if (transcription) {
            setSelectedShaila(prev => {
              if (!prev) return prev;
              if (field === 'answer') return { ...prev, answer: `${prev.answer?.trim() ? prev.answer + ' ' : ''}${transcription}` };
              const content = `${prev.content?.trim() ? prev.content + ' ' : ''}${transcription}`;
              return { ...prev, content, parsedShaila: content };
            });
          }
        } catch (err) {
          console.error('Field transcription error:', err);
          setError('Transcription failed — ' + (err instanceof Error ? err.message : String(err)));
        } finally {
          setFieldBusy(null);
        }
      };
      recorder.start(1000);
      const timer = setInterval(() => setFieldRecSecs(s => s + 1), 1000);
      const maxTimer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, FIELD_REC_MAX_MS);
      fieldRecRef.current = { recorder, stream, timer, maxTimer };
      setFieldRecSecs(0);
      setFieldRec(field);
    } catch (err) {
      console.error('Mic access error:', err);
      setError('Microphone access denied or not available.');
    }
  };

  const deleteShaila = async (id) => {
    try {
      await shailosCol().doc(id).delete();
      if (selectedShaila?.id === id) setSelectedShaila(null);
    } catch (err) {
      setError('Delete failed: ' + (err?.message || err));
    }
  };

  const handleResearch = async (shaila) => {
    if (researchingSetRef.current.has(shaila.id)) return;
    researchingSetRef.current.add(shaila.id);
    setResearchTick(t => t + 1);
    try {
      // Pass synopsis + content for cleaner search input (strips asker name, metadata)
      const queryText = shaila.synopsis ? `${shaila.synopsis}\n\n${shaila.content}` : shaila.content;
      const data = await performResearch(user, queryText);
      await shailosCol().doc(shaila.id).update({ researchReport: JSON.stringify(data), updatedAt: Ts() });
    } catch (err) {
      console.error('Research error:', err);
      setError('Research failed — ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      researchingSetRef.current.delete(shaila.id);
      setResearchTick(t => t + 1);
    }
  };

  const handleRegenerateSynopsis = async (shaila) => {
    if (isGeneratingSynopsis) return;
    setIsGeneratingSynopsis(shaila.id);
    try {
      const newSynopsis = await generateSynopsis(user, shaila.content);
      setSelectedShaila({ ...shaila, synopsis: newSynopsis });
      await shailosCol().doc(shaila.id).update({ synopsis: newSynopsis, updatedAt: Ts() });
    } catch (err) {
      console.error('Synopsis regeneration error:', err);
      setError('Failed to regenerate synopsis. Please try again.');
    } finally {
      setIsGeneratingSynopsis(null);
    }
  };

  const handleAddManually = () => {
    if (!user) return;
    setSelectedShaila({
      id: `manual-draft-${Date.now()}`,
      date: nowStamp(),
      askerName: '', content: '', parsedShaila: '', synopsis: '',
      answer: '', answererName: '', reasons: '',
      status: 'pending', createdAt: Ts(), userId: USER_ID, _manualDraft: true,
    });
  };

  const saveShailaDetails = async (shaila, options = {}) => {
    try {
      if (shaila._manualDraft && !options.submitManualDraft) {
        setSelectedShaila(shaila);
        return;
      }
      const questionText = (shaila.content || shaila.parsedShaila || '').trim();
      const synopsisText = (shaila.synopsis || questionText.substring(0, 80)).trim();
      if (shaila._manualDraft && !questionText && !synopsisText) {
        setError('Add the shaila details before saving.');
        return;
      }
      const status = shaila.status === 'got_back' ? 'got_back' :
        (shaila.answer || '').trim() !== '' ? 'answered' : 'pending';
      // Regenerate answer summary whenever answer is present and has changed (or summary missing)
      const prevShaila = shailos.find(s => s.id === shaila.id);
      const answerChanged = (shaila.answer || '') !== (prevShaila?.answer || '');
      let answerSummary = shaila.answerSummary || '';
      if ((shaila.answer || '').trim() && (answerChanged || !answerSummary)) {
        try { answerSummary = await generateAnswerSummary(user, shaila.answer); } catch { /* keep old */ }
      }
      const payload = {
        date: shaila.date,
        content: questionText,
        parsedShaila: shaila.parsedShaila || questionText,
        synopsis: synopsisText,
        askerName: shaila.askerName || 'Unknown',
        answer: shaila.answer || '',
        answerSummary,
        answererName: shaila.answererName || '',
        reasons: shaila.reasons || '',
        status,
        updatedAt: Ts(),
      };
      if (shaila._manualDraft) {
        const docRef = await shailosCol().add({ ...payload, createdAt: shaila.createdAt || Ts(), userId: USER_ID });
        setSelectedShaila({ ...shaila, ...payload, id: docRef.id, status, _manualDraft: false });
        return;
      }
      await shailosCol().doc(shaila.id).update(payload);
      setSelectedShaila({ ...shaila, status, answerSummary });
    } catch (err) {
      setError('Save failed: ' + (err?.message || err));
    }
  };

  // ── Filtering ──────────────────────────────────────────────────────────────
  const STATUS_ORDER = {
    all:      { pending: 0, answered: 1, got_back: 2 },
    pending:  { pending: 0, answered: 1, got_back: 2 },
    answered: { answered: 0, pending: 1, got_back: 2 },
    got_back: { got_back: 0, answered: 1, pending: 2 },
  };
  const filteredShailos = shailos
    .filter(s => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return s.content?.toLowerCase().includes(q) ||
        s.askerName?.toLowerCase().includes(q) ||
        s.parsedShaila?.toLowerCase().includes(q) ||
        s.synopsis?.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const order = STATUS_ORDER[statusFilter] || STATUS_ORDER.all;
      const oa = order[a.status] ?? 3;
      const ob = order[b.status] ?? 3;
      if (oa !== ob) return oa - ob;
      return (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0);
    });

  const formatShailaForCopy = (s) =>
    `Shaila from ${s.askerName} (${s.date})\n\n${s.parsedShaila || s.content}\n\nAnswer: ${s.answer || '[waiting for answer]'}\n${s.answererName ? `Answerer: ${s.answererName}\n` : ''}${s.reasons ? `Reasons: ${s.reasons}\n` : ''}\n-------------------\n`;
  const copyToClipboard = (text) => { try { navigator.clipboard.writeText(text); } catch {} };
  const copyAllShailos = () => copyToClipboard(filteredShailos.map(formatShailaForCopy).join('\n'));

  // ── Shared style bits (theme-token fallbacks — no M3 equivalent) ───────────
  const font = { fontFamily: NC_FONT_STACK };
  const banner = (color) => ({ background: tint(color, '14'), border: `1px solid ${tint(color, '40')}`, color, padding: '10px 14px', borderRadius: RADIUS.sm, display: 'flex', alignItems: 'center', gap: 10, fontSize: NC_TYPE.meta, ...font });
  const sectionLabel = { fontSize: 10, fontWeight: 800, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.1em', ...font };
  // Borderless inline-edit fields (date/synopsis/asker) — an inline-edit
  // pattern with no @material/web equivalent; tokens only.
  const inlineEdit = { background: 'transparent', border: 'none', outline: 'none', color: C.text, padding: 0, width: '100%', boxSizing: 'border-box', ...font };
  const statusMeta = (s) => s === 'got_back'
    ? { label: 'Got Back', color: C.success }
    : s === 'answered' ? { label: 'Have Answer', color: GOLD } : { label: 'Researching', color: C.warning };
  const statusChip = (s, draft = false) => {
    const m = draft ? { label: 'Draft', color: C.faint } : statusMeta(s);
    return (
      <span style={{ padding: '2px 8px', borderRadius: RADIUS.xs, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', background: tint(m.color, '1E'), color: m.color, whiteSpace: 'nowrap', ...font }}>{m.label}</span>
    );
  };
  const gotBackChip = (shaila, { small = false } = {}) => {
    const done = shaila.status === 'got_back';
    const color = done ? C.success : GOLD;
    return (
      <AssistChip label={done ? 'Got back ✓' : 'Got back?'} title={done ? 'Undo: not yet got back' : 'Got back to asker?'}
        onClick={(e) => { e.stopPropagation(); handleGotBack(shaila); }}
        style={{
          '--md-assist-chip-container-height': small ? '22px' : '26px',
          '--md-assist-chip-label-text-size': small ? '10px' : '11px',
          '--md-assist-chip-label-text-color': color,
          '--md-assist-chip-outline-color': tint(color, '66'),
          '--md-assist-chip-leading-space': '8px',
          '--md-assist-chip-trailing-space': '8px',
          flexShrink: 0,
        }} />
    );
  };
  // The only two dictation controls: an unmistakable red ● that flips to a
  // filled ■ with a live REC timer while recording — no ambiguous glow.
  const fmtRecSecs = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const recordBtn = (field) => {
    if (fieldBusy === field) return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: NC_TYPE.small, color: C.accent, ...font }}>
        <Spin size={14} color={C.accent} /> Transcribing…
      </span>
    );
    if (fieldRec === field) return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: NC_TYPE.small, fontWeight: 700, color: C.danger, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', ...font }}>
          ● REC {fmtRecSecs(fieldRecSecs)}
        </span>
        <IconBtn variant="filled" icon="stop" iconSize={15} containerColor={C.danger} color="#fff"
          onClick={() => toggleFieldRecording(field)} title="Stop recording" aria-label="Stop recording" />
      </span>
    );
    return (
      <IconBtn icon="radio_button_checked" iconSize={17} color={C.danger}
        onClick={() => toggleFieldRecording(field)} disabled={!!fieldRec || !!fieldBusy}
        title="Record into this box" aria-label="Record into this box" />
    );
  };
  const fieldBlur = () => { if (selectedShaila) saveShailaDetails(selectedShaila); };

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: C.bg }}>
        <div style={{ maxWidth: 380, textAlign: 'center', color: C.muted, fontSize: NC_TYPE.body, ...font }}>
          {suiteIcon('error', 28)}
          <p style={{ marginTop: 10 }}>Sign in to see your shailos here.</p>
        </div>
      </div>
    );
  }
  if (USER_ID === 'unauthenticated') {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: C.bg }}>
        <div style={{ maxWidth: 420, color: C.muted, fontSize: NC_TYPE.meta, lineHeight: 1.6, ...font }}>
          <p style={{ color: C.text, fontWeight: 700, fontSize: NC_TYPE.body }}>Couldn't identify your account</p>
          <p>You're signed in, but this session carried no email address, so the app can't tell which data folder is yours.</p>
          <div style={{ background: C.bgSoft, borderRadius: RADIUS.sm, padding: 10, fontSize: 11, wordBreak: 'break-all' }}>
            <div>User ID: {user.uid || '(none)'}</div>
            <div>Email: {user.email || '(none)'}</div>
          </div>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ height: '100%', overflowY: 'auto', background: C.bg, ...font }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: 'clamp(12px,2vw,20px)', display: 'flex', flexDirection: 'column', gap: 14, boxSizing: 'border-box' }}>

        {/* ── Action bar ── */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {!isRecording && !isCallRecording ? (
            <>
              <ActionBtn variant="filled" icon="mic" iconSize={15} height={36} containerColor={C.danger} labelColor="#fff"
                onClick={startRecording} disabled={isProcessing} title="Record a shaila">Record Shaila</ActionBtn>
              <ActionBtn variant="filled" icon="call" iconSize={15} height={36} containerColor={C.accent} labelColor="#fff"
                onClick={() => (onRecordCall ? onRecordCall() : startCallRecording())} disabled={isProcessing}
                title="Record a call">Record Call</ActionBtn>
            </>
          ) : (
            // Solid red + live timer — unmistakably "recording, tap to stop" (no pulsing glow).
            <ActionBtn variant="filled" icon="stop" iconSize={15} height={36} containerColor={C.danger} labelColor="#fff"
              onClick={stopRecording} title="Stop recording">
              Stop {isCallRecording ? 'Call ' : ''}Recording · {fmtRecSecs(mainRecSecs)}
            </ActionBtn>
          )}
          <ActionBtn variant="tonal" icon="add" iconSize={15} height={36} containerColor={C.bgSoft} labelColor={C.text}
            onClick={() => setShowAddModal(true)} disabled={isProcessing || isRecording || isCallRecording}
            title="Paste shaila text for AI parsing">Paste Text</ActionBtn>
          <ActionBtn variant="tonal" icon="edit" iconSize={15} height={36} containerColor={C.bgSoft} labelColor={C.text}
            onClick={handleAddManually} disabled={isProcessing || isRecording || isCallRecording}
            title="Add a shaila manually">Add Manually</ActionBtn>
          <div style={{ flex: 1 }} />
          <TextField placeholder="Search shailos…" value={searchQuery}
            onInput={(e) => setSearchQuery(e.target.value)}
            style={{ width: wide ? 240 : '100%', '--md-outlined-text-field-container-shape': RADIUS.sm, '--md-outlined-text-field-top-space': '6px', '--md-outlined-text-field-bottom-space': '6px' }}>
            <span slot="leading-icon" className="material-symbols-rounded" style={{ fontSize: 16 }}>search</span>
          </TextField>
        </div>

        {/* ── Banners ── */}
        {isCallRecording && (
          <div style={banner(C.accent)}>
            {suiteIcon('call', 14)}
            <span><strong>Tip:</strong> to record both sides, select the tab/window with the call and check <strong>"Also share system audio"</strong> in the browser popup.</span>
          </div>
        )}
        {error && (
          <div style={banner(C.danger)}>
            {suiteIcon('error', 16)}
            <span style={{ flex: 1 }}>{error}</span>
            <IconBtn icon="close" iconSize={13} color={C.danger} onClick={() => setError(null)} title="Dismiss" aria-label="Dismiss error" />
          </div>
        )}
        {isProcessing && (
          <div style={banner(C.accent)}>
            <Spin size={16} color={C.accent} />
            <span style={{ fontWeight: 600 }}>Processing shaila with AI dialect support…</span>
          </div>
        )}

        {/* ── Holding pen ── */}
        {pendingRecordings.length > 0 && (
          <div style={{ background: tint(C.warning, '12'), border: `1px solid ${tint(C.warning, '40')}`, borderRadius: RADIUS.md, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: NC_TYPE.meta, fontWeight: 700, color: C.text }}>Transcription holding pen</div>
                <div style={{ fontSize: NC_TYPE.small, color: C.muted, marginTop: 2 }}>Audio stays here until transcription succeeds — a failed AI call never loses the recording.</div>
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.warning, background: tint(C.warning, '22'), padding: '2px 8px', borderRadius: RADIUS.pill, whiteSpace: 'nowrap' }}>{pendingRecordings.length} saved</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pendingRecordings.map((rec) => {
                const busy = processingRecordingId === rec.id;
                const label = rec.kind === 'call' ? 'Call recording' : rec.kind === 'quick_mic' ? 'Quick mic' : 'Shaila recording';
                const age = new Date(rec.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
                const mb = (rec.size / 1024 / 1024).toFixed(1);
                return (
                  <div key={rec.id} style={{ background: C.bg, border: `1px solid ${C.divider}`, borderRadius: RADIUS.sm, padding: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <div style={{ fontSize: NC_TYPE.meta, fontWeight: 600, color: C.text }}>{label}</div>
                      <div style={{ fontSize: NC_TYPE.small, color: C.faint }}>{age} · {mb} MB</div>
                      {rec.error && <div style={{ fontSize: NC_TYPE.small, color: C.danger, marginTop: 2 }}>{rec.error}</div>}
                    </div>
                    <ActionBtn variant="tonal" icon={busy ? 'progress_activity' : 'refresh'} iconSize={13} height={28} labelSize={NC_TYPE.small}
                      containerColor={C.bgSoft} labelColor={C.text}
                      onClick={() => processPendingRecording(rec.id)} disabled={isProcessing} title="Retry transcription">Retry</ActionBtn>
                    <IconBtn icon="delete" iconSize={14} color={C.faint}
                      onClick={() => deleteHeldRecording(rec.id)} disabled={busy} title="Delete recording" aria-label="Delete recording" />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── List + detail ── */}
        <div style={{ display: 'grid', gridTemplateColumns: wide ? 'minmax(280px,340px) minmax(0,1fr)' : '1fr', gap: 16, alignItems: 'start' }}>

          {/* List pane */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: NC_TYPE.body, fontWeight: 600, color: C.text, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {suiteIcon('description', 15)} Recent shailos
              </span>
              <ActionBtn variant="text" icon="content_copy" iconSize={12} height={26} labelSize={NC_TYPE.small} labelColor={C.accent}
                onClick={copyAllShailos} title="Copy all filtered shailos to the clipboard">Copy all</ActionBtn>
            </div>
            <ChipSet>
              {[['all', 'All'], ['pending', 'Researching'], ['answered', 'Have Answer'], ['got_back', 'Got Back']].map(([f, lbl]) => (
                <FilterChip key={f} label={lbl} selected={statusFilter === f} onClick={() => setStatusFilter(f)}
                  style={{ '--md-filter-chip-container-height': '26px', '--md-filter-chip-label-text-size': '11px' }} />
              ))}
            </ChipSet>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: wide ? 'calc(100vh - 300px)' : 380, overflowY: 'auto', paddingRight: 2 }}>
              {filteredShailos.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 12px', background: C.bgSoft, borderRadius: RADIUS.md, border: `1px dashed ${C.divider}`, color: C.faint, fontSize: NC_TYPE.meta }}>
                  No shailos found
                  <div style={{ fontSize: NC_TYPE.small, marginTop: 6, wordBreak: 'break-all' }}>Signed in as {user.email || '(no email)'} · folder "{USER_ID}"</div>
                </div>
              ) : filteredShailos.map((shaila) => {
                const active = selectedShaila?.id === shaila.id;
                return (
                  <div key={shaila.id} onClick={() => setSelectedShaila(shaila)}
                    style={{
                      padding: '8px 10px', borderRadius: RADIUS.sm, cursor: 'pointer',
                      border: `1px solid ${active ? tint(C.accent, '55') : C.divider}`,
                      background: active ? tint(C.accent, '10') : C.bgSoft,
                      display: 'flex', alignItems: 'center', gap: 10, minWidth: 0,
                      transition: 'background 0.12s, border-color 0.12s',
                    }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: NC_TYPE.meta, fontWeight: 700, color: C.text, lineHeight: 1.35, wordBreak: 'break-word', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {shaila.synopsis || shaila.content}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                        <span style={{ fontSize: 10, color: C.faint, whiteSpace: 'nowrap' }}>{shortDate(shaila.date)}</span>
                        <span style={{ fontSize: 10, color: C.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shaila.askerName}</span>
                      </div>
                      {(shaila.status === 'answered' || shaila.status === 'got_back') && shaila.answer?.trim() && (() => {
                        const snippet = shaila.answerSummary?.trim() || (() => {
                          const words = (shaila.answer || '').trim().split(/\s+/).filter(Boolean);
                          return words.slice(0, 6).join(' ') + (words.length > 6 ? '…' : '');
                        })();
                        return <div style={{ fontSize: 10, fontStyle: 'italic', color: shaila.status === 'got_back' ? C.success : GOLD, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{snippet}</div>;
                      })()}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                      {isResearching(shaila.id) && <Spin size={14} color={C.accent} />}
                      {!isResearching(shaila.id) && shaila.researchReport && (
                        <IconBtn icon="science" iconSize={14} color={C.accent} title="View research"
                          aria-label="View research"
                          onClick={(e) => { e.stopPropagation(); setSelectedShaila(shaila); scrollToResearch(); }} />
                      )}
                      {shaila.status === 'pending' ? statusChip('pending') : gotBackChip(shaila, { small: true })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Detail pane */}
          <div style={{ minWidth: 0 }}>
            {selectedShaila ? (
              <div style={{ background: C.bgSoft, borderRadius: RADIUS.md, padding: 'clamp(16px,2.4vw,26px)', minHeight: 400, display: 'flex', flexDirection: 'column', animation: 'ot-fade 0.2s' }}>
                {/* Header row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 18 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                      {statusChip(selectedShaila.status, !!selectedShaila._manualDraft)}
                      {!selectedShaila._manualDraft && selectedShaila.status !== 'pending' && gotBackChip(selectedShaila)}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input style={{ ...inlineEdit, fontSize: 10, color: C.faint, fontFamily: 'ui-monospace, monospace', width: 130 }}
                        value={selectedShaila.date || ''}
                        onChange={(e) => setSelectedShaila({ ...selectedShaila, date: e.target.value })}
                        onBlur={fieldBlur} aria-label="Date" />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                      <textarea rows={2} placeholder="Synopsis"
                        style={{ ...inlineEdit, fontSize: NC_TYPE.body, fontWeight: 600, lineHeight: 1.35, resize: 'none', flex: 1 }}
                        value={selectedShaila.synopsis || ''}
                        onChange={(e) => setSelectedShaila({ ...selectedShaila, synopsis: e.target.value })}
                        onBlur={fieldBlur} aria-label="Synopsis" />
                      <IconBtn icon="refresh" iconSize={13}
                        color={isGeneratingSynopsis === selectedShaila.id ? C.accent : C.faint}
                        onClick={() => handleRegenerateSynopsis(selectedShaila)}
                        disabled={isGeneratingSynopsis === selectedShaila.id}
                        title="Regenerate synopsis with AI" aria-label="Regenerate synopsis"
                        style={isGeneratingSynopsis === selectedShaila.id ? { animation: 'ot-spin 0.9s linear infinite' } : undefined} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <span style={{ fontSize: NC_TYPE.small, color: C.faint, flexShrink: 0 }}>Asker:</span>
                      <input placeholder="Unknown"
                        style={{ ...inlineEdit, fontSize: NC_TYPE.small, fontWeight: 500, color: C.muted, width: 160 }}
                        value={selectedShaila.askerName || ''}
                        onChange={(e) => setSelectedShaila({ ...selectedShaila, askerName: e.target.value })}
                        onBlur={fieldBlur} aria-label="Asker name" />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                    {!selectedShaila._manualDraft ? (
                      <>
                        {isResearching(selectedShaila.id)
                          ? <span style={{ width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Spin size={15} color={C.accent} /></span>
                          : <IconBtn icon="science" iconSize={15} color={C.muted} onClick={() => handleResearch(selectedShaila)} title="Research this shaila" aria-label="Research this shaila" />}
                        <IconBtn icon="content_copy" iconSize={14} color={C.muted}
                          onClick={() => copyToClipboard(formatShailaForCopy(selectedShaila))} title="Copy to clipboard" aria-label="Copy to clipboard" />
                        <IconBtn icon="delete" iconSize={15} color={C.muted}
                          onClick={() => deleteShaila(selectedShaila.id)} title="Delete shaila" aria-label="Delete shaila" />
                      </>
                    ) : (
                      <ActionBtn variant="text" height={30} labelSize={NC_TYPE.small} labelColor={C.muted}
                        onClick={() => setSelectedShaila(null)} title="Cancel draft">Cancel</ActionBtn>
                    )}
                  </div>
                </div>

                {/* Body sections */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1 }}>
                  <section>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={sectionLabel}>Shaila question</span>
                      {recordBtn('content')}
                    </div>
                    <TextField type="textarea" rows={5} placeholder="The shaila text…" value={selectedShaila.content || selectedShaila.parsedShaila || ''}
                      onInput={(e) => setSelectedShaila({ ...selectedShaila, content: e.target.value, parsedShaila: e.target.value })}
                      onBlur={fieldBlur} style={{ width: '100%', '--md-outlined-text-field-container-shape': RADIUS.sm }} />
                  </section>

                  <section>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={sectionLabel}>Answer details</span>
                      {recordBtn('answer')}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: wide ? 'minmax(0,220px) minmax(0,1fr)' : '1fr', gap: 12 }}>
                      <TextField label="Answerer" placeholder="e.g. YCD, CC" value={selectedShaila.answererName || ''}
                        onInput={(e) => setSelectedShaila({ ...selectedShaila, answererName: e.target.value })}
                        onBlur={fieldBlur} style={{ width: '100%', '--md-outlined-text-field-container-shape': RADIUS.sm }} />
                      <TextField type="textarea" rows={4} label="Answer & reasons" placeholder="[waiting for answer]" value={selectedShaila.answer || ''}
                        onInput={(e) => setSelectedShaila({ ...selectedShaila, answer: e.target.value })}
                        onBlur={fieldBlur} style={{ width: '100%', '--md-outlined-text-field-container-shape': RADIUS.sm }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                      <ActionBtn variant="filled" icon="send" iconSize={14} height={36} containerColor={C.accent} labelColor="#fff"
                        onClick={() => saveShailaDetails(selectedShaila, { submitManualDraft: true })}
                        title={selectedShaila._manualDraft ? 'Submit shaila' : 'Save details'}>
                        {selectedShaila._manualDraft ? 'Submit Shaila' : 'Save Details'}
                      </ActionBtn>
                    </div>
                  </section>

                  <section>
                    <div style={{ ...sectionLabel, marginBottom: 8 }}>Raw transcript / content</div>
                    <TextField type="textarea" rows={4} value={selectedShaila.content || ''}
                      onInput={(e) => setSelectedShaila({ ...selectedShaila, content: e.target.value })}
                      onBlur={fieldBlur} style={{ width: '100%', '--md-outlined-text-field-container-shape': RADIUS.sm }} />
                  </section>
                </div>

                {/* Research report */}
                {selectedShaila.researchReport && (
                  <div ref={researchRef} style={{ marginTop: 26, paddingTop: 20, borderTop: `1px solid ${C.divider}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <span style={{ fontSize: NC_TYPE.meta, fontWeight: 700, color: C.text, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {suiteIcon('science', 15)} Research findings
                      </span>
                      <ActionBtn variant="text" icon={isResearching(selectedShaila.id) ? 'progress_activity' : 'add'} iconSize={12} height={26}
                        labelSize={NC_TYPE.small} labelColor={C.accent}
                        onClick={() => handleResearch(selectedShaila)} disabled={isResearching(selectedShaila.id)}
                        title="Run the research again">Redo research</ActionBtn>
                    </div>
                    <ResearchReport text={selectedShaila.researchReport} C={C} />
                  </div>
                )}
              </div>
            ) : (
              <div style={{ minHeight: 320, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 40, background: C.bgSoft, borderRadius: RADIUS.md, border: `1px dashed ${C.divider}` }}>
                <span style={{ width: 56, height: 56, borderRadius: RADIUS.pill, background: C.bg, color: C.faint, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>{suiteIcon('description', 26)}</span>
                <div style={{ fontSize: NC_TYPE.body, fontWeight: 600, color: C.text }}>No shaila selected</div>
                <div style={{ fontSize: NC_TYPE.meta, color: C.faint, maxWidth: 280, marginTop: 4 }}>Select a shaila from the list to view details, transcription, and provide an answer.</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Paste modal ── */}
      {showAddModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: Z.modal, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={() => setShowAddModal(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.42)' }} />
          <div style={{ position: 'relative', width: '100%', maxWidth: 520, background: C.bg, borderRadius: RADIUS.md, boxShadow: ELEV[4], overflow: 'hidden', animation: 'ot-fade 0.2s' }}>
            <div style={{ padding: '18px 20px', borderBottom: `1px solid ${C.divider}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontSize: NC_TYPE.title, fontWeight: 700, color: C.text }}>Paste shaila text</div>
                <div style={{ fontSize: NC_TYPE.meta, color: C.faint }}>Paste the text of a shaila to have it parsed by AI.</div>
              </div>
            </div>
            <div style={{ padding: 20 }}>
              <TextField type="textarea" rows={8} placeholder="Paste text here…" value={pastedText}
                onInput={(e) => setPastedText(e.target.value)}
                style={{ width: '100%', marginBottom: 14, '--md-outlined-text-field-container-shape': RADIUS.sm }} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <ActionBtn variant="text" height={36} labelColor={C.muted} onClick={() => setShowAddModal(false)}>Cancel</ActionBtn>
                <ActionBtn variant="filled" height={36} containerColor={C.accent} labelColor="#fff"
                  icon={isProcessing ? 'progress_activity' : undefined}
                  onClick={handlePasteSubmit} disabled={!pastedText.trim() || isProcessing}>
                  {isProcessing ? 'Parsing…' : 'Parse Shaila'}
                </ActionBtn>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Potential matches modal ── */}
      {potentialMatches && (
        <div style={{ position: 'fixed', inset: 0, zIndex: Z.modal, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
          <div style={{ position: 'relative', width: '100%', maxWidth: 580, background: C.bg, borderRadius: RADIUS.md, boxShadow: ELEV[4], overflow: 'hidden', animation: 'ot-fade 0.2s' }}>
            <div style={{ padding: '18px 20px', borderBottom: `1px solid ${C.divider}`, background: tint(C.accent, '10') }}>
              <div style={{ fontSize: NC_TYPE.title, fontWeight: 700, color: C.text }}>Potential follow-up detected</div>
              <div style={{ fontSize: NC_TYPE.meta, color: C.muted }}>This recording seems related to an existing shaila. Should we integrate it?</div>
            </div>
            <div style={{ padding: 20, maxHeight: '58vh', overflowY: 'auto' }}>
              <div style={{ marginBottom: 18, padding: 14, background: C.bgSoft, borderRadius: RADIUS.sm, border: `1px solid ${C.divider}` }}>
                <span style={sectionLabel}>New recording</span>
                <div style={{ fontSize: NC_TYPE.meta, fontWeight: 600, color: C.text, marginTop: 4 }}>{potentialMatches.newShaila.synopsis}</div>
                <div style={{ fontSize: NC_TYPE.small, color: C.faint, marginTop: 4, fontStyle: 'italic' }}>"{potentialMatches.newShaila.shailaContent}"</div>
              </div>
              <span style={sectionLabel}>Suggested matches</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                {potentialMatches.matches.map((match) => (
                  <div key={match.id} onClick={() => integrateShaila(match, potentialMatches.newShaila)}
                    style={{ padding: 14, borderRadius: RADIUS.sm, border: `1px solid ${C.divider}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: C.bgSoft }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: NC_TYPE.meta, fontWeight: 700, color: C.text }}>{match.synopsis}</div>
                      <div style={{ fontSize: NC_TYPE.small, color: C.faint }}>Asker: {match.askerName} · {match.date}</div>
                    </div>
                    <ActionBtn variant="tonal" height={28} labelSize={NC_TYPE.small} containerColor={tint(C.accent, '18')} labelColor={C.accent}
                      onClick={(e) => { e.stopPropagation(); integrateShaila(match, potentialMatches.newShaila); }}>Integrate</ActionBtn>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding: '14px 20px', borderTop: `1px solid ${C.divider}`, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <ActionBtn variant="text" height={36} labelColor={C.muted} onClick={() => setPotentialMatches(null)}>Cancel</ActionBtn>
              <ActionBtn variant="filled" height={36} containerColor={C.accent} labelColor="#fff"
                onClick={() => { saveShailos([potentialMatches.newShaila]); setPotentialMatches(null); }}>
                Create as New Shaila
              </ActionBtn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
