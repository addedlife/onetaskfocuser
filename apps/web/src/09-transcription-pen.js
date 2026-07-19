import firebase from 'firebase/compat/app';
import 'firebase/compat/storage';
import { callGeminiAudio, canonicalUid, db } from './01-core.js';

const PENDING_DB = 'onetask_shailos_pending_audio';
const PENDING_STORE = 'recordings';
const PENDING_EVENT = 'onetask:pending-recordings-changed';

// How long held recordings + transcripts survive (local IndexedDB AND the cloud
// copies) before the sweep removes them. 10 days, per owner spec 2026-07-19.
const PEN_RETENTION_MS = 10 * 24 * 60 * 60 * 1000;

// Transcription upload chunking. The proxy path has two hard request caps —
// ~32 MB at Cloud Functions v2 and ~20 MB inline at Gemini — and a 15-minute
// recording rendered to 16 kHz WAV is ~29 MB raw / ~38 MB base64, which is why
// long recordings used to die as "returned no text". 240-second chunks are
// 7.7 MB WAV / ~10.3 MB base64: comfortably under every cap.
const WAV_SAMPLE_RATE = 16000;
const CHUNK_SECONDS = 240;

function emitPendingChanged() {
  try { window.dispatchEvent(new CustomEvent(PENDING_EVENT)); } catch(e) {}
}

function openPendingDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PENDING_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PENDING_STORE)) db.createObjectStore(PENDING_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open pending audio store'));
  });
}

async function withPendingStore(mode, fn) {
  const db = await openPendingDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_STORE, mode);
    const store = tx.objectStore(PENDING_STORE);
    const req = fn(store);
    if (req) {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Pending audio operation failed'));
    }
    tx.oncomplete = () => { if (!req) resolve(); };
    tx.onerror = () => reject(tx.error || new Error('Pending audio transaction failed'));
  }).finally(() => db.close());
}

// ── Cloud pen (Firebase) ─────────────────────────────────────────────────────
// Audio blobs go to Storage at pen/{uid}/{id}.{ext}; metadata + transcripts go
// to Firestore users/{uid}/pen/{id}. Everything here is best-effort: signed-out
// or offline, the local IndexedDB pen keeps working exactly as before.

function _penUser() {
  try { return (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null; } catch(_) { return null; }
}

function _penCol() {
  const uid = canonicalUid(_penUser());
  if (!uid || !db) return null;
  return db.collection('users').doc(uid).collection('pen');
}

function _penExt(mimeType) {
  return String(mimeType || '').includes('wav') ? 'wav' : 'webm';
}

function _penStorageRef(id, mimeType) {
  const uid = canonicalUid(_penUser());
  if (!uid) return null;
  try { return firebase.storage().ref(`pen/${uid}/${id}.${_penExt(mimeType)}`); } catch(_) { return null; }
}

async function syncPendingToCloud(rec) {
  const col = _penCol();
  const ref = _penStorageRef(rec.id, rec.mimeType);
  if (!col || !ref) return;
  await ref.put(rec.blob, { contentType: rec.mimeType || 'audio/webm' });
  await col.doc(rec.id).set({
    id: rec.id,
    kind: rec.kind || '',
    label: rec.label || '',
    source: rec.source || '',
    createdAt: rec.createdAt,
    size: rec.size,
    mimeType: rec.mimeType || 'audio/webm',
    storagePath: ref.fullPath,
    transcript: '',
    status: 'held',
    error: '',
  }, { merge: true });
  await updatePendingRecording(rec.id, { cloudSynced: true });
}

// All non-resolved pen entries visible to this account, across devices.
async function listCloudPenRecordings() {
  const col = _penCol();
  if (!col) return [];
  const snap = await col.orderBy('createdAt', 'desc').limit(50).get();
  return snap.docs.map(d => d.data()).filter(r => r && r.id);
}

// Pull a cloud-only recording's audio down so this device can transcribe or
// play it — the cross-device half of "retry anywhere".
async function ensureLocalPenAudio(entry) {
  const local = await getPendingRecording(entry.id).catch(() => null);
  if (local?.blob) return local;
  if (!entry.storagePath) throw new Error('This recording’s audio is not on this device and has no cloud copy.');
  const url = await firebase.storage().ref(entry.storagePath).getDownloadURL();
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Could not download the saved audio from cloud storage.');
  const blob = await resp.blob();
  const rec = {
    id: entry.id,
    kind: entry.kind || '',
    label: entry.label || '',
    source: entry.source || '',
    createdAt: entry.createdAt || Date.now(),
    mimeType: entry.mimeType || blob.type || 'audio/webm',
    size: blob.size,
    cloudSynced: true,
    blob,
  };
  await withPendingStore('readwrite', store => store.put(rec));
  emitPendingChanged();
  return rec;
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// Save the audio file to disk so it can be transcribed elsewhere if the
// in-app pipeline is misbehaving. Works from the local blob when present,
// otherwise streams down the cloud copy.
async function downloadPenRecording(entry) {
  const stamp = new Date(entry.createdAt || Date.now()).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `shamash-recording-${stamp}.${_penExt(entry.mimeType)}`;
  const local = await getPendingRecording(entry.id).catch(() => null);
  if (local?.blob) { triggerBlobDownload(local.blob, filename); return; }
  const rec = await ensureLocalPenAudio(entry);
  triggerBlobDownload(rec.blob, filename);
}

// Remove expired entries (older than PEN_RETENTION_MS) from the local pen,
// Firestore, and Storage. Called once per app load; every step best-effort.
async function sweepExpiredPen() {
  const cutoff = Date.now() - PEN_RETENTION_MS;
  let swept = 0;
  try {
    const locals = await listPendingRecordings();
    for (const r of locals) {
      if ((r.createdAt || 0) < cutoff) {
        await withPendingStore('readwrite', store => { store.delete(r.id); }).catch(() => {});
        swept++;
      }
    }
  } catch(_) {}
  try {
    const col = _penCol();
    if (col) {
      const snap = await col.where('createdAt', '<', cutoff).get();
      for (const d of snap.docs) {
        const path = d.data()?.storagePath;
        if (path) await firebase.storage().ref(path).delete().catch(() => {});
        await d.ref.delete().catch(() => {});
        swept++;
      }
    }
  } catch(_) {}
  if (swept) emitPendingChanged();
  return swept;
}

// ── Local pen CRUD ───────────────────────────────────────────────────────────

async function savePendingRecording(blob, kind, meta = {}) {
  const rec = {
    id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind,
    createdAt: Date.now(),
    mimeType: blob.type || 'audio/webm',
    size: blob.size,
    ...meta,
    blob,
  };
  await withPendingStore('readwrite', store => store.put(rec));
  emitPendingChanged();
  syncPendingToCloud(rec).catch(e => console.warn('[Pen] Cloud sync failed (audio is still safe on this device):', e?.message || e));
  const { blob: _blob, ...publicRec } = rec;
  return publicRec;
}

async function listPendingRecordings() {
  const records = await withPendingStore('readonly', store => store.getAll()) || [];
  return records
    .map(({ blob, ...meta }) => meta)
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function getPendingRecording(id) {
  return await withPendingStore('readonly', store => store.get(id)) || null;
}

async function updatePendingRecording(id, patch) {
  const rec = await getPendingRecording(id);
  if (!rec) return null;
  const next = { ...rec, ...patch };
  await withPendingStore('readwrite', store => store.put(next));
  emitPendingChanged();
  const { blob, ...publicRec } = next;
  return publicRec;
}

async function updatePendingRecordingError(id, error) {
  const next = await updatePendingRecording(id, { error, lastFailedAt: Date.now() });
  const col = _penCol();
  if (col) {
    const patch = error ? { error: String(error), status: 'error' } : { error: '' };
    col.doc(id).set(patch, { merge: true }).catch(() => {});
  }
  return next;
}

async function deletePendingRecording(id) {
  await withPendingStore('readwrite', store => { store.delete(id); });
  const col = _penCol();
  if (col) {
    col.doc(id).get().then(d => {
      const path = d.exists ? d.data()?.storagePath : null;
      if (path) firebase.storage().ref(path).delete().catch(() => {});
      if (d.exists) d.ref.delete().catch(() => {});
    }).catch(() => {});
  }
  emitPendingChanged();
}

// ── Audio conversion ─────────────────────────────────────────────────────────

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result.split(',')[1]);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}

// Decode any browser-recorded container and resample to 16 kHz mono PCM —
// the smallest representation Gemini transcribes reliably.
async function decodeToPcm16k(webmBlob) {
  const arrayBuf = await webmBlob.arrayBuffer();
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioContextCtor();
  let decoded;
  try { decoded = await audioCtx.decodeAudioData(arrayBuf); }
  finally { audioCtx.close(); }

  const frameCount = Math.max(1, Math.ceil(decoded.duration * WAV_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frameCount, WAV_SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

function pcmSliceToWavBlob(pcm, start, end) {
  const len = end - start;
  const dataLen = len * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true);
  str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, WAV_SAMPLE_RATE, true); v.setUint32(28, WAV_SAMPLE_RATE * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, dataLen, true);
  for (let i = 0; i < len; i++) {
    v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, pcm[start + i] * 32768 | 0)), true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

async function webmToWavBase64(webmBlob) {
  const pcm = await decodeToPcm16k(webmBlob);
  return blobToBase64(pcmSliceToWavBlob(pcm, 0, pcm.length));
}

// Split a recording into upload-sized WAV chunks (see CHUNK_SECONDS above).
async function webmToWavChunkBase64s(webmBlob, chunkSeconds = CHUNK_SECONDS) {
  const pcm = await decodeToPcm16k(webmBlob);
  const chunkFrames = Math.max(1, Math.floor(chunkSeconds * WAV_SAMPLE_RATE));
  const chunks = [];
  for (let start = 0; start < pcm.length; start += chunkFrames) {
    const end = Math.min(pcm.length, start + chunkFrames);
    chunks.push(await blobToBase64(pcmSliceToWavBlob(pcm, start, end)));
  }
  return chunks;
}

// ── Transcription ────────────────────────────────────────────────────────────
// Long recordings are transcribed chunk-by-chunk and joined. onProgress(done, total)
// lets UIs show "part 2 of 4". On success the transcript is persisted to the
// local pen entry AND the cloud doc, so it survives restarts and other devices see it.

async function transcribePendingRecording(id, aiOpts, prompt, genConfig = {}, onProgress = null) {
  const rec = await getPendingRecording(id);
  if (!rec) throw new Error('Saved recording not found on this device.');
  let chunks;
  let mimeType;
  try {
    chunks = await webmToWavChunkBase64s(rec.blob);
    mimeType = 'audio/wav';
  } catch(e) {
    // Decode failed (corrupt/odd container) — fall back to sending the original
    // file whole, but only when it actually fits under the upload caps.
    if (rec.blob.size > 14 * 1024 * 1024) {
      throw new Error(`Could not decode this ${(rec.blob.size / 1048576).toFixed(1)} MB recording for chunked upload, and it is too large to send whole. Use Download and transcribe it externally.`);
    }
    chunks = [await blobToBase64(rec.blob)];
    mimeType = rec.mimeType || 'audio/webm';
  }

  const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    if (onProgress) { try { onProgress(i + 1, chunks.length); } catch(_) {} }
    // Part note goes BEFORE the caller prompt: the server truncates the
    // instruction at 1000 chars, and long caller prompts would swallow a suffix.
    const partPrompt = chunks.length === 1 ? prompt
      : `Part ${i + 1} of ${chunks.length} of one continuous recording (split only for upload limits). Transcribe this part verbatim; do not summarize or repeat other parts. ${prompt || ''}`;
    const txt = await callGeminiAudio(aiOpts, chunks[i], mimeType, partPrompt, genConfig);
    if (!txt || !String(txt).trim()) {
      throw new Error(chunks.length === 1
        ? 'The AI gateway returned no transcript — likely rate-limited or timed out. The audio is still saved; retry in a few minutes.'
        : `The AI gateway returned nothing for part ${i + 1} of ${chunks.length} — likely rate-limited or timed out. The audio is still saved; retry in a few minutes.`);
    }
    parts.push(String(txt).trim());
  }

  const text = parts.join('\n');
  await updatePendingRecording(id, { transcript: text, transcribedAt: Date.now(), error: '' }).catch(() => {});
  const col = _penCol();
  if (col) col.doc(id).set({ transcript: text, status: 'transcribed', error: '', transcribedAt: Date.now() }, { merge: true }).catch(() => {});
  return text;
}

function formatPendingAge(ts) {
  try {
    return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch(e) {
    return '';
  }
}

export {
  PENDING_EVENT,
  PEN_RETENTION_MS,
  savePendingRecording,
  listPendingRecordings,
  getPendingRecording,
  updatePendingRecording,
  updatePendingRecordingError,
  deletePendingRecording,
  transcribePendingRecording,
  listCloudPenRecordings,
  ensureLocalPenAudio,
  downloadPenRecording,
  sweepExpiredPen,
  webmToWavBase64,
  blobToBase64,
  formatPendingAge,
};
