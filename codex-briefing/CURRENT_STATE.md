# Current State

Last updated: 2026-05-05

This is the active OneTask / Switchboard / NerveCenter repo and Netlify deploy root.

Live app:

- Production URL: `https://onetaskfocuser.netlify.app`
- Latest verified production deploy: `69f9762b7125746e2fda4752`
- Latest served asset after deploy: `assets/index-MGsy6boT.js`
- Git branch: `main`
- Latest pushed commit: `da44212`

Current product truth:

- NerveCenter is the operating front door for tasks, Shailos, and phone surfaces.
- DeskPhone Web is being rebuilt toward exact native parity while using native handoff shortcuts for unfinished functions.
- Google Calendar/Gmail connector code is present and visible, but production Netlify currently has no `GOOGLE_CLIENT_ID`.
- If no Google Client ID exists, the app now shows a setup path instead of silently hiding the connector.
- DeskPhone Web message history, MMS clean image bubbles, fullscreen image rotate/close, and splitters were smoke-tested before the latest deploy.
- Local uncommitted DeskPhone Web parity slice shows native outgoing send states such as `Confirming on phone`; smoke-tested locally, not deployed.

Current repo condition:

- `main` matches `origin/main` for tracked files at last check.
- Local tracked changes currently touch `src/10-deskphone-web.jsx` and `artifacts/deskphone-web-parity-smoke.cjs` for outgoing send-state parity.
- Many untracked artifacts/logs/docs exist from prior work. Do not delete or reorganize them during feature work unless explicitly asked.
- `shailos/` is generated output copied into the deploy; do not treat it as editable source.

High-risk areas:

- `src/08-app.jsx` is large and central; touch it narrowly.
- Google connector behavior depends on Netlify environment variables and Google OAuth setup, not just UI code.
- Firebase writes in local dev hit the real account.
