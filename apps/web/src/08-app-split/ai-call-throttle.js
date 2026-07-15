// ── Durable, cross-device AI-call throttle ──────────────────────────────────
// Owner ticket 7/15: TaskRiver's and NerveCenter's "don't auto-refresh too often"
// brakes lived in localStorage / an in-memory ref — neither survives a screen
// change cleanly, and neither is shared across a user's other devices. Both burned
// far more Gemini quota than intended as a result. This moves the brake into
// Firestore, scoped per-user under users/{uid}/ai-throttles/{key} — a path already
// fully read/write for the signed-in owner under the existing per-user rule
// (firestore.rules: match /users/{userId}/{document=**}), so no rules change
// was needed to add this.
import { db, canonicalUid } from '../01-core.js';

function throttleRef(key) {
  if (!db || typeof firebase === 'undefined' || !firebase.auth) return null;
  const user = firebase.auth().currentUser;
  const uid = canonicalUid(user);
  if (!uid) return null;
  return db.collection('users').doc(uid).collection('ai-throttles').doc(key);
}

// Atomically checks "has it been at least minGapMs since the last claim for this
// key?" and, if so, claims it (writes lastRunAtMs = now) in the same transaction —
// so two tabs or two devices racing to check at the same instant can't both win.
// Returns true if the caller should run now, false if it should wait.
export async function shouldRunAndClaim(key, minGapMs) {
  const ref = throttleRef(key);
  if (!ref) return true; // not signed in / no Firestore yet — don't block the feature
  const now = Date.now();
  try {
    return await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const lastRunAtMs = Number(snap.exists ? snap.data()?.lastRunAtMs : 0) || 0;
      if (now - lastRunAtMs < minGapMs) return false;
      tx.set(ref, { lastRunAtMs: now }, { merge: true });
      return true;
    });
  } catch (e) {
    console.warn('[ai-call-throttle] claim failed, allowing the call through:', e.message);
    return true; // fail open — a missed throttle costs a little quota, not a broken feature
  }
}

// Read-only peek at when a key last ran, without claiming it — used to decide whether
// an app-open / became-visible trigger should still bypass the normal gap (e.g. "it's
// been over 2 minutes since TaskRiver last ranked, refresh now").
export async function msSinceLastRun(key) {
  const ref = throttleRef(key);
  if (!ref) return Infinity;
  try {
    const snap = await ref.get();
    const lastRunAtMs = Number(snap.exists ? snap.data()?.lastRunAtMs : 0) || 0;
    return lastRunAtMs > 0 ? Date.now() - lastRunAtMs : Infinity;
  } catch (e) {
    console.warn('[ai-call-throttle] peek failed:', e.message);
    return Infinity;
  }
}
