import React from 'react';
import { createComponent } from '@lit/react';
import { MdFab } from '@material/web/fab/fab.js';
import { MdOutlinedIconButton } from '@material/web/iconbutton/outlined-icon-button.js';
import { MdDivider } from '@material/web/divider/divider.js';
import { MdRipple } from '@material/web/ripple/ripple.js';
import { MdOutlinedSegmentedButton } from '@material/web/labs/segmentedbutton/outlined-segmented-button.js';
import { MdOutlinedSegmentedButtonSet } from '@material/web/labs/segmentedbuttonset/outlined-segmented-button-set.js';
import { cleanTheme, DUR, EASE, NC_FONT_STACK, NC_TYPE, RADIUS, suiteIcon } from '../ui-tokens.jsx';
import { APP_VERSION, formatVersionStamp, versionStampShort } from '../../version.js';
import { textOnColor } from '../../01-core.js';
import { MdFilterChip } from '@material/web/chips/filter-chip.js';
import { subscribeOwner, setPreferredHost, ownerIsLive, HOST_LABEL } from '../phone-host-control.js';
import { preferredHostId } from '../phone-link.js';

// Real M3 web components — Google's official implementations, not hand-coded lookalikes.
// md-navigation-rail is not yet in @material/web v2.4; nav items stay hand-coded with
// <md-ripple> for M3-quality press feedback. Swap in md-navigation-rail-item when shipped.
const Fab = createComponent({ react: React, tagName: 'md-fab', elementClass: MdFab });
const OutlinedIconButton = createComponent({ react: React, tagName: 'md-outlined-icon-button', elementClass: MdOutlinedIconButton });
const Divider = createComponent({ react: React, tagName: 'md-divider', elementClass: MdDivider });
const Ripple = createComponent({ react: React, tagName: 'md-ripple', elementClass: MdRipple });
// Segmented button (labs, single-select): M3's control for 2–5 mutually exclusive
// choices — the right semantics for picking WHICH host holds the phone, where the
// old md-switch wrongly read as an on/off state.
const SegmentedButtonSet = createComponent({
  react: React, tagName: 'md-outlined-segmented-button-set', elementClass: MdOutlinedSegmentedButtonSet,
  events: { onSelection: 'segmented-button-set-selection' },
});
const SegmentedButton = createComponent({ react: React, tagName: 'md-outlined-segmented-button', elementClass: MdOutlinedSegmentedButton });
const FilterChip = createComponent({ react: React, tagName: 'md-filter-chip', elementClass: MdFilterChip });

// Cross-component signaling for the Bug Log rail item, without prop-drilling
// through App.jsx (which already owns a large prop surface). BugLog.jsx
// broadcasts its live unresolved count on this event; this rail button
// dispatches the open request back the same way.
const BUGLOG_OPEN_EVENT = 'shamash-buglog:open';
const BUGLOG_COUNT_EVENT = 'shamash-buglog:count';

function AppSuiteChrome({ T, active, onSelect, open, onToggle, onRecord, onMoreActions, topOffset = 0, forceCompact = false, clockTime = null, onSettings, features = {} }) {
  const [bugLogCount, setBugLogCount] = React.useState(0);
  React.useEffect(() => {
    const onCount = (e) => setBugLogCount(e.detail?.unresolved || 0);
    window.addEventListener(BUGLOG_COUNT_EVENT, onCount);
    return () => window.removeEventListener(BUGLOG_COUNT_EVENT, onCount);
  }, []);

  // Phone-host control: which link the owner wants feeding the phone. Three
  // manual lanes — iPad (bridge app), ActiveTab (Galaxy Tab Active, the daily
  // primary), PC (DeskPhone, e.g. for call audio) — plus Auto, where the hosts
  // arbitrate among themselves and the strongest live connection wins
  // (phone-link.js chooseAutoHost — same scoring the native hosts run).
  const [phoneHost, setPhoneHost] = React.useState({ preferred: 'tablet', host: '', connected: false, present: false, hosts: {} });
  React.useEffect(() => {
    const unsub = subscribeOwner(setPhoneHost);
    return () => { try { unsub && unsub(); } catch (_) {} };
  }, []);
  const autoHost = phoneHost.preferred === 'auto';
  const preferredId = preferredHostId(phoneHost.preferred);   // '' in auto mode
  // Honest toggle feedback (owner ticket: "toggle seems to do nothing" / "it
  // just stays hooked up to pc"): the label shows which host ACTUALLY holds the
  // phone right now, and while the owner's choice hasn't landed yet it reads
  // "Handing to …" so the flip visibly did something. Falls back to the
  // preference alone until a rebuilt host writes the heartbeat doc.
  const preferredLabel = autoHost ? 'Auto' : (HOST_LABEL[preferredId] || HOST_LABEL.android);
  const actualHostId = phoneHost.present && ownerIsLive(phoneHost) ? phoneHost.host : '';
  const actualHostLabel = HOST_LABEL[actualHostId] || '';
  const hostSwitchPending = !autoHost && !!actualHostId && actualHostId !== preferredId;
  // While a switch is pending, the SOLID highlight stays on the device that
  // actually holds the phone; the requested device BLINKS until the new host's
  // heartbeat confirms the handover (owner spec 7/12). No pending switch ⇒
  // solid follows the preference (or, in auto mode, the live holder).
  const solidId = hostSwitchPending ? actualHostId : (autoHost ? actualHostId : preferredId);
  const hostBlinkStyle = { animation: 'nc-host-blink 1.1s ease-in-out infinite' };
  const phoneHostLabel = hostSwitchPending
    ? `Handing to ${preferredLabel}…`
    : autoHost
      ? `Phone: Auto${actualHostLabel ? ` · ${actualHostLabel}` : ''}`
      : `Phone: ${actualHostLabel || preferredLabel}`;
  const phoneHostTitle = hostSwitchPending
    ? `Waiting for the ${preferredLabel} to pick up the phone — the ${actualHostLabel} still holds it`
    : autoHost
      ? `Auto-finder is on — the strongest live link holds the phone${actualHostLabel ? ` (currently the ${actualHostLabel})` : ''}. Tap a device to pin it manually.`
      : `Phone link via ${actualHostLabel || preferredLabel} — pick another device to hand it over, or Auto to always use the strongest link`;
  // Collapsed rail: one icon button cycles auto → ActiveTab → PC → iPad.
  const CYCLE = ['auto', 'tablet', 'pc', 'ipad'];
  const HOST_MODE_ICON = { auto: 'auto_mode', tablet: 'tablet_android', pc: 'computer', ipad: 'tablet_mac' };
  const flipHost = () => {
    const idx = CYCLE.indexOf(phoneHost.preferred);
    setPreferredHost(CYCLE[(idx + 1) % CYCLE.length]);
  };

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
  // Expanded: "2:56 AM" — Collapsed: "2:56a" (no space, single letter) to fit 44px
  const railTimeFull = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const railTime = displayOpen
    ? railTimeFull
    : railTimeFull.replace(/\s*AM$/i, 'a').replace(/\s*PM$/i, 'p');
  const railDate = now.toLocaleDateString([], { month: "short", day: "numeric" });
  // Hebrew date with gematria day letters (ח not 8). Special-cases: 15=טו, 16=טז.
  const hebrewDate = (() => {
    try {
      const dayN = parseInt(new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric' }).format(now), 10);
      const month = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', { month: 'long' }).format(now);
      const ones = ['','א','ב','ג','ד','ה','ו','ז','ח','ט'];
      const tens = ['','י','כ','ל'];
      const letter = dayN === 15 ? 'טו' : dayN === 16 ? 'טז'
        : (tens[Math.floor(dayN / 10)] || '') + (ones[dayN % 10] || '');
      return `${letter} ${month}`;
    } catch (_) { return ''; }
  })();

  const ncActive = active === "nervecenter";

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

      {/* NerveCenter — hub */}
      <button onClick={() => onSelect("nervecenter")} title="NerveCenter" aria-label="NerveCenter"
        style={navBtn(ncActive, { marginBottom: px(4), fontSize: Math.max(12, px(15)) })}>
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

      {/* Bug Log — utility item; badge mirrors BugLog's live unresolved count */}
      <button onClick={() => window.dispatchEvent(new CustomEvent(BUGLOG_OPEN_EVENT))} title="Bug Log" aria-label="Bug Log" style={navBtn(false)}>
        <Ripple />
        <span style={{ position: "relative", display: "inline-flex" }}>
          {suiteIcon("bug_report", ic(24))}
          {bugLogCount > 0 && (
            <span style={{
              position: "absolute", top: -4, right: -6, minWidth: 14, height: 14, padding: "0 3px",
              borderRadius: RADIUS.pill, background: C.danger, color: "#fff",
              fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
            }}>{bugLogCount}</span>
          )}
        </span>
        {displayOpen && "Bug Log"}
      </button>

      {/* Phone link — which lane feeds the phone: iPad (bridge), ActiveTab
          (Galaxy Tab Active — daily primary), or PC (DeskPhone, call audio);
          plus the auto-finder chip, where the strongest live connection wins
          and the hosts hand off among themselves. A CHOICE between lanes, so
          this is M3's segmented button (single-select), not a switch. Real
          labs md-outlined-segmented-button-set when the rail is open, sized to
          rail density via the official tokens; a tap-to-cycle icon when
          collapsed. The caption above still reflects the ACTUAL holder and
          shows "Handing to …" until the hosts complete the Bluetooth handoff. */}
      {displayOpen ? (
        <div title={phoneHostTitle} style={{ width: '100%', padding: `${GAP}px 2px`, boxSizing: 'border-box', flexShrink: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '0 2px 3px',
          }}>
            <span style={{
              flex: 1, minWidth: 0, fontSize: Math.max(10, px(11)), color: C.muted, fontFamily: NC_FONT_STACK,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontStyle: hostSwitchPending ? 'italic' : 'normal',
            }}>{phoneHostLabel}</span>
            <FilterChip
              label="Auto"
              selected={autoHost}
              title="Auto-finder: auto-connect and auto-switch to the strongest link"
              onClick={() => setPreferredHost(autoHost ? 'tablet' : 'auto')}
              style={{
                flexShrink: 0,
                '--md-filter-chip-container-height': `${Math.max(20, px(22))}px`,
                '--md-filter-chip-label-text-font': NC_FONT_STACK,
                '--md-filter-chip-label-text-size': `${Math.max(10, px(11))}px`,
                '--md-filter-chip-outline-color': C.divider,
              }}
            />
          </div>
          <SegmentedButtonSet
            onSelection={(e) => {
              const idx = e?.detail?.index;
              // Any manual pick pins that lane (turning the auto-finder off).
              if (idx === 0) setPreferredHost('ipad');
              else if (idx === 1) setPreferredHost('tablet');
              else if (idx === 2) setPreferredHost('pc');
            }}
            aria-label="Which device hosts the phone link"
            style={{
              width: '100%',
              '--md-outlined-segmented-button-container-height': `${Math.max(30, px(32))}px`,
              '--md-outlined-segmented-button-label-text-font': NC_FONT_STACK,
              '--md-outlined-segmented-button-label-text-size': `${Math.max(10, px(11))}px`,
              '--md-outlined-segmented-button-spacing-leading-space': '6px',
              '--md-outlined-segmented-button-spacing-trailing-space': '6px',
              '--md-outlined-segmented-button-outline-color': C.divider,
              '--md-outlined-segmented-button-selected-container-color': C.hover,
              '--md-outlined-segmented-button-selected-label-text-color': C.text,
              '--md-outlined-segmented-button-unselected-label-text-color': C.muted,
              '--md-outlined-segmented-button-selected-icon-color': C.accent,
            }}>
            <SegmentedButton selected={solidId === 'ios'} label="iPad" title="iPad bridge feeds the phone link"
              style={hostSwitchPending && preferredId === 'ios' ? hostBlinkStyle : undefined} />
            <SegmentedButton selected={solidId === 'android'} label="ActiveTab" title="Galaxy Tab Active holds the phone"
              style={hostSwitchPending && preferredId === 'android' ? hostBlinkStyle : undefined} />
            <SegmentedButton selected={solidId === 'windows'} label="PC" title="PC holds the phone (call audio)"
              style={hostSwitchPending && preferredId === 'windows' ? hostBlinkStyle : undefined} />
          </SegmentedButtonSet>
        </div>
      ) : (
        <button onClick={flipHost} title={phoneHostTitle} aria-label="Switch phone link"
          style={navBtn(false)}>
          <Ripple />
          {/* Requested-mode icon blinks until the handover is confirmed. */}
          <span style={hostSwitchPending ? hostBlinkStyle : undefined}>
            {suiteIcon(HOST_MODE_ICON[phoneHost.preferred] || 'tablet_android', ic(24))}
          </span>
        </button>
      )}

      {/* Reload — always-reachable refresh for PWA (no browser address bar in standalone mode).
          index.html is served no-cache so a plain reload fetches the latest hashed bundle. */}
      <button onClick={() => { try { window.location.reload(); } catch (_) {} }} title="Reload — get the latest version" aria-label="Reload"
        style={navBtn(false, { color: C.faint })}>
        <Ripple />
        {suiteIcon("refresh", ic(24))}
        {displayOpen && "Reload"}
      </button>

      {/* Persistent clock — always shows time, English date, and Hebrew date */}
      <div title={now.toLocaleString()} style={{
        width: displayOpen ? "100%" : 44,
        minHeight: displayOpen ? px(62) : Math.max(62, px(74)),
        borderRadius: displayOpen ? RADIUS.sm : RADIUS.pill,
        border: `1px solid ${C.divider}`, background: C.bgSoft, color: C.text,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        marginBottom: px(6), fontFamily: NC_FONT_STACK, fontVariantNumeric: "tabular-nums",
        overflow: "hidden", flexShrink: 0, padding: displayOpen ? 0 : "6px 2px",
        boxSizing: "border-box",
      }}>
        <span style={{ fontSize: displayOpen ? Math.max(13, px(18)) : Math.max(10, px(12)), fontWeight: 600, lineHeight: 1.1, whiteSpace: "nowrap" }}>{railTime}</span>
        {s > 0.55 && <span style={{ fontSize: displayOpen ? NC_TYPE.small : 9, color: C.muted, marginTop: displayOpen ? 3 : 2, lineHeight: 1, whiteSpace: "nowrap" }}>{railDate}</span>}
        {hebrewDate && s > 0.55 && <span style={{ fontSize: 9, color: C.faint, marginTop: 2, lineHeight: 1, whiteSpace: "nowrap", direction: "rtl" }}>{hebrewDate}</span>}
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

    </>
  );
}

export { AppSuiteChrome };
