# APP FEATURE MAP — Shamash Pro 4

> The working master for the polish campaign. Every screen, card, and element as a
> **numbered line item** describing *what it does when you use it* (plain English),
> followed by its exact source location so any session can jump straight to the code.
>
> Reference any item by number — e.g. "let's do **6.4**".
> Companion: **APP_ATLAS.md** maps files and functions in bulk.
>
> Status: ⬜ untouched · 🔧 in progress · ✅ polished  (mark per line as we work)
>
> **Audit standard: Material Design 3 (M3)** — all polish judgments, component patterns,
> spacing, motion, and iconography are evaluated against the M3 spec exclusively.
>
> Scope note: **Chief of Staff** and **Health** screens are intentionally held for now.
>
> Path root: `apps/web/src/` unless noted otherwise.

---

## 1 · Switchboard (left rail)
- **1.1 Surface switcher** ✅ — the icon column on the far left; click an icon to swap the whole right side to a different "app" (Focus, NerveCenter, TaskRiver, DeskPhone, Shailos). Remembers where you were. `→ 08-app-split/components/AppSuiteChrome.jsx:1–268` (mainApps :6, buttons :91–134, experimentalApps :11–19; wired in App.jsx:3615)
- **1.2 Rail collapse** ✅ — shrinks the rail to icons-only to give content more room. `→ AppSuiteChrome.jsx:196–207` (toggle button); `App.jsx:2815` (sidebarW calc); `App.jsx:3618` (onToggle handler + localStorage)

## 2 · Focus App — "one task at a time" screen
- **2.1 Clock + "N today"** 🔧 — current time and how many tasks you've finished today, for momentum. `→ App.jsx:3815` (time in card header), `App.jsx:3831` (secondary bar); `clockTime` state :264; done-today count from `compT.length` :3904
- **2.2 Done button (✓)** 🔧 — marks the card's task finished; it flashes a checkmark, chimes, and the next task slides in. `→ App.jsx:3822` (button); `compTask()` :2005; `playCompletionSound` imported from `04-components.jsx`
- **2.3 Zen button** 🔧 — expands the current task to a distraction-free full screen. `→ App.jsx:3073` (`<ZenMode>` render); auto-Zen logic :1876–1889; `ZenMode` component in `04-components.jsx`
- **2.4 Task card** 🔧 — the single big colored card showing the one task to do now (color = priority). Long text auto-shrinks; shows "Step 2 of 5," a blocked note, or "3 days waiting." Click text to rename in place. `→ App.jsx:3800–3970` (full focus-tab render); `AutoFitText`, `AgeBadge`, `BlockedBadge` in `04-components.jsx`; age badge render :4293
- **2.5 Just-Start timer** 🔧 — a short countdown to trick yourself into starting ("just 5 minutes"). `→ App.jsx:3880` (`<JustStartTimer>` render); `justStartId` state :198; minimized dock :3271; hamburger entry :4006; `JustStartTimer` in `04-components.jsx`
- **2.6 Park til tomorrow** 🔧 — hides this task until tomorrow morning so it stops nagging today; returns on its own. `→ App.jsx:3884` (button); `parkTask()` :2151
- **2.7 What's in the way?** 🔧 — appears only on tasks older than 3 days; opens an AI prompt to name the blocker and break the stall. `→ App.jsx:3429` (`<BlockedModal>` render); `blockTask()` :2326; `BlockReflectModal` in `04-components.jsx`
- **2.8 Priority circles** 🔧 — colored circles (Shaila, Now, Today, Eventually, + custom). Click to open an add box at that priority; hover shows a mic for voice entry. `→ App.jsx:3920–3944` (built-in circles); :3937 (custom row); `selPri` state :98; `addVT()` :1943
- **2.9 Add box** 🔧 — where you type a new task; the ⚡/🌊 button tags it high/low energy so the queue can match it to your energy later. `→ App.jsx:3957–3965` (form, visible when `selPri` set); `addTask()` :1913
- **2.10 Shatter into crystals** 🔧 — sends the task you're typing to the AI, which splits a big vague task into concrete subtasks. `→ App.jsx:3968` (inline button in add box); :2967 (hamburger entry); crystal conversion logic :2455; `BrainDump` in `04-components.jsx`
- **2.11 Hamburger menu (top-left)** 🔧 — the "everything else" menu: good-enough/blocked, change priority, delete, go to Queue/Insights/Settings, toggle auto-Zen, body-double timer, AI-prioritize, brain-dump, bulk-add, backup/restore, shaila log. `→ App.jsx:2964–3040` (menu item definitions); `manOpt()` :2353
- **2.12 PostIt stack (bottom-right)** 🔧 — a pile of today's finished tasks; click to fan out and un-finish or duplicate one. `→ App.jsx:4052–4055` (render); `PostItStack` in `04-components.jsx`; `uncompTask()` :2052

## 3 · Focus App — Queue (full list)
- **3.1 Count + energy chip** ⬜ — how many tasks are queued; if you set an energy mode, filters to matching tasks. `→ App.jsx:4062–4080` (non-focus tab header with count + Tab buttons)
- **3.2 Overwhelm banner** ⬜ — when the list gets too long, collapses it and offers to show only a few, to prevent paralysis. `→ App.jsx:4082+` (queue section); `OverwhelmBanner` in `04-components.jsx`
- **3.3 Search** ⬜ — type to filter the list. `→ App.jsx:4082+` (search input in queue tab)
- **3.4 Quick-add** ⬜ — add a task at a chosen priority without leaving the list. `→ App.jsx:4082+` (add row in queue tab); `addVT()` :1943
- **3.5 Task rows** ⬜ — drag to reorder; per-row complete/edit/change-priority. `→ App.jsx:4082–4367` (full queue render); `compTask()` :2005
- **3.6 Subtask groups** ⬜ — "shattered" tasks appear as a collapsible group you expand and complete piece by piece. `→ App.jsx:4215–4231` (step-group render); crystal group conversion :2455
- **3.7 Shelf** ⬜ — completed-task history; restore or clone an old one. `→ 08-app-split/components/SuitePanels.jsx` (shelf panel component); restore via `uncompTask()` App.jsx:2052

## 4 · Focus App — Insights
- **4.1 Completion chart** ⬜ — graph of tasks finished over day/week/month/all-time. `→ App.jsx:4367+` (insights tab render)
- **4.2 Secondary chart** ⬜ — a second view (by weekday, speed, trend, or running total). `→ App.jsx:4367+` (insights tab)
- **4.3 AI insight** ⬜ — a short written observation the AI generates about your patterns. `→ App.jsx:4367+` (insights tab); `aiInsight` state; AI call through `/api/ai-proxy`
- **4.4 AI chat** ⬜ — a chat box to ask the AI about your tasks/productivity. `→ App.jsx:4367+` (insights tab); `aiChat*` state group; through `/api/ai-proxy` Firebase Function
- **4.5 Daily tip** ⬜ — rotating advice, fixed per day. `→ App.jsx:4367+` (insights tab)

## 5 · NerveCenter (command-center dashboard)
- **5.1 Layout switch** ⬜ — flip between 3 resizable columns, 5 equal cards, or a phone accordion; plus a density toggle and a "More actions" drawer. `→ NerveCenterPanel.jsx:1122–1143` (layout branch logic); boxes branch :2122; accordion branch :2377; `BOX_ORDER` :2134
- **5.2 Mail card** ⬜ — pulls recent Gmail and shows each as *sender · time · a one-line AI summary* so you grasp the inbox without opening it. Tap to reveal subject; ↗ opens real Gmail. `→ NerveCenterPanel.jsx:2211–2234` (`MobileBox` for mail); `fetchGmailData()` in `App.jsx`; AI cache constants :219–233
- **5.3 Phone card** ⬜ — live feed of latest texts/calls with a colored connection dot; tap to open DeskPhone. `→ NerveCenterPanel.jsx:2237–2244` (`MobileBox` for phone); `NerveCenterPhoneSurface.jsx` (1489 lines, inline phone panel)
- **5.4 Tasks card** ⬜ — open tasks inline with a quick-add box and per-row done/delete; tap text to edit. `→ NerveCenterPanel.jsx:2247–2288` (`MobileBox` for tasks); `compTask()` passed via prop from `App.jsx`
- **5.5 Shailos card** ⬜ — questions you owe answers to (or replies you owe), in gold; each marked "pending answer" or "waiting to reply." `→ NerveCenterPanel.jsx:2291–2309` (`MobileBox` for shailos); `GOLD` color from `ui-tokens.jsx`
- **5.6 Calendar card** ⬜ — upcoming events with the current one highlighted and routine prayers dimmed. "Add event" lets you type "Call David Mon 3pm" and the AI creates a real calendar event. `→ NerveCenterPanel.jsx:2312–2336` (`MobileBox` for calendar); `ROUTINE_CALENDAR_RE` regex; `createGoogleCalendarEvent()` in `App.jsx`
- **5.7 Card headlines** ⬜ — the one-line summary atop each card, written by a single AI scan of everything, refreshed on a timer (not per keystroke, to control cost). `→ NerveCenterPanel.jsx:1136–1186` (chief scan AI call + caching); `SNAPSHOT_CACHE_MS=20min` :233; `cardSummary()` fn; cache keys :219–233

## 6 · DeskPhone (full phone screen)
- **6.1 Nav rail** ⬜ — switches Phone (messages/calls), Contacts, Settings, Developer Tools; collapses and drag-resizes. `→ 10-deskphone-web.jsx:234` (NAV_ITEMS array); rail render :6070–6112
- **6.2 Live sync** ⬜ — every 5s asks your PC's DeskPhone host for fresh status/messages/calls/contacts (attachments once a minute), redrawing only on real changes. On a phone, goes through the cloud relay. `→ 10-deskphone-web.jsx:5891` (`refresh()` call entry); poll interval + signature-diff logic in `DeskPhoneWebPanel` :5767+
- **6.3 Connection line** ⬜ — one plain sentence of the real state ("Connected to [phone]," "Connecting…," "out of range," "service off"), each with a one-line what-to-do. `→ 10-deskphone-web.jsx:5906` (`callsConnectionLabel` useMemo); rendered :6088; label-build logic :531
- **6.4 Reconnect prompt** ⬜ — when the link drops: reconnect, pick a device, or dismiss. `→ 10-deskphone-web.jsx:1205` (prompt HTML); CSS :3598; `reconnectDismissed` state :5785; visibility :5948; parity note :208
- **6.5 Build-update overlay** ⬜ — flags when the host PC app has a newer build; accept/snooze. `→ 10-deskphone-web.jsx:1244` (overlay HTML); accept/snooze commands :6150–6160; parity note :207
- **6.6 Conversation list** ⬜ — all text threads; search, filter All/Unread/Pinned/Muted/Blocked, push unread to top, drag column width. `→ 10-deskphone-web.jsx` messages-tab render within `DeskPhoneWebPanel` :5767+
- **6.7 Thread view** ⬜ — the open conversation as chat bubbles with timestamps and clickable links; in-thread search with match count and next/prev. `→ 10-deskphone-web.jsx` thread render within messages tab; `DeskPhoneWebPanel` :5767+
- **6.8 Attachments + lightbox** ⬜ — images/files in a message; tap an image for full-screen rotate/save. `→ 10-deskphone-web.jsx` attachment + lightbox logic within thread render; `DeskPhoneWebPanel` :5767+
- **6.9 Conversation actions** ⬜ — pin, mute, block, or delete a thread. `→ 10-deskphone-web.jsx` thread action handlers; `runCommand()` :5953
- **6.10 Composer** ⬜ — type and send a reply; attach up to 6 files (size/type checked first). `→ 10-deskphone-web.jsx` composer within thread view; `runCommand()` :5953
- **6.11 Calls list** ⬜ — call history grouped by number, filterable All/Missed/In/Out, resizable, with "delete all" confirm. `→ 10-deskphone-web.jsx:6226` (delete-all confirm); calls tab render within `DeskPhoneWebPanel`
- **6.12 Call banner** ⬜ — during an active call: mute, answer, hang up. `→ 10-deskphone-web.jsx:6169–6172` (mute/answer/hangup runCommand calls)
- **6.13 Dialpad** ⬜ — number keypad to place a call from within a thread. `→ 10-deskphone-web.jsx` dialpad component within messages tab; `runCommand("/call", …)` :5953
- **6.14 Contacts** ⬜ — contact list with each contact's numbers; "New message" picks a recipient, types, attaches files. `→ 10-deskphone-web.jsx` contacts-tab render; NAV_ITEMS :234
- **6.15 Settings / Developer tabs** ⬜ — host controls and diagnostics. `→ 10-deskphone-web.jsx` settings + developer tab renders; NAV_ITEMS :234
- **6.16 Parity ledger** ⬜ — internal checklist of which native features the web version has matched (links to the Windows code); a developer aid. `→ 10-deskphone-web.jsx:3207` (`<details>` element); native-source annotations :207–233
- **6.17 Theming** ⬜ — recolors to match the chosen app theme (handed over by the main app), always keeping text readable. `→ 10-deskphone-web.jsx:124` (`buildDeskPhoneWebVars()`); contrast :72 (`deskPhoneContrastRatio`); theme push via `main.jsx:43–86` (postMessage + webview)
- **6.18 Standalone mode** ⬜ — the exact screen the native Windows app embeds, served from your PC with no login wall. `→ main.jsx:40–98` (`StandaloneShell`); `DeskPhoneWebPanel` `embedded` prop :5767

## 7 · Shailos App (entire question-tracker app)
- **7.1 Purpose** ⬜ — a standalone mini-app to capture halachic questions, record who asked, get/record the answer, research it, and track whether you got back to the asker. `→ apps/shailos/src/App.tsx` (entire file, 1740 lines); embedded in main app via `SuiteShailosPanel`
- **7.2 Live store** ⬜ — everything saves to the cloud database and updates instantly across windows. `→ apps/shailos/src/App.tsx:539` (Firestore onSnapshot listener); `apps/shailos/src/services/` (Firebase config)
- **7.3 Error screen** ⬜ — on a database problem, shows a clear explanation + Reload instead of breaking. `→ apps/shailos/src/App.tsx:333` (`handleFirestoreError()`); typed by `OperationType` enum
- **7.4 Search** ⬜ — filter shailos by text. `→ apps/shailos/src/App.tsx` (`searchQuery` state; inline filter in render)
- **7.5 Status filter** ⬜ — show All, Pending (no answer), Answered, or Got-back (you replied). `→ apps/shailos/src/App.tsx` (`statusFilter` state; inline filter in render)
- **7.6 Record a shaila (mic)** ⬜ — records you dictating a question; audio saved locally first (offline-safe), then AI transcribes and parses it into a structured shaila. `→ apps/shailos/src/App.tsx:560` (`startRecording()`); mic button render :1069; `savePendingRecording()` → IndexedDB :115
- **7.7 Record a call** ⬜ — captures call audio (via screen-share audio) the same way, for phone shailos. `→ apps/shailos/src/App.tsx` (call-recording branch in `startRecording()`; `isCallRecording` state)
- **7.8 Stop** ⬜ — ends the recording and queues it for processing. `→ apps/shailos/src/App.tsx:640` (`stopRecording()`); stop button :1095
- **7.9 Held recordings** ⬜ — audio not yet transcribed, with size; process now or delete. `→ apps/shailos/src/App.tsx:115` (`openPendingDb()`); `listPendingRecordings`, `deletePendingRecording` in same file; `pendingRecordings` state :421
- **7.10 Paste text** ⬜ — paste a written question and have the AI parse it instead of recording. `→ apps/shailos/src/App.tsx:699` (`handlePasteSubmit()`); paste button render :1666
- **7.11 Add manually** ⬜ — create a blank shaila and fill the fields yourself. `→ apps/shailos/src/App.tsx:878` (`handleAddManually()`); button render :1114
- **7.12 Shaila card** ⬜ — each shows an editable **synopsis** (AI can **regenerate**, or you can **dictate** it), the **answerer**, the **answer** ("[waiting for answer]" until filled), and the full **question**. `→ apps/shailos/src/App.tsx:1305–1580` (selected-shaila panel render); `saveShailaDetails()` :899
- **7.13 Got back to asker** ⬜ — toggle marking you've relayed the answer back, with undo. `→ apps/shailos/src/App.tsx:725` (`handleGotBack()`); button renders :1305 and :1355
- **7.14 Research** ⬜ — sends the question to the AI, which searches the web and Jewish-text sources (Sefaria) and produces a report of relevant sources/seforim with summaries; "View Research" opens it. `→ apps/shailos/src/App.tsx:837` (`handleResearch()`); button renders :1442 and :1571; AI pipeline in `apps/shailos/src/services/geminiService.ts` (`performResearch`, `buildSearchQueries`, `searchWeb`)
- **7.15 Copy / Delete** ⬜ — copy one shaila (formatted) to the clipboard or delete it; "Copy all" dumps the whole list. `→ apps/shailos/src/App.tsx:828` (`deleteShaila()`); `copyAllShailos()` :985; "Copy all" button :1208
- **7.16 Duplicate-catch** ⬜ — when a new shaila resembles an existing one, it shows suggested matches and offers to **Integrate** rather than duplicate. `→ apps/shailos/src/App.tsx:421` (`potentialMatches` state); `integrateShaila()` :735; render :1678–1723; integrate button :1709
- **7.17 Save** ⬜ — persists edits and detects when the answer changed. `→ apps/shailos/src/App.tsx:899` (`saveShailaDetails()`); called `onBlur` throughout card render :1375–1556

## 8 · Color Templates (the 8 themes)
- **8.1 Theme picker** ⬜ — pick one and the whole app recolors: Google Voice (white/teal), Material Light (blue), Material Dark, Claude Cream (warm paper — also the safety fallback), Navy Gold (dark premium), Ocean Breeze (cool), Sage & Cream (natural), Obsidian (minimal dark). `→ 01-core.js:1246` (SCHEMES object, 8 entries); theme applied via `cleanTheme()` in `ui-tokens.jsx`; picked in Settings modal
- **8.2 Category colors** ⬜ — fixed across every theme so things stay recognizable: gold = shailos, blue = mail, purple = phone. `→ 08-app-split/ui-tokens.jsx` (`GOLD="#C9923C"`, `CAT_MAIL="#3D6CB5"`, `CAT_PHONE="#8A63B5"`)
- **8.3 Clean base + random palette** ⬜ — NerveCenter always uses a neutral base mapped from your theme; brand-new tasks get a random accent from a 16-color set. `→ 08-app-split/ui-tokens.jsx` (`GV_CLEAN` object, `cleanTheme()` function); random palette in `01-core.js`
- **8.4 Colors not tokenized yet** ⬜ — intentionally deferred to a future redesign where colors become named/semantic. `→ (by design — no single location; see MEMORY project_tokenization_phase2)`

## 9 · UI Theory (consistency rules)
- **9.1 Design tokens** ⬜ — one master list of every size, spacing, shadow, font size, and animation speed; change a token once and every screen updates. `→ 08-app-split/ui-tokens.jsx:1–510` (SP, RADIUS, ELEV, DUR, EASE, TRANSITION, Z, ICON, LINE)
- **9.2 Typography** ⬜ — one text font everywhere, plus a monospace font for numbers so times/counts line up. `→ 08-app-split/ui-tokens.jsx` (NC_FONT_STACK "Segoe UI Variable", NC_MONO_STACK "JetBrains Mono", NC_TYPE scale)
- **9.3 Contrast engine** ⬜ — auto-adjusts any text color until it's guaranteed readable on its background, so no theme produces unreadable text. `→ 01-core.js:1391` (`_contrastRatio()`); `textOnColor()` :1463; `ensureSchemeContrast()` :1444 (run on every theme at load)
- **9.4 M3 stylebook** ⬜ — the single "correct" recipe for common controls (search box, chip, button, row, card) so they all match. `→ 08-app-split/m3-stylebook.jsx` (entire file)
- **9.5 Consistency tools (dev)** ⬜ — `?uiaudit=1` measures inconsistencies and reports them; `?uistyle=1` forces every element to the master look at runtime so you can preview perfect consistency. `→ dev/ui-audit.js`; `dev/ui-style-override.js`; both lazy-loaded in `main.jsx:14–22`
- **9.6 Layout philosophy** ⬜ — responsive off the device and available width (5 columns on wide screens, accordion on phones); cards scroll internally so the page never overflows. `→ NerveCenterPanel.jsx:2122–2377` (layout branches); `App.jsx:2815` (sidebarW calc); `App.jsx:3797` (main content positioning)

---

### How we work each item
Read it fully → list concrete defects + cleanups → fix → `npm run build` (build-gate) →
smoke-test the surface → commit → push live (standing policy). Mark the line ✅ when shipped.
