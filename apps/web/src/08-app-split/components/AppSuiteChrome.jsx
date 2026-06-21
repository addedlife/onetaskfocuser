import React from 'react';
import { createComponent } from '@lit/react';
import { MdFab } from '@material/web/fab/fab.js';
import { MdOutlinedIconButton } from '@material/web/iconbutton/outlined-icon-button.js';
import { MdDivider } from '@material/web/divider/divider.js';
import { MdRipple } from '@material/web/ripple/ripple.js';
import { cleanTheme, DUR, EASE, NC_FONT_STACK, NC_TYPE, RADIUS, suiteIcon } from '../ui-tokens.jsx';
import { APP_VERSION, formatVersionStamp, versionStampShort } from '../../version.js';
import { textOnColor } from '../../01-core.js';

// Real M3 web components — Google's official implementations, not hand-coded lookalikes.
// md-navigation-rail is not yet in @material/web v2.4; nav items stay hand-coded with
// <md-ripple> for M3-quality press feedback. Swap in md-navigation-rail-item when shipped.
const Fab = createComponent({ react: React, tagName: 'md-fab', elementClass: MdFab });
const OutlinedIconButton = createComponent({ react: React, tagName: 'md-outlined-icon-button', elementClass: MdOutlinedIconButton });
const Divider = createComponent({ react: React, tagName: 'md-divider', elementClass: MdDivider });
const Ripple = createComponent({ react: React, tagName: 'md-ripple', elementClass: MdRipple });

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

  // Height-aware scale: shrink rail to fit short (landscape-phone) viewports.
  const [winH, setWinH] = React.useState(() => (typeof window !== "undefined" ? window.innerHeight : 800));
  React.useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const on = () => setWinH(window.innerHeight);
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => { window.removeEventListener("resize", on); window.removeEventListener("orientationchange", on); };
  }, []);
  const railH = Math.max(240, winH - topOffset);
  const NATURAL = 684;
  const s = Math.max(0.5, Math.min(1, railH / NATURAL));
  const px = v => Math.round(v * s);
  const ic = v => Math.max(13, Math.round(v * s));
  const BTN_H = Math.max(40, px(40));  // M3 minimum touch target: 40dp
  const FZ = Math.max(11, px(14));
  const GAP = Math.max(2, px(4));

  const rawNow = clockTime instanceof Date ? clockTime : new Date(clockTime || Date.now());
  const now = Number.isFinite(rawNow.getTime()) ? rawNow : new Date();
  const railTime = displayOpen
    ? now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const railDate = now.toLocaleDateString([], { month: "short", day: "numeric" });

  const ncActive = active === "nervecenter";
  const arrowLeft = W - rightPad;

  // Bridge: map app theme T into M3 CSS custom properties so web components pick up the theme.
  const fabIconColor = textOnColor(C.accent);
  const mdVars = {
    '--md-fab-container-color': C.accent,
    '--md-fab-icon-color': fabIconColor,
    '--md-fab-label-text-color': fabIconColor,
    '--md-fab-hover-state-layer-color': C.accent,
    '--md-fab-hover-state-layer-opacity': '0.08',
    '--md-outlined-icon-button-icon-color': C.faint,
    '--md-outlined-icon-button-outline-color': C.divider,
    '--md-outlined-icon-button-hover-state-layer-color': C.text,
    '--md-outlined-icon-button-hover-state-layer-opacity': '0.08',
    '--md-divider-color': C.divider,
  };

  // Shared button style for nav destinations and utility items.
  // position:relative + overflow:hidden are required for MdRipple containment.
  const navBtn = (isActive = false, extra = {}) => ({
    position: 'relative', overflow: 'hidden',
    height: BTN_H, padding: displayOpen ? "0 12px" : "0",
    borderRadius: RADIUS.pill, cursor: "pointer", border: "none",
    background: isActive ? C.hover : "transparent",
    color: isActive ? C.text : C.muted,
    fontFamily: NC_FONT_STACK, fontWeight: 500, fontSize: FZ,
    display: "flex", alignItems: "center",
    gap: displayOpen ? 12 : 0, justifyContent: displayOpen ? "flex-start" : "center",
    width: "100%", whiteSpace: "nowrap", flexShrink: 0,
    ...extra,
  });

  return (
    <>
    <div
      className="nc-rail"
      role="navigation"
      aria-label="Main navigation"
      style={{
        position: "fixed", left: 0, top: topOffset, bottom: 0, width: W, zIndex: 8600,
        display: "flex", flexDirection: "column", alignItems: displayOpen ? "stretch" : "center",
        boxSizing: "border-box", padding: `${px(18)}px ${displayOpen ? 12 : 10}px ${px(16)}px`,
        gap: GAP, background: C.bg,
        backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
        borderRight: `1px solid ${C.divider}`,
        transition: `width ${DUR.base} ${EASE.standard}`,
        overflowY: "auto", overflowX: "hidden",
        ...mdVars,
      }}>

      {/* Record — real M3 FAB. Primary cross-app action lives at top of rail per M3 spec.
          Extended FAB (icon + label) when rail is open; standard FAB (icon only) when collapsed. */}
      <Fab
        label={displayOpen ? "Record" : ""}
        aria-label="Record — tasks, shailos, notes, got-backs"
        onClick={onRecord}
        style={{
          width: displayOpen ? "100%" : "56px",
          marginBottom: `${px(16)}px`,
          flexShrink: 0,
          alignSelf: displayOpen ? "stretch" : "center",
        }}>
        <span slot="icon" className="material-symbols-rounded" style={{ fontSize: 24 }}>mic</span>
      </Fab>

      {/* NerveCenter — hub, styled distinctively; right side flattens when active for arrow cap */}
      <button onClick={() => onSelect("nervecenter")} title="NerveCenter" aria-label="NerveCenter"
        style={navBtn(ncActive, {
          marginBottom: px(4), fontSize: Math.max(12, px(15)),
          ...(ncActive ? { borderRadius: `${RADIUS.pill} 0 0 ${RADIUS.pill}` } : {}),
        })}>
        <Ripple />
        {suiteIcon("hub", ic(24))}
        {displayOpen && "NerveCenter"}
      </button>

      {/* Main destinations */}
      {mainApps.map(app => (
        <button key={app.id} onClick={() => onSelect(app.id)} title={app.label} aria-label={app.label}
          style={navBtn(active === app.id)}>
          <Ripple />
          {suiteIcon(app.icon, ic(24))}
          {displayOpen && app.label}
        </button>
      ))}

      {/* Experimental section */}
      <div style={{ marginTop: px(10), marginBottom: px(2), flexShrink: 0 }}>
        <Divider />
        {displayOpen && s > 0.72 && (
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: C.faint, fontFamily: NC_FONT_STACK, padding: "4px 14px 4px" }}>Experimental</div>
        )}
      </div>

      {experimentalApps.map(app => (
        <button key={app.id} onClick={() => onSelect(app.id)} title={`${app.label} (experimental)`} aria-label={`${app.label} (experimental)`}
          style={navBtn(active === app.id)}>
          <Ripple />
          {suiteIcon(app.icon, ic(24))}
          {displayOpen && app.label}
        </button>
      ))}

      {/* Spacer — pushes utility cluster to bottom (M3: destinations above, utilities below) */}
      <div style={{ flex: 1 }} />

      {/* Settings — M3 bottom anchor for utility cluster */}
      <button onClick={onSettings} title="Settings" aria-label="Settings" style={navBtn(false)}>
        <Ripple />
        {suiteIcon("settings", ic(24))}
        {displayOpen && "Settings"}
      </button>

      {/* More Actions */}
      <button onClick={onMoreActions} title="More Actions" aria-label="More Actions" style={navBtn(false, { color: C.accent })}>
        <Ripple />
        {suiteIcon("apps", ic(24))}
        {displayOpen && "More Actions"}
      </button>

      {/* Reload — always-reachable refresh for PWA (no browser address bar in standalone mode).
          index.html is served no-cache so a plain reload fetches the latest hashed bundle. */}
      <button onClick={() => { try { window.location.reload(); } catch (_) {} }} title="Reload — get the latest version" aria-label="Reload"
        style={navBtn(false, { color: C.faint })}>
        <Ripple />
        {suiteIcon("refresh", ic(24))}
        {displayOpen && "Reload"}
      </button>

      {/* Persistent clock */}
      <div title={now.toLocaleString()} style={{
        width: displayOpen ? "100%" : 44,
        minHeight: displayOpen ? px(50) : Math.max(34, px(44)),
        borderRadius: displayOpen ? RADIUS.sm : RADIUS.pill,
        border: `1px solid ${C.divider}`, background: C.bgSoft, color: C.text,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        marginBottom: px(6), fontFamily: NC_FONT_STACK, fontVariantNumeric: "tabular-nums",
        overflow: "hidden", flexShrink: 0,
      }}>
        <span style={{ fontSize: displayOpen ? Math.max(13, px(18)) : Math.max(11, px(13)), fontWeight: 600, lineHeight: 1.05, whiteSpace: "nowrap" }}>{railTime}</span>
        {displayOpen && s > 0.7 && <span style={{ fontSize: NC_TYPE.small, color: C.muted, marginTop: 3, lineHeight: 1 }}>{railDate}</span>}
      </div>

      {/* Collapse toggle — real M3 outlined icon button */}
      <OutlinedIconButton
        onClick={onToggle}
        title={displayOpen ? "Collapse sidebar" : "Expand sidebar"}
        aria-label={displayOpen ? "Collapse sidebar" : "Expand sidebar"}
        disabled={forceCompact}
        style={{ width: 40, height: Math.max(40, px(40)), opacity: forceCompact ? 0.38 : 1, alignSelf: "center", flexShrink: 0 }}>
        <span className="material-symbols-rounded" style={{ fontSize: ic(20) }}>
          {displayOpen ? "chevron_left" : "chevron_right"}
        </span>
      </OutlinedIconButton>

      {/* Version stamp */}
      <div title={`Shamash Pro · v${APP_VERSION} · updated ${formatVersionStamp()}`} style={{
        width: "100%", flexShrink: 0, marginTop: px(8), paddingTop: px(7),
        borderTop: `1px solid ${C.divider}`,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: displayOpen ? 1.4 : 0.4, color: C.faint, fontFamily: NC_FONT_STACK, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>v{APP_VERSION}</span>
        {displayOpen ? (
          <span style={{ fontSize: 10, color: C.faint, opacity: 0.7, fontFamily: NC_FONT_STACK, letterSpacing: 0.2, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{formatVersionStamp()}</span>
        ) : (() => {
          const sv = versionStampShort();
          const ls = { fontSize: 10, color: C.faint, opacity: 0.7, lineHeight: 1.15, fontFamily: NC_FONT_STACK, letterSpacing: 0.1, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
          return (<><span style={ls}>{sv.date}</span>{sv.time && <span style={ls}>{sv.time}</span>}</>);
        })()}
      </div>
    </div>

    {/* Arrow cap — flat left face aligns with NerveCenter button's right edge; pokes into NerveCenter pane. */}
    {ncActive && (
      <div aria-hidden style={{
        position: "fixed", left: arrowLeft, top: topOffset + 18, zIndex: 8600,
        width: 0, height: 0,
        borderTop: "20px solid transparent", borderBottom: "20px solid transparent",
        borderLeft: `16px solid ${C.hover}`,
        pointerEvents: "none", transition: `left ${DUR.base} ${EASE.standard}`,
      }} />
    )}
    </>
  );
}

export { AppSuiteChrome };
