#!/usr/bin/env node
// ─── GM3 ratchet ──────────────────────────────────────────────────────────────
//
// WHAT THIS IS (plain English): a one-way valve for Material 3 conformance. It
// counts every GM3 lint violation in the app and compares that number to a saved
// baseline. The count is allowed to go DOWN freely. If it goes UP, this exits
// non-zero and the build fails.
//
// WHY IT EXISTS: the 2026-07-21 audit found ~800 token bypasses that had
// accumulated because nothing ever checked. Fixing them once solves today; the
// ratchet is what stops it happening again. Turning the rules straight to "error"
// would break the build on day one against 800 pre-existing violations, so
// instead they are warnings and this script polices the trend.
//
// USAGE
//   node scripts/gm3-ratchet.mjs            check against the baseline (CI/build)
//   node scripts/gm3-ratchet.mjs --update   re-snapshot after landing fixes
//
// The baseline lives in .gm3-baseline.json and is committed. Lowering it is the
// whole point — every GM3 worklist item should end with an --update commit.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const BASELINE = resolve(ROOT, '.gm3-baseline.json');
const RULE = 'no-restricted-syntax';
const UPDATE = process.argv.includes('--update');

// Group a violation by its first clause — "no literal font sizes", "use ActionBtn
// / IconBtn …" — so the report says WHICH kind of drift moved rather than just a
// total. Everything before the colon is the rule family and is dropped; what
// follows identifies the actual offence.
function bucket(message) {
  const m = message.match(/^GM3[^:]*:\s*([^.]+)\./);
  return m ? m[1].trim() : message.slice(0, 48);
}

// Files the ratchet never counts. Normally these come from `ignorePatterns` in
// .eslintrc.json, but we run with --no-ignore (see below), so they are filtered
// here instead.
const SKIP = [/[\\/]src[\\/]dev[\\/]/, /node_modules/, /[\\/]dist[\\/]/];

function collect() {
  let raw;
  try {
    raw = execFileSync(
      // Call ESLint's JS entry point with the current node binary rather than the
      // `npx`/`eslint` shim. Node 22 refuses to execFile a .cmd/.bat without
      // `shell: true` (CVE-2024-27980), so the Windows shim path fails outright.
      process.execPath,
      [resolve(ROOT, 'node_modules/eslint/bin/eslint.js'), 'src/**/*.js', 'src/**/*.jsx', '--format', 'json'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
        // ESLint 8 walks UP from cwd looking for an eslint.config.js and switches
        // the entire run to flat-config mode if it finds one — anywhere, including
        // outside the repo. A stray Vite starter config in the user's home dir
        // (C:\Users\<user>\eslint.config.js) does exactly that, which silently
        // discards this project's .eslintrc.json and makes every .js/.jsx file
        // match "no configuration" and report clean. Pin eslintrc mode so the
        // result never depends on what sits above the checkout.
        env: { ...process.env, ESLINT_USE_FLAT_CONFIG: 'false' },
      },
    );
  } catch (e) {
    // ESLint exits non-zero when it reports problems; the JSON is still on stdout.
    raw = e.stdout;
  }
  if (!raw) {
    console.error('[gm3-ratchet] eslint produced no output — is node_modules installed?');
    process.exit(2);
  }

  const results = JSON.parse(raw);
  const byRule = {};
  const byFile = {};
  let total = 0;

  for (const file of results) {
    if (SKIP.some((re) => re.test(file.filePath))) continue;
    const hits = file.messages.filter((m) => m.ruleId === RULE);
    if (!hits.length) continue;
    const name = file.filePath.split(/[\\/]/).slice(-1)[0];
    byFile[name] = (byFile[name] || 0) + hits.length;
    for (const h of hits) {
      const b = bucket(h.message);
      byRule[b] = (byRule[b] || 0) + 1;
      total++;
    }
  }
  return { total, byRule, byFile };
}

const now = collect();

if (UPDATE || !existsSync(BASELINE)) {
  writeFileSync(BASELINE, JSON.stringify({ total: now.total, byRule: now.byRule, updated: new Date().toISOString().slice(0, 10) }, null, 2) + '\n');
  console.log(`[gm3-ratchet] baseline ${existsSync(BASELINE) ? 'updated' : 'created'}: ${now.total} violations`);
  for (const [k, v] of Object.entries(now.byRule).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
  process.exit(0);
}

const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
const delta = now.total - base.total;

console.log(`[gm3-ratchet] ${now.total} GM3 violations (baseline ${base.total}, ${delta > 0 ? '+' : ''}${delta})`);

if (delta > 0) {
  console.error('\n  ✗ GM3 conformance regressed. New violations by category:\n');
  for (const [k, v] of Object.entries(now.byRule).sort((a, b) => b[1] - a[1])) {
    const was = base.byRule?.[k] || 0;
    if (v > was) console.error(`     +${v - was}  ${k}  (${was} → ${v})`);
  }
  console.error('\n  Worst files:');
  for (const [f, v] of Object.entries(now.byFile).sort((a, b) => b[1] - a[1]).slice(0, 5)) console.error(`     ${String(v).padStart(5)}  ${f}`);
  console.error('\n  Fix the new violations, or run `npm run gm3:update` if the increase is deliberate.\n');
  process.exit(1);
}

if (delta < 0) {
  console.log(`\n  ✓ ${-delta} fewer than baseline. Run \`npm run gm3:update\` to lock the gain in.\n`);
  for (const [k, v] of Object.entries(now.byRule).sort((a, b) => b[1] - a[1])) {
    const was = base.byRule?.[k] || 0;
    if (v < was) console.log(`     -${was - v}  ${k}  (${was} → ${v})`);
  }
}

process.exit(0);
