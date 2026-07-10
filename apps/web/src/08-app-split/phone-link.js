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
  owner = { preferred: PREFERRED_DEFAULT, host: '', t: 0, connected: false, present: false },
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

  const state = live
    ? (switching ? 'switching' : 'connected')
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
