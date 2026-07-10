// ── Phone-host control plane ────────────────────────────────────────────────
// One tiny shared Firestore doc — phone-relay/owner — is the whole arbitration
// story between the two phone hosts (the Android tablet and the Windows PC /
// DeskPhone). It answers two questions, and nothing more:
//
//   preferred : which host the OWNER wants to hold the phone right now
//               ("tablet" by default; the menu-rail toggle flips it to "pc").
//   host + t  : which host is ACTUALLY holding it, and when it last checked in
//               (the active host renews `t` every ~20 s — this is the heartbeat
//               that drives the web "Live/Offline" indicator).
//
// Arbitration rule the native hosts follow (see RelayService.cs / RelayClient.kt):
//   a host holds the phone's Bluetooth ONLY if it is the preferred host, OR the
//   preferred host has gone silent (stale `t`). So the two never fight over the
//   phone — that tug-of-war was the connect/disconnect/forget/remove swamp.
//
// This module is the web side: it reads the doc (for the status indicator and the
// toggle's current state) and writes `preferred` (the toggle). Writes use a
// field-level merge so they never clobber the host-written `host`/`t` fields.
//
// Graceful rollout: until the rebuilt hosts start writing this doc, `host`/`t`
// are simply absent — callers fall back to the state doc's own `relayReceivedAt`.
import { db } from '../01-core.js';

export const OWNER_DOC_PATH = { collection: 'phone-relay', doc: 'owner' };

// Canonical constants (heartbeat window, host labels) live in phone-link.js —
// the pure, testable module; re-exported here so existing callers keep one
// import site. OWNER_LIVE_WINDOW_MS is the same value as the machine's
// HEARTBEAT_LIVE_WINDOW_MS, aliased for older call sites.
export { HOST_LABEL, PREFERRED_DEFAULT, HEARTBEAT_LIVE_WINDOW_MS as OWNER_LIVE_WINDOW_MS } from './phone-link.js';
import { PREFERRED_DEFAULT } from './phone-link.js';

function ownerRef() {
  return db ? db.collection(OWNER_DOC_PATH.collection).doc(OWNER_DOC_PATH.doc) : null;
}

// Normalize a raw owner-doc snapshot into a stable shape. Missing fields (pre
// native-rebuild, or before any host has ever connected) come back as neutral
// defaults so callers never have to null-check.
export function normalizeOwner(data) {
  const d = data || {};
  const preferred = d.preferred === 'pc' ? 'pc' : PREFERRED_DEFAULT;
  const host = typeof d.host === 'string' ? d.host : '';
  const t = Number(d.t) || 0;
  const connected = d.connected === true;
  return { preferred, host, t, connected, present: t > 0 };
}

// Live subscription to the owner doc. Calls back with the normalized shape on
// every change; returns an unsubscribe function (or a no-op if Firestore isn't
// ready yet). Ignores cache-only emissions, exactly like the state listener, so
// a stale local copy can't briefly claim the wrong host is live.
export function subscribeOwner(onUpdate) {
  const ref = ownerRef();
  if (!ref) return () => {};
  return ref.onSnapshot(
    snap => {
      if (snap.metadata && snap.metadata.fromCache) return;
      onUpdate(normalizeOwner(snap.exists ? snap.data() : null));
    },
    err => { console.warn('[phone-host-control] owner listener error:', err); },
  );
}

// Flip the owner's preferred host. Field-level merge — leaves `host`/`t`/`connected`
// (written by the active host) untouched. `atMs` is stamped so a host can tell how
// recently the intent changed if it ever needs to.
export function setPreferredHost(preferred) {
  const ref = ownerRef();
  if (!ref) return Promise.resolve(false);
  const value = preferred === 'pc' ? 'pc' : 'tablet';
  return ref
    .set({ preferred: value, preferredAtMs: Date.now() }, { merge: true })
    .then(() => true)
    .catch(err => { console.warn('[phone-host-control] setPreferredHost failed:', err); return false; });
}

// Is the active host's heartbeat fresh right now? `nowMs` is passed in so a UI
// that ticks a clock re-evaluates staleness without a new snapshot.
export function ownerIsLive(owner, nowMs = Date.now()) {
  return !!owner && owner.present && owner.connected && (nowMs - owner.t) < OWNER_LIVE_WINDOW_MS;
}
