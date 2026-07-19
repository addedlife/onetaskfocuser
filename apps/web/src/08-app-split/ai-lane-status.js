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
  const rawUsage = d.usage && typeof d.usage === 'object' ? d.usage : {};
  const usage = {
    totalToday: Number(rawUsage.totalToday) || 0,
    totalThisHour: Number(rawUsage.totalThisHour) || 0,
    totalThisMonth: Number(rawUsage.totalThisMonth) || 0,
    // Estimated dollars (server-computed from per-call token counts × list prices);
    // absent until the first call after the 4.84.5 functions deploy.
    spendTodayUsd: Number(rawUsage.spend?.todayUsd) || 0,
    spendMonthUsd: Number(rawUsage.spend?.monthUsd) || 0,
  };
  // Owner ticket 7/15 (AI call manager): leak alerts the recordAiUsage() heuristics in
  // _ai-core.cjs flag — a spike vs. a job's own trailing average, or suspiciously
  // regular/clockwork timing that looks automatic rather than user-triggered.
  const leaks = Array.isArray(d.leaks)
    ? d.leaks
        .filter(l => l && typeof l === 'object')
        .map(l => ({
          jobId: String(l.jobId || ''),
          dayKey: String(l.dayKey || ''),
          detectedAt: Number(l.detectedAt) || 0,
          reason: String(l.reason || ''),
          proposedFix: String(l.proposedFix || ''),
        }))
    : [];
  return { currentLane, label, provider: d.provider || 'gemini', model: d.model || '', updatedAt: Number(d.updatedAt) || 0, recent, usage, leaks };
}

// ── Live AI call log ────────────────────────────────────────────────────────
// Mirror of _system/ai-log (written by _ai-core.cjs recordAiLogEntry): the last
// ~25 AI calls with their real prompt, response, model and token counts. Same
// read-only onSnapshot shape as the lane status above.
export function normalizeAiLog(data) {
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  return entries
    .filter(e => e && typeof e === 'object')
    .map(e => ({
      at: Number(e.at) || 0,
      job: String(e.job || ''),
      provider: String(e.provider || ''),
      model: String(e.model || ''),
      credential: String(e.credential || ''),
      inTok: Number(e.inTok) || 0,
      outTok: Number(e.outTok) || 0,
      usd: Number(e.usd) || 0,
      elapsedMs: Number(e.elapsedMs) || 0,
      prompt: String(e.prompt || ''),
      response: String(e.response || ''),
      promptChars: Number(e.promptChars) || 0,
      responseChars: Number(e.responseChars) || 0,
      promptTruncated: !!e.promptTruncated,
      responseTruncated: !!e.responseTruncated,
    }))
    .sort((a, b) => b.at - a.at); // newest first for display
}

export function subscribeAiLog(onUpdate) {
  const ref = db ? db.collection('_system').doc('ai-log') : null;
  if (!ref) return () => {};
  return ref.onSnapshot(
    snap => {
      if (snap.metadata && snap.metadata.fromCache) return;
      onUpdate(normalizeAiLog(snap.exists ? snap.data() : null));
    },
    err => { console.warn('[ai-lane-status] log listener error:', err); },
  );
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
