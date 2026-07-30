// Node suite for the phone command-availability table (owner ticket 7/29 — the
// "unworking functions in phone and settings and developer logs").
//
// This is the file that decides, for every control on the DeskPhone Web surface,
// whether it can work on the current transport and what to tell the owner when it
// cannot. It is pure, so these tests are the actual verification — the surface it
// governs sits behind a sign-in gate and a live phone host, neither of which a
// build can stand in for.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commandAvailability, explainAckError,
  CLOUD_ALLOWED_COMMANDS, HOST_DESKTOP_ONLY, HOST_LOOPBACK_ONLY, PC_RELAY_GAP,
} from '../src/08-app-split/phone-command-availability.js';

test('on loopback every command is available — that host implements all of them', () => {
  for (const cmd of [...HOST_DESKTOP_ONLY, ...HOST_LOOPBACK_ONLY, ...PC_RELAY_GAP, '/send', '/send-with-attachments']) {
    const { ok } = commandAvailability(cmd, false);
    assert.equal(ok, true, `${cmd} should be available over loopback`);
  }
});

test('desktop-only commands are refused over the relay, with the DeskPhone instruction', () => {
  for (const cmd of HOST_DESKTOP_ONLY) {
    const { ok, reason } = commandAvailability(cmd, true, 'windows');
    assert.equal(ok, false, `${cmd} cannot be relayed`);
    assert.match(reason, /DeskPhone/, `${cmd} should say where it does work`);
  }
});

test('loopback-only phone operations say no host relays them yet', () => {
  for (const cmd of HOST_LOOPBACK_ONLY) {
    const { ok, reason } = commandAvailability(cmd, true, 'android');
    assert.equal(ok, false);
    assert.match(reason, /DeskPhone window/);
  }
});

test('the PC relay gap: the same command works via the tablet and is refused via the PC', () => {
  for (const cmd of PC_RELAY_GAP) {
    assert.equal(commandAvailability(cmd, true, 'android').ok, true,
      `${cmd} is implemented by the Android host and must be attempted when the tablet holds the phone`);
    const viaPc = commandAvailability(cmd, true, 'windows');
    assert.equal(viaPc.ok, false, `${cmd} has no case in the Windows relay switch`);
    assert.match(viaPc.reason, /tablet/, 'the refusal must name the thing that does work');
  }
});

test('an unknown host holder does not block a whitelisted command', () => {
  // Before the owner doc names a holder, activeHostId is "". Refusing then would
  // make every control dead on a cold load.
  assert.equal(commandAvailability('/delete-message', true, '').ok, true);
  assert.equal(commandAvailability('/send', true, '').ok, true);
});

test('picture texts get their own reason, not the generic refusal', () => {
  const { ok, reason } = commandAvailability('/send-with-attachments', true, 'android');
  assert.equal(ok, false);
  assert.match(reason, /Picture texts/);
  assert.match(reason, /words alone will send/, 'the owner needs to know the text still goes');
});

test('a command outside the whitelist names itself in the refusal', () => {
  const { ok, reason } = commandAvailability('/some-new-control', true, 'android');
  assert.equal(ok, false);
  assert.match(reason, /some-new-control/);
});

test('query strings do not change availability', () => {
  assert.equal(commandAvailability('/send?to=5550100&body=hi', true, 'android').ok, true);
  assert.equal(commandAvailability('/open-sound-settings?x=1', true, 'android').ok, false);
});

test('every whitelisted command is genuinely relayable — the sets cannot contradict', () => {
  for (const cmd of CLOUD_ALLOWED_COMMANDS) {
    assert.equal(HOST_DESKTOP_ONLY.has(cmd), false, `${cmd} cannot be both relayable and desktop-only`);
    assert.equal(HOST_LOOPBACK_ONLY.has(cmd), false, `${cmd} cannot be both relayable and loopback-only`);
  }
  for (const cmd of PC_RELAY_GAP) {
    assert.equal(CLOUD_ALLOWED_COMMANDS.has(cmd), true, `${cmd} is a relay gap, so it must be whitelisted`);
  }
});

test('"unknown command" acks are translated into something actionable', () => {
  const viaPc = explainAckError('unknown command /delete-message', '/delete-message', 'windows');
  assert.match(viaPc, /PC host/);
  assert.match(viaPc, /tablet/);
  assert.doesNotMatch(viaPc, /^unknown command/);

  const viaTablet = explainAckError('unknown command /toggle-call-block', '/toggle-call-block', 'android');
  assert.match(viaTablet, /tablet host/);
  // Nothing to redirect to — don't invent one.
  assert.doesNotMatch(viaTablet, /works when the tablet holds/);
});

test('a real host error is passed through untouched', () => {
  const msg = 'phone link rejected the send — kept as Failed in DeskPhone for retry';
  assert.equal(explainAckError(msg, '/send', 'windows'), msg);
  assert.equal(explainAckError('', '/send', 'windows'), '');
});
