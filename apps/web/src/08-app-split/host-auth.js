// One-stop auth + discovery for the local phone hosts (Windows DeskPhone PC,
// Android tablet host, iPad bridge).
//
// ── Auth ─────────────────────────────────────────────────────────────────────
// The hosts gate their :8765 API behind a host token once an owner account has
// paired. Pairing is invisible to the user: we send the signed-in Firebase ID
// token (the same Google sign-in that powers email/calendar) to POST /pair,
// the host verifies it against Google's public certs, and returns a long-lived
// host token we store per host and attach as X-Host-Token thereafter.
//
// ── Host descriptors ─────────────────────────────────────────────────────────
// Everything here works on a host DESCRIPTOR, not a bare URL:
//   { base: "http://127.0.0.1:8765" }                          — direct
//   { base: "http://127.0.0.1:8765", forward: "http://192.168.1.7:8765" }
// The second form rides the DeskPhone loopback proxy: an HTTPS page cannot
// fetch http://192.168.x.x directly (mixed-content blocking — loopback is the
// only exemption), so we ask the PC host to forward the request over the LAN
// via the X-Forward-Host header. Tokens are stored per EFFECTIVE host
// (forward || base) so the tablet's token never leaks to the PC's slot.
//
// hostFetch() is the drop-in fetch: attaches the token, and on a 401 pairs
// once and retries — so first contact with a locked host self-heals.
//
// ── Discovery registry (Firestore) ───────────────────────────────────────────
// Browsers can't browse mDNS, so hosts are discovered socially: whichever web
// surface reaches a host directly (e.g. the tablet's own browser on loopback)
// publishes that host's LAN URL + connection state to
// users/{uid}/appData/phoneHosts. Every other signed-in surface reads that doc
// and probes the listed hosts — that's how the PC learns the tablet now holds
// the phone's Bluetooth link.

import firebase from 'firebase/compat/app';

export const hostKey = host => host.forward || host.base;
const tokenKey = host => `shamashHostToken:${hostKey(host)}`;

export function hostAuthHeaders(host) {
  const h = {};
  if (host.forward) h["X-Forward-Host"] = host.forward;
  try {
    const t = localStorage.getItem(tokenKey(host));
    if (t) h["X-Host-Token"] = t;
  } catch {}
  return h;
}

export async function pairWithHost(host) {
  try {
    const user = firebase.auth?.().currentUser;
    if (!user) return false;
    const idToken = await user.getIdToken();
    const headers = { Authorization: `Bearer ${idToken}` };
    if (host.forward) headers["X-Forward-Host"] = host.forward;
    const res = await fetch(`${host.base}/pair`, { method: "POST", cache: "no-store", headers });
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({}));
    if (!data?.hostToken) return false;
    try { localStorage.setItem(tokenKey(host), data.hostToken); } catch {}
    return true;
  } catch { return false; }
}

export async function hostFetch(host, path, opts = {}) {
  const run = () => fetch(`${host.base}${path}`, {
    ...opts,
    headers: { ...(opts.headers || {}), ...hostAuthHeaders(host) },
  });
  let res = await run();
  if (res.status === 401 && await pairWithHost(host)) res = await run();
  return res;
}

// ── Firestore host registry ──────────────────────────────────────────────────

const hostsDocRef = (db, uid) =>
  db.collection("users").doc(uid).collection("appData").doc("phoneHosts");

const urlSlot = url => url.replace(/[^a-zA-Z0-9]/g, "_");

/** Hosts seen in the last `maxAgeMs`, freshest first. */
export async function loadKnownHosts(db, uid, maxAgeMs = 10 * 60 * 1000) {
  try {
    if (!db || !uid) return [];
    const snap = await hostsDocRef(db, uid).get();
    const hosts = snap.data()?.hosts || {};
    const now = Date.now();
    return Object.values(hosts)
      .filter(h => h?.url && now - (h.updatedAt || 0) < maxAgeMs)
      .sort((a, b) => (b.connected === true) - (a.connected === true) || (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch { return []; }
}

/** Fire-and-forget: record that a host at `url` was just seen (and whether its
 *  Bluetooth phone link is live). Called by whichever surface reaches it. */
export function publishKnownHost(db, uid, { url, connected, platform = "", name = "" }) {
  try {
    if (!db || !uid || !url) return;
    hostsDocRef(db, uid).set({
      hosts: { [urlSlot(url)]: { url, connected: !!connected, platform, name, updatedAt: Date.now() } },
    }, { merge: true }).catch(() => {});
  } catch {}
}
