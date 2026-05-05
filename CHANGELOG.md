# Changelog

All notable changes to OneTaskFocuser are documented here.

---

## [Unreleased] — 2026-05-04

### Added
- **Google Calendar + Gmail on NerveCenter** — Connect a Google OAuth Client ID in Settings → Google to display today's calendar events and important/unread emails directly in the NerveCenter bottom row. Token lives in-session only; never persisted.
- **NerveCenter as default home** — App now opens to NerveCenter instead of the Focus tab.
- **Insights charts** — Four switchable secondary chart types added to the Insights tab: Day-of-Week breakdown, Task Speed histogram, 30-day trend, and 90-day cumulative. Chart range selector: Day / Week / Month / All-time.
- **Google settings tab** — New "Google" tab in Settings with step-by-step OAuth Client ID setup instructions.

### Fixed
- **Shailos appearing twice** — Race condition between reconciliation and `_listenV5` snapshot caused shaila tasks to duplicate. Fixed by registering pending shaila IDs before state update so the listener deduplicates correctly.
- **Auto-save backup format** — `autoFileBackup` was writing `_version: 2` which `parseBackup` rejected. Rewritten to use `_backupVersion: 1` and fetch shailos fresh from Firestore, matching the `fullBackup` format.
- **New tasks sorted to bottom** — `addTask`, `addVT`, and reconciliation paths now wrap new tasks through `doOpt`/`optTasks` so they appear at the top per priority order.
- **Shaila researcher quota error** — Pre-built shailos bundle hardcoded `gemini-3.1-pro-preview` (invalid/quota-exceeded model). Proxy now validates the model against an allowlist and falls back to `gemini-2.5-flash`.

### Changed
- **AI proxy simplified** — `netlify/functions/gemini-proxy.js` refactored as a compatibility wrapper around `_ai-core.cjs` which centralises model validation and routing.
- **Settings remote props** — Added `aiConfig`, `deskPhoneThemeSync`, `deskPhoneOnline`, `onToggleDeskPhoneThemeSync`, `onRefreshDeskPhoneTheme` props to `SettingsModal`.

---

## Prior History (pre-changelog)

### NerveCenter suite
- Three-column grid view (Tasks / Shailos / Phone) with quick-add and inline edit.
- Suite sidebar navigation: NerveCenter, Tasks (Focus), Shailos, DeskPhone.
- Actions drawer with categorised action buttons per column.

### DeskPhone integration
- `10-deskphone-web.jsx` — embedded web panel that talks to the DeskPhone native app at `http://127.0.0.1:8765`.
- Theme sync: NerveCenter can push its colour palette to the DeskPhone.
- Call recording and transcription pipeline via `09-transcription-pen.js`.

### Shailos
- Full Shaila (AI follow-up question) lifecycle: create → research → get-back → resolve.
- `ShailaManager` component for reviewing and resolving pending shailos.
- Pre-built shailos bundle at `/shailos/` (separate SPA).

### Core task engine (`01-core.js`)
- Priority-based optimised task ordering (`optTasks`).
- Task aging thresholds with visual badges.
- Firebase Firestore persistence with offline support.
- Full and incremental backup/restore (`fullBackup`, `autoFileBackup`, `parseBackup`).
- AI integrations: brain dump parser, conversation parser, task summariser, Shaila researcher.

### Focus view
- Single-task focus card with contextual actions.
- Queue tab: full task list with filters, bulk operations, drag-reorder.
- Insights tab: completion metrics, streak, category breakdown, and charts.
- Zen mode, Brain Dump, Overwhelm Banner, Just Start Timer, Body Double Timer.

### Settings
- Palette / colour scheme picker.
- Priority management (create, reorder, delete custom priorities).
- AI model selection (Gemini / Claude).
- Data management: export, import, full backup/restore.
