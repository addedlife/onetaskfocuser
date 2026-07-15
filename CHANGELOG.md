# Shamash — Version History

A day-by-day account of every feature and fix behind the app you use today, reconstructed
from git history all the way back to the first commit. **Bold** version numbers are feature
releases (a "minor" bump); *italic, indented* version numbers are the fixes and polish that
followed a feature, reset to zero every time the next feature ships. Each line reads in plain
English first, with the original developer-facing commit message in backticks after it.

Reconstructed 2026-07-15 by replaying the full commit history through the versioning rule in
[`CLAUDE.md`](CLAUDE.md). Two more product generations were attempted along the way — a
from-scratch rewrite and a consolidation plan — and neither one shipped; they're called out in
place below, because a few of their ideas are genuinely worth a second look.

---

## 💡 Ideas worth a second look

Three things got explored, shelved, and — in one case — already proven worth resurrecting:

1. **A native iPad phone bridge, already built once.** A full Swift/Xcode app called
   `WebPhoneBridge` — with a real `BridgeController`, `LocalApiServer`, and a packaged iPad
   build — was built during the Pro 3 era and then abandoned in favor of a web-based iPad
   connection. The current app has since added a dedicated iPad lane (`4.75.0`) and retired it
   again the same week (`4.76.2`) because it wasn't working well enough. Worth pulling this
   native bridge back out to see what it solved that the web approach still doesn't.
2. **Rabbi Dashboard's proper package architecture.** The abandoned greenfield rewrite split
   the app into `packages/{app-core, domain, integrations, ui}` instead of one growing pile of
   files. Not worth a rewrite to get — but worth reading the next time a file like
   `10-deskphone-web.jsx` (238KB and growing) gets touched.
3. **There's a "faithful" Task River sitting in an abandoned branch.** The Task River feature
   shipped in Pro 4 on `4.40.0` (2026-06-10). Eighteen days later, the abandoned Pro 5 rebuild
   attempted a full rewrite of the same feature, explicitly calling the shipped version
   "invented lanes" and porting a more complete design from an original "Focus app" source
   (`ANALYSIS/20-focus.md`). That more faithful version never made it back into the live app —
   it's still sitting on the `pro5-rebuild` branch, unused.

---

## Prehistory — before any of this had a version number

Mid-February 2026: someone starts hand-editing HTML files at night — `OneTask App vC03.html`,
then `vC03.1`, then a `sofer.ai` API experiment that a note admits "not working yet." No git,
no formal releases, just filename suffixes. By late February it's a real deploy (`round1`,
`round2`, `v3-overhaul`). By March 15 it's matured into "taskmanager app," with weekly backups
and a real feature roadmap. On **March 20, 2026**, it gets its first git commit — this is
where formal version history begins.

---

## v1 — OneTaskFocuser / Switchboard (2026-03-20 → 2026-05-10)

**1.0.0** — 2026-03-20 — The project's first tracked commit — everything below is real,
numbered history from here on. `(Initial commit: OneTaskFocuser as currently deployed)`

**1.1.0** — 2026-03-26 — Add gotBackToAsker tracking, 3-state status icons, sort, and subtask groups for shaila tasks. `(feat: add gotBackToAsker tracking, 3-state status icons, sort, and subtask groups for shaila tasks)`
**1.2.0** — 2026-03-26 — Add got_back 3-state status to shailos bundle UI. `(feat: add got_back 3-state status to shailos bundle UI)`
**1.3.0** — 2026-03-26 — Full Shaila Transcriber integration — postMessage theme sync, lazy-persistent iframe, _taskAppSource dedup guard. `(feat: full Shaila Transcriber integration — postMessage theme sync, lazy-persistent iframe, _taskAppSource dedup guard)`
**1.4.0** — 2026-03-26 — AI to Sonnet+Gemini2.5Pro with Yeshivish, ShailaManager status/got-back/manual-add, CORS+security. `(feat: AI to Sonnet+Gemini2.5Pro with Yeshivish, ShailaManager status/got-back/manual-add, CORS+security)`
  *1.4.1* — 2026-03-26 — Restore utility files and repair netlify/claude proxy regressions. `(fix: restore utility files and repair netlify/claude proxy regressions)`
**1.5.0** — 2026-03-26 — AI to claude-sonnet-4-5+gemini-2.5-pro, Yeshivish CORS, ShailaManager manual-add/confetti/audio. `(feat: AI to claude-sonnet-4-5+gemini-2.5-pro, Yeshivish CORS, ShailaManager manual-add/confetti/audio)`
**1.6.0** — 2026-03-26 — Add status filter to ShailaManager. `(feat: add status filter to ShailaManager (Pending/Answered/Got back))`
**1.7.0** — 2026-03-27 — Large got-back pill, rename answered→got answer, update filters. `(feat(shaila): large got-back pill, rename answered→got answer, update filters)`
**1.8.0** — 2026-03-27 — Auto-backup on sign-out and window close. `(feat: auto-backup on sign-out and window close)`
**1.9.0** — 2026-03-27 — Save & close button, combined backup. `(feat: save & close button, combined backup (tasks + shailos in one JSON))`
**1.10.0** — 2026-03-29 — Migrate to Vite build system. `(feat: migrate to Vite build system)`
  *1.10.1* — 2026-03-29 — Add missing imports — fixes white screen. `(Fix: add missing imports (callAI, PALETTE, db, _lum, priText, textOnPastel) - fixes white screen)`
  *1.10.2* — 2026-03-29 — Add missing React hooks and textOnColor import. `(Fix: add missing React hooks (useMemo, useCallback, useRef) and textOnColor import)`
  *1.10.3* — 2026-03-29 — Add missing component imports to 08-app. `(Fix: add missing component imports (Ripple, Confetti, AutoFitText, BlockedBadge, TabBtn) to 08-app)`
**1.11.0** — 2026-03-29 — ShailaMiniPill in queue+ShailaManager overhaul. `(feat: ShailaMiniPill in queue+ShailaManager overhaul (statuses/sort/manual-entry/got-back pills/numbering))`
  *1.11.1* — 2026-03-30 — Allow popups in shailos iframe for Google sign-in. `(fix: allow popups in shailos iframe for Google sign-in)`
**1.12.0** — 2026-03-30 — Gemini-3.1-pro-preview everywhere + shaila UI fixes. `(feat: gemini-3.1-pro-preview everywhere + shaila UI fixes)`
**1.13.0** — 2026-03-31 — Universal Conversation Recorder + wire phone FAB. `(feat: Universal Conversation Recorder + wire phone FAB)`
  *1.13.1* — 2026-03-31 — Shaila researcher — use gemini-2.0-flash + googleSearch tool. `(fix: shaila researcher — use gemini-2.0-flash + googleSearch tool)`
**1.14.0** — 2026-03-31 — Answer synopsis on answered/got-back shaila pills. `(feat: answer synopsis on answered/got-back shaila pills)`
  *1.14.1* — 2026-03-31 — Remove duplicate export that was breaking the build. `(fix: remove duplicate export of webmToWavBase64 (build was broken))`
  *1.14.2* — 2026-03-31 — Correct button wiring, callMode for phone capture, stronger shaila detection. `(fix: correct button wiring, callMode for phone capture, stronger shaila detection)`
**1.15.0** — 2026-03-31 — Answer snippet on shailos transcriber minicards. `(feat: answer snippet on shailos transcriber minicards)`
  *1.15.1* — 2026-03-31 — Smarter answer snippet — first meaningful clause, not just first 3 words. `(fix: smarter answer snippet — first meaningful clause, not just first 3 words)`
  *1.15.2* — 2026-03-31 — Research back to gemini-3.1-pro-preview + smarter answer snippet. `(fix: research back to gemini-3.1-pro-preview + smarter answer snippet)`
  *1.15.3* — 2026-03-31 — Shailos Record Call button now delegates to the main app's recorder. `(fix: shailos Record Call button → delegates to main app ConvCapture)`
  *1.15.4* — 2026-03-31 — Shailos Record Call delegates via postMessage instead. `(fix: shailos Record Call delegates to parent ConvCapture via postMessage)`
  *1.15.5* — 2026-03-31 — Tune the conversation-parsing AI call's temperature and token limit. `(fix: aiParseConversation uses temperature 0.1 + 8192 tokens)`
  *1.15.6* — 2026-03-31 — Answer snippet capped to 6 words, single line. `(fix: answer snippet = first 6 words, single line enforced)`
  *1.15.7* — 2026-03-31 — Answer snippet — 6 words + no line-wrap in transcriber minicards. `(fix: answer snippet first 6 words + whitespace-nowrap in transcriber minicards)`
**1.16.0** — 2026-03-31 — AI-generated 6-word answer summary for shaila pills. `(feat: AI-generated 6-word answer summary for shaila pills)`
**1.17.0** — 2026-03-31 — AI answer summary in shailos transcriber minicards. `(feat: AI answer summary in shailos transcriber minicards)`
**1.18.0** — 2026-04-05 — Add auto-updating HANDOFF.md via pre-commit hook. `(feat: add auto-updating HANDOFF.md via pre-commit hook)`
  *1.18.1* — 2026-04-05 — Shailos research — background tracking, selectedShaila sync, auto-scroll, synopsis regeneration. `(fix: shailos research — google_search tool, background tracking, selectedShaila sync, auto-scroll, synopsis regeneration)`
  *1.18.2* — 2026-04-05 — Research model switched to support search grounding; guard empty responses. `(fix: research model → gemini-2.0-flash (supports google_search grounding); guard empty response)`
  *1.18.3* — 2026-04-05 — Research model switched again for grounding support. `(fix: research model → gemini-3.1-flash-preview for google_search grounding)`
  *1.18.4* — 2026-04-05 — Drop the search-grounding tool (it hangs) — use model knowledge with a strong citation prompt instead. `(fix: research — drop google_search tool (hangs on 3.1-pro), use model knowledge with strong citation prompt)`
**1.19.0** — 2026-04-05 — Research via grounded search — real source URLs. `(feat: research via gemini-3-flash-preview + google_search grounding — real source URLs)`
**1.20.0** — 2026-04-05 — Research via real Google search (Serper.dev) + AI summarization. `(feat: research via Serper.dev real Google search + Gemini summarization — no grounding tool)`
**1.21.0** — 2026-04-05 — Research adds Sefaria links for seforim mentioned in articles. `(feat: research adds Sefaria links for seforim mentioned in articles)`
  *1.21.1* — 2026-04-05 — AI converts Yeshivish shaila into a clean search query first. `(fix: research — Gemini converts Yeshivish shaila to clean Google search query before searching)`
**1.22.0** — 2026-04-05 — Article links jump straight to the relevant paragraph. `(feat: article links scroll to relevant section via Text Fragment API)`
  *1.22.1* — 2026-04-05 — Research targets kosher-authority sites specifically. `(fix: research targets kosher sites (star-k, ou, crc, halachipedia) — strips brand names from query)`
  *1.22.2* — 2026-04-05 — Keep brand names in the search query after all. `(fix: keep brand names in search query — site restrictions already prevent going to brand sites)`
  *1.22.3* — 2026-04-05 — Drop site restrictions — let ranking find halachic sites naturally. `(fix: drop site: restrictions — let Google rank halachic sites naturally via better query terms)`
  *1.22.4* — 2026-04-05 — Filter out PDF links, shorten jump-to-text targets for reliability. `(fix: filter PDF links, shorten text fragments to 1-3 word key terms for reliable page scrolling)`
  *1.22.5* — 2026-04-05 — Research overhaul — parallel multi-query search + corrected model. `(fix: research overhaul — parallel multi-query search + correct Gemini model)`
  *1.22.6* — 2026-04-05 — Revert to the strongest available model. `(fix: revert model to gemini-3.1-pro-preview (current Google top model April 2026))`
  *1.22.7* — 2026-04-05 — Unify the AI pipeline behind one model constant and one audio helper. `(fix: unified AI pipeline — single GEMINI_MODEL constant, callGeminiAudio helper, eliminate scattered raw fetches)`
  *1.22.8* — 2026-04-05 — Route text AI calls through the proxy so a server key never reaches the browser. `(fix: route text AI calls through gemini-proxy when no personal key — server key never leaves browser)`
  *1.22.9* — 2026-04-05 — Deleted priorities are now filtered at the source. `(fix: filter deleted priorities at pris source — removes home from all pickers and insights)`
  *1.22.10* — 2026-04-05 — A stray "home" priority is stripped on every load. `(fix: strip home priority from array on every load — survives Firebase round-trips)`
  *1.22.11* — 2026-04-05 — Root out the "home" priority for good with a direct database patch. `(fix: root out home priority — direct Firestore patch + block restoration via _listenV5)`
**1.23.0** — 2026-05-04 — Google Calendar + Gmail cards on the launchpad. `(feat: Google Calendar + Gmail nervecenter cards on launchpad)`
**1.24.0** — 2026-05-04 — Google cards move to NerveCenter, which becomes the default home; changelog added. `(feat: Google cards on NerveCenter, default home to NerveCenter, CHANGELOG)`
  *1.24.1* — 2026-05-04 — Fix Google Calendar + Gmail data not loading after connecting. `(fix: Google Calendar + Gmail data not loading after connect)`
  *1.24.2* — 2026-05-04 — NerveCenter single-screen layout, Google strip gets its own scroll. `(fix: NerveCenter single-screen layout, Google strip with internal scroll)`
**1.25.0** — 2026-05-06 — DeskPhone-web call-history filters reach parity with the native app. `(feat: DeskPhone web call-history parity filters)`
**1.26.0** — 2026-05-06 — DeskPhone-web call-row actions reach parity. `(feat: DeskPhone web call-row parity actions)`
**1.27.0** — 2026-05-06 — DeskPhone-web thread-side dialer reaches parity. `(feat: DeskPhone web thread-side dialer parity)`
**1.28.0** — 2026-05-06 — DeskPhone-web dialer-to-text handoff. `(feat: DeskPhone web dialer text handoff)`
**1.29.0** — 2026-05-06 — DeskPhone-web thread-side dialpad keys. `(feat: DeskPhone web thread-side dialpad keys)`
**1.30.0** — 2026-05-06 — Google data persistence, an iPhone fix, calendar/Gmail actions, phone-pane split, sidebar cleanup. `(feat: Google persistence, iPhone fix, Cal/Gmail actions, phone split, sidebar UX)`
**1.31.0** — 2026-05-06 — DeskPhone-web settings host tools. `(feat: DeskPhone web settings host tools)`
**1.32.0** — 2026-05-06 — DeskPhone-web thread search navigation. `(feat: DeskPhone web thread search navigation)`
**1.33.0** — 2026-05-06 — DeskPhone-web row actions reach parity. `(feat: DeskPhone web row action parity)`
**1.34.0** — 2026-05-06 — DeskPhone-web developer host tools. `(feat: DeskPhone web developer host tools)`
**1.35.0** — 2026-05-06 — DeskPhone-web new-message handoff. `(feat: DeskPhone web new message handoff)`
**1.36.0** — 2026-05-06 — DeskPhone-web settings section reaches parity. `(feat: DeskPhone web settings section parity)`
**1.37.0** — 2026-05-06 — DeskPhone-web contact-sync host tools. `(feat: DeskPhone web contact sync host tools)`
**1.38.0** — 2026-05-06 — DeskPhone-web appearance toggles. `(feat: DeskPhone web appearance setting toggles)`
**1.39.0** — 2026-05-06 — DeskPhone-web full calls pane. `(feat: DeskPhone web full calls pane)`
**1.40.0** — 2026-05-06 — DeskPhone-web compose surface. `(feat: DeskPhone web compose surface)`
  *1.40.1* — 2026-05-06 — Restore the rail's auto-collapse timers. `(fix: restore rail auto collapse timers)`
**1.41.0** — 2026-05-06 — DeskPhone-web call-and-build prompt reaches parity. `(feat: DeskPhone web call and build prompt parity)`
**1.42.0** — 2026-05-06 — DeskPhone-web pinned-message parity. `(feat: DeskPhone web pinned message parity)`
**1.43.0** — 2026-05-06 — DeskPhone-web message-delete parity. `(feat: DeskPhone web message delete parity)`
**1.44.0** — 2026-05-06 — DeskPhone-web device-settings parity. `(feat: DeskPhone web device settings parity)`
**1.45.0** — 2026-05-06 — DeskPhone-web contact/call undo reaches parity. `(feat: DeskPhone web contact and call undo parity)`
**1.46.0** — 2026-05-06 — DeskPhone-web attachment parity — the web app now matches the native one. `(feat: complete DeskPhone web attachment parity)`
  *1.46.1* — 2026-05-07 — Wire up the parity buttons in the browser. `(fix(deskphone-web): wire parity buttons in browser)`
  *1.46.2* — 2026-05-07 — Visual cleanup pass on DeskPhone-web. `(style: apply GV-clean DeskPhone web pass)`
  *1.46.3* — 2026-05-07 — Sync NerveCenter and WebPhone appearance. `(style: sync NerveCenter and WebPhone appearance)`
  *1.46.4* — 2026-05-07 — Show a real contact name or number in call-history rows. `(Fix: show contact name or number in call history rows)`

---

## The line that never shipped

Two more product generations were planned in this window, and neither one shipped as running
code:

- **"Rabbi Dashboard"** — a from-scratch rewrite with a proper multi-package architecture,
  developed in parallel with the OneTaskFocuser line above. Abandoned May 3, 2026 in favor of
  building "Switchboard" directly inside the live OneTaskFocuser codebase instead — a
  deliberate choice to keep shipping working software rather than finish a rewrite.
- **"Shamash Pro 3"** — not a rewrite at all, despite the name. It was a one-week governance
  and consolidation *plan* (May 3–10, 2026) that decided how to merge three separately-living
  products — OneTaskFocuser/Switchboard, the Shailos AI assistant, and the DeskPhone Windows
  bridge — into one app. That plan is exactly what got executed next.

Both are the reason major version 4 doesn't have a real, shipped 2 or 3 before it — those
numbers were spent on a rewrite and a plan, not a release.

---

## v4 — Shamash Pro 4 (2026-05-10 → present)

**4.0.0** — 2026-05-10 — The Pro 4 cutover: OneTaskFocuser, Shailos, and the DeskPhone Windows
bridge are physically merged into one clean workspace. `(Initialize Shamash Pro 4 clean workspace)`

  *4.0.1* — 2026-05-11 — Collapse a blank area in the NerveCenter task pane. `(fix: collapse nervecenter task pane blank area)`
  *4.0.2* — 2026-05-12 — Swipeable panel carousel for Android/mobile NerveCenter. `(fix: swipeable panel carousel for Android/mobile NerveCenter)`
  *4.0.3* — 2026-05-12 — Scroll-snap carousel + landscape overflow fix. `(fix: CSS scroll-snap carousel for NerveCenter + landscape overflow)`
  *4.0.4* — 2026-05-12 — Same carousel/overflow fix, round two. `(fix: CSS scroll-snap carousel for NerveCenter + landscape overflow)`
  *4.0.5* — 2026-05-12 — Full-screen stacked carousel with proper swipe handling. `(fix: full-screen stacked carousel + touch-action for swipe-on-cards)`
  *4.0.6* — 2026-05-12 — Drop panel headers on phone for a content-first layout. `(fix: headerless NerveCenter panels on phone (content-first layout))`
  *4.0.7* — 2026-05-18 — Merge phone threads by contact instead of by number. `(fix: merge nervecenter phone threads by contact)`
  *4.0.8* — 2026-05-19 — Stabilize DeskPhone-web sync and call controls. `(fix: stabilize deskphone web sync and call controls)`
  *4.0.9* — 2026-05-19 — Anchor expanded phone threads in place. `(fix: anchor nervecenter expanded threads)`
  *4.0.10* — 2026-05-19 — Clearer phone-history dates; expanded threads now close properly. `(fix: clarify phone history dates and close expanded threads)`
  *4.0.11* — 2026-05-19 — Remove clutter — collapsed thread counts. `(fix: remove nervecenter collapsed thread counts)`
  *4.0.12* — 2026-05-19 — Stop backup files from downloading on every page reload. `(fix: stop backup downloads on reload)`
  *4.0.13* — 2026-05-19 — Persist Google Workspace sign-in and contrast theme choices. `(fix: persist google workspace auth and contrast themes)`
  *4.0.14* — 2026-05-19 — Float the phone-thread action buttons. `(fix: float nervecenter thread actions)`
  *4.0.15* — 2026-05-19 — Harden DeskPhone theme contrast. `(fix: harden deskphone theme contrast)`
  *4.0.16* — 2026-05-20 — Repair low-contrast rows in the task queue. `(fix: repair queue pastel row contrast)`
  *4.0.17* — 2026-05-20 — Persist auth sessions; throttle Google reconnect attempts. `(fix: persist auth sessions and throttle google reconnect)`
**4.1.0** — 2026-05-20 — Add the NerveCenter "chief briefing." `(feat: add nervecenter chief briefing)`
**4.2.0** — 2026-05-20 — Add a cloud-synced chief profile; throttle background scans. `(feat: add chief cloud profile and throttle scans)`
  *4.2.1* — 2026-05-21 — Migrate the phone relay to Firestore's REST API and gate it behind real sign-in. `(fix(relay): migrate to Firestore REST API + gate phone data behind Firebase auth)`
**4.3.0** — 2026-05-21 — UI cleanup — emoji replaced with real icons, dialogs modernized. `(feat(ui): State cleanup, emoji→Material Symbols, dialog modernization (Tiers 1-3 partial))`
  *4.3.1* — 2026-05-21 — Remove a hardcoded build number from a relay error message. `(fix: remove hardcoded build number from relay error message)`
  *4.3.2* — 2026-05-21 — Repair broken color tokens and the DeskPhone delete-calls dialog. `(fix(ui): repair broken color tokens and DeskPhone delete-calls dialog)`
  *4.3.3* — 2026-05-21 — Fix a missing dependency in the relay refresh logic. `(fix(relay): add user to refresh useCallback dep array)`
**4.4.0** — 2026-05-21 — Add motion, interaction, and elevation systems for a cohesive feel. `(feat(ui): motion, interaction & elevation systems for cohesive polish)`
**4.5.0** — 2026-05-21 — Unify icons, type scale, and spacing rhythm app-wide. `(feat(ui): unify icons, type scale, and spacing rhythm)`
  *4.5.1* — 2026-05-25 — Fall back to local storage when Firebase comes back empty after a rules outage. `(fix(app): load localStorage when Firebase is empty after rules outage)`
**4.6.0** — 2026-05-25 — A new centered "designer clock" with split hour/minute and seconds. `(feat(nervecenter): designer clock — centered, split H:MM / seconds)`
**4.7.0** — 2026-05-25 — Restore the hamburger menu on the task screen; left-anchor settings. `(feat(ui): restore hamburger menu on task screen; left-anchor settings panel)`
**4.8.0** — 2026-05-25 — Remove the header; the clock card now sits between Calendar and Gmail. `(feat(nervecenter): remove header, designer clock card between Calendar/Gmail)`
**4.9.0** — 2026-05-25 — Pill-to-arrow tab; bolder clock card. `(feat(nervecenter): pill-to-arrow tab + bolder clock card)`
  *4.9.1* — 2026-05-25 — Fix the completed-items stack overlapping and clipping. `(fix(ui): completed stack — no overlap, no sidebar clip, show all entries)`
**4.10.0** — 2026-05-25 — Snazzier clock card — accent cap, split AM/PM, compact date. `(feat(nervecenter): snazzier clock card — accent cap, AM/PM split, compact date)`
**4.11.0** — 2026-05-25 — Right-click the clock to pick from 5 designs. `(feat(nervecenter): right-click clock style picker — 5 designs)`
  *4.11.1* — 2026-05-25 — Constrain the sticky-note container size; tap outside the hamburger menu to dismiss it. `(fix(ui): constrain PostIt container size; add hamburger backdrop dismiss)`
  *4.11.2* — 2026-05-25 — Fix a missing API key breaking relay auth reads. `(fix(relay): add missing API key to Firestore auth reads; map 401/403 relay errors specifically)`
  *4.11.3* — 2026-05-25 — Enter sends a message; Ctrl+Enter inserts a newline. `(fix(deskphone): Enter sends message, Ctrl+Enter inserts newline)`
**4.12.0** — 2026-05-25 — 3 new clock faces, a seconds bar, an analog sub-display; fix task text contrast. `(feat(clock): 3 new faces, seconds bar, analog digital sub-display; fix task text contrast)`
  *4.12.1* — 2026-05-25 — Shaila color fix, flatter icons, smoother seconds bar. `(fix(ui): shaila color, flat M3 circles, smooth secbar, clock polish)`
**4.13.0** — 2026-05-25 — A timeline clock face; richer email summaries. `(feat(clock): timeline face + smooth secBar; richer email summaries)`
  *4.13.1* — 2026-05-25 — True smooth 60fps sweep, later fade, tighter email summaries. `(fix(clock+email): true 60fps sweep, late fade, email clamp+voice prompt)`
**4.14.0** — 2026-05-25 — Timeline clock gets a Hebrew month label and an analog second hand. `(feat(clock): timeline addon, Hebrew month label, analog second hand)`
**4.15.0** — 2026-05-25 — A Health Card and full Health Page, backed by Firebase. `(feat(health): Health Card + Health Page with Firebase backend)`
**4.16.0** — 2026-05-25 — Google Health integration and a minimal NerveCenter card. `(feat(health): Google Health API integration + minimal NC card)`
  *4.16.1* — 2026-05-25 — Always show the Google account picker on connect. `(fix(health): always show Google account picker on OAuth connect)`
  *4.16.2* — 2026-05-25 — Fix a white-screen crash caused by hook ordering. `(fix: move Health OAuth useEffect above !AS guard to fix hooks-order white screen)`
  *4.16.3* — 2026-05-25 — Add Health to the rail menu — it couldn't actually be opened before. `(fix(health): add Health section to switchboard rail menu so it can be opened)`
  *4.16.4* — 2026-05-25 — Actually add the Health button to the sidebar and action palette. `(fix(health): actually add health button to sidebar rail and NC action palette)`
  *4.16.5* — 2026-05-25 — Clean up the connect flow; Google Health becomes the primary source. `(fix(health): clean connect flow, real isDemo, Google Health as primary)`
**4.17.0** — 2026-06-02 — Record from system audio; Hebrew day-of-month on the timeline. `(feat(web): system-audio source for Record Anything + Hebrew day-of-month timeline row)`
**4.18.0** — 2026-06-02 — Reorder the timeline rows for a more natural reading order. `(feat(web): reorder timeline rows — Sivan → 5786 → Jun → 2026)`
**4.19.0** — 2026-06-02 — Research citations now show clean, named source links. `(feat(shailos): clean bullet sources with named attribution links)`
**4.20.0** — 2026-06-02 — Research reports get two-line bullets with no redundancy. `(feat(shailos): research report — two-line bullets, no redundancy, clean dividers)`
  *4.20.1* — 2026-06-02 — Stricter relevance filter, cap results at 8. `(fix(shailos): aggressive relevance filter, no source-name prefix, cap at 8 results)`
  *4.20.2* — 2026-06-03 — Keep citation links aligned with their summaries. `(fix(shailos): keep research citation links aligned with their summaries)`
**4.21.0** — 2026-06-03 — Show who's signed in instead of silently showing empty lists. `(feat(shailos): surface auth identity instead of silently showing blank lists)`
  *4.21.1* — 2026-06-03 — Force long-polling mode so lists actually load on mobile. `(fix(shailos): force Firestore long-polling so lists load on mobile)`
**4.22.0** — 2026-06-04 — Add a live database-connectivity probe to the diagnostics overlay. `(feat(diag): add direct Firestore reachability probe to ?diag=1 overlay)`
  *4.22.1* — 2026-06-04 — Fix the probe to check the real user record, not a reserved path. `(fix(diag): probe the real user doc path, not a reserved __name__)`
**4.23.0** — 2026-06-04 — Show live auth token details to explain permission errors. `(feat(diag): show live auth token claims to explain Firestore 403s)`
**4.24.0** — 2026-06-04 — Serve Google sign-in from the app's own domain, fixing mobile redirects. `(feat(auth): serve Google sign-in from our own domain (fix mobile redirect))`
**4.25.0** — 2026-06-04 — Push new texts to every device in real time. `(feat(relay): push texts to all devices in real time)`
**4.26.0** — 2026-06-04 — Collapse phone connection down to two clean paths. `(feat(phone): collapse phone connection to two clean paths)`
**4.27.0** — 2026-06-04 — Five equal scrollable boxes on phone and tablet. `(feat(nerve): five equal scrollable boxes on phone/tablet)`
  *4.27.1* — 2026-06-04 — Stop a caching quirk from wiping the live relay feed. `(fix(phone): stop Firestore cache emits from wiping the relay feed)`
  *4.27.2* — 2026-06-04 — Fix a blank phone card in the 5-box grid. `(fix(nerve): phone card in 5-box grid was blank — flex height collapse)`
**4.28.0** — 2026-06-05 — Drop card header bars for a thin corner icon on mobile. `(feat(nerve): drop card header bars for a thin corner type-icon (mobile))`
  *4.28.1* — 2026-06-05 — Auto-recover a denied profile on startup; show live PC-link status. `(fix(auth+relay): auto-recover denied profile on startup; show live PC-link state)`
**4.29.0** — 2026-06-05 — Picture messages (MMS) now travel over the cloud relay. `(feat(relay): picture-text (MMS) images over the cloud relay)`
  *4.29.1* — 2026-06-05 — Stop Google sign-in from re-prompting every few minutes on mobile. `(fix(auth): stop Google sign-in re-prompting every ~5 min on mobile)`
**4.30.0** — 2026-06-05 — Mobile top-line cleanup, cleaner icons, compact DeskPhone nav, safer research formatting. `(feat(ux): mobile toplines, borderline icons, DeskPhone compact nav, research format guard)`
**4.31.0** — 2026-06-07 — Borderless mobile cards with per-category chief summaries. `(feat(nerve-center): borderless mobile cards with chief per-category summaries)`
**4.32.0** — 2026-06-07 — Apple-style card summaries, thin dividers, missed-call resolve action. `(feat(nerve-center): Apple-style card summaries, thin dividers, missed-call resolve)`
**4.33.0** — 2026-06-07 — Apple-style fallbacks, separator-free rows, a layout toggle. `(feat(nerve-center): Apple-style fallbacks, separator-free rows, layout toggle)`
**4.34.0** — 2026-06-07 — A density mode, colored header icons, multi-open accordion sections. `(feat(nerve-center): density mode, colored header icons, multi-open accordion)`
**4.35.0** — 2026-06-07 — Tap-to-expand rows, a scroll-collapsing summary, tinted cards. `(feat(nerve-center): tap-to-expand rows, scroll-collapsing summary, tinted cards, accordion scroll)`
  *4.35.1* — 2026-06-07 — Bottom fade for cut-off rows; a leaner compact phone card. `(fix(nerve-center): bottom fade for partial rows, lean compact phone card)`
**4.36.0** — 2026-06-07 — Streamed next-action prompts, tighter rows, the health card dropped, phone calls now accordion-style. `(feat(nerve-center): streamed next-action, tighter compact rows, drop health card, summary dedupe, accordion phone calls)`
  *4.36.1* — 2026-06-07 — Fix a crash from an incorrectly-declared variable; harden a fade animation. `(fix(crash): const→let fbState, harden MobileBox fade, fix typewriter cleanup)`
  *4.36.2* — 2026-06-07 — Missed-call resolve, deeper history, font and tone fixes. `(fix(nervecenter): missed-call resolve, history depth, fonts, brief tone, task sync)`
  *4.36.3* — 2026-06-07 — Add a missed-call resolve button to the phone screen. `(fix(deskphone-web): missed call resolve button on phone screen)`
  *4.36.4* — 2026-06-07 — Call stability, cloud-synced missed-call state, phone preview fixes. `(fix: call stability, cloud resolvedMissed, supercrunch, phone preview)`
  *4.36.5* — 2026-06-07 — Server-only database writes; a daily backup; tighter email layout. `(fix: server-only Firestore, daily backup, email single-line layout)`
  *4.36.6* — 2026-06-07 — Move the layout selector to the top right; tighter spacing. `(fix(nc): layout selector top-right, horizontal expand icon, tighter spacing)`
  *4.36.7* — 2026-06-07 — Remove a duplicate preview block; use dots instead of bars; more readable fonts. `(fix(nc): remove duplicate preview body, dots not bars, readable fonts)`
  *4.36.8* — 2026-06-07 — Decouple the summary engine from the "Chief" feature; drop fake placeholder content. `(fix(nc): decouple SuperCrunch/card signals from Chief, remove all fallback content)`
  *4.36.9* — 2026-06-07 — Fix inconsistent status dots across five different card instances. `(fix(nc): dots everywhere — missed 5 task/shaila bar instances in boxes + desktop views)`
  *4.36.10* — 2026-06-07 — Responsive box layout — vertical above 600px, carousel below. `(fix(nc): responsive boxes layout — vertical >= 600px, carousel < 600px)`
  *4.36.11* — 2026-06-08 — Denser type scale, AI-only summaries, tighter row padding everywhere. `(fix(nc): dense type scale, AI-only summaries, tight row padding across all layouts)`
  *4.36.12* — 2026-06-08 — Responsive layout fixes across every view format. `(fix(nc): responsive layout for all formats — boxes + accordion)`
  *4.36.13* — 2026-06-08 — Boxes and accordion — columns when wide, rows when narrow, no carousel. `(fix(nc): boxes + accordion — columns when wide, rows when narrow, no carousel)`
  *4.36.14* — 2026-06-08 — Fix a crash from a variable used before it was declared. `(fix(nc): resolve TDZ crash in boxes layout — declare boxesFiveCol before use)`
  *4.36.15* — 2026-06-08 — Wrap text instead of truncating it in every column. `(fix(nc): wrap text in all columns instead of ellipsis — Gmail-only exception before aiSummary loads)`
  *4.36.16* — 2026-06-08 — Wrap section previews and sticky headers instead of truncating. `(fix(nc): wrap section preview + box sticky header — no ellipsis on column surfaces)`
**4.37.0** — 2026-06-08 — Replace the item-counting banner with a real AI-crunched summary and next action. `(feat(nc): replace counting banner with super-crunched summary + next action, each with refresh icon)`
  *4.37.1* — 2026-06-08 — Exclude past calendar events from the AI's context; balance sources fairly. `(fix(nc-banner): exclude past calendar events from AI context; enforce cross-source balance in supercrunch)`
  *4.37.2* — 2026-06-08 — Italicized, muted card-summary text for a classy caption look. `(style(nc): italic + muted for all card summary text — classy caption treatment)`
  *4.37.3* — 2026-06-09 — Stop email/calendar summaries from hanging forever on mobile. `(fix(nc-mobile): stop email/calendar + summaries hanging forever on mobile)`
**4.38.0** — 2026-06-09 — A version stamp appears in the left rail — the standing release policy begins here. `(feat(rail): version stamp in left rail + standing release/versioning policy)`
**4.39.0** — 2026-06-09 — Enforce a version bump on every push. `(feat(guard+rail): enforce version bump on push; fix mobile rail + version stamp)`
  *4.39.1* — 2026-06-09 — Commit the hook so the version-bump guard actually persists. `(fix(guard): commit Claude SessionStart hook so the push guard persists)`
  *4.39.2* — 2026-06-09 — Summary reliability improvements; the rail now fits landscape screens. `(fix(nc): summaries reliability + per-area live status; rail fits landscape)`
  *4.39.3* — 2026-06-09 — Handle the case where the chosen AI provider has no key. `(fix(nc): summaries unavailable when chosen AI provider lacks a key)`
  *4.39.4* — 2026-06-09 — Native card summaries now always run. `(fix(nc): native card summaries always run + small one-line summaries)`
  *4.39.5* — 2026-06-09 — Summary status stops blanking out between updates. `(fix(nc): summary status persists (no blanking) + tighter card line spacing)`
  *4.39.6* — 2026-06-10 — Compact density is now genuinely twice as tight as expanded. `(fix(nc): make compact density genuinely ~2x tighter than expanded)`
**4.40.0** — 2026-06-10 — Task River — one calm, auto-prioritized stream of tasks and Shaila cases. `(feat(taskriver): one calm auto-prioritized river of tasks + shailos)`
  *4.40.1* — 2026-06-10 — Accordion sections become collapsible — summary-only until tapped. `(fix(nc): accordion is collapsible (summary-only until tapped))`
  *4.40.2* — 2026-06-10 — Fix stacking order; mix all sources into one river bar. `(fix(taskriver): cover-screen z-index, all sources mixed, one river bar, tight rows)`
**4.41.0** — 2026-06-10 — Task River now reads emails and scores calendar events too. `(feat(taskriver): analyze emails + smarter calendar scoring for the mix)`
**4.42.0** — 2026-06-10 — AI now prioritizes the entire river, not just parts of it. `(feat(taskriver): AI prioritization of the whole river)`
**4.43.0** — 2026-06-10 — Terse AI reasoning line; manual priority labels dropped. `(feat(taskriver): terse AI line + ≤3-word reason; drop manual priority labels)`
  *4.43.1* — 2026-06-10 — Drop bullet icons and slim the controls to reclaim width. `(fix(taskriver): drop bullet icons + slim controls to reclaim width)`
  *4.43.2* — 2026-06-10 — Fix the river status getting stuck on "AI prioritizing." `(fix: river status never sticks on "AI prioritizing"; label NC suggestion)`
  *4.43.3* — 2026-06-10 — AI-only priority and reasons — no made-up fallback text. `(fix(taskriver): AI-only priority + reasons; no fabricated fallbacks)`
  *4.43.4* — 2026-06-10 — Make compact density aggressively tight across every card. `(style(nc): make compact density aggressively tight across all cards)`
  *4.43.5* — 2026-06-10 — Fix compact density in full-panel view; fix Google getting stuck loading on expired tokens. `(fix(nc): compact density works in full-panel view + fix Google stuck-loading on token expiry)`
  *4.43.6* — 2026-06-10 — Apply compact density to the accordion/stacked view too. `(style(nc): apply compact density to accordion/stacked view too)`
  *4.43.7* — 2026-06-10 — Require a verified sign-in token on the health, relay-command, and debug endpoints. `(fix(security): require verified Firebase token on health, relay-command, and debug-log)`
**4.44.0** — 2026-06-10 — True delivery status for remote phone commands. `(feat(relay): true delivery status for remote phone commands)`
**4.45.0** — 2026-06-10 — Card views expand to full page height with denser task rows. `(feat(nc): boxes-view cards expand to page height + denser task rows + Tasks/Shailos icon swap)`
  *4.45.1* — 2026-06-10 — Stop summary lines from updating endlessly. `(fix(nc): stop summary lines from updating forever)`
  *4.45.2* — 2026-06-10 — Bucket calendar rows per-minute so the scan key stops churning. `(fix(nc): bucket calendarRows to per-minute so scan key stops churning)`
  *4.45.3* — 2026-06-10 — Remove a constantly-ticking timestamp from the phone snapshot. `(fix(nc): remove ticking lastSeenLabel from phone activity snapshot)`
  *4.45.4* — 2026-06-11 — Unjam the overloaded AI gateway — four stacked causes fixed at once. `(fix(ai): unjam the overloaded AI gateway — four stacked causes)`
  *4.45.5* — 2026-06-11 — Bound two unbounded waits that were still killing the AI gateway. `(fix(ai): bound the two unbounded waits that still killed the gateway)`
  *4.45.6* — 2026-06-11 — A retry countdown and an always-enabled "reprioritize" button. `(fix(river): retry countdown + always-enabled reprioritize button)`
**4.46.0** — 2026-06-11 — Seamless phone transport — direct on the PC, cloud relay anywhere else. `(feat(phone): seamless auto transport - direct on the PC, cloud relay anywhere)`
  *4.46.1* — 2026-06-11 — One color per task type; a sensible fallback order. `(fix(river): one color per type + interleaved fallback order)`
  *4.46.2* — 2026-06-11 — Stop an endless AI retry loop after two attempts. `(fix(river): stop endless AI retry loop after 2 auto-attempts)`
  *4.46.3* — 2026-06-11 — A dedicated AI lane so ranking actually gets processing time. `(fix(river): dedicated Gemini lane so river_rank actually gets a slot)`
  *4.46.4* — 2026-06-12 — Auto-embed the DeskPhone UI directly in the Phone screen when reachable. `(fix(phone): auto-embed DeskPhone-served UI in Phone screen when directly reachable (web 4.17.49))`
  *4.46.5* — 2026-06-12 — Phone surface colors now derive from the shared design tokens. `(style(tokens): phone surface palette now derives from GV_CLEAN (web 4.17.50))`
  *4.46.6* — 2026-06-12 — Consolidate five separate page-load AI calls into two — kills request pileup. `(fix(ai): consolidate 5 page-load calls into snapshot+river_rank — kills queue contention)`
  *4.46.7* — 2026-06-12 — Slash daily AI usage with slower polling and cross-tab throttling. `(fix(ai): slash daily RPD usage — snapshot 90s→8min, rank cross-tab throttle, email dedup)`
  *4.46.8* — 2026-06-12 — Guard a token call so Health stops spamming the console. `(fix(health): guard user.getIdToken so the Health surface stops spamming the console)`
  *4.46.9* — 2026-06-12 — Move layout selectors to the top right, above every pane. `(fix(nervecenter): full-view layout selectors move to top right, above all panes)`
  *4.46.10* — 2026-06-12 — One consistent interaction language everywhere — same focus color, hover, and scrollbars. `(style(global): one interaction language across every surface — teal focus, uniform hover/press, unified scrollbars)`
  *4.46.11* — 2026-06-12 — Shailos switches to the same icon set as the rest of the app. `(style(shailos): Material Symbols Rounded replaces lucide — last surface joins the one icon language)`
  *4.46.12* — 2026-06-13 — Use Firebase's default sign-in domain while Netlify is paused. `(fix(auth): use Firebase default authDomain while Netlify is paused)`
  *4.46.13* — 2026-06-13 — Rank more items with a higher token budget; Shaila cases always rank first. `(fix(taskriver): rank all items — emails 12→25, cap 60→100, tokens 1400→3000, shailos always top)`
  *4.46.14* — 2026-06-14 — A live indicator pill shows whether DeskPhone is direct or web fallback. `(style(deskphone): live surface indicator pill — teal = DeskPhone direct, amber = web fallback)`
  *4.46.15* — 2026-06-14 — Web polling stops once the relay is providing real-time updates. `(fix(relay): web poll stops on relay transport — onSnapshot handles real-time updates)`
  *4.46.16* — 2026-06-14 — DeskPhone panel now fills its space cleanly in every embed mode. `(style(deskphone): DeskPhone panel fills cleanly — embedded mode for both iframe and fallback)`
  *4.46.17* — 2026-06-14 — Auto-hide the Windows app window when its embedded view is active. `(style(deskphone): auto-hide WPF window when iframe is active, restore on leave)`
  *4.46.18* — 2026-06-14 — Fix window resizing, search scope, and the UI toggle in DeskPhone. `(fix: DeskPhone WebView2 resize reflow, thread search scope, WPF UI toggle)`
  *4.46.19* — 2026-06-14 — Message list shrinks properly with the window; stacked layout drops extra chrome. `(style(deskphone): message list shrinks with window, stacked layout drops chrome)`
  *4.46.20* — 2026-06-14 — Hotfix a blank white screen in the message pane. `(fix(deskphone): restore min-height:0 on dp-message-shell — blank white screen hotfix)`
  *4.46.21* — 2026-06-14 — Root-cause fix for the same blank white screen. `(fix(deskphone): container-type inline-size + 36pct — blank white screen root cause fix)`
  *4.46.22* — 2026-06-14 — Theme sync is now always live; remove the manual refresh toggle. `(fix: DeskPhone WebView2 theme sync always live; remove manual Refresh Sync + toggle)`
  *4.46.23* — 2026-06-14 — Theme now syncs to the iframe at zero extra cost. `(fix: DeskPhone iframe theme via postMessage — zero cost, always live)`
  *4.46.24* — 2026-06-14 — Routine version bump. `(style: bump 4.17.64)`
  *4.46.25* — 2026-06-14 — Theme now propagates to the standalone window; remove the separate Dark Mode setting. `(fix: support theme propagation to standalone WebShell window and remove Dark Mode setting)`
  *4.46.26* — 2026-06-14 — Prevent duplicate tasks/Shaila cases when parsing a recording transcript. `(fix: prevent duplication of existing tasks and shailos during recording transcript parsing)`
**4.47.0** — 2026-06-14 — Move hosting from Netlify to Firebase. `(feat: migrate hosting from Netlify to Firebase (Spark, Gemini-only))`
  *4.47.1* — 2026-06-14 — Rename environment keys to satisfy Firebase's naming rules. `(fix: rename functions .env keys to satisfy Firebase naming rules)`
  *4.47.2* — 2026-06-14 — Default to the cheapest AI model; drop stale options from the switcher. `(fix: default to cheapest Gemini model and drop stale OpenAI/Claude options from model switcher)`
**4.48.0** — 2026-06-14 — Multi-account Google Workspace — connect several calendars/inboxes with merge and dedupe. `(feat: multi-account Google Workspace (calendar + email) with merge, dedupe, and account toggle)`
  *4.48.1* — 2026-06-14 — Mark the first-connected Google account as primary. `(fix: mark first-connected Google account as primary (rabbidanziger))`
  *4.48.2* — 2026-06-15 — Remove a stale local cache; fix rescans and add a manual refresh. `(fix: remove stale localStorage cache from NC snapshot; fix rescan keys and add Google data refresh)`
  *4.48.3* — 2026-06-15 — Use redirect-based sign-in on iOS, where popups get blocked. `(fix: use GIS redirect mode on iOS for Google Workspace connect (popup blocked by iOS))`
  *4.48.4* — 2026-06-15 — Remove a stale rate-limit block causing an endless spinner. `(fix: remove stale rate-limit block causing forever spinner when no cached NC data)`
  *4.48.5* — 2026-06-15 — Let scans settle for 5 minutes; expand note length to 5 words. `(fix: 5-min in-session scan settle; expand signal notes to up to 5 words)`
  *4.48.6* — 2026-06-15 — Run email summaries through the authenticated server path; reset dedup per session. `(fix: run email AI summaries on server-auth path; reset dedup key per session)`
  *4.48.7* — 2026-06-15 — Show an animated spinner in card headers while a summary loads. `(fix: show animated spinner in section card headers while NC summary loads)`
  *4.48.8* — 2026-06-15 — Revert a broken wrapper that crashed the minified build. `(fix: revert broken signalNote JSX wrapper (TDZ crash in minified bundle))`
  *4.48.9* — 2026-06-15 — Fix the same class of crash by calling the summary function directly. `(fix: eliminate TDZ crash by calling applyEmailSummaries directly in server-auth path)`
  *4.48.10* — 2026-06-15 — Raise the AI token limit so the full list actually gets ranked. `(fix: raise river_rank maxOutputTokens 3000→8192 so full list gets AI-prioritized)`
  *4.48.11* — 2026-06-16 — Use a same-origin sign-in domain so redirect auth survives iOS tracking prevention. `(fix: use same-origin authDomain so iOS/Android redirect auth survives ITP)`
  *4.48.12* — 2026-06-16 — Sign-in domain now adapts to whichever host is serving the app. `(fix: host-aware authDomain so sign-in works on Firebase now and Netlify later)`
  *4.48.13* — 2026-06-16 — Require a verified sign-in token on the AI proxy to stop anonymous abuse. `(fix: require Firebase ID token on the live AI proxy (stop anonymous bill abuse))`
  *4.48.14* — 2026-06-17 — Stop the offline service worker from breaking the mobile sign-in flow. `(fix: stop service worker from intercepting Firebase Auth /__/ paths (mobile sign-in loop))`
  *4.48.15* — 2026-06-17 — Route visitors to the correct sign-in domain to avoid an OAuth mismatch error. `(fix: route web.app visitors to firebaseapp.com origin (avoid OAuth redirect_uri_mismatch))`
  *4.48.16* — 2026-06-17 — Reskin the NerveCenter section chrome. `(style: reskin NerveCenter section chrome to 2026 language (boxes + accordion))`
  *4.48.17* — 2026-06-17 — Rebuild sign-in clean — Google-only, one canonical domain. `(fix: rebuild auth clean — Google-only, single canonical origin (firebaseapp.com))`
  *4.48.18* — 2026-06-17 — Repair wiring broken by the hosting migration. `(fix: repair migration-broken wiring (Shailos AI/search, stale Netlify URLs, live mail cadence))`
  *4.48.19* — 2026-06-17 — Revert mail polling interval; formally retire the paused Netlify backend. `(fix: revert mail idle poll to 15min + tombstone the paused Netlify backend)`
**4.49.0** — 2026-06-17 — An always-available reload button in the app rail. `(feat: always-on reload button in the suite rail (standalone/PWA refresh))`
  *4.49.1* — 2026-06-17 — Consistent number styling across every clock, calendar time, and date. `(style: mono numerals across NerveCenter (clocks, calendar times, mail dates))`
**4.50.0** — 2026-06-17 — A Features settings tab to toggle popups, Chief, and Health. `(feat: Features settings tab — toggle move-up popup, Chief, and Health)`
  *4.50.1* — 2026-06-19 — Session-cached email summaries; a design-system audit pass. `(fix(nervecenter): hash-keyed session cache for email summaries; M3 style audit)`
  *4.50.2* — 2026-06-19 — Every layout/motion value becomes a shared design token. `(style: ShamashPro CSS token system — all layout/motion tokens become CSS vars)`
  *4.50.3* — 2026-06-19 — First screen fully converted to the token system. `(style: tokenize SuiteShailosPanel — screen 1 of app-wide --shp-* rollout)`
  *4.50.4* — 2026-06-19 — Every design token now rolled out app-wide. `(style: tokenize all --shp-* CSS vars across app)`
  *4.50.5* — 2026-06-19 — Radius, font, spacing, and shadow tokenized across five more files. `(style: tokenize radius/font/spacing/shadow across 04-components, 05-modals, 06-shelf, 07-settings, 10-deskphone-web)`
  *4.50.6* — 2026-06-19 — Trim 18 color themes down to 8 curated, industry-standard ones. `(style: winnow color themes 18 -> 8 curated, industry-standard set)`
**4.51.0** — 2026-06-19 — The master M3 stylebook and a UI-drift logger — a real design-consistency foundation. `(feat: M3 stylebook master + UI-drift logger (consistency foundation))`
**4.52.0** — 2026-06-19 — A one-click "clear generated themes" button. `(feat: one-click "Clear generated" button for AI-generated themes)`
**4.53.0** — 2026-06-19 — A runtime style-override flag and a full design-spec catalogue. `(feat: runtime master-style override (?uistyle=1) + full M3_SPEC catalogue)`
**4.54.0** — 2026-06-21 — Migrate the app shell to real Material Design 3 components. `(feat: migrate AppSuiteChrome to real @material/web M3 components)`
  *4.54.1* — 2026-06-21 — Consistent pill shape across every rail item. `(fix: remove NerveCenter arrow cap + matching pill shape for all rail items)`
**4.55.0** — 2026-06-21 — "Record Anything" gets stronger — Yeshivish dialect support, a proper Shaila question form. `(feat: strengthen Record Anything — Yeshivish dialect, shaila question form, task richness, schedule hints)`
  *4.55.1* — 2026-06-21 — Clock shows 12-hour time plus English and Hebrew dates when collapsed. `(fix: collapsed clock shows 12hr time + English + Hebrew date)`
  *4.55.2* — 2026-06-21 — Hebrew date shown in actual Hebrew letters, in both rail states. `(fix: Hebrew date in Hebrew letters, shown in both expanded and collapsed rail)`
  *4.55.3* — 2026-06-21 — Same collapsed-clock fix, applied again. `(fix: collapsed clock shows 12hr time + English + Hebrew date)`
  *4.55.4* — 2026-06-21 — Design-system audit pass on the Focus App section. `(style: M3 audit pass — Focus App (section 2) visual polish)`
  *4.55.5* — 2026-06-21 — Gut the old stylebook and redirect it to the real component library. `(style: gut m3-stylebook — redirect to @material/web, inline dev-tool constants)`
  *4.55.6* — 2026-06-21 — Replace hand-coded rules with real Material components in section 2. `(style: section 2 — real @material/web components via createComponent, not hand-coded rules)`
  *4.55.7* — 2026-06-21 — Fix font/color bridge tokens and a close-button label slot. `(fix: M3 font/color bridge tokens, Close button text slot, queue as MdListItem)`
**4.56.0** — 2026-06-21 — An app-wide Material 3 color/token bridge — themes now react everywhere at once. `(feat: app-wide Material 3 token bridge — theme-reactive across web suite, Shailos, DeskPhone)`
  *4.56.1* — 2026-06-21 — Give secondary and tertiary colors their own real identity. `(style: derive distinct M3 secondary + tertiary accents (was mirroring primary))`
  *4.56.2* — 2026-06-21 — Convert text/action/toolbar elements to the real component library. `(style: M3 Phase A (slice 1) — text/action/toolbar + small-file icon buttons to @material/web)`
  *4.56.3* — 2026-06-22 — NerveCenter's full-view cards now run on real Material components. `(style: NerveCenter full-view cards on genuine @material/web (M3 A+B+D slice))`
  *4.56.4* — 2026-06-22 — Tasks, Shailos, and Phone rows converted to real list components. `(style: Tasks, Shailos & Phone rows on genuine md-list-item (M3 Phase D cont.))`
  *4.56.5* — 2026-06-22 — Finish the NerveCenter conversion — boxes and accordion views done. `(style: finish NerveCenter M3 — boxes + accordion views on genuine @material/web)`
  *4.56.6* — 2026-06-22 — Restore button padding that a global CSS reset had wiped out. `(fix: restore M3 button padding clobbered by the global *{padding:0} reset)`
**4.57.0** — 2026-06-23 — Full-view NerveCenter gets a live Google Calendar daily timeline. `(feat: NerveCenter full-view — GCal daily timeline + account picker in card headers)`
**4.58.0** — 2026-06-23 — Calendar card gets the live timeline plus an agenda toggle. `(feat: calendar card-grid box gets the live-time timeline + agenda toggle)`
**4.59.0** — 2026-06-23 — Full-view calendar now shows both timeline and compact agenda at once. `(feat: full-view calendar card gets dual display — timeline + compact M3 agenda)`
  *4.59.1* — 2026-06-23 — Card-view agenda shows all-day events with a clear "now" divider. `(fix: card-view calendar agenda shows all-day events with NOW divider, not just upcoming)`
  *4.59.2* — 2026-06-24 — Vertical split layout for the full-view calendar; opaque event blocks. `(fix: NerveCenter full-view calendar — vertical split (2/3 timeline + 1/3 agenda) and opaque event blocks)`
  *4.59.3* — 2026-06-24 — Fix the calendar divider and a crash in the compact agenda. `(fix: calendar full-view M3 vertical divider, compact card agenda crash (cardListStyle undefined))`
  *4.59.4* — 2026-06-24 — Calendar loads from local midnight; a "Tomorrow" separator for next-day events. `(fix: calendar loads from local midnight, Tomorrow separator for next-day events)`
**4.60.0** — 2026-07-01 — A floating Bug Log widget for on-the-spot feedback. `(feat: floating Bug Log widget (Firestore users/{uid}/bugs))`
  *4.60.1* — 2026-07-01 — Cleaner feedback icon, anchored corner position for the bug-log button. `(fix: bug-log FAB — clean feedback icon, CSS-anchored corner position)`
**4.61.0** — 2026-07-01 — An experimental from-scratch Material 3 NerveCenter, behind a flag. `(feat: from-scratch Material 3 NerveCenter behind ?ui=next (4.32.106))`
  *4.61.1* — 2026-07-01 — Bug-log becomes a draggable panel with its own rail item. `(fix: bug-log panel — draggable non-modal card, rail item, left FAB)`
  *4.61.2* — 2026-07-01 — Add a close button and resizing to the bug-log panel. `(fix: bug-log panel — close button and resizability)`
  *4.61.3* — 2026-07-01 — NerveCenter fits on one screen — no page scrolling. `(fix: NerveCenter at-a-glance — single-screen dashboard, no page scroll (4.32.109))`
  *4.61.4* — 2026-07-01 — Denser row spacing for the bug-log list. `(style: bug-log list — M3 dense-row density for entries)`
**4.62.0** — 2026-07-01 — The experimental NerveCenter becomes a full-fidelity, re-skinned fork of the real one. `(feat: ?ui=next NerveCenter = full-fidelity fork of the real panel, re-skinned (4.32.111))`
  *4.62.1* — 2026-07-01 — A proper header/type/shape system for the experimental NerveCenter. `(style: M3 header/type/shape system for ?ui=next NerveCenter (4.32.112))`
  *4.62.2* — 2026-07-02 — Real depth and consistent spacing rhythm in the experimental view. `(style: ?ui=next — real tonal depth + M3 16px gutter rhythm (4.32.113))`
**4.63.0** — 2026-07-02 — A batch of owner-reported fixes — humanized phone status, working reconnect, text retry/copy/reply, simplified priorities. `(feat: ticket batch — phone status humanized, one working reconnect, text retry/copy/inline-reply, 1/2/3 priorities, stale nudge removed (4.33.113))`
  *4.63.1* — 2026-07-03 — Priority labels now survive a sync; the open-DeskPhone button is actually visible. `(fix: 1/2/3 labels survive Firestore sync, open-DeskPhone button actually visible, /show via relay (4.33.114))`
**4.64.0** — 2026-07-03 — Phone commands now travel over a push channel instead of polling — zero idle reads. `(feat: phone commands via Realtime Database push — zero idle reads (pairs with DeskPhone b326))`
  *4.64.1* — 2026-07-06 — Google sign-in always shows the account picker; popup-first on mobile. `(fix: Google sign-in always shows the account picker; popup-first on mobile (4.34.115))`
  *4.64.2* — 2026-07-06 — A bug-log triage pass — card polish, checkmarks, pinned missed calls, a working reader tool. `(fix: bug-log triage pass — queue card radius, queue chip, checkmark adds, pinned missed calls, working buglog reader (4.34.115))`
  *4.64.3* — 2026-07-06 — A big batch: card unification, calendar improvements, AI bug-log summaries with resolve notes, better email attribution. `(fix: bug-log batch 7/6 — GM3 card unification + accordion retired + header row reclaim (ui=next), calendar drops yesterday + now-in-top-third + agenda inset panel, buglog AI summaries + click-to-expand history + resolve-with-note tool, email summary attribution accuracy (4.34.116))`
  *4.64.4* — 2026-07-06 — Tonal card styling and layout fixes across the card-grid view. `(fix: GM3 follow-up — card-grid tonal cards + gutters, column-view header row floated to margin, 100dvh bottom-cut fix (4.34.117))`
  *4.64.5* — 2026-07-06 — Email wrapping, solid calendar time blocks, accent bars, task-river width fix. `(fix: bug-log batch — email summaries wrap to 2 lines everywhere, GCal-mobile solid timeblocks in live view, agenda vertical accent bars, compact mode keeps font size (spacing only), TaskRiver max-width (4.34.118))`
**4.65.0** — 2026-07-06 — Every phone host now verifies real sign-in before pairing — Android host b2 joins. `(feat: host-API Google-account pairing gate — Android/Windows hosts verify Firebase ID token, web pairs silently, iPad bridge forwards auth headers; Android host b2 (4.35.118))`
  *4.65.1* — 2026-07-06 — Multi-host phone discovery — the system picks whichever host actually holds the Bluetooth link. `(fix: multi-host phone discovery — Firestore host registry + best-host picker (prefers the host holding the BT link), DeskPhone LAN proxy for HTTPS pages, no-wipe transient failover, Android host b3 rejects forwarded requests (4.35.119))`
  *4.65.2* — 2026-07-06 — Card anchoring fix, adaptive layout icons, better mail/text hierarchy, simplified phone controls. `(fix: buglog batch — card-grid bottom:0 anchoring (taskbar overrun), layout icons unreversed + width-adaptive column/rows icon, mail+texts body-first type hierarchy, true row-height task autofill + deeper phone feed, phone connection controls simplified (one reconnect, host-aware pill, clear menu copy) (4.35.120))`
  *4.65.3* — 2026-07-06 — Whichever device holds the phone now feeds the relay — new Android relay client, arbitration logic on both hosts. `(fix: relay fed by whichever host holds the phone — Android b4 RelayClient (Firestore push + RTDB command drain, connection-gated), DeskPhone b327 relay arbitration (farewell push + silent when parked), web back to simple loopback-or-cloud with one read-only status pill (4.35.121))`
  *4.65.4* — 2026-07-07 — Simplify the phone-link UI around the tablet host. `(fix: simplify phone link UI around tablet host)`
**4.66.0** — 2026-07-07 — The full phone screen now speaks the cloud relay directly; the new NerveCenter becomes default. `(feat: full phone screen speaks the cloud relay + NerveCenterNext is now default UI)`
  *4.66.1* — 2026-07-07 — Bug-log entries become editable inline, with automatic AI re-summary. `(fix: buglog entries are now editable — Edit text in the row menu opens inline edit, rewrites b.text and clears the stale AI summary for re-summary (4.35.124))`
**4.67.0** — 2026-07-07 — Tablet becomes the primary phone host, PC standby — fixes iPad connect/disconnect flapping. `(feat: phone-link owner-doc arbitration — tablet primary, PC standby, menu-rail takeover toggle; fixes iPad connect/disconnect flapping (4.36.124))`
  *4.67.1* — 2026-07-10 — Instant text echoes while sending; fix duplicate-send bugs across web, Windows, and Android. `(fix: phone-link ticket batch — instant SMS echoes in every composer, stuck send-double fixes (web collapse + Windows 15-min skew window + Android tolerant body match), honest stale-data status line, compact M3 rail host toggle with handoff feedback (4.36.125))`
**4.68.0** — 2026-07-10 — A single shared state machine now drives phone-link on both surfaces — no more drift between them. `(feat: phone-link one-truth overhaul — shared state machine both surfaces derive from, exact client-message-id (cid) send reconciliation through both hosts, status-flip repaint fix, never-blank feeds, ?phonediag=1 overlay, committed test suite (4.37.125))`
  *4.68.1* — 2026-07-10 — Fix an app-wide crash from a value that was exported but never actually imported. `(fix: phone-host-control crashed the whole app — OWNER_LIVE_WINDOW_MS was re-exported but never imported (4.37.126))`
**4.69.0** — 2026-07-10 — Handing off phone control now moves the actual Bluetooth link with it. `(feat: phone handoff now moves the Bluetooth link + M3 segmented host control (4.38.126, hosts b330/b6))`
**4.70.0** — 2026-07-10 — The AI gateway now accepts sign-ins from the separate RabbiMetrics app too. `(feat: ai-proxy gateway accepts RabbiMetrics clients — rabbi-s-metrics ID tokens + rabbimetrics origins (4.39.126))`
  *4.70.1* — 2026-07-10 — Fix a CORS preflight rejection on the AI gateway's auth header. `(fix: ai-proxy CORS preflight now approves the Authorization header (4.39.127))`
**4.71.0** — 2026-07-12 — The web phone goes cloud-only, with confirmed takeover on every host. `(feat: cloud-only web phone + confirmed takeover on both hosts + per-build Android icon (4.40.127, hosts b331/b7))`
**4.72.0** — 2026-07-12 — Host-switch button blinks until the switch is confirmed; fix a stale "can't reach" banner. `(feat: host-switch blink-until-confirmed + stale "can't reach" banner fix (4.41.127))`
  *4.72.1* — 2026-07-12 — An efficiency pass on the Bluetooth message sync — adaptive polling, fewer wasted scans. `(fix: MAP/OBEX efficiency pass — adaptive poll + parked navigation + merged sweeps (4.41.128, host b332))`
  *4.72.2* — 2026-07-12 — Empty push notifications now correctly trigger a sync instead of being ignored. `(fix: empty MNS event reports now prove push + trigger sync; delete-reconcile bounded to phone window span (4.41.129, host b333))`
  *4.72.3* — 2026-07-12 — Stop a pause message from logging three times a second. `(fix: history-loader pause logged once per pause, not 3x/sec (4.41.130, host b334))`
  *4.72.4* — 2026-07-12 — Same empty-push-triggers-sync fix, applied to the Android host. `(fix: Android host b8 — empty MNS event reports now trigger an instant sync (4.41.131))`
**4.73.0** — 2026-07-12 — A pre-production deep pass — design sweep, ticket batch, and multi-user account rules. `(feat: pre-production deep pass — GM3 sweep, ticket batch, multi-user rules (4.42.131))`
  *4.73.1* — 2026-07-13 — Polling only relaxes once the push channel is confirmed open, not on the first event. `(fix: poll relaxes on MNS channel open, not first event (4.42.132, host b335))`
**4.74.0** — 2026-07-13 — Shailos becomes fully native — no more embedded iframe. `(feat: Shailos goes native — full in-app integration, pure GM3, iframe retired (4.43.132))`
**4.75.0** — 2026-07-13 — Three-lane phone link (iPad, active tab, PC) with an auto-finder and live call recording. `(feat: three-lane phone link (iPad/ActiveTab/PC) + auto-finder + live call-feed record (4.44.132))`
**4.76.0** — 2026-07-14 — A large ticket batch: a Sefaria research fallback, two-button Shaila dictation, More-Actions menu, missed-call fix, a car-kit lane. `(feat: ticket batch — Sefaria research fallback, two-button shaila dictation, column expand, More-Actions + dead screen retired, dated inbox merge, missed-call HFP fix, car-kit lane (4.45.132))`
  *4.76.1* — 2026-07-14 — The Sefaria fallback needed more tolerance — exact phrase matching was defeating real queries. `(fix: Sefaria research fallback needs slop — phrase window defeated real queries (4.45.133))`
  *4.76.2* — 2026-07-13 — An evening batch: the iPad lane is retired, picker icons fixed, iOS sign-in fixed. `(fix: evening ticket batch — iPad lane retired, picker state icons, iOS PWA sign-in, box toolbars, NC snooze (4.45.134))`
  *4.76.3* — 2026-07-13 — "No results" from research is now an honest AI judgment call, not a silent failure. `(fix: research no-results was an AI judgment call, not a failure (4.45.135))`
  *4.76.4* — 2026-07-14 — Calendar/Mail toolbar merges into the card header on tablets. `(fix: tablet-mode Calendar/Mail toolbar merges into the card header row (4.45.136))`
  *4.76.5* — 2026-07-14 — The host-switcher survives the handoff gap; research now honestly flags when it only checked Sefaria. `(fix: host-switcher pending state survives the handoff gap; research honestly flags Sefaria-only coverage (4.45.137))`

---

## Also explored, never merged

- **Pro 5 ground-up rebuild** (branches `pro5-rebuild` / `pro5-rescue-342284e`, started
  2026-06-28) — an attempt to port a "Focus app" concept from scratch, including a more
  faithful version of the Task River idea that had already shipped in Pro 4 eighteen days
  earlier (see `4.40.0`). The rebuild stalled and was never merged; a scheduled task to resume
  it (`shamash-pro5-resume`) fired once on 2026-06-28 and was never re-enabled.
- **The `sofer.ai` API experiment** (2026-02-18) — the very first prototype tried wiring in a
  religious-text API and left a note admitting it "wasn't working yet." Never revisited since,
  even as the app's AI tooling matured substantially — might be worth a fresh look now.

---

## The versioning rule behind these numbers

`major.minor.patch`. Major only changes when the owner declares a new product generation
(currently `4`, unchanged since the Pro 4 cutover). Minor increments — and **resets patch to
zero** — on every feature release. Patch increments on every fix/polish release since the last
feature. Full policy in [`CLAUDE.md`](CLAUDE.md).

**Current version: 4.76.5**
