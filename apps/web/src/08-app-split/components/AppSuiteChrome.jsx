import React from 'react';
import { cleanTheme, DUR, EASE, NC_FONT_STACK, NC_TYPE, RADIUS, suiteIcon } from '../ui-tokens.jsx';
import { APP_VERSION, formatVersionStamp, versionStampShort } from '../../version.js';

function AppSuiteChrome({ T, active, onSelect, open, onToggle, onRecord, onMoreActions, topOffset = 0, forceCompact = false, clockTime = null, onSettings, features = {} }) {
  const mainApps = [
    { id: "focus",      label: "Tasks",      icon: "rule"          },
    { id: "shailos",    label: "Shailos",    icon: "question_mark" },
    { id: "deskphone",  label: "Phone",      icon: "smartphone"    },
  ];
  const experimentalApps = [
    { id: "health",     label: "Health",     icon: "monitor_heart" },
    { id: "taskriver",  label: "TaskRiver",  icon: "water"         },
    { id: "chief",      label: "Chief",      icon: "psychology"    },
  ].filter(app => {
    if (app.id === "chief")  return features.chief  === true;
    if (app.id === "health") return features.health === true;
    return true;
  });
  const C = cleanTheme(T);
  const displayOpen = open && !forceCompact;
  const W = displayOpen ? 184 : 64;
  const rightPad = displayOpen ? 12 : 10;

  // Height-aware scale: shrink the whole rail to fit short (landscape-phone) viewports so
  // it never needs scrolling, while staying pixel-identical on tall/desktop screens (s=1).
  const [winH, setWinH] = React.useState(() => (typeof window !== "undefined" ? window.innerHeight : 800));
  React.useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const on = () => setWinH(window.innerHeight);
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => { window.removeEventListener("resize", on); window.removeEventListener("orientationchange", on); };
  }, []);
  const railH = Math.max(240, winH - topOffset);
  const NATURAL = 684;                                  // approx un-scaled content height
  const s = Math.max(0.5, Math.min(1, railH / NATURAL));
  const px = v => Math.round(v * s);                    // scaled pixels
  const ic = v => Math.max(13, Math.round(v * s));      // scaled icon size (never illegibly tiny)
  const BTN_H = Math.max(24, px(40));
  const FZ = Math.max(11, px(14));
  const GAP = Math.max(2, px(4));

  const navButton = (isActive = false, overrides = {}) => ({
    height: BTN_H,
    padding: displayOpen ? "0 12px" : "0",
    borderRadius: RADIUS.pill,
    cursor: "pointer",
    border: "none",
    background: isActive ? C.hover : "transparent",
    color: isActive ? C.text : C.muted,
    fontFamily: NC_FONT_STACK,
    fontWeight: 500,
    fontSize: FZ,
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
      boxSizing: "border-box", padding: `${px(18)}px ${displayOpen ? 12 : 10}px ${px(16)}px`,
      gap: GAP,
      background: C.bg,
      backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
      borderRight: `1px solid ${C.divider}`,
      transition: `width ${DUR.base} ${EASE.standard}`,
      // Short (landscape-phone) viewports can't fit the whole nav column; scroll
      // vertically so the bottom cluster (clock, toggle, version) is never clipped.
      overflowY: "auto",
      overflowX: "hidden",
    }}>

      {/* NerveCenter identity button — right side goes flat when active so the arrow cap reads as one shape */}
      <button onClick={() => onSelect("nervecenter")} title="NerveCenter"
        style={navButton(ncActive, {
          marginBottom: px(10),
          fontSize: Math.max(12, px(15)),
          ...(ncActive ? { borderRadius: `${RADIUS.pill} 0 0 ${RADIUS.pill}` } : {}),
        })}>
        {suiteIcon("hub", ic(20))}
        {displayOpen && "NerveCenter"}
      </button>

      {/* Main app buttons */}
      {mainApps.map(app => {
        const isActive = active === app.id;
        return (
          <button key={app.id} onClick={() => onSelect(app.id)} title={app.label}
            style={navButton(isActive)}>
            {suiteIcon(app.icon, ic(17))}
            {displayOpen && app.label}
          </button>
        );
      })}

      {/* Experimental section divider + label */}
      <div style={{ marginTop: px(10), marginBottom: px(2), flexShrink: 0 }}>
        <div style={{ height: 1, background: C.divider, margin: displayOpen ? `0 8px ${px(6)}px` : `0 4px ${px(6)}px` }} />
        {displayOpen && s > 0.72 && (
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
            {suiteIcon(app.icon, ic(17))}
            {displayOpen && app.label}
          </button>
        );
      })}

      {/* Divider */}
      <div style={{ height: 1, background: C.divider, margin: displayOpen ? `${px(12)}px 8px` : `${px(12)}px 4px`, flexShrink: 0 }} />

      {/* Record anything — mic */}
      <button onClick={onRecord} title="Record anything — tasks, shailos, notes, got-backs"
        style={navButton(false)}>
        {suiteIcon("mic", ic(18))}
        {displayOpen && "Record"}
      </button>

      {/* More Actions */}
      <button onClick={onMoreActions} title="More Actions"
        style={navButton(false, { color: C.accent })}>
        {suiteIcon("apps", ic(18))}
        {displayOpen && "More Actions"}
      </button>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Reload — always-reachable manual refresh. In installed/standalone (PWA) mode there's
          no browser address bar, so there's no Ctrl+R / pull-to-refresh to pick up a new deploy.
          index.html is served no-cache, so a plain reload fetches the latest hashed bundle.
          Styled muted so it stays unobtrusive in the bottom cluster. */}
      <button onClick={() => { try { window.location.reload(); } catch (_) {} }} title="Reload — get the latest version"
        style={navButton(false, { color: C.faint })}>
        {suiteIcon("refresh", ic(18))}
        {displayOpen && "Reload"}
      </button>

      {/* Settings */}
      <button onClick={onSettings} title="Settings"
        style={navButton(false)}>
        {suiteIcon("settings", ic(18))}
        {displayOpen && "Settings"}
      </button>

      {/* Persistent clock */}
      <div title={now.toLocaleString()} style={{
        width: displayOpen ? "100%" : 44,
        minHeight: displayOpen ? px(50) : Math.max(34, px(44)),
        borderRadius: displayOpen ? RADIUS.sm : RADIUS.pill,
        border: `1px solid ${C.divider}`,
        background: C.bgSoft,
        color: C.text,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: px(6),
        fontFamily: NC_FONT_STACK,
        fontVariantNumeric: "tabular-nums",
        overflow: "hidden",
        flexShrink: 0,
      }}>
        <span style={{ fontSize: displayOpen ? Math.max(13, px(18)) : Math.max(11, px(13)), fontWeight: 600, lineHeight: 1.05, whiteSpace: "nowrap" }}>{railTime}</span>
        {displayOpen && s > 0.7 && <span style={{ fontSize: NC_TYPE.small, color: C.muted, marginTop: 3, lineHeight: 1 }}>{railDate}</span>}
      </div>

      {/* Collapse / expand toggle */}
      <button onClick={onToggle} title={displayOpen ? "Collapse sidebar" : "Expand sidebar"} disabled={forceCompact}
        style={{
          width: displayOpen ? "100%" : 40, height: Math.max(24, px(34)), borderRadius: RADIUS.pill,
          border: `1px solid ${C.divider}`,
          background: "transparent", color: C.faint, cursor: forceCompact ? "default" : "pointer",
          opacity: forceCompact ? 0.45 : 1,
          display: "flex", alignItems: "center",
          justifyContent: displayOpen ? "flex-end" : "center",
          padding: displayOpen ? "0 8px" : "0", flexShrink: 0,
        }}>
        {suiteIcon(displayOpen ? "chevron_left" : "chevron_right", ic(15))}
      </button>

      {/* Version stamp — bump apps/web/src/version.js on each release (see CLAUDE.md).
          Shows version + update date/time in BOTH states (compact two-line when collapsed). */}
      <div title={`Shamash Pro · v${APP_VERSION} · updated ${formatVersionStamp()}`} style={{
        width: "100%", flexShrink: 0,
        marginTop: px(8), paddingTop: px(7),
        borderTop: `1px solid ${C.divider}`,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
      }}>
        <span style={{
          fontSize: 9, fontWeight: 700,
          letterSpacing: displayOpen ? 1.4 : 0.4,
          color: C.faint, fontFamily: NC_FONT_STACK,
          fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
        }}>v{APP_VERSION}</span>
        {displayOpen ? (
          <span style={{
            fontSize: 8.5, color: C.faint, opacity: 0.7,
            fontFamily: NC_FONT_STACK, letterSpacing: 0.2, whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
          }}>{formatVersionStamp()}</span>
        ) : (() => {
          const s = versionStampShort();
          const lineStyle = {
            fontSize: 7.5, color: C.faint, opacity: 0.7, lineHeight: 1.15,
            fontFamily: NC_FONT_STACK, letterSpacing: 0.1, whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
          };
          return (
            <>
              <span style={lineStyle}>{s.date}</span>
              {s.time && <span style={lineStyle}>{s.time}</span>}
            </>
          );
        })()}
      </div>
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
        transition: `left ${DUR.base} ${EASE.standard}`,
      }} />
    )}
    </>
  );
}

export { AppSuiteChrome };
