#!/usr/bin/env node
// Reads unresolved Bug Log entries straight from Firestore (users/{uid}/bugs),
// authenticated as the project owner via a service-account key — the Admin
// SDK equivalent of the browser's per-user login. Read-only; never writes.
//
// The key lives outside this repo (never commit it). Path comes from
// SHAMASH_ADMIN_KEY_PATH if set, else the known default location.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const KEY_PATH = process.env.SHAMASH_ADMIN_KEY_PATH
  || 'C:/Users/ydanz/Documents/shamash-secrets/onetaskonly-app-firebase-adminsdk-fbsvc-afb41edffa.json';
// The app keys user data by email prefix ("canonical uid") — the owner uses
// the rabbi account in the app, so bugs live under users/rabbidanziger.
const OWNER_EMAIL = 'rabbidanziger@hocsouthbend.com';

function fail(message) {
  console.error(`Bug Log reader: ${message}`);
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(KEY_PATH, 'utf8'));
} catch (e) {
  fail(`couldn't read the service-account key at ${KEY_PATH} (${e.code || e.message}). ` +
    `Set SHAMASH_ADMIN_KEY_PATH if it moved.`);
}

initializeApp({ credential: cert(serviceAccount) });

const uid = OWNER_EMAIL.split('@')[0].toLowerCase();
const col = getFirestore().collection('users').doc(uid).collection('bugs');

// Usage:
//   node index.mjs                           list unresolved (default)
//   node index.mjs list [status|all]         list by status (unresolved|paused|resolved|future)
//   node index.mjs note <docId> <text>       append a work note (status unchanged)
//   node index.mjs status <docId> <status>   set status (unresolved|paused|resolved|future)
//   node index.mjs resolve <docId> <note>    append the resolution note AND mark resolved —
//                                            the required way to close a ticket, so every
//                                            resolution carries the coder's process notes.
const [cmd = 'list', ...rest] = process.argv.slice(2);

if (cmd === 'note' || cmd === 'status' || cmd === 'resolve') {
  const [docId, ...words] = rest;
  const value = words.join(' ').trim();
  if (!docId || !value) fail(`usage: node index.mjs ${cmd} <docId> <${cmd === 'status' ? 'status' : 'text'}>`);
  const ref = col.doc(docId);
  const doc = await ref.get();
  if (!doc.exists) fail(`no bug with id ${docId}`);
  if (cmd === 'note') {
    const prior = doc.data().notes || [];
    await ref.update({ notes: [...prior, { text: value, atMs: Date.now() }], updatedAtMs: Date.now() });
    console.log(`Noted on ${docId}: ${value}`);
  } else if (cmd === 'resolve') {
    const prior = doc.data().notes || [];
    await ref.update({
      notes: [...prior, { text: value, atMs: Date.now() }],
      status: 'resolved',
      updatedAtMs: Date.now(),
    });
    console.log(`${docId} → resolved, with note: ${value}`);
  } else {
    await ref.update({ status: value, updatedAtMs: Date.now() });
    console.log(`${docId} → ${value}`);
  }
  process.exit(0);
}

const filter = rest[0] || 'unresolved';
const snap = filter === 'all' ? await col.get() : await col.where('status', '==', filter).get();

if (snap.empty) {
  console.log(`Bug Log: no ${filter} entries.`);
  process.exit(0);
}

const bugs = snap.docs
  .map(d => ({ id: d.id, ...d.data() }))
  .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));

console.log(`Bug Log — ${bugs.length} ${filter} entr${bugs.length === 1 ? 'y' : 'ies'}:\n`);
bugs.forEach((b, i) => {
  const type = b.type === 'idea' ? 'Upgrade idea' : 'Bug';
  const when = b.createdAtMs ? new Date(b.createdAtMs).toLocaleString() : '';
  console.log(`${i + 1}. [${type}] [${b.id}] ${b.text}${when ? `  (logged ${when})` : ''}`);
  for (const n of b.notes || []) console.log(`     ↳ note: ${n.text}`);
});
