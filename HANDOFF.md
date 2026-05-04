# OneTaskFocuser — Living Project Document

> This file is automatically rewritten by Claude before every commit. It is always current.
> Start here. You should not need to read the source code to understand how to work on this app.

---

## Table of Contents
1. [What This App Is](#1-what-this-app-is)
2. [Who You Are Working With](#2-who-you-are-working-with)
3. [Tech Stack](#3-tech-stack)
4. [Repository Structure](#4-repository-structure)
5. [Local Development](#5-local-development)
6. [Deploy Workflow](#6-deploy-workflow)
7. [Architecture](#7-architecture)
8. [Data Model](#8-data-model)
9. [AI Integrations](#9-ai-integrations)
10. [Coding Conventions](#10-coding-conventions)
11. [Safety Rules — Read Before Touching Anything](#11-safety-rules--read-before-touching-anything)
12. [Feature Inventory](#12-feature-inventory)
13. [Subsystems](#13-subsystems)
14. [What Is Currently Live / Prepared](#14-what-is-currently-live--prepared)
15. [Recent Git History](#15-recent-git-history)

---

## 1. What This App Is

**OneTaskFocuser** is a personal focus task manager for a single user (Yosef Danziger, `rabbidanziger`).

Core philosophy: show one task at a time, AI-prioritized, ADHD-friendly. The app surfaces what to do *right now* and gets out of the way. It is not a general-purpose to-do app.

- **Live URL**: https://onetaskfocuser.netlify.app
- **Shailos sub-app**: https://onetaskfocuser.netlify.app/shailos/
- **GitHub**: https://github.com/addedlife/onetaskfocuser

---

## 2. Who You Are Working With

**User**: Yosef Danziger — intelligent and curious, not a programmer.

### Coding Coach Mode — Always On
After every meaningful action (file read, edit, command), add 1–3 sentences of plain-English explanation. Define programming terms naturally in context. Warm and direct tone — never condescending. The code itself is never simplified — only the explanations.

### Work Style
- Prefers autonomous work — give status summaries, not step-by-step narration
- Only confirm before risky or irreversible actions
- Don't ask about small decisions — just make them and explain briefly

---

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + JSX |
| Database | Firebase Firestore |
| Auth | Firebase Auth (email/password + Google) |
| Hosting | Netlify (static + serverless functions) |
| Build | `npm run build` via Vite — Netlify runs this on every push |
| AI gateway | One Netlify endpoint: `ai-proxy` routes text, audio transcription, and research analysis |
| AI provider | Gemini via server-side `GEMINI_API_KEY`; browser code never calls provider APIs directly |
| AI model | One selected Gemini model controls text, voice transcription, and research analysis |
| Shailos sub-app | React 18 + Vite + TypeScript (separate build) |

**Important**: This is a Vite app with a real build step — not the old CDN/Babel setup. `npm run build` compiles everything in `src/` into `dist/`. Netlify runs this automatically on push.

---

## 4. Repository Structure

```
sandbox/                              ← Git repo root — ONLY deploy from here
├── src/                              ← Main app source (Vite builds this → dist/)
│   ├── main.jsx                      ← Entry point: renders <App> inside <AuthGate>
│   ├── 00-auth.jsx                   ← Firebase Auth gate, Google sign-in, canonicalUid()
│   ├── 01-core.js                    ← Store, Firebase init, all AI functions, constants ⚠️ CRITICAL
│   ├── 02-icons.jsx                  ← SVG icon components (IC component)
│   ├── 03-voice.jsx                  ← Voice recording, WebM→WAV conversion, VoiceInput component
│   ├── 04-components.jsx             ← All shared UI components (ZenMode, BrainDump, ShailaManager, etc.)
│   ├── 05-modals.jsx                 ← Modal dialogs (BulkAdd, TaskBD, BlockedModal, etc.)
│   ├── 06-shelf.jsx                  ← Completed tasks shelf + SubtaskGroup
│   ├── 07-settings.jsx               ← Settings modal (single AI model, MrsW schedule, color scheme, backup)
│   ├── 08-app.jsx                    ← Main App component — all state, all task actions ⚠️ LARGEST FILE
├── shailos/                          ← Shailos sub-app (pre-built static output — do not edit directly)
├── netlify/functions/
│   ├── _ai-core.cjs                  ← Shared AI gateway logic
│   ├── ai-proxy.js                   ← Single active AI endpoint for text/audio/research
│   ├── app-config.js                 ← Safe AI config/availability, no raw keys
│   ├── gemini-proxy.js               ← Compatibility wrapper around ai-proxy
│   ├── claude-proxy.js               ← Legacy endpoint name; routes old callers into ai-proxy/Gemini
│   ├── serper-proxy.js               ← Search proxy for Shailos research source gathering
├── dist/                             ← Vite build output — do not edit, regenerated on every build
├── index.html                        ← HTML shell — loads /src/main.jsx via Vite module
├── vite.config.js                    ← Vite config (React plugin, port 3000, dist output)
├── netlify.toml                      ← Build command, function timeouts, redirect rules, cache headers
├── package.json                      ← Dependencies: react, react-dom, firebase, vite
└── HANDOFF.md                        ← This file — auto-updated before every commit
```

**Shailos source** (separate folder, built independently):
`C:\Users\ydanz\OneDrive\Documents\taskmanager app\backup\sto-src\Shaila-Trancriber-Organizer-main\`

To update Shailos: build there → copy `dist/` contents into `sandbox/shailos/` → commit + push.
Netlify's build command (`npm run build && cp -r shailos dist/`) copies the pre-built Shailos into the main dist automatically.

---

## 5. Local Development

```bash
cd "C:\Users\ydanz\OneDrive\Documents\taskmanager app\sandbox"
npm install       # first time only
npm run dev       # starts dev server at http://localhost:3000
```

The dev server hot-reloads on file save. Firebase connects to the live production database — all writes in dev go to the real `rabbidanziger` account. There is no separate dev/staging environment.

---

## 6. Deploy Workflow

**One command:**

```bash
cd "C:\Users\ydanz\OneDrive\Documents\taskmanager app\sandbox"
git add <specific files>
git add HANDOFF.md
git commit -m "description of change"
git push
```

GitHub → Netlify webhook → Netlify runs `npm run build && cp -r shailos dist/` → live in ~60 seconds.

### Rules
- **NEVER push without user saying "yes", "deploy", or "push it"** — always ask first
- **NEVER use**: `safe-deploy.ps1`, `deploy.bat`, `deploy_api.ps1`, raw Netlify API calls — all deprecated
- **NEVER deploy from** `Claude Code OneTask Project\` — dead legacy folder, not connected to git

### Netlify Config Highlights
- `ai-proxy` and `gemini-proxy` timeout: **300 seconds** (needed for long AI transcriptions)
- `/assets/*`: immutable cache (Vite hashes filenames)
- `/index.html`: no-cache (users always get latest deploy instantly)
- Several admin files (including this one) are redirected to 404 — in the repo but blocked from public access

---

## 7. Architecture

### Auth Flow
1. `<AuthGate>` (in `00-auth.jsx`) wraps the entire app — shows login screen until Firebase Auth resolves
2. On sign-in, `canonicalUid(user)` strips the email to a prefix: `rabbidanziger@anything` → `"rabbidanziger"`
3. Passes `user` to `<App>`, which immediately calls `Store.setUid(canonicalUid(user))`

### State Management
- Single large React component: `<App>` in `08-app.jsx`
- All app state lives in `AS` via `useState(null)` — loaded async from Firebase on mount
- No Redux, no Zustand — plain React state with ~60 state variables

**Key state shortcuts:**
```js
AS          // full app state object
setAS(fn)   // update state — always pass a function, never the object directly
uT(fn)      // mutate the active list's tasks array
curT        // = displayedActT[0] — the current focused task
pris        // = AS.priorities.filter(p => !p.deleted) — active priorities
T           // = SCHEMES[AS.colorScheme] — current theme object
```

### Data Flow
```
App mounts
  → Store.load()
    → Tries Firebase (server first, then offline cache)
    → Sets _fbLoadStatus: 'ok' | 'empty' | 'error'
    → Falls back to localStorage ONLY if Firebase is unreachable
  → setAS(loadedState) + setLoaded(true)

User action → setAS(newState)
  → Save effect fires (debounced 1500ms)
    → Store.ls(state)           — writes localStorage cache
    → Store.saveToFB(state)     — writes Firebase (guarded — see Safety Rules)
    → Store.autoFileBackup()    — weekly JSON backup

Firestore onSnapshot listener
  → Fires when another device saves
  → Compares _lsModified timestamps — adopts remote if newer
  → Sets adoptedRemote.current = true to skip echo-back save (prevents sync loop)
```

### Storage Layers
| Layer | Purpose | Key/Path |
|---|---|---|
| Firebase Firestore | Source of truth | `users/{uid}/appData/appState_v4` |
| localStorage | Offline cache only | `onetaskonly_v4_{uid}` |
| IndexedDB | Backup folder handle | `onetask_fsa` DB, `kv` store |
| File backup | Weekly JSON dump | `onetask_backup_{year}_W{week}.json` |

---

## 8. Data Model

### App State (AS)
```js
{
  lists: [{ id, name, tasks: [...] }],
  activeListId: "default",
  priorities: [
    { id: "now",        label: "Now",        color: "#E09AB8", weight: 3 },
    { id: "today",      label: "Today",      color: "#E0B472", weight: 2 },
    { id: "eventually", label: "Eventually", color: "#7EB0DE", weight: 1 },
    // + user-defined custom priorities
    // "shaila" is a virtual priority — not stored here, used as task.priority value
  ],
  colorScheme: "claude",
  zenEnabled: false,
  aiModel: "",            // empty = server default; otherwise selected Gemini model for all AI jobs
  completionSound: true,
  overwhelmThreshold: 7,
  ageThresholds: { now: 1, today: 3, eventually: 7 },
  mrsWWindows: { monThu: { start: "08:30", end: "13:00" }, fri: { start: "08:30", end: "10:00" } },
  autoOptimize: false,
  currentEnergy: null,     // "high" | "low" | null
  _lsModified: 1234567890, // timestamp — cross-device sync key
}
```

### Task Object
```js
{
  id: "lx4k2abc9",       // uid() — base36 timestamp + random chars
  text: "Call Dr. Smith",
  priority: "now",        // "now" | "today" | "eventually" | "shaila" | custom id
  completed: false,
  createdAt: 1700000000000,
  energy: null,           // "high" | "low" | null
  context: [],            // context tag strings
  blocked: false,
  blockedAt: null,
  blockedReason: "",
  shailaId: null,         // links to a Shaila document in Firebase
  parentTask: null,       // id of parent (subtasks only)
  autoAged: false,        // was auto-promoted by aging system?
  agedFromPriId: null,    // original priority before auto-aging
  snoozedUntil: null,     // ms timestamp — hidden until then
  firstStep: null,        // AI-suggested first step
}
```

---

## 9. AI Integrations

The active AI architecture is one server gateway and one selected Gemini model. Text, voice transcription, and research analysis all use that same model selection.

### Key Gateway Files
| File | Purpose |
|---|---|
| `netlify/functions/_ai-core.cjs` | Central Gemini model selection, CORS, text/audio handling |
| `netlify/functions/ai-proxy.js` | Main public AI endpoint for all app and Shailos AI calls |
| `netlify/functions/app-config.js` | Publishes safe AI availability/model config; never sends raw keys to the browser |
| `netlify/functions/gemini-proxy.js` | Compatibility wrapper for old bundles; forwards into `_ai-core.cjs` |
| `netlify/functions/claude-proxy.js` | Legacy endpoint name for old bundles; forwards into Gemini through `_ai-core.cjs` |
| `netlify/functions/serper-proxy.js` | Search data source for research; not the AI model |

### Key Client Functions
| Function | Purpose |
|---|---|
| `callAI(prompt, aiOpts, config)` | Main text AI call through `ai-proxy` |
| `callGeminiAudio(aiOpts, base64, mimeType, prompt, config)` | Audio transcription call through `ai-proxy` |
| `aiOptTasks(tasks, pris, aiOpts)` | AI reprioritization |
| `aiParseBrainDump(text, pris, aiOpts)` | Stream-of-consciousness → task list |
| `aiParseConversation(transcript, tasks, shailos, aiOpts)` | Recorded conversation → tasks/shailos/completions |
| `aiParseShailos(text, aiOpts)` | Extracts shaila questions from text |
| `aiSummarizeAnswer(answerText, aiOpts)` | 4-6 word answer summary for shaila pills |
| `suggestFirstStep(taskText, aiOpts)` | Concrete first step suggestion |
| `aiDetectShailaAnswers(shailas, aiOpts)` | Checks if shailas have been answered |

### Key Rule: AI Key Resolution
All active app AI calls go browser → `/.netlify/functions/ai-proxy` → Gemini. The active model key lives only in the Netlify env var `GEMINI_API_KEY`; `SERPER_API_KEY` is optional for research search. `app-config` returns availability, defaults, and model lists, not secrets.

### Key Rule: AI Job Types
Text, audio transcription, and research analysis use the same selected Gemini model. Voice is still a separate transcription request first, then normal text AI. Shailos call recordings also transcribe first and parse second for better accuracy. Shailos research still uses Serper for search snippets, then the AI analysis step goes through `ai-proxy`.

---

## 10. Coding Conventions

- **Inline styles only** — no CSS classes except `@keyframes` in `index.html`
- **Theme**: `T = SCHEMES[AS.colorScheme]` — always use `T.bg`, `T.card`, `T.tFaint`, etc. for colors
- **Fonts**: `system-ui` for UI; `Georgia, serif` for task text
- **State**: always functional updates — `setAS(prev => ({ ...prev, key: val }))`
- **Tasks**: mutate via `uT(fn)` — never mutate `AS.lists` directly
- **Tone**: calm, passive styling — no harsh reds or alarming visuals
- **IDs**: use `uid()` from `01-core.js` for new task/list IDs

---

## 11. Safety Rules — Read Before Touching Anything

### 🔴 Never Push Without Confirmation
Never run `git push` without the user saying "yes", "deploy", or "push it". Always confirm first.

### 🔴 Never Touch Firebase Safety Guards
`Store.saveToFB()` in `01-core.js` contains guards that prevent blank state from overwriting real Firebase data. `Store._fbLoadStatus` must be `'ok'` or `'empty'` before any save is allowed.

**Why**: The user's entire task history was once wiped because empty localStorage triggered a blank save to Firebase in 50ms. These guards prevent that from ever happening again. Removing or weakening them is a hard blocker.

### 🔴 Never Change Firebase Config
`apiKey`, `projectId`, `appId`, `authDomain` in `01-core.js` — never change.

### 🔴 Read the File Before Editing
Always read the current `sandbox/` version of a file before editing. Never edit from memory.

### 🔴 Update HANDOFF.md Before Every Commit
Rewrite this file before every `git commit`. Update sections 14 and 15 at minimum. `git add HANDOFF.md` with the commit.

### 🟡 Plan Before Non-Trivial Changes
For any significant feature or architectural change: produce a structured plan (what, why, files affected, security, data layer, rollback) and get confirmation before implementing.

---

## 12. Feature Inventory

All of these are built and working. Do not rebuild them.

**Core**: Single-task focus view, three priority tiers, custom priorities, AI reprioritization, drag-and-drop queue, undo delete/park, multiple lists

**Focus aids**: Zen Mode, Brain Dump → AI parse → review, Body Double Timer, Just Start Timer, Overwhelm Banner, Block Reflect Modal

**Smart features**: Energy filter, context tags, age hints, auto-aging, BlockedBadge, MrsW schedule overlay, AI first step, AI Insights tab, AI Chat

**Shailos**: Shaila tasks in queue, ShailaManager panel, ShailaMiniPills, shaila research, answer synopsis on pills, links to Shailos sub-app

**Conversation Capture**: Universal Conversation Recorder — record → transcribe (Yeshivish-aware) → AI extract tasks/shailos/completions → review card → approve → add to queue. Two modes: regular mic and phone call (screen audio). Transcription failures fall back to Web Speech text instead of crashing. Extraction prompt explicitly pulls all items — a single recording may yield 10+ tasks/shailos.

**UI**: Board view (PostItStack), Queue view with search/filter, Shelf view, cross-window sync, color scheme picker with AI-generated schemes, Firebase offline banner

**Data**: Weekly auto-backup to user folder (silent) or browser download, emergency restore via `?restoreLocal=1`

---

## 13. Subsystems

### Shailos Sub-App (`/shailos/`)
Separate React + TypeScript + Vite app for transcribing halachic question sessions. Shares Firebase project and auth session with main app. Theme syncs via localStorage → CSS vars. AI route/model config syncs via `onetask_ai_config` in localStorage and all Shailos AI calls route through `/.netlify/functions/ai-proxy`.

To update: edit source in sto-src → build → copy `dist/*` to `sandbox/shailos/` → commit.

### Netlify Functions
| Function | Purpose | Timeout |
|---|---|---|
| `_ai-core.cjs` | Shared Gemini gateway logic for text/audio/research | n/a |
| `ai-proxy.js` | Single active AI endpoint | 5 min |
| `app-config.js` | Returns safe AI availability/defaults/model list, never raw keys | default |
| `gemini-proxy.js` | Compatibility wrapper around `ai-proxy` | 5 min |
| `serper-proxy.js` | Proxies Serper.dev Google Search API for shaila research | default |
| `claude-proxy.js` | Legacy endpoint name; routes old callers into `ai-proxy`/Gemini | default |

---

## 14. What Is Currently Live / Prepared

- **NerveCenter left sidebar nav** (`AppSuiteChrome` in `08-app.jsx`): Top banner removed. Navigation now lives in a fixed left sidebar. Open = 152px with NerveCenter hub + labels for Tasks/Shailos/Phone. Collapsed = 40px icon-strip. Toggle chevron at the bottom. Content area shifts with `marginLeft` CSS transition. All fixed-position panels (NerveCenterPanel, SuiteShailosPanel, DeskPhoneSuitePanel) now use `inset: 0 0 0 ${sidebarW}px` instead of `80px 0 0`. `sidebarOpen` state in main App; `sidebarW` computed as `sidebarOpen ? 152 : 40`, zero when zen mode hides the shell.
- **NerveCenter phone column fixes** (`NerveCenterPhoneSurface` in `08-app.jsx`):
  - `post()` now checks `res.ok` and parses `data.success === false` / `data.error` — send failure from DeskPhone is surfaced as an error instead of silently succeeding
  - `callDirIcon`: numeric type codes supported (2=outgoing before 1=incoming); outgoing checked BEFORE incoming to prevent "outgoing" string matching `.includes("in")` wrongly
  - `msgDirIcon`: Android SMS numeric type codes (1=inbox, 2=sent, 4=outbox, 5=failed); outgoing checked with many string variants (`fromMe`, `isSent`, folder names)
  - Message preview: full text shown with wrap (`whiteSpace: normal, wordBreak: break-word`) — no more truncation
  - `callNameMap` useMemo built from call history objects (calls carry name directly); used as fallback in `lookupName` when contacts API doesn't resolve a number
- **NerveCenter phone column — full UX restructure** (in `08-app.jsx`, `NerveCenterPhoneSurface`):
  - Compose area moves to **TOP** of the column (above messages/calls lists), not bottom
  - **New-message flow**: pencil (edit) button next to keypad toggle opens a contact-search input at top; pick a contact → textarea appears → send. Row SMS icon also opens compose at top. Row call icon dials directly (no compose).
  - Number input only visible when **dialer is open** (keypad toggle)
  - Answer/hangup + Record + Record-call buttons in a slim **control bar** above the lists
  - **Idle status fixed**: raw "Idle"/"None"/"Available" call state values normalized to `""` so status bar shows "Connected · [DeviceName]" instead of "Idle"
  - **Contact lookup improved**: extended phone field names (Telephone, CellPhone, WorkPhone, HomePhone, etc.) + last-7 digit fallback matching so message senders resolve to names just like callers
  - **Contact search digit threshold** lowered from `>= 2` to `>= 1` — single digit now triggers numeric search; search works in both dialer and compose-new modes
  - **AB action buttons** (call/text on each row) are white/neutral — no longer green
  - **SMS direction icons**: incoming shows `sms`, outgoing shows `outgoing_mail`; unread contacts display in bold (fw 900)
  - **Shailos column**: research-type tasks (`type === "shaila-research"` / `"shailo-research"`) filtered out of the active/get-back section — only pure get-back tasks appear until research is complete
- **DeskPhone web screen** (`src/10-deskphone-web.jsx`): full screen written by a second developer (5 commits on main branch). **Do not touch this file.** It is included in every deploy automatically — no special action needed.
- **NerveCenter** (formerly Switchboard): unified 3-column command dashboard — Tasks | Shailos | Phone. Reached via `?suite=nervecenter` (or legacy `?suite=switchboard` still works). Material 3 design throughout: priority color bars + named priority chips per row, gold (#C9923C) visual identity for all shailos/shaila-work, M3 contact list in phone column with compose-on-select. `DeskPhoneMiniDock` floating pill removed — redundant. "Tasks" back button removed from panel header. Nav bar renamed hub icon + "NerveCenter" label.
- **Universal Conversation Recorder**: full in-app flow — record → transcribe (Yeshivish-aware) → AI extracts tasks/shailos/schedule/got-backs → review card → user approves → items added to queue
- **FAB**: 2 large buttons (record shaila, record conversation), 2 compact links (Add | Records)
- **Shailos transcriber**: all fields editable, AI-generated answer summary on minicards and shaila pills (regenerates when answer changes)
- **Shailos research**: background-capable — spinner stays on list card even when viewing a different shaila; result auto-scrolls into view when it arrives; `selectedShaila` syncs from Firestore so result appears without re-selecting
- **Queue · N pill** on focus/launchpad view
- **Theme sync**: Shailos inherits main app color scheme
- **AI gateway deep-clean**: active app and Shailos source route text, audio transcription, and research analysis through `/.netlify/functions/ai-proxy`; one Gemini model setting from `app-config`/Settings controls all jobs. Browser code no longer calls provider APIs directly.
- **Voice/call transcription quality pass**: main voice and Shailos recordings use cleaned microphone constraints; Shailos call recordings transcribe audio first and parse the transcript second instead of asking one model call to do both jobs at once.
- **Shared transcription holding pen**: Main voice input, conversation capture, task-breakdown mic, and Shailos audio save to the same IndexedDB store before AI processing. Failed quota/rate-limit calls remain in a visible holding pen with Retry/Delete controls instead of losing the recording. Shailos Retry resumes the Shailos processing path; main-app Retry currently returns a recoverable transcript/copy rather than fully replaying every original button action.
- **Compatibility proxies**: `gemini-proxy.js` and the legacy `claude-proxy.js` name remain as wrappers around the central Gemini gateway so old bundles or cached clients do not break mid-deploy.
- **Research**: multi-step parallel search still uses Serper.dev for search results, then routes all AI query generation, follow-up analysis, and source summarization through the shared AI gateway. Output documents all search queries used. Requires `SERPER_API_KEY` Netlify env var for search.
- **Insights tab — Activity Charts**: pure-SVG charts (no library). Top section: bar chart with 4 range tabs (24h by hour, 7 days, 30 days, all-time peak hours) + total done counter. Middle: priority donut chart with legend and percentages. Bottom: secondary chart panel with 4 switchable views — Day of Week (all-time bar by Su–Sa), Speed (histogram of how fast tasks complete: <1h/<1d/<1w/<1mo/1mo+), Trend (filled area/line chart, last 30 days), Cumulative (running total, last 90 days). All charts use app theme and priority colors.
- **Shaila sort order**: new shaila tasks and Now tasks immediately surface to top of queue on add — `doOpt`/`optTasks` now applied in `addTask`, `addVT`, and the reconciliation listener.
- **Shaila duplicate fix**: reconciliation listener registers new shailaIds in `pendingShailaIds.current` before returning state — prevents the next `_listenV5` snapshot from re-creating tasks that were just added.
- **Auto-save format**: `autoFileBackup` now matches `fullBackup` format exactly (`_backupVersion: 1`, `_clean()`, fresh shailos fetched from Firestore). Old `_version: 2` format could not be restored via `parseBackup`.
- **Home priority**: fully removed from Firestore settings doc, filtered out of all pickers, insights, and AI prompts. `_listenV5` strips it from any incoming Firestore state so it can never re-appear.
- **Google Nervecenter** (Calendar + Gmail on NerveCenter): Settings → Google tab → paste OAuth 2.0 Client ID → NerveCenter bottom row shows "Connect Google" button → GIS popup → Calendar card (today's events with live "now" indicator) + Gmail card (important & unread, sender/subject/snippet). Auto-refreshes every 15 min. `AS.googleClientId` stored in Firebase settings; OAuth token lives only in component state (never persisted). Requires Google Cloud project with Calendar API + Gmail API enabled and an OAuth 2.0 Web Client ID with `https://onetaskfocuser.netlify.app` as an authorized origin. Cards are **not** on the Focus tab — they live only in NerveCenter. Each card has internal scroll, no page scroll. Calendar+Gmail run independently via `Promise.allSettled` — one failure doesn't block the other. Error surfaces the actual API error message for easy debugging.
- **Default home = NerveCenter**: `getInitialSuiteView()` now returns `"nervecenter"` — app opens to the three-column command dashboard instead of the focus tab.
- **CHANGELOG.md created**: `CHANGELOG.md` in repo root documents all recent feature additions and fixes, intended for multiple developers working on the codebase.
- **aiDetectShailaAnswers**: removed "copy verbatim" instruction — now writes clean halachic ruling preserving content.

---

## 15. Recent Git History

Latest: NerveCenter fixed viewport layout (no page scroll) + Google Calendar/Gmail as fixed-height bottom strip; each card scrolls internally.

```
(pending push) fix: NerveCenter single-screen layout + Google strip with internal scroll
becb7df fix: Google Calendar + Gmail data not loading after connect
04849e3 feat: Google cards on NerveCenter, default home to NerveCenter, CHANGELOG
8adf72a Update HANDOFF.md — catch up on missed updates from last 5 commits
697dd6f Proxy: reject stale Gemini model names, fall back to gemini-2.5-flash
a31a00c Replace heatmap with 4-option secondary chart panel in Insights
a3d5a77 Add activity charts to Insights tab
3286372 Fix shaila duplicates, auto-save format, and new-task sort order
e57e330 fix: root out home priority — direct Firestore patch + block restoration via _listenV5
c94d7eb fix: strip home priority from array on every load — survives Firebase round-trips
82c6cc6 fix: filter deleted priorities at pris source — removes home from all pickers and insights
3dc2693 fix: route text AI calls through gemini-proxy when no personal key — server key never leaves browser
48ebad8 fix: unified AI pipeline — single GEMINI_MODEL constant, callGeminiAudio helper, eliminate scattered raw fetches
6ccc2fb fix: revert model to gemini-3.1-pro-preview (current Google top model April 2026)
```

---

## Access Reference

| Resource | Value |
|---|---|
| Live site | https://onetaskfocuser.netlify.app |
| GitHub | https://github.com/addedlife/onetaskfocuser |
| Netlify site ID | `c603b156-f9ee-4b67-bcf4-d4b7f64fbccd` |
| Netlify admin | https://app.netlify.com/projects/onetaskfocuser |
| Firebase project | `onetaskonly-app` |
| Firebase user UID | `rabbidanziger` |
| Firebase API key | `AIzaSyB5UiDE9s0xjWeYa4OQ1LLJ63EwPVoSLrA` *(public client key — safe to expose)* |
| Gemini key | Netlify env var `GEMINI_API_KEY` — never hardcode, always use `app-config` function |
