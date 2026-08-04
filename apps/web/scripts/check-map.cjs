#!/usr/bin/env node
/**
 * check-map.cjs — keeps docs/ops/MAP.md honest.
 *
 * MAP.md is the one file a session reads to find its way around the repo. The moment it
 * points at a file that no longer exists, sessions fall back to repo-wide grepping, which
 * is exactly the token burn the map was written to prevent. (That is not hypothetical:
 * the old CONTEXT_INDEX.md pointed at `apps/web/backend/functions/*` and
 * `NerveCenterPanel.jsx` for months after both were gone.)
 *
 * This script extracts every backtick-quoted repo path from MAP.md and fails if one does
 * not resolve on disk. Run it from apps/web: `npm run map:check`.
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const mapPath = path.join(repoRoot, 'docs', 'ops', 'MAP.md');

if (!fs.existsSync(mapPath)) {
  console.error('map:check — docs/ops/MAP.md is missing.');
  process.exit(1);
}

const text = fs.readFileSync(mapPath, 'utf8');

// Any `backticked` token that looks like a repo path: has a slash or a known extension,
// and does not look like a shell command, a URL, or a glob/wildcard placeholder.
const candidates = new Set();
for (const [, raw] of text.matchAll(/`([^`\n]+)`/g)) {
  const token = raw.trim();
  if (!token) continue;
  if (/\s/.test(token)) continue;                       // commands, prose
  if (/^https?:/.test(token)) continue;                 // URLs
  if (token.includes('*') || token.includes('…')) continue; // globs, elisions
  if (token.startsWith('--') || token.startsWith('?')) continue; // flags, URL params
  // Firestore doc paths — both the short `users/...` form and the full resource
  // name, which starts at `projects/`. Neither is a file on disk.
  if (token.startsWith('users/') || token.startsWith('projects/') || token.includes('{')) continue;
  if (token === 'origin/main' || token === 'addedlife/onetaskfocuser') continue; // git refs
  const looksLikePath = token.includes('/') || /\.(jsx?|cjs|md|json|rules|ps1|csproj|kt|cs|html|txt)$/.test(token);
  if (!looksLikePath) continue;
  candidates.add(token.replace(/^\.\//, '').replace(/[.,;:]$/, ''));
}

const missing = [];
for (const rel of candidates) {
  // A bare filename (e.g. `version.js`) is documentation shorthand, not a path claim.
  if (!rel.includes('/')) continue;
  if (!fs.existsSync(path.join(repoRoot, rel))) missing.push(rel);
}

if (missing.length) {
  console.error(`map:check — ${missing.length} path(s) in docs/ops/MAP.md do not exist:\n`);
  for (const m of missing.sort()) console.error(`  ${m}`);
  console.error('\nFix the map (or the path) before pushing. A stale map costs every future session.');
  process.exit(1);
}

console.log(`map:check — OK, all ${candidates.size} referenced paths resolve.`);
