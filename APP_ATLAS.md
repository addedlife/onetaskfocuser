# APP ATLAS — Shamash Pro 4 (web app)

> The complete, function-by-function map of the app, built for a polish/debug/streamline
> campaign. Every entry has two layers:
> **`code:`** the technical name a developer sees, and **plain:** the same thing in
> everyday English for review.
>
> Numbering matches **APP_FEATURE_MAP.md** exactly: sections 1–9 are the same user-facing
> surfaces. Say "let's do **6.1**" and both documents refer to the same thing.
> Code-infrastructure sections (data layer, auth, orchestrator, backend) use 10+.
>
> Scope: `apps/web` (the React app you actually use) + its serverless backend.
> The native helpers (`phone-host-windows`, `shailos`, `ipad-phone-bridge`) are
> summarized at the end as adjacent systems.
>
> Status legend (filled in as we work): ⬜ untouched · 🔧 in progress · ✅ polished

---

## How to read the architecture in one breath

- **plain:** The app is one big React page. A central "brain" file (`App.jsx`) holds all
  the live state and hands it down to screens. A "warehouse" file (`01-core.js`) talks to
  the cloud database and runs all the AI. Everything else is a screen or a widget.
- **code:** Single-page React 18 app, Vite-built, Firebase (Firestore) persistence,
  Firebase Functions serverless backend, deployed to Firebase Hosting via GitHub Actions.
  `App.jsx` is the stateful orchestrator; `01-core.js` is the data + AI layer; numbered
  files `00`–`10` are feature modules; `08-app-split/` holds the split-out big pieces.

**Top-level navigation model (the "Switchboard"):**
- `suiteView` picks the major surface: `focus` (the task app) · `nervecenter` ·
  `chief` · `health` · `taskriver` · `shailos` · `deskphone`.
- Inside `focus`, `tab` picks the sub-screen: `focus` (one card at a time) · `queue`
  (the list) · `insights` (stats & AI).

---

# PART 0 — BOOT, BUILD & DEPLOY

### 0.1 `src/main.jsx` — the ignition (102 lines) ⬜
- **plain:** The very first file that runs. It decides *which* app to show: the full
  signed-in app, or — if the URL says `?standalone=deskphone` — just the bare phone
  screen that the Windows DeskPhone app embeds. Also wires up offline support and two
  dev-only diagnostic modes (`?uiaudit=1`, `?uistyle=1`).
- **code:** ReactDOM root render. Branches on `standalone`/`embedded` URL params.
  `StandaloneShell` component listens for theme pushes via `postMessage` and
  `window.chrome.webview`. Lazy-imports dev tools.
- Functions: `StandaloneShell` (theme-syncing wrapper for the embedded phone).

### 0.2 `index.html` — the HTML shell (7.1 KB) ⬜
- **plain:** The actual web page. Loads Firebase, sets up the favicon/manifest, and
  contains the redirect that sends `web.app` visitors to the canonical `firebaseapp.com`
  address (the OAuth-safe one).
- **code:** Script tags for Firebase SDK, PWA manifest link, `web.app→firebaseapp.com`
  canonical redirect, root `<div id="root">`.

### 0.3 `src/version.js` — the version stamp (45 lines) ⬜
- **plain:** Holds the single version number shown in the sidebar (`4.23.92`) and formats
  the "last updated" date/time. Bumped on every release.
- **code:** `APP_VERSION`, `APP_VERSION_DATE`, `__BUILD_TIME__` injection.
- Functions: `versionDate`, `formatVersionStamp`, `versionStampShort`.

### 0.4 `vite.config.js` + `package.json` — the build toolchain ⬜
- **plain:** The recipe that turns the source code into the optimized files the browser
  downloads. Injects the build time and git commit so the app can show them.
- **code:** Vite 6, `@vitejs/plugin-react`, `define` for `__BUILD_TIME__`/`__BUILD_COMMIT__`.
  Deps: React 18.3, firebase 10.8. Deploy: GitHub Action → `firebase deploy hosting,functions`.

### 0.5 `src/offline-support.js` — offline shell (59 lines) ⬜
- **plain:** Registers the service worker so the app still opens with no internet.
- **code:** `registerOfflineShell`, `isOfflineShellReady`, `collectOfflineUrls`. Talks to `public/sw.js`.

### 0.6 `src/diagnostics.jsx` — the diagnostics overlay (134 lines) ⬜
- **plain:** A hidden debug panel showing build commit, build time, and how long since
  the last sync — for troubleshooting.
- **code:** `DiagnosticsOverlay`, `rel(ts)` relative-time formatter.

---

# PART 1 — SWITCHBOARD  (`src/08-app-split/components/AppSuiteChrome.jsx` + `SuitePanels.jsx`)

> The left navigation rail and suite-surface wrappers — the entry point to every major screen.

### 1.1 `AppSuiteChrome.jsx` (268 lines) ✅
- **plain:** The app's left navigation rail / suite switcher (the icons that jump between
  Focus, NerveCenter, Phone, Health…), with compact/expanded states and a clock.
- **code:** `AppSuiteChrome({ active, onSelect, onRecord, onSettings, features, … })`.
  `mainApps` :6, icon buttons :91–134, `experimentalApps` :11–19; wired in `App.jsx:3615`.

### 1.2 `SuitePanels.jsx` (186 lines) ✅
- **plain:** Thin wrappers that mount the Shailos panel and the DeskPhone panel as full
  suite surfaces.
- **code:** `SuiteShailosPanel`, `DeskPhoneSuitePanel`.

---

# PART 2 — FOCUS APP: FOCUS TAB  (`src/08-app-split/App.jsx` + `src/04-components.jsx` + `src/05-modals.jsx`)

> The "one task at a time" screen: the task card, action buttons, all focus-mode widgets, and the modal library.

### 2.1 Focus-tab render (App.jsx lines ~3800–3970) 🔧
- **plain:** The actual on-screen layout of the focus tab: the colored task card, done
  button, zen button, priority circles, add box, hamburger menu, and the PostIt stack.
- **code:** Focus-tab block inside `App.jsx:~3800–3970`; mounts `ZenMode`,
  `JustStartTimer`, `BlockedModal`, `PostItStack`, `ShailaMiniPill`.

### 2.2 `src/04-components.jsx` — task UI widget library (1808 lines) 🔧

#### 2.2a Micro-feedback ⬜
- **plain:** Tap ripple, confetti burst, completion chime, auto-shrinking text, toast popup.
- **code:** `Ripple`, `Confetti`, `playCompletionSound`, `AutoFitText`, `Toast`.

#### 2.2b Badges ⬜
- **plain:** The little status chips on a task: age, energy level, context tags
  (@home/@phone…), Mrs. W, blocked, and "good enough."
- **code:** `AgeBadge`, `EnergyBadge`, `ContextBadges` (+`CTX_TAG_COLORS`/`CTX_TAG_TEXT`),
  `MrsWBadge`, `BlockedBadge`, `GoodEnoughBadge`.

#### 2.2c `ZenMode` — single-task focus mode (lines 178–548) ⬜
- **plain:** The full-screen "just this one task" view, with timers, body-double, capture,
  and brain-dump entry points.
- **code:** `ZenMode`, `ZenDumpReview`.

#### 2.2d Timers & focus tools ⬜
- **plain:** The "just start" countdown and the body-double co-working timer; the brain-dump
  pad; the overwhelm banner.
- **code:** `JustStartTimer`, `BodyDoubleTimer`, `BrainDump`, `OverwhelmBanner`, `TabBtn`, `PriEditor`.

#### 2.2e `PostItStack` — completed-task celebration stack (lines 842–1099) ⬜
- **plain:** The animated stack of finished tasks (the satisfying "look what I did" pile).
- **code:** `PostItStack`.

#### 2.2f `BlockReflectModal` (lines 1100–1220) ⬜
- **plain:** The "what's in the way?" reflection prompt for a stuck task (AI-assisted).
- **code:** `BlockReflectModal`.

#### 2.2g `ShailaManager` + `ShailaMiniPill` (lines 1221–1807) ⬜ **(Shailos-priority surface)**
- **plain:** The full shaila log panel (ask/answer tracking) and the tiny inline
  status pill. Per standing rule, shailos = highest priority surface.
- **code:** `ShailaManager`, `ShailaMiniPill`.

### 2.3 `src/05-modals.jsx` — modals (378 lines) 🔧

#### 2.3a `BulkAdd` ⬜ — **plain:** paste many tasks at once. **code:** `BulkAdd`.
#### 2.3b `TaskBD` (Break-Down / "Shatter") ⬜ — **plain:** split one task into subtasks (AI). **code:** `TaskBD`.
#### 2.3c `BlockedModal` ⬜ — **plain:** mark a task blocked for a chosen duration. **code:** `BlockedModal`, `BLOCKED_DURATIONS`.
#### 2.3d `ContextTagPicker` ⬜ — **plain:** attach @home/@phone-style tags. **code:** `ContextTagPicker`, `ALL_CTX_TAGS`.
#### 2.3e `ListManager` ⬜ — **plain:** manage your task lists. **code:** `ListManager`.

---

# PART 3 — FOCUS APP: QUEUE  (`src/08-app-split/App.jsx` queue section + `src/06-shelf.jsx`)

> The full scrollable task list and completed-task shelf.

### 3.1 Queue-tab render (App.jsx lines 4082–4367) ⬜
- **plain:** The scrollable task list with search bar, overwhelm banner, quick-add, drag-to-reorder
  rows, subtask groups, and the shelf below.
- **code:** Queue-tab block in `App.jsx:4082–4367`; `OverwhelmBanner`, `SubtaskGroup` mounted here.

### 3.2 `src/06-shelf.jsx` — the completed-task shelf (273 lines) ⬜

#### 3.2a `ShelfView` ⬜ — **plain:** the completed-tasks "shelf" (history). **code:** `ShelfView`.
#### 3.2b `SubtaskGroup` ⬜ — **plain:** a collapsible group of subtasks in the queue, with reorder/complete/shaila controls. **code:** `SubtaskGroup`.
#### 3.2c `TaskActionsShelf` ⬜ — **plain:** the row of action buttons on a shelved task. **code:** `TaskActionsShelf`.

---

# PART 4 — FOCUS APP: INSIGHTS  (`src/08-app-split/App.jsx` insights section)

### 4.1 Insights-tab render + AI (App.jsx lines 4367+) ⬜
- **plain:** Completion charts (day/week/all-time and weekday/speed/trend), the AI-written
  observation about your patterns, an AI chat box, and the rotating daily tip.
- **code:** Insights-tab block in `App.jsx:4367+`; `genAiInsight`, AI chat send/handlers,
  `aiChatHistory`; `aiInsight` state; calls through `/api/ai-proxy` Firebase Function.

---

# PART 5 — NERVECENTER  (`src/08-app-split/components/`)

> The "command center" dashboard — calendar, mail, tasks, phone, health, and the Chief of Staff AI.

### 5.1 `NerveCenterPanel.jsx` (3576 lines) ⬜ **(2nd biggest file)**
- **plain:** The "command center" dashboard: a live brief from your AI "Chief of Staff,"
  calendar/email panels, task suggestions, the analog timeline clock, and the mobile
  accordion layout. Also hosts the Chief page and routes to Health.
- **code:** `NerveCenterPanel` + many helpers:
  - **Chief brief & learning:** `buildChiefLearningProfile`, `read/writeChiefLearning`,
    `decorateTaskSuggestion`, `shouldHideTaskSuggestion`, `looksLikePreferenceUpdate`,
    `looksLikeChiefRejection`, `looksLikeDeleteConfirmation`, `findCalendarPreferenceTarget`,
    `profileNoteFromChiefText`, caching constants (`CHIEF_*`, `NC_SUMMARY_*`, `SNAPSHOT_*`).
  - **Summaries:** `nerveSummarySource`, `compactNerveSummary`, `nerveDisplaySummary`.
  - **Gmail body parsing:** `decodeBase64UrlText`, `htmlToText`, `collectGmailBodyParts`, `gmailFullBody`.
  - **Calendar logic:** `parseEventMs`, `calendarStartMs/EndMs`, `isRoutineCalendarEvent`,
    `isCalendarEventCurrent/Past`, `formatCalendarWindow`, `ROUTINE_CALENDAR_RE`.
  - **Visuals:** `TimelineFace`, `SweepBar`, `SvgSweepHand`, `MobileSection`, `MobileBox`,
    color helpers `hexToRgb`/`softBg`/`softBorder`/`hexToRgba`.

### 5.2 `HealthPage.jsx` (808 lines) ⬜
- **plain:** The full Health screen — rings, mini bar charts, metric cards, period
  switching (day/week/month/year), connect-to-Google-Health modal, and manual entry.
- **code:** `HealthPage`, `MetricCard`, `MiniBarChart`, `BigRing`, `ConnectModal`,
  `ManualEntryModal`, `SetupStep`, demo-data generators, `fmtVal`/`avg`/`pctChange`.

### 5.3 `HealthCard.jsx` (191 lines) ⬜
- **plain:** The compact health summary card shown inside the dashboard.
- **code:** `HealthCard`, `HRLine`, `MetricSection`, `formatSleep`, `avgField`.

### 5.4 `TaskRiverPanel.jsx` (360 lines) ⬜
- **plain:** The "task river" — a time-flow view blending tasks, shailos, calendar and
  email into one prioritized stream, with throttled AI ranking.
- **code:** `TaskRiverPanel`, `hexToRgb`/`rgba`, rank-throttle constants (`RANK_*`).

### 5.5 `ConvCapture.jsx` (543 lines) ⬜
- **plain:** "Conversation capture" — record a meeting or phone call, transcribe it, and
  turn it into tasks/shailos/calendar events with AI.
- **code:** `ConvCapture({ onApply, onCreateCalendarEvent, callMode, … })`.

---

# PART 6 — DESKPHONE  (`src/10-deskphone-web.jsx` + `NerveCenterPhoneSurface.jsx` + `DeskPhoneMiniDock.jsx`)

### 6.1 `src/10-deskphone-web.jsx` (6240 lines) ⬜ **(LARGEST FILE)**
- **plain:** The complete desk-phone interface — call history, text-message threads,
  contacts, dialpad, compose with attachments, image lightbox, connection rail, and the
  live link to the Windows host. This is the screen embedded in the native DeskPhone app.
- **code:** `DeskPhoneWebPanel` (the root export) plus a large supporting cast:
  - **Theme/contrast:** `buildDeskPhoneWebVars`, `dp*` color helpers, `COLORS`.
  - **Host transport:** `readJson`, `readOptionalJson`, `postJson`, `stringifyAsciiJson`,
    timeouts (`HOST_FETCH_TIMEOUT_MS`, `MEDIA_FETCH_TIMEOUT_MS`).
  - **Formatting:** phone/date/time formatters, `messagePreview`, `renderLinkedMessageText`,
    `avatarInitial`, attachment helpers, `formatFileSize`.
  - **Data shaping:** `normalizeMessage`, `normalizeAttachment`, `buildConversations`,
    `filterConversations`, `mergeMessagesWithMedia`, `enrichMessageWithContact`,
    `buildContactPhoneMap`, call grouping/sorting/filtering.
  - **Components:** `ConnectionRail`, `RailNavItem`, `ShellButton`, `CallBanner`,
    `ConversationRow`, `MessageBubble`, `MessageAttachments`, `ImageLightbox`,
    `ThreadSearchBar`, `ConversationCallHistory`, `MessagesSlice`, `ContactsSlice`,
    `NewMessageComposer`, `ComposeAttachmentTray`, `SimpleTabContent`, `ParityLedgerPanel`,
    `ReconnectPrompt`, `ContactImportPrompt`, `BuildUpdateOverlay`, `DeskPhoneIconButton`.
- **note:** At 6,240 lines this is the densest target. Likely the richest vein of
  dead code, duplicate formatters, and parity-ledger scaffolding to streamline.

### 6.2 `NerveCenterPhoneSurface.jsx` (1489 lines) ⬜
- **plain:** A second, lighter phone surface used inside NerveCenter and on mobile —
  threads, dialer, MMS images — talking to the cloud phone relay.
- **code:** `NerveCenterPhoneSurface`, `isMobilePhoneDevice`, `PhoneMmsImage`,
  phone/message helpers (`phoneDigits`, `phoneThreadKey`, `messagePeerNumber`,
  `isOutgoingMessage`, `isUnreadMessage`, `linkedMessageParts`), `fetchPhoneJson`, `relayAgeLabel`.
- **note:** Overlaps heavily with 6.1 — a deduplication candidate (two phone surfaces).

### 6.3 `DeskPhoneMiniDock.jsx` (167 lines) ⬜
- **plain:** The small always-visible phone dock (online status + quick open).
- **code:** `DeskPhoneMiniDock({ onOnlineChange, onOpenDeskPhone })`.

---

# PART 7 — SHAILOS SUBSYSTEM

### 7.1 `src/08-app-split/utils/shailosQueue.js` (187 lines) ⬜
- **plain:** The behind-the-scenes queue/logic for shailos (the questions-awaiting-answers
  system that is always top priority).
- **code:** queue helpers (see file).

### 7.2 `apps/web/shailos/` (generated bundle) ⬜
- **plain:** A separately-built mini-app embedded via iframe. Marked
  `GENERATED_DO_NOT_EDIT` — its source lives in `apps/shailos`.
- **code:** prebuilt `index.html` + `assets/*`.

---

# PART 8 — COLOR TEMPLATES

### 8.1 Palettes & schemes (`src/01-core.js` lines 1219–1295) ⬜
- **plain:** The default priority tiers, the 8 curated color themes, the random task-color
  palette, the rotating prompts, and the daily tips.
- **code:** `BEFORE_SHAVUOS_PRIORITY`, `ensureBeforeShavuosPriority`, `DEF_PRI`,
  `DEF_AGE_THRESHOLDS`, `SCHEMES` (8 themes), `PALETTE`, `PROMPTS`, `TIPS`.

### 8.2 Category color constants + clean base (`src/08-app-split/ui-tokens.jsx`) ⬜
- **plain:** The fixed semantic colors that stay the same across every theme (gold = shailos,
  blue = mail, purple = phone) and the neutral "clean" NerveCenter base palette.
- **code:** `GOLD`, `CAT_MAIL`, `CAT_PHONE`, `GV_CLEAN`, `cleanTheme()`.
- **note:** Full ui-tokens reference (spacing, radius, typography, etc.) is in Part 9.

---

# PART 9 — UI THEORY  (`src/08-app-split/ui-tokens.jsx` + `m3-stylebook.jsx` + `02-icons.jsx` + `dev/`)

### 9.1 `src/08-app-split/ui-tokens.jsx` (510 lines) ⬜
- **plain:** The shared design tokens — radii, spacing, shadows, fonts, the clean theme
  (`GV_CLEAN`), and the standard typography. The "design constants" file.
- **code:** `GV_CLEAN`, `RADIUS`, `ELEV`, `NC_TYPE`, `NC_FONT_STACK`, spacing scales.

### 9.2 `src/08-app-split/m3-stylebook.jsx` (169 lines) ⬜
- **plain:** The Material-3 "master recipes" — the single canonical look for search
  fields, chips, list rows, buttons, cards — used as the consistency reference.
- **code:** `searchField`, `filterChip`, `listRow`, `button`, `card`, `M3_SHAPE`,
  `M3_SPEC`, `M3_SCALE`, `M3_EXPECT`, `M3` bundle. (Has uncommitted local edits.)

### 9.3 `src/02-icons.jsx` (63 lines) ⬜
- **plain:** The icon set used everywhere (`IC.List`, `IC.Bulb`, …).
- **code:** `IC`, `ICON_STYLE`.

### 9.4 `src/dev/ui-audit.js` (135 lines) ⬜ **(dev-only)**
- **plain:** The `?uiaudit=1` drift logger — scans the live page for inconsistent
  radii/sizes and reports them. Read-only; never runs in production.
- **code:** `startUiAudit`, `scanUiAudit`, `classify`, `controlSurface`, `measure`, `report`.

### 9.5 `src/dev/ui-style-override.js` (92 lines) ⬜ **(dev-only)**
- **plain:** The `?uistyle=1` enforcer — at runtime forces every element to the M3 master
  look, so you can preview perfect consistency without editing source.
- **code:** `startUiStyle`, `normalize`, `classify`, `applyOne`, `styledContainer`.

---

# PART 10 — DATA & INFRASTRUCTURE LAYER  (`src/01-core.js`, 2008 lines)

> The warehouse. Everything that isn't a screen lives here: the database client, theme
> palettes, math helpers, and the entire AI gateway. **This is the highest-leverage file
> in the app** — bugs here affect everything.

### 10.1 Firebase bootstrap (lines 13–73) ⬜
- **plain:** Connects to the cloud database, sets up the project keys, and handles the
  "kick Firestore awake when the network comes back" reconnect logic.
- **code:** `firebaseConfig`, `firebase.initializeApp`, `db`, `_kickFirestore`, `resetCache` param.

### 10.2 `Store` — the persistence engine (lines 75–1218) ⬜ **(biggest single object)**
- **plain:** The librarian that reads and writes all your data — tasks, settings, shailos —
  to the cloud and to the browser, keeps them in sync across tabs and devices, and makes
  local + weekly backups. It has two storage modes ("v5" per-task documents, and the older
  whole-blob mode).
- **code:** Single object literal with ~60 methods. Key groups:
  - **Sync bookkeeping:** `_noteSync`, `getDiagnostics`, `_lastServerSyncTs`, `_lastFromCache`.
  - **Identity/keys:** `setUid`, `lsKey`, `docRef`, `tasksCol`, `settingsDoc`, `metaDoc`, `shailosCol`.
  - **Local cache:** `ls`, `ll`, `_idb` (IndexedDB), `_clean`.
  - **Backups:** `_backupCounts`, `_backupStamp`, `_backupWeekStamp`, directory-handle pickers, `parseBackup`.
  - **v5 sync:** `_saveV5`, `_listenV5`, `_flattenTasks`, `_extractSettings`, `subscribeTasks`, `subscribeSettings`.
  - **Shailos:** `listenShailos`, shaila CRUD, `reconcile` (missing/mismatch detection).
- **note:** This object is a prime candidate for the campaign — dense, security-sensitive
  (per `HANDOFF.md §9` storage refactors can wipe live data — handle with care).

### 10.3 Hebrew/date + small utilities (lines 1296–1488) ⬜
- **plain:** Helpers: clean YouTube-ish text, make unique IDs, greet by time of day,
  format durations, pick the tip of the day.
- **code:** `YC`/`cleanYT`, `uid`, `canonicalUid`, `gG`, `gP`, `dayKey`, `tipOfDay`, `fmtMs`.

### 10.4 Color-contrast engine (lines 1366–1486) ⬜
- **plain:** The accessibility math that guarantees text is always readable on any
  background, automatically darkening/lightening colors to hit contrast targets.
- **code:** `pBg`, `_lum`, `_isHexColor`, `_toHexColor`, `_contrastRatio`, `_mixHex`,
  `_readableOn`, `_readableAcross`, `ensureSchemeContrast`, `textOnColor`, `priText`, `textOnPastel`.

### 10.5 Task aging & Mrs. W priority (lines 1490–1526) ⬜
- **plain:** Logic that figures out how "old" a task is and whether the special
  recurring "Mrs. W" priority window is active right now.
- **code:** `getMrsWPriority`, `getTaskAgeHours`, `isTaskAged`, `applyTaskAging`.

### 10.6 AI gateway — transport (lines 1527–1626) ⬜ **(security-sensitive)**
- **plain:** The single front door for all AI calls. Sends requests to our own serverless
  proxy (so API keys never touch the browser), with a 30-second timeout. Supports Claude
  and Gemini; text and audio.
- **code:** `GEMINI_MODEL`, `AI_PROXY_ENDPOINT`, `normalizeAiOpts`, `callAIProxy`,
  `runAIJob`, `callGemini`, `callGeminiAudio`, `callGeminiProxy`, `callAI`.

### 10.7 AI features — the "jobs" (lines 1627–2008) ⬜
- **plain:** Each real AI capability, one function each: smart-reorder the task list,
  reorder with an explanation, suggest a first step, parse spoken shailos, generate color
  themes, detect when a question's been answered, turn a conversation into tasks, parse a
  calendar event from plain English, brain-dump → task list, summarize an answer.
- **code:** `optTasks` (non-AI sort), `aiOptTasks`, `aiOptTasksWithAnalysis`,
  `suggestFirstStep`, `aiParseShailos`, `aiGenSchemes`, `aiDetectShailaAnswers`,
  `aiParseConversation`, `aiParseCalendarEvent` (+`withCalendarEventDefaults`,
  `dateTimeHasExplicitZone`), `aiParseBrainDump`, `aiSummarizeAnswer`.

### 10.8 `src/shabbos.js` — sunset/Shabbos engine (121 lines) ⬜
- **plain:** Pure astronomy math to compute local sunset and the Shabbos start/end
  window, plus cached geolocation — so the app can behave differently on Shabbos.
- **code:** `getSunset`, `getShabbosWindow`, `getCachedLocation`, `requestLocation`,
  solar-position helpers (`toJulian`, `eclipticLongitude`, `hourAngle`, …).

---

# PART 11 — AUTH  (`src/00-auth.jsx`, 294 lines)

### 11.1 Google sign-in helpers ⬜
- **plain:** Remembers your last Google email, detects mobile vs desktop (to choose
  popup vs redirect sign-in), and decides whether to keep you signed in.
- **code:** `_readLastGoogleEmail`, `_rememberGoogleEmail`, `_isMobileOrTablet`,
  `_readStaySignedIn`, `_getAuthPersistence`, `_setAuthPersistence`, `_signInWithGoogle`,
  `_googleErrorMessage`.

### 11.2 `AuthGate` ⬜
- **plain:** The bouncer. Shows the login screen until you're signed in, then shows the app.
- **code:** `AuthGate` — Firebase `onAuthStateChanged`, renders `LoginScreen` or `App`.

### 11.3 `LoginScreen` ⬜
- **plain:** The sign-in page itself (Google button, "stay signed in", error messages).
- **code:** `LoginScreen({ onLogin, initialError })`.

---

# PART 12 — THE ORCHESTRATOR  (`src/08-app-split/App.jsx`, 4810 lines)

> The brain. One enormous React component holding ~95 pieces of live state and every
> top-level action handler. Everything below is *inside* `function App()`.

### 12.1 State inventory (lines 94–308, ~95 `useState`) ⬜
- **plain:** All the app's live memory in one place — which tab is open, the task list,
  modals open/closed, Google connection status, AI chat, health data, undo buffers, etc.
- **code:** Grouped clusters: core (`AS`, `tab`, `suiteView`, `sidebarOpen`), task editing
  (`editId`, `dragId`, `chgPri`…), modals (`showBulk`, `showBD`, `blockedModal`…), Google
  (`googleToken`, `calendarEvents`, `gmailMessages`, `googleAccounts`…), AI (`aiInsight`,
  `aiChat*`, `chiefProfile`), health (`healthData/Config/History`), phone (`deskPhoneOnline`,
  `deskPhoneDirect`), offline/network, recordings, undo buffers.
- **note:** 95 state hooks in one component is the central refactor question — see "campaign
  notes" at the end. Do **not** restructure blindly; this is load-bearing.

### 12.2 Load / Save lifecycle (lines 358–540) ⬜
- **plain:** On startup, loads your data from cloud/cache; thereafter auto-saves on change
  (debounced), flushes on tab close, and re-syncs periodically and when the tab regains focus.
- **code:** load effect, debounced `saveTmr`, `flushToLocalOnly`, visibility-change &
  beforeunload effects, cross-window sync.

### 12.3 App-config + AI options (lines 540–605) ⬜
- **plain:** Fetches server config (is the AI key present? which Google client id?) so the
  UI can light up the right features.
- **code:** `loadAppConfig`, `serverKeyAvailable`, `aiConfig`, `aiOpts` derivation.

### 12.4 Google Calendar + Gmail integration (lines 606–1196) ⬜ **(security-sensitive)**
- **plain:** Connect/disconnect Google, pull calendar events and email, summarize emails
  with AI, create/delete calendar events, manage multiple Google accounts, and silently
  refresh the token.
- **code:** `loadGoogleWorkspaceFromServer`, `fetchCalendarData`, `fetchGmailData`,
  `applyEmailSummaries` (+session cache `emailContentHash`, `pre/read/writeEmailSummarySession`),
  `connectGoogle`, `disconnectGoogle`, `loadGoogleEmailDetail`, `createGoogleCalendarEvent`,
  `deleteGoogleCalendarEvent`, `sortCalEvents`, silent-reauth cooldown logic.
- **code:** Chief-profile persistence: `appendChiefProfileNote`, `recordChiefProfileLearning`,
  `saveChiefProfileMarkdown`.

### 12.5 Real-time sync & nudges (lines 1197–1730) ⬜
- **plain:** Keeps shailos and tasks synced live across windows; fires gentle nudges
  (blocked-task resume, stale 7-day task, Mrs. W window) and the clock/minute ticks.
- **code:** shailos iframe `message` listener, shaila↔task sync effect, cross-window sync,
  Mrs. W refresh, clock tick, minute tick (snooze auto-wake), one-time shaila restore.

### 12.6 Derived state (lines 1451–1624) ⬜
- **plain:** Computes the values screens need from raw state: the active list's tasks,
  active priorities, the theme object `T`, dark-mode flag, filtered/sorted task views.
- **code:** `pris`/`ap`, theme `sc`/`T`, `isDark`, `curT`, `compT`, `effectiveCount`,
  `switchboard*` lists fed to NerveCenter/TaskRiver.

### 12.7 Task action handlers (lines 1731–2615) ⬜ **(core behavior)**
- **plain:** Every button that changes a task: add, complete (incl. "good enough" and
  legacy no-timestamp), uncomplete, delete (+undo), park/wake, edit, change priority,
  pin/move-to-top, drag-drop reorder, block/resume, clone, subtasks/groups, bulk add,
  brain-dump confirm, dedupe, and the AI optimize flows.
- **code:** `uT` (the universal task-list updater), `doOpt`, `tasksOptimize`, `manOpt`,
  `addTask`, `addVT`, `addMrsWTask`, `compTask`, `goodEnoughTask`, `legacyCompTask`,
  `uncompTask`, `undoCompTask`, `delTask`, `parkTask`, `wakeTask`, `blockTask`,
  `resumeBlocked`, `moveTop`, `unpinTask`, `handleDrop`, `chgPriority`, `cloneTask`,
  `delGroup`, `parkRestOfGroup`, `addSubtask`, `startManualGroup`, `bulkAdd`, `confirmBD`,
  `deduplicateTasks`, `startEd`/`saveEd`, `openFirstStep`/`confirmFirstStep`,
  `captureZenDump`/`applyZenDumpItems`, `polishNerveItems`.

### 12.8 Shaila handlers (lines 2167–2253) ⬜
- **plain:** Save a shaila's fields, mark "got an answer back," add one by hand, batch-add.
- **code:** `saveShailaField`, `handleShailaGotBack`, `handleAddManualShaila`, `addShailas`, `undoAging`.

### 12.9 List & priority management (lines 2398–2465) ⬜
- **plain:** Create/rename/delete/switch task lists; add/remove priority tiers.
- **code:** `addList`, `renList`, `confirmListName`, `doDelList`, `switchList`, `addPri`, `remPri`.

### 12.10 Backup/restore handlers (lines 2071–2137) ⬜
- **plain:** One-click full backup to a file, load a backup file, confirm the restore, and
  reconcile shailos after restore.
- **code:** `doFullBackup`, `doLoadBackup`, `doConfirmRestore`, `runShailaReconcile`.

### 12.11 AI insight & chat (lines 2616–2854) ⬜
- **plain:** Generates the AI insight string on the Insights tab and runs the AI chat.
- **code:** `genAiInsight`, AI chat send/handlers, `aiChatHistory`.

### 12.12 View routing & health (lines 2855–2933) ⬜
- **plain:** Switches between major surfaces, and loads/saves/syncs the Health data.
- **code:** `openCommandView`, `switchTab`, `loadHealthFromFirebase`, `saveHealthDataToFirebase`,
  `saveHealthConfigToFirebase`, `syncHealthNow`.

### 12.13 Render tree (lines ~3300–4810) ⬜
- **plain:** The actual on-screen layout: the left rail, the suite panels (NerveCenter,
  TaskRiver, Shailos, DeskPhone), and the three focus tabs (Focus card / Queue / Insights),
  plus all the modals.
- **code:** Conditional panel renders keyed on `suiteView`; the `focus`/`queue`/`insights`
  tab blocks; mounts every modal/overlay component from Parts 2–3.

---

# PART 13 — VOICE & TRANSCRIPTION

### 13.1 `src/03-voice.jsx` — `VoiceInput` (500 lines) ⬜
- **plain:** The microphone capture UI: records, transcribes, and can detect shailos and
  answers from speech. Converts audio to WAV for the AI.
- **code:** `VoiceInput`, `webmToWavBase64`, `_activeMicId`, `MIC_CONSTRAINTS`.

### 13.2 `src/09-transcription-pen.js` — pending-recordings store (164 lines) ⬜
- **plain:** A local offline queue (IndexedDB) for recordings that couldn't be transcribed
  yet — saves, lists, retries, and reports their age, so nothing is lost offline.
- **code:** `savePendingRecording`, `listPendingRecordings`, `getPendingRecording`,
  `updatePendingRecording(+Error)`, `deletePendingRecording`, `transcribePendingRecording`,
  `webmToWavBase64`, `blobToBase64`, `formatPendingAge`, `emitPendingChanged`.

---

# PART 14 — SETTINGS  (`src/07-settings.jsx`, 549 lines)

### 14.1 `SettingsModal` ⬜
- **plain:** The whole settings dialog — theme picker, AI provider, Google connection,
  backup/restore, priority/list management, and the recordings queue. Opens to a chosen tab.
- **code:** `SettingsModal({ AS, setAS, T, ap, onClose, onSignOut, … })`; tabs incl. `queue`, `google`.

---

# PART 15 — SERVERLESS BACKEND  (`apps/web/functions/`, deployed to Firebase)

> `functions/index.js` registers all HTTP endpoints. The old `backend/functions/` Netlify
> twin was deleted 2026-07-19 (recoverable from git history) — the live deploy path is
> **Firebase only**.

### 15.1 `aiProxy` (`ai-proxy.js` + `_ai-core.cjs`) ⬜ **(security-critical)**
- **plain:** The secure AI gateway. The browser never holds API keys — it calls this, which
  calls Claude/Gemini server-side. 300s timeout. Default provider Claude (per memory).
- **code:** `exports.aiProxy`, shared `_ai-core.cjs`, `_config.cjs`.

### 15.2 `appConfig` (`app-config.js`) ⬜
- **plain:** Tells the browser what's configured (AI key present? Google client id?) without
  exposing secrets.
- **code:** `exports.appConfig`.

### 15.3 `googleWorkspace` (`google-workspace.js`) ⬜ **(security-sensitive)**
- **plain:** Server-side Gmail + Calendar using stored refresh tokens (so you stay
  connected without hourly re-prompts). Known follow-up: encrypt stored OAuth tokens.
- **code:** `exports.googleWorkspace`.

### 15.4 `googleHealth` (`google-health.js`) ⬜
- **plain:** Server side of the Health integration (Google Health/Fit data).
- **code:** `exports.googleHealth`.

### 15.5 `phoneRelay` (`phone-relay.js`) ⬜ **(cost-sensitive)**
- **plain:** The cloud bridge between the phone surfaces and the Windows host. Per memory,
  naive polling here once burned ~43k Firestore reads/day — watch the read volume.
- **code:** `exports.phoneRelay`.

### 15.6 `chiefProfile` (`chief-profile.js`) ⬜
- **plain:** Stores/serves the AI "Chief of Staff" learning profile (your preferences notes).
- **code:** `exports.chiefProfile`.

### 15.7 `googleSearch` (`google-search.js`) ⬜
- **plain:** Server-side web search the AI can call.
- **code:** `exports.googleSearch`.

### 15.8 `mcp` (`mcp.js`) ⬜
- **plain:** An MCP endpoint (lets external AI tools talk to the app's data).
- **code:** `exports.mcp`.

### 15.9 `debugLog` (`debug-log.js`) + `cors-helper.js` ⬜
- **plain:** A remote logging sink for diagnostics, plus the shared CORS handler.
- **code:** `exports.debugLog`, `cors-helper.js`.

---

# PART 16 — ADJACENT NATIVE SYSTEMS (summarized, not in this campaign unless asked)

### 16.1 `apps/phone-host-windows/` — the DeskPhone host
- **plain:** The native Windows app that runs on your PC, pairs with your phone, and serves
  the phone screen on `127.0.0.1:8765`. ARM64 Release builds; needs a changelog entry per build.

### 16.2 `apps/shailos/` — the Shailos mini-app source
- **plain:** Source for the embedded shailos iframe app (its build output is in `apps/web/shailos`).

### 16.3 `apps/ipad-phone-bridge/` — iPad bridge (archival)
- **plain:** Earlier bridge experiment; rollback/archive only per BRIEF.

---

# CAMPAIGN NOTES — suggested walking order

A sensible sequence for "polish one thing at a time," lowest-risk-first:

1. **Leaf utilities & design tokens** (Parts 9, 0.3, 10.3–10.5, 10.8) — pure functions, easy
   to verify, no data risk. Warm-up wins.
2. **AI layer** (10.6–10.7, Part 15.1) — high value, well-isolated behind the proxy.
3. **Task UI components** (Parts 2, 3) — visible polish, self-contained.
4. **Voice/transcription** (Part 13).
5. **Phone surfaces** (Part 6) — biggest streamlining payoff (dedupe two surfaces, dead code).
6. **Command center** (Part 5).
7. **The orchestrator** (Part 12) — last and most carefully; it's load-bearing.
8. **`Store` / persistence** (10.2) — treat as its own mini-project; **storage refactors can
   wipe live data (`HANDOFF.md §9`)** — extra verification, never rushed.

> Process per item: read it fully → list concrete defects + streamline ops → fix →
> `npm run build` (build-gate) → smoke-test the surface → commit → push live (standing policy).
