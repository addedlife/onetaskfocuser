import React from 'react';
import { createComponent } from '@lit/react';
import { MdFab } from '@material/web/fab/fab.js';
import { MdOutlinedTextField } from '@material/web/textfield/outlined-text-field.js';
import { MdOutlinedSelect } from '@material/web/select/outlined-select.js';
import { MdSelectOption } from '@material/web/select/select-option.js';
import { MdFilledButton } from '@material/web/button/filled-button.js';
import { MdTextButton } from '@material/web/button/text-button.js';
import { MdIconButton } from '@material/web/iconbutton/icon-button.js';
import { MdList } from '@material/web/list/list.js';
import { MdListItem } from '@material/web/list/list-item.js';
import { MdChipSet } from '@material/web/chips/chip-set.js';
import { MdFilterChip } from '@material/web/chips/filter-chip.js';
import { MdMenu } from '@material/web/menu/menu.js';
import { MdMenuItem } from '@material/web/menu/menu-item.js';
import { MdDivider } from '@material/web/divider/divider.js';
import { Store, textOnColor, runAIJob } from '../../01-core.js';
import { cleanTheme, GOLD, CAT_MAIL, NC_FONT_STACK, NC_TYPE, RADIUS, SP, ELEV, TRANSITION, Z } from '../ui-tokens.jsx';

// Real M3 web components — same createComponent bridge as AppSuiteChrome.jsx.
const Fab               = createComponent({ react: React, tagName: 'md-fab',                elementClass: MdFab });
const OutlinedTextField = createComponent({ react: React, tagName: 'md-outlined-text-field', elementClass: MdOutlinedTextField, events: { onInput: 'input' } });
const OutlinedSelect    = createComponent({ react: React, tagName: 'md-outlined-select',    elementClass: MdOutlinedSelect,    events: { onChange: 'change' } });
const SelectOption      = createComponent({ react: React, tagName: 'md-select-option',      elementClass: MdSelectOption });
const FilledButton      = createComponent({ react: React, tagName: 'md-filled-button',      elementClass: MdFilledButton });
const TextButton        = createComponent({ react: React, tagName: 'md-text-button',        elementClass: MdTextButton });
const IconButton        = createComponent({ react: React, tagName: 'md-icon-button',        elementClass: MdIconButton });
const List              = createComponent({ react: React, tagName: 'md-list',               elementClass: MdList });
const ListItem          = createComponent({ react: React, tagName: 'md-list-item',          elementClass: MdListItem });
const ChipSet           = createComponent({ react: React, tagName: 'md-chip-set',           elementClass: MdChipSet });
const FilterChip        = createComponent({ react: React, tagName: 'md-filter-chip',        elementClass: MdFilterChip });
const Menu              = createComponent({ react: React, tagName: 'md-menu',               elementClass: MdMenu,              events: { onClosed: 'closed' } });
const MenuItem          = createComponent({ react: React, tagName: 'md-menu-item',          elementClass: MdMenuItem });
const Divider           = createComponent({ react: React, tagName: 'md-divider',            elementClass: MdDivider });

// Cross-component signaling with the rail's Bug Log item (AppSuiteChrome.jsx) —
// keeps this widget self-contained without prop-drilling through App.jsx.
const BUGLOG_OPEN_EVENT = 'shamash-buglog:open';
const BUGLOG_COUNT_EVENT = 'shamash-buglog:count';

const sym = (name, size, color) => (
  <span className="material-symbols-rounded" style={{ fontSize: size, color, lineHeight: 1 }}>{name}</span>
);

const FAB_SIZE    = 40;   // md-fab size="small"
const MARGIN      = 18;   // safe gap from the viewport edge
const POS_KEY     = 'shamash_buglog_fab_pos';
const PANEL_W     = 380;
const PANEL_ANCHOR = { left: 88, top: 84 }; // default panel spot — clear of the rail

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Display fallback while (or if) no AI summary exists: first sentence, capped.
// The stored original text is NEVER touched — summaries are display-only.
const truncSummary = (text = '') => {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= 80) return t;
  const stop = t.slice(0, 80).lastIndexOf('. ');
  return (stop > 30 ? t.slice(0, stop + 1) : t.slice(0, 77) + '…');
};

export function BugLog({ T, railVisible = true }) {
  const C = cleanTheme(T);
  const onAccent = textOnColor(C.accent);

  // Two axes the six labels split into: TYPE (what it is) + STATUS (where it stands).
  const TYPES = [
    { id: 'bug',  label: 'Bug',          icon: 'bug_report', color: C.danger },
    { id: 'idea', label: 'Upgrade idea', icon: 'lightbulb',  color: GOLD },
  ];
  const STATUSES = [
    { id: 'unresolved', label: 'Unresolved',    icon: 'error',        color: C.warning },
    { id: 'paused',     label: 'Paused',         icon: 'pause_circle', color: C.faint },
    { id: 'resolved',   label: 'Resolved',       icon: 'check_circle', color: C.success },
    { id: 'future',     label: 'Future update',  icon: 'schedule',     color: CAT_MAIL },
  ];
  const TYPE_BY   = Object.fromEntries(TYPES.map(t => [t.id, t]));
  const STATUS_BY = Object.fromEntries(STATUSES.map(s => [s.id, s]));

  const FILTERS = [
    { id: 'all',        label: 'All' },
    { id: 'unresolved', label: 'Unresolved' },
    { id: 'paused',     label: 'Paused' },
    { id: 'resolved',   label: 'Resolved' },
    { id: 'future',     label: 'Future' },
    { id: 'bug',        label: 'Bugs' },
    { id: 'idea',       label: 'Ideas' },
  ];

  const [bugs, setBugs]     = React.useState([]);
  const [open, setOpen]     = React.useState(false);
  const [draft, setDraft]   = React.useState('');
  const [draftType, setDraftType] = React.useState('bug');
  const [filter, setFilter] = React.useState('all');
  const [menuId, setMenuId] = React.useState(null);
  const [expandedId, setExpandedId] = React.useState(null); // row opened to full text + history
  const [copied, setCopied] = React.useState(false);
  const [hot, setHot]       = React.useState(false);   // FAB hover/focus → full opacity

  // FAB position: null = anchored to a screen edge via CSS (robust — no JS pixel
  // math, can't drift). Once the user drags it, we switch to an explicit,
  // remembered left/top pixel position.
  const [fabPos, setFabPos] = React.useState(() => {
    try { const s = JSON.parse(localStorage.getItem(POS_KEY)); if (s && typeof s.x === 'number') return s; } catch (_) {}
    return null;
  });
  const fabDrag = React.useRef(null);

  // Panel position — draggable so the user can see whatever it's covering.
  // Resets to the default anchor each time the panel opens (not persisted;
  // a session-only drag, so it never looks "randomly placed" on a new device).
  const [panelPos, setPanelPos] = React.useState(null);
  const panelDrag = React.useRef(null);
  const panelRef = React.useRef(null);

  // Panel size — null = default (PANEL_W wide, content-driven height up to
  // 80vh). Sticky for the session once the user drags the resize handle.
  const [panelSize, setPanelSize] = React.useState(null);
  const resizeDrag = React.useRef(null);

  // ── Live subscription: same Firestore pipe as the rest of the app ──────────
  React.useEffect(() => {
    let unsub = null, timer = null;
    const tryStart = () => {
      if (Store.bugsCol()) unsub = Store.subscribeBugs(setBugs);
      else timer = setTimeout(tryStart, 800);   // uid not ready yet → retry
    };
    tryStart();
    return () => { if (unsub) unsub(); if (timer) clearTimeout(timer); };
  }, []);

  // ── Auto-summary: long entries get a short AI display summary, stored once on the
  // bug doc. Display-only — the original text stays authoritative (the reader tool and
  // "Copy for coding team" always use b.text). Reuses the deployed polish job; on AI
  // failure the UI just keeps showing a deterministic truncation, so nothing blocks.
  const summarizedRef = React.useRef(new Set()); // ids attempted this session — no retry loops
  React.useEffect(() => {
    const pending = bugs.filter(b =>
      b.id && !b.summary && (b.text || '').trim().length > 90 && !summarizedRef.current.has(b.id)
    ).slice(0, 12);
    if (pending.length === 0) return;
    pending.forEach(b => summarizedRef.current.add(b.id));
    (async () => {
      try {
        const items = pending.map(b => ({ id: b.id, kind: b.type === 'idea' ? 'upgrade idea' : 'bug report', source: b.text }));
        const job = await runAIJob('dashboard.polish_items.v1', { items });
        const out = Array.isArray(job?.output) ? job.output : [];
        for (const item of out) {
          if (item?.id && item?.summary && pending.some(b => b.id === item.id)) {
            Store.updateBug(item.id, { summary: item.summary });
          }
        }
      } catch (e) {
        console.warn('[BugLog] auto-summary failed (display falls back to truncation):', e);
      }
    })();
  }, [bugs]);

  const unresolvedCount = bugs.filter(b => b.status === 'unresolved').length;

  // Broadcast the live count for the rail's badge, and listen for the rail's
  // open request — keeps this component decoupled from AppSuiteChrome.jsx.
  React.useEffect(() => {
    window.dispatchEvent(new CustomEvent(BUGLOG_COUNT_EVENT, { detail: { unresolved: unresolvedCount } }));
  }, [unresolvedCount]);
  React.useEffect(() => {
    const onOpenReq = () => { setPanelPos(null); setOpen(true); };
    window.addEventListener(BUGLOG_OPEN_EVENT, onOpenReq);
    return () => window.removeEventListener(BUGLOG_OPEN_EVENT, onOpenReq);
  }, []);

  // Keep a dragged FAB position on-screen if the window is resized smaller.
  React.useEffect(() => {
    if (!fabPos) return undefined;
    const onResize = () => setFabPos(p => p ? {
      x: clamp(p.x, MARGIN, window.innerWidth  - FAB_SIZE - MARGIN),
      y: clamp(p.y, MARGIN, window.innerHeight - FAB_SIZE - MARGIN),
    } : p);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fabPos]);

  // ── FAB: drag vs tap ─────────────────────────────────────────────────────
  function onFabPointerDown(e) {
    const wrapperRect = e.currentTarget.closest('[data-buglog-fab]')?.getBoundingClientRect();
    const p = wrapperRect ? { x: wrapperRect.left, y: wrapperRect.top } : { x: e.clientX, y: e.clientY };
    fabDrag.current = { sx: e.clientX, sy: e.clientY, ox: e.clientX - p.x, oy: e.clientY - p.y, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
  }
  function onFabPointerMove(e) {
    const d = fabDrag.current; if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 5) d.moved = true;
    if (d.moved) {
      setFabPos({
        x: clamp(e.clientX - d.ox, MARGIN, window.innerWidth  - FAB_SIZE - MARGIN),
        y: clamp(e.clientY - d.oy, MARGIN, window.innerHeight - FAB_SIZE - MARGIN),
      });
    }
  }
  function onFabPointerUp(e) {
    const d = fabDrag.current;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
    if (d && d.moved) { try { localStorage.setItem(POS_KEY, JSON.stringify(fabPos)); } catch (_) {} }
  }
  function onFabClick() {
    if (fabDrag.current && fabDrag.current.moved) { fabDrag.current = null; return; } // was a drag, not a tap
    fabDrag.current = null;
    setPanelPos(null);
    setOpen(true);
  }

  // ── Panel: draggable by its header ───────────────────────────────────────
  // The close button is a real M3 <md-icon-button> — a custom element, not a
  // native <button> tag — so it stops propagation itself (see its own
  // onPointerDown below) rather than relying on a tag-name check here.
  function onPanelHeaderPointerDown(e) {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    panelDrag.current = {
      ox: e.clientX - rect.left, oy: e.clientY - rect.top,
      w: rect.width, h: rect.height,
    };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
  }
  function onPanelHeaderPointerMove(e) {
    const d = panelDrag.current; if (!d) return;
    setPanelPos({
      x: clamp(e.clientX - d.ox, 4, window.innerWidth  - d.w - 4),
      y: clamp(e.clientY - d.oy, 4, window.innerHeight - d.h - 4),
    });
  }
  function onPanelHeaderPointerUp(e) {
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
    panelDrag.current = null;
  }

  // ── Panel: resize via bottom-right corner handle ─────────────────────────
  function onResizeHandlePointerDown(e) {
    e.stopPropagation();
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    resizeDrag.current = { sx: e.clientX, sy: e.clientY, w: rect.width, h: rect.height };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
  }
  function onResizeHandlePointerMove(e) {
    const d = resizeDrag.current; if (!d) return;
    setPanelSize({
      w: clamp(d.w + (e.clientX - d.sx), 300, Math.min(900, window.innerWidth - 24)),
      h: clamp(d.h + (e.clientY - d.sy), 280, Math.min(900, window.innerHeight - 24)),
    });
  }
  function onResizeHandlePointerUp(e) {
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
    resizeDrag.current = null;
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  function addDraft() {
    const text = draft.trim();
    if (!text) return;
    Store.addBug({ text, type: draftType });
    setDraft('');
  }
  function onDraftKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addDraft(); }
  }
  function copyForTeam() {
    const openTickets = bugs.filter(b => b.status === 'unresolved');
    const lines = ['Unresolved tickets — Shamash Pro 4', ''];
    if (openTickets.length === 0) {
      lines.push('(none — all clear)');
    } else {
      openTickets.forEach((b, i) => {
        const t = TYPE_BY[b.type]?.label || b.type;
        const when = b.createdAtMs ? new Date(b.createdAtMs).toLocaleString() : '';
        lines.push(`${i + 1}. [${t}] ${b.text}${when ? `  (logged ${when})` : ''}`);
      });
    }
    const text = lines.join('\n');
    try { navigator.clipboard?.writeText(text); } catch (_) {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function formatRel(ms) {
    if (!ms) return '';
    const d = Date.now() - ms;
    if (d < 60000)    return 'just now';
    if (d < 3600000)  return `${Math.floor(d / 60000)}m ago`;
    if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
    if (d < 604800000) return `${Math.floor(d / 86400000)}d ago`;
    return new Date(ms).toLocaleDateString();
  }

  const matches = b =>
    filter === 'all'  ? true :
    filter === 'bug'  ? b.type === 'bug'  :
    filter === 'idea' ? b.type === 'idea' :
    b.status === filter;
  const visible = bugs.filter(matches);

  // Anchored by default (left/bottom — immune to any viewport pixel-math drift);
  // switches to an explicit left/top once the user has actually dragged it.
  const fabPosStyle = fabPos ? { left: fabPos.x, top: fabPos.y } : { left: MARGIN, bottom: MARGIN };

  // M3 bridge tokens for the FAB (shadow DOM can't see app CSS) — same as AppSuiteChrome.
  const fabVars = {
    '--md-fab-container-color': C.accent,
    '--md-fab-icon-color': onAccent,
    '--md-fab-hover-state-layer-color': C.accent,
  };

  const panelStyle = {
    ...(panelPos ? { left: panelPos.x, top: panelPos.y } : { left: PANEL_ANCHOR.left, top: PANEL_ANCHOR.top }),
    width: panelSize ? panelSize.w : PANEL_W,
    maxWidth: '92vw',
    height: panelSize ? panelSize.h : undefined,
    maxHeight: panelSize ? panelSize.h : '80vh',
  };

  return (
    <>
      {/* Floating launcher — only when the nav rail isn't around to carry the
          Bug Log item itself. Small, draggable, fades to low opacity at rest. */}
      {!railVisible && (
        <div
          data-buglog-fab="true"
          style={{
            position: 'fixed', ...fabPosStyle, zIndex: Z.docked,
            opacity: open ? 0 : (hot ? 1 : 0.45),
            pointerEvents: open ? 'none' : 'auto',
            transition: TRANSITION, touchAction: 'none', ...fabVars,
          }}
          onMouseEnter={() => setHot(true)}
          onMouseLeave={() => setHot(false)}
        >
          <Fab
            size="small"
            aria-label="Open bug log"
            title="Bug log"
            onPointerDown={onFabPointerDown}
            onPointerMove={onFabPointerMove}
            onPointerUp={onFabPointerUp}
            onClick={onFabClick}
            onFocus={() => setHot(true)}
            onBlur={() => setHot(false)}
          >
            <span slot="icon" className="material-symbols-rounded">bug_report</span>
          </Fab>
          {unresolvedCount > 0 && (
            <span style={{
              position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, padding: '0 4px',
              borderRadius: RADIUS.pill, background: C.danger, color: '#fff',
              fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: NC_FONT_STACK, pointerEvents: 'none',
            }}>{unresolvedCount}</span>
          )}
        </div>
      )}

      {/* Draggable, non-modal panel — deliberately NOT a modal md-dialog: this is a
          quick-capture tool used *while looking at whatever it's about*, so it must
          never block or hide the screen behind it. No M3 component covers a
          draggable, non-modal utility panel, so this is hand-coded from
          ui-tokens.jsx per the fallback rule. */}
      {open && (
        <div
          ref={panelRef}
          style={{
            position: 'fixed', ...panelStyle, zIndex: Z.modal,
            display: 'flex', flexDirection: 'column',
            background: C.bg, border: `1px solid ${C.divider}`,
            borderRadius: RADIUS.md, boxShadow: ELEV[3], overflow: 'hidden',
          }}
        >
          {/* Header — the drag handle */}
          <div
            onPointerDown={onPanelHeaderPointerDown}
            onPointerMove={onPanelHeaderPointerMove}
            onPointerUp={onPanelHeaderPointerUp}
            style={{
              display: 'flex', alignItems: 'center', gap: SP.sm, padding: '10px 8px 10px 14px',
              borderBottom: `1px solid ${C.divider}`, cursor: 'grab', touchAction: 'none', flexShrink: 0,
            }}
          >
            {sym('bug_report', 20, C.accent)}
            <span style={{
              flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontFamily: NC_FONT_STACK, fontSize: NC_TYPE.title, fontWeight: 600, color: C.text,
            }}>Bug Log</span>
            <span style={{ fontSize: NC_TYPE.small, color: C.faint, fontFamily: NC_FONT_STACK, whiteSpace: 'nowrap', flexShrink: 0 }}>
              {unresolvedCount} open
            </span>
            <IconButton
              aria-label="Close bug log"
              onPointerDown={e => e.stopPropagation()}
              onClick={() => { setOpen(false); setMenuId(null); }}
            >
              {sym('close', 20, C.muted)}
            </IconButton>
          </div>

          {/* Body — scrolls internally so nothing overflows the rounded card */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: SP.md, padding: SP.md, overflowY: 'auto', minHeight: 0, flex: '1 1 auto' }}>
            {/* Quick add */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: SP.sm }}>
              <OutlinedTextField
                label="Jot a bug or idea…"
                value={draft}
                onInput={e => setDraft(e.target.value)}
                onKeyDown={onDraftKey}
              />
              <div style={{ display: 'flex', gap: SP.sm }}>
                <OutlinedSelect label="Type" value={draftType} onChange={e => setDraftType(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
                  {TYPES.map(t => (
                    <SelectOption key={t.id} value={t.id}>
                      <div slot="headline">{t.label}</div>
                    </SelectOption>
                  ))}
                </OutlinedSelect>
                <FilledButton onClick={addDraft}><span>Add</span></FilledButton>
              </div>
            </div>

            {/* Filters */}
            <ChipSet>
              {FILTERS.map(f => (
                <FilterChip
                  key={f.id}
                  label={f.label}
                  selected={filter === f.id}
                  onClick={() => setFilter(prev => (prev === f.id ? 'all' : f.id))}
                />
              ))}
            </ChipSet>

            {/* List */}
            {visible.length === 0 ? (
              <div style={{
                padding: '24px 12px', textAlign: 'center', color: C.faint,
                fontSize: NC_TYPE.body, fontFamily: NC_FONT_STACK,
              }}>
                {bugs.length === 0 ? 'No entries yet — jot your first one above.' : 'Nothing matches this filter.'}
              </div>
            ) : (
              <List style={{
                '--md-list-container-color': 'transparent', maxHeight: '48vh', overflowY: 'auto',
                // M3 dense-list density (same approach Gmail/Keep use for compact rows):
                // shrink the container height + typescale tokens rather than hand-rolled
                // CSS, so rows stay real M3 list items, just at a tighter density step.
                '--md-list-item-top-space': '6px',
                '--md-list-item-bottom-space': '6px',
                '--md-list-item-two-line-container-height': '44px',
                '--md-list-item-label-text-size': '13px',
                '--md-list-item-label-text-line-height': '17px',
                '--md-list-item-supporting-text-size': '11px',
                '--md-list-item-supporting-text-line-height': '14px',
              }}>
                {visible.map(b => {
                  const t = TYPE_BY[b.type]   || TYPE_BY.bug;
                  const s = STATUS_BY[b.status] || STATUS_BY.unresolved;
                  const expanded = expandedId === b.id;
                  const display = expanded ? b.text : (b.summary || truncSummary(b.text));
                  const notes = Array.isArray(b.notes) ? b.notes : [];
                  return (
                    <ListItem key={b.id} type="button" title={expanded ? undefined : b.text}
                      onClick={() => setExpandedId(prev => (prev === b.id ? null : b.id))}
                      style={{ '--md-list-item-leading-space': '10px', '--md-list-item-trailing-space': '4px' }}>
                      <div slot="start" title={t.label} style={{ display: 'flex', alignItems: 'center' }}>
                        {sym(t.icon, 15, t.color)}
                      </div>
                      <div slot="headline" style={{ whiteSpace: 'normal', fontFamily: NC_FONT_STACK }}>{display}</div>
                      <div slot="supporting-text" style={{ fontFamily: NC_FONT_STACK }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: s.color }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, display: 'inline-block' }} />
                            {s.label}
                          </span>
                          <span style={{ color: C.faint }}>· {formatRel(b.createdAtMs)}</span>
                          {!expanded && notes.length > 0 && (
                            <span style={{ color: C.faint }}>· {notes.length} note{notes.length === 1 ? '' : 's'}</span>
                          )}
                        </span>
                        {/* Resolution / work history — the notes the resolving coder left,
                            visible on any expanded entry (incl. resolved ones). */}
                        {expanded && notes.length > 0 && (
                          <span style={{ display: 'block', marginTop: 4, paddingLeft: 2 }}>
                            {notes.map((n, i) => (
                              <span key={i} style={{ display: 'block', whiteSpace: 'normal', wordBreak: 'break-word', color: C.muted, padding: '2px 0', borderLeft: `2px solid ${C.divider}`, paddingLeft: 8, marginBottom: 2 }}>
                                {n.text}{n.atMs ? <span style={{ color: C.faint }}> — {formatRel(n.atMs)}</span> : null}
                              </span>
                            ))}
                          </span>
                        )}
                        {expanded && notes.length === 0 && (
                          <span style={{ display: 'block', marginTop: 4, color: C.faint }}>No work notes yet.</span>
                        )}
                      </div>
                      <div slot="end" style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                        <IconButton id={`bugmenu-${b.id}`} aria-label="Change status" onClick={() => setMenuId(m => (m === b.id ? null : b.id))}>
                          {sym('more_vert', 20, C.muted)}
                        </IconButton>
                        <Menu
                          anchor={`bugmenu-${b.id}`}
                          open={menuId === b.id}
                          onClosed={() => setMenuId(m => (m === b.id ? null : m))}
                          positioning="popover"
                        >
                          {STATUSES.map(st => (
                            <MenuItem key={st.id} onClick={() => { Store.updateBug(b.id, { status: st.id }); setMenuId(null); }}>
                              <span slot="start" className="material-symbols-rounded" style={{ color: st.color }}>{st.icon}</span>
                              <div slot="headline">{st.label}</div>
                            </MenuItem>
                          ))}
                          <Divider />
                          <MenuItem onClick={() => { Store.updateBug(b.id, { type: b.type === 'bug' ? 'idea' : 'bug' }); setMenuId(null); }}>
                            <span slot="start" className="material-symbols-rounded" style={{ color: C.muted }}>swap_horiz</span>
                            <div slot="headline">Make {b.type === 'bug' ? 'an idea' : 'a bug'}</div>
                          </MenuItem>
                          <Divider />
                          <MenuItem onClick={() => { Store.deleteBug(b.id); setMenuId(null); }}>
                            <span slot="start" className="material-symbols-rounded" style={{ color: C.danger }}>delete</span>
                            <div slot="headline" style={{ color: C.danger }}>Delete</div>
                          </MenuItem>
                        </Menu>
                      </div>
                    </ListItem>
                  );
                })}
              </List>
            )}
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', alignItems: 'center', gap: SP.sm, padding: '8px 12px', borderTop: `1px solid ${C.divider}`, flexShrink: 0 }}>
            <TextButton onClick={copyForTeam} disabled={unresolvedCount === 0}>
              <span slot="icon" className="material-symbols-rounded">content_copy</span>
              <span>{copied ? 'Copied!' : `Copy for coding team${unresolvedCount ? ` (${unresolvedCount})` : ''}`}</span>
            </TextButton>
          </div>

          {/* Resize handle — bottom-right corner grip. No M3 component covers
              panel resizing, so this is hand-coded per the fallback rule. */}
          <div
            onPointerDown={onResizeHandlePointerDown}
            onPointerMove={onResizeHandlePointerMove}
            onPointerUp={onResizeHandlePointerUp}
            title="Resize"
            style={{
              position: 'absolute', right: 2, bottom: 2, width: 18, height: 18,
              cursor: 'nwse-resize', touchAction: 'none', borderRadius: 2, opacity: 0.55,
              backgroundImage: `repeating-linear-gradient(135deg, ${C.faint} 0px, ${C.faint} 1.5px, transparent 1.5px, transparent 4px)`,
            }}
          />
        </div>
      )}
    </>
  );
}

export default BugLog;
