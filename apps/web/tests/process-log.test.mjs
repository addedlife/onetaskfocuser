// Node suite for the per-surface process log. Same contract as the phone-link
// and pending-sms suites: the module is pure, so these tests exercise exactly
// what production runs.
//
// `emit()` and `initProcessLog` touch window/localStorage, so a minimal stub is
// installed before the import — enough for the module to behave as it does in a
// browser without pulling in a DOM library.
import test from 'node:test';
import assert from 'node:assert/strict';

const listeners = new Map();
globalThis.window = {
  addEventListener: (name, fn) => { listeners.set(fn, name); },
  removeEventListener: (fn) => { listeners.delete(fn); },
  dispatchEvent: () => true,
  navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', maxTouchPoints: 0 },
  location: { port: '' },
};
globalThis.CustomEvent = class { constructor(type) { this.type = type; } };

const {
  detectSurfaceId, surfaceLabel, startProcessRun, logProcessStep, finishProcessRun,
  getProcessRuns, getProcessRun, latestProcessRun, clearProcessLog,
  processRunToPrompt, processLogToPrompt, summarizeProcessRun, formatElapsed,
  setProcessLogContext, initProcessLog,
} = await import('../src/08-app-split/process-log.js');

test('surface detection: port 8765 is the DeskPhone surface', () => {
  assert.equal(detectSurfaceId({ location: { port: '8765' }, navigator: {} }), 'deskphone-web');
});

test('surface detection: iPadOS reporting as Macintosh is a tablet', () => {
  assert.equal(detectSurfaceId({
    location: { port: '' },
    navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 },
  }), 'tablet');
});

test('surface detection: Android without the Mobile token is a tablet, with it is a phone', () => {
  const base = { location: { port: '' } };
  assert.equal(detectSurfaceId({ ...base, navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-T870)' } }), 'tablet');
  assert.equal(detectSurfaceId({ ...base, navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile' } }), 'phone');
});

test('surface detection: plain desktop is the web surface', () => {
  assert.equal(detectSurfaceId({ location: { port: '' }, navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0)' } }), 'web');
  assert.equal(detectSurfaceId(null), 'web');
});

test('a run records steps with elapsed time and closes with a verdict', () => {
  clearProcessLog();
  const id = startProcessRun({ surfaceId: 'web', kind: 'send', label: 'Text to 5550100', transport: 'cloud relay' });
  logProcessStep(id, { stage: 'queued at the relay', status: 'ok', note: 'id 123' });
  logProcessStep(id, { stage: 'waiting for the host ack', status: 'info' });
  finishProcessRun(id, { ok: false, error: 'No ack in 25s' });

  const run = getProcessRun(id);
  assert.equal(run.status, 'failed');
  assert.equal(run.error, 'No ack in 25s');
  assert.equal(run.steps.length, 2);
  assert.ok(run.endedAt >= run.at);
  assert.ok(run.steps.every(s => typeof s.sinceStartMs === 'number' && s.sinceStartMs >= 0));
});

test('runs are kept per surface — one surface never shows another surface\'s runs', () => {
  clearProcessLog();
  startProcessRun({ surfaceId: 'web', kind: 'send', label: 'from web' });
  startProcessRun({ surfaceId: 'tablet', kind: 'send', label: 'from tablet' });
  startProcessRun({ surfaceId: 'deskphone-web', kind: 'send', label: 'from deskphone' });

  assert.equal(getProcessRuns('web').length, 1);
  assert.equal(getProcessRuns('tablet').length, 1);
  assert.equal(getProcessRuns('deskphone-web').length, 1);
  assert.equal(getProcessRuns().length, 3);
  assert.equal(latestProcessRun('tablet').label, 'from tablet');
});

test('clearing one surface leaves the others intact', () => {
  clearProcessLog();
  startProcessRun({ surfaceId: 'web', label: 'w' });
  startProcessRun({ surfaceId: 'tablet', label: 't' });
  clearProcessLog('web');
  assert.equal(getProcessRuns('web').length, 0);
  assert.equal(getProcessRuns('tablet').length, 1);
});

test('the per-surface cap evicts only that surface', () => {
  clearProcessLog();
  for (let i = 0; i < 70; i++) startProcessRun({ surfaceId: 'web', label: `w${i}` });
  startProcessRun({ surfaceId: 'tablet', label: 'kept' });
  assert.equal(getProcessRuns('web').length, 60);
  assert.equal(getProcessRuns('tablet').length, 1, 'the tablet run must survive a chatty web surface');
  // Newest first, so the most recent web run is still at the front.
  assert.equal(getProcessRuns('web')[0].label, 'w69');
});

test('a step storm is trimmed in the middle, keeping the opening and the tail', () => {
  clearProcessLog();
  const id = startProcessRun({ surfaceId: 'web', label: 'noisy' });
  for (let i = 0; i < 200; i++) logProcessStep(id, { stage: `step ${i}` });
  const run = getProcessRun(id);
  assert.ok(run.steps.length <= 81, `expected the step list to stay bounded, got ${run.steps.length}`);
  assert.equal(run.steps[0].stage, 'step 0', 'the first step explains what was attempted');
  assert.equal(run.steps[run.steps.length - 1].stage, 'step 199', 'the last step explains how it ended');
  assert.ok(run.steps.some(s => s.stage === '…'), 'the trim is visible, not silent');
});

test('the copyable report names the surface, transport, verdict and every step', () => {
  clearProcessLog();
  setProcessLogContext({ appVersion: '4.113.4' });
  const id = startProcessRun({ surfaceId: 'web', kind: 'send', label: 'Text to 5550100', transport: 'cloud relay' });
  logProcessStep(id, { stage: 'queued at the relay', status: 'ok' });
  finishProcessRun(id, { ok: false, error: 'No ack in 25s' });

  const text = processRunToPrompt(getProcessRun(id));
  assert.match(text, /Web app/);
  assert.match(text, /Transport: cloud relay/);
  assert.match(text, /FAILED/);
  assert.match(text, /Reported error: No ack in 25s/);
  assert.match(text, /queued at the relay/);
  assert.match(text, /App version: 4\.113\.4/);
});

test('a still-open run reports as running, not as a success', () => {
  clearProcessLog();
  const id = startProcessRun({ surfaceId: 'web', label: 'open' });
  const run = getProcessRun(id);
  assert.equal(run.status, 'running');
  assert.match(processRunToPrompt(run), /STILL RUNNING/);
  assert.match(summarizeProcessRun(run), /starting|…/);
});

test('the whole-surface dump covers every run and says so when empty', () => {
  clearProcessLog();
  assert.match(processLogToPrompt('web'), /no runs recorded/);
  const a = startProcessRun({ surfaceId: 'web', label: 'first' });
  finishProcessRun(a, { ok: true });
  const b = startProcessRun({ surfaceId: 'web', label: 'second' });
  finishProcessRun(b, { ok: true });
  const dump = processLogToPrompt('web');
  assert.match(dump, /2 runs/);
  assert.match(dump, /first/);
  assert.match(dump, /second/);
});

test('an interrupted run restored from storage is marked failed, never left in flight', () => {
  clearProcessLog();
  const saved = JSON.stringify([{
    id: 'run-1-1', surfaceId: 'web', kind: 'send', label: 'mid-send reload',
    at: Date.now() - 5000, endedAt: 0, status: 'running', error: '', steps: [], transport: 'cloud relay', detail: '',
  }]);
  initProcessLog({ getItem: () => saved, setItem: () => {} });
  const run = getProcessRuns('web')[0];
  assert.equal(run.status, 'failed');
  assert.match(run.error, /Interrupted/);
  // Leave the module on a memory-only store so later tests don't persist.
  initProcessLog(null);
  clearProcessLog();
});

test('formatElapsed reads as a human duration at every scale', () => {
  assert.equal(formatElapsed(0), '0ms');
  assert.equal(formatElapsed(450), '450ms');
  assert.equal(formatElapsed(1500), '1.5s');
  assert.equal(formatElapsed(25000), '25s');
  assert.equal(formatElapsed(95000), '1m 35s');
});

test('surfaceLabel never returns empty for an unknown id', () => {
  assert.equal(surfaceLabel('web'), 'Web app');
  assert.equal(surfaceLabel('made-up'), 'made-up');
  assert.equal(surfaceLabel(''), 'Unknown surface');
});
