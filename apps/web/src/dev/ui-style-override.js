// ─── UI Style Override — force every element to the master, with NO source edits ─
//
// WHAT THIS IS (plain English): the "enforcer". It reads the master clearinghouse
// (m3-stylebook.jsx → M3_SPEC) and, at runtime, forces every element it can
// identify (search boxes, inputs, filter chips, content rows, …) to the master's
// values. The page's own component code is never touched — this just overrides on
// top, live. Turn it on with ?uistyle=1 to SEE the whole app normalized; turn it
// off (remove the flag / reload) and everything reverts. Nothing is committed to
// the components, so it's fully reversible — a preview/enforce layer, not an edit.
//
// It overrides STRUCTURE only (radius / size / spacing / type), never color — the
// theme system already centralizes color, and forcing color risks white-on-white.

import { M3_SPEC } from '../08-app-split/m3-stylebook.jsx';

const PX = (n) => (typeof n === 'number' ? n + 'px' : n);
const CSSPROP = {
  borderRadius: 'border-radius', fontSize: 'font-size', fontWeight: 'font-weight',
  height: 'height', minHeight: 'min-height', width: 'width', padding: 'padding', gap: 'gap',
};

// For inputs the rounded "control" is usually a wrapper (label/div), not the bare
// field — climb to the nearest element that actually carries a background/border.
function styledContainer(el) {
  let n = el;
  for (let i = 0; i < 4 && n; i++) {
    const cs = getComputedStyle(n);
    const bg = cs.backgroundColor;
    const hasContainer = parseFloat(cs.borderTopWidth) > 0
      || (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent');
    if (hasContainer && n.offsetHeight >= el.offsetHeight) return n;
    n = n.parentElement;
  }
  return el;
}

const FILTER_RE = /^(all|missed|incoming|outgoing|unread|read|calls|messages|texts|sms|pinned|in|out|received|made)$/i;

// Map a DOM element to a master kind, or null. Conservative on purpose: only
// elements we can identify with confidence, so we never distort intentional ones.
function classify(el) {
  const tag = el.tagName;
  const hint = (el.getAttribute('placeholder') || el.getAttribute('aria-label') || '');
  if ((tag === 'INPUT' || tag === 'TEXTAREA') && /search/i.test(hint)) return 'searchField';
  if (tag === 'TEXTAREA') return 'textarea';
  if (tag === 'SELECT') return 'select';
  if (tag === 'INPUT') return ['text', 'tel', 'email', 'number', 'url', ''].includes(el.type) ? 'textField' : null;
  if (tag === 'BUTTON' && FILTER_RE.test(el.textContent.trim())) return 'filterChip';
  return null;
}

function applyOne(el, spec) {
  const isField = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
  const target = isField ? styledContainer(el) : el;
  for (const [k, v] of Object.entries(spec)) {
    const prop = CSSPROP[k];
    if (prop) target.style.setProperty(prop, PX(v), 'important');
  }
  if (isField && spec.fontSize != null) el.style.setProperty('font-size', PX(spec.fontSize), 'important');
  target.setAttribute('data-m3', el.tagName === 'BUTTON' ? 'filterChip' : (classify(el) || '1'));
}

let count = 0;
export function normalize(root = document) {
  count = 0;
  try {
    root.querySelectorAll('input, textarea, select, button').forEach((el) => {
      const kind = classify(el);
      if (kind && M3_SPEC[kind]) { applyOne(el, M3_SPEC[kind]); count++; }
    });
  } catch (e) { console.warn('[ui-style]', e); }
  return count;
}

let running = false, obs = null, t = null;
export function startUiStyle() {
  if (running) return; running = true;
  // Disconnect while we write (our own style writes would otherwise retrigger the
  // observer forever); reconnect after, so React re-renders still get re-normalized.
  const pass = () => { if (obs) obs.disconnect(); normalize(); if (obs) obs.observe(document.body, OBS); };
  const OBS = { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'placeholder'] };
  const begin = () => {
    normalize();
    obs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(pass, 200); });
    obs.observe(document.body, OBS);
  };
  if (document.body) begin(); else window.addEventListener('DOMContentLoaded', begin);
  window.uiStyle = { normalize, off: () => { obs && obs.disconnect(); running = false; console.log('[ui-style] off — reload to fully revert'); } };
  console.log('%c[ui-style] master override ON — classified elements forced to the M3 master (structure only)', 'color:#00796B;font-weight:bold');
}

export default startUiStyle;
