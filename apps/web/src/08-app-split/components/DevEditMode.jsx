// ─── Dev edit mode ────────────────────────────────────────────────────────────
//
// WHAT THIS IS (plain English): a switch in Settings that puts the whole app into
// "tell me what's wrong with this" mode. Every button and every text box grows two
// little bubbles, exactly like wiggling apps on an iPhone home screen — a pencil
// ("change this") and a garbage can ("this shouldn't be here"). The app keeps
// working normally the whole time; the bubbles float on a layer above it. Whatever
// the owner types goes straight into the Bug Log as a ticket, with the button's
// name, the screen it was on and the app version already filled in, so it can be
// found again later without anybody having to remember the context.
//
// HOW IT WORKS: one fixed overlay layer (`pointer-events: none`) sits above the
// app and paints a pair of bubbles over the rectangle of every interactive element
// found by `document.querySelectorAll`. Nothing about the app's own markup changes
// — no component had to be touched to take part, which is the only way "every
// single button or input field" is achievable across a 5,000-line surface. The
// rectangles are re-measured on scroll, resize, DOM mutation and on a slow timer,
// all funnelled through one rAF so a busy screen cannot thrash.
//
// Only the outermost match gets bubbles: an <md-icon-button> is one control, not a
// host element plus its inner shadow button, and a row that is itself a button
// swallows its children. Anything inside this overlay is skipped by the
// `[data-dev-edit-ui]` marker, so the bubbles never grow bubbles.

import React from 'react';
import { createPortal } from 'react-dom';
import { NC_FONT_STACK, NC_TYPE, RADIUS, SP, ELEV, Z, suiteIcon } from '../ui-tokens.jsx';
import { APP_VERSION } from '../../version.js';
import { Store, textOnColor } from '../../01-core.js';
import { Dialog, TextField, ActionBtn, FilledIconButton, OutlinedSelect, SelectOption } from '../m3.jsx';

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
// something worth hanging two bubbles on.
const MIN_TARGET_PX = 12;
// Hard ceiling so a pathological screen cannot paint thousands of bubbles.
const MAX_TARGETS = 400;
const RESCAN_MS = 600;
const BUBBLE = 22;
// Glyph px inside a bubble. Held in a constant, not inline, so the size lives in one
// place alongside the container it has to fit.
const BUBBLE_ICON_CSS = `${22 - 10}px`;

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
    if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue;
    out.push({
      key: `${out.length}:${Math.round(r.left)}:${Math.round(r.top)}:${Math.round(r.width)}`,
      top: r.top, left: r.left, width: r.width, height: r.height,
      label: labelFor(el), path: pathFor(el), tag: el.tagName.toLowerCase(),
    });
  }
  return out;
}

// One bubble. Real M3 icon button, shrunk to badge size through its own container
// tokens — a hand-rolled circle would be a lookalike, which the M3 rule forbids.
function Bubble({ icon, color, onColor, title, onClick, style }) {
  return (
    <FilledIconButton
      title={title}
      aria-label={title}
      onClick={e => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      style={{
        position: 'absolute',
        pointerEvents: 'auto',
        '--md-filled-icon-button-container-width': `${BUBBLE}px`,
        '--md-filled-icon-button-container-height': `${BUBBLE}px`,
        '--md-filled-icon-button-container-color': color,
        '--md-filled-icon-button-icon-color': onColor,
        '--md-icon-button-icon-size': BUBBLE_ICON_CSS,
        boxShadow: ELEV[2],
        borderRadius: RADIUS.pill,
        ...style,
      }}
    >
      <span className="material-symbols-rounded" style={{ fontSize: BUBBLE_ICON_CSS }}>{icon}</span>
    </FilledIconButton>
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

  // One rAF-coalesced rescan, shared by the timer, scroll, resize and the
  // MutationObserver. Without the coalescing a typing burst would re-measure
  // hundreds of rectangles per keystroke.
  const rescan = React.useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setTargets(scanTargets());
    });
  }, []);

  React.useEffect(() => {
    if (!enabled) { setTargets([]); setDraft(null); return undefined; }
    rescan();
    const timer = setInterval(rescan, RESCAN_MS);
    window.addEventListener('scroll', rescan, true);
    window.addEventListener('resize', rescan);
    const mo = new MutationObserver(rescan);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    return () => {
      clearInterval(timer);
      window.removeEventListener('scroll', rescan, true);
      window.removeEventListener('resize', rescan);
      mo.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [enabled, rescan]);

  const openDraft = (mode, t) => { setDraft({ mode, ...t }); setNote(''); setReason('obsolete'); };

  // The ticket text is the whole point: everything needed to find this control
  // again is baked in, so a future session does not have to reconstruct it.
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
    const id = await Store.addBug({ text, type: 'idea' });
    setSaving(false);
    setDraft(null);
    setFlash(id ? 'Filed in the Bug Log.' : 'Could not save that — check the connection and try again.');
    setTimeout(() => setFlash(null), 4000);
  };

  if (!enabled) return null;

  const accent = C.accent || C.text;
  const danger = C.danger || C.warning || accent;
  const surface = C.bg || C.bgSoft;
  const label = { fontFamily: NC_FONT_STACK, fontSize: NC_TYPE.body, color: C.text };
  const help = { fontFamily: NC_FONT_STACK, fontSize: NC_TYPE.meta, color: C.muted, lineHeight: 1.5 };

  return createPortal(
    <div data-dev-edit-ui="true" style={{ position: 'fixed', inset: 0, zIndex: Z.systemBar, pointerEvents: 'none', fontFamily: NC_FONT_STACK }}>
      {/* Bubbles — pencil top-left, garbage can top-right, straddling the control's
          own corners the way a home-screen delete badge does. */}
      {targets.map(t => (
        <React.Fragment key={t.key}>
          <Bubble icon="edit" color={accent} onColor={textOnColor(accent)} title={`Suggest a change to “${t.label}”`}
            onClick={() => openDraft('edit', t)}
            style={{ top: t.top - BUBBLE / 2, left: t.left - BUBBLE / 2 }} />
          <Bubble icon="delete" color={danger} onColor={textOnColor(danger)} title={`Ask to remove “${t.label}”`}
            onClick={() => openDraft('delete', t)}
            style={{ top: t.top - BUBBLE / 2, left: t.left + t.width - BUBBLE / 2 }} />
        </React.Fragment>
      ))}

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
          background: surface, color: C.text, border: `1px solid ${C.divider || C.brdS}`,
          borderRadius: RADIUS.sm, padding: `${SP.sm} ${SP.lg}`, boxShadow: ELEV[3],
          fontSize: NC_TYPE.body, pointerEvents: 'none',
        }}>{flash}</div>
      )}

      <Dialog open={!!draft} onClosed={() => setDraft(null)}
        style={{ '--md-dialog-container-color': surface, maxWidth: 'min(520px, 94vw)', minWidth: 'min(520px, 94vw)' }}>
        <div slot="headline" style={{ display: 'flex', alignItems: 'center', gap: SP.sm, ...label, fontSize: NC_TYPE.title }}>
          <span style={{ color: draft?.mode === 'delete' ? danger : accent, display: 'inline-flex' }}>
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
