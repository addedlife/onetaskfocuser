// Bump this version whenever stale-asset purging is needed; the activate handler
deletes every cache that doesn't match, so installed PWAs drop old bundles on update.
const CACHE_NAME = "onetask-offline-v7";
const STATIC_URLS = ["/", "/index.html", "/manifest.webmanifest"];

function shouldRuntimeCache(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/.netlify/functions/")) return false;
  // Firebase Auth's reserved helper paths (OAuth handler, hidden iframe, helper scripts).
  // With a same-origin authDomain these live on THIS origin under /__/, so they MUST go
  // straight to the network — never cached, never index.html-fallback. See the fetch
  // handler note below.
  if (url.pathname.startsWith("/__/")) return false;
  if (url.hostname.includes("firestore.googleapis.com")) return false;
  if (url.hostname.includes("firebaseio.com")) return false;
  if (url.hostname.includes("identitytoolkit.googleapis.com")) return false;
  return true;
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    // Bound the network wait so a slow/half-open connection can't hang navigation —
    // fall back to cache after 6s instead of spinning indefinitely.
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 6000) : null;
    let response;
    try {
      response = await fetch(request, controller ? { signal: controller.signal } : undefined);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || (await cache.match("/index.html"));
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(async () => {
        // Escape hatch for stale installed PWAs (Android resumes the old page without
        // re-navigating, so it runs old code forever). When THIS newer worker activates,
        // force every controlled window to navigate to fresh code. activate() only runs
        // once per worker version, and the reload re-uses the already-active worker, so
        // this can't loop.
        try {
          const clients = await self.clients.matchAll({ type: "window" });
          for (const client of clients) {
            if ("navigate" in client) { try { await client.navigate(client.url); } catch (_) {} }
          }
        } catch (_) {}
      })
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_URLS" || !Array.isArray(event.data.urls)) return;
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const sameOriginUrls = event.data.urls
        .filter((url) => typeof url === "string")
        .map((url) => new URL(url, self.location.origin))
        .filter((url) => url.origin === self.location.origin)
        .map((url) => `${url.pathname}${url.search}`);
      return Promise.allSettled(sameOriginUrls.map((url) => cache.add(url)));
    })
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept Firebase Auth's reserved /__/ paths. Once authDomain is same-origin
  // (e.g. *.web.app), the Google OAuth handler, the hidden iframe getRedirectResult()
  // relies on, and the auth helper scripts are all served from /__/auth/* on THIS origin
  // and fall under the SW scope. If the SW answers them from cache — or, on a slow mobile
  // link, falls back to index.html after the 6s networkFirst timeout — the redirect result
  // can never be read and Google sign-in bounces straight back to the login screen (on both
  // iOS and Android). Returning here leaves them to the browser's normal network fetch.
  if (url.origin === self.location.origin && url.pathname.startsWith("/__/")) return;

  if (!shouldRuntimeCache(event.request)) return;
  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request));
    return;
  }

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/assets/") || url.pathname === "/manifest.webmanifest") {
      event.respondWith(cacheFirst(event.request));
      return;
    }
    event.respondWith(networkFirst(event.request));
  }
});
