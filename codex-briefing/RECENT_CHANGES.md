# Recent Changes

Last updated: 2026-05-05

- `8674b16`: DeskPhone Web now reads native outgoing message send-state fields and shows `Confirming on phone`; the parity smoke harness verifies that state.
- `da44212`: Google connector setup path is visible when no Google Client ID exists.
- `ff7afed`: Google connector config handoff added through Netlify app config.
- `856c162`: local work merged with the other coder's Google connector commits from `origin/main`.
- `fd507df`: DeskPhone Web history and MMS photo chrome fixed.
- `5a9f956`: persistent left pane layout fixed so app content is pushed to the right.

Latest verified deploy:

- Netlify production deploy `69fa71c23d6b2c0008bfb4a0`
- Served asset `index-BoHqrUDj.js`
- App config reports `googleAvailable: false` because no production `GOOGLE_CLIENT_ID` is configured.

Operational lesson from 2026-05-05:

- Always fetch/merge latest `origin/main` before web work because another coder may be active.
- Verify production after deploy; do not assume local build equals live site.
