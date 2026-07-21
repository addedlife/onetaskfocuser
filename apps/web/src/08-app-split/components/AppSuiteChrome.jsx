import React from 'react';
import { createPortal } from 'react-dom';
import { createComponent } from '@lit/react';
import { MdFab } from '@material/web/fab/fab.js';
import { MdOutlinedIconButton } from '@material/web/iconbutton/outlined-icon-button.js';
import { MdDivider } from '@material/web/divider/divider.js';
import { MdRipple } from '@material/web/ripple/ripple.js';
import { MdTextButton } from '@material/web/button/text-button.js';
import { MdOutlinedSegmentedButton } from '@material/web/labs/segmentedbutton/outlined-segmented-button.js';
import { MdOutlinedSegmentedButtonSet } from '@material/web/labs/segmentedbuttonset/outlined-segmented-button-set.js';
import { MdDialog } from '@material/web/dialog/dialog.js';
import { MdIconButton } from '@material/web/iconbutton/icon-button.js';
import { cleanTheme, DUR, EASE, NC_FONT_STACK, NC_MONO_STACK, NC_TYPE, RADIUS, suiteIcon, M3_MIN_TARGET } from '../ui-tokens.jsx';
import { APP_VERSION, formatVersionStamp, versionStampShort } from '../../version.js';
import { Store, textOnColor } from '../../01-core.js';
import { MdFilterChip } from '@material/web/chips/filter-chip.js';
import { subscribeOwner, setPreferredHost, ownerIsLive, HOST_LABEL, OWNER_LIVE_WINDOW_MS } from '../phone-host-control.js';
import { preferredHostId, HANDOFF_GRACE_MS } from '../phone-link.js';
import { subscribeAiLaneStatus, subscribeAiLog } from '../ai-lane-status.js';
import { isMobilePhoneDevice } from './NerveCenterPhoneSurface.jsx';

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
const TextButton = createComponent({ react: React, tagName: 'md-text-button', elementClass: MdTextButton });
// Modal dialog for the pop-out AI live-log window (owner ticket 7/19: the 320px
// popover is too cramped to actually read prompts/responses — give it a real
// window, like the DeskPhone live log). `closed` fires after the M3 close
// animation so React state stays in sync however the dialog is dismissed
// (Escape, scrim click, or the Close button).
const Dialog = createComponent({
  react: React, tagName: 'md-dialog', elementClass: MdDialog,
  events: { onClosed: 'closed' },
});
const IconButton = createComponent({ react: React, tagName: 'md-icon-button', elementClass: MdIconButton });

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
  // genuinely exhausted (_ai-core.cjs recordAiLaneEvent). Also carries usage stats and
  // any leak alerts the AI call manager's heuristics flagged (recordAiUsage()).
  const [aiLane, setAiLane] = React.useState({ currentLane: 'gemini:primary', label: 'Gemini', recent: [], usage: { totalToday: 0, totalThisHour: 0, totalThisMonth: 0, spendTodayUsd: 0, spendMonthUsd: 0 }, leaks: [] });
  // Manual lane override (owner 7/19: "a quick manual prod button to switch lanes").
  // Stored in localStorage; callAIProxy in 01-core.js attaches it to every request as a
  // server-side PREFERENCE (chosen lane tried first, others remain fallbacks). Choosing
  // any lane also clears the client circuit-breaker cooldown so the prod takes effect
  // immediately instead of waiting out a stale 15-min pause.
  const [aiLanePref, setAiLanePrefState] = React.useState(() => {
    try { return localStorage.getItem('shamash_ai_lane_pref') || ''; } catch (_) { return ''; }
  });
  const setAiLanePref = (pref) => {
    setAiLanePrefState(pref);
    try {
      if (pref) localStorage.setItem('shamash_ai_lane_pref', pref);
      else localStorage.removeItem('shamash_ai_lane_pref');
      localStorage.removeItem('shamash_ai_proxy_cooldown_until');
    } catch (_) {}
  };
  const [aiLanePopoverOpen, setAiLanePopoverOpen] = React.useState(false);
  // Collapsible popover sections (owner ticket yLg0L3HT: the card gets long — fold the
  // detail sections). Leaks start open only because an unseen leak is worth attention.
  const [aiSectOpen, setAiSectOpen] = React.useState({ leaks: true, archived: false, fallovers: false, livelog: false });
  // Live AI call log (owner ticket 3I7vYdFo): the real prompt/response/model/tokens of
  // recent calls. The listener is only attached while the popover is open — this doc
  // rewrites on EVERY AI call, so an always-on listener would stream the full prompt
  // text to every open tab all day for a panel nobody is looking at.
  const [aiLog, setAiLog] = React.useState([]);
  const [expandedLogEntry, setExpandedLogEntry] = React.useState(null);
  // Pop-out live-log window (owner ticket 7/19): full prompt/response text in a
  // real dialog instead of the cramped popover section.
  const [aiLogWindowOpen, setAiLogWindowOpen] = React.useState(false);
  // Owner ticket 7/16: the popover was absolutely positioned inside the rail, so it
  // clipped under neighboring cards and ran off the top of the screen. It now renders
  // through a portal at document.body with viewport-clamped fixed coordinates,
  // computed from the button's rect at open time.
  const aiLaneBtnRef = React.useRef(null);
  const [aiLanePopoverPos, setAiLanePopoverPos] = React.useState(null);
  const openAiLanePopover = () => {
    const rect = aiLaneBtnRef.current?.getBoundingClientRect() || null;
    const vw = window.innerWidth, vh = window.innerHeight;
    const width = Math.min(320, vw - 16);
    let left = rect ? rect.right + 8 : 8;
    if (left + width > vw - 8) left = Math.max(8, (rect ? rect.left : vw) - width - 8);
    left = Math.max(8, Math.min(left, vw - width - 8));
    const bottom = Math.max(8, rect ? vh - rect.bottom : 8);
    const maxHeight = Math.max(160, Math.min(Math.round(vh * 0.7), vh - bottom - 16));
    setAiLanePopoverPos({ left, bottom, width, maxHeight });
  };
  // Leak entries the owner already filed as buglog tickets, keyed detectedAt →
  // bug doc id — persisted so the button can't create duplicates across sessions,
  // and so the card can follow the ticket's lifecycle (owner ticket 7/19: a fixed
  // leak must be ARCHIVED on the card with its fix note, not sit in the red
  // "possible leak" list forever). Storage was historically a plain array of
  // detectedAt stamps (no bug id); those migrate to an empty-id entry — still
  // dedupe-safe, just can't show a fix note.
  const [ticketedLeaks, setTicketedLeaks] = React.useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('nc_ai_leaks_ticketed') || '{}');
      if (Array.isArray(raw)) return Object.fromEntries(raw.map(at => [at, '']));
      return raw && typeof raw === 'object' ? raw : {};
    } catch (_) { return {}; }
  });
  const createLeakTicket = async (leak) => {
    if (ticketedLeaks[leak.detectedAt] !== undefined) return;
    const id = await Store.addBug({
      text: `AI call leak flagged by the call manager: job "${leak.jobId}" — ${leak.reason} Proposed fix: ${leak.proposedFix}`,
    });
    if (!id) return;
    setTicketedLeaks(prev => {
      const next = { ...prev, [leak.detectedAt]: id };
      try { localStorage.setItem('nc_ai_leaks_ticketed', JSON.stringify(Object.fromEntries(Object.entries(next).slice(-50)))); } catch (_) {}
      return next;
    });
  };
  // Fix state of each ticketed leak, keyed detectedAt → { resolved, fixNote }.
  // Fetched (one small doc read per ticketed leak) each time the popover opens —
  // no always-on listener, same economy rationale as the live log below.
  const [leakFixState, setLeakFixState] = React.useState({});
  React.useEffect(() => {
    if (!aiLanePopoverOpen) return undefined;
    const entries = Object.entries(ticketedLeaks).filter(([, bugId]) => bugId);
    if (!entries.length) return undefined;
    let cancelled = false;
    (async () => {
      const col = Store.bugsCol && Store.bugsCol();
      if (!col) return;
      const state = {};
      await Promise.all(entries.map(async ([detectedAt, bugId]) => {
        try {
          const snap = await col.doc(bugId).get();
          if (!snap.exists) return;
          const b = snap.data() || {};
          const notes = Array.isArray(b.notes) ? b.notes : [];
          const lastNote = notes.length ? String(notes[notes.length - 1].text || '') : '';
          state[detectedAt] = {
            resolved: b.status === 'resolved',
            fixNote: String(b.devNote || '') || lastNote,
          };
        } catch (_) {}
      }));
      if (!cancelled) setLeakFixState(state);
    })();
    return () => { cancelled = true; };
  }, [aiLanePopoverOpen, ticketedLeaks]);
  // Which leak timestamps the owner has already opened the popover for — clears the
  // exclamation badge without needing a server round-trip.
  const [seenLeakTimes, setSeenLeakTimes] = React.useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('nc_ai_leaks_seen') || '[]')); } catch (_) { return new Set(); }
  });
  // A leak whose linked ticket is resolved is ARCHIVED — it leaves the red list
  // (and the badge math) and moves to a quiet "fixed" fold with its fix note.
  const activeLeaks = React.useMemo(
    () => (aiLane.leaks || []).filter(l => !leakFixState[l.detectedAt]?.resolved),
    [aiLane.leaks, leakFixState]);
  const archivedLeaks = React.useMemo(
    () => (aiLane.leaks || []).filter(l => leakFixState[l.detectedAt]?.resolved),
    [aiLane.leaks, leakFixState]);
  const unseenLeaks = React.useMemo(() => activeLeaks.filter(l => !seenLeakTimes.has(l.detectedAt)), [activeLeaks, seenLeakTimes]);
  const markLeaksSeen = () => {
    if (!aiLane.leaks?.length) return;
    setSeenLeakTimes(prev => {
      const next = new Set(prev);
      aiLane.leaks.forEach(l => next.add(l.detectedAt));
      try { localStorage.setItem('nc_ai_leaks_seen', JSON.stringify([...next].slice(-50))); } catch (_) {}
      return next;
    });
  };
  React.useEffect(() => {
    const unsub = subscribeAiLaneStatus(setAiLane);
    return () => { try { unsub && unsub(); } catch (_) {} };
  }, []);
  // Attach the live-log listener only while the section is actually being viewed.
  React.useEffect(() => {
    const viewing = (aiLanePopoverOpen && aiSectOpen.livelog) || aiLogWindowOpen;
    if (!viewing) return undefined;
    const unsub = subscribeAiLog(setAiLog);
    return () => { try { unsub && unsub(); } catch (_) {} };
  }, [aiLanePopoverOpen, aiSectOpen.livelog, aiLogWindowOpen]);
  // Owner ticket 7/19 ("deskphone is autolaunching on its own — a mysterious
  // black blank screen"): the previous version of this launched DeskPhone from a
  // background effect — whenever the preference was 'pc' OR 'auto' and the PC's
  // presence heartbeat looked stale, every open desktop tab silently fired
  // deskphone://open, re-firing on each owner snapshot (App.jsx rate-limits to
  // one launch per 45s). Any heartbeat hiccup meant DeskPhone windows appearing
  // out of nowhere, forever. Launching a native app is now strictly an explicit
  // owner action: it fires only from ensurePcHostExplicit below (tapping PC in
  // the host toggle) and the Phone panel's own Launch button — never from a
  // passive effect. The isMobilePhoneDevice guard stays (7/15 bug): only a
  // browser on the Windows PC itself can handle deskphone://.
  const ensurePcHostExplicit = () => {
    if (!onEnsurePcHost) return;
    if (isMobilePhoneDevice()) return;
    const pcInfo = phoneHost.hosts?.windows;
    const pcBeaconLive = pcInfo?.t && (Date.now() - pcInfo.t) < OWNER_LIVE_WINDOW_MS;
    if (!pcBeaconLive) onEnsurePcHost();
  };
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
    const next = CYCLE[(idx + 1) % CYCLE.length];
    setPreferredHost(next);
    if (next === 'pc') ensurePcHostExplicit();
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
  // M3 minimum touch target is 48dp, not 40. The previous line here asserted 40dp
  // in a comment and enforced it in code; that single wrong number is what seeded
  // the app-wide drift — IconBtn defaulted to 40, gvIconButton was 40x40, and call
  // sites shrank from there to 32, 28, 26, 22. The rail scales itself down on short
  // windows (see `s` above), so the floor has to be a hard Math.max, not a scaled
  // value, or a short screen quietly reintroduces an illegal target.
  const BTN_H = Math.max(M3_MIN_TARGET, px(48));
  // Rail labels are label-large (14px) and must not scale below M3's smallest
  // defined role. 11px was label-small; 12px is the readable floor the runtime
  // audit enforces.
  const FZ = Math.max(12, px(14));
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
          <div style={{ fontSize: NC_TYPE.small, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: C.faint, fontFamily: NC_FONT_STACK, padding: "4px 14px 4px" }}>Experimental</div>
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
          overflow; red once it's fully fallen through to Claude. A second, smaller
          exclamation badge appears when the AI call manager (recordAiUsage() in
          _ai-core.cjs) has flagged a usage leak — a spike vs. a job's own trailing
          average, or suspiciously clockwork timing that looks automatic rather than
          user-triggered. Click opens usage stats + any flagged leaks with a plain-
          language reason and proposed fix, same popover pattern as the account
          switcher; opening it marks the current leaks seen and clears the badge. */}
      {(() => {
        const laneDot = aiLane.currentLane === 'claude:fallback' ? C.danger
          : (aiLane.currentLane === 'gemini:overflow-01' || aiLane.currentLane === 'gemini:paid-01') ? C.warning
          : null; // primary lane: no dot, nothing to draw attention to
        const hasUnseenLeak = unseenLeaks.length > 0;
        return (
          <div style={{ position: 'relative', width: '100%', flexShrink: 0 }}>
            <button ref={aiLaneBtnRef} onClick={() => { if (!aiLanePopoverOpen) openAiLanePopover(); setAiLanePopoverOpen(p => !p); markLeaksSeen(); }} title={`AI: ${aiLane.label}${aiLane.model ? ' · ' + aiLane.model : ''}${hasUnseenLeak ? ' — possible leak flagged' : ''}`} aria-label={`AI lane: ${aiLane.label}${aiLane.model ? ', model ' + aiLane.model : ''}`} style={navBtn(aiLanePopoverOpen)}>
              <Ripple />
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                {suiteIcon('bolt', ic(24))}
                {laneDot && (
                  <span style={{ position: 'absolute', top: -1, right: -1, width: 8, height: 8, borderRadius: RADIUS.pill, background: laneDot, boxShadow: `0 0 0 2px ${C.bg}` }} />
                )}
                {hasUnseenLeak && (
                  <span style={{ position: 'absolute', top: -3, left: -3, width: 12, height: 12, borderRadius: RADIUS.pill, background: C.danger, color: '#fff', fontSize: NC_TYPE.small, fontWeight: 800, lineHeight: '12px', textAlign: 'center', boxShadow: `0 0 0 2px ${C.bg}` }}>!</span>
                )}
              </span>
              {displayOpen && (
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
                  <span>{aiLane.label}</span>
                  {aiLane.model && (
                    <span style={{ fontSize: NC_TYPE.small, color: C.faint, fontFamily: NC_MONO_STACK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{aiLane.model}</span>
                  )}
                </span>
              )}
            </button>
            {aiLanePopoverOpen && aiLanePopoverPos && createPortal(
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 9100 }} onClick={() => setAiLanePopoverOpen(false)} />
                <div style={{ position: 'fixed', left: aiLanePopoverPos.left, bottom: aiLanePopoverPos.bottom, zIndex: 9101, background: C.bg, border: `1px solid ${C.divider}`, borderRadius: RADIUS.sm, width: aiLanePopoverPos.width, boxShadow: '0 4px 20px rgba(0,0,0,0.2)', maxHeight: aiLanePopoverPos.maxHeight, overflowY: 'auto', overflowX: 'hidden' }}>
                  <div style={{ fontSize: NC_TYPE.small, fontWeight: 700, color: C.faint, letterSpacing: 1.5, textTransform: 'uppercase', fontFamily: NC_FONT_STACK, padding: '8px 12px 0' }}>AI lane — currently {aiLane.label}</div>
                  {aiLane.model && (
                    <div style={{ fontSize: NC_TYPE.small, color: C.muted, fontFamily: NC_MONO_STACK, padding: '2px 12px 4px' }}>{aiLane.model}</div>
                  )}
                  <div style={{ display: 'flex', gap: 10, padding: '2px 12px 4px', fontSize: NC_TYPE.meta, color: C.muted, fontFamily: NC_FONT_STACK }}>
                    <span><b style={{ color: C.text }}>{aiLane.usage.totalToday}</b> today</span>
                    <span><b style={{ color: C.text }}>{aiLane.usage.totalThisHour}</b> this hour</span>
                    <span><b style={{ color: C.text }}>{aiLane.usage.totalThisMonth}</b> this month</span>
                  </div>
                  {/* Est. spend from server-side token accounting; the link opens the GCP
                      billing console — the authoritative "actual spend" for the cloud
                      account (owner ticket yLg0L3HT). */}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '0 12px 9px', fontSize: NC_TYPE.meta, color: C.muted, fontFamily: NC_FONT_STACK }}>
                    <span>Est. spend <b style={{ color: C.text }}>${aiLane.usage.spendTodayUsd < 0.01 && aiLane.usage.spendTodayUsd > 0 ? aiLane.usage.spendTodayUsd.toFixed(4) : aiLane.usage.spendTodayUsd.toFixed(2)}</b> today · <b style={{ color: C.text }}>${aiLane.usage.spendMonthUsd.toFixed(2)}</b> this month</span>
                    <a href="https://console.cloud.google.com/billing?project=onetaskonly-app" target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', color: C.accent, fontSize: NC_TYPE.small, textDecoration: 'none', whiteSpace: 'nowrap' }}>actual billing ↗</a>
                  </div>
                  {/* Manual lane prod (owner 7/19): pick which credential lane serves FIRST.
                      A preference, not a hard pin — the other lanes still catch failures. */}
                  <div style={{ padding: '0 12px 9px' }}>
                    <div style={{ fontSize: NC_TYPE.small, fontWeight: 700, color: C.faint, letterSpacing: 1.5, textTransform: 'uppercase', fontFamily: NC_FONT_STACK, paddingBottom: 4 }}>Lane override</div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {[['', 'Auto'], ['primary', 'Primary'], ['overflow_01', 'Overflow'], ['paid_01', 'Paid']].map(([value, label]) => (
                        <FilterChip
                          key={value || 'auto'}
                          label={label}
                          selected={aiLanePref === value}
                          title={value ? `Try the ${label} Gemini lane first (others still serve as fallbacks)` : 'Server picks: primary → overflow → paid'}
                          onClick={() => setAiLanePref(value)}
                          style={{
                            flexShrink: 0,
                            '--md-filter-chip-container-height': '22px',
                            '--md-filter-chip-label-text-font': NC_FONT_STACK,
                            '--md-filter-chip-label-text-size': '11px',
                            '--md-filter-chip-outline-color': C.divider,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  {activeLeaks.length > 0 && (
                    <div>
                      <button onClick={() => setAiSectOpen(s => ({ ...s, leaks: !s.leaks }))} style={{ display: 'flex', alignItems: 'center', width: '100%', background: 'none', border: 'none', borderTop: `1px solid ${C.divider}`, cursor: 'pointer', padding: '8px 12px 4px', fontSize: NC_TYPE.small, fontWeight: 700, color: C.danger, letterSpacing: 1.5, textTransform: 'uppercase', fontFamily: NC_FONT_STACK, textAlign: 'left' }}>
                        <span style={{ flex: 1 }}>Possible leak ({activeLeaks.length})</span>
                        {suiteIcon(aiSectOpen.leaks ? 'expand_less' : 'expand_more', 14)}
                      </button>
                      {aiSectOpen.leaks && [...activeLeaks].reverse().map((leak, i) => (
                        <div key={i} style={{ padding: '6px 12px 10px' }}>
                          <div style={{ fontSize: NC_TYPE.meta, color: C.text, fontFamily: NC_FONT_STACK, fontWeight: 600 }}>{leak.jobId}</div>
                          <div style={{ fontSize: NC_TYPE.small, color: C.muted, fontFamily: NC_FONT_STACK, marginTop: 2 }}>{leak.reason}</div>
                          <div style={{ fontSize: NC_TYPE.small, color: C.faint, fontFamily: NC_FONT_STACK, marginTop: 3, fontStyle: 'italic' }}>{leak.proposedFix}</div>
                          <TextButton onClick={() => createLeakTicket(leak)} disabled={ticketedLeaks[leak.detectedAt] !== undefined} style={{ marginTop: 4, '--md-text-button-container-height': '28px' }}>
                            <span>{ticketedLeaks[leak.detectedAt] !== undefined ? 'Ticket created ✓ — awaiting fix' : 'Create buglog ticket'}</span>
                          </TextButton>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Archived leaks (owner ticket 7/19): a leak whose buglog ticket was
                      resolved stops being an alarm. It moves down here — quiet, green,
                      collapsed by default — carrying the ticket's fix note so the card
                      itself tells the story of what was found and how it was closed. */}
                  {archivedLeaks.length > 0 && (
                    <div>
                      <button onClick={() => setAiSectOpen(s => ({ ...s, archived: !s.archived }))} style={{ display: 'flex', alignItems: 'center', width: '100%', background: 'none', border: 'none', borderTop: `1px solid ${C.divider}`, cursor: 'pointer', padding: '8px 12px 4px', fontSize: NC_TYPE.small, fontWeight: 700, color: C.success, letterSpacing: 1.5, textTransform: 'uppercase', fontFamily: NC_FONT_STACK, textAlign: 'left' }}>
                        <span style={{ flex: 1 }}>Fixed leaks — archived ({archivedLeaks.length})</span>
                        {suiteIcon(aiSectOpen.archived ? 'expand_less' : 'expand_more', 14)}
                      </button>
                      {aiSectOpen.archived && [...archivedLeaks].reverse().map((leak, i) => (
                        <div key={i} style={{ padding: '6px 12px 10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ color: C.success, display: 'inline-flex' }}>{suiteIcon('check_circle', 13)}</span>
                            <span style={{ fontSize: NC_TYPE.meta, color: C.text, fontFamily: NC_FONT_STACK, fontWeight: 600 }}>{leak.jobId}</span>
                          </div>
                          <div style={{ fontSize: NC_TYPE.small, color: C.faint, fontFamily: NC_FONT_STACK, marginTop: 2 }}>{leak.reason}</div>
                          {leakFixState[leak.detectedAt]?.fixNote && (
                            <div style={{ marginTop: 4, padding: '5px 7px', background: C.bgSoft, borderLeft: `2px solid ${C.success}`, borderRadius: RADIUS.xs, fontSize: NC_TYPE.small, lineHeight: 1.45, color: C.muted, fontFamily: NC_FONT_STACK, maxHeight: 130, overflowY: 'auto' }}>
                              <span style={{ fontWeight: 700, color: C.success }}>Fix: </span>{leakFixState[leak.detectedAt].fixNote}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <button onClick={() => setAiSectOpen(s => ({ ...s, fallovers: !s.fallovers }))} style={{ display: 'flex', alignItems: 'center', width: '100%', background: 'none', border: 'none', borderTop: `1px solid ${C.divider}`, cursor: 'pointer', padding: '8px 12px 4px', fontSize: NC_TYPE.small, fontWeight: 700, color: C.faint, letterSpacing: 1.5, textTransform: 'uppercase', fontFamily: NC_FONT_STACK, textAlign: 'left' }}>
                    <span style={{ flex: 1 }}>Recent fallovers{aiLane.recent.length ? ` (${aiLane.recent.length})` : ''}</span>
                    {suiteIcon(aiSectOpen.fallovers ? 'expand_less' : 'expand_more', 14)}
                  </button>
                  {aiSectOpen.fallovers && (aiLane.recent.length === 0 ? (
                    <div style={{ padding: '9px 12px 12px', fontSize: NC_TYPE.meta, color: C.faint, fontFamily: NC_FONT_STACK }}>No fallovers yet — running on Gemini primary.</div>
                  ) : (
                    // Owner ticket 7/19 ("fallovers don't look like fallovers — they look
                    // like straight calls"): each event is a lane SWITCH, so say so.
                    // Falling away from primary is amber (overflow) or red (Claude
                    // last-resort) with a warning icon and "Fell over: from → to";
                    // returning to primary is green "Recovered". A neutral row of
                    // label+timestamp read as just another call — that was the bug.
                    [...aiLane.recent].reverse().map((event, i, arr) => {
                      const isPrimary = event.lane === 'gemini:primary';
                      const tone = isPrimary ? C.success : event.lane === 'claude:fallback' ? C.danger : C.warning;
                      const prior = arr[i + 1]; // next in reversed order = the lane it came FROM
                      return (
                        <div key={i} style={{ padding: '7px 12px', borderTop: `1px solid ${C.divider}`, borderLeft: `3px solid ${tone}` }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ color: tone, display: 'inline-flex' }}>{suiteIcon(isPrimary ? 'undo' : 'warning', 13)}</span>
                            <span style={{ fontSize: NC_TYPE.meta, color: tone, fontFamily: NC_FONT_STACK, fontWeight: 700 }}>
                              {isPrimary ? 'Recovered' : 'Fell over'}{prior?.label ? `: ${prior.label} → ${event.label}` : ` to ${event.label}`}
                            </span>
                          </div>
                          <div style={{ fontSize: NC_TYPE.small, color: C.faint, fontFamily: NC_FONT_STACK, marginTop: 1 }}>
                            {new Date(event.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                            {event.reason ? ` · ${event.reason}` : ''}
                          </div>
                        </div>
                      );
                    })
                  ))}
                  {/* Live log (owner ticket 3I7vYdFo): the actual prompt/response of
                      recent calls. Rows are click-to-expand — collapsed shows the job,
                      model, tokens and cost; expanded shows the real text sent and
                      returned, with an explicit note when it was truncated. */}
                  <div style={{ display: 'flex', alignItems: 'center', borderTop: `1px solid ${C.divider}` }}>
                    <button onClick={() => setAiSectOpen(s => ({ ...s, livelog: !s.livelog }))} style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', padding: '8px 0 4px 12px', fontSize: NC_TYPE.small, fontWeight: 700, color: C.faint, letterSpacing: 1.5, textTransform: 'uppercase', fontFamily: NC_FONT_STACK, textAlign: 'left' }}>
                      <span style={{ flex: 1 }}>Live log{aiLog.length ? ` (${aiLog.length})` : ''}</span>
                      {suiteIcon(aiSectOpen.livelog ? 'expand_less' : 'expand_more', 14)}
                    </button>
                    {/* Pop-out (owner ticket 7/19): open the log in a real window —
                        the DeskPhone-live-log treatment — instead of squinting at
                        this 320px column. Closes the popover so the dialog owns
                        the screen. */}
                    <IconButton aria-label="Open live log in a window" title="Open in window" onClick={() => { setAiLanePopoverOpen(false); setAiLogWindowOpen(true); }} style={{ '--md-icon-button-icon-size': '16px', width: 32, height: 32, flexShrink: 0, marginRight: 4 }}>
                      {suiteIcon('open_in_new', 16)}
                    </IconButton>
                  </div>
                  {aiSectOpen.livelog && (aiLog.length === 0 ? (
                    <div style={{ padding: '9px 12px 12px', fontSize: NC_TYPE.meta, color: C.faint, fontFamily: NC_FONT_STACK }}>No calls logged yet — this fills in as the app makes AI calls.</div>
                  ) : (
                    aiLog.map((entry, i) => {
                      const open = expandedLogEntry === entry.at;
                      return (
                        <div key={entry.at || i} style={{ borderTop: `1px solid ${C.divider}` }}>
                          <button onClick={() => setExpandedLogEntry(open ? null : entry.at)} style={{ display: 'block', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '7px 12px', textAlign: 'left' }}>
                            <div style={{ fontSize: NC_TYPE.meta, color: C.text, fontFamily: NC_FONT_STACK, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.job}</div>
                            <div style={{ fontSize: NC_TYPE.small, color: C.faint, fontFamily: NC_FONT_STACK, marginTop: 1 }}>
                              {new Date(entry.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                              {` · ${entry.inTok}→${entry.outTok} tok`}
                              {entry.usd > 0 ? ` · $${entry.usd < 0.01 ? entry.usd.toFixed(4) : entry.usd.toFixed(2)}` : ''}
                              {entry.elapsedMs ? ` · ${(entry.elapsedMs / 1000).toFixed(1)}s` : ''}
                            </div>
                            {entry.model && (
                              <div style={{ fontSize: NC_TYPE.small, color: C.faint, fontFamily: NC_MONO_STACK, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.model}</div>
                            )}
                            {/* Owner ticket Q81pBGSq: the prompt must be visible without
                                expanding — a collapsed row that reads as only job+timestamp
                                hides what the call actually asked. One line, tail-clipped;
                                the full text stays in the expanded view below. */}
                            {entry.prompt && (
                              <div style={{ fontSize: NC_TYPE.small, color: C.muted, fontFamily: NC_MONO_STACK, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.prompt}</div>
                            )}
                          </button>
                          {open && (
                            <div style={{ padding: '0 12px 10px' }}>
                              {[
                                { label: 'Prompt', body: entry.prompt, truncated: entry.promptTruncated, chars: entry.promptChars },
                                { label: 'Response', body: entry.response, truncated: entry.responseTruncated, chars: entry.responseChars },
                              ].map(part => (
                                <div key={part.label} style={{ marginTop: 6 }}>
                                  <div style={{ fontSize: NC_TYPE.small, fontWeight: 700, color: C.faint, letterSpacing: 1.2, textTransform: 'uppercase', fontFamily: NC_FONT_STACK }}>
                                    {part.label}{part.truncated ? ` — showing first ${part.body.length} of ${part.chars} chars` : ''}
                                  </div>
                                  <pre style={{ margin: '3px 0 0', padding: 7, background: C.bgSoft, border: `1px solid ${C.divider}`, borderRadius: RADIUS.xs, fontSize: NC_TYPE.small, lineHeight: 1.45, color: C.muted, fontFamily: NC_MONO_STACK, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 220, overflowY: 'auto' }}>{part.body || '(empty)'}</pre>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ))}
                </div>
              </>,
              document.body
            )}
            {/* Pop-out live-log window (owner ticket 7/19). Real md-dialog per the
                M3 rule. Roomy layout: every entry shows its full prompt and
                response inline — no click-to-expand — because reading the text is
                the entire point of popping it out. Keeps updating live while open
                (the subscribe effect above also watches aiLogWindowOpen). */}
            <Dialog
              open={aiLogWindowOpen}
              onClosed={() => setAiLogWindowOpen(false)}
              style={{
                '--md-dialog-container-color': C.bg,
                'maxWidth': 'min(880px, 96vw)',
                'minWidth': 'min(880px, 96vw)',
                'maxHeight': '88vh',
              }}
            >
              <div slot="headline" style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: NC_FONT_STACK, fontSize: NC_TYPE.title, fontWeight: 600, color: C.text }}>
                <span style={{ color: C.accent, display: 'inline-flex' }}>{suiteIcon('bolt', 20)}</span>
                <span style={{ flex: 1 }}>AI live log{aiLog.length ? ` — last ${aiLog.length} calls` : ''}</span>
              </div>
              <div slot="content" style={{ padding: 0 }}>
                {aiLog.length === 0 ? (
                  <div style={{ padding: '16px 4px', fontSize: NC_TYPE.body, color: C.faint, fontFamily: NC_FONT_STACK }}>No calls logged yet — this fills in as the app makes AI calls.</div>
                ) : (
                  aiLog.map((entry, i) => (
                    <div key={entry.at || i} style={{ padding: '12px 0', borderTop: i === 0 ? 'none' : `1px solid ${C.divider}` }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: NC_TYPE.body, color: C.text, fontFamily: NC_FONT_STACK, fontWeight: 700 }}>{entry.job}</span>
                        <span style={{ fontSize: NC_TYPE.small, color: C.faint, fontFamily: NC_FONT_STACK }}>
                          {new Date(entry.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                          {` · ${entry.inTok}→${entry.outTok} tok`}
                          {entry.usd > 0 ? ` · $${entry.usd < 0.01 ? entry.usd.toFixed(4) : entry.usd.toFixed(2)}` : ''}
                          {entry.elapsedMs ? ` · ${(entry.elapsedMs / 1000).toFixed(1)}s` : ''}
                        </span>
                        {entry.model && (
                          <span style={{ fontSize: NC_TYPE.small, color: C.faint, fontFamily: NC_MONO_STACK }}>{entry.model}</span>
                        )}
                      </div>
                      {[
                        { label: 'Prompt', body: entry.prompt, truncated: entry.promptTruncated, chars: entry.promptChars },
                        { label: 'Response', body: entry.response, truncated: entry.responseTruncated, chars: entry.responseChars },
                      ].map(part => (
                        <div key={part.label} style={{ marginTop: 8 }}>
                          <div style={{ fontSize: NC_TYPE.small, fontWeight: 700, color: C.faint, letterSpacing: 1.2, textTransform: 'uppercase', fontFamily: NC_FONT_STACK }}>
                            {part.label}{part.truncated ? ` — showing first ${part.body.length} of ${part.chars} chars` : ''}
                          </div>
                          <pre style={{ margin: '4px 0 0', padding: 10, background: C.bgSoft, border: `1px solid ${C.divider}`, borderRadius: RADIUS.xs, fontSize: NC_TYPE.meta, lineHeight: 1.55, color: C.muted, fontFamily: NC_MONO_STACK, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 340, overflowY: 'auto' }}>{part.body || '(empty)'}</pre>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
              <div slot="actions">
                <TextButton onClick={() => setAiLogWindowOpen(false)}><span>Close</span></TextButton>
              </div>
            </Dialog>
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
              fontSize: NC_TYPE.small, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
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
              else if (idx === 1) { setPreferredHost('pc'); ensurePcHostExplicit(); }
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
        {hebrewDate && s > 0.55 && <span style={{ fontSize: NC_TYPE.small, color: C.faint, marginTop: 2, lineHeight: 1, whiteSpace: "nowrap", direction: "rtl" }}>{hebrewDate}</span>}
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
        <span style={{ fontSize: NC_TYPE.small, fontWeight: 700, letterSpacing: displayOpen ? 1.4 : 0.4, color: C.faint, fontFamily: NC_FONT_STACK, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>v{APP_VERSION}</span>
        {displayOpen ? (
          <span style={{ fontSize: NC_TYPE.small, color: C.faint, opacity: 0.7, fontFamily: NC_FONT_STACK, letterSpacing: 0.2, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{formatVersionStamp()}</span>
        ) : (() => {
          const sv = versionStampShort();
          const ls = { fontSize: NC_TYPE.small, color: C.faint, opacity: 0.7, lineHeight: 1.15, fontFamily: NC_FONT_STACK, letterSpacing: 0.1, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
          return (<><span style={ls}>{sv.date}</span>{sv.time && <span style={ls}>{sv.time}</span>}</>);
        })()}
      </div>
    </div>

    </>
  );
}

export { AppSuiteChrome };
