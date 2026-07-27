#!/usr/bin/env node
// Runner side of the cloud Firestore bridge — runs INSIDE GitHub Actions,
// where MCP_READ_TOKEN actually exists.
//
// Why this exists: a Claude Code cloud session has no Firebase credential of
// any kind. The service-account key is PC-only, Firestore rules correctly deny
// unauthenticated reads, and the deployed MCP endpoint (functions/mcp.js) needs
// a bearer token the session cannot see. Sessions were therefore blind to the
// Bug Log — the recurring "no live pull possible from this sandbox" note in
// docs/ops/VERIFICATION_LOG.md. The token DOES exist here as a repo secret, so
// the call happens here and the answer is carried back encrypted.
//
// Envelope: AES-256-GCM over the payload, with the one-time AES key wrapped
// under the session's RSA-OAEP(SHA-256) public key. Nothing readable is ever
// written to the (public) Actions log.
import { createCipheriv, publicEncrypt, randomBytes, constants } from 'node:crypto';

const endpoint = process.env.MCP_ENDPOINT || 'https://onetaskonly-app.web.app/mcp';
const token = process.env.MCP_READ_TOKEN || '';
const tool = (process.env.BRIDGE_TOOL || '').trim();
const rawArgs = (process.env.BRIDGE_ARGS || '{}').trim() || '{}';
const pubkeyB64 = (process.env.BRIDGE_PUBKEY || '').trim();

function die(message) {
  // Failures are printed in the clear on purpose: they are about plumbing
  // (missing secret, bad JSON, HTTP status), never about ticket contents.
  console.error(`bridge: ${message}`);
  process.exit(1);
}

if (!token) die('MCP_READ_TOKEN is not set for this repository — add it in Settings → Secrets.');
if (!tool) die('no tool given');
if (!pubkeyB64) die('no pubkey given');

let args;
try {
  args = JSON.parse(rawArgs);
} catch (error) {
  die(`args is not valid JSON: ${error.message}`);
}
if (args === null || typeof args !== 'object' || Array.isArray(args)) die('args must be a JSON object');

const publicKey = Buffer.from(pubkeyB64, 'base64').toString('utf8');
if (!publicKey.includes('BEGIN PUBLIC KEY')) die('pubkey is not a base64 SPKI PEM');

const response = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
});

const body = await response.text();
if (!response.ok) die(`endpoint returned HTTP ${response.status}`);

// The payload is the whole JSON-RPC response, errors included — an MCP-level
// error ("No bug with id …") is an answer the session needs, not a plumbing
// failure, so it rides the encrypted channel like any other result.
const key = randomBytes(32);
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
const ciphertext = Buffer.concat([cipher.update(Buffer.from(body, 'utf8')), cipher.final()]);
const wrappedKey = publicEncrypt(
  { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
  key,
);

const envelope = {
  v: 1,
  alg: 'RSA-OAEP-256+AES-256-GCM',
  key: wrappedKey.toString('base64'),
  iv: iv.toString('base64'),
  tag: cipher.getAuthTag().toString('base64'),
  data: ciphertext.toString('base64'),
};

console.log('---BRIDGE-ENVELOPE-BEGIN---');
console.log(Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64'));
console.log('---BRIDGE-ENVELOPE-END---');
