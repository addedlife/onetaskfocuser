import { callGeminiAudio } from './01-core.js';

const PENDING_DB = 'onetask_shailos_pending_audio';
const PENDING_STORE = 'recordings';
const PENDING_EVENT = 'onetask:pending-recordings-changed';

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
  return updatePendingRecording(id, { error, lastFailedAt: Date.now() });
}

async function deletePendingRecording(id) {
  await withPendingStore('readwrite', store => { store.delete(id); });
  emitPendingChanged();
}

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result.split(',')[1]);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}

async function webmToWavBase64(webmBlob) {
  const arrayBuf = await webmBlob.arrayBuffer();
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioContextCtor();
  let decoded;
  try { decoded = await audioCtx.decodeAudioData(arrayBuf); }
  finally { audioCtx.close(); }

  const SR = 16000;
  const frameCount = Math.max(1, Math.ceil(decoded.duration * SR));
  const offline = new OfflineAudioContext(1, frameCount, SR);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  const pcm = rendered.getChannelData(0);

  const dataLen = pcm.length * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true);
  str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, dataLen, true);
  for (let i = 0; i < pcm.length; i++) {
    v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, pcm[i] * 32768 | 0)), true);
  }
  return blobToBase64(new Blob([buf], { type: 'audio/wav' }));
}

async function transcribePendingRecording(id, aiOpts, prompt, genConfig = {}) {
  const rec = await getPendingRecording(id);
  if (!rec) throw new Error('Saved recording not found.');
  let b64;
  let mimeType;
  try {
    b64 = await webmToWavBase64(rec.blob);
    mimeType = 'audio/wav';
  } catch(e) {
    b64 = await blobToBase64(rec.blob);
    mimeType = rec.mimeType || 'audio/webm';
  }
  const txt = await callGeminiAudio(aiOpts, b64, mimeType, prompt, genConfig);
  if (!txt) throw new Error('AI transcription returned no text.');
  return txt.trim();
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
  savePendingRecording,
  listPendingRecordings,
  getPendingRecording,
  updatePendingRecording,
  updatePendingRecordingError,
  deletePendingRecording,
  transcribePendingRecording,
  webmToWavBase64,
  blobToBase64,
  formatPendingAge,
};
