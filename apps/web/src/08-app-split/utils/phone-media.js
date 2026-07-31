// Picture-text (MMS) bytes — the one place either phone surface resolves them.
//
// Two delivery paths reach the browser, and only one of them carries the image:
//
//   LAN / loopback — the host answers /messages?includeMms=1 and the bytes ride
//     inline on the attachment as a `data:` URL. Nothing to fetch.
//   Cloud relay    — the state blob has a hard size ceiling, so the host pushes
//     a resized preview to the `phone-media/{mediaId}` Firestore doc and the
//     attachment carries only the small `mediaId`. The bytes must be fetched.
//
// The NerveCenter phone card knew about the second path; DeskPhone Web did not,
// so on the cloud path its picture texts rendered as an "Image" placeholder whose
// Save button answered "Attachment data is not available in the browser yet" —
// permanently, since nothing was ever going to fill it in (owner ticket
// 8RbMKKO9PTQX7ZRfkwmF, "hours after text was sent from the actual phone").
// Both surfaces now share this module, so neither can drift from the other again.

import { db } from '../../01-core.js';

// mediaId → data: URL. Module-scoped so reopening a thread, re-rendering a list,
// or switching surfaces never refetches an image already in hand. Also caches the
// misses (as null) so a genuinely absent doc is not re-requested on every render.
const mediaCache = new Map();
// mediaId → in-flight promise, so N attachments referencing one id make one read.
const inFlight = new Map();

// Synchronous peek — lets a component paint a cached image on its first render
// instead of flashing "loading image…" and settling a frame later.
export function cachedPhoneMedia(mediaId) {
  if (!mediaId) return "";
  return mediaCache.get(mediaId) || "";
}

// Resolve one mediaId to a data: URL. Returns "" when there is nothing to fetch,
// the doc is missing, or the read fails — callers show their own placeholder.
// Never throws: a picture that will not load must not take a thread down with it.
export async function loadPhoneMedia(mediaId) {
  if (!mediaId || !db) return "";
  if (mediaCache.has(mediaId)) return mediaCache.get(mediaId) || "";
  if (inFlight.has(mediaId)) return inFlight.get(mediaId);

  const pending = db.collection("phone-media").doc(mediaId).get()
    .then(snap => {
      const url = snap.exists ? (snap.data()?.data || "") : "";
      mediaCache.set(mediaId, url || null);
      return url;
    })
    .catch(() => {
      // Not cached as a miss: a failed read is usually transient (offline, a
      // rules hiccup during sign-in), and caching it would make the image
      // unavailable for the rest of the session.
      return "";
    })
    .finally(() => { inFlight.delete(mediaId); });

  inFlight.set(mediaId, pending);
  return pending;
}

// Fill in `dataUrl` on every attachment of every message that has a mediaId and
// no inline bytes. Returns the same array when there was nothing to resolve, so
// a caller can use identity to skip a setState (this runs on every relay tick).
export async function hydrateMessagesWithMedia(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const wanted = new Set();
  list.forEach(msg => {
    (msg?.attachments || []).forEach(att => {
      if (att?.mediaId && !att?.dataUrl) wanted.add(att.mediaId);
    });
  });
  if (!wanted.size) return list;

  const ids = [...wanted];
  const urls = await Promise.all(ids.map(loadPhoneMedia));
  const resolved = new Map();
  ids.forEach((id, i) => { if (urls[i]) resolved.set(id, urls[i]); });
  if (!resolved.size) return list;

  let changed = false;
  const next = list.map(msg => {
    const atts = msg?.attachments || [];
    if (!atts.some(a => a?.mediaId && !a?.dataUrl && resolved.has(a.mediaId))) return msg;
    changed = true;
    return {
      ...msg,
      attachments: atts.map(a => (
        a?.mediaId && !a?.dataUrl && resolved.has(a.mediaId)
          ? { ...a, dataUrl: resolved.get(a.mediaId) }
          : a
      )),
    };
  });
  return changed ? next : list;
}
