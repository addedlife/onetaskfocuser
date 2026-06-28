const CACHE_NAME = "onetask-offline-v1";
const STATIC_URLS = ["/", "/index.html", "/manifest.webmanifest"];

function shouldRuntimeCache(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/.netlify/functions/")) return false;
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
    const response = await fetch(request);
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
  if (!shouldRuntimeCache(event.request)) return;

  const url = new URL(event.request.url);
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
