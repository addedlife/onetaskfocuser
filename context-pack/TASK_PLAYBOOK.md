# Task Playbook

Last updated: 2026-05-05

For each task type below, read the listed files only. Skip the rest of the pack.

## "What's deployed?" / live URL / deploy status

- `CURRENT_STATE.md` (first 15 lines)

## Task list / NerveCenter / suite routing / left panel / app shell

- `CURRENT_STATE.md`
- `ARCHITECTURE_INDEX.md` (08-app section)
- `src/08-app.jsx` — Grep first; this file is large and central.

## DeskPhone Web / message display / call display / web phone surface / MMS bubbles / fullscreen image / splitters

- `CURRENT_STATE.md`
- `ARCHITECTURE_INDEX.md` (10-deskphone-web section)
- `src/10-deskphone-web.jsx`
- `docs/deskphone-parity/` (parity inventory)
- For native counterpart, peek at the DeskPhone pack's `CURRENT_STATE.md`: `PC as Bluetooth call - text interface/DeskPhone/context-pack/CURRENT_STATE.md`.

## Settings / Google connector / Google Client ID / Calendar / Gmail

- `CURRENT_STATE.md`
- `ARCHITECTURE_INDEX.md`
- `src/07-settings.jsx`
- `netlify/functions/_ai-core.cjs`
- `netlify/functions/app-config.js`

## AI gateway / ai-proxy / shared AI config / Gemini call / OpenAI call

- `CURRENT_STATE.md`
- `ARCHITECTURE_INDEX.md`
- `netlify/functions/_ai-core.cjs`
- `src/01-core.js` — Grep for `ai_config`, `ai-proxy`.
- This gateway also serves Shailos. Bugs here break both apps.

## Firebase / data writes / safety / 01-core

- `CURRENT_STATE.md`
- `ARCHITECTURE_INDEX.md` (01-core section)
- `src/01-core.js`
- HARD RULE: do not modify Firebase safety guards or Firebase config values in `01-core.js`. Reason: prior incident wiped the entire task history. The guards are sacrosanct.

## Shailos integration / `sandbox/shailos/` folder / "Shailos doesn't update on live"

- `CURRENT_STATE.md`
- The Shailos source pack: `../backup/sto-src/Shaila-Trancriber-Organizer-main/context-pack/README.md`
- `scripts/copy-shailos-to-dist.cjs`
- Do not edit `sandbox/shailos/` directly — that's the built bundle, not source.

## Netlify build / functions / deploy config / redirects / cache headers

- `ARCHITECTURE_INDEX.md`
- `netlify.toml`
- `netlify/functions/`
- `vite.config.js`

## Build / verification before commit

- Run `npm run build`.
- Confirm `dist/` updated.
- For DeskPhone Web changes, run the existing parity smoke test where practical.
- Don't push without explicit "yes", "deploy", or "push it" from the user.

## Production verify after deploy

- `CURRENT_STATE.md` (latest served asset section)
- Check the live site asset hash matches the latest commit.
- Curl `https://onetaskfocuser.netlify.app/.netlify/functions/app-config` to verify env.

## "Continue from yesterday"

- Read full pack in order.
- Plus `HANDOFF.md` (in the OneTask repo root, not in the briefing folder).

## Cross-cutting (touches Shailos or DeskPhone)

- This pack first.
- Then secondary pack's `README.md` + `CURRENT_STATE.md` only (skip their full packs).
- State explicitly which apps are involved before writing code.

## Hard rules (any OneTask task)

- Do not deploy or push without explicit user approval.
- Do not edit Firebase safety guards or config in `01-core.js`.
- Do not edit `dist/` or `sandbox/shailos/` (generated output).
- Always `git fetch` before editing — another coder may be active on `origin/main`.
- `src/08-app.jsx` is large and central; touch it narrowly.
