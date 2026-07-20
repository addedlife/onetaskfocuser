// ── Pending-SMS echo store ──────────────────────────────────────────────────
// One shared in-memory list of optimistic outgoing texts, used by EVERY SMS
// composer (NerveCenter phone surface, DeskPhone web page, new-message tab).
//
// Why it exists (owner tickets, 7/9): a send used to freeze the compose box
// for up to 25 s while the relay round-tripped, then "jump" the text into the
// thread — and a send whose confirmation never reconciled showed up TWICE
// (one bubble "Sent", one stuck "Confirming on phone").
//
// The contract:
//   1. The moment the user hits send, the composer calls addPendingSms() and
//      clears itself — the echo renders in the thread instantly as "Sending…".
//   2. The actual command runs in the background; failure flips the echo to
//      "Failed" (with Retry), success to a plain sent bubble.
//   3. As soon as the phone host reports its own copy of the message (its
//      local bubble or the phone's sent-folder copy), the echo is dropped —
//      matchPendingSms/reconcilePendingSms do that matching — so the echo can
//      never linger as a duplicate next to the host's bubble.
//
// Module-level state (not React state) so the NerveCenter card, the expanded
// phone view, and the DeskPhone page all show the same in-flight sends.

const PENDING_SMS_EVENT = 'shamash-pending-sms:change';

// A host copy "matches" an echo when recipient + body agree and the host copy
// isn't from long before the echo (10 min tolerance absorbs phone/PC clock
// skew — the same skew that broke the hosts' own 90 s reconcile windows).
const MATCH_SKEW_MS = 10 * 60 * 1000;

// Echoes that confirmed ("sent") but whose host copy never appeared age out
// of the list after an hour — by then the thread history tells the story.
const SENT_ECHO_TTL_MS = 60 * 60 * 1000;

let echoes = [];
let nextId = 1;

function emit() {
  try { window.dispatchEvent(new CustomEvent(PENDING_SMS_EVENT)); } catch (_) {}
}

// Canonical 10-digit key for matching phone numbers, mirroring the hosts'
// NormalizePhone (strip country code, digits only).
export function smsPhoneKey(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return String(value || '').trim().toLowerCase();
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

// Whitespace/line-ending-insensitive body key. The Windows host converts
// outgoing bodies to \r\n and phones echo back \n — exact compares miss.
export function smsBodyKey(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim()
    .toLowerCase();
}

export function getPendingSms() {
  return echoes;
}

export function subscribePendingSms(onChange) {
  const handler = () => onChange(echoes);
  window.addEventListener(PENDING_SMS_EVENT, handler);
  return () => window.removeEventListener(PENDING_SMS_EVENT, handler);
}

export function addPendingSms({ to, body, attachments = [] }) {
  const echo = {
    id: `psms-${Date.now()}-${nextId++}`,
    to: String(to || '').trim(),
    key: smsPhoneKey(to),
    bodyKey: smsBodyKey(body),
    body: String(body || '').trim(),
    // Attachment META only (name/type) for the echo bubble — no file bytes.
    attachments: attachments.map(a => ({ fileName: a.fileName || '', contentType: a.contentType || '' })),
    at: Date.now(),
    status: 'sending',   // 'sending' | 'sent' | 'failed'
    error: '',
  };
  echoes = [...echoes, echo];
  emit();
  return echo;
}

export function updatePendingSms(id, patch) {
  let changed = false;
  echoes = echoes.map(e => {
    if (e.id !== id) return e;
    changed = true;
    const next = { ...e, ...patch };
    if (patch.body !== undefined) next.bodyKey = smsBodyKey(patch.body);
    if (patch.to !== undefined) next.key = smsPhoneKey(patch.to);
    return next;
  });
  if (changed) emit();
}

export function removePendingSms(id) {
  const before = echoes.length;
  echoes = echoes.filter(e => e.id !== id);
  if (echoes.length !== before) emit();
}

// Does this host-reported outgoing message account for the given echo?
// `outgoing` items: { cid?, key, bodyKey, timeMs } built by the caller from
// whatever raw shape its host feed uses.
//
// Exact match first: the composer's echo id rides the /send command as `cid`,
// hosts ≥ b329/tablet-b5 stamp it as the message's own id, so the blob copy
// carries the echo's id back verbatim — deterministic, industry-standard
// client-message-id reconciliation. The fuzzy recipient+body+time match stays
// only as the fallback for hosts that predate the cid plumbing.
function echoMatches(echo, outgoing) {
  return outgoing.some(m =>
    (m.cid && m.cid === echo.id) ||
    (m.key === echo.key &&
      m.bodyKey === echo.bodyKey &&
      (!m.timeMs || m.timeMs >= echo.at - MATCH_SKEW_MS)));
}

// Synchronous filter for render time: which echoes are NOT yet covered by a
// host copy. Used by the thread builders so an echo and its host copy never
// paint together, even for the one frame before reconcilePendingSms prunes.
export function unmatchedPendingSms(list, outgoing) {
  return list.filter(e => !echoMatches(e, outgoing));
}

// Prune the store: drop echoes the host now reports, and expire stale
// confirmed ones. Call whenever a fresh host message list lands.
export function reconcilePendingSms(outgoing) {
  const now = Date.now();
  const next = echoes.filter(e => {
    if (echoMatches(e, outgoing)) return false;
    if (e.status === 'sent' && now - e.at > SENT_ECHO_TTL_MS) return false;
    return true;
  });
  if (next.length !== echoes.length) {
    echoes = next;
    emit();
  }
}

// ── Host-double collapse ────────────────────────────────────────────────────
// The hosts sometimes fail to reconcile their own local "Confirming" bubble
// with the phone's sent-folder copy (clock skew beats their 90 s window) and
// the blob then carries BOTH forever. Visually collapse that: inside one
// conversation, an outgoing message still marked Sending/Confirming/Queued is
// dropped when a CONFIRMED outgoing copy with the same body exists within the
// skew window. Confirmed copies always win; nothing confirmed is ever hidden.
//
// Second collapse layer (owner data 7/19: EVERY send showed doubled): a host
// copy whose id is the composer's own echo id ("psms-…" — the cid the /send
// command carried) is the host's provisional record of the send, not the
// phone's truth. The phone's sent-folder copy arrives later under a real MAP
// handle and the host never reconciles the two, so the blob carries both
// forever. When a confirmed REAL-id copy of the same text exists in the skew
// window, the provisional copy is dropped — the phone's own record wins, and a
// genuine double-send (two real handles) still shows as two.
//
// `items` is any list; the accessors adapt it:
//   groupKey(item)  — conversation key (peer number)
//   bodyKey(item)   — smsBodyKey of the text
//   timeMs(item)    — message timestamp ms (0 = unknown)
//   isOutgoing(item), isPending(item)
function isProvisionalHostId(id) {
  return /^psms-/.test(String(id || ''));
}

export function collapseHostDoubles(items, { groupKey, bodyKey, timeMs, isOutgoing, isPending }) {
  const idOf = item => item?.id ?? item?.Id ?? '';
  const confirmedAll = new Map();  // `${group}|${body}` → [timeMs] — any confirmed copy
  const confirmedReal = new Map(); // same, but real (non-provisional) ids only
  items.forEach(item => {
    if (!isOutgoing(item) || isPending(item)) return;
    const k = `${groupKey(item)}|${bodyKey(item)}`;
    const t = timeMs(item) || 0;
    const all = confirmedAll.get(k) || [];
    all.push(t);
    confirmedAll.set(k, all);
    if (!isProvisionalHostId(idOf(item))) {
      const real = confirmedReal.get(k) || [];
      real.push(t);
      confirmedReal.set(k, real);
    }
  });
  if (confirmedAll.size === 0) return items;
  const covered = (map, item) => {
    const times = map.get(`${groupKey(item)}|${bodyKey(item)}`);
    if (!times) return false;
    const t = timeMs(item) || 0;
    return times.some(ct => !t || !ct || Math.abs(ct - t) <= MATCH_SKEW_MS);
  };
  return items.filter(item => {
    if (!isOutgoing(item)) return true;
    if (isPending(item)) return !covered(confirmedAll, item);
    if (isProvisionalHostId(idOf(item))) return !covered(confirmedReal, item);
    return true;
  });
}
