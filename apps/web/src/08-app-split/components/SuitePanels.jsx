import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeskPhoneWebPanel } from '../../10-deskphone-web.jsx';
import { buildDeskPhoneThemeQuery, cleanTheme, ELEV, ICON, NC_FONT_STACK, NC_TYPE, RADIUS, SP, suiteIcon } from '../ui-tokens.jsx';
import { ActionBtn, IconBtn } from '../m3.jsx';


function SuiteShailosPanel({ T, action, onClose, sidebarW = 0 }) {
  const C = cleanTheme(T);
  return (
    <div style={{ position: "fixed", inset: `0 0 0 ${sidebarW}px`, zIndex: 7600, overflow: "hidden", background: C.bg, borderLeft: `1px solid ${C.divider}`, boxShadow: ELEV.drawer, display: "flex", flexDirection: "column" }}>
      <div style={{ height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", padding: `0 ${SP.lg}`, borderBottom: `1px solid ${C.divider}`, background: C.bg, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: SP.sm, minWidth: 0 }}>
          {suiteIcon("question_mark", ICON.xl)}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: NC_TYPE.title, fontWeight: 500, color: C.text, fontFamily: NC_FONT_STACK }}>Shailos Tracker</div>
            <div style={{ fontSize: NC_TYPE.body, color: C.faint, fontFamily: NC_FONT_STACK }}>Questions, answers, and follow-up</div>
          </div>
        </div>
        <IconBtn variant="tonal" icon="close" iconSize={ICON.lg} size={36}
          color={C.muted} containerColor={C.bgSoft} onClick={onClose} title="Back to tasks" />
      </div>
      <iframe src={action ? `/shailos/?action=${action}` : "/shailos/"} title="Shailos Tracker" style={{ flex: 1, border: "none", width: "100%", background: C.bgSoft }} />
    </div>
  );
}

function DeskPhoneSuitePanel({ T, onOnlineChange, schemeId = "claude", onLaunch, sidebarW = 0 }) {
  const C = cleanTheme(T);
  const api = "http://127.0.0.1:8765";
  const stageRef = useRef(null);
  const lastThemeRef = useRef("");
  const dockTokenRef = useRef(`dock-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [docked, setDocked] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setError("");
      const statusRes = await fetch(`${api}/status`, { cache: "no-store" });
      const nextStatus = await statusRes.json();
      setStatus(nextStatus);
      onOnlineChange?.(true);
    } catch {
      setStatus(null);
      setError("DeskPhone is not ready yet.");
      onOnlineChange?.(false);
    }
  }, [onOnlineChange]);

  const post = useCallback(async (path, label) => {
    if (label) setBusy(label);
    try {
      await fetch(`${api}${path}`, { method: "POST" });
      await refresh();
    } catch {
      setError("DeskPhone did not accept the command.");
      onOnlineChange?.(false);
    } finally {
      setBusy("");
    }
  }, [refresh, onOnlineChange]);

  const themePalette = schemeId === "navyGold" || schemeId === "materialDark" ? "navyGold" : schemeId === "material" ? "material" : "claude";
  const themeQuery = useMemo(() => buildDeskPhoneThemeQuery(themePalette, T), [themePalette, T]);
  const releaseStage = useCallback((updateState = true) => {
    const token = encodeURIComponent(dockTokenRef.current);
    fetch(`${api}/stage-exit?token=${token}`, { method: "POST" }).catch(()=>{});
    if (updateState) setDocked(false);
  }, []);

  const syncStage = useCallback(async () => {
    const availLeft = window.screen.availLeft ?? 0;
    const availTop = window.screen.availTop ?? 0;
    const availRight = availLeft + window.screen.availWidth;
    const availBottom = availTop + window.screen.availHeight;
    const gap = 16;
    const dockW = Math.round(Math.min(580, Math.max(480, window.screen.availWidth * 0.32)));
    const dockH = Math.round(Math.max(560, window.screen.availHeight - 96));
    const x = Math.round(Math.max(availLeft + gap, availRight - dockW - gap));
    const y = Math.round(Math.max(availTop + gap, Math.min(availTop + 64, availBottom - dockH - gap)));
    const qs = new URLSearchParams({
      x: String(x),
      y: String(y),
      w: String(dockW),
      h: String(dockH),
      chrome: "1",
      token: dockTokenRef.current,
    });
    setBusy("dock");
    try {
      await fetch(`${api}/stage?${qs}`, { method: "POST" });
      if (lastThemeRef.current !== themeQuery) {
        lastThemeRef.current = themeQuery;
        await fetch(`${api}/theme?${themeQuery}`, { method: "POST" }).catch(()=>{});
      }
      setDocked(true);
      await refresh();
    } catch {
      setError("DeskPhone did not dock.");
      onOnlineChange?.(false);
    } finally {
      setBusy("");
    }
  }, [refresh, themeQuery, onOnlineChange]);

  const pulseStage = useCallback(() => {
    const token = encodeURIComponent(dockTokenRef.current);
    fetch(`${api}/stage-pulse?token=${token}`, { method: "POST" }).catch(()=>{});
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 7000);
    return () => {
      clearInterval(id);
    };
  }, [refresh]);

  useEffect(() => {
    if (!docked) return;
    const id = setInterval(pulseStage, 10000);
    const onPageExit = () => releaseStage(false);
    window.addEventListener("pagehide", onPageExit);
    window.addEventListener("beforeunload", onPageExit);
    return () => {
      clearInterval(id);
      window.removeEventListener("pagehide", onPageExit);
      window.removeEventListener("beforeunload", onPageExit);
      releaseStage(false);
    };
  }, [docked, pulseStage, releaseStage]);

  return (
    <div style={{ position: "fixed", inset: `0 0 0 ${sidebarW}px`, zIndex: 7600, overflow: "hidden", background: `linear-gradient(160deg, ${C.bg} 0%, ${C.bgSoft} 100%)`, borderLeft: `1px solid ${C.divider}`, boxShadow: ELEV.drawer, display: "grid", gridTemplateRows: "auto 1fr", padding: "clamp(12px,2vw,18px)", boxSizing: "border-box", gap: SP.md, fontFamily: NC_FONT_STACK }}>
      <div style={{ height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", gap: SP.md, padding: `0 ${SP.md}`, border: `1px solid ${C.divider}`, borderRadius: RADIUS.md, background: C.bg }}>
        <div style={{ display: "flex", alignItems: "center", gap: SP.sm, minWidth: 0 }}>
          {suiteIcon("smartphone", ICON.xl)}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: NC_TYPE.title, fontWeight: 500, color: C.text, fontFamily: NC_FONT_STACK }}>Phone</div>
            <div style={{ fontSize: NC_TYPE.meta, color: C.faint, fontFamily: NC_FONT_STACK }}>{status ? `${status.build || "DeskPhone"} - ${status.hfp || "Phone"} - ${status.map || "Messages"}` : "Waiting for DeskPhone"}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: SP.sm, alignItems: "center" }}>
          <ActionBtn variant="tonal" icon="open_in_new" iconSize={ICON.md} height={36} containerColor={C.bgSoft} labelColor={C.text}
            onClick={() => { if (!status) onLaunch?.(); syncStage(); setTimeout(syncStage, 900); }}
            title={status ? "Dock DeskPhone" : "Open DeskPhone"}>{status ? "Dock" : "Open"}</ActionBtn>
          <ActionBtn variant="filled" icon="fit_screen" iconSize={ICON.md} height={36}
            onClick={syncStage} disabled={!!busy} title="Move DeskPhone to the dock position">Position</ActionBtn>
          <IconBtn variant="tonal" icon="close_fullscreen" iconSize={ICON.md} size={36}
            containerColor={C.bgSoft} onClick={() => releaseStage()} disabled={!!busy} title="Release DeskPhone sizing" />
          <IconBtn variant="tonal" icon="refresh" iconSize={ICON.md} size={36}
            containerColor={C.bgSoft} onClick={refresh} title="Refresh status" />
        </div>
      </div>
      <div ref={stageRef} style={{ position: "relative", minHeight: 0, border: `1px solid ${C.divider}`, borderRadius: RADIUS.md, background: C.bg, boxShadow: ELEV[3], overflow: "auto", padding: "clamp(16px,2.4vw,28px)", boxSizing: "border-box", display: "grid", gridTemplateColumns: "minmax(280px,420px) minmax(320px,1fr)", gap: SP.lg, alignItems: "start" }}>
        <div style={{ display: "grid", gap: SP.md }}>
          <div style={{ fontSize: 22, fontWeight: 500, color: C.text, fontFamily: NC_FONT_STACK, display: "flex", alignItems: "center", gap: SP.sm }}>{suiteIcon("phone_in_talk", 28)} Phone</div>
          {error && <div style={{ fontSize: NC_TYPE.body, lineHeight: 1.45, color: C.danger, background: `${C.danger}18`, border: `1px solid ${C.danger}40`, borderRadius: RADIUS.md, padding: SP.sm }}>{error}</div>}
          <div style={{ display: "grid", gap: SP.sm }}>
            <ActionBtn variant="filled" icon="desktop_windows" iconSize={ICON.lg} height={44} containerColor={C.accent} labelColor="#fff"
              onClick={() => { if (!status) onLaunch?.(); syncStage(); setTimeout(syncStage, 900); }}
              title="Dock DeskPhone">Dock DeskPhone</ActionBtn>
            <ActionBtn variant="outlined" icon="open_in_full" iconSize={ICON.md} height={40} outlineColor={C.divider} labelColor={C.text}
              onClick={() => releaseStage()} title="Release DeskPhone sizing">Release</ActionBtn>
          </div>
        </div>
        <DeskPhoneWebPanel T={T} onOnlineChange={onOnlineChange} onLaunchNative={onLaunch} embedded />
      </div>
    </div>
  );
}

export { DeskPhoneSuitePanel, SuiteShailosPanel };
