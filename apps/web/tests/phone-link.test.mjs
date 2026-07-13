// Phone-link brain tests — run with `npm run test:phone` (plain node:test, no
// framework). These lock down the logic every phone indicator and send bubble
// derives from; if one of these breaks, an indicator somewhere is lying.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  derivePhoneLinkState, describePhoneLink, messageListSignature, formatAgeShort,
  mergeMessageFeeds, mergeCallFeeds,
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
  assert.equal(link.activeHostLabel, 'ActiveTab');
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
  assert.equal(link.activeHostLabel, 'ActiveTab');
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
  const d = describePhoneLink({ state: 'switching', activeHostLabel: 'ActiveTab', preferredLabel: 'PC' });
  assert.equal(d.label, 'Connected · ActiveTab — handing to PC…');
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

// ── handover grace state (owner ticket r0wEKJ7) ─────────────────────────────

test('recent preferred flip + dead link + old host still named = handover, not offline', () => {
  const link = derivePhoneLinkState({
    now: NOW, usingRelay: true, statusOnline: true, hasData: true,
    owner: owner({ preferred: 'pc', present: true, host: 'android', t: NOW - 5_000, connected: false, preferredAtMs: NOW - 20_000 }),
  });
  assert.equal(link.state, 'handover');
  assert.equal(link.handover, true);
  const d = describePhoneLink(link);
  assert.ok(d.label.includes('Handing to PC'));
  assert.equal(d.showReconnect, false);
});

test('handover grace expires -> honest offline with Reconnect', () => {
  const link = derivePhoneLinkState({
    now: NOW, usingRelay: true, statusOnline: true, hasData: true,
    owner: owner({ preferred: 'pc', present: true, host: 'android', t: NOW - 300_000, connected: false, preferredAtMs: NOW - 300_000 }),
  });
  assert.equal(link.state, 'offline');
  assert.equal(describePhoneLink(link).showReconnect, true);
});

test('link drop AFTER a completed handoff (host == preferred) is offline, not handover', () => {
  const link = derivePhoneLinkState({
    now: NOW, usingRelay: true, statusOnline: true, hasData: true,
    owner: owner({ preferred: 'pc', present: true, host: 'windows', t: NOW - 5_000, connected: false, preferredAtMs: NOW - 60_000 }),
  });
  assert.equal(link.state, 'offline');
});

// ── feed retention merges (owner ticket LDu4QWw: history wiped on handoff) ──

test('mergeMessageFeeds keeps prev history a fresh host has not re-synced yet', () => {
  const prev = [
    { id: 'w1', body: 'old text one', address: '+15741112222', timestamp: NOW - 3600_000 },
    { id: 'w2', body: 'old text two', address: '+15741112222', timestamp: NOW - 7200_000 },
  ];
  const next = [{ id: 'a9', body: 'fresh text', address: '+15741112222', timestamp: NOW - 60_000 }];
  const merged = mergeMessageFeeds(prev, next);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].id, 'a9'); // incoming host truth first
});

test('mergeMessageFeeds dedupes the SAME sms under two hosts id schemes (fuzzy)', () => {
  const prev = [{ id: 'win-5', body: 'Same message', address: '15741112222', timestamp: NOW - 100_000 }];
  const next = [{ id: 'and-77', body: 'same   message', address: '+1 574 111 2222', timestamp: NOW - 90_000 }];
  const merged = mergeMessageFeeds(prev, next);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'and-77'); // host copy wins
});

test('mergeMessageFeeds: incoming copy wins per id (send-status flips repaint)', () => {
  const prev = [{ id: 'x', body: 'hello', sendStatus: 'Confirming', timestamp: NOW }];
  const next = [{ id: 'x', body: 'hello', sendStatus: 'Sent', timestamp: NOW }];
  const merged = mergeMessageFeeds(prev, next);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].sendStatus, 'Sent');
});

test('mergeMessageFeeds: attachment-only (empty body) entries never fuzzy-collapse', () => {
  const prev = [{ id: 'm1', body: '', address: '+15741112222', timestamp: NOW - 30_000 }];
  const next = [{ id: 'm2', body: '', address: '+15741112222', timestamp: NOW - 20_000 }];
  assert.equal(mergeMessageFeeds(prev, next).length, 2);
});

test('mergeCallFeeds keeps prev calls, dedupes same number+time across id schemes', () => {
  const prev = [
    { id: 'c1', number: '+15743334444', timestamp: NOW - 3600_000, type: 1 },
    { id: 'c2', number: '15743334444',  timestamp: NOW - 50_000, type: 3 },
  ];
  const next = [{ id: 'z9', number: '+1 (574) 333-4444', timestamp: NOW - 55_000, type: 3 }];
  const merged = mergeCallFeeds(prev, next);
  assert.equal(merged.length, 2); // c2 fuzzy-matches z9; c1 retained
  assert.equal(merged[0].id, 'z9');
});

// ── Three lanes + auto-finder (2026-07-13) ──────────────────────────────────
import {
  preferredHostId, chooseAutoHost, scoreHostLink,
  PRESENCE_LIVE_WINDOW_MS, AUTO_SWITCH_MARGIN, BT_CAPABLE_HOSTS, HOST_LABEL,
} from '../src/08-app-split/phone-link.js';

test('preferredHostId maps all four modes', () => {
  assert.equal(preferredHostId('tablet'), 'android');
  assert.equal(preferredHostId('pc'), 'windows');
  assert.equal(preferredHostId('ipad'), 'ios');
  assert.equal(preferredHostId('auto'), '');
  assert.equal(preferredHostId('garbage'), 'android'); // unknown → tablet primary
});

test('host labels are iPad / ActiveTab / PC', () => {
  assert.equal(HOST_LABEL.ios, 'iPad');
  assert.equal(HOST_LABEL.android, 'ActiveTab');
  assert.equal(HOST_LABEL.windows, 'PC');
});

test('preferring the iPad names the ios lane and blinks a handover at it', () => {
  const link = derivePhoneLinkState({
    now: NOW, usingRelay: true, statusOnline: true, hasData: true,
    owner: owner({ preferred: 'ipad', present: true, host: 'android', t: NOW - 5_000, connected: true }),
  });
  assert.equal(link.state, 'switching');
  assert.equal(link.preferredLabel, 'iPad');
  assert.equal(link.activeHostLabel, 'ActiveTab');
});

test('auto mode never reports switching — the live holder IS the preference', () => {
  const link = derivePhoneLinkState({
    now: NOW, usingRelay: true, statusOnline: true, hasData: true,
    owner: owner({ preferred: 'auto', present: true, host: 'windows', t: NOW - 5_000, connected: true }),
  });
  assert.equal(link.state, 'connected');
  assert.equal(link.auto, true);
  assert.equal(link.switching, false);
  const d = describePhoneLink(link);
  assert.ok(d.label.includes('(auto)'));
});

test('scoreHostLink: dead/absent presence scores 0; connected beats parked', () => {
  assert.equal(scoreHostLink(null, NOW), 0);
  assert.equal(scoreHostLink({ t: NOW - PRESENCE_LIVE_WINDOW_MS - 1, connected: true }, NOW), 0);
  const parked = scoreHostLink({ hostId: 'windows', t: NOW - 5_000, connected: false, quality: 100 }, NOW);
  const connected = scoreHostLink({ hostId: 'android', t: NOW - 5_000, connected: true, quality: 0 }, NOW);
  assert.ok(connected > parked);
});

test('chooseAutoHost picks the only live BT-capable host and ignores the iPad', () => {
  const hosts = {
    ios: { t: NOW - 1_000, connected: true, quality: 100 },      // never a BT candidate
    windows: { t: NOW - 5_000, connected: true, quality: 50 },
  };
  assert.equal(chooseAutoHost({ hosts, now: NOW }), 'windows');
  assert.ok(!BT_CAPABLE_HOSTS.includes('ios'));
});

test('chooseAutoHost is sticky: a healthy holder is not evicted without a clear win', () => {
  const hosts = {
    android: { t: NOW - 5_000, connected: true, quality: 60 },
    windows: { t: NOW - 5_000, connected: true, quality: 70 },   // slightly better, within margin
  };
  assert.equal(chooseAutoHost({ hosts, now: NOW, currentHostId: 'android' }), 'android');
});

test('chooseAutoHost fails over when the holder dies, and honors a margin win', () => {
  const dead = {
    android: { t: NOW - PRESENCE_LIVE_WINDOW_MS - 5_000, connected: true, quality: 100 },
    windows: { t: NOW - 5_000, connected: true, quality: 10 },
  };
  assert.equal(chooseAutoHost({ hosts: dead, now: NOW, currentHostId: 'android' }), 'windows');
  const clearWin = {
    android: { t: NOW - 5_000, connected: false, quality: 0 },   // alive, lost BT
    windows: { t: NOW - 5_000, connected: true, quality: 80 },   // beats it by >> margin
  };
  assert.equal(chooseAutoHost({ hosts: clearWin, now: NOW, currentHostId: 'android' }), 'windows');
  assert.ok(AUTO_SWITCH_MARGIN > 0);
});

test('chooseAutoHost with nobody alive returns empty', () => {
  assert.equal(chooseAutoHost({ hosts: {}, now: NOW, currentHostId: 'android' }), '');
});
