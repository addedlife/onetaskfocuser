import { useCallback, useEffect, useRef, useState } from 'react';

const DESKPHONE_API = "http://127.0.0.1:8765";

export function useDeskPhoneBridge({ themeQuery, themeSyncEnabled }) {
  const [deskPhoneOnline, setDeskPhoneOnline] = useState(false);
  const deskPhoneLaunchAtRef = useRef(0);
  const lastDeskPhoneThemeRef = useRef("");

  const syncDeskPhoneTheme = useCallback(async (force = false) => {
    if (!themeSyncEnabled) return false;
    if (!force && lastDeskPhoneThemeRef.current === themeQuery) return true;
    try {
      const res = await fetch(`${DESKPHONE_API}/theme?${themeQuery}`, {
        method: "POST",
        cache: "no-store"
      });
      if (!res.ok) throw new Error("theme sync failed");
      lastDeskPhoneThemeRef.current = themeQuery;
      setDeskPhoneOnline(true);
      return true;
    } catch {
      setDeskPhoneOnline(false);
      return false;
    }
  }, [themeQuery, themeSyncEnabled]);

  const launchDeskPhone = useCallback((force = false) => {
    if (!force && deskPhoneOnline) return;
    const now = Date.now();
    if (now - deskPhoneLaunchAtRef.current < 15000) return;
    deskPhoneLaunchAtRef.current = now;
    try {
      const link = document.createElement("a");
      link.href = "deskphone://open";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      try { window.location.href = "deskphone://open"; } catch {}
    }
  }, [deskPhoneOnline]);

  const bringDeskPhoneForward = useCallback(async () => {
    if (!deskPhoneOnline) {
      launchDeskPhone(true);
      return;
    }
    try {
      const res = await fetch(`${DESKPHONE_API}/show`, { method: "POST", cache: "no-store" });
      if (!res.ok) throw new Error("show failed");
      await syncDeskPhoneTheme(true);
      setDeskPhoneOnline(true);
    } catch {
      launchDeskPhone(true);
    }
  }, [deskPhoneOnline, launchDeskPhone, syncDeskPhoneTheme]);

  const sendDeskPhoneCommand = useCallback(async (path) => {
    try {
      const res = await fetch(`${DESKPHONE_API}${path}`, { method: "POST", cache: "no-store" });
      if (!res.ok) throw new Error("phone command failed");
      setDeskPhoneOnline(true);
    } catch {
      launchDeskPhone(true);
    }
  }, [launchDeskPhone]);

  useEffect(() => {
    syncDeskPhoneTheme();
  }, [syncDeskPhoneTheme]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("deskphoneThemeRefresh")) return;
    syncDeskPhoneTheme(true);
    params.delete("deskphoneThemeRefresh");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash || ""}`);
  }, [syncDeskPhoneTheme]);

  useEffect(() => {
    if (!themeSyncEnabled) return;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(`${DESKPHONE_API}/status`, { cache: "no-store" });
        if (!res.ok) throw new Error("DeskPhone status failed");
        if (stopped) return;
        if (!deskPhoneOnline) {
          await syncDeskPhoneTheme(true);
        } else {
          setDeskPhoneOnline(true);
        }
      } catch {
        if (!stopped) setDeskPhoneOnline(false);
      }
    };
    poll();
    const id = window.setInterval(poll, 2500);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [deskPhoneOnline, themeSyncEnabled, syncDeskPhoneTheme]);

  return {
    bringDeskPhoneForward,
    deskPhoneOnline,
    sendDeskPhoneCommand,
    setDeskPhoneOnline,
    syncDeskPhoneTheme,
  };
}
