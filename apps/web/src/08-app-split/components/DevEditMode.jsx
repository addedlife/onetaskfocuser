// ─── Dev edit mode ────────────────────────────────────────────────────────────
//
// WHAT THIS IS (plain English): a switch in Settings that puts the whole app into
// "tell me what's wrong with this" mode. Every button and every text box gets a
// faint outline, a small blue pencil in its top-left corner ("change this") and a
// small red garbage can in its top-right ("this shouldn't be here"). The app keeps
// working normally the whole time; the marks float on a layer above it. Whatever
// the owner types goes straight into the Bug Log as a ticket, with the button's
// name, the screen it was on and the app version already filled in, so it can be
// found again later without anybody having to remember the context.
//
// HOW IT WORKS: one fixed overlay layer (`pointer-events: none`) sits above the
// app and paints a frame over the rectangle of every interactive element found by
// `document.querySelectorAll`. Nothing about the app's own markup changes — no
// component had to be touched to take part, which is the only way "every single
// button or input field" is achievable across a 5,000-line surface. Rectangles are
// re-measured on scroll, resize, DOM mutation and on a slow timer, all funnelled
// through one rAF.
//
// THREE RULES LEARNED THE HARD WAY (owner, 8/6 — "one massive clutter of red and
// blue circles", and the app froze on submit):
//
//   1. No filled circles. Bare glyphs — a blue pencil and a red garbage can —
//      because 200 filled badges on one screen read as confetti, not as controls.
//   2. A control that is scrolled out of its own list must lose its marks too. The
//      viewport is not the only clipper: a card body with its own scrollbar hides
//      rows that are still inside the window, and marks for those rows used to
//      float over the card's header. `clipRectFor` intersects every scrollable
//      ancestor, so a mark appears exactly when the row it belongs to is showing.
//   3. Never let this overlay observe itself. The MutationObserver watches
//      document.body, and this overlay lives IN document.body — so every repaint
//      of the marks fed the observer, which rescanned, which repainted. That loop
//      ran at frame rate and is what locked the page up when the dialog opened.
//      Mutations inside `[data-dev-edit-ui]` are now ignored, an unchanged
//      measurement no longer sets state at all, and scanning stops entirely while
//      the dialog is open.

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
].join(',');

// A rectangle smaller than this is a decoration or a collapsed control, not
// something worth marking.
const MIN_TARGET_PX = 12;
// Hard ceiling so a pathological screen cannot paint thousands of marks.
const MAX_TARGETS = 400;
const RESCAN_MS = 600;
// Glyph and hit-target px for a corner mark. Constants, not inline literals, so the
// two sizes stay in step with the inset that positions them.
const MARK_ICON_CSS = '15px';
const MARK_HIT_CSS = '20px';
const MARK_HIT_PX = 20;

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

// Collect every visible control, outermost only, excluding our own chrome.
function scanTargets() {
  const out = [];
  let nodes;
  try { nodes = document.querySelectorAll(TARGET_SELECTOR); } catch { return out; }
  for (const el of nodes) {
    if (out.length >= MAX_TARGETS) break;
    if (el.closest('[data-dev-edit-ui]')) continue;
    // Outermost match only — the parent chain already owns this rectangle.
    if (el.parentElement && el.parentElement.closest(TARGET_SELECTOR)) continue;
    if (el.disabled) continue;
    const r = el.getBoundingClientRect();
    if (r.width < MIN_TARGET_PX || r.height < MIN_TARGET_PX) continue;

    // The marks live on the top corners, so the top edge is what has to be
    // showing. A row scrolled under its card header, or past the bottom of the
    // card, drops its marks the same moment it stops being readable.
    const clip = clipRectFor(el);
    if (r.top < clip.top - 1 || r.top > clip.bottom - MIN_TARGET_PX) continue;
    if (r.right < clip.left || r.left > clip.right) continue;

    // Frame is clamped to the visible slice so a half-scrolled row is outlined
    // only as far as it actually shows.
    const top = Math.max(r.top, clip.top);
    const left = Math.max(r.left, clip.left);
    const width = Math.min(r.right, clip.right) - left;
    const height = Math.min(r.bottom, clip.bottom) - top;
    if (width < MIN_TARGET_PX || height < 4) continue;

    out.push({
      key: `${out.length}:${Math.round(left)}:${Math.round(top)}:${Math.round(width)}`,
      top, left, width, height,
      label: labelFor(el), path: pathFor(el), tag: el.tagName.toLowerCase(),
    });
  }
  return out;
}

// Cheap identity for a measurement, so an unchanged screen never sets state and
// therefore never re-enters the mutation → rescan → repaint loop.
function signature(list) {
  let s = '';
  for (const t of list) s += `${t.key}|${Math.round(t.height)};`;
  return s;
}

// One corner mark. A real M3 icon button in its plain (standard) variant, which has
// no container fill at all — a bare glyph with a hover state layer. The filled
// variant is what turned a busy screen into "a massive clutter of red and blue
// circles"; this is the same control without the badge.
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

function DevEditMode({ enabled = false, T = {}, onExit }) {
  const C = T;
  const [targets, setTargets] = React.useState([]);
  // { mode: 'edit' | 'delete', label, path, tag }
  const [draft, setDraft] = React.useState(null);
  const [note, setNote] = React.useState('');
  const [reason, setReason] = React.useState('obsolete');
  const [saving, setSaving] = React.useState(false);
  const [flash, setFlash] = React.useState(null);
  const rafRef = React.useRef(0);
  const sigRef = React.useRef('');

  // One rAF-coalesced rescan, shared by the timer, scroll, resize and the
  // MutationObserver. It sets state only when the measurement actually changed —
  // without that, painting the marks mutates the DOM, which wakes the observer,
  // which rescans, which repaints, forever.
  const rescan = React.useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const next = scanTargets();
      const sig = signature(next);
      if (sig === sigRef.current) return;
      sigRef.current = sig;
      setTargets(next);
    });
  }, []);

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
    const timer = setInterval(rescan, RESCAN_MS);
    window.addEventListener('scroll', rescan, true);
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
      clearInterval(timer);
      window.removeEventListener('scroll', rescan, true);
      window.removeEventListener('resize', rescan);
      mo.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [scanning, enabled, rescan]);

  const openDraft = (mode, t) => { setDraft({ mode, ...t }); setNote(''); setReason('obsolete'); };

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
      {targets.map(t => {
        // On a narrow control the two marks would sit on top of each other, so they
        // tuck to the outside edges instead of the inside corners.
        const roomy = t.width >= MARK_HIT_PX * 2 + 8;
        const inset = roomy ? 0 : -MARK_HIT_PX / 2;
        return (
          <div key={t.key} style={{
            position: 'absolute', top: t.top, left: t.left, width: t.width, height: t.height,
            // Faint, not decorative: the outline says "this is a thing you can point
            // at". Opacity stays off the wrapper so it cannot wash out the two marks.
            border: `1px dashed ${C.divider}`, borderRadius: RADIUS.xs,
            pointerEvents: 'none', boxSizing: 'border-box',
          }}>
            <CornerMark icon="edit" color={pencil} title={`Suggest a change to “${t.label}”`}
              onClick={() => openDraft('edit', t)}
              style={{ top: 0, left: inset }} />
            <CornerMark icon="delete" color={danger} title={`Ask to remove “${t.label}”`}
              onClick={() => openDraft('delete', t)}
              style={{ top: 0, right: inset }} />
          </div>
        );
      })}

      {/* Watermark — on every page, unmissable, never in the way. */}
      <div style={{
        position: 'fixed', top: SP.md, left: '50%', transform: 'translateX(-50%)',
        padding: `${SP.xs} ${SP.md}`, borderRadius: RADIUS.pill,
        background: C.text, color: surface, opacity: 0.78,
        fontSize: NC_TYPE.meta, letterSpacing: '0.14em', textTransform: 'uppercase',
        pointerEvents: 'none',
      }}>Edit mode</div>

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

      <Dialog open={!!draft} onClosed={() => setDraft(null)}
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
          <ActionBtn variant="text" labelColor={C.muted} onClick={() => setDraft(null)}>Cancel</ActionBtn>
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
