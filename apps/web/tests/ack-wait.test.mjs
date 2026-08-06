// Ack tracker tests — the waiting half of "did the host really run my command?".
// These lock down owner ticket PZw6eQft: a send that the host DID run was being
// reported as failed because nothing fed the wait, and because the refresh that
// finally carried the ack was ignored.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createAckTracker } from '../src/08-app-split/utils/ack-wait.js';

const ok = id => ({ id, ok: true });

test('an ack already in hand resolves without waiting', async () => {
  const t = createAckTracker();
  t.record([ok('a')]);
  assert.deepEqual(await t.awaitAck('a', { timeoutMs: 50 }), { id: 'a', ok: true });
});

test('passive wait times out when nothing feeds it — the reported bug', async () => {
  const t = createAckTracker();
  // No poll supplied: this is the old behaviour. The host ran the command, but
  // the result never reached the tracker, so the verdict is a false failure.
  assert.equal(await t.awaitAck('a', { timeoutMs: 60, pollMs: 20 }), null);
});

test('active wait finds an ack the poll fetches — however late in the window', async () => {
  const t = createAckTracker();
  let polls = 0;
  const poll = async () => { polls += 1; if (polls >= 3) t.record([ok('a')]); };
  const ack = await t.awaitAck('a', { timeoutMs: 5000, pollMs: 10, poll });
  assert.deepEqual(ack, { id: 'a', ok: true });
  assert.equal(polls, 3);
});

test('a poll that throws is not a verdict — the wait keeps going', async () => {
  const t = createAckTracker();
  let polls = 0;
  const poll = async () => {
    polls += 1;
    if (polls < 3) throw new Error('network');
    t.record([ok('a')]);
  };
  assert.deepEqual(await t.awaitAck('a', { timeoutMs: 5000, pollMs: 10, poll }), { id: 'a', ok: true });
});

test('the post-timeout refresh is authoritative — a null wait is not a verdict', async () => {
  const t = createAckTracker();
  // The caller's contract after a timeout: refresh, THEN look again. Both
  // surfaces used to refresh and branch on the stale null, which is how a send
  // the host really made was reported as failed.
  const timedOut = await t.awaitAck('a', { timeoutMs: 20 });
  assert.equal(timedOut, null);
  t.record([ok('a')]);                  // what the refresh carried
  assert.deepEqual(t.get('a'), { id: 'a', ok: true });
});

test('get() after a refresh sees what the refresh carried', () => {
  const t = createAckTracker();
  assert.equal(t.get('a'), null);
  t.record([{ id: 'a', ok: false, error: 'no phone' }]);
  assert.deepEqual(t.get('a'), { id: 'a', ok: false, error: 'no phone' });
});

test('a failure ack resolves the wait immediately — it is an answer', async () => {
  const t = createAckTracker();
  const p = t.awaitAck('a', { timeoutMs: 5000, pollMs: 1000 });
  t.record([{ id: 'a', ok: false, error: 'bluetooth down' }]);
  assert.equal((await p).error, 'bluetooth down');
});

test('the first result for an id wins; a re-sent blob cannot rewrite it', () => {
  const t = createAckTracker();
  t.record([ok('a')]);
  t.record([{ id: 'a', ok: false, error: 'late contradiction' }]);
  assert.equal(t.get('a').ok, true);
});

test('unrelated acks do not resolve this wait', async () => {
  const t = createAckTracker();
  const p = t.awaitAck('mine', { timeoutMs: 40, pollMs: 100 });
  t.record([ok('someone-elses')]);
  assert.equal(await p, null);
});

test('the map stays bounded', () => {
  const t = createAckTracker({ limit: 3 });
  t.record([ok('a'), ok('b'), ok('c'), ok('d')]);
  assert.equal(t.size(), 3);
  assert.equal(t.get('a'), null);
  assert.equal(t.get('d').ok, true);
});
