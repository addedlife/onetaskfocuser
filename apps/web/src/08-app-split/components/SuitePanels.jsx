import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeskPhoneWebPanel } from '../../10-deskphone-web.jsx';
import { buildDeskPhoneThemeQuery, NC_FONT_STACK, suiteIcon } from '../ui-tokens.jsx';

function SuiteShailosPanel({ T, action, onClose, sidebarW = 0 }) {
  return (
    <div style={{position:"fixed",inset:`0 0 0 ${sidebarW}px`,zIndex:7600,overflow:"hidden",background:T.card,borderLeft:`1px solid ${T.brd}`,boxShadow:T.shadowLg || "0 18px 60px rgba(0,0,0,0.25)",display:"flex",flexDirection:"column"}}>
      <div style={{height:52,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 16px",borderBottom:`1px solid ${T.brd}`,background:T.card,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
          {suiteIcon("rule", 21)}
          <div style={{minWidth:0}}>
            <div style={{fontSize:15,fontWeight:500,color:T.text,fontFamily:NC_FONT_STACK}}>Shailos Tracker</div>
            <div style={{fontSize:13,color:T.tFaint,fontFamily:NC_FONT_STACK}}>Questions, answers, and follow-up</div>
          </div>
        </div>
        <button onClick={onClose} title="Back to tasks" style={{width:36,height:36,borderRadius:12,border:`1px solid ${T.brd}`,background:T.bgW,color:T.tSoft,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>{suiteIcon("close", 19)}</button>
      </div>
      <iframe src={action ? `/shailos/?action=${action}` : "/shailos/"} title="Shailos Tracker" style={{flex:1,border:"none",width:"100%",background:T.bg}}/>
    </div>
  );
}

function DeskPhoneSuitePanel({ T, onOnlineChange, schemeId = "claude", onLaunch, sidebarW = 0 }) {
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
    <div style={{position:"fixed",inset:`0 0 0 ${sidebarW}px`,zIndex:7600,overflow:"hidden",background:`linear-gradient(160deg, ${T.bg} 0%, ${T.bgW} 100%)`,borderLeft:`1px solid ${T.brd}`,boxShadow:T.shadowLg || "0 18px 60px rgba(0,0,0,0.25)",display:"grid",gridTemplateRows:"auto 1fr",padding:"clamp(12px,2vw,18px)",boxSizing:"border-box",gap:12,fontFamily:NC_FONT_STACK}}>
      <div style={{height:52,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"0 14px",border:`1px solid ${T.brd}`,borderRadius:16,background:T.card}}>
        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
          {suiteIcon("smartphone", 22)}
          <div style={{minWidth:0}}>
            <div style={{fontSize:15,fontWeight:500,color:T.text,fontFamily:NC_FONT_STACK}}>Phone</div>
            <div style={{fontSize:13,color:T.tFaint,fontFamily:NC_FONT_STACK}}>{status ? `${status.build || "DeskPhone"} - ${status.hfp || "Phone"} - ${status.map || "Messages"}` : "Waiting for DeskPhone"}</div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button onClick={()=>{if (!status) onLaunch?.(); syncStage(); setTimeout(syncStage, 900);}} title={status ? "Dock DeskPhone" : "Open DeskPhone"} style={{height:36,padding:"0 12px",borderRadius:12,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,cursor:"pointer",fontWeight:500,fontSize:14,display:"flex",alignItems:"center",gap:6}}>{suiteIcon("open_in_new",17)} {status ? "Dock" : "Open"}</button>
          <button onClick={syncStage} disabled={!!busy} title="Move DeskPhone to the dock position" style={{height:36,padding:"0 12px",borderRadius:12,border:"none",background:T.primary || T.text,color:T.onPrimary || T.bg,cursor:"pointer",fontWeight:500,fontSize:14,display:"flex",alignItems:"center",gap:6}}>{suiteIcon("fit_screen",17)} Position</button>
          <button onClick={()=>releaseStage()} disabled={!!busy} title="Release DeskPhone sizing" style={{width:36,height:36,borderRadius:12,border:`1px solid ${T.brd}`,background:T.bgW,color:T.tSoft,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>{suiteIcon("close_fullscreen", 18)}</button>
          <button onClick={refresh} title="Refresh status" style={{width:36,height:36,borderRadius:12,border:`1px solid ${T.brd}`,background:T.bgW,color:T.tSoft,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>{suiteIcon("refresh", 18)}</button>
        </div>
      </div>
      <div ref={stageRef} style={{position:"relative",minHeight:0,border:`1px solid ${T.brd}`,borderRadius:18,background:T.card,boxShadow:T.shadowLg || "0 18px 60px rgba(0,0,0,0.18)",overflow:"auto",padding:"clamp(16px,2.4vw,28px)",boxSizing:"border-box",display:"grid",gridTemplateColumns:"minmax(280px,420px) minmax(320px,1fr)",gap:18,alignItems:"start"}}>
        <div style={{display:"grid",gap:12}}>
          <div style={{fontSize:20,fontWeight:500,color:T.text,fontFamily:NC_FONT_STACK,display:"flex",alignItems:"center",gap:10}}>{suiteIcon("phone_in_talk",28)} Phone</div>
          {error && <div style={{fontSize:13,lineHeight:1.45,color:"#BA2A2A",background:"#FFE1E1",border:"1px solid #F0B5B5",borderRadius:12,padding:10}}>{error}</div>}
          <div style={{display:"grid",gap:8}}>
            <button onClick={()=>{if (!status) onLaunch?.(); syncStage(); setTimeout(syncStage, 900);}} style={{height:44,borderRadius:14,border:"none",background:T.primary || T.text,color:T.onPrimary || T.bg,cursor:"pointer",fontWeight:500,fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>{suiteIcon("desktop_windows",19)} Dock DeskPhone</button>
            <button onClick={()=>releaseStage()} style={{height:40,borderRadius:13,border:`1px solid ${T.brd}`,background:T.bgW,color:T.text,cursor:"pointer",fontWeight:500,fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>{suiteIcon("open_in_full",18)} Release</button>
          </div>
        </div>
        <DeskPhoneWebPanel T={T} onOnlineChange={onOnlineChange} onLaunchNative={onLaunch} embedded />
      </div>
    </div>
  );
}

export { DeskPhoneSuitePanel, SuiteShailosPanel };
