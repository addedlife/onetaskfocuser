import React, { useCallback, useEffect, useRef } from 'react';
import { suiteIcon } from '../ui-tokens.jsx';

function AppSuiteChrome({ T, active, onSelect, open, onToggle, onCollapse, onRecord, onMoreActions, autoCollapseEnabled = true, onToggleAutoCollapse }) {
  const screenApps = [
    { id: "focus",     label: "Tasks",   icon: "task_alt"   },
    { id: "shailos",   label: "Shailos", icon: "rule"       },
    { id: "deskphone", label: "Phone",   icon: "smartphone" },
  ];
  const W = open ? 168 : 46;
  const chromeRef = useRef(null);
  const acTimer = useRef(null);
  const isChromeHovered = useCallback(() => Boolean(chromeRef.current?.matches?.(":hover")), []);
  const clearAC = useCallback(() => {
    if (acTimer.current) { clearTimeout(acTimer.current); acTimer.current = null; }
  }, []);
  const scheduleAC = useCallback(() => {
    clearAC();
    if (!autoCollapseEnabled || !open || isChromeHovered()) return;
    acTimer.current = setTimeout(() => {
      if (!isChromeHovered()) onCollapse?.();
    }, 10000);
  }, [autoCollapseEnabled, clearAC, isChromeHovered, onCollapse, open]);
  useEffect(() => {
    scheduleAC();
    return clearAC;
  }, [scheduleAC, clearAC]);
  return (
    <div
      ref={chromeRef}
      onMouseEnter={clearAC}
      onMouseLeave={scheduleAC}
      style={{
      position: "fixed", left: 0, top: 0, bottom: 0, width: W, zIndex: 8600,
      display: "flex", flexDirection: "column", alignItems: open ? "stretch" : "center",
      boxSizing: "border-box", padding: open ? "16px 10px 14px" : "16px 5px 14px",
      gap: 2,
      background: T.bg || T.card,
      backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
      borderRight: `1px solid ${T.brdS || T.brd}`,
      transition: "width 0.20s cubic-bezier(0.4,0,0.2,1)",
      overflow: "hidden",
    }}>

      {/* NerveCenter identity button */}
      <button onClick={() => onSelect("nervecenter")} title="NerveCenter"
        style={{
          display: "flex", alignItems: "center", gap: open ? 8 : 0,
          justifyContent: open ? "flex-start" : "center",
          border: "none",
          background: active === "nervecenter" ? (T.tonal || "rgba(127,127,127,0.13)") : "transparent",
          cursor: "pointer", color: active === "nervecenter" ? T.text : T.tSoft,
          fontFamily: "system-ui", fontWeight: 900, fontSize: 15,
          padding: open ? "8px 10px" : "8px 0",
          borderRadius: 11, width: "100%", overflow: "hidden", whiteSpace: "nowrap",
          marginBottom: 8, flexShrink: 0,
        }}>
        {suiteIcon("hub", 20)}
        {open && "NerveCenter"}
      </button>

      {/* Three app-screen buttons */}
      {screenApps.map(app => {
        const isActive = active === app.id;
        return (
          <button key={app.id} onClick={() => onSelect(app.id)} title={app.label}
            style={{
              height: 38, padding: open ? "0 10px" : "0",
              borderRadius: 11, cursor: "pointer", border: "none",
              background: isActive ? (T.tonal || T.card) : "transparent",
              color: isActive ? (T.onTonal || T.text) : T.tSoft,
              fontFamily: "system-ui", fontWeight: 800, fontSize: 13,
              display: "flex", alignItems: "center",
              gap: open ? 9 : 0, justifyContent: open ? "flex-start" : "center",
              width: "100%", overflow: "hidden", whiteSpace: "nowrap",
              boxShadow: isActive ? (T.shadow || "0 1px 5px rgba(0,0,0,0.10)") : "none",
              marginBottom: 3, flexShrink: 0,
            }}>
            {suiteIcon(app.icon, 17)}
            {open && app.label}
          </button>
        );
      })}

      {/* Divider */}
      <div style={{ height: 1, background: T.brdS || T.brd, margin: open ? "10px 4px" : "10px 0", flexShrink: 0 }} />

      {/* Record anything — mic */}
      <button onClick={onRecord} title="Record anything — tasks, shailos, notes, got-backs"
        style={{
          height: 38, padding: open ? "0 10px" : "0",
          borderRadius: 11, cursor: "pointer", border: "none",
          background: "transparent", color: T.tSoft,
          fontFamily: "system-ui", fontWeight: 800, fontSize: 13,
          display: "flex", alignItems: "center",
          gap: open ? 9 : 0, justifyContent: open ? "flex-start" : "center",
          width: "100%", overflow: "hidden", whiteSpace: "nowrap",
          marginBottom: 3, flexShrink: 0,
        }}>
        {suiteIcon("mic", 18)}
        {open && "Record"}
      </button>

      {/* More Actions */}
      <button onClick={onMoreActions} title="More Actions"
        style={{
          height: 38, padding: open ? "0 10px" : "0",
          borderRadius: 11, cursor: "pointer", border: "none",
          background: T.primary || T.text, color: T.onPrimary || T.bg,
          fontFamily: "system-ui", fontWeight: 900, fontSize: 13,
          display: "flex", alignItems: "center",
          gap: open ? 9 : 0, justifyContent: open ? "flex-start" : "center",
          width: "100%", overflow: "hidden", whiteSpace: "nowrap",
          marginBottom: 2, flexShrink: 0,
        }}>
        {suiteIcon("apps", 18)}
        {open && "More Actions"}
      </button>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Auto-collapse toggle */}
      <button onClick={onToggleAutoCollapse} title={autoCollapseEnabled ? "Auto-collapse: ON (click to disable)" : "Auto-collapse: OFF (click to enable)"}
        data-automation-id="AppSuiteAutoCollapseToggle"
        style={{
          width: open ? "100%" : 32, height: 28, borderRadius: 10,
          border: `1px solid ${T.brdS || T.brd}`,
          background: autoCollapseEnabled ? (T.tonal || "rgba(127,127,127,0.10)") : "transparent",
          color: autoCollapseEnabled ? T.tSoft : T.tFaint,
          cursor: "pointer", display: "flex", alignItems: "center",
          justifyContent: open ? "flex-start" : "center",
          padding: open ? "0 8px" : "0", gap: open ? 6 : 0, flexShrink: 0, marginBottom: 3,
          fontFamily: "system-ui", fontSize: 11, fontWeight: 700, overflow: "hidden", whiteSpace: "nowrap",
        }}>
        {suiteIcon("timer", 13)}
        {open && (autoCollapseEnabled ? "Auto-collapse: on" : "Auto-collapse: off")}
      </button>

      {/* Collapse / expand toggle */}
      <button onClick={onToggle} title={open ? "Collapse sidebar" : "Expand sidebar"}
        style={{
          width: open ? "100%" : 32, height: 30, borderRadius: 10,
          border: `1px solid ${T.brdS || T.brd}`,
          background: "transparent", color: T.tFaint, cursor: "pointer",
          display: "flex", alignItems: "center",
          justifyContent: open ? "flex-end" : "center",
          padding: open ? "0 8px" : "0", flexShrink: 0,
        }}>
        {suiteIcon(open ? "chevron_left" : "chevron_right", 15)}
      </button>
    </div>
  );
}

export { AppSuiteChrome };
