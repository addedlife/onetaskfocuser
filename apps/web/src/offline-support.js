import { registerSW } from 'virtual:pwa-register';

const OFFLINE_READY_KEY = "onetask_offline_shell_ready";
const LEGACY_CACHE_NAME = "onetask-offline-v6";

function signalOfflineReady() {
  try { localStorage.setItem(OFFLINE_READY_KEY, String(Date.now())); } catch {}
  window.dispatchEvent(new CustomEvent("onetask-offline-ready"));
}

export function registerOfflineShell() {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;

  // Workbox-generated worker (vite-plugin-pwa, registerType: 'autoUpdate'). When a new
  // deploy ships, the precache manifest changes → the browser installs the new worker,
  // which skipWaiting + clientsClaim and then auto-reloads open windows to fresh code.
  // This is the cache-busting the old hand-bumped CACHE_NAME couldn't guarantee.
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      // One-time cleanup of the legacy hand-rolled cache so old bundles don't linger.
      try { caches.delete(LEGACY_CACHE_NAME); } catch {}
      // Check for a new worker on load and whenever the app is foregrounded, so resumed
      // PWAs discover updates promptly instead of waiting up to 24h.
      const checkForUpdate = () => { registration?.update().catch(() => {}); };
      checkForUpdate();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") checkForUpdate();
      });
      signalOfflineReady();
    },
    onOfflineReady() { signalOfflineReady(); },
    onRegisterError(error) {
      console.warn("[offline] Service worker registration failed", error);
      // Don't let a SW failure stall the app's offline-ready signal.
      signalOfflineReady();
    },
  });
}

export function isOfflineShellReady() {
  try {
    return !!localStorage.getItem(OFFLINE_READY_KEY);
  } catch {
    return false;
  }
}
