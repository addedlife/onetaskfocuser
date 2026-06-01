const OFFLINE_READY_KEY = "onetask_offline_shell_ready";

function collectOfflineUrls() {
  const urls = new Set(["/", "/index.html", "/manifest.webmanifest"]);

  try {
    urls.add(`${window.location.pathname}${window.location.search}`);
    document.querySelectorAll("script[src],link[rel='stylesheet'][href]").forEach((node) => {
      const value = node.getAttribute("src") || node.getAttribute("href");
      if (!value) return;
      const url = new URL(value, window.location.origin);
      if (url.origin === window.location.origin) {
        urls.add(`${url.pathname}${url.search}`);
      }
    });
  } catch {}

  return Array.from(urls);
}

export function registerOfflineShell() {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;

  // Note: the actual reload-to-fresh-code is driven by the service worker itself
  // (it navigates its clients on activate), which also rescues stale installed PWAs
  // that resume old code without re-navigating. Here we just make sure the browser
  // checks for a new worker promptly instead of waiting up to 24h.
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

      // Proactively check for a new SW on load and every time the app is foregrounded,
      // so resumed PWAs discover and apply updates instead of sitting on stale code.
      const checkForUpdate = () => { registration.update().catch(() => {}); };
      checkForUpdate();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") checkForUpdate();
      });

      const ready = await navigator.serviceWorker.ready;
      const target = ready.active || registration.active || navigator.serviceWorker.controller;
      target?.postMessage({ type: "CACHE_URLS", urls: collectOfflineUrls() });
      localStorage.setItem(OFFLINE_READY_KEY, String(Date.now()));
      window.dispatchEvent(new CustomEvent("onetask-offline-ready"));
    } catch (error) {
      console.warn("[offline] Service worker registration failed", error);
      // Don't let a SW failure stall the app's offline-ready signal.
      window.dispatchEvent(new CustomEvent("onetask-offline-ready"));
    }
  });
}

export function isOfflineShellReady() {
  try {
    return !!localStorage.getItem(OFFLINE_READY_KEY);
  } catch {
    return false;
  }
}
