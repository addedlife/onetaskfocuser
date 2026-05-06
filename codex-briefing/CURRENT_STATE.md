# Current State

Last updated: 2026-05-06

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
- Google token is now persisted to localStorage (`ot_google_token`, `ot_google_token_expiry`, `ot_google_connected`). Silent re-auth fires automatically on load if expired. Disconnect clears all three keys.
- Calendar card has Add-Event and Open-Calendar header buttons plus per-event Open links. Gmail card has Open-Gmail header button, per-email Open links, and snippet previews.
- NerveCenter phone section is a vertical split — texts top, calls bottom, each independently scrollable.
- AppSuiteChrome left rail and DeskPhone Web left rail both auto-collapse after 10 seconds of inactivity. Toggle at bottom of each. On 2026-05-06, both timer paths were repaired so turning the feature on or opening the rail starts the countdown without requiring a mouse-leave event first.
- Top-left menu button and PostItStack now track `sidebarW` so they are never hidden behind the sidebar.
- DeskPhone Web message history, MMS clean image bubbles, fullscreen image rotate/close, and splitters were smoke-tested before the latest deploy.
- DeskPhone Web now shows native outgoing send states such as `Confirming on phone`; deployed after native DeskPhone b249 exposed the host API fields.

Current repo condition:

- The current local source includes a verified auto-collapse timer repair for both app rails; next push triggers Netlify deployment.
- DeskPhone Web parity map review is complete: 199 of 199 action rows reviewed as of 2026-05-06 (168 implemented-web, 25 host-api-needed, 6 native-only, 0 not-yet-reviewed). Latest runtime slices add browser Choose Device routing to Settings, host-backed build update accept/snooze/show controls, host-backed active-call mute, and browser message Forward into a prefilled New Message draft.
- Many untracked artifacts/logs/docs exist from prior work. The user has allowed careful cleanup; inspect and classify before removing anything.
- `shailos/` is generated output copied into the deploy; do not treat it as editable source.

High-risk areas:

- `src/08-app.jsx` is large and central; touch it narrowly.
- Google connector behavior depends on Netlify environment variables and Google OAuth setup, not just UI code.
- Firebase writes in local dev hit the real account.
