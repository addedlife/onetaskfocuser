# OneTaskFocuser — Handoff Document (2026-04-05)

> Give this entire file to a new Claude session. It replaces the need to read all the code.

---

## 1. WHO YOU'RE WORKING WITH

- **User**: Yosef Danziger (`rabbidanziger`) — intelligent and curious, not a programmer
- **Coding Coach Mode is ALWAYS ON**: After every meaningful action, add 1–3 sentences of plain-English explanation. Define programming terms when they come up naturally. Warm, direct tone — never condescending. Never simplify the code itself, only the explanations.
- **Work style**: He prefers autonomous work. Give status summaries, not step-by-step narration. Only confirm before risky/irreversible actions. Don't ask about small decisions.

---

## 2. THE APP

- **Name**: OneTaskFocuser (internal: OneTask)
- **Purpose**: A focus task manager — shows one task at a time, AI-prioritized. ADHD-friendly. Features: zen mode, brain dump, multiple lists, energy filtering, queue, Shailos tracker, Universal Conversation Recorder.
- **Live URL**: https://onetaskfocuser.netlify.app
- **Shailos sub-app**: https://onetaskfocuser.netlify.app/shailos/
- **GitHub**: https://github.com/addedlife/onetaskfocuser

---

## 3. TECH STACK

| Layer | Tech |
|---|---|
| Frontend (main app) | React 18 + Vite + JSX — full build step (no CDN Babel) |
| Frontend (Shailos) | React 18 + Vite + TypeScript |
| Database | Firebase Firestore |
| Auth | Firebase Auth (email/password + Google) |
| Hosting | Netlify (static) |
| AI (task app) | Gemini — user's key from settings, direct fetch |
| AI (Shailos) | Gemini via `gemini-proxy` Netlify function (`GEMINI_API_KEY` env var) |
| AI model | `gemini-3.1-pro-preview` (default); `gemini-2.0-flash` for shaila research |

**Important**: The app uses Vite with a real build step. Netlify runs `npm run build && cp -r shailos dist/` automatically on push. Do NOT treat it as the old CDN/Babel setup described in the archived HANDOFF.md.

---

## 4. FILE STRUCTURE

```
sandbox/                          ← GIT REPO ROOT — deploy from here ONLY
├── src/                          ← main app source (Vite builds this)
│   ├── main.jsx
│   ├── 00-auth.jsx               — Firebase Auth gate, canonicalUid()
│   ├── 01-core.js                — Store, Firebase init, constants, AI helpers ⚠️ SAFETY CRITICAL
│   ├── 02-icons.jsx              — SVG icon components
│   ├── 03-voice.jsx              — Voice input
│   ├── 04-components.jsx         — ZenMode, BrainDump, ZenDumpReview, PostItStack, BlockedBadge, etc.
│   ├── 05-modals.jsx             — Modal components
│   ├── 06-shelf.jsx              — Completed tasks shelf
│   ├── 07-settings.jsx           — Settings panel
│   ├── 08-app.jsx                — Main App component, all state, all task actions
│   └── 10-devmode.jsx            — Dev mode tools
├── shailos/                      ← Shailos sub-app (built separately, static output)
├── netlify/functions/
│   ├── app-config.js             — returns GEMINI_API_KEY to client
│   ├── gemini-proxy.js           — proxies Gemini AI calls (5-min timeout)
│   ├── claude-proxy.js           — proxies Claude AI calls (60-sec timeout)
│   └── soferai-proxy.js          — legacy proxy
├── dist/                         ← Vite build output (do not edit directly)
├── index.html
├── vite.config.js
└── HANDOFF-2026-04-05.md         ← this file
```

**Shailos source** lives at:
`C:\Users\ydanz\OneDrive\Documents\taskmanager app\backup\sto-src\Shaila-Trancriber-Organizer-main\`

To update Shailos: build there → copy `dist/` contents → `sandbox/shailos/` → commit + push.
Netlify then copies `shailos/` into `dist/` as part of its own build step (`cp -r shailos dist/`).

---

## 5. KEY ARCHITECTURE

- **Firestore path**: `users/{canonicalUid}/appData/appState_v4`
- **canonicalUid**: strips email to prefix — `rabbidanziger@anything` → `"rabbidanziger"`
- **localStorage key**: `onetaskonly_v4_{uid}` (e.g. `onetaskonly_v4_rabbidanziger`)
- **State object** (`AS`): `{ lists[], activeListId, colorScheme, mrsWWindows, geminiKey, ... }`
- **`Store`** in `01-core.js` — all Firebase + localStorage read/write
- **`uT(fn)`** — helper to mutate the active list's tasks array
- **`curT`** = `displayedActT[0]` — the current focused task
- **Firestore `onSnapshot`** listener in `08-app.jsx` keeps all open tabs in sync (2s echo buffer)

---

## 6. ⚠️ SAFETY RULES — NEVER VIOLATE THESE

### 1. NEVER PUSH WITHOUT USER SAYING "GO"
Always say: "Ready to push. Files changed: [list]. Want me to deploy?" — then wait.

### 2. DEPLOY = GIT PUSH FROM sandbox/ ONLY
```bash
cd "C:\Users\ydanz\OneDrive\Documents\taskmanager app\sandbox"
git add <specific files>
git commit -m "description"
git push
```
GitHub → Netlify auto-deploys. **Do NOT use**: `safe-deploy.ps1`, `deploy.bat`, `deploy_api.ps1`, raw Netlify API calls — all deprecated.

### 3. NEVER MODIFY FIREBASE SAFETY GUARDS
In `01-core.js`:
- `Store._fbLoadStatus` — tracks whether Firebase confirmed data exists before allowing saves
- `Store.saveToFB()` guards — prevents blank/default state from overwriting real data in Firebase

**Why these exist**: The user's entire task history was once wiped because the app loaded with empty localStorage and saved blank state to Firebase within 50ms. These guards prevent that from ever happening again. Weakening them is a BLOCKER.

### 4. NEVER CHANGE FIREBASE CONFIG
`apiKey`, `projectId`, `appId` in `01-core.js` — never touch.

### 5. READ THE FILE BEFORE EDITING
Always read the current `sandbox/` version of a file before editing it. Never edit from memory. Run `git log --oneline` if something looks unexpected.

---

## 7. WHAT'S CURRENTLY LIVE (as of 2026-04-05)

- **FAB (floating action button)**: 2 large buttons (record shaila + record call/conversation), 2 compact links (Add | Records)
- **Universal Conversation Recorder**: In-app audio recording → Gemini transcription (Yeshivish-aware) → AI extracts tasks/shailos/schedule/reminders/got-backs → classy review card → user approves → items added to queue
- **Shailos transcriber**: Full transcriber with editable fields, "Shaila Question" box, synopsis textarea, AI answer summary on minicards (first 6 words), answer synopsis on shaila pills
- **Queue · N pill**: directly on focus/launchpad view
- **Theme sync**: shailos sub-app inherits main app color scheme
- **Subtask descriptions**: "Research – [synopsis]" / "Get back – [synopsis]"
- **Research tool**: `google_search: {}` format (not `googleSearch`)
- **AI model**: `gemini-2.5-pro-preview` for conversation parsing; `gemini-2.0-flash` for shaila research

---

## 8. RECENT GIT HISTORY (last 10 commits)

```
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
```

---

## 9. CODING CONVENTIONS

- **Styling**: Inline styles everywhere — no CSS classes except `@keyframes` in index.html
- **Theme**: `T` = `SCHEMES[AS.colorScheme]` — use `T.tFaint`, `T.tSoft`, `T.card`, etc.
- **Fonts**: `fontFamily:"system-ui"` for UI chrome; `Georgia,serif` for task text
- **JSX**: Multiple siblings → wrap in `<>...</>` Fragment
- **Tone**: Calm/passive styling for badges — never harsh red/alarming colors
- **State shorthand**: `AS` = full app state; `uT(fn)` mutates active list's tasks

---

## 10. COMPLETED FEATURES (don't rebuild these)

- AI reprioritization on add/completion
- Zen mode + brain dump → AI parse → ZenDumpReview
- Energy filter wired to curT and queueT
- Queue quick-add with toast + AI reprioritize
- Undo delete (6s window)
- Age hint on focus card ("since yesterday" / "N days waiting")
- BlockedBadge ("⏸ blocked 3h")
- Board view (PostItStack)
- Cross-window sync via Firestore onSnapshot
- MrsW schedule overlay
- Body double mode
- Firebase offline banner warning
- Universal Conversation Recorder (record → transcribe → extract → review → approve)
- Shailos: full transcriber, AI answer summaries, answer synopsis on pills

---

## 11. PLANNING RULE

Before writing code for any non-trivial feature, fix, or architectural change, produce a structured plan covering: what changes and why, files affected, security check, architecture fit, data layer impact, rollback plan, and step-by-step implementation. End with GO / HOLD / REDESIGN. Do NOT begin implementation until the user confirms.

---

## 12. ACCESS

| Resource | Value |
|---|---|
| Netlify site ID | `c603b156-f9ee-4b67-bcf4-d4b7f64fbccd` |
| Firebase project | `onetaskonly-app` |
| Firebase user UID | `rabbidanziger` |
| Gemini key | Netlify env var `GEMINI_API_KEY` (never in code) |
| Firebase API key | `AIzaSyB5UiDE9s0xjWeYa4OQ1LLJ63EwPVoSLrA` (safe to expose — this is the public client key) |
| GitHub | https://github.com/addedlife/onetaskfocuser |
