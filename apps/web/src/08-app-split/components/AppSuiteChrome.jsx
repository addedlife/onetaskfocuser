import React from 'react';
import { cleanTheme, NC_FONT_STACK, NC_TYPE, suiteIcon } from '../ui-tokens.jsx';

function AppSuiteChrome({ T, active, onSelect, open, onToggle, onRecord, onMoreActions, topOffset = 0, forceCompact = false, clockTime = null, onSettings }) {
  const screenApps = [
    { id: "focus",     label: "Tasks",   icon: "task_alt"   },
    { id: "chief",     label: "Chief",   icon: "psychology" },
    { id: "shailos",   label: "Shailos", icon: "rule"       },
    { id: "deskphone", label: "Phone",   icon: "smartphone" },
  ];
  const C = cleanTheme(T);
  const displayOpen = open && !forceCompact;
  const W = displayOpen ? 184 : 64;
  const navButton = (isActive = false, overrides = {}) => ({
    height: 40,
    padding: displayOpen ? "0 12px" : "0",
    borderRadius: 20,
    cursor: "pointer",
    border: "none",
    background: isActive ? C.hover : "transparent",
    color: isActive ? C.text : C.muted,
    fontFamily: NC_FONT_STACK,
    fontWeight: 500,
    fontSize: 14,
    display: "flex",
    alignItems: "center",
    gap: displayOpen ? 12 : 0,
    justifyContent: displayOpen ? "flex-start" : "center",
    width: "100%",
    overflow: "hidden",
    whiteSpace: "nowrap",
    flexShrink: 0,
    ...overrides,
  });
  const rawNow = clockTime instanceof Date ? clockTime : new Date(clockTime || Date.now());
  const now = Number.isFinite(rawNow.getTime()) ? rawNow : new Date();
  const railTime = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const railDate = now.toLocaleDateString([], { month: "short", day: "numeric" });
  return (
    <div
      style={{
      position: "fixed", left: 0, top: topOffset, bottom: 0, width: W, zIndex: 8600,
      display: "flex", flexDirection: "column", alignItems: displayOpen ? "stretch" : "center",
      boxSizing: "border-box", padding: displayOpen ? "18px 12px 16px" : "18px 10px 16px",
      gap: 4,
      background: C.bg,
      backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
      borderRight: `1px solid ${C.divider}`,
      transition: "width 0.20s cubic-bezier(0.4,0,0.2,1)",
      overflow: "hidden",
    }}>

      {/* NerveCenter identity button */}
      <button onClick={() => onSelect("nervecenter")} title="NerveCenter"
        style={navButton(active === "nervecenter", { marginBottom: 10, fontSize: 15 })}>
        {suiteIcon("hub", 20)}
        {displayOpen && "NerveCenter"}
      </button>

      {/* Three app-screen buttons */}
      {screenApps.map(app => {
        const isActive = active === app.id;
        return (
          <button key={app.id} onClick={() => onSelect(app.id)} title={app.label}
            style={navButton(isActive)}>
            {suiteIcon(app.icon, 17)}
            {displayOpen && app.label}
          </button>
        );
      })}

      {/* Divider */}
      <div style={{ height: 1, background: C.divider, margin: displayOpen ? "12px 8px" : "12px 4px", flexShrink: 0 }} />

      {/* Record anything — mic */}
      <button onClick={onRecord} title="Record anything — tasks, shailos, notes, got-backs"
        style={navButton(false)}>
        {suiteIcon("mic", 18)}
        {displayOpen && "Record"}
      </button>

      {/* More Actions */}
      <button onClick={onMoreActions} title="More Actions"
        style={navButton(false, { color: C.accent })}>
        {suiteIcon("apps", 18)}
        {displayOpen && "More Actions"}
      </button>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Settings */}
      <button onClick={onSettings} title="Settings"
        style={navButton(false)}>
        {suiteIcon("settings", 18)}
        {displayOpen && "Settings"}
      </button>

      {/* Persistent clock */}
      <div title={now.toLocaleString()} style={{
        width: displayOpen ? "100%" : 44,
        minHeight: displayOpen ? 50 : 44,
        borderRadius: displayOpen ? 8 : 22,
        border: `1px solid ${C.divider}`,
        background: C.bgSoft,
        color: C.text,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 6,
        fontFamily: NC_FONT_STACK,
        fontVariantNumeric: "tabular-nums",
        overflow: "hidden",
        flexShrink: 0,
      }}>
        <span style={{ fontSize: displayOpen ? 18 : 13, fontWeight: 600, lineHeight: 1.05, whiteSpace: "nowrap" }}>{railTime}</span>
        {displayOpen && <span style={{ fontSize: NC_TYPE.small, color: C.muted, marginTop: 3, lineHeight: 1 }}>{railDate}</span>}
      </div>

      {/* Collapse / expand toggle */}
      <button onClick={onToggle} title={displayOpen ? "Collapse sidebar" : "Expand sidebar"} disabled={forceCompact}
        style={{
          width: displayOpen ? "100%" : 40, height: 34, borderRadius: 17,
          border: `1px solid ${C.divider}`,
          background: "transparent", color: C.faint, cursor: forceCompact ? "default" : "pointer",
          opacity: forceCompact ? 0.45 : 1,
          display: "flex", alignItems: "center",
          justifyContent: displayOpen ? "flex-end" : "center",
          padding: displayOpen ? "0 8px" : "0", flexShrink: 0,
        }}>
        {suiteIcon(displayOpen ? "chevron_left" : "chevron_right", 15)}
      </button>
    </div>
  );
}

export { AppSuiteChrome };
