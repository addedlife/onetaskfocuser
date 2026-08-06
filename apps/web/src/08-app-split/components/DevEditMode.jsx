// ─── Dev edit mode ────────────────────────────────────────────────────────────
//
// WHAT THIS IS (plain English): a switch in Settings that puts the whole app into
// "tell me what's wrong with this" mode. Every button, field and control on screen
// gets a faint box drawn around it, so you can see exactly what the app thinks its
// pieces are. Nothing else changes and the app keeps working normally. Press and
// hold a box — or right-click it on a PC — and two icons appear on that one box: a
// blue pencil ("change this") and a red garbage can ("this shouldn't be here").
// Either one opens a note, and what you write goes straight into the Bug Log as a
// ticket with the control's name, the screen and the app version already filled in.
//
// WHY IT WORKS THIS WAY (owner, 8/6): icons on every control at once made the
// screen "one massive clutter". Boxes are quiet; the icons are summoned for the one
// thing you are actually pointing at, and they are the only web components this
// overlay creates — one pair, not several hundred.
//
// HOW IT WORKS: one fixed overlay layer (`pointer-events: none`) sits above the app
// and draws a box over the rectangle of every interactive element found by
// `document.querySelectorAll`. Nothing about the app's own markup changes — no
// component had to be touched to take part, which is the only way "every single
// button or input field" is achievable across a 5,000-line surface, on any layout.
// Because the layer never takes the pointer, the long-press and right-click land on
// the app itself; the overlay listens for them on the document and maps the point
// back to a control with elementFromPoint.
//
// FOUR RULES LEARNED THE HARD WAY:
//
//   1. A control that is scrolled out of its own list must lose its box too. The
//      viewport is not the only clipper: a card body with its own scrollbar hides
//      rows that are still inside the window, and boxes for those rows used to
//      float over the card's header. `clipRectFor` intersects every scrollable
//      ancestor, so a box appears exactly when the row it belongs to is showing.
//   2. Never let this overlay observe itself. The MutationObserver watches
//      document.body, and this overlay lives IN document.body — so every repaint
//      fed the observer, which rescanned, which repainted, at frame rate.
//      Mutations inside `[data-dev-edit-ui]` are ignored, an unchanged measurement
//      does not set state, and scanning stops while the dialog is open.
//   3. React keys must not contain coordinates. They did, so one scroll changed
//      every key and React rebuilt every element on the layer. Keys come from a
//      WeakMap on the element itself.
//   4. Nothing here may block the page. Measurements are throttled, and the overlay
//      times itself: over budget and it measures less often, then marks fewer
//      controls. It can get sluggish; it cannot freeze.
//
// The harness in src/dev/edit-mode-harness.jsx exercises all of it in a real
// browser — jsdom has no layout, and the app itself is behind Google sign-in.

import React from 'react';
import { createPortal } from 'react-dom';
import { CAT_MAIL, NC_FONT_STACK, NC_TYPE, RADIUS, SP, ELEV, Z, suiteIcon } from '../ui-tokens.jsx';
import { APP_VERSION } from '../../version.js';
import { Store, textOnColor } from '../../01-core.js';
import { Dialog, TextField, ActionBtn, IconButton, FilledIconButton, OutlinedSelect, SelectOption } from '../m3.jsx';

// Every control the owner can point at. Custom elements are listed by tag because
// their real <button> lives in shadow DOM, where querySelectorAll cannot reach.
const TARGET_SELECTOR = [
  'button', '[role="button"]', 'a[href]',
  'input:not([type="hidden"])', 'textarea', 'select',
  'md-filled-button', 'md-outlined-button', 'md-text-button', 'md-filled-tonal-button',
  'md-icon-button', 'md-filled-icon-button', 'md-filled-tonal-icon-button', 'md-outlined-icon-button',
  'md-fab', 'md-branded-fab',
  'md-switch', 'md-checkbox', 'md-radio', 'md-slider',
  'md-outlined-text-field', 'md-filled-text-field',
  'md-outlined-select', 'md-assist-chip', 'md-filter-chip', 'md-suggestion-chip',
  '[contenteditable=""]', '[contenteditable="true"]',
].join(',');

// Anything that holds or shows text. These are exempt from the "outermost match
// wins" rule below: a read-only field inside a row that is itself a button was
// being swallowed by the row and got no marks at all (owner, 8/6 — "some text
// fields, especially read only, don't have edit functions"). A field is a separate
// thing to complain about from the row that contains it.
const FIELD_SELECTOR = [
  'input', 'textarea', 'select',
  'md-outlined-text-field', 'md-filled-text-field', 'md-outlined-select',
  '[contenteditable=""]', '[contenteditable="true"]',
].join(',');

// Stable identity per DOM element, so React reuses the same two <md-icon-button>
// elements for a control instead of destroying and rebuilding them. The key used
// to contain the control's coordinates, which meant ONE scroll changed every key
// and React tore down and reconstructed up to 800 web components — shadow roots,
// ripples and focus rings included — inside a single frame. That is what still
// froze the page. A WeakMap keeps this out of the DOM (a data attribute would trip
// our own MutationObserver) and lets elements be garbage-collected normally.
const idMap = new WeakMap();
let idSeq = 0;
function idFor(el) {
  let id = idMap.get(el);
  if (id === undefined) { id = ++idSeq; idMap.set(el, id); }
  return id;
}

// A rectangle smaller than this is a decoration or a collapsed control, not
// something worth marking.
const MIN_TARGET_PX = 12;
// Hard ceiling so a pathological screen cannot paint thousands of marks, and a
// floor it degrades to rather than stalling (see the budget below).
const MAX_TARGETS = 400;
const MIN_TARGETS = 60;
// How long one measurement is allowed to take before this overlay decides it is
// too expensive for the page it landed on. A freeze is never an acceptable outcome
// for a diagnostic tool, and no fixed cost is safe on every screen — so instead of
// guessing a number that works everywhere, it measures itself: over budget and it
// backs off (fewer marks, longer gaps between measurements), comfortably under and
// it eases back. Worst case, edit mode gets sluggish and thins out; it cannot lock
// the page up.
const SCAN_BUDGET_MS = 45;
const MAX_RESCAN_MS = 5000;
const RESCAN_MS = 600;
// Floor between two measurements. Scroll fires per frame and the MutationObserver
// fires on every ripple; without a floor a flick-scroll asks for 60 full-page
// measurements a second.
const MIN_RESCAN_GAP_MS = 180;
// Glyph and hit-target px for a corner mark. Constants, not inline literals, so the
// two sizes stay in step with the inset that positions them.
const MARK_ICON_CSS = '15px';
const MARK_HIT_CSS = '20px';
const MARK_HIT_PX = 20;
// Press-and-hold to summon the icons: long enough not to fire on a tap or a scroll
// flick, short enough not to feel broken. The slop is how far a finger may drift
// before it counts as a scroll instead.
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;

const DELETE_REASONS = [
  { value: 'obsolete',  label: 'Obsolete — nothing uses it any more' },
  { value: 'redundant', label: 'Redundant — something else already does this' },
  { value: 'other',     label: 'Other — see the note' },
];

// A short, human-readable name for a control: whatever a screen reader would say,
// then its visible text, then its placeholder, then the tag as a last resort.
function labelFor(el) {
  const attr = (el.getAttribute?.('aria-label') || el.getAttribute?.('title') || '').trim();
  if (attr) return attr;
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  if (text) return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  const ph = (el.getAttribute?.('placeholder') || el.getAttribute?.('label') || el.getAttribute?.('name') || '').trim();
  if (ph) return ph;
  return el.tagName.toLowerCase();
}

// Enough of the DOM path to find the thing again in the source: the control, then
// up to three ancestors that carry an id, a data-attribute or a class.
function pathFor(el) {
  const parts = [];
  let node = el;
  let hops = 0;
  while (node && node !== document.body && hops < 4) {
    let seg = node.tagName.toLowerCase();
    if (node.id) seg += `#${node.id}`;
    const dataKey = Array.from(node.attributes || []).find(a => a.name.startsWith('data-') && a.name !== 'data-dev-edit-ui');
    if (dataKey) seg += `[${dataKey.name}]`;
    else if (typeof node.className === 'string' && node.className.trim()) seg += `.${node.className.trim().split(/\s+/)[0]}`;
    parts.unshift(seg);
    node = node.parentElement;
    hops += 1;
  }
  return parts.join(' > ');
}

// Which screen is this? The rail sets the surface in the URL; fall back to the
// document title so the ticket always says where the owner was standing.
function screenName() {
  try {
    const u = new URL(window.location.href);
    return u.searchParams.get('surface') || u.hash.replace('#', '') || document.title || 'app';
  } catch { return document.title || 'app'; }
}

// The rectangle a control is actually allowed to show inside: the viewport,
// narrowed by every scrolling ancestor between it and the page. `scrollHeight >
// clientHeight` is the cheap test for "this box scrolls, therefore it clips" —
// getComputedStyle on every ancestor of 400 elements, six times a second, is not
// affordable, and a box that scrolls is a box that hides what overflows it.
function clipRectFor(el) {
  let top = 0, left = 0;
  let right = window.innerWidth, bottom = window.innerHeight;
  let node = el.parentElement;
  let hops = 0;
  while (node && node !== document.body && hops < 24) {
    if (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1) {
      const r = node.getBoundingClientRect();
      if (r.top > top) top = r.top;
      if (r.left > left) left = r.left;
      if (r.right < right) right = r.right;
      if (r.bottom < bottom) bottom = r.bottom;
    }
    node = node.parentElement;
    hops += 1;
  }
  return { top, left, right, bottom };
}

// Measure one control: its box clipped to whatever is actually showing, or null if
// it is not a target or not visible right now. Shared by the full scan and by the
// long-press, so a control the scan thinned out can still be summoned by hand.
function measureTarget(el) {
  if (!el || el.nodeType !== 1) return null;
  if (el.closest('[data-dev-edit-ui]')) return null;
  const r = el.getBoundingClientRect();
  if (r.width < MIN_TARGET_PX || r.height < MIN_TARGET_PX) return null;

  // The box has to belong to something you can see. A row scrolled under its card
  // header, or past the bottom of the card, loses its box the same moment it stops
  // being readable — the viewport is not the only thing that clips.
  const clip = clipRectFor(el);
  if (r.top < clip.top - 1 || r.top > clip.bottom - MIN_TARGET_PX) return null;
  if (r.right < clip.left || r.left > clip.right) return null;

  // Clamped to the visible slice, so a half-scrolled row is outlined only as far as
  // it actually shows.
  const top = Math.max(r.top, clip.top);
  const left = Math.max(r.left, clip.left);
  const width = Math.min(r.right, clip.right) - left;
  const height = Math.min(r.bottom, clip.bottom) - top;
  if (width < MIN_TARGET_PX || height < 4) return null;

  return {
    key: idFor(el),
    top, left, width, height,
    label: labelFor(el), path: pathFor(el), tag: el.tagName.toLowerCase(),
  };
}

// The control a point belongs to: the innermost thing under the pointer that this
// overlay considers a target. The overlay never takes the pointer itself, so
// elementFromPoint returns the app's own element and this is a plain lookup.
function targetAtPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const hit = el.closest(TARGET_SELECTOR);
  if (!hit) return null;
  // Honour the same "outermost wins, except fields" rule the scan uses, so what you
  // long-press is the box you were looking at.
  let owner = hit;
  if (!hit.matches(FIELD_SELECTOR)) {
    const outer = hit.parentElement?.closest(TARGET_SELECTOR);
    if (outer && !outer.closest('[data-dev-edit-ui]')) owner = outer;
  }
  return measureTarget(owner);
}

// Collect every visible control, outermost only, excluding our own chrome.
function scanTargets(cap = MAX_TARGETS) {
  const out = [];
  let nodes;
  try { nodes = document.querySelectorAll(TARGET_SELECTOR); } catch { return out; }
  for (const el of nodes) {
    if (out.length >= cap) break;
    // Outermost match only — the parent chain already owns this rectangle — except
    // for fields, which are always their own target (see FIELD_SELECTOR).
    if (el.parentElement && el.parentElement.closest(TARGET_SELECTOR) && !el.matches(FIELD_SELECTOR)) continue;
    // Disabled and read-only controls are boxed like any other: they are still
    // things on the screen the owner may want changed or removed.
    const t = measureTarget(el);
    if (t) out.push(t);
  }
  return out;
}

// Cheap identity for a measurement, so an unchanged screen never sets state and
// therefore never re-enters the mutation → rescan → repaint loop.
function signature(list) {
  let s = '';
  for (const t of list) s += `${t.key}:${Math.round(t.left)}:${Math.round(t.top)}:${Math.round(t.width)}:${Math.round(t.height)};`;
  return s;
}

// One summoned icon. A real M3 icon button in its plain (standard) variant, which
// has no container fill at all — a bare glyph with a hover state layer.
function CornerMark({ icon, color, title, onClick, style }) {
  return (
    <IconButton
      title={title}
      aria-label={title}
      onClick={e => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      style={{
        position: 'absolute',
        pointerEvents: 'auto',
        '--md-icon-button-icon-size': MARK_ICON_CSS,
        '--md-icon-button-state-layer-width': MARK_HIT_CSS,
        '--md-icon-button-state-layer-height': MARK_HIT_CSS,
        '--md-icon-button-icon-color': color,
        width: MARK_HIT_CSS,
        height: MARK_HIT_CSS,
        ...style,
      }}
    >
      <span className="material-symbols-rounded" style={{ fontSize: MARK_ICON_CSS, color }}>{icon}</span>
    </IconButton>
  );
}

// One control's box. Nothing but an outline — no icons, no web components — which
// is what lets every control on screen wear one. Memoised on geometry so a scroll
// that moves ten rows re-renders ten boxes, not every box on screen.
const TargetFrame = React.memo(function TargetFrame({ t, borderColor, activeColor, active }) {
  return (
    <div style={{
      position: 'absolute', top: t.top, left: t.left, width: t.width, height: t.height,
      // Faint by default — the box says "this is a thing you can point at" without
      // shouting. The one you long-pressed goes solid so you can see what you got.
      border: active ? `2px solid ${activeColor}` : `1px dashed ${borderColor}`,
      borderRadius: RADIUS.xs,
      pointerEvents: 'none', boxSizing: 'border-box',
    }} />
  );
}, (a, b) =>
  // scanTargets builds fresh objects every pass, so the default shallow compare
  // would never match. Compare what actually affects the paint.
  a.t.top === b.t.top && a.t.left === b.t.left &&
  a.t.width === b.t.width && a.t.height === b.t.height &&
  a.active === b.active &&
  a.borderColor === b.borderColor && a.activeColor === b.activeColor);

function DevEditMode({ enabled = false, T = {}, onExit }) {
  const C = T;
  const [targets, setTargets] = React.useState([]);
  // { mode: 'edit' | 'delete', label, path, tag }
  const [draft, setDraft] = React.useState(null);
  const [note, setNote] = React.useState('');
  const [reason, setReason] = React.useState('obsolete');
  const [saving, setSaving] = React.useState(false);
  const [flash, setFlash] = React.useState(null);
  // The one control whose icons are showing, summoned by long-press / right-click.
  const [active, setActive] = React.useState(null);
  const rafRef = React.useRef(0);
  const sigRef = React.useRef('');
  const lastScanRef = React.useRef(0);
  const rescanRef = React.useRef(null);
  // Self-throttling state: how many controls to measure and how often.
  const budgetRef = React.useRef({ cap: MAX_TARGETS, gap: RESCAN_MS, warned: false });

  // One rAF-coalesced rescan, shared by the timer, scroll, resize and the
  // MutationObserver. It sets state only when the measurement actually changed —
  // without that, painting the marks mutates the DOM, which wakes the observer,
  // which rescans, which repaints, forever.
  const rescan = React.useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const now = Date.now();
      const since = now - lastScanRef.current;
      if (since < MIN_RESCAN_GAP_MS) {
        // Re-arm rather than drop it: the last frame of a flick-scroll is the one
        // that decides where the marks finally sit.
        rafRef.current = -1;
        setTimeout(() => { rafRef.current = 0; rescanRef.current?.(); }, MIN_RESCAN_GAP_MS - since);
        return;
      }
      lastScanRef.current = now;
      const budget = budgetRef.current;
      const t0 = performance.now();
      const next = scanTargets(budget.cap);
      const cost = performance.now() - t0;
      if (cost > SCAN_BUDGET_MS) {
        // Measure less OFTEN before marking less: a slower-following outline is a
        // far better trade than controls that silently have no marks at all.
        if (budget.gap < MAX_RESCAN_MS) budget.gap = Math.min(MAX_RESCAN_MS, budget.gap * 2);
        else budget.cap = Math.max(MIN_TARGETS, Math.round(budget.cap / 2));
        if (!budget.warned) {
          budget.warned = true;
          console.warn(`[edit mode] measuring this screen took ${Math.round(cost)}ms — thinning out to ${budget.cap} controls every ${budget.gap}ms so the page stays responsive`);
        }
      } else if (cost < SCAN_BUDGET_MS / 3 && (budget.cap < MAX_TARGETS || budget.gap > RESCAN_MS)) {
        if (budget.cap < MAX_TARGETS) budget.cap = Math.min(MAX_TARGETS, budget.cap * 2);
        else budget.gap = Math.max(RESCAN_MS, Math.round(budget.gap / 2));
      }
      const sig = signature(next);
      if (sig === sigRef.current) return;
      sigRef.current = sig;
      setTargets(next);
      // The summoned icons ride on the same measurement, so they follow their box
      // instead of drifting off it. A box that stopped being visible drops them.
      setActive(prev => (prev ? next.find(t => t.key === prev.key) || null : null));
    });
  }, []);

  rescanRef.current = rescan;

  // Scanning stops while the dialog is open: the marks are not interactive behind
  // a modal anyway, and md-dialog's own DOM churn was the loudest thing feeding
  // the loop above.
  const scanning = enabled && !draft;

  React.useEffect(() => {
    if (!scanning) {
      sigRef.current = '';
      if (!enabled) setTargets([]);
      return undefined;
    }
    rescan();
    // A plain interval cannot follow the adaptive gap, so re-arm each tick.
    let timer = 0;
    const tick = () => { rescan(); timer = setTimeout(tick, budgetRef.current.gap); };
    timer = setTimeout(tick, RESCAN_MS);
    window.addEventListener('scroll', rescan, { capture: true, passive: true });
    window.addEventListener('resize', rescan);
    const mo = new MutationObserver(records => {
      // Ignore our own repaints — see rule 3 in the header comment.
      for (const rec of records) {
        const node = rec.target instanceof Element ? rec.target : rec.target?.parentElement;
        if (node && !node.closest('[data-dev-edit-ui]')) { rescan(); return; }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', rescan, { capture: true });
      window.removeEventListener('resize', rescan);
      mo.disconnect();
      // A re-armed throttle may still be pending; clearing the ref is what stops it
      // firing into a torn-down overlay.
      rescanRef.current = null;
      if (rafRef.current > 0) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [scanning, enabled, rescan]);

  // ── Summoning the icons ─────────────────────────────────────────────────────
  // Right-click on a PC, press-and-hold on a touch screen. Both land on the app
  // itself (this layer never takes the pointer), so they are caught on the document
  // and mapped back to a control by point. Capture phase, because plenty of the
  // app's own rows stop these events on their way up.
  React.useEffect(() => {
    if (!enabled || draft) return undefined;

    const summon = (x, y) => {
      const t = targetAtPoint(x, y);
      setActive(t);
      return !!t;
    };

    const onContextMenu = e => {
      if (e.target?.closest?.('[data-dev-edit-ui]')) return;   // our own icons
      // The browser menu would cover the icons it just summoned.
      if (summon(e.clientX, e.clientY)) e.preventDefault();
    };

    let pressTimer = 0;
    let startX = 0, startY = 0;
    let summoned = false;
    const clearPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = 0; } };

    const onTouchStart = e => {
      if (e.touches.length !== 1) return;
      if (e.target?.closest?.('[data-dev-edit-ui]')) return;
      const { clientX, clientY } = e.touches[0];
      startX = clientX; startY = clientY; summoned = false;
      clearPress();
      pressTimer = setTimeout(() => {
        pressTimer = 0;
        summoned = summon(startX, startY);
        // A short buzz is the standard "you long-pressed something" feedback and is
        // the only signal a touch user gets that the icons are now live.
        if (summoned) { try { navigator.vibrate?.(12); } catch { /* not supported */ } }
      }, LONG_PRESS_MS);
    };
    const onTouchMove = e => {
      const t = e.touches[0];
      if (!t) return;
      if (Math.abs(t.clientX - startX) > LONG_PRESS_SLOP_PX || Math.abs(t.clientY - startY) > LONG_PRESS_SLOP_PX) clearPress();
    };
    const onTouchEnd = e => {
      clearPress();
      // Swallow the tap that a long-press would otherwise deliver to the app — the
      // press was aimed at the box, not at the button underneath it.
      if (summoned) { summoned = false; e.preventDefault(); e.stopPropagation(); }
    };

    // Anything else means "I'm done with that one".
    const onPointerDown = e => {
      if (e.target?.closest?.('[data-dev-edit-ui]')) return;
      setActive(null);
    };
    const onKeyDown = e => { if (e.key === 'Escape') setActive(null); };

    document.addEventListener('contextmenu', onContextMenu, true);
    document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    document.addEventListener('touchmove', onTouchMove, { capture: true, passive: true });
    document.addEventListener('touchend', onTouchEnd, true);
    document.addEventListener('touchcancel', clearPress, true);
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      clearPress();
      document.removeEventListener('contextmenu', onContextMenu, true);
      document.removeEventListener('touchstart', onTouchStart, { capture: true });
      document.removeEventListener('touchmove', onTouchMove, { capture: true });
      document.removeEventListener('touchend', onTouchEnd, true);
      document.removeEventListener('touchcancel', clearPress, true);
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [enabled, draft]);

  // Stable identities — a fresh arrow per render would defeat TargetFrame's memo.
  const openDraft = React.useCallback((mode, t) => {
    setDraft({ mode, ...t }); setNote(''); setReason('obsolete');
  }, []);
  const openEdit = React.useCallback(t => openDraft('edit', t), [openDraft]);
  const openDelete = React.useCallback(t => openDraft('delete', t), [openDraft]);

  // The ticket text is the whole point: everything needed to find this control
  // again is baked in, so a future session does not have to reconstruct it.
  // The write is raced against a timeout — Store.addBug awaits Firestore, and an
  // offline or blocked write otherwise leaves the dialog stuck on "Filing…" with
  // no way out, which reads as a frozen app.
  const submit = async () => {
    if (!draft || saving) return;
    setSaving(true);
    const trimmed = note.trim();
    const head = draft.mode === 'delete'
      ? `[Edit mode] Delete requested (${reason}) — “${draft.label}”`
      : `[Edit mode] Change requested — “${draft.label}”`;
    const text = [
      head,
      `Screen: ${screenName()} · ${window.innerWidth}×${window.innerHeight} · v${APP_VERSION}`,
      `Element: ${draft.path}`,
      `Note: ${trimmed || '(none given — the owner skipped the explanation)'}`,
    ].join('\n');
    let id = null;
    try {
      id = await Promise.race([
        Store.addBug({ text, type: 'idea' }),
        new Promise(resolve => setTimeout(() => resolve(null), 8000)),
      ]);
    } catch { id = null; }
    setSaving(false);
    setDraft(null);
    // The icons were summoned for this one box and the note is filed — put them away.
    setActive(null);
    setFlash(id ? 'Filed in the Bug Log.' : 'Could not save that — check the connection and try again.');
    setTimeout(() => setFlash(null), 4000);
  };

  if (!enabled) return null;

  const accent = C.accent || C.text;
  const danger = C.danger || C.warning || accent;
  const pencil = CAT_MAIL;
  const surface = C.bg || C.bgSoft;
  const label = { fontFamily: NC_FONT_STACK, fontSize: NC_TYPE.body, color: C.text };
  const help = { fontFamily: NC_FONT_STACK, fontSize: NC_TYPE.meta, color: C.muted, lineHeight: 1.5 };

  return createPortal(
    <div data-dev-edit-ui="true" style={{ position: 'fixed', inset: 0, zIndex: Z.systemBar, pointerEvents: 'none', fontFamily: NC_FONT_STACK }}>
      {/* One frame per control: a faint outline so you can see what is editable,
          with the pencil and the garbage can on its top corners. */}
      {targets.map(t => (
        <TargetFrame key={t.key} t={t} borderColor={C.divider} activeColor={pencil}
          active={active?.key === t.key} />
      ))}

      {/* The summoned pair — the only two web components this layer creates, and
          only for the box you long-pressed or right-clicked. On a narrow control
          they tuck to the outside edges so they do not sit on top of each other. */}
      {active && (() => {
        // Above the box when there is room, otherwise tucked inside its top corners
        // — a control at the very top of the window or of its card would otherwise
        // have its icons cut off.
        const above = active.top >= MARK_HIT_PX + 2;
        const y = above ? -MARK_HIT_PX : 0;
        const wide = active.width >= MARK_HIT_PX * 2 + 8;
        const x = wide ? 0 : -MARK_HIT_PX / 2;
        return (
        <div style={{
          position: 'absolute', top: active.top, left: active.left,
          width: active.width, height: active.height, pointerEvents: 'none',
        }}>
          <CornerMark icon="edit" color={pencil} title={`Suggest a change to “${active.label}”`}
            onClick={() => openEdit(active)}
            style={{ top: y, left: x }} />
          <CornerMark icon="delete" color={danger} title={`Ask to remove “${active.label}”`}
            onClick={() => openDelete(active)}
            style={{ top: y, right: x }} />
        </div>
        );
      })()}

      {/* Watermark — on every page, unmissable, never in the way. */}
      <div style={{
        position: 'fixed', top: SP.md, left: '50%', transform: 'translateX(-50%)',
        padding: `${SP.xs} ${SP.md}`, borderRadius: RADIUS.pill,
        background: C.text, color: surface, opacity: 0.78,
        fontSize: NC_TYPE.meta, letterSpacing: '0.14em', textTransform: 'uppercase',
        pointerEvents: 'none',
      }}>Edit mode — hold or right-click a box</div>

      {/* The floating way out. */}
      <div style={{ position: 'fixed', right: SP.lg, bottom: SP.lg, pointerEvents: 'auto' }}>
        <ActionBtn variant="filled" icon="close" containerColor={danger} labelColor={textOnColor(danger)} onClick={onExit}>
          Exit edit mode
        </ActionBtn>
      </div>

      {flash && (
        <div style={{
          position: 'fixed', left: '50%', bottom: SP.xxl, transform: 'translateX(-50%)',
          background: surface, color: C.text, border: `1px solid ${C.divider}`,
          borderRadius: RADIUS.sm, padding: `${SP.sm} ${SP.lg}`, boxShadow: ELEV[3],
          fontSize: NC_TYPE.body, pointerEvents: 'none',
        }}>{flash}</div>
      )}

      <Dialog open={!!draft} onClosed={() => { setDraft(null); setActive(null); }}
        style={{ '--md-dialog-container-color': surface, maxWidth: 'min(520px, 94vw)', minWidth: 'min(520px, 94vw)' }}>
        <div slot="headline" style={{ display: 'flex', alignItems: 'center', gap: SP.sm, ...label, fontSize: NC_TYPE.title }}>
          <span style={{ color: draft?.mode === 'delete' ? danger : pencil, display: 'inline-flex' }}>
            {suiteIcon(draft?.mode === 'delete' ? 'delete' : 'edit', 20)}
          </span>
          <span style={{ flex: 1 }}>{draft?.mode === 'delete' ? 'Remove this?' : 'What should change?'}</span>
        </div>
        <div slot="content" style={{ display: 'flex', flexDirection: 'column', gap: SP.md }}>
          <div style={help}>
            <div style={{ ...label, fontWeight: `var(--nc-fw-semibold, 600)` }}>{draft?.label}</div>
            <div>{draft?.path}</div>
          </div>

          {draft?.mode === 'delete' && (
            <OutlinedSelect label="Delete because" value={reason} onChange={e => setReason(e.target.value)} style={{ width: '100%' }}>
              {DELETE_REASONS.map(r => (
                <SelectOption key={r.value} value={r.value} selected={reason === r.value}>
                  <div slot="headline">{r.label}</div>
                </SelectOption>
              ))}
            </OutlinedSelect>
          )}

          {/* Always open, never required — the explanation can be skipped and the
              ticket still files with the control and the screen filled in. */}
          <TextField type="textarea" rows={3} label="Explain (optional)" value={note}
            onInput={e => setNote(e.target.value)} style={{ width: '100%' }} />
          <div style={help}>
            This box is always open — write as much or as little as you like, or leave a number and ask for a call.
          </div>

          {/* Submit sits under the box, as asked. */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <FilledIconButton title="Submit to the Bug Log" aria-label="Submit to the Bug Log"
              disabled={saving} onClick={submit}
              style={{ '--md-filled-icon-button-container-color': accent, '--md-filled-icon-button-icon-color': textOnColor(accent) }}>
              <span className="material-symbols-rounded">send</span>
            </FilledIconButton>
          </div>
        </div>
        <div slot="actions">
          <ActionBtn variant="text" labelColor={C.muted} onClick={() => { setDraft(null); setActive(null); }}>Cancel</ActionBtn>
          <ActionBtn variant="text" labelColor={accent} onClick={submit} disabled={saving}>
            {saving ? 'Filing…' : 'Skip & file'}
          </ActionBtn>
        </div>
      </Dialog>
    </div>,
    document.body,
  );
}

export { DevEditMode };
