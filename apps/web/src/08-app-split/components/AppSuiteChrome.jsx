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
import { subscribeOwner, setPreferredHost, ownerIsLive, HOST_LABEL, OWNER_LIVE_WINDOW_MS } from '../phone-host-control.js';
import { preferredHostId, HANDOFF_GRACE_MS } from '../phone-link.js';
import { subscribeAiLaneStatus } from '../ai-lane-status.js';

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

function AppSuiteChrome({ T, active, onSelect, open, onToggle, onRecord, topOffset = 0, forceCompact = false, clockTime = null, onSettings, features = {}, onEnsurePcHost, onOpenFocusSuggest }) {
  const [bugLogCount, setBugLogCount] = React.useState(0);
  React.useEffect(() => {
    const onCount = (e) => setBugLogCount(e.detail?.unresolved || 0);
    window.addEventListener(BUGLOG_COUNT_EVENT, onCount);
    return () => window.removeEventListener(BUGLOG_COUNT_EVENT, onCount);
  }, []);

  // Phone-host control: which link the owner wants feeding the phone. Two
  // manual lanes — ActiveTab (Galaxy Tab Active, the daily primary) and PC
  // (DeskPhone, e.g. for call audio) — plus Auto, where the hosts arbitrate
  // among themselves and the strongest live connection wins (phone-link.js
  // chooseAutoHost — same scoring the native hosts run). The iPad lane was
  // retired 7/13 (owner ticket): iPadOS can't hold the BT link itself and the
  // bridge-feeder never shipped, so the segment was dead weight in the rail.
  const [phoneHost, setPhoneHost] = React.useState({ preferred: 'tablet', host: '', connected: false, present: false, hosts: {} });
  React.useEffect(() => {
    const unsub = subscribeOwner(setPhoneHost);
    return () => { try { unsub && unsub(); } catch (_) {} };
  }, []);

  // Live "which AI lane is answering requests" chip — Gemini primary is the quiet
  // default; overflow/Claude only ever show up here when Gemini's own quota is
  // genuinely exhausted (_ai-core.cjs recordAiLaneEvent).
  const [aiLane, setAiLane] = React.useState({ currentLane: 'gemini:primary', label: 'Gemini', recent: [] });
  const [aiLanePopoverOpen, setAiLanePopoverOpen] = React.useState(false);
  React.useEffect(() => {
    const unsub = subscribeAiLaneStatus(setAiLane);
    return () => { try { unsub && unsub(); } catch (_) {} };
  }, []);
  // Owner ticket 7/15: picking PC (or Auto, where PC is a candidate host) used to
  // just fail silently until the owner noticed DeskPhone wasn't running — nothing
  // ever probed for that or launched it. Whenever the preference wants PC in play
  // and the PC's presence heartbeat (hosts.windows) isn't fresh, ask App.jsx's
  // bringDeskPhoneForward to check the local loopback and fire deskphone://open if
  // needed. Runs for manual "pc" picks AND "auto" (since auto can't ever select a
  // host that never beacons), and re-fires on every owner snapshot so a slow
  // DeskPhone launch gets retried instead of only checked once.
  React.useEffect(() => {
    if (!onEnsurePcHost) return;
    const wantsPc = phoneHost.preferred === 'pc' || phoneHost.preferred === 'auto';
    if (!wantsPc) return;
    const pcInfo = phoneHost.hosts?.windows;
    const pcBeaconLive = pcInfo?.t && (Date.now() - pcInfo.t) < OWNER_LIVE_WINDOW_MS;
    if (!pcBeaconLive) onEnsurePcHost();
  }, [phoneHost.preferred, phoneHost.hosts, onEnsurePcHost]);
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
  // The releasing host drops its heartbeat BEFORE the taking host confirms
  // (same gap phone-link.js's `handover` state exists for) — during that gap
  // actualHostId goes empty, and without this grace window the rail wrongly
  // read that as "already switched" (no blink, no pending pill) instead of
  // staying pending (owner ticket 7/14: "doesn't stay as pending... instead
  // says dropped connection... till it blinks on"). rawHostId ignores
  // liveness so the previous holder still anchors the solid highlight
  // through the gap instead of jumping straight to the unconfirmed target.
  const rawHostId = phoneHost.host || '';
  const preferredAtMs = Number(phoneHost.preferredAtMs) || 0;
  const inHandoffGrace = preferredAtMs > 0 && (Date.now() - preferredAtMs) < HANDOFF_GRACE_MS;
  const hostSwitchPending = !autoHost && rawHostId !== preferredId && (!!actualHostId || inHandoffGrace);
  // While a switch is pending, the SOLID highlight stays on the device that
  // actually holds the phone; the requested device BLINKS until the new host's
  // heartbeat confirms the handover (owner spec 7/12). No pending switch ⇒
  // solid follows the preference (or, in auto mode, the live holder).
  const solidId = hostSwitchPending ? (actualHostId || rawHostId || preferredId) : (autoHost ? actualHostId : preferredId);
  const hostBlinkStyle = { animation: 'nc-host-blink 1.1s ease-in-out infinite' };
  // Auto-mode honesty (owner ticket 7/13: "auto should show state — searching,
  // establishing with pc, etc."): when no host holds the link yet, say what the
  // finder is actually doing instead of a bare "Auto". A host beaconing presence
  // but not yet connected reads "establishing"; total silence reads "searching".
  const beaconingId = Object.entries(phoneHost.hosts || {})
    .filter(([, h]) => h.t && (Date.now() - h.t) < OWNER_LIVE_WINDOW_MS)
    .sort((a, b) => (b[1].connected - a[1].connected) || (b[1].quality - a[1].quality))
    .map(([id]) => id)[0] || '';
  const autoStatus = actualHostLabel
    ? `Auto · ${actualHostLabel}`
    : beaconingId
      ? `Auto — establishing with ${HOST_LABEL[beaconingId] || 'device'}…`
      : 'Auto — searching…';
  const phoneHostLabel = hostSwitchPending
    ? `Handing to ${preferredLabel}…`
    : autoHost
      ? autoStatus
      : `Phone: ${actualHostLabel || preferredLabel}`;
  const priorHostLabel = actualHostLabel || HOST_LABEL[rawHostId] || '';
  const phoneHostTitle = hostSwitchPending
    ? `Waiting for the ${preferredLabel} to pick up the phone${priorHostLabel ? ` — the ${priorHostLabel} still holds it` : ''}`
    : autoHost
      ? `Auto-finder is on — the strongest live link holds the phone${actualHostLabel ? ` (currently the ${actualHostLabel})` : ''}. Tap a device to pin it manually.`
      : `Phone link via ${actualHostLabel || preferredLabel} — pick another device to hand it over, or Auto to always use the strongest link`;
  // Collapsed rail: one icon button cycles auto → ActiveTab → PC.
  const CYCLE = ['auto', 'tablet', 'pc'];
  const HOST_MODE_ICON = { auto: 'auto_mode', tablet: 'tablet_android', pc: 'computer' };
  const flipHost = () => {
    // indexOf(-1) + 1 = 0, so a legacy 'ipad' preference safely re-enters at 'auto'.
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

      {/* Focus — owner ticket: a clean rail function that looks at everything on the
          plate + the calendar and suggests exactly three good things to do now,
          positive-only, no edit/retry. */}
      {onOpenFocusSuggest && (
        <button onClick={onOpenFocusSuggest} title="Focus suggestions" aria-label="Focus suggestions" style={navBtn(false)}>
          <Ripple />
          {suiteIcon("auto_awesome", ic(24))}
          {displayOpen && "Focus"}
        </button>
      )}

      {/* Settings — M3 bottom anchor for utility cluster */}
      <button onClick={onSettings} title="Settings" aria-label="Settings" style={navBtn(false)}>
        <Ripple />
        {suiteIcon("settings", ic(24))}
        {displayOpen && "Settings"}
      </button>

      {/* More Actions retired (owner ticket 7/13: "we can officially retire more
          actions, i never use it") — every action it held lives on its own surface. */}

      {/* AI lane status — owner ticket: make the Gemini-overflow/Claude fallback
          visible, not just automatic. Quiet dot on Gemini primary; amber on Gemini
          overflow; red once it's fully fallen through to Claude. Click opens the
          recent-switch history, same popover pattern as the account switcher. */}
      {(() => {
        const laneDot = aiLane.currentLane === 'claude:fallback' ? C.danger
          : aiLane.currentLane === 'gemini:overflow-01' ? C.warning
          : null; // primary lane: no dot, nothing to draw attention to
        return (
          <div style={{ position: 'relative', width: '100%', flexShrink: 0 }}>
            <button onClick={() => setAiLanePopoverOpen(p => !p)} title={`AI: ${aiLane.label}`} aria-label={`AI lane: ${aiLane.label}`} style={navBtn(aiLanePopoverOpen)}>
              <Ripple />
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                {suiteIcon('bolt', ic(24))}
                {laneDot && (
                  <span style={{ position: 'absolute', top: -1, right: -1, width: 8, height: 8, borderRadius: RADIUS.pill, background: laneDot, boxShadow: `0 0 0 2px ${C.bg}` }} />
                )}
              </span>
              {displayOpen && aiLane.label}
            </button>
            {aiLanePopoverOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 9100 }} onClick={() => setAiLanePopoverOpen(false)} />
                <div style={{ position: 'absolute', left: displayOpen ? 0 : '100%', bottom: 0, marginLeft: displayOpen ? 0 : 8, zIndex: 9101, background: C.bg, border: `1px solid ${C.divider}`, borderRadius: RADIUS.sm, minWidth: 240, boxShadow: '0 4px 20px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, letterSpacing: 1.5, textTransform: 'uppercase', fontFamily: NC_FONT_STACK, padding: '8px 12px 4px' }}>AI lane — currently {aiLane.label}</div>
                  {aiLane.recent.length === 0 ? (
                    <div style={{ padding: '9px 12px 12px', fontSize: NC_TYPE.meta, color: C.faint, fontFamily: NC_FONT_STACK }}>No fallovers yet — running on Gemini primary.</div>
                  ) : (
                    [...aiLane.recent].reverse().map((event, i) => (
                      <div key={i} style={{ padding: '7px 12px', borderTop: `1px solid ${C.divider}` }}>
                        <div style={{ fontSize: NC_TYPE.meta, color: C.text, fontFamily: NC_FONT_STACK, fontWeight: 600 }}>{event.label}</div>
                        <div style={{ fontSize: 10, color: C.faint, fontFamily: NC_FONT_STACK, marginTop: 1 }}>
                          {new Date(event.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          {event.reason ? ` · ${event.reason}` : ''}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        );
      })()}

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

      {/* Phone link — which lane feeds the phone: ActiveTab (Galaxy Tab
          Active — daily primary) or PC (DeskPhone, call audio); plus the
          auto-finder chip, where the strongest live connection wins and the
          hosts hand off among themselves. A CHOICE between lanes, so this is
          M3's segmented button (single-select), not a switch. Real labs
          md-outlined-segmented-button-set when the rail is open, sized to
          rail density via the official tokens; a tap-to-cycle icon when
          collapsed. The caption above reflects the ACTUAL holder ("Handing
          to …" until the hosts complete the Bluetooth handoff; in Auto it
          narrates searching/establishing/connected). The holder's segment
          carries a state icon instead of the stock checkmark: auto_mode when
          the auto-finder picked it, a pin when the owner pinned it manually. */}
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
              if (idx === 0) setPreferredHost('tablet');
              else if (idx === 1) setPreferredHost('pc');
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
            {['android', 'windows'].map(id => {
              // State icon in place of the stock checkmark: the segment that
              // holds (or is pinned to hold) the phone shows HOW it got the
              // job — auto-finder (auto_mode) vs a manual pin (push_pin).
              const showIcon = autoHost ? actualHostId === id : preferredId === id;
              return (
                <SegmentedButton key={id} noCheckmark
                  selected={solidId === id}
                  label={id === 'android' ? 'ActiveTab' : 'PC'}
                  title={id === 'android'
                    ? 'Galaxy Tab Active holds the phone'
                    : 'PC holds the phone (call audio)'}
                  style={hostSwitchPending && preferredId === id ? hostBlinkStyle : undefined}>
                  {showIcon && (
                    <span slot="icon" style={{ display: 'inline-flex', color: C.accent }}>
                      {suiteIcon(autoHost ? 'auto_mode' : 'push_pin', 14)}
                    </span>
                  )}
                </SegmentedButton>
              );
            })}
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
