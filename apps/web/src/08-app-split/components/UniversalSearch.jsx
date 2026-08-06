// ── Universal search (owner ticket P23NUsiioNTQ1gvfcsZ9) ────────────────────
//
// One box that searches everything the app already has in memory — tasks,
// shailos, mail, calendar and phone threads — and jumps to the row you pick,
// scrolling it into view and flashing it.
//
// It reads published records only (see utils/search-registry.js); it never
// fetches. That is what makes it instant, free, and usable offline.

import React from 'react';
import { createPortal } from 'react-dom';
import { cleanTheme, NC_FONT_STACK, NC_TYPE, RADIUS, SP, suiteIcon } from '../ui-tokens.jsx';
import { Dialog, TextField, FilterChip, ChipSet, List, ListItem, Divider, denseListVars } from '../m3.jsx';
import {
  subscribeSearchRecords, subscribeSearchReveal, requestSearchReveal,
  SEARCH_SOURCE_LABEL, SEARCH_SOURCE_ICON, SEARCH_FLASH_CLASS, SEARCH_FLASH_MS,
} from '../utils/search-registry.js';
import {
  rankSearchResults, flattenSearchGroups,
  taskRecords, shailaRecords, mailRecords, calendarRecords,
} from '../utils/search-index.js';
import { useSearchSource, useSearchReveal } from '../utils/search-hooks.js';

const RECENT_KEY = "ot_universal_search_recent_v1";
const RECENT_MAX = 6;

function readRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").filter(v => typeof v === "string"); }
  catch { return []; }
}

function writeRecent(query) {
  const value = String(query || "").trim();
  if (value.length < 2) return;
  try {
    const next = [value, ...readRecent().filter(v => v.toLowerCase() !== value.toLowerCase())].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* private mode — recents are a nicety, never a hard dependency */ }
}

// The reveal flash lives in one injected rule rather than per-screen CSS, so a
// screen only has to add data-search-id to opt in. Injected once per document.
const FLASH_STYLE_ID = "universal-search-flash-style";
function ensureFlashStyle() {
  if (typeof document === "undefined" || document.getElementById(FLASH_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = FLASH_STYLE_ID;
  style.textContent = `
@keyframes ${SEARCH_FLASH_CLASS}-kf {
  0%, 100% { box-shadow: 0 0 0 0 transparent; background-color: transparent; }
  15%, 60% { box-shadow: 0 0 0 2px var(--md-sys-color-primary, #7eb0de);
             background-color: color-mix(in srgb, var(--md-sys-color-primary, #7eb0de) 14%, transparent); }
}
.${SEARCH_FLASH_CLASS} {
  animation: ${SEARCH_FLASH_CLASS}-kf ${SEARCH_FLASH_MS}ms ease-in-out 1;
  border-radius: 8px;
  scroll-margin: 96px;
}
@media (prefers-reduced-motion: reduce) {
  .${SEARCH_FLASH_CLASS} { animation-duration: 1ms; outline: 2px solid var(--md-sys-color-primary, #7eb0de); }
}`;
  document.head.appendChild(style);
}

function timeLabel(when) {
  if (!when) return "";
  const d = new Date(when);
  if (isNaN(d.getTime())) return "";
  const days = (Date.now() - d.getTime()) / 86400000;
  if (days >= 0 && days < 1) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Publishes the collections App.jsx already holds, and owns the task-queue
 * reveal. It is a COMPONENT, not a hook call inside App: App has early returns
 * above the point where these lists are computed, and hooks must not sit below
 * a conditional return ("rendered more hooks than during the previous render").
 * Rendering a hook-free-looking null component keeps the ordering honest.
 */
export function SearchSourcePublisher({ tasks = [], priorities = [], shailos = [], gmailMessages = null, calendarEvents = null, onRevealTask }) {
  // Task rows only exist on the Queue tab, so a task result has to open it —
  // otherwise the jump lands on the Focus card and the row is never in the DOM.
  React.useEffect(() => subscribeSearchReveal((target) => {
    if (target.surface === "focus") onRevealTask?.();
  }), [onRevealTask]);
  useSearchSource("tasks",    React.useMemo(() => taskRecords(tasks, priorities), [tasks, priorities]));
  useSearchSource("shailos",  React.useMemo(() => shailaRecords(shailos), [shailos]));
  useSearchSource("mail",     React.useMemo(() => mailRecords(gmailMessages || []), [gmailMessages]));
  useSearchSource("calendar", React.useMemo(() => calendarRecords(calendarEvents || []), [calendarEvents]));
  // A task result lands on its queue row (App.jsx tags rows with data-search-id).
  useSearchReveal("focus");
  return null;
}

export function UniversalSearch({ open, onClose, onSelectSurface, T }) {
  const C = cleanTheme(T);
  const [query, setQuery] = React.useState("");
  const [records, setRecords] = React.useState([]);
  const [activeSources, setActiveSources] = React.useState([]);
  const [cursor, setCursor] = React.useState(0);
  const [recent, setRecent] = React.useState(readRecent);
  const inputRef = React.useRef(null);
  const listRef = React.useRef(null);

  React.useEffect(() => { ensureFlashStyle(); }, []);
  React.useEffect(() => subscribeSearchRecords(setRecords), []);

  // Reopening always starts clean — a stale query from an hour ago is never
  // what the owner wants to see first.
  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    setActiveSources([]);
    setRecent(readRecent());
    const t = setTimeout(() => inputRef.current?.focus?.(), 60);
    return () => clearTimeout(t);
  }, [open]);

  // 120ms debounce: fast enough to feel live, slow enough that a long query is
  // not re-ranked on every keystroke.
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 120);
    return () => clearTimeout(t);
  }, [query]);

  const groups = React.useMemo(
    () => rankSearchResults(debounced, records, { sources: activeSources }),
    [debounced, records, activeSources],
  );
  const flat = React.useMemo(() => flattenSearchGroups(groups), [groups]);
  React.useEffect(() => { setCursor(0); }, [debounced, activeSources]);

  // Which sources have anything at all — chips for empty sources are noise.
  const availableSources = React.useMemo(() => {
    const seen = new Set(records.map(r => r.source));
    return Object.keys(SEARCH_SOURCE_LABEL).filter(id => seen.has(id));
  }, [records]);

  const choose = React.useCallback((rec) => {
    if (!rec) return;
    writeRecent(query);
    onClose?.();
    onSelectSurface?.(rec.surface);
    // After the surface switch, not before — the target screen may only mount now.
    requestSearchReveal({ surface: rec.surface, anchorId: rec.anchorId });
  }, [onClose, onSelectSurface, query]);

  const onKeyDown = (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!flat.length) return;
      setCursor(c => (c + (event.key === "ArrowDown" ? 1 : flat.length - 1)) % flat.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      choose(flat[cursor]);
      return;
    }
    if (event.key === "Escape") { event.preventDefault(); onClose?.(); }
  };

  // Keep the highlighted row in view while arrowing through a long list.
  React.useEffect(() => {
    const node = listRef.current?.querySelector(`[data-cursor="${cursor}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const toggleSource = (id) => setActiveSources(list => (
    list.includes(id) ? list.filter(v => v !== id) : [...list, id]
  ));

  const hasQuery = debounced.trim().length >= 2;
  let index = -1;

  // Portalled to <body>: rendered in place it landed inside the suite root's
  // overflow:hidden box and laid its content out off-screen (the owner saw two
  // stray outline strokes and no input). The rail's own popovers portal for the
  // same reason.
  return createPortal((
    <Dialog
      open={!!open}
      onClosed={() => onClose?.()}
      style={{
        '--md-dialog-container-color': C.bg,
        maxWidth: 'min(680px, 96vw)',
        minWidth: 'min(680px, 96vw)',
        maxHeight: '82vh',
      }}
    >
      {/* The field lives in `content`, NOT `headline`. md-dialog's headline slot
          is an intrinsically-sized flex row, and md-outlined-text-field there
          blew out to ~2000px wide and slid off the left edge — the owner saw two
          stray outline strokes and no input. */}
      <div slot="headline" style={{ display: 'flex', alignItems: 'center', gap: SP.sm, minWidth: 0, fontFamily: NC_FONT_STACK, fontSize: NC_TYPE.title, fontWeight: `var(--nc-fw-semibold, 600)`, color: C.text }}>
        <span style={{ color: C.accent, display: 'inline-flex' }}>{suiteIcon('search', 22)}</span>
        <span>Search everything</span>
      </div>

      <div slot="content" style={{ padding: `0 ${SP.sm}`, fontFamily: NC_FONT_STACK }}>
        <TextField
          ref={inputRef}
          value={query}
          onInput={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Tasks, mail, calendar, texts…"
          aria-label="Search everything"
          style={{
            display: 'block', width: '100%', boxSizing: 'border-box', marginBottom: SP.sm,
            // md-outlined-text-field's internal input-wrapper reports three times
            // the field's width (665 → 2002). Left unclipped that becomes the
            // dialog scroller's scrollWidth, and focusing the input scrolled the
            // whole card 671px sideways — the owner saw two outline strokes and
            // no input. Clipping the host keeps the overflow out of the scroller.
            overflow: 'hidden',
            '--md-outlined-text-field-container-shape': RADIUS.pill,
          }}
        />
        {availableSources.length > 1 && (
          <ChipSet style={{ display: 'flex', flexWrap: 'wrap', gap: SP.xs, padding: `0 0 ${SP.sm}` }}>
            {availableSources.map(id => (
              <FilterChip
                key={id}
                label={SEARCH_SOURCE_LABEL[id]}
                selected={activeSources.includes(id)}
                onClick={() => toggleSource(id)}
              />
            ))}
          </ChipSet>
        )}

        {!hasQuery && (
          <div style={{ padding: `${SP.md} ${SP.xs}` }}>
            {recent.length > 0 && (
              <>
                <div style={{ fontSize: NC_TYPE.small, color: C.faint, textTransform: 'uppercase', letterSpacing: 1.1, paddingBottom: SP.xs }}>Recent</div>
                <ChipSet style={{ display: 'flex', flexWrap: 'wrap', gap: SP.xs }}>
                  {recent.map(value => (
                    <FilterChip key={value} label={value} selected={false} onClick={() => { setQuery(value); inputRef.current?.focus?.(); }} />
                  ))}
                </ChipSet>
              </>
            )}
            <div style={{ fontSize: NC_TYPE.body, color: C.muted, paddingTop: recent.length ? SP.md : 0 }}>
              Type at least two letters. Searches {records.length.toLocaleString()} items already loaded —
              tasks, shailos, mail, calendar and texts. ↑ ↓ to move, Enter to jump.
            </div>
          </div>
        )}

        {hasQuery && !flat.length && (
          <div style={{ padding: `${SP.lg} ${SP.xs}`, fontSize: NC_TYPE.body, color: C.muted }}>
            Nothing matches “{debounced.trim()}”.
            {activeSources.length > 0 && " Try clearing the filters above."}
          </div>
        )}

        {hasQuery && flat.length > 0 && (
          <div ref={listRef} style={{ maxHeight: '52vh', overflowY: 'auto' }}>
            {groups.map((group, gi) => (
              <div key={group.source}>
                {gi > 0 && <Divider />}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: NC_TYPE.small, color: C.faint, fontWeight: `var(--nc-fw-semibold, 600)`,
                  textTransform: 'uppercase', letterSpacing: 1.1, padding: `${SP.sm} ${SP.xs} ${SP.xs}`,
                }}>
                  <span style={{ display: 'inline-flex' }}>{suiteIcon(SEARCH_SOURCE_ICON[group.source], 14)}</span>
                  {SEARCH_SOURCE_LABEL[group.source] || group.source}
                  {group.total > group.results.length && (
                    <span style={{ fontWeight: `var(--nc-fw-normal, 400)` }}>· top {group.results.length} of {group.total}</span>
                  )}
                </div>
                <List style={denseListVars({ dense: true })}>
                  {group.results.map(rec => {
                    index += 1;
                    const isCursor = index === cursor;
                    const at = index;
                    return (
                      <ListItem
                        key={rec.id}
                        type="button"
                        data-cursor={at}
                        onClick={() => choose(rec)}
                        onMouseEnter={() => setCursor(at)}
                        style={isCursor ? { '--md-list-item-container-color': C.hover } : undefined}
                      >
                        <div slot="headline" style={{ color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rec.title}</div>
                        {(rec.subtitle || rec.when) && (
                          <div slot="supporting-text" style={{ color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {[rec.subtitle, timeLabel(rec.when)].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </ListItem>
                    );
                  })}
                </List>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  ), document.body);
}

export default UniversalSearch;
