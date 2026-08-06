// ── Universal search: the registry and the reveal bus ───────────────────────
//
// Owner ticket P23NUsiioNTQ1gvfcsZ9 — "search function in menu rail to universal
// search". Everything the rail can search is ALREADY loaded in the browser: the
// five NerveCenter cards, TaskRiver, the phone threads, the bug log. Search reads
// that live state. No new Firestore reads, no index to maintain, no AI call, and
// it keeps working offline for whatever is already in memory.
//
// The alternative — threading a dozen collections down through App.jsx as props —
// would have put a large diff in the two files every other session also edits.
// Instead each screen PUBLISHES its own records here and search subscribes. A new
// source is one `useSearchSource(...)` call in the screen that owns the data;
// nothing else in the app changes.

const sources = new Map();          // sourceId → { records, order }
const sourceListeners = new Set();
const revealListeners = new Set();

// Group order in the results card — a stable, meaningful order beats
// registration order, which depends on which screens happen to be mounted.
export const SEARCH_SOURCE_ORDER = ["tasks", "shailos", "mail", "calendar", "messages"];

export const SEARCH_SOURCE_LABEL = {
  tasks:    "Tasks",
  shailos:  "Shailos",
  mail:     "Mail",
  calendar: "Calendar",
  messages: "Messages",
};

export const SEARCH_SOURCE_ICON = {
  tasks:    "rule",
  shailos:  "question_mark",
  mail:     "mail",
  calendar: "event",
  messages: "sms",
};

function emitSources() {
  const snapshot = getSearchRecords();
  for (const fn of sourceListeners) {
    try { fn(snapshot); } catch { /* a broken listener must not stop the others */ }
  }
}

/** Replace everything a source contributes. Passing [] unregisters it cleanly. */
export function publishSearchSource(sourceId, records) {
  if (!sourceId) return;
  if (!records || !records.length) sources.delete(sourceId);
  else sources.set(sourceId, records);
  emitSources();
}

/** Flat array of every published record, in SEARCH_SOURCE_ORDER. */
export function getSearchRecords() {
  const out = [];
  const seen = new Set();
  for (const id of SEARCH_SOURCE_ORDER) {
    const records = sources.get(id);
    if (records) { out.push(...records); seen.add(id); }
  }
  for (const [id, records] of sources) if (!seen.has(id)) out.push(...records);
  return out;
}

export function subscribeSearchRecords(fn) {
  sourceListeners.add(fn);
  fn(getSearchRecords());
  return () => sourceListeners.delete(fn);
}

// ── Reveal ──────────────────────────────────────────────────────────────────
// Picking a result does two things: the rail switches surface (the caller owns
// that, it has onSelect), and the target screen scrolls to the row and flashes
// it. The screen may not be mounted yet when the surface switches, so the request
// is REPLAYED to whoever subscribes within a short window rather than fired once
// into the void.

const REVEAL_REPLAY_MS = 4000;
let pendingReveal = null;

export function requestSearchReveal(target) {
  if (!target?.surface || !target?.anchorId) return;
  pendingReveal = { ...target, at: Date.now() };
  for (const fn of revealListeners) {
    try { fn(pendingReveal); } catch { /* keep going */ }
  }
}

export function subscribeSearchReveal(fn) {
  revealListeners.add(fn);
  // A screen that mounts because of the reveal still gets it.
  if (pendingReveal && Date.now() - pendingReveal.at < REVEAL_REPLAY_MS) {
    try { fn(pendingReveal); } catch { /* keep going */ }
  }
  return () => revealListeners.delete(fn);
}

export function clearSearchReveal() { pendingReveal = null; }

export const SEARCH_FLASH_CLASS = "search-reveal-flash";
export const SEARCH_FLASH_MS = 1800;
