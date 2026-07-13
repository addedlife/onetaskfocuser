// ── Phone-link shared brain ─────────────────────────────────────────────────
// The ONE home for the truths every phone surface renders. Before this module,
// the NerveCenter phone card and the DeskPhone web page each derived their own
// liveness (with different windows — 60 s vs 45 s), their own status wording,
// and their own change detection; the same link could read "Connected" on one
// screen and "offline" on the other at the same moment. Everything here is
// pure functions over plain data, so it is unit-testable (tests/phone-link
// suite) and shared verbatim by both surfaces.
//
// Exports:
//   HEARTBEAT_LIVE_WINDOW_MS / STATE_FALLBACK_WINDOW_MS — the only freshness
//     constants; no surface may define its own.
//   messageListSignature() — change detection that sees STATUS flips (the old
//     length+endpoints signatures missed a mid-list Confirming→Sent change, so
//     the UI kept showing a stale send status until an unrelated text arrived).
//   derivePhoneLinkState() — the single status state machine.
//   describePhoneLink() — the single source of on-screen status wording.
//   formatAgeShort() — "27s" / "4m" / "2h" age labels.

// This module is intentionally PURE — no imports, no Firebase, no window — so
// the node test suite (apps/web/tests) exercises it exactly as production
// runs it. phone-host-control.js re-exports these constants for its callers.
export const HOST_LABEL = { android: 'Tablet', windows: 'PC' };
export const PREFERRED_DEFAULT = 'tablet';

// The active host renews the owner-doc heartbeat every ~20 s; 60 s tolerates
// two missed beats before the UI says offline (standard 3× presence margin).
export const HEARTBEAT_LIVE_WINDOW_MS = 60000;

// Fallback ONLY for hosts that predate the owner heartbeat doc: they refresh
// the state doc on change or every 5 min, so a tight window would read a
// healthy-but-quiet link as flapping. Remove once both hosts run ≥ b329.
export const STATE_FALLBACK_WINDOW_MS = 360000;

// After the owner flips the preferred host, the releasing host drops its
// heartbeat BEFORE the taking host confirms — a gap that used to read as
// "Offline / lost connection" mid-handoff. Within this window after a flip,
// a dead link whose owner doc still names the old (or no) host is reported as
// a patient "handover" state instead. Past the window, honesty resumes:
// the taking host really didn't show up, so Offline + Reconnect is correct.
export const HANDOFF_GRACE_MS = 150000;

// Compact "27s" / "4m" / "2h" / "3d" age label.
export function formatAgeShort(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

// Change-detection signature for a host message list. Hashes id + send status
// + read state of EVERY entry, so a status flip anywhere in the list produces
// a new signature and repaints. Cheap: one pass, integer hash (5000 messages
// ≈ a fraction of a millisecond, once per poll).
export function messageListSignature(list) {
  const arr = Array.isArray(list) ? list : [];
  let hash = 0;
  for (let i = 0; i < arr.length; i++) {
    const m = arr[i] || {};
    const piece = `${m.id ?? m.handle ?? i}|${m.sendStatus ?? m.SendStatus ?? ""}|${m.isRead ?? m.IsRead ?? m.read ?? m.unread ?? ""}`;
    for (let j = 0; j < piece.length; j++) hash = (hash * 31 + piece.charCodeAt(j)) | 0;
  }
  return `${arr.length}|${hash}`;
}

// ── The status state machine ────────────────────────────────────────────────
// Inputs are plain values; output is one enum + the numbers the UI needs.
//
//   usingRelay      — false when a phone host answers on THIS device's loopback
//   statusOnline    — a state payload exists (data was ever fetched this session)
//   hasData         — messages or calls are on screen (for wording only)
//   owner           — normalized phone-relay/owner doc (phone-host-control.js)
//   relayReceivedAt — state-doc stamp; legacy liveness before owner doc exists
//
// States:
//   connected  — live heartbeat, host holds the phone
//   switching  — live, but the owner asked the OTHER host to take the phone
//   offline    — was live, heartbeat went stale (show data age)
//   connecting — signs of life exist but no live link right now
//   no-host    — nothing has ever fed this account's relay
export function derivePhoneLinkState({
  now = Date.now(),
  usingRelay = true,
  statusOnline = false,
  hasData = false,
  owner = { preferred: PREFERRED_DEFAULT, host: '', t: 0, connected: false, present: false, preferredAtMs: 0 },
  relayReceivedAt = 0,
} = {}) {
  const heartbeatMs = owner.present ? owner.t : (Number(relayReceivedAt) || 0);
  const liveWindowMs = owner.present ? HEARTBEAT_LIVE_WINDOW_MS : STATE_FALLBACK_WINDOW_MS;
  const ownerSaysConnected = owner.present ? owner.connected : true;
  const ageMs = heartbeatMs > 0 ? Math.max(0, now - heartbeatMs) : 0;
  const stale = usingRelay && heartbeatMs > 0 && (ageMs >= liveWindowMs || !ownerSaysConnected);
  // On the loopback path liveness is simply "the fetch just worked".
  const live = usingRelay ? (statusOnline && heartbeatMs > 0 && !stale) : statusOnline;

  const preferredId = owner.preferred === 'pc' ? 'windows' : 'android';
  const activeHostId = (owner.present && owner.host) ? owner.host : '';
  const switching = live && !!activeHostId && activeHostId !== preferredId;

  // Mid-handoff gap: the preferred host was flipped moments ago, the link is
  // not live, and the owner doc does not yet show the NEW host holding the
  // phone. That is a handover in progress, not a lost connection. Once the
  // doc names the preferred host (even dead), or the grace window lapses,
  // normal offline reporting takes over.
  const preferredAtMs = Number(owner.preferredAtMs) || 0;
  const handover = !live && usingRelay
    && preferredAtMs > 0 && (now - preferredAtMs) < HANDOFF_GRACE_MS
    && activeHostId !== preferredId;

  const state = live
    ? (switching ? 'switching' : 'connected')
    : handover
      ? 'handover'
      : stale
        ? 'offline'
        : (heartbeatMs > 0 || statusOnline || hasData)
          ? 'connecting'
          : 'no-host';

  return {
    state,
    live,
    stale,
    switching,
    handover,
    heartbeatMs,
    ageMs,
    hasData,
    activeHostId,
    activeHostLabel: HOST_LABEL[activeHostId] || '',
    preferredId,
    preferredLabel: HOST_LABEL[preferredId] || 'Tablet',
  };
}

// One wording source for the always-visible status line. `deviceName` is the
// phone's friendly name (never a MAC — callers filter that before passing).
export function describePhoneLink(link, { deviceName = '', hostFallbackLabel = '' } = {}) {
  const hostLabel = link.activeHostLabel || hostFallbackLabel;
  switch (link.state) {
    case 'switching':
      return {
        label: `Connected · ${hostLabel} — handing to ${link.preferredLabel}…`,
        tone: 'ok',
        showReconnect: false,
      };
    case 'connected':
      return {
        label: `Connected${hostLabel ? ` · ${hostLabel}` : ''}${deviceName ? ` · ${deviceName}` : ''}`,
        tone: 'ok',
        showReconnect: false,
      };
    case 'handover':
      return {
        label: `Handing to ${link.preferredLabel} — waiting for it to confirm…`,
        tone: 'muted',
        showReconnect: false,
      };
    case 'offline':
      return {
        label: link.hasData
          ? `Offline — showing texts & calls from ${formatAgeShort(link.ageMs)} ago`
          : `Offline — last seen ${formatAgeShort(link.ageMs)} ago`,
        tone: 'warn',
        showReconnect: true,
      };
    case 'connecting':
      return { label: 'Connecting…', tone: 'muted', showReconnect: false };
    default: // no-host
      return {
        label: 'No phone link — start Shamash Phone Link on the tablet (or DeskPhone on the PC)',
        tone: 'muted',
        showReconnect: true,
      };
  }
}

// ── Feed retention across host switches ─────────────────────────────────────
// A freshly connected (or freshly handed-to) host pushes a state blob whose
// message/call store starts near-empty and refills over minutes as it re-syncs
// from the phone. Surfaces that render the blob verbatim therefore WIPE the
// visible history on every handoff and slowly restore it — the owner's ticket.
// These merges union the incoming list with what was already on screen: the
// incoming copy always wins per message (so send-status/read flips repaint),
// and previously seen entries the new host hasn't re-synced yet stay visible.
// Session-scoped only — nothing here persists.

const FEED_RETENTION_CAP = 2000;         // hard bound on retained entries
const MSG_FUZZY_WINDOW_MS = 120000;      // same text within 2 min = same SMS
const CALL_FUZZY_WINDOW_MS = 90000;      // same number within 90 s = same call

function digitsKey(value) {
  const d = String(value ?? '').replace(/\D+/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}
function feedTimeMs(entry) {
  const raw = entry?.timestamp ?? entry?.Timestamp ?? entry?.date ?? entry?.Date
    ?? entry?.time ?? entry?.Time ?? entry?.startTime ?? entry?.StartTime;
  if (typeof raw === 'number') return raw > 1e12 ? raw : raw * 1000;
  const parsed = Date.parse(raw ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}
function messageIdKey(m) {
  const id = m?.id ?? m?.Id ?? m?.handle ?? m?.Handle ?? m?.localId ?? m?.LocalId;
  return id === undefined || id === null || id === '' ? '' : String(id);
}
function messageBodyKey(m) {
  return String(m?.body ?? m?.Body ?? m?.text ?? m?.Text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}
function messagePeerKey(m) {
  return digitsKey(m?.address ?? m?.Address ?? m?.number ?? m?.Number ?? m?.from ?? m?.From ?? m?.to ?? m?.To ?? m?.peer ?? '');
}

// Union-merge message lists: `next` (the incoming host truth) verbatim, plus
// any `prev` entry the incoming list doesn't contain — matched first by id,
// then fuzzily (same body + same peer-or-unknown + close timestamp) so the
// SAME SMS seen under two hosts' different id schemes never doubles up.
export function mergeMessageFeeds(prev, next) {
  const nextArr = Array.isArray(next) ? next : [];
  const prevArr = Array.isArray(prev) ? prev : [];
  if (!prevArr.length) return nextArr;
  const ids = new Set();
  const fuzzy = [];   // { body, peer, at }
  for (const m of nextArr) {
    const id = messageIdKey(m);
    if (id) ids.add(id);
    fuzzy.push({ body: messageBodyKey(m), peer: messagePeerKey(m), at: feedTimeMs(m) });
  }
  const retained = prevArr.filter(m => {
    const id = messageIdKey(m);
    if (id && ids.has(id)) return false;
    const body = messageBodyKey(m);
    const peer = messagePeerKey(m);
    const at = feedTimeMs(m);
    // Fuzzy layer only applies to messages WITH text — two attachment-only
    // entries with empty bodies must never collapse into each other.
    return !body || !fuzzy.some(f => f.body === body && (!f.peer || !peer || f.peer === peer)
      && Math.abs(f.at - at) < MSG_FUZZY_WINDOW_MS);
  });
  if (!retained.length) return nextArr;
  const merged = nextArr.concat(retained);
  if (merged.length <= FEED_RETENTION_CAP) return merged;
  // Over cap: drop the oldest RETAINED entries first — the host's own list is truth.
  retained.sort((a, b) => feedTimeMs(b) - feedTimeMs(a));
  return nextArr.concat(retained.slice(0, Math.max(0, FEED_RETENTION_CAP - nextArr.length)));
}

function callIdKey(c) {
  const id = c?.id ?? c?.Id;
  return id === undefined || id === null || id === '' ? '' : String(id);
}

// Union-merge call lists — same contract as mergeMessageFeeds.
export function mergeCallFeeds(prev, next) {
  const nextArr = Array.isArray(next) ? next : [];
  const prevArr = Array.isArray(prev) ? prev : [];
  if (!prevArr.length) return nextArr;
  const ids = new Set();
  const fuzzy = [];
  for (const c of nextArr) {
    const id = callIdKey(c);
    if (id) ids.add(id);
    fuzzy.push({ num: digitsKey(c?.number ?? c?.Number ?? c?.address ?? c?.Address ?? ''), at: feedTimeMs(c) });
  }
  const retained = prevArr.filter(c => {
    const id = callIdKey(c);
    if (id && ids.has(id)) return false;
    const num = digitsKey(c?.number ?? c?.Number ?? c?.address ?? c?.Address ?? '');
    const at = feedTimeMs(c);
    return !fuzzy.some(f => f.num === num && Math.abs(f.at - at) < CALL_FUZZY_WINDOW_MS);
  });
  if (!retained.length) return nextArr;
  const merged = nextArr.concat(retained);
  if (merged.length <= FEED_RETENTION_CAP) return merged;
  retained.sort((a, b) => feedTimeMs(b) - feedTimeMs(a));
  return nextArr.concat(retained.slice(0, Math.max(0, FEED_RETENTION_CAP - nextArr.length)));
}
