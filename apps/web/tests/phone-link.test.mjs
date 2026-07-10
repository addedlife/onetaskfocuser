// Phone-link brain tests — run with `npm run test:phone` (plain node:test, no
// framework). These lock down the logic every phone indicator and send bubble
// derives from; if one of these breaks, an indicator somewhere is lying.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  derivePhoneLinkState, describePhoneLink, messageListSignature, formatAgeShort,
  HEARTBEAT_LIVE_WINDOW_MS, STATE_FALLBACK_WINDOW_MS,
} from '../src/08-app-split/phone-link.js';

const NOW = 1_800_000_000_000;
const owner = (over = {}) => ({ preferred: 'tablet', host: '', t: 0, connected: false, present: false, ...over });

// ── derivePhoneLinkState ────────────────────────────────────────────────────

test('fresh tablet heartbeat + state = connected', () => {
  const link = derivePhoneLinkState({
    now: NOW, usingRelay: true, statusOnline: true, hasData: true,
    owner: owner({ present: true, host: 'android', t: NOW - 10_000, connected: true }),
  });
  assert.equal(link.state, 'connected');
  assert.equal(link.live, true);
  assert.equal(link.activeHostLabel, 'Tablet');
});

test('stale heartbeat = offline with age, data or not', () => {
  const link = derivePhoneLinkState({
    now: NOW, usingRelay: true, statusOnline: true, hasData: true,
    owner: owner({ present: true, host: 'android', t: NOW - HEARTBEAT_LIVE_WINDOW_MS - 5_000, connected: true }),
  });
  assert.equal(link.state, 'offline');
  assert.equal(link.stale, true);
  assert.ok(link.ageMs > HEARTBEAT_LIVE_WINDOW_MS);
});

test('host heartbeating but BT disconnected = offline (no false green)', () => {
  const link = derivePhoneLinkState({
    now: NOW, usingRelay: true, statusOnline: true, hasData: true,
    owner: owner({ present: true, host: 'android', t: NOW - 5_000, connected: false }),
  });
  assert.equal(link.state, 'offline');
});

test('owner prefers PC while tablet still holds = switching', () => {
  const link = derivePhoneLinkState({
    now: NOW, usingRelay: true, statusOnline: true, hasData: true,
    owner: owner({ preferred: 'pc', present: true, host: 'android', t: NOW - 5_000, connected: true }),
  });
  assert.equal(link.state, 'switching');
  assert.equal(link.preferredLabel, 'PC');
  assert.equal(link.activeHostLabel, 'Tablet');
});

test('legacy host (no owner doc): state stamp inside wide window = connected', () => {
  const link = derivePhoneLinkState({
    now: NOW, usingRelay: true, statusOnline: true, hasData: true,
    owner: owner(), relayReceivedAt: NOW - (STATE_FALLBACK_WINDOW_MS - 60_000),
  });
  assert.equal(link.state, 'connected');
});

test('legacy host: stamp beyond wide window = offline', () => {
  const link = derivePhoneLinkState({
    now: NOW, usingRelay: true, statusOnline: true, hasData: true,
    owner: owner(), relayReceivedAt: NOW - STATE_FALLBACK_WINDOW_MS - 1,
  });
  assert.equal(link.state, 'offline');
});

test('never seen anything = no-host; signs of life = connecting', () => {
  assert.equal(derivePhoneLinkState({ now: NOW, usingRelay: true }).state, 'no-host');
  assert.equal(derivePhoneLinkState({ now: NOW, usingRelay: true, hasData: true }).state, 'connecting');
});

test('loopback path: liveness is just fetch success', () => {
  assert.equal(derivePhoneLinkState({ now: NOW, usingRelay: false, statusOnline: true }).live, true);
  assert.equal(derivePhoneLinkState({ now: NOW, usingRelay: false, statusOnline: false, hasData: true }).state, 'connecting');
});

// ── describePhoneLink wording ───────────────────────────────────────────────

test('offline with data names the data age; without data names last-seen', () => {
  const base = { state: 'offline', ageMs: 4 * 3600_000 };
  assert.equal(describePhoneLink({ ...base, hasData: true }).label, 'Offline — showing texts & calls from 4h ago');
  assert.match(describePhoneLink({ ...base, hasData: false }).label, /last seen 4h ago/);
  assert.equal(describePhoneLink({ ...base, hasData: true }).showReconnect, true);
});

test('switching label says who is handing to whom', () => {
  const d = describePhoneLink({ state: 'switching', activeHostLabel: 'Tablet', preferredLabel: 'PC' });
  assert.equal(d.label, 'Connected · Tablet — handing to PC…');
  assert.equal(d.tone, 'ok');
});

// ── messageListSignature (the repaint bug) ──────────────────────────────────

test('signature changes when ONLY a mid-list send status flips', () => {
  const list = [
    { id: 'a', sendStatus: '' },
    { id: 'b', sendStatus: 'Confirming' },
    { id: 'c', sendStatus: '' },
  ];
  const before = messageListSignature(list);
  const after = messageListSignature(list.map(m => m.id === 'b' ? { ...m, sendStatus: '' } : m));
  assert.notEqual(before, after);
});

test('signature changes when a read state flips; stable when nothing changed', () => {
  const list = [{ id: 'a', isRead: false }, { id: 'b', isRead: true }];
  assert.notEqual(messageListSignature(list), messageListSignature([{ id: 'a', isRead: true }, { id: 'b', isRead: true }]));
  assert.equal(messageListSignature(list), messageListSignature(list.map(m => ({ ...m }))));
});

test('formatAgeShort buckets', () => {
  assert.equal(formatAgeShort(27_000), '27s');
  assert.equal(formatAgeShort(4 * 60_000), '4m');
  assert.equal(formatAgeShort(2 * 3600_000), '2h');
  assert.equal(formatAgeShort(3 * 86_400_000), '3d');
});
