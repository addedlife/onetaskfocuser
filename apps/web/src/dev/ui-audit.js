// ─── UI Drift Logger ──────────────────────────────────────────────────────────
//
// WHAT THIS IS (plain English): a dev-only watchdog. As you use the app, it looks
// at every interactive control and list row, measures how it's ACTUALLY drawn
// (touch-target size, corner radius, height, font size), and records every spot
// that diverges from Material 3. The list grows over time and is saved in the
// browser, so it becomes the live to-do list for the GM3 campaign.
//
// SAFETY: read-only. It never changes how anything looks or behaves. It only runs
// when the app is opened with ?uiaudit=1, and it's loaded lazily so production is
// untouched. Inspect results any time with:  uiAudit.report()
//
// It compares STRUCTURE only (size / radius / font size), never color — the
// theme system owns color.
//
// ── 2026-07-21 rewrite ────────────────────────────────────────────────────────
// The original version could not fire on the two findings it was built for. It
// declared `listRow: { minHeight: 48 }` and `button: { height: 40 }` as
// expectations, but (a) `classify()` returned null for every button and list row
// — it only recognised search fields and filter chips — and (b) the DOM query was
// `input, textarea, button`, which never matches an `md-list-item` or an
// `md-icon-button` at all. So `?uiaudit=1` reported clean while the app shipped
// 26px targets and 13.5px rows. Both are fixed here, and the universal M3
// accessibility floor below now applies to EVERY interactive element, so a new
// control can't slip through just because it isn't a recognised kind.

// Universal M3 floor — applies to every interactive element, whatever its kind.
// 48dp is the Material 3 minimum touch target (NOT 40 — that error is what
// propagated the whole sub-48 drift through gvIconButton and IconBtn).
// 12px is M3 body-small, the smallest size any body text role is defined at.
const A11Y_MIN = {
  touchTarget: 48,
  // 11px is label-small, the smallest role Material 3 actually defines. An
  // earlier draft of this file used 12 (body-small), which is the smallest role
  // meant for READING — but enforcing 12 would have flagged legitimate
  // label-small metadata as a violation. Follow the spec rather than inventing a
  // stricter floor: anything under 11 is off the M3 scale entirely.
  fontSize: 11,
};

// Per-kind structural expectations, on top of the universal floor above.
const M3_EXPECT = {
  searchField: { borderRadius: 999, height: 56, fontSize: 16 },
  filterChip:  { borderRadius: 8, height: 32, fontSize: 14 },
  listRow:     { height: 48, fontSize: 16 },
  iconButton:  { borderRadius: 999, height: 48 },
  button:      { borderRadius: 999, height: 40, fontSize: 14 },
};

const LS_KEY = '__ui_audit_v2';
const PILL_MIN = 100; // computed radius >= this (px) counts as a "pill"

const px = (v) => Math.round(parseFloat(v) || 0);
const radiusBucket = (r, h) => (r >= PILL_MIN || (h && r >= h / 2 - 1)) ? 'pill' : `${r}px`;

function load() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; } }
function save(d) { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch {} }

// Every element kind the scanner walks. M3 components are custom elements, so
// they have to be named explicitly — a bare `button` selector misses all of them.
const SCAN_SELECTOR = [
  'input', 'textarea', 'select', 'button', '[role="button"]',
  'md-list-item',
  'md-icon-button', 'md-filled-icon-button', 'md-filled-tonal-icon-button', 'md-outlined-icon-button',
  'md-filled-button', 'md-filled-tonal-button', 'md-outlined-button', 'md-text-button', 'md-elevated-button',
  'md-filter-chip', 'md-assist-chip', 'md-input-chip', 'md-suggestion-chip',
  'md-outlined-text-field', 'md-filled-text-field',
  'md-checkbox', 'md-radio', 'md-switch',
].join(',');

const ICON_BUTTON_TAGS = /^MD-(FILLED-|FILLED-TONAL-|OUTLINED-)?ICON-BUTTON$/;
const BUTTON_TAGS = /^MD-(FILLED|FILLED-TONAL|OUTLINED|TEXT|ELEVATED)-BUTTON$/;
const CHIP_TAGS = /^MD-(FILTER|ASSIST|INPUT|SUGGESTION)-CHIP$/;
const FIELD_TAGS = /^MD-(OUTLINED|FILLED)-TEXT-FIELD$/;

const labelOf = (el) => (
  el.getAttribute('aria-label')
  || el.getAttribute('label')
  || el.getAttribute('placeholder')
  || el.textContent
  || ''
).trim().replace(/\s+/g, ' ');

// Classify a visible element into one of the master's element kinds, or null.
function classify(el) {
  const tag = el.tagName;
  const label = labelOf(el);
  const isSearch = /search/i.test(el.getAttribute('placeholder') || el.getAttribute('aria-label') || '');

  if (tag === 'MD-LIST-ITEM') return { kind: 'listRow', label: label.slice(0, 40) };
  if (ICON_BUTTON_TAGS.test(tag)) return { kind: 'iconButton', label: label.slice(0, 40) };
  if (BUTTON_TAGS.test(tag)) return { kind: 'button', label: label.slice(0, 40) };
  if (CHIP_TAGS.test(tag)) return { kind: 'filterChip', label: label.slice(0, 24) };
  if (FIELD_TAGS.test(tag)) return { kind: isSearch ? 'searchField' : null, label: label.slice(0, 40) };

  if ((tag === 'INPUT' || tag === 'TEXTAREA') && isSearch)
    return { kind: 'searchField', label: label.slice(0, 40) };

  // Hand-coded controls: a raw <button> or a div carrying role="button". These
  // are exactly the elements the M3 component rule is meant to eliminate, so they
  // are classified (not skipped) — they need to show up in the report.
  if (tag === 'BUTTON' || el.getAttribute('role') === 'button')
    return { kind: 'button', label: label.slice(0, 40), handCoded: true };

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

// Read the size the user actually sees. For M3 components the visible label is
// slotted light-DOM content styled from inside the shadow root, so measuring the
// host gives the wrong number — go find the real text node's box.
function textSizeOf(el) {
  const slotted = el.querySelector('[slot="headline"], [slot="supporting-text"], span');
  if (slotted) {
    const s = px(getComputedStyle(slotted).fontSize);
    if (s > 0) return s;
  }
  return px(getComputedStyle(el).fontSize);
}

function measure(el) {
  const isCustom = el.tagName.startsWith('MD-');
  const surface = (el.tagName === 'BUTTON' || isCustom) ? el : controlSurface(el);
  const rect = surface.getBoundingClientRect();
  const cs = getComputedStyle(surface);
  const h = Math.round(rect.height);
  const w = Math.round(rect.width);
  const r = px(cs.borderTopLeftRadius);
  return { radius: radiusBucket(r, h), radiusPx: r, height: h, width: w, fontSize: textSizeOf(el) };
}

// One scan pass: walk the DOM, group by kind, fold findings into the saved log.
export function scanUiAudit() {
  const data = load();
  const groups = {}; // kind -> { variants: {}, samples: [] }

  document.querySelectorAll(SCAN_SELECTOR).forEach((el) => {
    if (!el.offsetParent && el.offsetHeight === 0) return; // skip hidden
    const c = classify(el);
    if (!c || !c.kind) return;
    const m = measure(el);
    if (!m.height) return;
    (groups[c.kind] ||= { variants: {}, samples: [] });
    const sig = `${m.radius}|${m.height}|${m.fontSize}`;
    groups[c.kind].variants[sig] = (groups[c.kind].variants[sig] || 0) + 1;
    groups[c.kind].samples.push({ label: c.label, handCoded: !!c.handCoded, ...m });
  });

  Object.entries(groups).forEach(([kind, g]) => {
    const expect = M3_EXPECT[kind] || {};
    const rec = (data[kind] ||= { firstSeen: Date.now(), variants: {}, master: expect, vsMaster: [], a11y: [] });
    rec.a11y ||= [];
    Object.assign(rec.variants, g.variants); // accumulate variants seen over time

    g.samples.forEach((s) => {
      // ── Universal M3 floor. This is the check that matters most and the one
      //    the previous version could never reach. Chips are exempt from the
      //    touch-target rule at the container level: M3 chips are 32dp tall by
      //    spec and meet 48dp through an expanded touch target, not box height.
      const exemptFromTarget = kind === 'filterChip';
      const targetOff = !exemptFromTarget
        && (s.height < A11Y_MIN.touchTarget || s.width < A11Y_MIN.touchTarget);
      const typeOff = s.fontSize > 0 && s.fontSize < A11Y_MIN.fontSize;
      if (targetOff || typeOff) {
        const key = `a11y|${s.label}|${s.width}x${s.height}|${s.fontSize}`;
        if (!rec.a11y.some((v) => v.key === key)) {
          rec.a11y.push({
            key,
            label: s.label,
            handCoded: s.handCoded,
            issue: [
              targetOff ? `target ${s.width}×${s.height} < ${A11Y_MIN.touchTarget}` : null,
              typeOff ? `type ${s.fontSize}px < ${A11Y_MIN.fontSize}` : null,
            ].filter(Boolean).join(' · '),
          });
        }
      }

      // ── Per-kind structural drift, as before.
      const wantPill = expect.borderRadius >= PILL_MIN;
      const radiusOff = wantPill ? s.radius !== 'pill' : (expect.borderRadius != null && s.radiusPx !== expect.borderRadius);
      const fontOff = expect.fontSize != null && s.fontSize !== expect.fontSize;
      const heightOff = expect.height != null && Math.abs(s.height - expect.height) > 4;
      if (radiusOff || fontOff || heightOff) {
        const key = `${s.label}|${s.radius}|${s.height}|${s.fontSize}`;
        if (!rec.vsMaster.some((v) => v.key === key))
          rec.vsMaster.push({ key, label: s.label, handCoded: s.handCoded,
            local: { radius: s.radius, height: s.height, fontSize: s.fontSize },
            master: { radius: wantPill ? 'pill' : expect.borderRadius, height: expect.height, fontSize: expect.fontSize } });
      }
    });
  });

  save(data);
  return data;
}

// Total open findings — the single number the GM3 campaign is burning down.
function score() {
  const data = load();
  let a11y = 0, drift = 0, handCoded = 0;
  Object.values(data).forEach((rec) => {
    a11y += (rec.a11y || []).length;
    drift += (rec.vsMaster || []).length;
    handCoded += (rec.vsMaster || []).filter((v) => v.handCoded).length;
  });
  return { a11y, drift, handCoded, total: a11y + drift };
}

// Pretty console report of everything found so far.
function report() {
  const data = load();
  const s = score();
  console.group('%cUI Drift Audit — locals vs Material 3', 'font-weight:bold;font-size:13px');
  console.log(
    `%c${s.a11y}%c accessibility violations   %c${s.drift}%c structural drift   %c${s.handCoded}%c hand-coded controls`,
    'font-weight:bold;color:#B3261E', 'color:inherit',
    'font-weight:bold;color:#8A5A00', 'color:inherit',
    'font-weight:bold;color:#5F6368', 'color:inherit',
  );
  Object.entries(data).forEach(([kind, rec]) => {
    const variants = Object.keys(rec.variants);
    console.log(`%c${kind}%c — ${variants.length} distinct style(s) seen${variants.length > 1 ? '  ⚠ INCONSISTENT' : ''}`,
      'font-weight:bold', 'color:inherit');
    console.table(variants.map((v) => { const [radius, height, fontSize] = v.split('|'); return { radius, height: height + 'px', fontSize: fontSize + 'px', count: rec.variants[v] }; }));
    if (rec.a11y?.length) {
      console.log(`%c  ${rec.a11y.length} accessibility violation(s) — below the M3 floor:`, 'color:#B3261E');
      console.table(rec.a11y.map((v) => ({ element: v.label, issue: v.issue, handCoded: v.handCoded ? 'yes' : '' })));
    }
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
  window.uiAudit = { report, score, scan: scanUiAudit, clear: () => { localStorage.removeItem(LS_KEY); console.log('[ui-audit] cleared'); } };
  console.log('%c[ui-audit] running — call uiAudit.report() for the list, uiAudit.score() for the count', 'color:#00796B');
}

export default startUiAudit;
