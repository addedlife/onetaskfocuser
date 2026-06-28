# SHAMASH PRO 5 — Progress Tracker

> The live to-do for the rebuild. **Each session:** read `REBUILD_PLAN.md`, then this file, find the
> first unchecked `[ ]`, do it, then **check it off with a one-line note + date** and commit.
> Keep commits small. Build-gate (`npm run build` in `app/`) before checking any build-affecting box.
>
> **▶ CURRENT POSITION:** **Phase 1 foundation BUILDS CLEAN — task 1.7 GREEN.** `app/` installs (266 pkgs)
> and `npm run build` passes (tsc strict + vite, 0 errors; dist ≈378 kB / 92 kB gz). The M3 theme bridge +
> `@material/web` layer are proven by the passing build. **Next:** (1) optional `npm run dev` browser smoke
> (rail switches surfaces; theme chips repaint M3) if not already done; (2) finish Phase 1 — 1.4 domain
> store slices, 1.5 mock seed data, 1.6 clock + Hebrew date in rail, swap placeholder for real panels;
> (3) then Phase 2 (data + AI core: `services/store` Firestore + `services/ai` gateway/jobs + `lib/`).
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
- **2026-06-28 (build verified):** Fixed the install (the background `--prefix` install had landed nowhere;
  reinstalled directly in `app/` — 266 pkgs). **`npm run build` passes clean** (tsc strict + vite, 0 errors):
  the whole foundation (theme bridge, m3 layer, store, shell) typechecks and bundles. Committed package-lock.
  Phase 1 is ~done bar mock data + rail clock; next substantive work is Phase 2 (data + AI core).
- **2026-06-28 (first real surface):** Added `state/data.ts` (tasks+shailos store) and rendered the **Shailos
  surface for real** on genuine `md-list` (status + Got-back action, gold identity), wired into `App.tsx`.
  Build green (174 modules, 0 errors). Proves the data→store→M3 pipeline. Other surfaces still placeholder.
- **2026-06-28 (Phase 0.2 + fidelity fix):** Read the real `01-core.js` (2008 lines), wrote
  `ANALYSIS/10-data-ai-core.md`. **Corrected the domain model to real Pro 4 field names** (text/completed/
  priority, parentTask/stepIndex, snoozedUntil, shailaId; shaila content/synopsis/askerName/answererName,
  status `got_back`; priority weight/isShaila) across `lib/types.ts` + new `lib/constants.ts` + mock + data
  + both surfaces. Build green (176). Next: `services/ai` (job dispatcher + typed jobs) + `lib/` utils.
- **2026-06-28 (Phase 2 lib + AI gateway):** Ported the pure core to `lib/` (ids, dates, priorities/gP,
  aging, mrsW, optTasks scoring, Yeshivish `YC` map + cleanYeshivish, constants) and built the AI gateway
  `services/ai.ts` (proxy dispatcher + first-step/answer-summary/calendar-event jobs, default provider
  claude, `setIdTokenProvider` hook). All faithful to 01-core.js. Build green (176). Next: `services/store`.
- **2026-06-28 (Phase 2 storage):** Added persistence abstraction `services/storage.ts` (`StorageBackend` +
  localStorage `MockStorage` with the catastrophic-delete guard) and wired the data store to it (async
  hydrate + write-through, so toggles survive reload). Real Firestore backend stays gated. Build green (177).
- **2026-06-28 (lib/shabbos + Focus card):** Ported `lib/shabbos.ts` (sunset + Shabbos window). Built the
  signature **Focus card** (`FocusSurface.tsx`): smart-sorted current task on a priority-colored hero card,
  badges, Done/Park, priority circles, inline add box (M3 text field + energy chips); added store actions +
  M3 text fields. Build green (203).
- **2026-06-28 (BROWSER SMOKE PASSED ✅):** Added a `pro5` preview config (`.claude/launch.json`) and ran the
  dev server in a real browser. Verified: Focus card renders correctly, rail routes between surfaces, NO
  console errors, and — the crown jewel — the M3 theme bridge repaints EVERY genuine @material/web component
  instantly on theme switch (Claude Cream ↔ Navy Gold). The "indistinguishable from pro app" bar is met at
  the foundation level.

---

## Phase 0 — Deep analysis (spec every subsystem from CURRENT source)
> Output: `ANALYSIS/NN-*.md`, each capturing functions, inputs/outputs, data shapes, AI prompt text,
> wiring, edge cases. Use the Atlas as an index; **read current source** (`git show HEAD:<file>` or Read).
> Mark a Pro 4 line "superseded" wherever `00-delta` says so.

- [x] **0.1 Delta capture** — `ANALYSIS/00-delta-since-atlas.md` (done 2026-06-28)
- [x] **0.2 Data + AI core** → `ANALYSIS/10-data-ai-core.md` written (Store v5, AI job dispatcher + 11 job IDs, optTasks scoring, aging/MrsW, real Task/Shaila/Priority field names). `shabbos.js` still to spec. **Fixed the domain model** (`lib/types.ts`) to real field names + added `lib/constants.ts` (DEF_PRI/thresholds/palette).
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
- [~] 1.4 Zustand store — **UI + data slices done** (`state/store.ts` UI: suiteView/tab/sidebar/scheme + localStorage; `state/data.ts`: tasks+shailos seeded from mock, with `toggleDone`/`markGotBack`). Google/phone/health slices land with those features.
- [~] 1.5 `mock/` seed data — **tasks/shailos/priorities/lists/settings done** (`mock/seed.ts`) + domain model (`lib/types.ts`, ✓ field fidelity verified vs `01-core.js`) + `lib/constants.ts`. Calendar/gmail/phone/health seeds added alongside those features.
- [~] 1.6 Switchboard shell — **rail + surface routing done** (`features/switchboard/Switchboard.tsx`; `App.tsx` renders a per-surface placeholder with a live 8-theme switcher as the bridge smoke test). TODO: clock + Hebrew date in rail; swap placeholder for real surface panels as features land
- [x] 1.7 **Build-gate GREEN + browser smoke PASSED ✅** — `npm install` + `npm run build` pass (tsc strict + vite, 0 errors); **verified in a real browser** via preview config `pro5` (port 5500): Focus card renders (priority-colored hero, contrast-safe text, Done/Park, priority circles, add box), rail routes between surfaces, **no console errors**, and the M3 theme bridge repaints all genuine `@material/web` components live (Claude Cream ↔ Navy Gold). To preview later: `preview_start` config `pro5`, or `cd SHAMASH_PRO5_REBUILD/app && npm run dev`.

> **Known risk areas to check at first build** (TS strict + @lit/react + @material/web v2.4):
> • `createComponent` prop typing — `onClick`/`disabled`/`selected`/`label`/`type` on wrapped elements may
>   need explicit prop/event typing or an `events` mapping. • `md-list-item` content API — `App.tsx` uses
>   default-slot headline + `slot="supporting-text"` (the v2.4 slot API, not `headline=`/`supportingText=`
>   props). • `md-filter-chip` `label`/`selected`/`onClick`. • `color-mix` in `scrollbar-color` (cosmetic —
>   safe to simplify if a target chokes). • path alias `@/*` resolves via tsconfig + the vite alias.

## Phase 2 — Data + AI core
- [~] 2.1 `services/storage` — **abstraction + MockStorage done** (`services/storage.ts`: `StorageBackend` interface, localStorage mock seeded from mock data, catastrophic-delete guard; wired into `state/data.ts` via async `hydrate()` + write-through). **GATED — pending:** real `FirestoreStorage` (Firebase bootstrap+reconnect, v5 per-task docs + legacy blob, cross-tab/device sync, transaction-freshness + self-healing listeners, weekly backups, shailos reconcile — behind `?live=1`).
- [~] 2.2 `services/ai` — **dispatcher done** (`services/ai.ts`: `callAIProxy`/`runAIJob`/`callAI`, `setIdTokenProvider`, 30s abort, default provider **claude**) + self-contained jobs (first-step, answer-summary, parse-calendar-event + defaults). Remaining jobs (optimize/conversation/parse-shailos/braindump/detect-answers/gen-schemes/transcribe-audio) land with their features.
- [x] 2.3 `lib/` — `ids`, `dates`, `priorities` (gP), `aging`, `mrsW`, `optimize` (optTasks), `yeshivish` (YC+cleanYeshivish), `constants`, `shabbos` (sunset + Shabbos window + geolocation); contrast in `theme/contrast.ts`. (Hebrew-date rendering lands with the rail clock, Phase 1.6.)

## Phase 3 — Auth + Switchboard
- [ ] 3.1 Google sign-in (popup/redirect by device, remember email, stay-signed-in), AuthGate, LoginScreen
- [ ] 3.2 AppSuiteChrome rail polish + SuitePanels wrappers on M3

## Phase 4 — Focus app
- [x] 4.0 Focus surface exists (`features/focus/FocusSurface.tsx`) — upgraded from interim list to the real card view (below).
- [~] 4.1 Focus card — **core DONE**: smart-sorted current task on a priority-colored, contrast-safe hero card; badges (tier/age/energy/group); **Done** + **Park** actions; priority circles that reveal an inline add box with an M3 text field + energy chips; store actions addTask/completeTask/parkTask. **Remaining:** inline rename, Shatter, voice-add on circles, hamburger menu, Zen mode. _(Just-Start & Body-Double timers DROPPED.)_
- [ ] 4.2 ZenMode + BrainDump + OverwhelmBanner  _(Just-Start & Body-Double timers DROPPED — do not build)_
- [ ] 4.3 PostItStack (**Stack/Board modes + sort chips**) + BlockReflect + ShailaManager/MiniPill
- [ ] 4.4 Modals (BulkAdd, TaskBD/Shatter, BlockedModal, ContextTagPicker, ListManager)
- [ ] 4.5 Queue tab (list, search, quick-add, overwhelm, drag-reorder, subtask groups) + Shelf
- [ ] 4.6 Insights tab (charts, AI insight, AI chat, daily tip)

## Phase 5 — Shailos
- [~] 5.0 Shailos SURFACE scaffolded early (`features/shailos/ShailosSurface.tsx`) — live `md-list` render of shailos with status + "Got back" action, in category gold; wired in `App.tsx`. (Full record/transcribe/research below.)
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
