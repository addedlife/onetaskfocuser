// ── "A newer Shamash is live" ────────────────────────────────────────────────
//
// Two related jobs, both hanging off one fact: the version compiled into this
// bundle (APP_VERSION) versus the version that is actually deployed.
//
//   1. watchForUpdates() polls /version.json and announces when the deployed
//      version has moved ahead of the running one, so the app can offer to
//      reload instead of the owner having to notice and hit Reload by hand.
//   2. readJustUpdated() answers the other side of it — "did the reload I just
//      did actually bring something new?" — which drives the five-minute pill
//      next to the version stamp.
//
// Why not the service worker's update lifecycle, which is the textbook answer:
// public/sw.js is a hand-maintained file whose bytes change only when someone
// bumps CACHE_NAME, so on a normal deploy the browser fetches a byte-identical
// worker, considers it the same worker, and never fires `updatefound`. Polling
// a manifest that is regenerated every build is the thing that actually tells
// the truth here, and it carries the version string so the dialog can name it.

import { APP_VERSION } from './version.js';

export const UPDATE_AVAILABLE_EVENT = 'shamash-update:available';

const SEEN_VERSION_KEY = 'shamash_last_seen_version';
const UPDATED_AT_KEY   = 'shamash_updated_at';
const UPDATED_FROM_KEY = 'shamash_updated_from';

// How long the "just updated" pill stays up. The owner asked for five minutes:
// long enough to notice after a reload, short enough that it is never furniture.
export const JUST_UPDATED_WINDOW_MS = 5 * 60 * 1000;

const POLL_MS = 15 * 60 * 1000;   // background cadence — a deploy is not urgent
const MIN_GAP_MS = 60 * 1000;     // floor between checks, so foregrounding can't spam

function readLS(key)        { try { return localStorage.getItem(key); } catch { return null; } }
function writeLS(key, val)  { try { localStorage.setItem(key, val); } catch {} }

// Compare two dotted version strings numerically, so 4.117.10 is correctly newer
// than 4.117.9 — a plain string compare gets that backwards.
function isNewer(candidate, current) {
  if (typeof candidate !== 'string' || !candidate) return false;
  if (candidate === current) return false;
  const a = candidate.split('.').map(n => parseInt(n, 10));
  const b = String(current).split('.').map(n => parseInt(n, 10));
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = Number.isFinite(a[i]) ? a[i] : 0;
    const y = Number.isFinite(b[i]) ? b[i] : 0;
    if (x !== y) return x > y;
  }
  return false;
}

// ── The five-minute pill ─────────────────────────────────────────────────────
//
// Called once at boot, BEFORE anything renders. If this bundle's version differs
// from the last one this browser ran, the reload that just happened is what
// applied the update, so stamp the moment and remember what we came from.
//
// A browser that has never run Shamash gets no pill: there is no "updated from"
// for a first visit, and announcing an update to a brand-new install is a lie.
export function recordBootVersion() {
  const seen = readLS(SEEN_VERSION_KEY);
  if (seen && seen !== APP_VERSION) {
    writeLS(UPDATED_AT_KEY, String(Date.now()));
    writeLS(UPDATED_FROM_KEY, seen);
  }
  writeLS(SEEN_VERSION_KEY, APP_VERSION);
}

// → { at, from, version } while the pill should show, otherwise null.
export function readJustUpdated() {
  const at = parseInt(readLS(UPDATED_AT_KEY) || '', 10);
  if (!Number.isFinite(at)) return null;
  if (Date.now() - at > JUST_UPDATED_WINDOW_MS) return null;
  return { at, from: readLS(UPDATED_FROM_KEY) || null, version: APP_VERSION };
}

// ── The update prompt ────────────────────────────────────────────────────────
//
// Returns a stop function. Fires UPDATE_AVAILABLE_EVENT (detail: { version })
// at most once per newly discovered version — re-firing on every poll would
// reopen a dialog the owner already dismissed.
export function watchForUpdates() {
  if (typeof window === 'undefined') return () => {};

  let stopped = false;
  let announced = null;
  let lastCheck = 0;
  let timer = null;

  const check = async () => {
    if (stopped) return;
    const now = Date.now();
    if (now - lastCheck < MIN_GAP_MS) return;
    lastCheck = now;
    try {
      // cache: 'no-store' plus a cache-buster: Firebase serves this no-cache, but
      // an installed PWA's own HTTP cache and any intermediary still need telling.
      const res = await fetch(`/version.json?t=${now}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (stopped) return;
      if (isNewer(data?.version, APP_VERSION) && announced !== data.version) {
        announced = data.version;
        window.dispatchEvent(new CustomEvent(UPDATE_AVAILABLE_EVENT, {
          detail: { version: data.version, buildTime: data.buildTime || null },
        }));
      }
    } catch {
      // Offline, or the manifest isn't deployed yet. Nothing to tell the owner:
      // "couldn't check for updates" is noise, not news.
    }
  };

  // A tab that has been in the background for hours is the likeliest one to be
  // stale, so a foreground is the single most valuable moment to check.
  const onVisible = () => { if (document.visibilityState === 'visible') check(); };

  // First check is deferred: boot is busy, and an update seconds after loading
  // is not worth competing with the app painting.
  const kickoff = setTimeout(check, 30 * 1000);
  timer = setInterval(check, POLL_MS);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', check);

  return () => {
    stopped = true;
    clearTimeout(kickoff);
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', check);
  };
}

// Applying the update: drop the offline caches first, otherwise the service
// worker can serve the very bundle we are trying to leave behind, and the
// reload lands back on the old version with the dialog popping up again.
export async function applyUpdate() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch {}
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    await reg?.update?.();
  } catch {}
  try { window.location.reload(); } catch {}
}
