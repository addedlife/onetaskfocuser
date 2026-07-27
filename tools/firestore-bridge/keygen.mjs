#!/usr/bin/env node
// Session side, step 1 of the cloud Firestore bridge.
//
// Generates a throwaway RSA keypair for ONE session. The private key never
// leaves this machine; the printed public key is what gets handed to the
// workflow as an input. Anything the workflow sends back is readable only
// here, which is what makes the bridge safe to run against a public repo:
// GitHub Actions logs are world-readable, and the owner's Bug Log is not
// something to publish.
//
//   node tools/firestore-bridge/keygen.mjs <key-dir>
//
// Prints the base64 public key on stdout (single line, paste-ready as the
// `pubkey` workflow input).
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: keygen.mjs <key-dir>');
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });

mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });

const spki = publicKey.export({ type: 'spki', format: 'pem' });
writeFileSync(join(dir, 'public.pem'), spki);
process.stdout.write(Buffer.from(spki).toString('base64') + '\n');
