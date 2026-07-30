// Node suite for the command-channel pre-flight (owner ticket 7/29 — a text sent
// from the web phone that times out after 30 s while every panel shows green).
//
// This module is the only thing standing between the owner and that 30 s wait, and
// it is pure, so these tests are the real verification: the surface it guards needs
// a signed-in browser and a live phone host, neither of which a build can stand in
// for. The two rules that matter here pull in opposite directions —
//   • never refuse a send that would have worked (absent/unknown fields stay
//     permissive, older hosts included), and
//   • never accept one that provably cannot be picked up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { commandChannelHealth, commandChannelLabel } from '../src/08-app-split/utils/relay-health.js';

test('a host that predates the field is trusted', () => {
  for (const status of [undefined, null, {}, { commandChannel: null }, { connected: false }]) {
    const h = commandChannelHealth(status);
    assert.equal(h.ok, true);
    assert.equal(h.known, false);
    assert.equal(commandChannelLabel(status), '');
  }
});

test('a healthy host passes and shows no chip', () => {
  const status = { connected: true, commandChannel: { draining: true, reachable: true, enrollState: 'approved', authBlocked: null } };
  assert.deepEqual(commandChannelHealth(status), { known: true, ok: true, reason: '' });
  assert.equal(commandChannelLabel(status), '');
});

test('pending, revoked and auth-blocked hosts are refused with the fix named', () => {
  const pending = commandChannelHealth({ connected: true, commandChannel: { draining: true, enrollState: 'pending' } });
  assert.equal(pending.ok, false);
  assert.match(pending.reason, /approval/i);

  const revoked = commandChannelHealth({ connected: true, commandChannel: { draining: true, enrollState: 'revoked' } });
  assert.equal(revoked.ok, false);
  assert.match(revoked.reason, /Phone hosts/);

  const blocked = commandChannelHealth({ connected: true, commandChannel: { draining: true, enrollState: 'approved', authBlocked: 'device not enrolled' } });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /device not enrolled/);
});

test('a host that has never reached the mailbox is refused', () => {
  const h = commandChannelHealth({ connected: true, commandChannel: { draining: true, reachable: false, enrollState: 'approved' } });
  assert.equal(h.ok, false);
  assert.match(h.reason, /mailbox/);
  assert.equal(commandChannelLabel({ connected: true, commandChannel: { draining: true, reachable: false } }), 'Not receiving commands');
});

test('a parked host that is NOT the holder stays permissive — the other host drains', () => {
  // The arbitration rule working correctly. This host has no standing to refuse a
  // send on the holder's behalf, and `connected` is what tells them apart.
  const h = commandChannelHealth({ connected: true, commandChannel: { draining: false, reachable: true, enrollState: 'approved' } });
  assert.equal(h.ok, true);
  assert.equal(h.parked, true);
});

test('parked AND disconnected means nobody is holding the phone — refuse before the 30 s wait', () => {
  const h = commandChannelHealth({ connected: false, commandChannel: { draining: false, reachable: false, enrollState: 'approved', authBlocked: null } });
  assert.equal(h.ok, false);
  assert.match(h.reason, /No phone host is holding/);
  // reachable:false must not be the thing that decides it — the parked branch owns
  // this case, and its message is the one that names what to do.
  assert.doesNotMatch(h.reason, /Restart the host/);
});

test('PascalCase fields from the host are read too', () => {
  const h = commandChannelHealth({ Connected: false, CommandChannel: { Draining: false, EnrollState: 'approved' } });
  assert.equal(h.ok, false);
  assert.match(h.reason, /No phone host is holding/);
});
