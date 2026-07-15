// ── Live AI-lane status ─────────────────────────────────────────────────────
// Read-only mirror of _system/ai-status (written by _ai-core.cjs recordAiLaneEvent
// on the backend, only when the serving lane actually changes). Tells the rail chip
// which lane is currently answering AI calls — Gemini primary, Gemini overflow, or
// the Claude last-resort fallback — and the recent history of switches. Same
// onSnapshot/normalize shape as phone-host-control.js's subscribeOwner.
import { db } from '../01-core.js';

function statusRef() {
  return db ? db.collection('_system').doc('ai-status') : null;
}

// No doc yet (fresh deploy, fallback has never fired) normalizes to the quiet
// Gemini-primary default so the chip never has to null-check.
export function normalizeAiLaneStatus(data) {
  const d = data || {};
  const currentLane = typeof d.currentLane === 'string' && d.currentLane ? d.currentLane : 'gemini:primary';
  const label = typeof d.label === 'string' && d.label ? d.label : 'Gemini';
  const recent = Array.isArray(d.recent)
    ? d.recent
        .filter(e => e && typeof e === 'object')
        .map(e => ({ lane: String(e.lane || ''), label: String(e.label || ''), at: Number(e.at) || 0, reason: String(e.reason || '') }))
    : [];
  return { currentLane, label, provider: d.provider || 'gemini', model: d.model || '', updatedAt: Number(d.updatedAt) || 0, recent };
}

export function subscribeAiLaneStatus(onUpdate) {
  const ref = statusRef();
  if (!ref) return () => {};
  return ref.onSnapshot(
    snap => {
      if (snap.metadata && snap.metadata.fromCache) return;
      onUpdate(normalizeAiLaneStatus(snap.exists ? snap.data() : null));
    },
    err => { console.warn('[ai-lane-status] listener error:', err); },
  );
}
