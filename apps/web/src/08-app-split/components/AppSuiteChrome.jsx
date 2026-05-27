import React from 'react';
import { cleanTheme, NC_FONT_STACK, NC_TYPE, suiteIcon } from '../ui-tokens.jsx';

function AppSuiteChrome({ T, active, onSelect, open, onToggle, onRecord, onMoreActions, topOffset = 0, forceCompact = false, clockTime = null, onSettings }) {
  const mainApps = [
    { id: "focus",      label: "Tasks",      icon: "task_alt"      },
    { id: "shailos",    label: "Shailos",    icon: "rule"          },
    { id: "deskphone",  label: "Phone",      icon: "smartphone"    },
  ];
  const experimentalApps = [
    { id: "health",     label: "Health",     icon: "monitor_heart" },
    { id: "taskriver",  label: "TaskRiver",  icon: "water"         },
    { id: "chief",      label: "Chief",      icon: "psychology"    },
  ];
  const C = cleanTheme(T);
  const displayOpen = open && !forceCompact;
  const W = displayOpen ? 184 : 64;
  const rightPad = displayOpen ? 12 : 10;
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
  const ncActive = active === "nervecenter";
  const arrowLeft = W - rightPad;
  return (
    <>
    <div
      className="nc-rail"
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

      {/* NerveCenter identity button — right side goes flat when active so the arrow cap reads as one shape */}
      <button onClick={() => onSelect("nervecenter")} title="NerveCenter"
        style={navButton(ncActive, {
          marginBottom: 10,
          fontSize: 15,
          ...(ncActive ? { borderRadius: "20px 0 0 20px" } : {}),
        })}>
        {suiteIcon("hub", 20)}
        {displayOpen && "NerveCenter"}
      </button>

      {/* Main app buttons */}
      {mainApps.map(app => {
        const isActive = active === app.id;
        return (
          <button key={app.id} onClick={() => onSelect(app.id)} title={app.label}
            style={navButton(isActive)}>
            {suiteIcon(app.icon, 17)}
            {displayOpen && app.label}
          </button>
        );
      })}

      {/* Experimental section divider + label */}
      <div style={{ marginTop: 10, marginBottom: 2, flexShrink: 0 }}>
        <div style={{ height: 1, background: C.divider, margin: displayOpen ? "0 8px 6px" : "0 4px 6px" }} />
        {displayOpen && (
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase",
            color: C.faint, fontFamily: NC_FONT_STACK, padding: "2px 14px 4px",
          }}>Experimental</div>
        )}
      </div>

      {/* Experimental app buttons */}
      {experimentalApps.map(app => {
        const isActive = active === app.id;
        return (
          <button key={app.id} onClick={() => onSelect(app.id)} title={`${app.label} (experimental)`}
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
          width: displayOpen ? "100%" : 40, height: 34, borderRadius:16,
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

    {/* Arrow cap — sibling of sidebar so overflow:hidden doesn't clip it.
        Flat left face aligns exactly with the button's right edge; tip pokes
        ~4-6 px past the sidebar border into the NerveCenter pane. */}
    {ncActive && (
      <div aria-hidden style={{
        position: "fixed",
        left: arrowLeft,
        top: topOffset + 18,
        zIndex: 8600,
        width: 0,
        height: 0,
        borderTop: "20px solid transparent",
        borderBottom: "20px solid transparent",
        borderLeft: `16px solid ${C.hover}`,
        pointerEvents: "none",
        transition: "left 0.20s cubic-bezier(0.4,0,0.2,1)",
      }} />
    )}
    </>
  );
}

export { AppSuiteChrome };
