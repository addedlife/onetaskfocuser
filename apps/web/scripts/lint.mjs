#!/usr/bin/env node
// Thin wrapper around ESLint for `npm run lint`.
//
// Exists for two reasons, both Windows/environment quirks that made the old
// `"lint": "eslint src/*.js src/*.jsx"` script quietly useless:
//
//   1. ESLint 8 walks UP from the working directory for an `eslint.config.js` and
//      flips the entire run to flat-config mode if it finds one — even outside the
//      repo. A stray starter config in the user's home directory did exactly that
//      here, discarding .eslintrc.cjs so every file reported "no matching
//      configuration" and the linter appeared to pass with zero problems.
//      ESLINT_USE_FLAT_CONFIG=false pins the mode.
//   2. The old glob `src/*.jsx` only covered the top level, so nothing under
//      src/08-app-split/ — most of the app — was ever linted.
//
// Pass through any extra args, e.g. `npm run lint -- --fix`.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const r = spawnSync(
  process.execPath,
  [
    resolve(ROOT, 'node_modules/eslint/bin/eslint.js'),
    'src/**/*.js',
    'src/**/*.jsx',
    ...process.argv.slice(2),
  ],
  { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ESLINT_USE_FLAT_CONFIG: 'false' } },
);

process.exit(r.status ?? 1);
