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

// ── Content-keyed claim (owner ticket WEmQ43Ks) ─────────────────────────────
// "Multiple displays open — PC tabs, tablet, iPad — should have no bearing on AI
// calls. If content changes anywhere it fires; if nothing changes it never fires."
//
// shouldRunAndClaim above dedupes on TIME, which cannot express that: four devices
// seeing the same unchanged dashboard would each still run once per gap, and each
// would run again on the next gap even though nothing had changed. This variant
// dedupes on CONTENT — the scan key of the data being summarized — so a given state
// of the world is scanned exactly once no matter how many surfaces are looking at
// it, and an idle app never calls at all.
//
// minGapMs is retained as a secondary cost brake: content that churns rapidly (a
// burst of incoming texts) still can't fire more than once per gap. Callers keep
// their own recheck timer, so the pending change is picked up right after.
const _localContentGate = new Map(); // key → last contentKey this device claimed

function _contentStorageKey(key) { return `shamash_ai_content_${key}`; }

function _readLocalContentKey(key) {
  if (_localContentGate.has(key)) return _localContentGate.get(key);
  try {
    const stored = localStorage.getItem(_contentStorageKey(key));
    if (stored) { _localContentGate.set(key, stored); return stored; }
  } catch (_) {}
  return null;
}

function _claimLocalContentKey(key, contentKey) {
  _localContentGate.set(key, contentKey);
  try { localStorage.setItem(_contentStorageKey(key), contentKey); } catch (_) {}
}

// Returns { run, cachedResult }. run=true means this surface won the claim and should
// make the AI call. run=false with a cachedResult means another surface already scanned
// this exact content — take its answer instead of computing the same thing again. That
// return shape matters: without it a second device would be correctly denied but would
// keep retrying forever, since nothing would ever tell it the content had been handled.
export async function shouldRunForContentAndClaim(key, contentKey, minGapMs = 0) {
  const content = String(contentKey || '');
  // A manual/forced refresh passes no content key — fall back to the time-only claim.
  if (!content) return { run: await shouldRunAndClaim(key, minGapMs), cachedResult: null };

  const now = Date.now();
  // Cheap local rejection first: this device already scanned exactly this state.
  if (_readLocalContentKey(key) === content) return { run: false, cachedResult: null };

  const ref = throttleRef(key);

  // Local per-device TIME gate, same as shouldRunAndClaim. This was missing (owner
  // buglog 7/19: three dashboard.snapshot responses streaming at once, more than one
  // claim per minute): every path that couldn't reach the Firestore claim — auth not
  // yet initialized (throttleRef null at app load, one unconditional grant PER MOUNTED
  // SURFACE), or the transaction throwing — granted a run on every content change with
  // no time brake at all. With this check, a broken/unavailable Firestore degrades to
  // at most one call per gap per device, never one per content churn. Adoption of
  // another surface's already-published answer stays allowed (plain read, no AI call).
  if (minGapMs > 0) {
    const gate = _readLocalGate(key);
    if (now - gate.lastRunAtMs < minGapMs || now < gate.deniedUntilMs) {
      let cachedResult = null;
      if (ref) {
        try {
          const snap = await ref.get();
          const data = (snap.exists && snap.data()) || {};
          if (data.lastContentKey === content && data.lastResult != null) {
            cachedResult = data.lastResult;
            _claimLocalContentKey(key, content);
          }
        } catch (_) {}
      }
      return { run: false, cachedResult };
    }
  }

  if (!ref) { _claimLocalContentKey(key, content); _claimLocalGate(key, now); return { run: true, cachedResult: null }; }
  try {
    const outcome = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const data = (snap.exists && snap.data()) || {};
      // Already scanned this exact content on some device — never scan it again,
      // however long ago that was. This is the whole point of the ticket. Hand back
      // whatever that run produced so this surface shows the same answer.
      if (data.lastContentKey === content) {
        return { run: false, cachedResult: data.lastResult ?? null };
      }
      const lastRunAtMs = Number(data.lastRunAtMs) || 0;
      if (minGapMs > 0 && now - lastRunAtMs < minGapMs) return { run: false, cachedResult: null };
      // Clear lastResult with the claim: it belongs to the PREVIOUS content key,
      // and leaving it meant a surface losing the race mid-call could adopt a
      // stale answer as if it were computed for the new content.
      tx.set(ref, { lastRunAtMs: now, lastContentKey: content, lastResult: null }, { merge: true });
      return { run: true, cachedResult: null };
    });
    if (outcome.run) { _claimLocalContentKey(key, content); _claimLocalGate(key, now); }
    else {
      _denyLocalGate(key, now, minGapMs);
      // Record the content locally when we adopted someone else's result, so this
      // surface stops re-attempting the same state on every recheck tick.
      if (outcome.cachedResult != null) _claimLocalContentKey(key, content);
    }
    return outcome;
  } catch (e) {
    // Same fail-semi-open posture as shouldRunAndClaim: the local content gate above
    // already passed, so grant this one run and record it locally. A dead Firestore
    // costs at most one call per content change per device, never a storm.
    console.warn('[ai-call-throttle] content claim failed; local gate holds:', e.message);
    _claimLocalContentKey(key, content);
    _claimLocalGate(key, now);
    return { run: true, cachedResult: null };
  }
}

// Publish the result of a won claim so other surfaces looking at the same content can
// adopt it instead of spending a second AI call. Best-effort: a failure here only costs
// a redundant call on another device, never correctness.
export async function publishContentResult(key, contentKey, result) {
  const content = String(contentKey || '');
  const ref = throttleRef(key);
  if (!content || !ref || result == null) return;
  try {
    await ref.set({ lastContentKey: content, lastResult: result, lastResultAtMs: Date.now() }, { merge: true });
  } catch (e) {
    console.warn('[ai-call-throttle] result publish failed (non-fatal):', e.message);
  }
}

// Undo a won content claim whose AI call FAILED (no result to publish). Without
// this, the content stays marked as scanned forever and every surface skips it
// until the underlying data changes — for slow-moving content (an inbox) that
// can mean hours with no summaries after one transient gateway error. Only
// releases while no result has been published for this content, so it can never
// wipe a successful run's answer.
export async function releaseContentClaim(key, contentKey) {
  const content = String(contentKey || '');
  if (!content) return;
  if (_readLocalContentKey(key) === content) {
    _localContentGate.delete(key);
    try { localStorage.removeItem(_contentStorageKey(key)); } catch (_) {}
  }
  const ref = throttleRef(key);
  if (!ref) return;
  try {
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const data = (snap.exists && snap.data()) || {};
      if (data.lastContentKey === content && data.lastResult == null) {
        tx.set(ref, { lastContentKey: null }, { merge: true });
      }
    });
  } catch (e) {
    console.warn('[ai-call-throttle] claim release failed (non-fatal):', e.message);
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
