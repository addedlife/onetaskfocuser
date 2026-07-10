// Pending-SMS echo store tests — run with `npm run test:phone`.
// Locks down: optimistic echo lifecycle, exact cid reconciliation, the fuzzy
// fallback for pre-cid hosts, and the stuck-double visual collapse.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// The store broadcasts through window events; give node a minimal stand-in.
const listeners = new Map();
globalThis.window = {
  addEventListener: (name, fn) => listeners.set(fn, name),
  removeEventListener: (name, fn) => listeners.delete(fn),
  dispatchEvent: (e) => { for (const [fn, name] of listeners) if (name === e.type) fn(e); return true; },
};
globalThis.CustomEvent = class { constructor(type) { this.type = type; } };

const {
  addPendingSms, updatePendingSms, removePendingSms, getPendingSms,
  reconcilePendingSms, unmatchedPendingSms, collapseHostDoubles, smsBodyKey, smsPhoneKey,
} = await import('../src/08-app-split/utils/pending-sms.js');

beforeEach(() => {
  for (const e of [...getPendingSms()]) removePendingSms(e.id);
});

test('phone/body keys normalize country code, format, whitespace, case', () => {
  assert.equal(smsPhoneKey('+1 (574) 555-1234'), '5745551234');
  assert.equal(smsBodyKey('Hello  world\r\n'), smsBodyKey('hello world\n'));
});

test('exact cid match reconciles regardless of body/number quirks', () => {
  const echo = addPendingSms({ to: '5745551234', body: 'original text' });
  // Host copy has a REWRITTEN body (e.g. MMS re-encode) — fuzzy would miss it.
  const host = [{ cid: echo.id, key: 'different', bodyKey: 'totally different', timeMs: 0 }];
  assert.equal(unmatchedPendingSms(getPendingSms(), host).length, 0);
  reconcilePendingSms(host);
  assert.equal(getPendingSms().length, 0);
});

test('fuzzy fallback still matches pre-cid hosts', () => {
  const echo = addPendingSms({ to: '(574) 555-1234', body: 'Hi there' });
  const host = [{ cid: 'phone-handle-9', key: '5745551234', bodyKey: smsBodyKey('Hi  there'), timeMs: Date.now() }];
  reconcilePendingSms(host);
  assert.equal(getPendingSms().length, 0);
  // but a different body survives
  addPendingSms({ to: '5745551234', body: 'Second text' });
  reconcilePendingSms(host);
  assert.equal(getPendingSms().length, 1);
});

test('an hour-old host copy never swallows a fresh echo', () => {
  addPendingSms({ to: '5745551234', body: 'again' });
  reconcilePendingSms([{ cid: '', key: '5745551234', bodyKey: smsBodyKey('again'), timeMs: Date.now() - 3600_000 }]);
  assert.equal(getPendingSms().length, 1);
});

test('status updates flow through the store', () => {
  const echo = addPendingSms({ to: '15745551234', body: 'x' });
  updatePendingSms(echo.id, { status: 'failed', error: 'no host' });
  assert.equal(getPendingSms()[0].status, 'failed');
  assert.equal(getPendingSms()[0].error, 'no host');
});

test('collapseHostDoubles drops the stuck pending twin, keeps everything real', () => {
  const now = Date.now();
  const rows = [
    { id: 'stuck', out: true, pending: true, body: 'Yo', t: now - 120_000 },   // Confirming forever
    { id: 'real', out: true, pending: false, body: 'Yo', t: now },             // confirmed copy
    { id: 'other', out: true, pending: true, body: 'Other', t: now },          // unrelated in-flight
    { id: 'in', out: false, pending: false, body: 'Yo', t: now },              // incoming untouched
  ];
  const kept = collapseHostDoubles(rows, {
    groupKey: () => 'thread', bodyKey: r => smsBodyKey(r.body), timeMs: r => r.t,
    isOutgoing: r => r.out, isPending: r => r.pending,
  });
  assert.deepEqual(kept.map(r => r.id), ['real', 'other', 'in']);
});
