// One-stop auth for the local phone hosts (Windows DeskPhone + Android tablet).
//
// The hosts gate their :8765 API behind a host token once an owner account has
// paired. Pairing is invisible to the user: we send the signed-in Firebase ID
// token (the same Google sign-in that powers email/calendar) to POST /pair,
// the host verifies it against Google's public certs, and returns a long-lived
// host token we store per host base URL and attach as X-Host-Token thereafter.
//
// hostFetch() is the drop-in fetch: attaches the token, and on a 401 pairs
// once and retries — so first contact with a locked host self-heals.

import firebase from 'firebase/compat/app';

const tokenKey = base => `shamashHostToken:${base}`;

export function hostAuthHeaders(base) {
  try {
    const t = localStorage.getItem(tokenKey(base));
    return t ? { "X-Host-Token": t } : {};
  } catch { return {}; }
}

export async function pairWithHost(base) {
  try {
    const user = firebase.auth?.().currentUser;
    if (!user) return false;
    const idToken = await user.getIdToken();
    const res = await fetch(`${base}/pair`, {
      method: "POST",
      cache: "no-store",
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({}));
    if (!data?.hostToken) return false;
    try { localStorage.setItem(tokenKey(base), data.hostToken); } catch {}
    return true;
  } catch { return false; }
}

export async function hostFetch(base, path, opts = {}) {
  const run = () => fetch(`${base}${path}`, {
    ...opts,
    headers: { ...(opts.headers || {}), ...hostAuthHeaders(base) },
  });
  let res = await run();
  if (res.status === 401 && await pairWithHost(base)) res = await run();
  return res;
}
