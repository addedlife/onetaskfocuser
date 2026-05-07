# Architecture Index

Last updated: 2026-05-05

Core files:

- `src/08-app.jsx`: main OneTask/NerveCenter shell, app state, NerveCenter panel, Google connector state, suite routing.
- `src/10-deskphone-web.jsx`: DeskPhone Web surface, message/call split, MMS display, fullscreen image viewer, splitters, host API calls.
- `src/07-settings.jsx`: Settings modal, including Google Client ID field.
- `src/01-core.js`: Firebase, storage, AI helper calls, shared constants.
- `netlify/functions/_ai-core.cjs`: shared server-side AI config and safe public config, now also exposes Google connector availability.
- `netlify/functions/app-config.js`: safe config endpoint read by the browser.
- `netlify.toml`: Netlify build, functions, redirects, cache headers.
- `scripts/copy-shailos-to-dist.cjs`: copies generated Shailos output into the deploy build.

Important docs:

- `HANDOFF.md`: broad living project document.
- `ACTIVE_SOURCE_OF_TRUTH.md`: active repo label.
- `docs/DESKPHONE_HOST_CONTROL_ARCHITECTURE.md`: DeskPhone host-control direction.
- `docs/deskphone-parity/`: DeskPhone Web parity inventory and execution rules.

Runtime and deploy:

- Local dev: `npm run dev`
- Build: `npm run build`
- Production: Netlify project `onetaskfocuser`
- Live URL: `https://onetaskfocuser.netlify.app`

