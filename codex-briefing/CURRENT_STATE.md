# Current State

Last updated: 2026-05-05

This is the active OneTask / Switchboard / NerveCenter repo and Netlify deploy root.

Live app:

- Production URL: `https://onetaskfocuser.netlify.app`
- Latest verified production deploy: Netlify automatic production deploy from latest pushed `main`
- Latest served asset after deploy: `assets/index-BoHqrUDj.js`
- Git branch: `main`
- Latest deployed source: latest pushed `main`

Current product truth:

- NerveCenter is the operating front door for tasks, Shailos, and phone surfaces.
- DeskPhone Web is being rebuilt toward exact native parity while using native handoff shortcuts for unfinished functions.
- Google Calendar/Gmail connector code is present and visible, but production Netlify currently has no `GOOGLE_CLIENT_ID`.
- If no Google Client ID exists, the app now shows a setup path instead of silently hiding the connector.
- DeskPhone Web message history, MMS clean image bubbles, fullscreen image rotate/close, and splitters were smoke-tested before the latest deploy.
- DeskPhone Web now shows native outgoing send states such as `Confirming on phone`; deployed after native DeskPhone b249 exposed the host API fields.

Current repo condition:

- The send-state parity slice is committed and deployed.
- Many untracked artifacts/logs/docs exist from prior work. The user has allowed careful cleanup; inspect and classify before removing anything.
- `shailos/` is generated output copied into the deploy; do not treat it as editable source.

High-risk areas:

- `src/08-app.jsx` is large and central; touch it narrowly.
- Google connector behavior depends on Netlify environment variables and Google OAuth setup, not just UI code.
- Firebase writes in local dev hit the real account.
