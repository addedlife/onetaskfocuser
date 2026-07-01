import React from 'react';
import { createComponent } from '@lit/react';
import { MdFab } from '@material/web/fab/fab.js';
import { MdDialog } from '@material/web/dialog/dialog.js';
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
import { Store, textOnColor } from '../../01-core.js';
import { cleanTheme, GOLD, CAT_MAIL, NC_FONT_STACK, NC_TYPE, RADIUS, SP, ELEV, TRANSITION, Z } from '../ui-tokens.jsx';

// Real M3 web components — same createComponent bridge as AppSuiteChrome.jsx.
// `events` maps a React prop to the custom element's DOM event so we can react
// to closes / value changes the React way.
const Fab               = createComponent({ react: React, tagName: 'md-fab',                elementClass: MdFab });
const Dialog            = createComponent({ react: React, tagName: 'md-dialog',             elementClass: MdDialog,            events: { onClosed: 'closed' } });
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

const sym = (name, size, color) => (
  <span className="material-symbols-rounded" style={{ fontSize: size, color, lineHeight: 1 }}>{name}</span>
);

const FAB_SIZE = 40;     // md-fab size="small"
const MARGIN   = 18;     // safe gap from the viewport edge
const POS_KEY  = 'shamash_buglog_fab_pos';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function BugLog({ T }) {
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
  const [copied, setCopied] = React.useState(false);
  const [hot, setHot]       = React.useState(false);   // FAB hover/focus → full opacity

  // FAB position: null = anchored to the bottom-right corner via CSS (robust —
  // no JS pixel math, can't drift). Once the user drags it, we switch to an
  // explicit, remembered left/top pixel position.
  const [pos, setPos] = React.useState(() => {
    try { const s = JSON.parse(localStorage.getItem(POS_KEY)); if (s && typeof s.x === 'number') return s; } catch (_) {}
    return null;
  });
  const drag = React.useRef(null);

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

  // Keep a dragged position on-screen if the window is resized smaller.
  React.useEffect(() => {
    if (!pos) return undefined;
    const onResize = () => setPos(p => p ? {
      x: clamp(p.x, MARGIN, window.innerWidth  - FAB_SIZE - MARGIN),
      y: clamp(p.y, MARGIN, window.innerHeight - FAB_SIZE - MARGIN),
    } : p);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pos]);

  // ── Drag vs tap ────────────────────────────────────────────────────────────
  function onPointerDown(e) {
    // Read the wrapper's actual on-screen rect — correct whether it's still
    // CSS-anchored (right/bottom) or already at an explicit left/top.
    const wrapperRect = e.currentTarget.closest('[data-buglog-fab]')?.getBoundingClientRect();
    const p = wrapperRect ? { x: wrapperRect.left, y: wrapperRect.top } : { x: e.clientX, y: e.clientY };
    drag.current = { sx: e.clientX, sy: e.clientY, ox: e.clientX - p.x, oy: e.clientY - p.y, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
  }
  function onPointerMove(e) {
    const d = drag.current; if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 5) d.moved = true;
    if (d.moved) {
      setPos({
        x: clamp(e.clientX - d.ox, MARGIN, window.innerWidth  - FAB_SIZE - MARGIN),
        y: clamp(e.clientY - d.oy, MARGIN, window.innerHeight - FAB_SIZE - MARGIN),
      });
    }
  }
  function onPointerUp(e) {
    const d = drag.current;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
    if (d && d.moved) { try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (_) {} }
    // leave drag.current.moved for the click handler that fires next
  }
  function onFabClick() {
    if (drag.current && drag.current.moved) { drag.current = null; return; } // was a drag, not a tap
    drag.current = null;
    setOpen(true);
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
  const unresolvedCount = bugs.filter(b => b.status === 'unresolved').length;

  // M3 bridge tokens for the FAB (shadow DOM can't see app CSS) — same as AppSuiteChrome.
  const fabVars = {
    '--md-fab-container-color': C.accent,
    '--md-fab-icon-color': onAccent,
    '--md-fab-hover-state-layer-color': C.accent,
  };
  // Anchored by default (right/bottom — immune to any viewport pixel-math drift);
  // switches to an explicit left/top once the user has actually dragged it.
  const posStyle = pos
    ? { left: pos.x, top: pos.y }
    : { right: MARGIN, bottom: MARGIN };

  return (
    <>
      {/* Floating launcher — small, draggable, fades to low opacity at rest. */}
      <div
        data-buglog-fab="true"
        style={{
          position: 'fixed', ...posStyle, zIndex: Z.docked,
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
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onClick={onFabClick}
          onFocus={() => setHot(true)}
          onBlur={() => setHot(false)}
        >
          <span slot="icon" className="material-symbols-rounded">feedback</span>
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

      <Dialog open={open} onClosed={() => { setOpen(false); setMenuId(null); }} style={{ maxWidth: 'min(560px, 94vw)' }}>
        <div slot="headline" style={{ display: 'flex', alignItems: 'center', gap: SP.sm, width: '100%' }}>
          {sym('bug_report', 22, C.accent)}
          <span style={{ flex: 1, fontFamily: NC_FONT_STACK }}>Bug Log</span>
          <span style={{ fontSize: NC_TYPE.meta, color: C.faint, fontFamily: NC_FONT_STACK }}>
            {bugs.length} total · {unresolvedCount} open
          </span>
        </div>

        <div slot="content" style={{ display: 'flex', flexDirection: 'column', gap: SP.md }}>
          {/* Quick add */}
          <div style={{ display: 'flex', gap: SP.sm, alignItems: 'center' }}>
            <OutlinedTextField
              label="Jot a bug or idea…"
              value={draft}
              onInput={e => setDraft(e.target.value)}
              onKeyDown={onDraftKey}
              style={{ flex: 1 }}
            />
            <OutlinedSelect label="Type" value={draftType} onChange={e => setDraftType(e.target.value)} style={{ width: 150 }}>
              {TYPES.map(t => (
                <SelectOption key={t.id} value={t.id}>
                  <div slot="headline">{t.label}</div>
                </SelectOption>
              ))}
            </OutlinedSelect>
            <FilledButton onClick={addDraft}><span>Add</span></FilledButton>
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
              padding: '28px 12px', textAlign: 'center', color: C.faint,
              fontSize: NC_TYPE.body, fontFamily: NC_FONT_STACK,
            }}>
              {bugs.length === 0 ? 'No entries yet — jot your first one above.' : 'Nothing matches this filter.'}
            </div>
          ) : (
            <List style={{ '--md-list-container-color': 'transparent', maxHeight: '46vh', overflowY: 'auto' }}>
              {visible.map(b => {
                const t = TYPE_BY[b.type]   || TYPE_BY.bug;
                const s = STATUS_BY[b.status] || STATUS_BY.unresolved;
                return (
                  <ListItem key={b.id} style={{ '--md-list-item-leading-space': '12px', '--md-list-item-trailing-space': '4px' }}>
                    <div slot="start" title={t.label} style={{ display: 'flex', alignItems: 'center' }}>
                      {sym(t.icon, 18, t.color)}
                    </div>
                    <div slot="headline" style={{ whiteSpace: 'normal', fontFamily: NC_FONT_STACK }}>{b.text}</div>
                    <div slot="supporting-text" style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: NC_FONT_STACK }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: s.color }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, display: 'inline-block' }} />
                        {s.label}
                      </span>
                      <span style={{ color: C.faint }}>· {formatRel(b.createdAtMs)}</span>
                    </div>
                    <div slot="end" style={{ position: 'relative' }}>
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

        <div slot="actions" style={{ display: 'flex', alignItems: 'center', gap: SP.sm, width: '100%' }}>
          <TextButton onClick={copyForTeam} disabled={unresolvedCount === 0}>
            <span slot="icon" className="material-symbols-rounded">content_copy</span>
            <span>{copied ? 'Copied!' : `Copy for coding team${unresolvedCount ? ` (${unresolvedCount})` : ''}`}</span>
          </TextButton>
          <span style={{ flex: 1 }} />
          <TextButton onClick={() => setOpen(false)}><span>Close</span></TextButton>
        </div>
      </Dialog>
    </>
  );
}

export default BugLog;
