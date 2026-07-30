// ── Relay messaging for surfaces that are not the phone panel ────────────────
//
// NerveCenterPhoneSurface owns the full relay client: adaptive polling, command
// acknowledgement by id, pending-SMS reconciliation against the phone's own
// message list. None of that belongs in a modal that sends one text and closes,
// and copying it there would be a second thing to keep in sync with the host.
//
// This is the thin slice such a surface actually needs — read the contact list,
// send one message — expressed against the same cloud relay and the same auth,
// so there is no second transport and no loopback path. Everything here is
// read-only or fire-and-forget; the phone surface remains the place that tracks
// delivery, and a message sent from here shows up there like any other.
import { db, uid } from '../../01-core.js';
import { detectSurfaceId, startProcessRun, logProcessStep, finishProcessRun } from '../process-log.js';

const RELAY_BASE = '/api/phone-relay';

// The relay state blob the active host pushes. Contacts ride along with it, so
// there is nothing extra to fetch and no extra read cost — this is the same doc
// the phone surface subscribes to.
export async function fetchRelayContacts() {
  if (!db) return [];
  try {
    const snap = await db.collection('phone-relay').doc('state').get();
    const raw = snap.exists ? snap.data() : null;
    const list = Array.isArray(raw?.contacts) ? raw.contacts : (raw?.contacts?.contacts || []);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// Contact records arrive from several host generations with different field
// names, so read every spelling rather than assuming one.
export function contactDisplayName(c) {
  return String(c?.displayName || c?.name || c?.DisplayName || c?.Name || '').trim();
}

export function contactNumber(c) {
  return String(c?.number || c?.phoneNumber || c?.Number || c?.PhoneNumber || c?.phone || '').trim();
}

function nameWords(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
}

function isSubsequenceOfWords(needle, haystack) {
  if (!needle.length) return false;
  return needle.every(w => haystack.includes(w));
}

// Resolve a spoken name ("Rabbi Cohen", "Mrs. Lerman") to a contact.
//
// Deliberately conservative, because this feeds a SEND: a wrong match texts the
// wrong person, and that cannot be taken back. Matching is on WHOLE WORDS, and
// an ambiguous query resolves to null so the review row asks instead of picking.
//
// Substring matching is specifically wrong here and was the first thing this got
// wrong: with "Rabbi Cohen" and "Cohen Bakery" both in the book, plain
// `startsWith` matched only the bakery — the one contact the speaker was least
// likely to mean — and did it silently. Word containment sees both and refuses.
export function resolveContactByName(contacts, spokenName) {
  const qWords = nameWords(spokenName);
  if (!qWords.length || !Array.isArray(contacts) || !contacts.length) return null;
  const q = qWords.join(' ');

  const withNames = contacts
    .map(c => ({ contact: c, words: nameWords(contactDisplayName(c)), number: contactNumber(c) }))
    .filter(c => c.words.length && c.number);

  const exact = withNames.filter(c => c.words.join(' ') === q);
  if (exact.length) return exact.length === 1 ? exact[0].contact : null;

  // Every spoken word appears in the contact's name ("cohen" → "rabbi cohen"),
  // or every word of the contact's name appears in what was spoken ("cohen" the
  // contact, spoken as "rabbi cohen"). Unique hit only.
  const candidates = withNames.filter(c =>
    isSubsequenceOfWords(qWords, c.words) || isSubsequenceOfWords(c.words, qWords));
  return candidates.length === 1 ? candidates[0].contact : null;
}

// Queue one outbound SMS through the cloud relay.
//
// Same endpoint, same `cid` echo id and same auth as the phone surface's own
// composer, so the host dedupes it identically and the sent message reconciles
// against the phone's list instead of appearing twice. Resolves when the relay
// has QUEUED the command; delivery is the phone surface's story to tell.
// Every attempt is recorded in this surface's process log (owner ticket 7/29),
// including the fact that this caller only waits for the QUEUE and not for the
// host's acknowledgement — which is exactly the kind of thing that made a send
// look successful when nothing left the mailbox.
export async function sendRelaySms(user, to, body) {
  const number = String(to || '').trim();
  const text = String(body || '').trim();
  if (!number) throw new Error('No phone number for that contact.');
  if (!text) throw new Error('Nothing to send.');

  const runId = startProcessRun({
    surfaceId: detectSurfaceId(),
    kind: 'send',
    label: `Text to ${number}`,
    detail: `${text.length} character${text.length === 1 ? '' : 's'} · queued from a non-phone surface`,
    transport: 'cloud relay (queue only — delivery is reported on the phone surface)',
  });
  const step = (stage, status = 'info', note = '') => logProcessStep(runId, { stage, status, note });

  let idToken = null;
  try { idToken = user?.getIdToken ? await user.getIdToken() : null; } catch { idToken = null; }
  if (!idToken) {
    step('no signed-in token available', 'fail');
    finishProcessRun(runId, { ok: false, error: 'Sign in again to send messages.' });
    throw new Error('Sign in again to send messages.');
  }
  step('signed-in token attached', 'ok');

  const cid = `psms-${uid()}`;
  const path = `/send?to=${encodeURIComponent(number)}&body=${encodeURIComponent(text)}&cid=${encodeURIComponent(cid)}`;
  step('POST /api/phone-relay?action=command');
  let res;
  try {
    res = await fetch(`${RELAY_BASE}?action=command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ path }),
    });
  } catch (e) {
    step('the request itself threw', 'fail', String(e?.message || e || ''));
    finishProcessRun(runId, { ok: false, error: 'Could not reach the phone relay.' });
    throw new Error('Could not reach the phone relay.');
  }
  if (!res.ok) {
    let msg = `The phone relay rejected the message (${res.status}).`;
    try { const d = await res.json(); if (d?.error) msg = d.error; } catch {}
    step(`relay refused the command — HTTP ${res.status}`, 'fail', msg);
    finishProcessRun(runId, { ok: false, error: msg });
    throw new Error(msg);
  }
  const queued = await res.json().catch(() => ({}));
  step('queued in the cloud mailbox', 'ok', queued?.id ? `command id ${queued.id}` : 'no command id returned');
  step('not waiting for the host acknowledgement here', 'warn',
    'this surface reports QUEUED only; the phone surface tracks whether the host actually sent it');
  finishProcessRun(runId, { ok: true });
  return { cid };
}
