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

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const ready = await navigator.serviceWorker.ready;
      const target = ready.active || registration.active || navigator.serviceWorker.controller;
      target?.postMessage({ type: "CACHE_URLS", urls: collectOfflineUrls() });
      localStorage.setItem(OFFLINE_READY_KEY, String(Date.now()));
      window.dispatchEvent(new CustomEvent("onetask-offline-ready"));
    } catch (error) {
      console.warn("[offline] Service worker registration failed", error);
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
