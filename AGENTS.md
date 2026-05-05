# OneTask / NerveCenter Agent Handbook

Read this file before product changes in this repo.

## Operating Rule

- Start every session with `codex-briefing/README.md`, then check live git status and only open deeper files needed for the specific task.
- This repo is the active OneTask / Switchboard / NerveCenter deploy root.
- Do not deploy or push without explicit user approval unless the user has clearly asked for deploy/push work in the current task.
- Do not hand-edit `dist` or `shailos` as source. `dist` is build output, and `shailos` is copied generated output.
- Keep communication executive-friendly: brief status, practical risk, clear outcome.

## Source Of Truth

- Live app handoff: `HANDOFF.md`
- Fast session pack: `codex-briefing/`
- Main app source: `src/`
- Netlify functions: `netlify/functions/`
- Build/deploy config: `package.json`, `netlify.toml`, `vite.config.js`

## Before Shipping

- Run `npm run build`.
- Confirm the current Netlify deploy target before deploying.
- Confirm whether Google/Firebase/AI environment variables are present when the task touches connectors.

