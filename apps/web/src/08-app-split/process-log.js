// ── Per-surface process log ─────────────────────────────────────────────────
//
// Owner tickets 7/29 (8:04 AM and 8:05 AM), together:
//
//   "make a full process log on each app for that app — webapp, android, mobile,
//    etc, each logging its own individual processes and reachable by settings of
//    its app, autorouting to its one. the log on deskphone is the perfect design
//    model to replicate."
//
//   "…also make a mini process log that pops up on any phone surface when i send
//    a text or use the relay showing the live attempt/send process of that app
//    (web, deskphone, tablet — each their own) and after the process is finished
//    allow copy to paste into a prompt."
//
// The DeskPhone host has had a real live log for months (its own window, one
// line per step, timestamped). Nothing else did: the web app's own nav entry
// labelled "Live Log" fires `/open-live-log`, a command that only the NATIVE
// host implements — so on the web phone it is a button that opens a window on
// another machine, or over the cloud relay throws "that control only works with
// the phone host open on this device". Every other surface was flying blind, and
// a send that times out gave one sentence with no account of what it tried.
//
// This module is the missing half. It is deliberately shaped like phone-link.js:
// pure data + pure functions, no React, no Firebase, no imports — so the node
// suite (`npm run test:phone`) exercises exactly what production runs.
//
// Model
// -----
//   RUN   one user-visible operation: "send a text", "reconnect the phone".
//         Belongs to exactly ONE surface — the surface that initiated it, which
//         is what "each their own" means. A run is open (in flight), then ok or
//         failed.
//   STEP  one phase boundary inside a run, stamped with ms-since-run-start:
//         queued at the relay, drained by a host, acked, withdrawn…
//
// Every step carries the elapsed time, because on this app's actual failure —
// a send that "times out even though everything is green" — WHERE the clock
// went is the entire diagnosis. A 30 s gap between "queued" and "gave up
// waiting for the host's ack" says something completely different from a 30 s
// gap before "queued".

// ── Surfaces ────────────────────────────────────────────────────────────────
// The ids are stable strings: they key persisted logs, so renaming one orphans
// a log. The label is what a human sees in Settings.
export const SURFACE_LABEL = {
  'deskphone-web': 'DeskPhone (this PC)',
  tablet: 'Tablet',
  phone: 'Phone browser',
  web: 'Web app',
};

// Which surface is this code running on?
//
// Port 8765 means the page is being SERVED BY the DeskPhone host itself, so it
// is the DeskPhone surface by definition — the same test `10-deskphone-web.jsx`
// already uses to decide loopback vs cloud, kept identical on purpose so the
// log can never disagree with the transport it is describing.
//
// Otherwise it is a browser, and the only distinction the owner asked for is
// tablet vs phone vs desktop web. Coarse UA sniffing is correct here and
// nowhere else: this value only labels a log, so a wrong guess costs a wrong
// heading, never behaviour.
export function detectSurfaceId(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return 'web';
  try {
    if (win.location && String(win.location.port) === '8765') return 'deskphone-web';
  } catch (_) { /* cross-origin location read — fall through to UA */ }
  const ua = String(win.navigator?.userAgent || '');
  const touchPoints = Number(win.navigator?.maxTouchPoints) || 0;
  // iPadOS 13+ reports itself as "Macintosh"; the touch-point count is the only
  // reliable tell. Android tablets are Android WITHOUT the "Mobile" token.
  const isIpad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && touchPoints > 1);
  const isAndroidTablet = /Android/i.test(ua) && !/Mobile/i.test(ua);
  if (isIpad || isAndroidTablet) return 'tablet';
  if (/Android|iPhone|iPod/i.test(ua)) return 'phone';
  return 'web';
}

export function surfaceLabel(surfaceId) {
  return SURFACE_LABEL[surfaceId] || surfaceId || 'Unknown surface';
}

// ── Store ───────────────────────────────────────────────────────────────────
// Module-level, like pending-sms.js: the NerveCenter phone card, the expanded
// phone view and the DeskPhone web page are three components on one page
// looking at one truth. Runs are held newest-first.
export const PROCESS_LOG_EVENT = 'shamash-process-log:change';
const RUN_CAP = 60;             // per surface; a full log, not a tail
const STEP_CAP = 80;            // per run — a runaway retry loop can't eat memory
const PERSIST_KEY = 'shamash_process_log_v1';

let runs = [];                  // newest first, all surfaces
let seq = 0;
let storage = null;             // set by initProcessLog; null = memory only
// Stamped onto copied reports. Set once at boot rather than imported, so this
// module stays import-free and the node suite can run it verbatim.
let context = { appVersion: '' };

export function setProcessLogContext(next = {}) {
  context = { ...context, ...next };
}

function emit() {
  try { window.dispatchEvent(new CustomEvent(PROCESS_LOG_EVENT)); } catch (_) {}
}

// Persisted so the log in Settings still has yesterday's failed send in it.
// Best-effort in both directions: a private-mode browser that throws on
// localStorage still gets a working in-memory log.
function persist() {
  if (!storage) return;
  try {
    storage.setItem(PERSIST_KEY, JSON.stringify(runs.slice(0, RUN_CAP * 2)));
  } catch (_) { /* quota or private mode — memory log stands on its own */ }
}

export function initProcessLog(store = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  storage = store;
  if (!storage) return;
  try {
    const raw = storage.getItem(PERSIST_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      runs = parsed.filter(r => r && r.id && r.surfaceId).slice(0, RUN_CAP * 2);
      // A run left open by a reload (tab closed mid-send) can never complete —
      // marking it interrupted is honest; leaving it "in flight" forever is not.
      runs = runs.map(r => (r.status === 'running'
        ? { ...r, status: 'failed', error: r.error || 'Interrupted — the page was closed or reloaded mid-run.' }
        : r));
      // Keep the counter above anything restored so ids stay unique.
      seq = runs.reduce((max, r) => Math.max(max, Number(String(r.id).split('-').pop()) || 0), 0);
    }
  } catch (_) { runs = []; }
  emit();
}

export function getProcessRuns(surfaceId = null) {
  return surfaceId ? runs.filter(r => r.surfaceId === surfaceId) : runs;
}

export function getProcessRun(runId) {
  return runs.find(r => r.id === runId) || null;
}

export function subscribeProcessLog(onChange) {
  const handler = () => onChange(runs);
  window.addEventListener(PROCESS_LOG_EVENT, handler);
  return () => window.removeEventListener(PROCESS_LOG_EVENT, handler);
}

// Open a run. `kind` groups them ('send' | 'relay-command' | …), `label` is the
// human line ("Text to 845-555-0100"). `transport` records HOW it is being
// attempted — cloud relay vs the host on this machine — because that single
// word is the first thing anyone reading a stalled send needs to know.
export function startProcessRun({ surfaceId, kind = 'relay-command', label = '', detail = '', transport = '' } = {}) {
  const at = Date.now();
  const run = {
    id: `run-${at}-${++seq}`,
    surfaceId: surfaceId || detectSurfaceId(),
    kind,
    label: String(label || ''),
    detail: String(detail || ''),
    transport: String(transport || ''),
    at,
    endedAt: 0,
    status: 'running',        // 'running' | 'ok' | 'failed'
    error: '',
    steps: [],
  };
  runs = [run, ...runs].slice(0, RUN_CAP * 2);
  // Cap per surface rather than globally, so a chatty surface can't evict
  // another surface's history — each log is that app's own.
  const perSurface = new Map();
  runs = runs.filter(r => {
    const n = (perSurface.get(r.surfaceId) || 0) + 1;
    perSurface.set(r.surfaceId, n);
    return n <= RUN_CAP;
  });
  persist();
  emit();
  return run.id;
}

// Record a phase boundary. `status`: 'info' | 'ok' | 'warn' | 'fail'.
export function logProcessStep(runId, { stage, note = '', status = 'info' } = {}) {
  if (!runId || !stage) return;
  let touched = false;
  runs = runs.map(r => {
    if (r.id !== runId) return r;
    touched = true;
    const step = {
      stage: String(stage),
      note: String(note || ''),
      status,
      at: Date.now(),
      sinceStartMs: Math.max(0, Date.now() - r.at),
    };
    const steps = r.steps.length >= STEP_CAP
      // Keep the FIRST steps and the latest ones: the opening of a run explains
      // what was attempted, the tail explains how it ended. The middle of a
      // retry storm is the part nobody reads.
      ? [...r.steps.slice(0, STEP_CAP - 20), { stage: '…', note: `${r.steps.length - (STEP_CAP - 20)} earlier steps trimmed`, status: 'info', at: step.at, sinceStartMs: step.sinceStartMs }, ...r.steps.slice(-19), step]
      : [...r.steps, step];
    return { ...r, steps };
  });
  if (touched) { persist(); emit(); }
}

export function finishProcessRun(runId, { ok = true, error = '' } = {}) {
  if (!runId) return;
  let touched = false;
  runs = runs.map(r => {
    if (r.id !== runId) return r;
    touched = true;
    return { ...r, status: ok ? 'ok' : 'failed', error: ok ? '' : String(error || 'Failed'), endedAt: Date.now() };
  });
  if (touched) { persist(); emit(); }
}

export function clearProcessLog(surfaceId = null) {
  runs = surfaceId ? runs.filter(r => r.surfaceId !== surfaceId) : [];
  persist();
  emit();
}

// The newest run for a surface, whatever its state — what the mini popup shows.
export function latestProcessRun(surfaceId) {
  return runs.find(r => r.surfaceId === surfaceId) || null;
}

// ── Formatting ──────────────────────────────────────────────────────────────

export function formatElapsed(ms) {
  const n = Math.max(0, Number(ms) || 0);
  if (n < 1000) return `${n}ms`;
  if (n < 10000) return `${(n / 1000).toFixed(1)}s`;
  if (n < 60000) return `${Math.round(n / 1000)}s`;
  const m = Math.floor(n / 60000);
  return `${m}m ${Math.round((n % 60000) / 1000)}s`;
}

function clockOf(ms) {
  try { return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch (_) { return String(ms); }
}

// Plain text for the clipboard — the "allow copy to paste into a prompt" half
// of the ticket. It is written to be pasted into a chat with no editing: it
// states the surface, the transport, the verdict, and every step with its
// elapsed time, then asks the question the owner would have had to type.
export function processRunToPrompt(run) {
  if (!run) return '';
  const verdict = run.status === 'ok' ? 'SUCCEEDED'
    : run.status === 'failed' ? 'FAILED'
      : 'STILL RUNNING';
  const total = run.endedAt ? run.endedAt - run.at : Date.now() - run.at;
  const lines = [
    `Shamash process log — ${run.kind} on the ${surfaceLabel(run.surfaceId)} surface`,
    `${run.label || '(no label)'}${run.detail ? ` — ${run.detail}` : ''}`,
    `Transport: ${run.transport || 'unknown'}`,
    `Started ${clockOf(run.at)} · ${verdict} after ${formatElapsed(total)}`,
  ];
  if (run.status === 'failed' && run.error) lines.push(`Reported error: ${run.error}`);
  lines.push('', 'Steps:');
  run.steps.forEach((s, i) => {
    const mark = s.status === 'fail' ? '✗' : s.status === 'warn' ? '!' : s.status === 'ok' ? '✓' : '·';
    lines.push(`${String(i + 1).padStart(2, ' ')}. ${mark} +${formatElapsed(s.sinceStartMs)}  ${s.stage}${s.note ? ` — ${s.note}` : ''}`);
  });
  if (!run.steps.length) lines.push('  (no steps recorded)');
  if (context.appVersion) lines.push('', `App version: ${context.appVersion}`);
  lines.push('', 'What in this sequence explains the outcome, and what should change?');
  return lines.join('\n');
}

// Whole-surface dump, newest run first — the Settings screen's copy button.
export function processLogToPrompt(surfaceId) {
  const list = getProcessRuns(surfaceId);
  if (!list.length) return `Shamash process log — ${surfaceLabel(surfaceId)}: no runs recorded.`;
  return [
    `Shamash process log — ${surfaceLabel(surfaceId)} · ${list.length} run${list.length === 1 ? '' : 's'}`,
    '',
    ...list.map(r => processRunToPrompt(r)),
  ].join('\n\n────────────────────\n\n');
}

// One-line summary for a collapsed row.
export function summarizeProcessRun(run) {
  if (!run) return '';
  const total = run.endedAt ? run.endedAt - run.at : Date.now() - run.at;
  const last = run.steps[run.steps.length - 1];
  if (run.status === 'running') return `${last ? last.stage : 'starting'}… ${formatElapsed(total)}`;
  if (run.status === 'ok') return `Done in ${formatElapsed(total)}`;
  return `${run.error || 'Failed'} (${formatElapsed(total)})`;
}
