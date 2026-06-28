# SHAMASH PRO 5 — Progress Tracker

> The live to-do for the rebuild. **Each session:** read `REBUILD_PLAN.md`, then this file, find the
> first unchecked `[ ]`, do it, then **check it off with a one-line note + date** and commit.
> Keep commits small. Build-gate (`npm run build` in `app/`) before checking any build-affecting box.
>
> **▶ CURRENT POSITION:** **Phase 1 — foundation WRITTEN; needs INSTALL + BUILD VERIFY (task 1.7).**
> The full foundation is on disk under `SHAMASH_PRO5_REBUILD/app/` (config, theme bridge, m3 layer, UI
> store, Switchboard shell, demo App). (Pivoted ahead of Phase 0 deep-specs — owner said "go for full
> execution"; per-subsystem `ANALYSIS/` specs are now written as each feature is built.)
> **Immediate resume steps:** (1) `cd SHAMASH_PRO5_REBUILD/app`; (2) `npm install`; (3) `npm run build`,
> fix any type/build errors (see "Known risk areas" under Phase 1); (4) `npm run dev` and confirm the rail
> switches surfaces + the theme chips repaint all M3 components; (5) commit; then continue Phase 1 (1.4
> domain store slices, 1.5 mock data, 1.6 clock/Hebrew-date + real panels) and on down PROGRESS.
>
> **⛔ DROPPED (owner, 2026-06-28 — do NOT build):** Body-Double timer · Just-Start/"Start" timer ·
> NerveCenter "More actions" pane/drawer (each page uses its own inline action suite instead).
>
> **⭐ STANDARD:** every element must be indistinguishable from a pro-designed, industry-leading app —
> conform UI to M3 + pro polish, backend to typed/validated/observable/secure practice (see REBUILD_PLAN §0 #3 & #5).
>
> **🔀 GIT:** commit Pro 5 work on a dedicated **`pro5-rebuild`** branch — NOT `main` (main auto-deploys
> live Pro 4 via GitHub Actions; rebuild commits must never trigger that).

---

## Session log
- **2026-06-28 (pre-dawn, Opus 4.8):** Set the 5:05 AM auto-resume task. Read BRIEF/AGENTS/Atlas/Map.
  Discovered Atlas+Map frozen at commit `50e5707` (v4.23.92), now 22 commits stale (v4.29.103).
  Read the full `50e5707..HEAD` delta and wrote `ANALYSIS/00-delta-since-atlas.md`. Wrote
  `REBUILD_PLAN.md` + this tracker. **Next session starts at Phase 0.2.**
- **2026-06-28 (owner refinements):** Raised the bar to *industry-leading / pro-designed* for UI **and**
  backend (conformance-gate every element, REBUILD_PLAN §0 #3/#5 + §1·b). **Dropped** Body-Double timer,
  Just-Start timer, and the NerveCenter "More actions" pane/drawer — each page relies on its own inline
  action suite. Noted the `pro5-rebuild` branch guardrail.
- **2026-06-28 (full-execution start, Opus 4.8):** Created `pro5-rebuild` branch + wrote the entire Phase 1
  foundation under `SHAMASH_PRO5_REBUILD/app/`: Vite+React+TS scaffold, the M3 theme bridge (tokens,
  deriveAccents, contrast, 8 semantic schemes, globalCss + reactive themeVarsCss), the `@material/web`
  component layer (`m3/`), a zustand UI store, and a running Switchboard shell with a live 8-theme switcher.
  Committed. **Not yet `npm install`-ed/built** — that's task 1.7, the first thing the next session does.

---

## Phase 0 — Deep analysis (spec every subsystem from CURRENT source)
> Output: `ANALYSIS/NN-*.md`, each capturing functions, inputs/outputs, data shapes, AI prompt text,
> wiring, edge cases. Use the Atlas as an index; **read current source** (`git show HEAD:<file>` or Read).
> Mark a Pro 4 line "superseded" wherever `00-delta` says so.

- [x] **0.1 Delta capture** — `ANALYSIS/00-delta-since-atlas.md` (done 2026-06-28)
- [ ] **0.2 Data + AI core** → `ANALYSIS/10-data-ai-core.md` — `01-core.js` (Store, AI gateway+jobs, contrast, aging) + `shabbos.js`
- [ ] **0.3 Orchestrator** → `ANALYSIS/11-orchestrator.md` — `App.jsx` state inventory, lifecycle, handlers, derived state (map each to a Pro 5 store/hook/service)
- [ ] **0.4 Auth + boot** → `ANALYSIS/12-auth-boot.md` — `00-auth.jsx`, `main.jsx`, `index.html`, `version.js`, `offline-support.js`, `diagnostics.jsx`
- [ ] **0.5 Theme + M3 layer** → `ANALYSIS/13-theme-m3.md` — `ui-tokens.jsx`, `m3.jsx`, `02-icons.jsx`, 8 schemes in `01-core.js`, dev tools
- [ ] **0.6 Focus app** → `ANALYSIS/20-focus.md` — focus/queue/insights blocks in `App.jsx`, `04-components.jsx`, `05-modals.jsx`, `06-shelf.jsx`
- [ ] **0.7 NerveCenter** → `ANALYSIS/21-nervecenter.md` — `NerveCenterPanel.jsx` (incl. calendar timeline/agenda/columns/colors), `TaskRiverPanel.jsx`, `ConvCapture.jsx`
- [ ] **0.8 DeskPhone** → `ANALYSIS/22-deskphone.md` — `10-deskphone-web.jsx` + `NerveCenterPhoneSurface.jsx` (note the overlap to unify) + `DeskPhoneMiniDock.jsx`; host endpoint contract
- [ ] **0.9 Shailos** → `ANALYSIS/23-shailos.md` — `apps/shailos/src/App.tsx`, `services/geminiService.ts`, `utils/shailosQueue.js`
- [ ] **0.10 Health + Voice + Settings** → `ANALYSIS/24-health-voice-settings.md` — `HealthPage/Card.jsx`, `03-voice.jsx`, `09-transcription-pen.js`, `07-settings.jsx`
- [ ] **0.11 Backend** → `ANALYSIS/30-backend.md` — all 9 `apps/web/functions/*` HTTP contracts (request/response shapes); confirm Firebase vs deprecated Netlify copy parity
- [ ] **0.12 Parity checklist seed** → expand Part 8 into the checklist at the bottom of this file (one row per Map item 1.1–9.6 + delta additions)

## Phase 1 — Foundation (running shell)
- [x] 1.1 Scaffold `app/` — Vite 6 + React 18 + TS, tsconfig(.app/.node), ESLint flat + Prettier, `5.0.0` in package.json _(needs `npm install`)_
- [x] 1.2 `m3/` module — `src/m3/index.tsx`: all @material/web wrappers + `IconBtn`/`ActionBtn`/`denseListVars`; `@material/web` pinned **2.4.1**
- [x] 1.3 `theme/` — `tokens`, `accents.deriveAccents`, `contrast`, 8 `schemes` (full semantic roles), `bridge.globalCss()` + `themeVarsCss()`; applied via `<style>` in `App.tsx`
- [~] 1.4 Zustand store — **UI slice done** (`state/store.ts`: suiteView/tab/sidebar/scheme + localStorage). Domain slices (tasks/shailos/google/phone/health) land in Phase 2+
- [ ] 1.5 `mock/` seed data (tasks, shailos, calendar, gmail, phone, health) — NOT started
- [~] 1.6 Switchboard shell — **rail + surface routing done** (`features/switchboard/Switchboard.tsx`; `App.tsx` renders a per-surface placeholder with a live 8-theme switcher as the bridge smoke test). TODO: clock + Hebrew date in rail; swap placeholder for real surface panels as features land
- [ ] 1.7 **VERIFY (do FIRST on resume):** `npm install` → `npm run build` (fix errors) → `npm run dev`, confirm rail switches surfaces + theme chips repaint M3 components → commit

> **Known risk areas to check at first build** (TS strict + @lit/react + @material/web v2.4):
> • `createComponent` prop typing — `onClick`/`disabled`/`selected`/`label`/`type` on wrapped elements may
>   need explicit prop/event typing or an `events` mapping. • `md-list-item` content API — `App.tsx` uses
>   default-slot headline + `slot="supporting-text"` (the v2.4 slot API, not `headline=`/`supportingText=`
>   props). • `md-filter-chip` `label`/`selected`/`onClick`. • `color-mix` in `scrollbar-color` (cosmetic —
>   safe to simplify if a target chokes). • path alias `@/*` resolves via tsconfig + the vite alias.

## Phase 2 — Data + AI core
- [ ] 2.1 `services/store` — Firebase bootstrap + reconnect; v5 per-task docs + legacy blob; IndexedDB cache; cross-tab/device sync; local + weekly backups; shailos CRUD + reconcile (mock-backed first)
- [ ] 2.2 `services/ai` — proxy gateway (`callAI`, Claude+Gemini, text+audio, 30s timeout) + all jobs (optimize, first-step, parse shailos/conversation/calendar/braindump, gen-schemes, detect-answers, summarize)
- [ ] 2.3 `lib/` — contrast, dates, hebrew, ids, aging + Mrs. W, `shabbos`

## Phase 3 — Auth + Switchboard
- [ ] 3.1 Google sign-in (popup/redirect by device, remember email, stay-signed-in), AuthGate, LoginScreen
- [ ] 3.2 AppSuiteChrome rail polish + SuitePanels wrappers on M3

## Phase 4 — Focus app
- [ ] 4.1 Focus tab (card, badges, priority circles+voice, add box+energy, Done/Zen/Park, Shatter, hamburger)
- [ ] 4.2 ZenMode + BrainDump + OverwhelmBanner  _(Just-Start & Body-Double timers DROPPED — do not build)_
- [ ] 4.3 PostItStack (**Stack/Board modes + sort chips**) + BlockReflect + ShailaManager/MiniPill
- [ ] 4.4 Modals (BulkAdd, TaskBD/Shatter, BlockedModal, ContextTagPicker, ListManager)
- [ ] 4.5 Queue tab (list, search, quick-add, overwhelm, drag-reorder, subtask groups) + Shelf
- [ ] 4.6 Insights tab (charts, AI insight, AI chat, daily tip)

## Phase 5 — Shailos
- [ ] 5.1 `shailosQueue` logic + stores
- [ ] 5.2 Embedded Shailos mini-app rebuilt (record/transcribe/parse, synopsis, answer, got-back, **Research**, dup-catch, copy/delete, live store, error screen)
- [ ] 5.3 ShailaManager + MiniPill surfaces; shared `deriveAccents` parity

## Phase 6 — NerveCenter
- [ ] 6.1 Layout switch (columns/cards/accordion + density)  _("More actions" drawer DROPPED — each card shows its own actions inline)_
- [ ] 6.2 Cards: Mail, Phone, Tasks, Shailos
- [ ] 6.3 **Calendar** — `CalendarTimeline` (60px/hr, `assignCalendarColumns`, `GCAL_COLORS`, live now-line) + compact M3 agenda + multi-account picker + NOW/Tomorrow dividers + full-view split
- [ ] 6.4 AI card headlines (Chief scan + caching) + Chief brief/learning profile
- [ ] 6.5 TimelineFace clock, TaskRiver, ConvCapture, HealthCard

## Phase 7 — DeskPhone (UNIFIED surface)
- [ ] 7.1 Transport layer (host fetch + cloud relay, 5s poll + signature diff)
- [ ] 7.2 Nav rail + connection line + reconnect/build-update overlays
- [ ] 7.3 Conversations (list/search/filter) + thread (bubbles, in-thread search, attachments, lightbox)
- [ ] 7.4 Composer (≤6 files) + conversation actions (pin/mute/block/delete)
- [ ] 7.5 Calls list (filters, delete-all, **missed-resolve**, **More history**) + call banner + dialpad
- [ ] 7.6 Contacts + Settings/Developer tabs + parity ledger + theming + standalone/embedded + MiniDock

## Phase 8 — Health
- [ ] 8.1 HealthPage (rings, bar charts, metric cards, period switch, connect modal, manual entry)
- [ ] 8.2 HealthCard dashboard summary + google-health wiring

## Phase 9 — Voice & transcription
- [ ] 9.1 VoiceInput (record/transcribe/detect, webm→WAV)
- [ ] 9.2 Pending-recording IndexedDB queue (save/list/retry/age)

## Phase 10 — Settings
- [ ] 10.1 SettingsModal (theme, AI provider, Google, backup/restore, priority/list mgmt, recordings) + tab routing

## Phase 11 — Backend
- [ ] 11.1 Rebuild Functions (aiProxy+_ai-core, appConfig, googleWorkspace windowed, googleHealth, phoneRelay, chiefProfile, googleSearch, mcp, debugLog+cors) — same HTTP contract
- [ ] 11.2 Point Pro 5 at the rebuilt backend (dev project); verify each integration

## Phase 12 — Parity & polish
- [ ] 12.1 Walk the full parity checklist (below) — every row implemented + smoke-verified vs Pro 4
- [ ] 12.2 **Industry-standard conformance audit** — UI vs M3 spec + pro polish (motion, spacing, density, a11y, responsive) **and** backend vs §0 #3 criteria (typed contracts, validation, error handling, logging, security, idempotency, cost). Port the `?uiaudit` drift idea; fix every deviation
- [ ] 12.3 Full build + cross-surface smoke; finalize version + docs

## Phase 13 — Cutover ⚠️ GATED — do NOT start without explicit owner GO
- [ ] 13.1 Written cutover plan (deploy path, data continuity, rollback) — present to owner

---

## PARITY CHECKLIST (seed — expand in task 0.12)
> One row per Pro 4 feature; mark ✅ only when the Pro 5 equivalent is built + smoke-verified.
> Source granularity = `APP_FEATURE_MAP.md` items 1.1–9.6 **plus** the delta additions:
> PostItStack Stack/Board, calendar timeline/agenda/multi-account/dividers, phone missed-resolve +
> More-history, cross-app `deriveAccents`. (Populate the table here during Phase 0.12.)
