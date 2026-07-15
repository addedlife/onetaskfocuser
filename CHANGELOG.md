# Shamash — Version History

A day-by-day account of everything behind the app you use today, going all the way back to
the first prototype file. Every line follows the same shape:

- **Bold version number** (date) — a plain-English sentence, then the original
  developer-facing commit message in *(italic parentheses)*.
- Fixes/polish are nested under the feature release they followed, as sub-bullets.

Reconstructed 2026-07-15 by replaying the full commit history through the versioning rule in
[`CLAUDE.md`](CLAUDE.md). The earliest stretch (before git existed) has no commits to replay —
those entries are simulated from file timestamps instead, and are marked *(inferred)* rather
than quoting a commit. Two more product generations were attempted along the way — a
from-scratch rewrite and a consolidation plan — and neither one shipped; they're called out in
place below, because a few of their ideas are genuinely worth a second look.

---

## 💡 Ideas worth a second look

Three things got explored, shelved, and — in one case — already proven worth resurrecting:

- **A native iPad phone bridge, already built once.** A full Swift/Xcode app called
  `WebPhoneBridge` was built during the Pro 3 era and then abandoned in favor of a web-based
  iPad connection. The current app has since added a dedicated iPad lane (`4.75.0`) and
  retired it again the same week (`4.76.2`) because it wasn't working well enough. Worth
  pulling this native bridge back out to see what it solved that the web approach still
  doesn't.
- **Rabbi Dashboard's proper package architecture.** The abandoned greenfield rewrite split
  the app into separate folders for core logic, business rules, integrations, and UI, instead
  of one growing pile of files. Not worth a rewrite to get — but worth reading the next time a
  file like `10-deskphone-web.jsx` (238KB and growing) gets touched.
- **There's a "faithful" Task River sitting in an abandoned branch.** The Task River feature
  shipped in Pro 4 on `4.40.0`. Eighteen days later, the abandoned Pro 5 rebuild attempted a
  full rewrite of the same feature, explicitly calling the shipped version "invented lanes"
  and porting a more complete design from an original "Focus app" source. That more faithful
  version never made it back into the live app — it's still sitting on the `pro5-rebuild`
  branch, unused.

---

## v0 — Prehistory (before git, before a name)

No commits exist for this stretch — nothing was tracked yet. These entries are **reconstructed
from file timestamps and filenames** found on disk, not from commit messages, and are marked
*(inferred)* for that reason. Dates for the middle cluster (the deploy-round era) are
approximate — exact day-by-day timestamps weren't preserved.

- **0.1.0** (2026-02-16) — The very first prototype file gets written, by hand, late at
  night. *(inferred from file: "claude opus 4.6 OneTask App.html")*
- **0.2.0** (2026-02-16) — Same night, a full second attempt already replaces it.
  *(inferred from file: "OneTaskOnly v2.html")*
- **0.3.0** (2026-02-17) — A new naming habit begins — "vC" for version-candidate.
  *(inferred from file: "OneTask App vC03.html")*
  - *0.3.1* (2026-02-18) — A small revision to that build. *(inferred from file: "vC03.1.html")*
  - *0.3.2* (2026-02-18) — An experimental hookup to a religious-text API — and it doesn't
    work yet. A note left behind says so directly: "not working yet I don't think, second
    try." *(inferred from file: "vC03.1.1 sofer.ai api.html")*
- **0.4.0** (2026-02-18) — Next build, same day. *(inferred from file: "vC04.html")*
- **0.5.0** (2026-02-18) — Another build, same day again — this is a fast-moving night.
  *(inferred from file: "vC05.html")*
- **0.6.0** (2026-02-22) — The first real deployment goes out — no longer just a file on a
  laptop, now something that can be opened in a browser by anyone with the link.
  *(inferred from file: "onetaskonly-deploy")*
  - *0.6.1* (2026-02-22) — A quick second deploy right after. *(inferred from file: "onetaskonly-deploy-v2")*
- **0.7.0** (~late Feb 2026) — A new deploy round begins. *(inferred from file: "round1")*
  - *0.7.1* (~late Feb 2026) — A follow-up patch to that round. *(inferred from file: "round1b")*
- **0.8.0** (~late Feb 2026) — A second full deploy round. *(inferred from file: "round2")*
- **0.9.0** (~early Mar 2026) — Version 3 of the deploy. *(inferred from file: "v3")*
  - *0.9.1* (~early Mar 2026) — A visual overhaul pass. *(inferred from file: "v3-overhaul")*
  - *0.9.2* (~early Mar 2026) — A contrast/readability fix. *(inferred from file: "v3-contrast-fixed")*
  - *0.9.3* (2026-03-05) — General fixes to round out v3. *(inferred from file: "v3-fixed")*
- **0.10.0** (~2026-03-15) — The project grows up: it gets a real name ("taskmanager app"),
  regular backups, and a running list of planned features instead of ad-hoc file edits.
  *(inferred from folder: "taskmanager app" + "Glitches and Upgrade ideas log.txt")*

---

## v1 — OneTaskFocuser / Switchboard (2026-03-20 → 2026-05-10)

- **1.0.0** (2026-03-20) — The project's first tracked commit — everything below is real,
  numbered history from here on, not a reconstruction. *(Initial commit: OneTaskFocuser as
  currently deployed)*
- **1.1.0** (2026-03-26) — Shaila questions now track who owes a reply, with status icons,
  sorting, and grouped follow-up tasks. *(feat: add gotBackToAsker tracking, 3-state status
  icons, sort, and subtask groups for shaila tasks)*
- **1.2.0** (2026-03-26) — The same "who owes a reply" status comes to the Shailos panel too.
  *(feat: add got_back 3-state status to shailos bundle UI)*
- **1.3.0** (2026-03-26) — The Shaila transcriber becomes a real embedded panel instead of a
  loose add-on. *(feat: full Shaila Transcriber integration — postMessage theme sync,
  lazy-persistent iframe, _taskAppSource dedup guard)*
- **1.4.0** (2026-03-26) — Switch to stronger AI models; the Shaila manager gets real status
  tracking and tighter security. *(feat: AI to Sonnet+Gemini2.5Pro with Yeshivish,
  ShailaManager status/got-back/manual-add, CORS+security)*
  - *1.4.1* (2026-03-26) — Fix a regression that had broken the AI proxy. *(fix: restore
    utility files and repair netlify/claude proxy regressions)*
- **1.5.0** (2026-03-26) — Switch AI models again; add confetti and sound to the Shaila
  manager. *(feat: AI to claude-sonnet-4-5+gemini-2.5-pro, Yeshivish CORS, ShailaManager
  manual-add/confetti/audio)*
- **1.6.0** (2026-03-26) — Add a status filter (Pending / Answered / Got back). *(feat: add
  status filter to ShailaManager (Pending/Answered/Got back))*
- **1.7.0** (2026-03-27) — A bigger "got back" pill; rename "answered" to "got answer."
  *(feat(shaila): large got-back pill, rename answered→got answer, update filters)*
- **1.8.0** (2026-03-27) — Work now auto-backs-up when you sign out or close the window.
  *(feat: auto-backup on sign-out and window close)*
- **1.9.0** (2026-03-27) — A "save & close" button; tasks and Shailos now back up together in
  one file. *(feat: save & close button, combined backup (tasks + shailos in one JSON))*
- **1.10.0** (2026-03-29) — Switch to a modern build system for faster development. *(feat:
  migrate to Vite build system)*
  - *1.10.1* (2026-03-29) — Fix a white screen caused by missing code after the build switch.
    *(Fix: add missing imports (callAI, PALETTE, db, _lum, priText, textOnPastel) - fixes
    white screen)*
  - *1.10.2* (2026-03-29) — More missing pieces from the same build switch, fixed. *(Fix: add
    missing React hooks (useMemo, useCallback, useRef) and textOnColor import)*
  - *1.10.3* (2026-03-29) — Same cleanup, a third round. *(Fix: add missing component imports
    (Ripple, Confetti, AutoFitText, BlockedBadge, TabBtn) to 08-app)*
- **1.11.0** (2026-03-29) — A full overhaul of how Shaila items are shown and sorted in the
  queue. *(feat: ShailaMiniPill in queue+ShailaManager overhaul (statuses/sort/manual-entry/
  got-back pills/numbering))*
  - *1.11.1* (2026-03-30) — Fix Google sign-in being blocked inside the embedded panel. *(fix:
    allow popups in shailos iframe for Google sign-in)*
- **1.12.0** (2026-03-30) — Upgrade the AI model everywhere; polish the Shaila screen. *(feat:
  gemini-3.1-pro-preview everywhere + shaila UI fixes)*
- **1.13.0** (2026-03-31) — A universal "record anything" button, wired into the phone screen.
  *(feat: Universal Conversation Recorder + wire phone FAB)*
  - *1.13.1* (2026-03-31) — Switch the research assistant to a faster model with live search.
    *(fix: shaila researcher — use gemini-2.0-flash + googleSearch tool)*
- **1.14.0** (2026-03-31) — Answered Shaila cases now show a short summary of the answer.
  *(feat: answer synopsis on answered/got-back shaila pills)*
  - *1.14.1* (2026-03-31) — Fix a duplicate piece of code that had broken the build. *(fix:
    remove duplicate export of webmToWavBase64 (build was broken))*
  - *1.14.2* (2026-03-31) — Fix button wiring and improve how phone recordings get recognized
    as Shaila questions. *(fix: correct button wiring, callMode for phone capture, stronger
    shaila detection)*
- **1.15.0** (2026-03-31) — Add a short answer preview to the transcriber's mini-cards.
  *(feat: answer snippet on shailos transcriber minicards)*
  - *1.15.1* (2026-03-31) — Make the preview smarter — the first real clause, not just the
    first three words. *(fix: smarter answer snippet — first meaningful clause, not just
    first 3 words)*
  - *1.15.2* (2026-03-31) — Switch back to the stronger AI model for research; refine the
    preview again. *(fix: research back to gemini-3.1-pro-preview + smarter answer snippet)*
  - *1.15.3* (2026-03-31) — The Shailos "record call" button now uses the same recorder as the
    main app. *(fix: shailos Record Call button → delegates to main app ConvCapture)*
  - *1.15.4* (2026-03-31) — Same fix, delivered a more reliable way. *(fix: shailos Record
    Call delegates to parent ConvCapture via postMessage)*
  - *1.15.5* (2026-03-31) — Tune the AI so it summarizes conversations more consistently.
    *(fix: aiParseConversation uses temperature 0.1 + 8192 tokens)*
  - *1.15.6* (2026-03-31) — Cap the answer preview to 6 words, one line. *(fix: answer snippet
    = first 6 words, single line enforced)*
  - *1.15.7* (2026-03-31) — Same cap, plus stop it from wrapping onto a second line. *(fix:
    answer snippet first 6 words + whitespace-nowrap in transcriber minicards)*
- **1.16.0** (2026-03-31) — AI now writes a 6-word summary of every Shaila answer
  automatically. *(feat: AI-generated 6-word answer summary for shaila pills)*
- **1.17.0** (2026-03-31) — That same AI summary now shows on the transcriber mini-cards too.
  *(feat: AI answer summary in shailos transcriber minicards)*
- **1.18.0** (2026-04-05) — The project handoff notes now update themselves automatically with
  every save. *(feat: add auto-updating HANDOFF.md via pre-commit hook)*
  - *1.18.1* (2026-04-05) — Research gets background tracking and auto-scrolling
    improvements. *(fix: shailos research — google_search tool, background tracking,
    selectedShaila sync, auto-scroll, synopsis regeneration)*
  - *1.18.2* (2026-04-05) — Switch research to a model that actually supports live web
    search. *(fix: research model → gemini-2.0-flash (supports google_search grounding);
    guard empty response)*
  - *1.18.3* (2026-04-05) — Switch again — the first model choice didn't work out. *(fix:
    research model → gemini-3.1-flash-preview for google_search grounding)*
  - *1.18.4* (2026-04-05) — Drop live web search (it kept hanging) — research now relies on
    the AI's own knowledge with strict citation rules instead. *(fix: research — drop
    google_search tool (hangs on 3.1-pro), use model knowledge with strong citation prompt)*
- **1.19.0** (2026-04-05) — Research gets real web search back, with actual source links this
  time. *(feat: research via gemini-3-flash-preview + google_search grounding — real source
  URLs)*
- **1.20.0** (2026-04-05) — Switch research to a dedicated Google search service instead of
  the AI's built-in search. *(feat: research via Serper.dev real Google search + Gemini
  summarization — no grounding tool)*
- **1.21.0** (2026-04-05) — Research now links out to Sefaria for any Jewish text it
  mentions. *(feat: research adds Sefaria links for seforim mentioned in articles)*
  - *1.21.1* (2026-04-05) — The AI now cleans up a Yeshivish-phrased question into a proper
    search query before searching. *(fix: research — Gemini converts Yeshivish shaila to
    clean Google search query before searching)*
- **1.22.0** (2026-04-05) — Clicking a research link now jumps straight to the relevant
  paragraph on the page, instead of the top. *(feat: article links scroll to relevant section
  via Text Fragment API)*
  - *1.22.1* (2026-04-05) — Research now favors known kosher-authority websites. *(fix:
    research targets kosher sites (star-k, ou, crc, halachipedia) — strips brand names from
    query)*
  - *1.22.2* (2026-04-05) — Reverse part of that — brand names stay in the search after all.
    *(fix: keep brand names in search query — site restrictions already prevent going to
    brand sites)*
  - *1.22.3* (2026-04-05) — Drop the site restrictions entirely — better search terms alone
    find the right sites. *(fix: drop site: restrictions — let Google rank halachic sites
    naturally via better query terms)*
  - *1.22.4* (2026-04-05) — Skip PDF results; make the jump-to-paragraph links more reliable.
    *(fix: filter PDF links, shorten text fragments to 1-3 word key terms for reliable page
    scrolling)*
  - *1.22.5* (2026-04-05) — A research overhaul — search multiple angles at once, on a
    corrected model. *(fix: research overhaul — parallel multi-query search + correct Gemini
    model)*
  - *1.22.6* (2026-04-05) — Revert to the strongest available AI model for research. *(fix:
    revert model to gemini-3.1-pro-preview (current Google top model April 2026))*
  - *1.22.7* (2026-04-05) — Clean up the AI plumbing — one shared setting for which model to
    use, instead of scattered copies. *(fix: unified AI pipeline — single GEMINI_MODEL
    constant, callGeminiAudio helper, eliminate scattered raw fetches)*
  - *1.22.8* (2026-04-05) — Route AI requests through the server so a personal API key never
    has to sit in the browser. *(fix: route text AI calls through gemini-proxy when no
    personal key — server key never leaves browser)*
  - *1.22.9* (2026-04-05) — A deleted priority option ("home") stops reappearing in menus.
    *(fix: filter deleted priorities at pris source — removes home from all pickers and
    insights)*
  - *1.22.10* (2026-04-05) — Same "home" priority, stripped out more thoroughly. *(fix: strip
    home priority from array on every load — survives Firebase round-trips)*
  - *1.22.11* (2026-04-05) — Finally root the "home" priority out for good, at the database
    level. *(fix: root out home priority — direct Firestore patch + block restoration via
    _listenV5)*
- **1.23.0** (2026-05-04) — Google Calendar and Gmail cards appear on the launchpad screen
  for the first time. *(feat: Google Calendar + Gmail nervecenter cards on launchpad)*
- **1.24.0** (2026-05-04) — Those Google cards move to NerveCenter, which becomes the app's
  new default home screen; a changelog is started (an earlier one than this document).
  *(feat: Google cards on NerveCenter, default home to NerveCenter, CHANGELOG)*
  - *1.24.1* (2026-05-04) — Fix Google Calendar and Gmail data not loading after connecting.
    *(fix: Google Calendar + Gmail data not loading after connect)*
  - *1.24.2* (2026-05-04) — NerveCenter now fits one screen; the Google section scrolls on
    its own. *(fix: NerveCenter single-screen layout, Google strip with internal scroll)*
- **1.25.0** through **1.46.0** (2026-05-06) — A sixteen-part push to bring the browser
  version of DeskPhone (the phone companion) up to full feature parity with the native
  Windows app: call-history filters, call-row actions, the dialer, text handoff, dialpad,
  Google sync, settings, search, developer tools, new-message handling, contact sync,
  appearance toggles, the full calls list, the compose screen, pinned messages, message
  deletion, device settings, and undo — one feature landing after another, same day. *(feat:
  DeskPhone web call-history parity filters / call-row parity actions / thread-side dialer
  parity / dialer text handoff / thread-side dialpad keys / Google persistence, iPhone fix,
  Cal+Gmail actions, phone split, sidebar UX / settings host tools / thread search navigation
  / row action parity / developer host tools / new message handoff / settings section parity
  / contact sync host tools / appearance setting toggles / full calls pane / compose surface /
  call and build prompt parity / pinned message parity / message delete parity / device
  settings parity / contact and call undo parity / complete attachment parity)*
  - *1.40.1* (2026-05-06) — Restore the side rail's auto-collapse behavior, lost somewhere in
    the parity push. *(fix: restore rail auto collapse timers)*
  - *1.46.1* (2026-05-07) — Wire up the parity buttons so they actually work in the browser.
    *(fix(deskphone-web): wire parity buttons in browser)*
  - *1.46.2* (2026-05-07) — A visual cleanup pass on the browser DeskPhone screen. *(style:
    apply GV-clean DeskPhone web pass)*
  - *1.46.3* (2026-05-07) — Match NerveCenter and WebPhone's appearance settings. *(style:
    sync NerveCenter and WebPhone appearance)*
  - *1.46.4* (2026-05-07) — Call-history rows now show a real contact name or number instead
    of a blank. *(Fix: show contact name or number in call history rows)*

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

- **4.0.0** (2026-05-10) — The Pro 4 cutover: OneTaskFocuser, Shailos, and the DeskPhone
  Windows bridge are physically merged into one clean workspace. *(Initialize Shamash Pro 4
  clean workspace)*
  - *4.0.1* (2026-05-11) — Fix a blank gap in the NerveCenter task pane. *(fix: collapse
    nervecenter task pane blank area)*
  - *4.0.2* (2026-05-12) — Add a swipeable carousel for NerveCenter on Android/mobile. *(fix:
    swipeable panel carousel for Android/mobile NerveCenter)*
  - *4.0.3* (2026-05-12) — Smoother swipe-snapping; fix content overflow in landscape. *(fix:
    CSS scroll-snap carousel for NerveCenter + landscape overflow)*
  - *4.0.4* (2026-05-12) — Same carousel/overflow fix, refined further. *(fix: CSS scroll-snap
    carousel for NerveCenter + landscape overflow)*
  - *4.0.5* (2026-05-12) — A full-screen card carousel with proper swipe handling. *(fix:
    full-screen stacked carousel + touch-action for swipe-on-cards)*
  - *4.0.6* (2026-05-12) — Drop panel headers on phone screens for a content-first look.
    *(fix: headerless NerveCenter panels on phone (content-first layout))*
  - *4.0.7* (2026-05-18) — Merge phone message threads by contact instead of by number. *(fix:
    merge nervecenter phone threads by contact)*
  - *4.0.8* (2026-05-19) — Stabilize the browser DeskPhone's sync and call controls. *(fix:
    stabilize deskphone web sync and call controls)*
  - *4.0.9* (2026-05-19) — Keep expanded message threads from jumping around. *(fix: anchor
    nervecenter expanded threads)*
  - *4.0.10* (2026-05-19) — Clearer phone-history dates; expanded threads now close properly.
    *(fix: clarify phone history dates and close expanded threads)*
  - *4.0.11* (2026-05-19) — Remove a cluttered thread-count number that wasn't useful. *(fix:
    remove nervecenter collapsed thread counts)*
  - *4.0.12* (2026-05-19) — Stop a backup file from downloading itself on every page reload.
    *(fix: stop backup downloads on reload)*
  - *4.0.13* (2026-05-19) — Keep you signed in to Google Workspace and remember your contrast
    theme choice. *(fix: persist google workspace auth and contrast themes)*
  - *4.0.14* (2026-05-19) — Make the phone-thread action buttons float in place. *(fix: float
    nervecenter thread actions)*
  - *4.0.15* (2026-05-19) — Improve readability of the DeskPhone theme. *(fix: harden
    deskphone theme contrast)*
  - *4.0.16* (2026-05-20) — Fix hard-to-read rows in the task queue. *(fix: repair queue
    pastel row contrast)*
  - *4.0.17* (2026-05-20) — Keep you signed in longer; stop over-eager Google reconnect
    attempts. *(fix: persist auth sessions and throttle google reconnect)*
- **4.1.0** (2026-05-20) — Add the "chief briefing" — a daily overview card — to NerveCenter.
  *(feat: add nervecenter chief briefing)*
- **4.2.0** (2026-05-20) — That briefing now syncs across devices; background scans slow down
  to save resources. *(feat: add chief cloud profile and throttle scans)*
  - *4.2.1* (2026-05-21) — Make the phone-sync system more reliable and require you to be
    signed in to see phone data. *(fix(relay): migrate to Firestore REST API + gate phone
    data behind Firebase auth)*
- **4.3.0** (2026-05-21) — Replace emoji with real icons; modernize dialog boxes across the
  app. *(feat(ui): State cleanup, emoji→Material Symbols, dialog modernization (Tiers 1-3
  partial))*
  - *4.3.1* (2026-05-21) — Remove a leftover hardcoded number from an error message. *(fix:
    remove hardcoded build number from relay error message)*
  - *4.3.2* (2026-05-21) — Fix broken colors and the DeskPhone "delete calls" dialog. *(fix(ui):
    repair broken color tokens and DeskPhone delete-calls dialog)*
  - *4.3.3* (2026-05-21) — Fix a bug where the phone sync wouldn't refresh for the right
    user. *(fix(relay): add user to refresh useCallback dep array)*
- **4.4.0** (2026-05-21) — Add smoother motion, hover feedback, and shadow depth throughout
  the app for a more cohesive feel. *(feat(ui): motion, interaction & elevation systems for
  cohesive polish)*
- **4.5.0** (2026-05-21) — Unify icons, text sizing, and spacing across every screen. *(feat(ui):
  unify icons, type scale, and spacing rhythm)*
  - *4.5.1* (2026-05-25) — Fall back to data saved on this device if the cloud comes back
    empty after an outage. *(fix(app): load localStorage when Firebase is empty after rules
    outage)*
- **4.6.0** (2026-05-25) — A new centered clock design with the time split from the seconds.
  *(feat(nervecenter): designer clock — centered, split H:MM / seconds)*
- **4.7.0** (2026-05-25) — Restore the menu button on the task screen; move settings to the
  left. *(feat(ui): restore hamburger menu on task screen; left-anchor settings panel)*
- **4.8.0** (2026-05-25) — Remove the page header; the clock now sits between Calendar and
  Gmail. *(feat(nervecenter): remove header, designer clock card between Calendar/Gmail)*
- **4.9.0** (2026-05-25) — A bolder clock card with a new tab style. *(feat(nervecenter):
  pill-to-arrow tab + bolder clock card)*
  - *4.9.1* (2026-05-25) — Fix completed items overlapping and getting cut off. *(fix(ui):
    completed stack — no overlap, no sidebar clip, show all entries)*
- **4.10.0** (2026-05-25) — A snazzier clock card with a cleaner date display. *(feat(nervecenter):
  snazzier clock card — accent cap, AM/PM split, compact date)*
- **4.11.0** (2026-05-25) — Right-click the clock to choose from 5 different designs. *(feat(nervecenter):
  right-click clock style picker — 5 designs)*
  - *4.11.1* (2026-05-25) — Fix a sticky-note that could grow too large; tap outside the menu
    to close it. *(fix(ui): constrain PostIt container size; add hamburger backdrop dismiss)*
  - *4.11.2* (2026-05-25) — Fix a missing security key that was breaking phone sync. *(fix(relay):
    add missing API key to Firestore auth reads; map 401/403 relay errors specifically)*
  - *4.11.3* (2026-05-25) — Enter sends a text message; Ctrl+Enter adds a line break instead.
    *(fix(deskphone): Enter sends message, Ctrl+Enter inserts newline)*
- **4.12.0** (2026-05-25) — Three new clock designs, plus a fix for hard-to-read task text.
  *(feat(clock): 3 new faces, seconds bar, analog digital sub-display; fix task text contrast)*
  - *4.12.1* (2026-05-25) — Small clock and color polish. *(fix(ui): shaila color, flat M3
    circles, smooth secbar, clock polish)*
- **4.13.0** (2026-05-25) — A timeline-style clock face; richer email summaries. *(feat(clock):
  timeline face + smooth secBar; richer email summaries)*
  - *4.13.1* (2026-05-25) — Smoother clock animation; tighter email summaries. *(fix(clock+email):
    true 60fps sweep, late fade, email clamp+voice prompt)*
- **4.14.0** (2026-05-25) — The timeline clock adds a Hebrew month label and an analog second
  hand. *(feat(clock): timeline addon, Hebrew month label, analog second hand)*
- **4.15.0** (2026-05-25) — A new Health section, backed by its own cloud storage. *(feat(health):
  Health Card + Health Page with Firebase backend)*
- **4.16.0** (2026-05-25) — Connect real Google Health data. *(feat(health): Google Health API
  integration + minimal NC card)*
  - *4.16.1* (2026-05-25) — Always show the account picker when connecting Google Health.
    *(fix(health): always show Google account picker on OAuth connect)*
  - *4.16.2* (2026-05-25) — Fix a white-screen crash in the Health connect flow. *(fix: move
    Health OAuth useEffect above !AS guard to fix hooks-order white screen)*
  - *4.16.3* (2026-05-25) — Health couldn't actually be opened from the menu — now it can.
    *(fix(health): add Health section to switchboard rail menu so it can be opened)*
  - *4.16.4* (2026-05-25) — Same fix, applied properly this time. *(fix(health): actually add
    health button to sidebar rail and NC action palette)*
  - *4.16.5* (2026-05-25) — Clean up the Health connect flow; Google Health is now the main
    source. *(fix(health): clean connect flow, real isDemo, Google Health as primary)*
- **4.17.0** (2026-06-02) — Record system audio directly; add a Hebrew date row to the
  timeline. *(feat(web): system-audio source for Record Anything + Hebrew day-of-month
  timeline row)*
- **4.18.0** (2026-06-02) — Reorder the timeline for a more natural reading flow. *(feat(web):
  reorder timeline rows — Sivan → 5786 → Jun → 2026)*
- **4.19.0** (2026-06-02) — Research citations now show clean, named source links. *(feat(shailos):
  clean bullet sources with named attribution links)*
- **4.20.0** (2026-06-02) — Research reports get a cleaner two-line format with no repeated
  text. *(feat(shailos): research report — two-line bullets, no redundancy, clean dividers)*
  - *4.20.1* (2026-06-02) — Stricter relevance filtering; cap results at 8. *(fix(shailos):
    aggressive relevance filter, no source-name prefix, cap at 8 results)*
  - *4.20.2* (2026-06-03) — Keep citation links lined up with their summaries. *(fix(shailos):
    keep research citation links aligned with their summaries)*
- **4.21.0** (2026-06-03) — Show who's signed in instead of silently displaying empty lists.
  *(feat(shailos): surface auth identity instead of silently showing blank lists)*
  - *4.21.1* (2026-06-03) — Fix lists not loading at all on mobile. *(fix(shailos): force
    Firestore long-polling so lists load on mobile)*
- **4.22.0** (2026-06-04) — Add a live connection-check tool to the diagnostics screen.
  *(feat(diag): add direct Firestore reachability probe to ?diag=1 overlay)*
  - *4.22.1* (2026-06-04) — Fix that connection-check tool to look at the right data. *(fix(diag):
    probe the real user doc path, not a reserved __name__)*
- **4.23.0** (2026-06-04) — Show live sign-in details to help explain permission errors.
  *(feat(diag): show live auth token claims to explain Firestore 403s)*
- **4.24.0** (2026-06-04) — Serve Google sign-in from the app's own web address, fixing broken
  redirects on mobile. *(feat(auth): serve Google sign-in from our own domain (fix mobile
  redirect))*
- **4.25.0** (2026-06-04) — New texts now push to every device instantly. *(feat(relay): push
  texts to all devices in real time)*
- **4.26.0** (2026-06-04) — Simplify phone connection down to two clear options. *(feat(phone):
  collapse phone connection to two clean paths)*
- **4.27.0** (2026-06-04) — Five equal-sized scrollable sections on phone and tablet. *(feat(nerve):
  five equal scrollable boxes on phone/tablet)*
  - *4.27.1* (2026-06-04) — Stop a caching bug from wiping the live phone feed. *(fix(phone):
    stop Firestore cache emits from wiping the relay feed)*
  - *4.27.2* (2026-06-04) — Fix a blank phone card in the five-box layout. *(fix(nerve): phone
    card in 5-box grid was blank — flex height collapse)*
- **4.28.0** (2026-06-05) — Drop card header bars for a small corner icon on mobile. *(feat(nerve):
  drop card header bars for a thin corner type-icon (mobile))*
  - *4.28.1* (2026-06-05) — Automatically recover if your profile got mistakenly denied on
    startup; show a live status for the PC connection. *(fix(auth+relay): auto-recover denied
    profile on startup; show live PC-link state)*
- **4.29.0** (2026-06-05) — Picture messages now come through over the cloud connection too.
  *(feat(relay): picture-text (MMS) images over the cloud relay)*
  - *4.29.1* (2026-06-05) — Stop Google sign-in from asking you to re-authenticate every few
    minutes on mobile. *(fix(auth): stop Google sign-in re-prompting every ~5 min on mobile)*
- **4.30.0** (2026-06-05) — Cleaner mobile headers, clearer icons, a more compact DeskPhone
  navigation bar, and safer research formatting. *(feat(ux): mobile toplines, borderline
  icons, DeskPhone compact nav, research format guard)*
- **4.31.0** (2026-06-07) — Borderless mobile cards with a short AI summary per category.
  *(feat(nerve-center): borderless mobile cards with chief per-category summaries)*
- **4.32.0** (2026-06-07) — Apple-style card summaries, thinner dividers, and a way to resolve
  missed calls. *(feat(nerve-center): Apple-style card summaries, thin dividers, missed-call
  resolve)*
- **4.33.0** (2026-06-07) — More Apple-style polish, cleaner rows, and a layout switcher.
  *(feat(nerve-center): Apple-style fallbacks, separator-free rows, layout toggle)*
- **4.34.0** (2026-06-07) — A denser view mode, colored section icons, and cards that can open
  more than one at a time. *(feat(nerve-center): density mode, colored header icons,
  multi-open accordion)*
- **4.35.0** (2026-06-07) — Tap any row to expand it; the summary collapses smoothly as you
  scroll. *(feat(nerve-center): tap-to-expand rows, scroll-collapsing summary, tinted cards,
  accordion scroll)*
  - *4.35.1* (2026-06-07) — Fade out cut-off rows at the bottom; a leaner phone card. *(fix(nerve-center):
    bottom fade for partial rows, lean compact phone card)*
- **4.36.0** (2026-06-07) — AI-written "what's next" prompts, tighter rows, and phone calls now
  expand like an accordion. *(feat(nerve-center): streamed next-action, tighter compact rows,
  drop health card, summary dedupe, accordion phone calls)*
  - *4.36.1* (2026-06-07) — Fix a crash from a coding mistake; make a fade animation more
    reliable. *(fix(crash): const→let fbState, harden MobileBox fade, fix typewriter cleanup)*
  - *4.36.2* (2026-06-07) — Missed-call resolving, deeper call history, and tone fixes. *(fix(nervecenter):
    missed-call resolve, history depth, fonts, brief tone, task sync)*
  - *4.36.3* (2026-06-07) — Add a missed-call resolve button directly to the phone screen.
    *(fix(deskphone-web): missed call resolve button on phone screen)*
  - *4.36.4* (2026-06-07) — Call stability and phone-preview fixes. *(fix: call stability,
    cloud resolvedMissed, supercrunch, phone preview)*
  - *4.36.5* (2026-06-07) — Add a daily backup; tighten the email layout. *(fix: server-only
    Firestore, daily backup, email single-line layout)*
  - *4.36.6* (2026-06-07) — Move the layout switcher to the top right; tighten spacing. *(fix(nc):
    layout selector top-right, horizontal expand icon, tighter spacing)*
  - *4.36.7* (2026-06-07) — Remove a duplicated preview block; use dots instead of bars for a
    cleaner look. *(fix(nc): remove duplicate preview body, dots not bars, readable fonts)*
  - *4.36.8* (2026-06-07) — Separate the summary engine from the "Chief" briefing feature;
    drop fake placeholder text. *(fix(nc): decouple SuperCrunch/card signals from Chief,
    remove all fallback content)*
  - *4.36.9* (2026-06-07) — Fix inconsistent status dots that were missing in five different
    places. *(fix(nc): dots everywhere — missed 5 task/shaila bar instances in boxes +
    desktop views)*
  - *4.36.10* (2026-06-07) — Better responsive behavior — a vertical layout on larger
    screens, a carousel on small ones. *(fix(nc): responsive boxes layout — vertical >=
    600px, carousel < 600px)*
  - *4.36.11* (2026-06-08) — Denser text, AI-only summaries, tighter spacing throughout.
    *(fix(nc): dense type scale, AI-only summaries, tight row padding across all layouts)*
  - *4.36.12* (2026-06-08) — Responsive-layout fixes across every view. *(fix(nc): responsive
    layout for all formats — boxes + accordion)*
  - *4.36.13* (2026-06-08) — Columns when the screen is wide, rows when it's narrow — no more
    carousel. *(fix(nc): boxes + accordion — columns when wide, rows when narrow, no
    carousel)*
  - *4.36.14* (2026-06-08) — Fix a crash caused by a coding order mistake. *(fix(nc): resolve
    TDZ crash in boxes layout — declare boxesFiveCol before use)*
  - *4.36.15* (2026-06-08) — Text now wraps instead of getting cut off with "..." in every
    column. *(fix(nc): wrap text in all columns instead of ellipsis — Gmail-only exception
    before aiSummary loads)*
  - *4.36.16* (2026-06-08) — Same wrap-instead-of-cutoff fix, applied to headers and previews.
    *(fix(nc): wrap section preview + box sticky header — no ellipsis on column surfaces)*
- **4.37.0** (2026-06-08) — Replace the plain item-count banner with a real AI-written summary
  and a suggested next action. *(feat(nc): replace counting banner with super-crunched summary
  + next action, each with refresh icon)*
  - *4.37.1* (2026-06-08) — Ignore events that already happened when the AI writes its
    summary; balance which sources get mentioned. *(fix(nc-banner): exclude past calendar
    events from AI context; enforce cross-source balance in supercrunch)*
  - *4.37.2* (2026-06-08) — Give card summaries an italic, muted "caption" look. *(style(nc):
    italic + muted for all card summary text — classy caption treatment)*
  - *4.37.3* (2026-06-09) — Stop email/calendar summaries from hanging forever on mobile.
    *(fix(nc-mobile): stop email/calendar + summaries hanging forever on mobile)*
- **4.38.0** (2026-06-09) — A version number now shows in the side rail — this is also where
  the "always bump the version" policy begins. *(feat(rail): version stamp in left rail +
  standing release/versioning policy)*
- **4.39.0** (2026-06-09) — The version number is now enforced to change on every release.
  *(feat(guard+rail): enforce version bump on push; fix mobile rail + version stamp)*
  - *4.39.1* (2026-06-09) — Fix that enforcement so it actually sticks around after a restart.
    *(fix(guard): commit Claude SessionStart hook so the push guard persists)*
  - *4.39.2* (2026-06-09) — More reliable summaries; the rail now fits on landscape screens.
    *(fix(nc): summaries reliability + per-area live status; rail fits landscape)*
  - *4.39.3* (2026-06-09) — Handle the case where your chosen AI provider has no key set up.
    *(fix(nc): summaries unavailable when chosen AI provider lacks a key)*
  - *4.39.4* (2026-06-09) — Card summaries now always run, even short one-liners. *(fix(nc):
    native card summaries always run + small one-line summaries)*
  - *4.39.5* (2026-06-09) — Summary text stops flickering blank between updates. *(fix(nc):
    summary status persists (no blanking) + tighter card line spacing)*
  - *4.39.6* (2026-06-10) — Compact mode is now genuinely about twice as tight as before.
    *(fix(nc): make compact density genuinely ~2x tighter than expanded)*
- **4.40.0** (2026-06-10) — **Task River** launches — one calm, auto-prioritized stream that
  mixes tasks and Shaila questions together. *(feat(taskriver): one calm auto-prioritized
  river of tasks + shailos)*
  - *4.40.1* (2026-06-10) — Sections can now collapse to just a summary until tapped. *(fix(nc):
    accordion is collapsible (summary-only until tapped))*
  - *4.40.2* (2026-06-10) — Fix layering issues; mix every source into one river. *(fix(taskriver):
    cover-screen z-index, all sources mixed, one river bar, tight rows)*
- **4.41.0** (2026-06-10) — Task River now reads your emails and scores calendar events too.
  *(feat(taskriver): analyze emails + smarter calendar scoring for the mix)*
- **4.42.0** (2026-06-10) — AI now prioritizes the entire river at once, not just pieces of it.
  *(feat(taskriver): AI prioritization of the whole river)*
- **4.43.0** (2026-06-10) — Shorter AI reasoning notes; manual priority labels are dropped in
  favor of AI judgment. *(feat(taskriver): terse AI line + ≤3-word reason; drop manual
  priority labels)*
  - *4.43.1* (2026-06-10) — Remove bullet icons and slim the controls to save space. *(fix(taskriver):
    drop bullet icons + slim controls to reclaim width)*
  - *4.43.2* (2026-06-10) — Fix the river getting stuck showing "AI prioritizing" forever.
    *(fix: river status never sticks on "AI prioritizing"; label NC suggestion)*
  - *4.43.3* (2026-06-10) — AI-only priorities and reasons — no made-up placeholder text.
    *(fix(taskriver): AI-only priority + reasons; no fabricated fallbacks)*
  - *4.43.4* (2026-06-10) — Make compact mode noticeably tighter on every card. *(style(nc):
    make compact density aggressively tight across all cards)*
  - *4.43.5* (2026-06-10) — Fix compact mode in the full-screen view; fix Google getting stuck
    loading when its sign-in expires. *(fix(nc): compact density works in full-panel view +
    fix Google stuck-loading on token expiry)*
  - *4.43.6* (2026-06-10) — Apply compact mode to the accordion view too. *(style(nc): apply
    compact density to accordion/stacked view too)*
  - *4.43.7* (2026-06-10) — Require a verified sign-in on the Health, phone-command, and
    debug-log features, closing a security gap. *(fix(security): require verified Firebase
    token on health, relay-command, and debug-log)*
- **4.44.0** (2026-06-10) — Show true delivery status for remote phone commands. *(feat(relay):
  true delivery status for remote phone commands)*
- **4.45.0** (2026-06-10) — Card views now expand to full page height with denser task rows.
  *(feat(nc): boxes-view cards expand to page height + denser task rows + Tasks/Shailos icon
  swap)*
  - *4.45.1* (2026-06-10) — Stop summary text from updating endlessly. *(fix(nc): stop summary
    lines from updating forever)*
  - *4.45.2* (2026-06-10) — Fix calendar rows recalculating too often. *(fix(nc): bucket
    calendarRows to per-minute so scan key stops churning)*
  - *4.45.3* (2026-06-10) — Remove a constantly-updating timestamp that was causing extra
    work. *(fix(nc): remove ticking lastSeenLabel from phone activity snapshot)*
  - *4.45.4* (2026-06-11) — Unjam the AI system, which had gotten backed up for four separate
    reasons at once. *(fix(ai): unjam the overloaded AI gateway — four stacked causes)*
  - *4.45.5* (2026-06-11) — Fix two more causes of the AI system getting stuck. *(fix(ai):
    bound the two unbounded waits that still killed the gateway)*
  - *4.45.6* (2026-06-11) — Add a retry countdown and an always-clickable "reprioritize"
    button. *(fix(river): retry countdown + always-enabled reprioritize button)*
- **4.46.0** (2026-06-11) — Phone connection is now seamless — direct when you're at the PC,
  cloud relay everywhere else, automatically. *(feat(phone): seamless auto transport - direct
  on the PC, cloud relay anywhere)*
  - *4.46.1* (2026-06-11) — One consistent color per task type. *(fix(river): one color per
    type + interleaved fallback order)*
  - *4.46.2* (2026-06-11) — Stop the AI from retrying endlessly — cap it at two attempts.
    *(fix(river): stop endless AI retry loop after 2 auto-attempts)*
  - *4.46.3* (2026-06-11) — Give task-ranking its own dedicated AI slot so it actually runs.
    *(fix(river): dedicated Gemini lane so river_rank actually gets a slot)*
  - *4.46.4* (2026-06-12) — Show the DeskPhone screen directly inside the Phone tab when it's
    reachable. *(fix(phone): auto-embed DeskPhone-served UI in Phone screen when directly
    reachable (web 4.17.49))*
  - *4.46.5* (2026-06-12) — Phone colors now follow the shared design system. *(style(tokens):
    phone surface palette now derives from GV_CLEAN (web 4.17.50))*
  - *4.46.6* (2026-06-12) — Combine five separate AI requests on page load into two, cutting
    down on backlog. *(fix(ai): consolidate 5 page-load calls into snapshot+river_rank — kills
    queue contention)*
  - *4.46.7* (2026-06-12) — Cut daily AI usage way down with slower background checks. *(fix(ai):
    slash daily RPD usage — snapshot 90s→8min, rank cross-tab throttle, email dedup)*
  - *4.46.8* (2026-06-12) — Stop the Health screen from flooding the browser console with
    errors. *(fix(health): guard user.getIdToken so the Health surface stops spamming the
    console)*
  - *4.46.9* (2026-06-12) — Move layout options to the top right, above every panel. *(fix(nervecenter):
    full-view layout selectors move to top right, above all panes)*
  - *4.46.10* (2026-06-12) — One consistent hover/focus/scrollbar style across the entire app.
    *(style(global): one interaction language across every surface — teal focus, uniform
    hover/press, unified scrollbars)*
  - *4.46.11* (2026-06-12) — Shailos now uses the same icon set as everywhere else in the
    app. *(style(shailos): Material Symbols Rounded replaces lucide — last surface joins the
    one icon language)*
  - *4.46.12* (2026-06-13) — Use Google's standard sign-in address while the alternate hosting
    is paused. *(fix(auth): use Firebase default authDomain while Netlify is paused)*
  - *4.46.13* (2026-06-13) — Rank more items at once; Shaila cases always come out on top.
    *(fix(taskriver): rank all items — emails 12→25, cap 60→100, tokens 1400→3000, shailos
    always top)*
  - *4.46.14* (2026-06-14) — A live status pill shows whether DeskPhone is connected directly
    or falling back to the web. *(style(deskphone): live surface indicator pill — teal =
    DeskPhone direct, amber = web fallback)*
  - *4.46.15* (2026-06-14) — Stop unnecessary background checking once live updates are
    already flowing. *(fix(relay): web poll stops on relay transport — onSnapshot handles
    real-time updates)*
  - *4.46.16* (2026-06-14) — DeskPhone now fills its space cleanly no matter how it's
    displayed. *(style(deskphone): DeskPhone panel fills cleanly — embedded mode for both
    iframe and fallback)*
  - *4.46.17* (2026-06-14) — Auto-hide the separate Windows window when it's shown inside the
    browser instead. *(style(deskphone): auto-hide WPF window when iframe is active, restore
    on leave)*
  - *4.46.18* (2026-06-14) — Fix window resizing and search issues in DeskPhone. *(fix:
    DeskPhone WebView2 resize reflow, thread search scope, WPF UI toggle)*
  - *4.46.19* (2026-06-14) — The message list now resizes properly with the window. *(style(deskphone):
    message list shrinks with window, stacked layout drops chrome)*
  - *4.46.20* (2026-06-14) — Hotfix a blank white screen in the message pane. *(fix(deskphone):
    restore min-height:0 on dp-message-shell — blank white screen hotfix)*
  - *4.46.21* (2026-06-14) — Fix the actual root cause of that same blank screen. *(fix(deskphone):
    container-type inline-size + 36pct — blank white screen root cause fix)*
  - *4.46.22* (2026-06-14) — Theme now stays in sync automatically — the manual refresh
    button is removed. *(fix: DeskPhone WebView2 theme sync always live; remove manual
    Refresh Sync + toggle)*
  - *4.46.23* (2026-06-14) — A more efficient way to keep the theme in sync. *(fix: DeskPhone
    iframe theme via postMessage — zero cost, always live)*
  - *4.46.24* (2026-06-14) — Routine version bump. *(style: bump 4.17.64)*
  - *4.46.25* (2026-06-14) — Theme now reaches the separate window too; remove the redundant
    Dark Mode toggle. *(fix: support theme propagation to standalone WebShell window and
    remove Dark Mode setting)*
  - *4.46.26* (2026-06-14) — Stop duplicate tasks/Shaila cases from being created when parsing
    a recording. *(fix: prevent duplication of existing tasks and shailos during recording
    transcript parsing)*
- **4.47.0** (2026-06-14) — Move hosting from Netlify to Firebase. *(feat: migrate hosting
  from Netlify to Firebase (Spark, Gemini-only))*
  - *4.47.1* (2026-06-14) — Rename some settings to satisfy Firebase's naming rules. *(fix:
    rename functions .env keys to satisfy Firebase naming rules)*
  - *4.47.2* (2026-06-14) — Default to the cheapest AI model; remove stale options from the
    switcher. *(fix: default to cheapest Gemini model and drop stale OpenAI/Claude options
    from model switcher)*
- **4.48.0** (2026-06-14) — Connect several Google accounts at once — calendars and inboxes
  merge together with duplicates removed. *(feat: multi-account Google Workspace (calendar +
  email) with merge, dedupe, and account toggle)*
  - *4.48.1* (2026-06-14) — The first Google account you connect becomes the primary one.
    *(fix: mark first-connected Google account as primary (rabbidanziger))*
  - *4.48.2* (2026-06-15) — Remove a stale cache; add a manual "refresh Google data" option.
    *(fix: remove stale localStorage cache from NC snapshot; fix rescan keys and add Google
    data refresh)*
  - *4.48.3* (2026-06-15) — Use a different sign-in method on iPhone, where popups get
    blocked. *(fix: use GIS redirect mode on iOS for Google Workspace connect (popup blocked
    by iOS))*
  - *4.48.4* (2026-06-15) — Remove a stuck rate-limit that was causing an endless loading
    spinner. *(fix: remove stale rate-limit block causing forever spinner when no cached NC
    data)*
  - *4.48.5* (2026-06-15) — Let background scans settle down; allow longer notes on signals.
    *(fix: 5-min in-session scan settle; expand signal notes to up to 5 words)*
  - *4.48.6* (2026-06-15) — Run email summaries through a more secure path; reset duplicate
    detection each session. *(fix: run email AI summaries on server-auth path; reset dedup
    key per session)*
  - *4.48.7* (2026-06-15) — Show a spinning loading icon while a summary is being written.
    *(fix: show animated spinner in section card headers while NC summary loads)*
  - *4.48.8* (2026-06-15) — Revert a change that had crashed the production build. *(fix:
    revert broken signalNote JSX wrapper (TDZ crash in minified bundle))*
  - *4.48.9* (2026-06-15) — Fix that same crash a better way. *(fix: eliminate TDZ crash by
    calling applyEmailSummaries directly in server-auth path)*
  - *4.48.10* (2026-06-15) — Let the AI process more of the list at once, so ranking actually
    covers everything. *(fix: raise river_rank maxOutputTokens 3000→8192 so full list gets
    AI-prioritized)*
  - *4.48.11* (2026-06-16) — Fix sign-in breaking on iPhone/Android due to browser privacy
    protections. *(fix: use same-origin authDomain so iOS/Android redirect auth survives ITP)*
  - *4.48.12* (2026-06-16) — Sign-in now adapts automatically to wherever the app is hosted.
    *(fix: host-aware authDomain so sign-in works on Firebase now and Netlify later)*
  - *4.48.13* (2026-06-16) — Require a verified sign-in on the AI system to stop abuse from
    anonymous visitors. *(fix: require Firebase ID token on the live AI proxy (stop anonymous
    bill abuse))*
  - *4.48.14* (2026-06-17) — Fix a mobile sign-in loop caused by the offline-support system
    interfering. *(fix: stop service worker from intercepting Firebase Auth /__/ paths
    (mobile sign-in loop))*
  - *4.48.15* (2026-06-17) — Fix a sign-in error caused by visiting the wrong web address.
    *(fix: route web.app visitors to firebaseapp.com origin (avoid OAuth redirect_uri_mismatch))*
  - *4.48.16* (2026-06-17) — Reskin the NerveCenter section headers. *(style: reskin
    NerveCenter section chrome to 2026 language (boxes + accordion))*
  - *4.48.17* (2026-06-17) — Rebuild sign-in from scratch, cleanly — Google-only, one web
    address. *(fix: rebuild auth clean — Google-only, single canonical origin
    (firebaseapp.com))*
  - *4.48.18* (2026-06-17) — Repair several things the hosting move had broken. *(fix: repair
    migration-broken wiring (Shailos AI/search, stale Netlify URLs, live mail cadence))*
  - *4.48.19* (2026-06-17) — Restore normal email-checking frequency; formally retire the
    paused old host. *(fix: revert mail idle poll to 15min + tombstone the paused Netlify
    backend)*
- **4.49.0** (2026-06-17) — An always-available reload button in the app's side rail. *(feat:
  always-on reload button in the suite rail (standalone/PWA refresh))*
  - *4.49.1* (2026-06-17) — Consistent number styling on every clock, calendar time, and mail
  date. *(style: mono numerals across NerveCenter (clocks, calendar times, mail dates))*
- **4.50.0** (2026-06-17) — A new Features tab in Settings to turn popups, Chief, and Health on
  or off. *(feat: Features settings tab — toggle move-up popup, Chief, and Health)*
  - *4.50.1* (2026-06-19) — Cache email summaries per session; run a full design-consistency
    audit. *(fix(nervecenter): hash-keyed session cache for email summaries; M3 style audit)*
  - *4.50.2* (2026-06-19) — Every spacing/motion value in the app becomes a shared, reusable
    setting instead of a one-off number. *(style: ShamashPro CSS token system — all
    layout/motion tokens become CSS vars)*
  - *4.50.3* (2026-06-19) — The first screen fully converted to that shared setting system.
    *(style: tokenize SuiteShailosPanel — screen 1 of app-wide --shp-* rollout)*
  - *4.50.4* (2026-06-19) — Every shared setting rolled out across the whole app. *(style:
    tokenize all --shp-* CSS vars across app)*
  - *4.50.5* (2026-06-19) — Corner rounding, fonts, spacing, and shadows standardized across
    five more files. *(style: tokenize radius/font/spacing/shadow across 04-components,
    05-modals, 06-shelf, 07-settings, 10-deskphone-web)*
  - *4.50.6* (2026-06-19) — Trim 18 color themes down to a curated set of 8. *(style: winnow
    color themes 18 -> 8 curated, industry-standard set)*
- **4.51.0** (2026-06-19) — Publish a master design-style guide and a tool that flags when a
  screen drifts from it — the foundation for visual consistency going forward. *(feat: M3
  stylebook master + UI-drift logger (consistency foundation))*
- **4.52.0** (2026-06-19) — A one-click button to clear AI-generated color themes. *(feat:
  one-click "Clear generated" button for AI-generated themes)*
- **4.53.0** (2026-06-19) — A developer-only override to preview style changes live, plus a
  full design-spec reference. *(feat: runtime master-style override (?uistyle=1) + full
  M3_SPEC catalogue)*
- **4.54.0** (2026-06-21) — Rebuild the app's outer shell using real Material Design 3
  components instead of hand-coded lookalikes. *(feat: migrate AppSuiteChrome to real
  @material/web M3 components)*
  - *4.54.1* (2026-06-21) — Consistent pill shape for every rail item. *(fix: remove
    NerveCenter arrow cap + matching pill shape for all rail items)*
- **4.55.0** (2026-06-21) — "Record Anything" gets smarter — better Yeshivish recognition, a
  proper form for Shaila questions, richer tasks, and schedule hints. *(feat: strengthen
  Record Anything — Yeshivish dialect, shaila question form, task richness, schedule hints)*
  - *4.55.1* (2026-06-21) — The collapsed clock now shows 12-hour time plus both English and
    Hebrew dates. *(fix: collapsed clock shows 12hr time + English + Hebrew date)*
  - *4.55.2* (2026-06-21) — The Hebrew date now displays in actual Hebrew letters. *(fix:
    Hebrew date in Hebrew letters, shown in both expanded and collapsed rail)*
  - *4.55.3* (2026-06-21) — Same collapsed-clock fix, reapplied. *(fix: collapsed clock shows
    12hr time + English + Hebrew date)*
  - *4.55.4* (2026-06-21) — A design-consistency pass on the Focus App section. *(style: M3
    audit pass — Focus App (section 2) visual polish)*
  - *4.55.5* (2026-06-21) — Retire the old style guide in favor of the real component
    library. *(style: gut m3-stylebook — redirect to @material/web, inline dev-tool
    constants)*
  - *4.55.6* (2026-06-21) — Replace hand-coded elements in the Focus section with real
    Material components. *(style: section 2 — real @material/web components via
    createComponent, not hand-coded rules)*
  - *4.55.7* (2026-06-21) — Fix font/color mismatches and a mislabeled close button. *(fix:
    M3 font/color bridge tokens, Close button text slot, queue as MdListItem)*
- **4.56.0** (2026-06-21) — Colors and styling now update everywhere at once when you change
  the theme — across the main app, Shailos, and DeskPhone. *(feat: app-wide Material 3 token
  bridge — theme-reactive across web suite, Shailos, DeskPhone)*
  - *4.56.1* (2026-06-21) — Secondary and accent colors now have their own real identity
    instead of copying the main color. *(style: derive distinct M3 secondary + tertiary
    accents (was mirroring primary))*
  - *4.56.2* (2026-06-21) — Convert buttons and toolbars to the real component library.
    *(style: M3 Phase A (slice 1) — text/action/toolbar + small-file icon buttons to
    @material/web)*
  - *4.56.3* (2026-06-22) — NerveCenter's full-screen cards now use real Material
    components. *(style: NerveCenter full-view cards on genuine @material/web (M3 A+B+D
    slice))*
  - *4.56.4* (2026-06-22) — Tasks, Shailos, and Phone rows converted to real list components.
    *(style: Tasks, Shailos & Phone rows on genuine md-list-item (M3 Phase D cont.))*
  - *4.56.5* (2026-06-22) — Finish converting NerveCenter's card and accordion views. *(style:
    finish NerveCenter M3 — boxes + accordion views on genuine @material/web)*
  - *4.56.6* (2026-06-22) — Restore button spacing that had been accidentally zeroed out
    app-wide. *(fix: restore M3 button padding clobbered by the global *{padding:0} reset)*
- **4.57.0** (2026-06-23) — Full-screen NerveCenter gets a live Google Calendar day timeline.
  *(feat: NerveCenter full-view — GCal daily timeline + account picker in card headers)*
- **4.58.0** (2026-06-23) — The calendar card gets that same live timeline plus an agenda
  view toggle. *(feat: calendar card-grid box gets the live-time timeline + agenda toggle)*
- **4.59.0** (2026-06-23) — The full-screen calendar now shows both the timeline and a
  compact agenda at the same time. *(feat: full-view calendar card gets dual display —
  timeline + compact M3 agenda)*
  - *4.59.1* (2026-06-23) — The agenda now shows all-day events with a clear "now" marker.
    *(fix: card-view calendar agenda shows all-day events with NOW divider, not just
    upcoming)*
  - *4.59.2* (2026-06-24) — A cleaner vertical split between the timeline and agenda; solid
    event blocks. *(fix: NerveCenter full-view calendar — vertical split (2/3 timeline + 1/3
    agenda) and opaque event blocks)*
  - *4.59.3* (2026-06-24) — Fix the calendar's divider line and a crash in the compact
    agenda. *(fix: calendar full-view M3 vertical divider, compact card agenda crash
    (cardListStyle undefined))*
  - *4.59.4* (2026-06-24) — Calendar now starts at local midnight, with a "Tomorrow" label
    for next-day events. *(fix: calendar loads from local midnight, Tomorrow separator for
    next-day events)*
- **4.60.0** (2026-07-01) — A floating Bug Log button lets you report issues on the spot.
  *(feat: floating Bug Log widget (Firestore users/{uid}/bugs))*
  - *4.60.1* (2026-07-01) — A cleaner feedback icon in a fixed corner spot. *(fix: bug-log FAB
    — clean feedback icon, CSS-anchored corner position)*
- **4.61.0** (2026-07-01) — An experimental, from-scratch redesign of NerveCenter, available
  behind a hidden setting. *(feat: from-scratch Material 3 NerveCenter behind ?ui=next
  (4.32.106))*
  - *4.61.1* (2026-07-01) — The bug-log becomes a draggable panel with its own menu entry.
    *(fix: bug-log panel — draggable non-modal card, rail item, left FAB)*
  - *4.61.2* (2026-07-01) — Add a close button and resizing to the bug-log panel. *(fix:
    bug-log panel — close button and resizability)*
  - *4.61.3* (2026-07-01) — NerveCenter now fits entirely on one screen, no scrolling
    needed. *(fix: NerveCenter at-a-glance — single-screen dashboard, no page scroll
    (4.32.109))*
  - *4.61.4* (2026-07-01) — Tighter row spacing in the bug-log list. *(style: bug-log list —
    M3 dense-row density for entries)*
- **4.62.0** (2026-07-01) — The experimental NerveCenter becomes a complete, re-skinned copy
  of the real one. *(feat: ?ui=next NerveCenter = full-fidelity fork of the real panel,
  re-skinned (4.32.111))*
  - *4.62.1* (2026-07-01) — A proper header and shape system for that experimental view.
    *(style: M3 header/type/shape system for ?ui=next NerveCenter (4.32.112))*
  - *4.62.2* (2026-07-02) — Real depth and consistent spacing in the experimental view.
    *(style: ?ui=next — real tonal depth + M3 16px gutter rhythm (4.32.113))*
- **4.63.0** (2026-07-02) — A batch of owner-reported fixes: clearer phone status, a
  reconnect button that actually works, retry/copy/reply on texts, and simpler 1-2-3
  priorities. *(feat: ticket batch — phone status humanized, one working reconnect, text
  retry/copy/inline-reply, 1/2/3 priorities, stale nudge removed (4.33.113))*
  - *4.63.1* (2026-07-03) — Priority labels now survive a data sync; the DeskPhone button is
    reliably visible. *(fix: 1/2/3 labels survive Firestore sync, open-DeskPhone button
    actually visible, /show via relay (4.33.114))*
- **4.64.0** (2026-07-03) — Phone commands now arrive instantly through a push notification
  system instead of checking repeatedly. *(feat: phone commands via Realtime Database push —
  zero idle reads (pairs with DeskPhone b326))*
  - *4.64.1* (2026-07-06) — Google sign-in always shows the account picker; popups come
    first on mobile. *(fix: Google sign-in always shows the account picker; popup-first on
    mobile (4.34.115))*
  - *4.64.2* (2026-07-06) — A bug-log cleanup pass, plus pinned missed calls and a working
    reader tool. *(fix: bug-log triage pass — queue card radius, queue chip, checkmark adds,
    pinned missed calls, working buglog reader (4.34.115))*
  - *4.64.3* (2026-07-06) — A large batch: unified card styling, calendar improvements,
    AI-written bug-log summaries with resolve notes, and more accurate email attribution.
    *(fix: bug-log batch 7/6 — GM3 card unification + accordion retired + header row reclaim
    (ui=next), calendar drops yesterday + now-in-top-third + agenda inset panel, buglog AI
    summaries + click-to-expand history + resolve-with-note tool, email summary attribution
    accuracy (4.34.116))*
  - *4.64.4* (2026-07-06) — More card styling and layout fixes. *(fix: GM3 follow-up —
    card-grid tonal cards + gutters, column-view header row floated to margin, 100dvh
    bottom-cut fix (4.34.117))*
  - *4.64.5* (2026-07-06) — Email wrapping, solid calendar blocks, and a Task River width
    fix. *(fix: bug-log batch — email summaries wrap to 2 lines everywhere, GCal-mobile solid
    timeblocks in live view, agenda vertical accent bars, compact mode keeps font size
    (spacing only), TaskRiver max-width (4.34.118))*
- **4.65.0** (2026-07-06) — Every phone connection now requires a verified sign-in before
  pairing; the Android companion app joins the system. *(feat: host-API Google-account
  pairing gate — Android/Windows hosts verify Firebase ID token, web pairs silently, iPad
  bridge forwards auth headers; Android host b2 (4.35.118))*
  - *4.65.1* (2026-07-06) — The app now automatically picks whichever device is actually
    holding the Bluetooth phone connection. *(fix: multi-host phone discovery — Firestore
    host registry + best-host picker (prefers the host holding the BT link), DeskPhone LAN
    proxy for HTTPS pages, no-wipe transient failover, Android host b3 rejects forwarded
    requests (4.35.119))*
  - *4.65.2* (2026-07-06) — Card layout fixes and simpler phone connection controls. *(fix:
    buglog batch — card-grid bottom:0 anchoring (taskbar overrun), layout icons unreversed +
    width-adaptive column/rows icon, mail+texts body-first type hierarchy, true row-height
    task autofill + deeper phone feed, phone connection controls simplified (one reconnect,
    host-aware pill, clear menu copy) (4.35.120))*
  - *4.65.3* (2026-07-06) — Whichever device is holding the phone now feeds live updates to
    everyone else. *(fix: relay fed by whichever host holds the phone — Android b4
    RelayClient (Firestore push + RTDB command drain, connection-gated), DeskPhone b327 relay
    arbitration (farewell push + silent when parked), web back to simple loopback-or-cloud
    with one read-only status pill (4.35.121))*
  - *4.65.4* (2026-07-07) — Simplify the phone-connection screen around the tablet. *(fix:
    simplify phone link UI around tablet host)*
- **4.66.0** (2026-07-07) — The full phone screen now talks directly to the cloud relay; the
  redesigned NerveCenter becomes the default. *(feat: full phone screen speaks the cloud
  relay + NerveCenterNext is now default UI)*
  - *4.66.1* (2026-07-07) — Bug-log entries can now be edited inline, with the AI summary
    refreshing automatically. *(fix: buglog entries are now editable — Edit text in the row
    menu opens inline edit, rewrites b.text and clears the stale AI summary for re-summary
    (4.35.124))*
- **4.67.0** (2026-07-07) — The tablet becomes the main phone connection, with the PC as
  backup — fixes the iPad connecting and disconnecting on its own. *(feat: phone-link
  owner-doc arbitration — tablet primary, PC standby, menu-rail takeover toggle; fixes iPad
  connect/disconnect flapping (4.36.124))*
  - *4.67.1* (2026-07-10) — Texts you send now show up instantly while sending; fix
  duplicate sends across web, Windows, and Android. *(fix: phone-link ticket batch — instant
  SMS echoes in every composer, stuck send-double fixes (web collapse + Windows 15-min skew
  window + Android tolerant body match), honest stale-data status line, compact M3 rail host
  toggle with handoff feedback (4.36.125))*
- **4.68.0** (2026-07-10) — One shared source of truth now drives phone status on both the
  app and DeskPhone, so they can't drift out of sync with each other. *(feat: phone-link
  one-truth overhaul — shared state machine both surfaces derive from, exact
  client-message-id (cid) send reconciliation through both hosts, status-flip repaint fix,
  never-blank feeds, ?phonediag=1 overlay, committed test suite (4.37.125))*
  - *4.68.1* (2026-07-10) — Fix an app-wide crash caused by a setting that was referenced but
    never actually loaded. *(fix: phone-host-control crashed the whole app —
    OWNER_LIVE_WINDOW_MS was re-exported but never imported (4.37.126))*
- **4.69.0** (2026-07-10) — Handing phone control to another device now moves the actual
  Bluetooth connection with it. *(feat: phone handoff now moves the Bluetooth link + M3
  segmented host control (4.38.126, hosts b330/b6))*
- **4.70.0** (2026-07-10) — The AI system now also accepts sign-ins from the separate
  RabbiMetrics app. *(feat: ai-proxy gateway accepts RabbiMetrics clients — rabbi-s-metrics
  ID tokens + rabbimetrics origins (4.39.126))*
  - *4.70.1* (2026-07-10) — Fix a security check that was blocking RabbiMetrics' sign-in
    header. *(fix: ai-proxy CORS preflight now approves the Authorization header (4.39.127))*
- **4.71.0** (2026-07-12) — The web phone now works entirely through the cloud, with
  confirmed handoff on every device. *(feat: cloud-only web phone + confirmed takeover on
  both hosts + per-build Android icon (4.40.127, hosts b331/b7))*
- **4.72.0** (2026-07-12) — The host-switch button now blinks until the switch is confirmed;
  fix a stale "can't reach" message. *(feat: host-switch blink-until-confirmed + stale
  "can't reach" banner fix (4.41.127))*
  - *4.72.1* (2026-07-12) — Make the Bluetooth message-sync more efficient — check less
    often when nothing's happening. *(fix: MAP/OBEX efficiency pass — adaptive poll + parked
    navigation + merged sweeps (4.41.128, host b332))*
  - *4.72.2* (2026-07-12) — Empty notifications now correctly trigger a sync instead of being
    ignored. *(fix: empty MNS event reports now prove push + trigger sync; delete-reconcile
    bounded to phone window span (4.41.129, host b333))*
  - *4.72.3* (2026-07-12) — Stop a log message from repeating three times a second. *(fix:
    history-loader pause logged once per pause, not 3x/sec (4.41.130, host b334))*
  - *4.72.4* (2026-07-12) — Same empty-notification fix, applied to the Android app. *(fix:
    Android host b8 — empty MNS event reports now trigger an instant sync (4.41.131))*
- **4.73.0** (2026-07-12) — A pre-production deep pass: a design sweep, a ticket batch, and
  new rules for multiple users on one account. *(feat: pre-production deep pass — GM3 sweep,
  ticket batch, multi-user rules (4.42.131))*
  - *4.73.1* (2026-07-13) — Background checking only slows down once the push channel is
    confirmed working, not on the first signal. *(fix: poll relaxes on MNS channel open, not
    first event (4.42.132, host b335))*
- **4.74.0** (2026-07-13) — Shailos becomes a fully native part of the app — no more
  embedded pop-up window. *(feat: Shailos goes native — full in-app integration, pure GM3,
  iframe retired (4.43.132))*
- **4.75.0** (2026-07-13) — A three-way phone connection (iPad, active browser tab, or PC)
  with auto-detection and live call recording. *(feat: three-lane phone link
  (iPad/ActiveTab/PC) + auto-finder + live call-feed record (4.44.132))*
- **4.76.0** (2026-07-14) — A large batch of owner-reported fixes: a research fallback via
  Sefaria, two-button Shaila dictation, a "more actions" menu, a missed-call fix, and a
  car-kit mode. *(feat: ticket batch — Sefaria research fallback, two-button shaila
  dictation, column expand, More-Actions + dead screen retired, dated inbox merge, missed-call
  HFP fix, car-kit lane (4.45.132))*
  - *4.76.1* (2026-07-14) — Loosen the Sefaria fallback's matching — it was rejecting valid
    results. *(fix: Sefaria research fallback needs slop — phrase window defeated real
    queries (4.45.133))*
  - *4.76.2* (2026-07-13) — An evening batch: the iPad connection lane is retired, icon and
    sign-in fixes. *(fix: evening ticket batch — iPad lane retired, picker state icons, iOS
    PWA sign-in, box toolbars, NC snooze (4.45.134))*
  - *4.76.3* (2026-07-13) — "No results" from research is now an honest AI decision, not a
    silent failure. *(fix: research no-results was an AI judgment call, not a failure
    (4.45.135))*
  - *4.76.4* (2026-07-14) — On tablets, the calendar/mail toolbar now merges into the card
    header instead of taking its own row. *(fix: tablet-mode Calendar/Mail toolbar merges
    into the card header row (4.45.136))*
  - *4.76.5* (2026-07-14) — The host-switch button survives brief gaps during handoff;
    research now clearly says when it only checked Sefaria. *(fix: host-switcher pending
    state survives the handoff gap; research honestly flags Sefaria-only coverage (4.45.137))*
- **4.77.0** (2026-07-15) — Search results now pass through a live check before being shown,
  to catch bad or unsafe links. *(feat: search results pass through a live link-inspection
  gate)*

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

**Current version: 4.77.0**
