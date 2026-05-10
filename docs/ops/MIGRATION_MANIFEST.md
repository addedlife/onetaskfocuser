# Migration Manifest

Created: 2026-05-10

## Goal

Create one lean Shamash Pro 4 workspace for Tasks, Shailos, and Phone while leaving all existing live folders untouched until the new workspace is proven operational.

## Included In Pro 4

### `apps/web`

- `src/`
- `public/`
- `shailos/` generated deploy output for the current `/shailos/` route
- `backend/functions/` copied from old `netlify/functions/`
- `scripts/copy-shailos-to-dist.cjs`
- `package.json`
- `package-lock.json`
- `vite.config.js`
- `index.html`
- `.eslintrc.json`
- `.gitignore`
- `netlify.toml`

### `apps/shailos`

- `src/`
- package and TypeScript/Vite config
- Firebase blueprint/rules/config documents
- current README/source marker files

### `apps/phone-host-windows`

- WPF source files
- C# project file
- app assets, services, models, view models, views, helpers, skins, themes, tools
- release script, build number, changelog

## Excluded

- `.git/`, `.netlify/`, `.claude/`, `.launcher/`
- `node_modules/`, `dist/`, `bin/`, `obj/`
- screenshots, logs, audit artifacts
- old backups and generated restore files
- scratch probes and experimental research folders
- legacy duplicate `js/` output from the web repo
- old docs piles not required to run the app

## Important Constraint

The Phone lane still includes a native Windows host because browser-only code cannot replace local Bluetooth/MAP/PBAP/HFP access by file cleanup alone. The Pro 4 workspace can make that host a first-class component, but retiring it requires a separate product/architecture decision.

## Correction Logged 2026-05-10

The first copy pass missed `apps/web/backend/functions` because the old wildcard copy did not materialize the directory correctly. This was corrected during runtime testing by copying the old `sandbox/netlify/functions` files into `apps/web/backend/functions`, then syntax-checking every function file.
