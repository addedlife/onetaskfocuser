#!/usr/bin/env node
// Session side, step 2 of the cloud Firestore bridge: decrypt what the runner
// sent back.
//
//   node tools/firestore-bridge/open.mjs <key-dir> <log-file>
//
// <log-file> can be the raw Actions log — the envelope is found by its markers,
// so there is no need to trim timestamps or surrounding noise by hand.
import { createDecipheriv, privateDecrypt, constants } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, logPath] = process.argv.slice(2);
if (!dir || !logPath) {
  console.error('usage: open.mjs <key-dir> <log-file>');
  process.exit(1);
}

const log = readFileSync(logPath, 'utf8');
const match = log.match(/---BRIDGE-ENVELOPE-BEGIN---([\s\S]*?)---BRIDGE-ENVELOPE-END---/);
if (!match) {
  console.error('no envelope in that log — check the run actually reached the bridge step');
  process.exit(1);
}

// Actions log lines carry a leading ISO timestamp, and a timestamp is made
// almost entirely of base64-legal characters — so it has to be removed as a
// timestamp, per line. Blanket-stripping non-base64 characters silently splices
// "2026-07-27T…Z" into the payload and the envelope fails to parse.
const envelopeB64 = match[1]
  .split('\n')
  .map(line => line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+/, '').trim())
  .join('');
const envelope = JSON.parse(Buffer.from(envelopeB64, 'base64').toString('utf8'));

const privateKey = readFileSync(join(dir, 'private.pem'), 'utf8');
const key = privateDecrypt(
  { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
  Buffer.from(envelope.key, 'base64'),
);

const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);

process.stdout.write(plaintext.toString('utf8'));
