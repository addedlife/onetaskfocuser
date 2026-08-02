// ── Process log UI: the live mini popup, and the full per-app log ────────────
//
// Two owner tickets, 7/29, one feature:
//
//   "make a mini process log that pops up on any phone surface when i send a text
//    or use the relay showing the live attempt/send process of that app (web,
//    deskphone, tablet — each their own) and after the process is finished allow
//    copy to paste into a prompt."
//
//   "make a full process log on each app for that app … reachable by settings of
//    its app, autorouting to its one. the log on deskphone is the perfect design
//    model to replicate."
//
// The DeskPhone host's own live log is the model: monospaced, one line per step,
// newest work visible without scrolling, timestamp first. Both views here follow
// it. The data comes from process-log.js, which is surface-scoped — so "each
// their own" and "autorouting to its one" are properties of the store, not of
// this file: a surface renders `detectSurfaceId()` and by construction sees only
// its own runs.
import React, { useCallback, useEffect, useState } from 'react';
import { NC_FONT_STACK, NC_MONO_STACK, NC_TYPE, RADIUS, SP, ELEV, suiteIcon } from '../ui-tokens.jsx';
import { ActionBtn, IconBtn } from '../m3.jsx';
import {
  detectSurfaceId, subscribeProcessLog, getProcessRuns, latestProcessRun,
  processRunToPrompt, processLogToPrompt, summarizeProcessRun, formatElapsed,
  surfaceLabel, clearProcessLog,
} from '../process-log.js';

// Re-render on every store change AND on a 1 s clock, because a run in flight
// has to show its elapsed time climbing — that ticking number is the whole point
// of a LIVE log, and without it a stalled send looks identical to a finished one.
function useProcessRuns(surfaceId) {
  const [, setTick] = useState(0);
  useEffect(() => subscribeProcessLog(() => setTick(t => t + 1)), []);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return getProcessRuns(surfaceId);
}

const STATUS_ICON = { ok: 'check_circle', fail: 'error', warn: 'warning', info: 'radio_button_unchecked' };

function statusColor(status, C) {
  if (status === 'ok') return C.success;
  if (status === 'fail') return C.danger;
  if (status === 'warn') return C.warning || C.accent;
  return C.faint;
}

// One step line, DeskPhone-log shaped: elapsed stamp, glyph, stage, note.
function StepLine({ step, C }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: SP.sm, padding: `2px 0` }}>
      <span style={{ fontFamily: NC_MONO_STACK, fontSize: NC_TYPE.meta, color: C.faint, flexShrink: 0, minWidth: 52, textAlign: 'right' }}>
        +{formatElapsed(step.sinceStartMs)}
      </span>
      <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', color: statusColor(step.status, C) }}>
        {suiteIcon(STATUS_ICON[step.status] || STATUS_ICON.info, 12)}
      </span>
      <span style={{ fontSize: NC_TYPE.meta, color: C.text, minWidth: 0, overflowWrap: 'anywhere' }}>
        {step.stage}
        {step.note ? <span style={{ color: C.muted }}> — {step.note}</span> : null}
      </span>
    </div>
  );
}

// Copy button that confirms it copied. Shared by both views; the clipboard can
// reject (permissions, insecure context), and silently doing nothing is exactly
// the class of dead control these tickets are about — so a failure says so.
// `getText` is a function, not a string: the whole-log dump is a few thousand
// characters and the panel re-renders once a second while a run is in flight —
// building it every tick for a button nobody clicked is pure waste.
function CopyButton({ getText, label = 'Copy for prompt', C }) {
  const [state, setState] = useState('idle');   // idle | done | failed
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(getText());
      setState('done');
    } catch (_) {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 2400);
  }, [getText]);
  return (
    <ActionBtn variant="tonal" height={40} labelSize={NC_TYPE.meta}
      icon={state === 'done' ? 'check' : state === 'failed' ? 'error' : 'content_copy'}
      labelColor={state === 'failed' ? C.danger : undefined}
      onClick={copy} title={label} aria-label={label}>
      {state === 'done' ? 'Copied' : state === 'failed' ? 'Copy blocked — select the text' : label}
    </ActionBtn>
  );
}

// ── The mini popup ──────────────────────────────────────────────────────────
// Appears the moment a run opens on THIS surface and streams its steps. It is a
// LIVE readout of something happening right now, and nothing else — the owner's
// correction, 8/2: "its for reference while connection processes and dlogs can
// be accesible in settings, but not a obsuring mainscreen persisten popup."
//
// Three rules follow from that, and each fixes something this popup actually
// did wrong:
//
//   1. Only a run that STARTED while this popup was mounted is ever shown. Runs
//      are persisted to localStorage for the Settings log, and the popup asked
//      for "the newest run on this surface" with no regard for when it happened
//      — so a failure from any earlier session came straight back on the next
//      page load, forever, until some later run replaced it. That is the
//      "persisting after closeout" the owner is seeing: it was never the same
//      popup surviving a dismissal, it was a new one resurrecting a dead run.
//   2. Once a run ends the card collapses to its one-line header. The full step
//      list is worth the screen while it is being written and not afterwards;
//      afterwards it is a block sitting on top of the main screen.
//   3. Everything self-dismisses, failures included. A failure used to wait
//      forever for a click, on the reasoning that a failure is what you want to
//      copy — but the run is in Settings → Process log with the same copy
//      button on it, so nothing is lost by letting the card go. It gets a much
//      longer window than a success, which is the part of that reasoning that
//      was right.
const SUCCESS_DISMISS_MS = 6000;
const FAILURE_DISMISS_MS = 20000;

// Dismissals live outside React. The popup is mounted by phone surfaces that
// mount and unmount as the owner moves around the app, and component state took
// the dismissal with it — closing the card and navigating brought the same run
// straight back.
const dismissedRuns = new Set();

// The popup is mounted by every phone surface, and more than one of those can be
// on screen at once (the NerveCenter phone card and the embedded DeskPhone panel
// live on the same page). They would render two identical position-fixed cards
// stacked on each other. So: first mount wins, and hands over if it unmounts.
const popupMounts = [];
const popupWatchers = new Set();
function claimPopup(token) {
  popupMounts.push(token);
  popupWatchers.forEach(fn => fn());
  return () => {
    const i = popupMounts.indexOf(token);
    if (i >= 0) popupMounts.splice(i, 1);
    popupWatchers.forEach(fn => fn());
  };
}

export function ProcessLogPopup({ C, surfaceId = null, zIndex = 9200 }) {
  const mySurface = surfaceId || detectSurfaceId();
  useProcessRuns(mySurface);   // subscribes to the store + the 1 s elapsed clock
  const [token] = useState(() => ({}));
  const [, setOwnerTick] = useState(0);
  useEffect(() => {
    const watcher = () => setOwnerTick(t => t + 1);
    popupWatchers.add(watcher);
    const release = claimPopup(token);
    return () => { popupWatchers.delete(watcher); release(); };
  }, [token]);
  // Nothing that started before this popup existed is its business. Held in a
  // ref-shaped state initialiser so it is fixed at first render and a re-render
  // can never quietly move it forward.
  const [mountedAt] = useState(() => Date.now());
  const [, setDismissTick] = useState(0);
  const dismiss = useCallback(id => { dismissedRuns.add(id); setDismissTick(t => t + 1); }, []);
  const [manualExpand, setManualExpand] = useState(null);   // null = follow the run's state
  const latest = latestProcessRun(mySurface);
  const run = latest && latest.at >= mountedAt ? latest : null;

  // Every run self-dismisses; a failure just gets longer on screen than a
  // success. The timer is computed from `endedAt` rather than set when the run
  // finishes, so a card that was already up before this component re-rendered
  // still goes away on schedule instead of restarting its clock.
  const settled = run && run.status !== 'running';
  useEffect(() => {
    if (!settled) return undefined;
    const life = run.status === 'ok' ? SUCCESS_DISMISS_MS : FAILURE_DISMISS_MS;
    const remaining = life - (Date.now() - (run.endedAt || Date.now()));
    if (remaining <= 0) { dismiss(run.id); return undefined; }
    const timer = setTimeout(() => dismiss(run.id), remaining);
    return () => clearTimeout(timer);
  }, [run?.id, run?.status, run?.endedAt, settled, dismiss]);

  // A new run is a fresh card: whatever the owner had collapsed or expanded on
  // the last one does not carry over.
  useEffect(() => { setManualExpand(null); }, [run?.id]);

  if (popupMounts[0] !== token) return null;
  if (!run || dismissedRuns.has(run.id)) return null;
  const running = run.status === 'running';
  // Expanded while the steps are still arriving, collapsed to the header once
  // they stop — unless the owner has said otherwise on this particular run.
  const expanded = manualExpand == null ? running : manualExpand;
  const failed = run.status === 'failed';
  const total = run.endedAt ? run.endedAt - run.at : Date.now() - run.at;
  const accent = failed ? C.danger : running ? C.accent : C.success;

  return (
    <div style={{
      position: 'fixed', right: SP.md, bottom: SP.md, zIndex,
      width: 'min(380px, calc(100vw - 24px))', maxHeight: '60vh',
      display: 'flex', flexDirection: 'column',
      background: C.bg, border: `1px solid ${C.divider}`, borderLeft: `3px solid ${accent}`,
      borderRadius: RADIUS.md, boxShadow: ELEV[3], fontFamily: NC_FONT_STACK,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: SP.sm, padding: `${SP.sm} ${SP.sm} ${SP.xs} ${SP.md}`, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', color: accent, flexShrink: 0 }}>
          {suiteIcon(failed ? 'error' : running ? 'sync' : 'check_circle', 16)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: NC_TYPE.body, color: C.text, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {run.label || run.kind}
          </div>
          {/* Collapsed, the subtitle carries the verdict rather than the
              plumbing: a failed card that has folded itself up must still say
              what went wrong without being reopened. */}
          <div style={{ fontSize: NC_TYPE.small, color: !expanded && failed ? C.danger : C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {!expanded && failed && run.error
              ? run.error
              : `${surfaceLabel(run.surfaceId)}${run.transport ? ` · ${run.transport}` : ''} · ${formatElapsed(total)}`}
          </div>
        </div>
        <IconBtn icon={expanded ? 'expand_more' : 'expand_less'} iconSize={16} size={32} color={C.muted}
          title={expanded ? 'Collapse' : 'Expand'} aria-label={expanded ? 'Collapse process log' : 'Expand process log'}
          onClick={() => setManualExpand(!expanded)} />
        <IconBtn icon="close" iconSize={16} size={32} color={C.muted}
          title="Dismiss" aria-label="Dismiss process log" onClick={() => dismiss(run.id)} />
      </div>

      {expanded && (
        <div style={{ overflowY: 'auto', padding: `0 ${SP.md} ${SP.sm}`, minHeight: 0 }}>
          {run.steps.length
            ? run.steps.map((s, i) => <StepLine key={i} step={s} C={C} />)
            : <div style={{ fontSize: NC_TYPE.meta, color: C.faint, padding: `${SP.xs} 0` }}>Starting…</div>}
          {failed && run.error && (
            <div style={{ marginTop: SP.xs, fontSize: NC_TYPE.meta, color: C.danger, overflowWrap: 'anywhere' }}>{run.error}</div>
          )}
        </div>
      )}

      {/* The copy control is offered the moment the run ends, which is what
          "after the process is finished allow copy to paste into a prompt"
          asks for. It is deliberately NOT offered mid-run: half a log invites
          a diagnosis of half a problem. */}
      {!running && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: SP.sm, padding: `${SP.xs} ${SP.sm} ${SP.sm}`, borderTop: `1px solid ${C.divider}` }}>
          <CopyButton getText={() => processRunToPrompt(run)} C={C} />
        </div>
      )}
    </div>
  );
}

// ── The full log ────────────────────────────────────────────────────────────
// Settings → Process log. Shows THIS app's runs only, newest first, each
// expandable to its steps. `surfaceId` can be overridden for a debug view, but
// the default is the running surface, which is the "autorouting to its one"
// half of the ticket: there is no picker to get wrong.
export function ProcessLogPanel({ C, surfaceId = null }) {
  const mySurface = surfaceId || detectSurfaceId();
  const runs = useProcessRuns(mySurface);
  const [openId, setOpenId] = useState('');

  return (
    <div style={{ fontFamily: NC_FONT_STACK, display: 'flex', flexDirection: 'column', gap: SP.sm, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: SP.sm, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: NC_TYPE.body, color: C.text, fontWeight: 600 }}>{surfaceLabel(mySurface)}</div>
          <div style={{ fontSize: NC_TYPE.meta, color: C.muted }}>
            {runs.length ? `${runs.length} recorded process${runs.length === 1 ? '' : 'es'} on this device` : 'Nothing recorded on this device yet.'}
          </div>
        </div>
        <CopyButton getText={() => processLogToPrompt(mySurface)} label="Copy whole log" C={C} />
        <ActionBtn variant="text" height={40} labelSize={NC_TYPE.meta} icon="delete_sweep"
          onClick={() => clearProcessLog(mySurface)} title="Clear this device's log" aria-label="Clear this device's log">
          Clear
        </ActionBtn>
      </div>

      {!runs.length && (
        <div style={{ fontSize: NC_TYPE.meta, color: C.faint, padding: SP.md, border: `1px solid ${C.divider}`, borderRadius: RADIUS.sm }}>
          Sends and relay commands from this device are recorded here as they happen — one entry per attempt, with the
          time each step took. Nothing is uploaded; this log lives on this device only.
        </div>
      )}

      {runs.map(run => {
        const open = openId === run.id;
        const total = run.endedAt ? run.endedAt - run.at : Date.now() - run.at;
        const tone = run.status === 'failed' ? C.danger : run.status === 'running' ? C.accent : C.success;
        return (
          <div key={run.id} style={{ border: `1px solid ${C.divider}`, borderLeft: `3px solid ${tone}`, borderRadius: RADIUS.sm, background: C.bg, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: SP.sm, padding: SP.sm, minWidth: 0, cursor: 'pointer' }}
              onClick={() => setOpenId(open ? '' : run.id)}>
              <span style={{ display: 'flex', alignItems: 'center', color: tone, flexShrink: 0 }}>
                {suiteIcon(run.status === 'failed' ? 'error' : run.status === 'running' ? 'sync' : 'check_circle', 14)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: NC_TYPE.meta, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {run.label || run.kind}
                </div>
                <div style={{ fontSize: NC_TYPE.small, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {summarizeProcessRun(run)}{run.transport ? ` · ${run.transport}` : ''}
                </div>
              </div>
              <span style={{ fontFamily: NC_MONO_STACK, fontSize: NC_TYPE.small, color: C.faint, flexShrink: 0 }}>{formatElapsed(total)}</span>
              <span style={{ display: 'flex', alignItems: 'center', color: C.faint, flexShrink: 0 }}>
                {suiteIcon(open ? 'expand_less' : 'expand_more', 14)}
              </span>
            </div>
            {open && (
              <div style={{ padding: `0 ${SP.sm} ${SP.sm}`, borderTop: `1px solid ${C.divider}` }}>
                {run.steps.map((s, i) => <StepLine key={i} step={s} C={C} />)}
                {!run.steps.length && <div style={{ fontSize: NC_TYPE.meta, color: C.faint, padding: `${SP.xs} 0` }}>No steps recorded.</div>}
                {run.status === 'failed' && run.error && (
                  <div style={{ marginTop: SP.xs, fontSize: NC_TYPE.meta, color: C.danger, overflowWrap: 'anywhere' }}>{run.error}</div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: SP.sm }}>
                  <CopyButton getText={() => processRunToPrompt(run)} C={C} />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
