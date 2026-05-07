# Current State

Last updated: 2026-05-07

This is the active OneTask / Switchboard / NerveCenter repo and Netlify deploy root.

Live app:

- Production URL: `https://onetaskfocuser.netlify.app`
- Latest verified production deploy: Netlify automatic production deploy from latest pushed `main`
- Latest served asset after deploy: `assets/index-BoHqrUDj.js`
- Git branch: `main`
- Latest deployed source: latest pushed `main`

Current product truth:

- NerveCenter is the operating front door for tasks, Shailos, and phone surfaces.
- DeskPhone Web parity is now judged by real browser behavior, not native handoff shortcuts. Visible web-phone buttons should either complete in-browser or call a host endpoint directly.
- Google Calendar/Gmail connector code is present and visible, but production Netlify currently has no `GOOGLE_CLIENT_ID`.
- If no Google Client ID exists, the app now shows a setup path instead of silently hiding the connector.
- Google token is persisted to localStorage (`ot_google_token`, `ot_google_token_expiry`, `ot_google_connected`). Silent re-auth fires automatically on load if expired (token stored at 3300s / 55 min). 401 handlers clear localStorage before nulling token. `googleWasConnected` flag shows a "Reconnecting…" spinner for 6 seconds, then surfaces a clickable "Reconnect Google" button if silent re-auth didn't complete.
- OAuth scope is `calendar` (full) + `gmail.readonly`. calendarList endpoint is `users/me/calendarList`. If calendarList fails for any reason, falls back to `primary` only.
- Calendar card: up to 20 events from all subscribed calendars, timed events first then all-day at bottom, each row is a clickable link. "+" opens a natural-language Add Event modal (AI parses to Calendar JSON → POST). "↗" opens Google Calendar. Refresh and disconnect buttons in header.
- Gmail card: up to 20 messages — personal (all) + promotions/updates (important only), most recent first, no read/unread filter. Each row: bold sender + date, then a one-sentence AI summary of the email body content (batch AI call, ≤10 words). Hover tooltip shows full from/subject/snippet. Whole row is a clickable link to the message. Disconnect in Calendar header removes both cards.
- NerveCenter phone section is a vertical split — texts top, calls bottom, each independently scrollable.
- AppSuiteChrome left rail and DeskPhone Web left rail both auto-collapse after 10 seconds of inactivity. Toggle at bottom of each. On 2026-05-06, both timer paths were repaired so turning the feature on or opening the rail starts the countdown without requiring a mouse-leave event first.
- Top-left menu button and PostItStack now track `sidebarW` so they are never hidden behind the sidebar.
- DeskPhone Web message history, MMS clean image bubbles, fullscreen image rotate/close, and splitters were smoke-tested before the latest deploy.
- DeskPhone Web now shows native outgoing send states such as `Confirming on phone`; deployed after native DeskPhone b249 exposed the host API fields.
- DeskPhone Web local source now keeps open-message bubble actions as clean direct icons on the bubble, without boxed menu rows, and protects bottom-of-thread scrolling so the newest bubble/action strip is not hidden below the screen. Selected-conversation header actions remain consolidated into a three-dot menu with icon plus function label per row. This is verified locally by `npm run build` but has not been pushed or deployed.
- DeskPhone Web local source now removes the native-app redirect layer from visible web-phone parity controls: conversation row/header mark read, mark unread, pin, mute, and block call direct host endpoints; call-history block/delete/delete-all call direct host endpoints; typed-number/contact text actions open the browser New Message composer; contact New/Edit stays inside the browser contact editor; Settings no longer exposes "Show native app"; Developer Tools navigation stays in the browser and calls host endpoints. The matching native host support shipped in DeskPhone `b261`. Verified locally by `npm run build` and `node artifacts/deskphone-web-button-audit.cjs`; `npm run lint` is currently blocked by the repo's ESLint 9 glob/config issue, not by this slice.
- DeskPhone Web local source now has the first GV-style visual cleanup pass: white canvas tokens, muted selected rows, teal communications accent, quieter icon buttons, flexible low-emphasis message/call filters, lighter typography, reduced blue fill usage, and single-owner pane dividers. Verified locally by `npm run build` and `node artifacts/deskphone-web-button-audit.cjs`. A temporary screenshot was captured for visual QA but not committed.
- Current local source now adds `Google Voice` as an Appearance theme, keeps the existing color-scheme selector, and starts applying the same clean rules across NerveCenter without hard-locking every screen to white. NerveCenter/WebPhone now derive quiet borders, surfaces, text weights, and accent behavior from the active scheme. WebPhone now receives the active `T` theme and maps it into CSS variables, so changing Appearance should affect the WebPhone page. Verified by `npm run build` and `node artifacts/deskphone-web-button-audit.cjs` after starting a temporary dev server on port `4183`.
- DeskPhone Web now has an Android mobile-bridge mode: Android bridge status or a mobile/coarse-touch browser using `http://127.0.0.1:8765` adds an `is-mobile-bridge` layout class, uses a compact top rail on Android/coarse mobile screens, hides the call-history side pane from the message view to avoid squashing, labels reconnect as `Refresh phone data`, and treats localhost as a local bridge API rather than Bluetooth phone/device management. In Android bridge mode, Settings shows only Bridge/Appearance, removes Bluetooth Settings and saved/scanned/paired device lists, and uses local-bridge/text wording instead of preferred/saved-phone wording while preserving normal Windows-host device controls on desktop loopback. It also tolerates partial bridge endpoint failures so a `/messages` error no longer clears the whole phone surface. Verified by `npm run build`, `node artifacts/deskphone-web-button-audit.cjs`, and a focused bridge-mode text audit.
- The GV clean-design rulebook is at `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 3\docs\GV_CLEAN_DESIGN_RULES.md`, not under `sandbox\docs`. Use that control-folder doc as the design source while editing sandbox code.

Current repo condition:

- The current local source includes a verified auto-collapse timer repair for both app rails; next push triggers Netlify deployment.
- The current local DeskPhone Web source includes browser-parity fixes for no-op/native-redirect buttons and is ready for web release now that native DeskPhone `b261` is released and the focused button audit passes with zero `/handoff` calls.
- The current local DeskPhone Web source includes the first GV-style visual pass. The production build passes, and the focused WebPhone button audit still passes with zero `/handoff` calls. The older broad parity smoke harness timed out during this session and should be treated as a harness follow-up before relying on it for this visual lane.
- The current local NerveCenter/theme-sync slice is not pushed or deployed. Changed files include `src/01-core.js`, `src/07-settings.jsx`, `src/08-app.jsx`, `src/10-deskphone-web.jsx`, plus the Shamash control `brief.txt` routing clarification. Build passes. Focused WebPhone button audit passes with zero `/handoff` calls when the local app is served on port `4183`.
- Android bridge APK `0.1.12` / versionCode `13` has been built locally at `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 3\android-webphone-bridge\dist\WebPhoneAndroidBridge-debug.apk` and installed successfully on the tablet in the prior session. This APK keeps `/messages` as a successful JSON response when remote MAP has no rows and Android `READ_SMS` is missing, returning the bridge error in `lastError` instead of causing the web page to treat the whole phone host as failed.
- DeskPhone Web parity map review is complete: 199 of 199 action rows reviewed as of 2026-05-06 (193 implemented-web, 0 host-api-needed, 6 native-only, 0 not-yet-reviewed). Latest runtime slices add browser Choose Device routing to Settings, host-backed build update accept/snooze/show controls, host-backed active-call mute, browser message Forward into a prefilled New Message draft, browser message Pin plus pinned-message jump behavior through native b256 host support, browser message Delete plus Undo through native b257 host support, browser Settings saved/scanned device controls through native b258 host support, browser contact save/delete plus call-history Undo through native b259 host support, and browser reply/full-compose attachments through native b260 `/send-with-attachments` support.
- Many untracked artifacts/logs/docs exist from prior work. The user has allowed careful cleanup; inspect and classify before removing anything.
- `shailos/` is generated output copied into the deploy; do not treat it as editable source.

High-risk areas:

- `src/08-app.jsx` is large and central; touch it narrowly.
- The latest NerveCenter clean-style work is partial by design: it covers the visible NerveCenter panel shell, phone mini-surface, theme selector, and WebPhone theme variable bridge. Next session should visually inspect NerveCenter and WebPhone across at least Google Voice plus one existing color scheme before pushing/deploying.
- Google connector behavior depends on Netlify environment variables and Google OAuth setup, not just UI code.
- Firebase writes in local dev hit the real account.
