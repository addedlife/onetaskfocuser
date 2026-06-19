// ─── UI Drift Logger ──────────────────────────────────────────────────────────
//
// WHAT THIS IS (plain English): a dev-only watchdog. As you use the app, it looks
// at every search box, filter button, button, and list row, measures how it's
// actually drawn (corner radius, height, font size), and records every spot that
// DIVERGES from the master stylebook (m3-stylebook.jsx). The list grows over time
// and is saved in the browser, so it becomes the to-do list for swapping locals
// over to the master — exactly the "log of locals vs master" plan.
//
// SAFETY: read-only. It never changes how anything looks or behaves. It only runs
// when the app is opened with ?uiaudit=1, and it's loaded lazily so production is
// untouched. Inspect results any time with:  uiAudit.report()
//
// It compares STRUCTURE only (radius / height / font size), never color — the
// theme system owns color.

import { M3_EXPECT } from '../08-app-split/m3-stylebook.jsx';

const LS_KEY = '__ui_audit_v1';
const PILL_MIN = 100; // computed radius >= this (px) counts as a "pill"

const px = (v) => Math.round(parseFloat(v) || 0);
const radiusBucket = (r, h) => (r >= PILL_MIN || (h && r >= h / 2 - 1)) ? 'pill' : `${r}px`;

function load() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; } }
function save(d) { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch {} }

// Classify a visible element into one of the master's element kinds, or null.
function classify(el) {
  const tag = el.tagName;
  const text = (el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.textContent || '').trim();
  if ((tag === 'INPUT' || tag === 'TEXTAREA') && /search/i.test(el.getAttribute('placeholder') || el.getAttribute('aria-label') || ''))
    return { kind: 'searchField', label: text.slice(0, 40) };
  if (tag === 'BUTTON' && /^(all|missed|incoming|outgoing|unread|read|calls|messages|texts|sms|pinned|in|out|received|made)$/i.test(text))
    return { kind: 'filterChip', label: text.slice(0, 24) };
  return null;
}

// The visible "control" (rounded border, background) is often a WRAPPER around
// the bare <input>, so climb up to the nearest element that actually carries a
// border / background / radius and measure THAT — otherwise we'd miss pill-vs-box.
function controlSurface(el) {
  let n = el;
  for (let i = 0; i < 4 && n; i++) {
    const cs = getComputedStyle(n);
    // Require a real container (background or border) — NOT radius alone, since a
    // bare input may carry its own radius and we'd stop too early on it.
    const bg = cs.backgroundColor;
    const hasContainer = px(cs.borderTopWidth) > 0
      || (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent');
    if (hasContainer && n.offsetHeight >= el.offsetHeight) return n;
    n = n.parentElement;
  }
  return el;
}

function measure(el) {
  const surface = el.tagName === 'BUTTON' ? el : controlSurface(el);
  const cs = getComputedStyle(surface);
  const h = surface.offsetHeight;
  const r = px(cs.borderTopLeftRadius);
  return { radius: radiusBucket(r, h), radiusPx: r, height: h, fontSize: px(getComputedStyle(el).fontSize) };
}

// One scan pass: walk the DOM, group by kind, fold findings into the saved log.
export function scanUiAudit() {
  const data = load();
  const groups = {}; // kind -> { variants: Set, samples: [] }

  document.querySelectorAll('input, textarea, button').forEach((el) => {
    if (!el.offsetParent && el.offsetHeight === 0) return; // skip hidden
    const c = classify(el);
    if (!c) return;
    const m = measure(el);
    (groups[c.kind] ||= { variants: {}, samples: [] });
    const sig = `${m.radius}|${m.height}|${m.fontSize}`;
    groups[c.kind].variants[sig] = (groups[c.kind].variants[sig] || 0) + 1;
    groups[c.kind].samples.push({ label: c.label, ...m });
  });

  Object.entries(groups).forEach(([kind, g]) => {
    const expect = M3_EXPECT[kind] || {};
    const rec = (data[kind] ||= { firstSeen: Date.now(), variants: {}, master: expect, vsMaster: [] });
    Object.assign(rec.variants, g.variants); // accumulate variants seen over time
    // Flag every distinct local that doesn't match the master structure.
    g.samples.forEach((s) => {
      const wantPill = expect.borderRadius >= PILL_MIN;
      const radiusOff = wantPill ? s.radius !== 'pill' : (expect.borderRadius != null && s.radiusPx !== expect.borderRadius);
      const fontOff = expect.fontSize != null && s.fontSize !== expect.fontSize;
      const heightOff = expect.height != null && Math.abs(s.height - expect.height) > 4;
      if (radiusOff || fontOff || heightOff) {
        const key = `${s.label}|${s.radius}|${s.height}|${s.fontSize}`;
        if (!rec.vsMaster.some((v) => v.key === key))
          rec.vsMaster.push({ key, label: s.label, local: { radius: s.radius, height: s.height, fontSize: s.fontSize },
            master: { radius: wantPill ? 'pill' : expect.borderRadius, height: expect.height, fontSize: expect.fontSize } });
      }
    });
  });

  save(data);
  return data;
}

// Pretty console report of everything found so far.
function report() {
  const data = load();
  console.group('%cUI Drift Audit — locals vs master', 'font-weight:bold;font-size:13px');
  Object.entries(data).forEach(([kind, rec]) => {
    const variants = Object.keys(rec.variants);
    console.log(`%c${kind}%c — ${variants.length} distinct style(s) seen${variants.length > 1 ? '  ⚠ INCONSISTENT' : ''}`,
      'font-weight:bold', 'color:inherit');
    console.table(variants.map((v) => { const [radius, height, fontSize] = v.split('|'); return { radius, height: height + 'px', fontSize: fontSize + 'px', count: rec.variants[v] }; }));
    if (rec.vsMaster.length) {
      console.log(`  ${rec.vsMaster.length} element(s) differ from master:`);
      console.table(rec.vsMaster.map((v) => ({ element: v.label, localRadius: v.local.radius, masterRadius: v.master.radius, localFont: v.local.fontSize, masterFont: v.master.fontSize })));
    }
  });
  console.groupEnd();
  return data;
}

export function startUiAudit() {
  if (window.__uiAuditStarted) return;
  window.__uiAuditStarted = true;
  const run = () => { try { scanUiAudit(); } catch (e) { console.warn('[ui-audit]', e); } };
  // Scan now, then re-scan (debounced) whenever the DOM changes, so new surfaces
  // (messages view, dialer, etc.) get audited as you navigate to them.
  let t; const obs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(run, 600); });
  const begin = () => { run(); obs.observe(document.body, { childList: true, subtree: true }); };
  if (document.body) begin(); else window.addEventListener('DOMContentLoaded', begin);
  window.uiAudit = { report, scan: scanUiAudit, clear: () => { localStorage.removeItem(LS_KEY); console.log('[ui-audit] cleared'); } };
  console.log('%c[ui-audit] running — call uiAudit.report() to see the locals-vs-master list', 'color:#00796B');
}

export default startUiAudit;
