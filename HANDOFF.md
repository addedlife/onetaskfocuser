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
14. [What Is Currently Live](#14-what-is-currently-live)
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
| AI (main app) | Gemini API — via user's personal key stored in app settings |
| AI (shared fallback) | Gemini API — via `GEMINI_API_KEY` Netlify env var, proxied through `gemini-proxy` function |
| AI model | `gemini-2.5-flash` — single constant `GEMINI_MODEL` in `01-core.js` controls all calls |
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
│   ├── 07-settings.jsx               ← Settings modal (API key, MrsW schedule, color scheme, backup)
│   ├── 08-app.jsx                    ← Main App component — all state, all task actions ⚠️ LARGEST FILE
│   └── 10-devmode.jsx                ← Dev mode panel (debug tools, data inspector)
├── shailos/                          ← Shailos sub-app (pre-built static output — do not edit directly)
├── netlify/functions/
│   ├── app-config.js                 ← Returns GEMINI_API_KEY env var to client (never hardcode keys)
│   ├── gemini-proxy.js               ← Proxies Gemini API calls — 5-minute timeout
│   ├── claude-proxy.js               ← Proxies Claude API calls — 60-second timeout
│   └── soferai-proxy.js              ← Legacy proxy (kept for safety)
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
- `gemini-proxy` timeout: **300 seconds** (needed for long AI transcriptions)
- `claude-proxy` timeout: **60 seconds**
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
  geminiKey: "",
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

All AI functions are in `src/01-core.js`, exported and used throughout the app.

### Key Constants
- `GEMINI_MODEL` (exported from `01-core.js`) — single source of truth for the model name. Change here to update everywhere. Currently `"gemini-2.5-flash"` (free tier, GA, multimodal audio support).

### Key Functions
| Function | Purpose |
|---|---|
| `callAI(prompt, aiOpts, config)` | Main text AI call — routes to Gemini or Claude based on aiOpts |
| `callGeminiAudio(gk, base64, mimeType, prompt, config)` | All audio transcription calls — uses GEMINI_MODEL |
| `aiOptTasks(tasks, pris, aiOpts)` | AI reprioritization |
| `aiParseBrainDump(text, pris, aiOpts)` | Stream-of-consciousness → task list |
| `aiParseConversation(transcript, tasks, shailos, aiOpts)` | Recorded conversation → tasks/shailos/completions |
| `aiParseShailos(text, aiOpts)` | Extracts shaila questions from text |
| `aiSummarizeAnswer(answerText, aiOpts)` | 4-6 word answer summary for shaila pills |
| `suggestFirstStep(taskText, aiOpts)` | Concrete first step suggestion |
| `aiDetectShailaAnswers(shailas, aiOpts)` | Checks if shailas have been answered |

### Key Rule: Research Tool Format
Shaila research must use `google_search: {}` — NOT `googleSearch`. Wrong format silently fails.

### Key Rule: AI Key Resolution
`callAI` automatically uses the user's personal Gemini key if set, otherwise falls back to the shared server key via `gemini-proxy`. Always pass `aiOpts` (the object from `08-app.jsx`) — never hardcode keys.

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

**Conversation Capture**: Universal Conversation Recorder — record → transcribe (Yeshivish-aware) → AI extract tasks/shailos/completions → review card → approve → add to queue. Two modes: regular mic and phone call (screen audio)

**UI**: Board view (PostItStack), Queue view with search/filter, Shelf view, cross-window sync, color scheme picker with AI-generated schemes, Firebase offline banner

**Data**: Weekly auto-backup to user folder (silent) or browser download, emergency restore via `?restoreLocal=1`, dev mode panel

---

## 13. Subsystems

### Shailos Sub-App (`/shailos/`)
Separate React + TypeScript + Vite app for transcribing halachic question sessions. Shares Firebase project and auth session with main app. Theme syncs via localStorage → CSS vars.

To update: edit source in sto-src → build → copy `dist/*` to `sandbox/shailos/` → commit.

### Netlify Functions
| Function | Purpose | Timeout |
|---|---|---|
| `app-config.js` | Returns `GEMINI_API_KEY` to client | default |
| `gemini-proxy.js` | Proxies Gemini calls for users without personal key | 5 min |
| `serper-proxy.js` | Proxies Serper.dev Google Search API for shaila research | default |
| `claude-proxy.js` | Proxies Claude API calls | 60 sec |
| `soferai-proxy.js` | Legacy — do not remove | default |

---

## 14. What Is Currently Live

- **Universal Conversation Recorder**: full in-app flow — record → transcribe (Yeshivish-aware) → AI extracts tasks/shailos/schedule/got-backs → review card → user approves → items added to queue
- **FAB**: 2 large buttons (record shaila, record conversation), 2 compact links (Add | Records)
- **Shailos transcriber**: all fields editable, AI-generated answer summary on minicards and shaila pills (regenerates when answer changes)
- **Shailos research**: background-capable — spinner stays on list card even when viewing a different shaila; result auto-scrolls into view when it arrives; `selectedShaila` syncs from Firestore so result appears without re-selecting
- **Queue · N pill** on focus/launchpad view
- **Theme sync**: Shailos inherits main app color scheme
- **AI models**: `gemini-2.5-flash` for all AI calls — unified via `GEMINI_MODEL` constant in `01-core.js`. Free tier, GA/stable, multimodal (audio+text). All raw `fetch` calls to the Gemini API have been replaced with `callGemini` / `callGeminiAudio` — no more hardcoded model strings scattered across files.
- **Research**: multi-step parallel search — (1) Gemini generates 3 different search queries (broad halachic, specific scenario, posek/agency angle), (2) all 3 run simultaneously via Serper.dev, (3) Gemini checks for gaps and fires 1-2 targeted follow-ups if needed, (4) Gemini reads all snippets → one line per relevant article (what THAT source says, no synthesis/psak) + seforim links. Output documents all search queries used. Requires `SERPER_API_KEY` Netlify env var.
- **aiDetectShailaAnswers**: removed "copy verbatim" instruction — now writes clean halachic ruling preserving content.

---

## 15. Recent Git History

```
(pending) fix: unified AI pipeline — GEMINI_MODEL constant, callGeminiAudio, fix gemini-2.5-pro broken calls
7a148f4 feat: research via Serper.dev real Google search + Gemini summarization — no grounding tool
32bb762 feat: research via gemini-3-flash-preview + google_search grounding — real source URLs
5853720 fix: research — drop google_search tool (hangs on 3.1-pro), use model knowledge with strong citation prompt
1da5ef8 feat: AI answer summary in shailos transcriber minicards
1cbfc76 feat: AI-generated 6-word answer summary for shaila pills
e56d25e fix: answer snippet first 6 words + whitespace-nowrap in transcriber minicards
5d424d3 fix: answer snippet = first 6 words, single line enforced
5818d13 fix: aiParseConversation uses temperature 0.1 + 8192 tokens
9a8d177 fix: shailos Record Call delegates to parent ConvCapture via postMessage
cc27108 fix: shailos Record Call button → delegates to main app ConvCapture
982d4d1 fix: research back to gemini-3.1-pro-preview + smarter answer snippet
52a6aa9 fix: smarter answer snippet — first meaningful clause, not just first 3 words
45e00c2 feat: answer snippet on shailos transcriber minicards
61c92f8 fix: correct button wiring, callMode for phone capture, stronger shaila detection
24c4eee fix: remove duplicate export of webmToWavBase64 (build was broken)
99c2093 feat: answer synopsis on answered/got-back shaila pills
370b08f feat: Universal Conversation Recorder + wire phone FAB
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
