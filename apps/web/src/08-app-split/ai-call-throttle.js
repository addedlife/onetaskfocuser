// ── Durable, cross-device AI-call throttle ──────────────────────────────────
// Owner ticket 7/15: TaskRiver's and NerveCenter's "don't auto-refresh too often"
// brakes lived in localStorage / an in-memory ref — neither survives a screen
// change cleanly, and neither is shared across a user's other devices. Both burned
// far more Gemini quota than intended as a result. This moves the brake into
// Firestore, scoped per-user under users/{uid}/ai-throttles/{key} — a path already
// fully read/write for the signed-in owner under the existing per-user rule
// (firestore.rules: match /users/{userId}/{document=**}), so no rules change
// was needed to add this.
//
// Owner ticket 7/16 ("ai calls are dead again"): the 7/15 version failed OPEN on
// every Firestore error — when the claim transaction couldn't commit (offline
// wedge, permission problem, anything), every check answered "run now" and the
// dashboard-snapshot job burned both Gemini lanes' full daily quota in one day
// (483 calls, 4–6s apart). The Firestore claim is still the cross-device source
// of truth, but a per-device local gate (in-memory + localStorage) now backs it:
// a broken Firestore degrades to "at most one run per gap per device", never to
// "unlimited".
import { db, canonicalUid } from '../01-core.js';

function throttleRef(key) {
  if (!db || typeof firebase === 'undefined' || !firebase.auth) return null;
  const user = firebase.auth().currentUser;
  const uid = canonicalUid(user);
  if (!uid) return null;
  return db.collection('users').doc(uid).collection('ai-throttles').doc(key);
}

// Local per-device gate. lastRunAtMs mirrors the last run this device was granted;
// deniedUntilMs suppresses repeat Firestore transactions after a cross-device
// denial, so a hot caller (an effect re-running every few seconds) doesn't churn
// the shared claim document either.
const _localGate = new Map(); // key → { lastRunAtMs, deniedUntilMs }
const LOCAL_DENY_MEMO_MS = 30000;

function _localStorageKey(key) { return `shamash_ai_throttle_${key}`; }

function _readLocalGate(key) {
  const gate = _localGate.get(key) || { lastRunAtMs: 0, deniedUntilMs: 0 };
  try {
    const stored = Number(localStorage.getItem(_localStorageKey(key))) || 0;
    if (stored > gate.lastRunAtMs) gate.lastRunAtMs = stored;
  } catch (_) {}
  _localGate.set(key, gate);
  return gate;
}

function _claimLocalGate(key, now) {
  const gate = _readLocalGate(key);
  gate.lastRunAtMs = now;
  gate.deniedUntilMs = 0;
  try { localStorage.setItem(_localStorageKey(key), String(now)); } catch (_) {}
}

function _denyLocalGate(key, now, minGapMs) {
  const gate = _readLocalGate(key);
  gate.deniedUntilMs = now + Math.min(LOCAL_DENY_MEMO_MS, minGapMs || LOCAL_DENY_MEMO_MS);
}

// Atomically checks "has it been at least minGapMs since the last claim for this
// key?" and, if so, claims it (writes lastRunAtMs = now) in the same transaction —
// so two tabs or two devices racing to check at the same instant can't both win.
// Returns true if the caller should run now, false if it should wait.
// minGapMs = 0 is the manual-refresh escape hatch: it bypasses the local gate and
// always claims.
export async function shouldRunAndClaim(key, minGapMs) {
  const now = Date.now();
  if (minGapMs > 0) {
    const gate = _readLocalGate(key);
    if (now - gate.lastRunAtMs < minGapMs || now < gate.deniedUntilMs) return false;
  }

  const ref = throttleRef(key);
  if (!ref) { _claimLocalGate(key, now); return true; } // not signed in / no Firestore yet — local gate still holds
  try {
    const allowed = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const lastRunAtMs = Number(snap.exists ? snap.data()?.lastRunAtMs : 0) || 0;
      if (now - lastRunAtMs < minGapMs) return false;
      tx.set(ref, { lastRunAtMs: now }, { merge: true });
      return true;
    });
    if (allowed) _claimLocalGate(key, now);
    else _denyLocalGate(key, now, minGapMs);
    return allowed;
  } catch (e) {
    // Fail SEMI-open: the local gate above already passed, so grant this one run
    // and hold the local gate for the full gap — a dead Firestore costs at most
    // one call per gap per device instead of a call storm.
    console.warn('[ai-call-throttle] Firestore claim failed; local per-device gate holds the gap:', e.message);
    _claimLocalGate(key, now);
    return true;
  }
}

// Read-only peek at when a key last ran, without claiming it — used to decide whether
// an app-open / became-visible trigger should still bypass the normal gap (e.g. "it's
// been over 2 minutes since TaskRiver last ranked, refresh now").
export async function msSinceLastRun(key) {
  const localElapsed = (() => {
    const last = _readLocalGate(key).lastRunAtMs;
    return last > 0 ? Date.now() - last : Infinity;
  })();
  const ref = throttleRef(key);
  if (!ref) return localElapsed;
  try {
    const snap = await ref.get();
    const lastRunAtMs = Number(snap.exists ? snap.data()?.lastRunAtMs : 0) || 0;
    const remoteElapsed = lastRunAtMs > 0 ? Date.now() - lastRunAtMs : Infinity;
    return Math.min(localElapsed, remoteElapsed);
  } catch (e) {
    console.warn('[ai-call-throttle] peek failed:', e.message);
    return localElapsed;
  }
}
