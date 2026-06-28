# SHAMASH PRO 5 — Ground-Up Rebuild · Master Plan

> **Mission.** Rebuild the Shamash Pro 4 suite as **Shamash Pro 5**: every feature and behavior
> intact and faithful to Pro 4's structure, but written **from a flat bottom** (no code copied
> from Pro 4), **streamlined and internally consistent**, and built on **genuine Google Material 3
> (`@material/web`) components wherever one exists** (hand-code only when no M3 equivalent exists).
>
> **The bar: indistinguishable from a pro-designed, industry-leading app — UI *and* backend.** Every
> element is checked against current industry standard and tweaked to conform; where Pro 4's own
> structure or styling falls short, Pro 5 conforms to the standard (functionality stays faithful;
> quality is upgraded, never downgraded).
>
> **Read order for any session:** this file → `PROGRESS.md` (the live tracker) →
> `ANALYSIS/00-delta-since-atlas.md` → the relevant `ANALYSIS/*.md` spec → current Pro 4 source.
> The repo's `CLAUDE.md`, `BRIEF.txt`, `AGENTS.md` standing rules still apply.

---

## 0. Operating principles (how every session behaves)

1. **Autonomous.** Per owner's standing order for this job: proceed without stopping for routine
   confirmation. Only pause for something **absolutely critical** (irreversible/destructive to live
   data, or a true blocking ambiguity). Never auto-commit secrets; never deploy over live Pro 4.
2. **Isolation.** All Pro 5 work lives under `SHAMASH_PRO5_REBUILD/`, committed on a dedicated
   **`pro5-rebuild`** git branch — **never `main`** (main auto-deploys live Pro 4 via GitHub Actions).
   The live Pro 4 app (`apps/web`, its Firebase project, its data) is **never touched, deployed over,
   or written to** by rebuild work. Cutover (Part 9) is a separate, explicitly-gated phase.
3. **Faithful in function, industry-standard in execution.** Reproduce every Pro 4 *feature and
   behavior*. But the result must be **indistinguishable from a pro-designed, industry-leading app**,
   so every element — UI **and** backend — is checked against current industry standard and tweaked
   to conform. **Where Pro 4's own structure or styling conflicts with industry-leading practice, the
   standard wins** (note the deviation in `ANALYSIS/`). UI standard = **Material Design 3** (the
   standing audit standard). Backend standard = typed contracts, input validation, robust error
   handling + retries, structured logging/observability, least-privilege security + secret hygiene,
   idempotency, cost-awareness, and tests. Improve *structure* (decomposition, dedup, typing, tokens)
   freely; do not import Pro 4's mistakes; do not silently change a *feature*. If a behavior seems
   wrong, note it in `ANALYSIS/` rather than redesign it mid-rebuild.
4. **Spec before build.** No subsystem is rebuilt until its `ANALYSIS/NN-*.md` spec exists
   (inputs, outputs, data shapes, AI prompts, edge cases) derived from **current source**.
5. **Build-gate + conformance-gate every chunk.** `npm run build` must pass; smoke-test the surface;
   **run the industry-standard conformance check on every new element** (UI vs M3 spec + polish /
   motion / a11y / responsive; backend vs the criteria in #3) and tweak before shipping; commit with a
   clear message; tick `PROGRESS.md`. Small, frequent, reversible commits.
6. **M3 mandate (hard).** Use the real `@material/web` component for any element it covers. Pattern
   = `@lit/react createComponent` in one shared `m3` module + the `--md-sys-*` bridge (see Part 4).
7. **Standing product rules carry over:** Shailos is the **highest-priority** surface; default AI
   provider **Claude** (`claude-haiku-4-5-20251001`) with prompt caching; version bumps on release.

---

## 1. The faithful target — what Pro 5 must contain (de-staled inventory)

Surfaces (the "Switchboard" model): `suiteView ∈ { focus, nervecenter, chief, health, taskriver,
shailos, deskphone }`; inside `focus`, `tab ∈ { focus, queue, insights }`.

| # | Subsystem (Pro 4 source) | Pro 5 must reproduce |
|---|---|---|
| 1 | **Switchboard** — `AppSuiteChrome.jsx`, `SuitePanels.jsx` | Left nav rail (collapse/expand, clock, Hebrew date), surface switching + memory, suite-panel wrappers |
| 2 | **Focus tab** — `App.jsx` focus block, `04-components.jsx`, `05-modals.jsx` | Task card (auto-fit, priority color, age/blocked badges), Done/Zen/Park, priority circles + voice add, add box (energy tag), Shatter, hamburger menu, **ZenMode**, BrainDump, **PostItStack (Stack/Board modes + sort)**, BlockReflect, ShailaManager/MiniPill, modals (BulkAdd, TaskBD, BlockedModal, ContextTagPicker, ListManager) |
| 3 | **Queue tab** — `App.jsx` queue block, `06-shelf.jsx` | List + search + quick-add, overwhelm banner, drag-reorder rows, subtask groups, completed **Shelf** |
| 4 | **Insights tab** — `App.jsx` insights block | Completion charts (day/week/all + weekday/speed/trend), AI insight, AI chat, daily tip |
| 5 | **NerveCenter** — `NerveCenterPanel.jsx`, `TaskRiverPanel.jsx`, `ConvCapture.jsx`, `HealthCard.jsx` | Layout switch (columns/cards/accordion + density), Mail/Phone/Tasks/Shailos/Calendar cards, AI card headlines (Chief scan + caching), **TimelineFace** clock, **TaskRiver**, **ConvCapture** (record→tasks/shailos/events), Chief brief + learning profile. **Calendar = dual display: GCal-style timeline (60px/hr, overlap columns, GCAL_COLORS, live now-line) + compact M3 agenda + multi-account picker + NOW/Tomorrow dividers + past dimming** (see `ANALYSIS/00-delta-since-atlas.md` §B) |
| 6 | **DeskPhone** — `10-deskphone-web.jsx` (+ `NerveCenterPhoneSurface.jsx`, `DeskPhoneMiniDock.jsx`) | Nav rail, 5s live sync (host + cloud relay), connection line, conversation list (search/filter), thread bubbles + in-thread search, attachments + lightbox, composer (≤6 files), calls list (filters, delete-all), **missed-call resolve toggle**, **More history**, call banner (answer/decline/hangup), dialpad, contacts, settings/dev tabs, parity ledger, theming, standalone/embedded mode. **Pro 5 UNIFIES the two phone surfaces into one** (Pro 4 has 6,240 + 1,489 lines of overlap) |
| 7 | **Shailos** — `apps/shailos/src/App.tsx`, `utils/shailosQueue.js` | Standalone question-tracker (record mic/call, transcribe+parse, synopsis regen/dictate, answerer/answer, got-back toggle, **Research** via web+Sefaria, duplicate-catch/integrate, copy/delete, live Firestore, error screen). Embedded via panel. Accent parity via shared `deriveAccents` |
| 8 | **Health** — `HealthPage.jsx`, `HealthCard.jsx`, backend `google-health.js` | Rings, mini bar charts, metric cards, period switch (day/week/month/year), connect-to-Google-Health, manual entry, dashboard summary card |
| 9 | **Voice & transcription** — `03-voice.jsx`, `09-transcription-pen.js` | VoiceInput (record/transcribe/detect shailos+answers, webm→WAV), offline pending-recording IndexedDB queue (save/list/retry/age) |
| 10 | **Settings** — `07-settings.jsx` | Theme picker, AI provider, Google connect, backup/restore, priority/list mgmt, recordings queue; opens to a chosen tab |
| 11 | **Data + AI core** — `01-core.js` (2,008 lines) | Firebase bootstrap + reconnect, **`Store`** persistence (v5 per-task docs + legacy blob, IndexedDB cache, cross-tab/device sync, local + weekly backups, shailos CRUD + reconcile), color-contrast engine, Hebrew/date utils, task-aging + Mrs. W, **AI gateway** (`callAI` via proxy, Claude+Gemini, text+audio) + AI jobs (optimize, first-step, parse shailos/conversation/calendar/brain-dump, gen-schemes, detect-answers, summarize), `shabbos.js` sunset engine |
| 12 | **Auth** — `00-auth.jsx` | Google sign-in (popup/redirect by device, remember email, stay-signed-in), `AuthGate`, `LoginScreen` |
| 13 | **Orchestrator** — `App.jsx` (4,810 lines, ~95 `useState`) | All the load/save lifecycle, Google Calendar+Gmail integration, real-time sync + nudges, derived state/theme, every task/shaila/list/backup handler, view routing, health sync. **Pro 5 decomposes this** (see Part 3) — same behavior, no 4,800-line component |
| 14 | **Boot/build/deploy** — `main.jsx`, `index.html`, `version.js`, `vite.config.js`, `offline-support.js`, `diagnostics.jsx` | Ignition + standalone-deskphone branch, theme `postMessage`/webview sync, offline service worker, version stamp, diagnostics overlay |
| 15 | **Serverless backend** — `apps/web/functions/` (Firebase) | `aiProxy` (+`_ai-core.cjs`), `appConfig`, `googleWorkspace` (windowed calendar), `googleHealth`, `phoneRelay` (watch read volume — see MEMORY), `chiefProfile`, `googleSearch`, `mcp`, `debugLog` + `cors-helper`. Keep the **same HTTP contract** so integrations keep working |
| 16 | **Adjacent native (faithful interface, not rebuilt yet)** — `phone-host-windows` (C#), `ipad-phone-bridge` (archival) | Pro 5 web talks to the **same host endpoints** (`/status`,`/messages`,`/calls`,`/contacts`,`/answer`,`/hangup`, …). Native host rebuild is out of scope unless owner asks |

> Every line item above becomes a row in the **parity checklist** (Part 8). Map item numbers are
> kept so "do 5.6" still resolves. The Atlas/Map are an index; **current source is the source of truth.**

### 1·b — Explicitly DROPPED features (owner decision 2026-06-28 — do NOT build)
Intentionally **not** carried into Pro 5. Do not implement, scaffold, or add UI for them; if a spec
references one, mark it "dropped (owner)". Everything else in §1 stays — **ZenMode, BrainDump, and the
OverwhelmBanner are kept**; only these three are removed:
- **Body-Double timer** (`BodyDoubleTimer`) — drop entirely (incl. its hamburger-menu entry).
- **Just-Start / "Start" timer** (`JustStartTimer`) — drop entirely (incl. its minimized dock + hamburger entry).
- **NerveCenter "More actions" pane/drawer** — drop. It's confusing; instead each surface (Tasks, Mail,
  Phone, Shailos, Calendar) exposes its **own full action suite inline** on that page. No consolidated drawer.

---

## 2. Architecture decisions (labeled: ⭐ industry-standard · 🎯 right-for-this-app)

| Decision | Choice | Why | Label |
|---|---|---|---|
| Framework | **React 18 + Vite 6** | Same proven base as Pro 4; fast HMR; nothing to gain by changing | 🎯 |
| Language | **TypeScript** (Pro 4 is mostly JS; only Shailos is TS) | Types are guardrails for an **AI-maintained, owner-non-programmer** codebase — they catch the class of mistakes that bite hardest here. Industry standard *and* right here | ⭐🎯 |
| State | **Zustand**, sliced by domain (`tasks`, `shailos`, `google`, `phone`, `health`, `ui`, `settings`) | Replaces the 95-`useState` monolith with small, testable stores; minimal boilerplate; no prop-drilling. Alternatives weighed: Redux Toolkit (heavier), Context+useReducer (more boilerplate) | ⭐🎯 |
| UI components | **`@material/web` v2.4.1 throughout**, one shared `m3` wrapper module + `--md-sys-*` bridge | The hard M3 mandate; Pro 4 already proved the pattern (see delta §A) | ⭐🎯 |
| Theming | **One** `deriveAccents()` + `themeVarsCss()` shared by suite + DeskPhone + Shailos | Pro 4 derives accents in 3 places; Pro 5 centralizes (DRY) | 🎯 |
| Colors | **Full semantic color tokens from day one** (`--shp-color-*` + `--md-sys-color-*`) | Realizes the owner's deferred "tokenization Phase 2 colors" vision (MEMORY) — Pro 5 starts where Pro 4 deferred | 🎯 |
| Data layer | **Same Firestore data model** (v5 per-task docs); clean typed `store/` modules | Faithful to the owner's live data shapes; no migration risk now | 🎯 |
| Dev data | **Mock/seed data by default**; real Firebase behind an explicit flag | So autonomous dev can never touch live data | 🎯 |
| Phone surface | **Unify the two Pro 4 surfaces into one** component family | Removes the largest duplication in the app | 🎯 |
| Backend | **Re-implement Functions cleanly, same HTTP contract**; defer until frontend is parity-complete | Security-critical and working; rebuild last, behind tests | 🎯 |
| Deploy | **Pro 5 not in any deploy path** until cutover | Protects live users | 🎯 |

---

## 3. Decomposing the orchestrator (the central structural win)

Pro 4's `App.jsx` is one 4,810-line component holding ~95 `useState` + every handler. Pro 5
keeps **identical behavior** but splits it:
- **Stores** (`src/state/*`): Zustand slices own the state that was in `useState`.
- **Services** (`src/services/*`): `store` (Firestore persistence), `ai` (gateway + jobs),
  `google` (calendar/gmail/health), `phone` (host + relay transport), `shabbos`, `backup`.
- **Hooks** (`src/hooks/*`): `useLoadSave`, `useRealtimeSync`, `useNudges`, `useGoogleData`,
  `useDerivedTasks` — the lifecycle/effect logic, one concern each.
- **Feature folders** (`src/features/<surface>/`): each surface (focus, queue, insights,
  nervecenter, deskphone, shailos, health, settings) owns its components + local logic.
- **`App.tsx`** becomes a thin shell: providers + Switchboard + routed surfaces. Target < 300 lines.

---

## 4. Target stack & folder layout

```
SHAMASH_PRO5_REBUILD/
  REBUILD_PLAN.md  PROGRESS.md
  ANALYSIS/                      # one spec per subsystem (00 = delta; 10+ = code infra)
  app/                           # the Pro 5 application (Vite + React + TS)
    index.html  vite.config.ts  tsconfig.json  package.json
    src/
      main.tsx  App.tsx
      m3/            # @material/web wrappers (FilledButton…, IconBtn, ActionBtn, denseListVars)
      theme/        # tokens, deriveAccents, themeVarsCss, the 8 schemes, contrast engine
      state/        # zustand slices
      services/     # store(firestore), ai, google, phone, shabbos, backup
      hooks/        # lifecycle/effect hooks
      features/     # focus/ queue/ insights/ nervecenter/ deskphone/ shailos/ health/ settings/ auth/
      lib/          # pure utils (dates, hebrew, ids, formatters)
      mock/         # seed data for dev
    functions/      # rebuilt Firebase Functions (Phase 11), same HTTP contract
```
Version starts at **`5.0.0`**, shown in the left rail (same scheme: minor=feat, patch=fix).

---

## 5. Phased build order (lowest-risk-first; details + checkboxes in `PROGRESS.md`)

- **Phase 0 — Deep analysis.** Spec every subsystem into `ANALYSIS/NN-*.md` from current source.
- **Phase 1 — Foundation.** Vite+TS+React scaffold, `@material/web`, the `m3/` + `theme/` layer
  (bridge tokens, deriveAccents, themeVarsCss, 8 schemes, contrast), Zustand skeleton, mock data,
  empty Switchboard shell that switches surfaces. **Running shell.**
- **Phase 2 — Data + AI core.** `services/store` (Firestore v5 + cache + backups + reconcile),
  `services/ai` (gateway + all jobs), contrast/date/hebrew/aging/shabbos `lib/`.
- **Phase 3 — Auth + Switchboard.** Google sign-in, AuthGate, LoginScreen, rail + suite panels.
- **Phase 4 — Focus app.** Focus + Queue + Insights tabs, components, modals, ZenMode, timers,
  PostItStack (Stack/Board), Shelf.
- **Phase 5 — Shailos.** Queue logic + embedded mini-app (rebuilt from `apps/shailos`) + ShailaManager/Pill.
- **Phase 6 — NerveCenter.** Layout switch, all cards, AI headlines, TimelineFace, TaskRiver,
  ConvCapture, Chief learning, and the **full calendar timeline+agenda+multi-account** system.
- **Phase 7 — DeskPhone.** The unified phone surface end-to-end (host + relay), MiniDock, standalone.
- **Phase 8 — Health.** HealthPage + HealthCard + google-health.
- **Phase 9 — Voice & transcription.** VoiceInput + pending-recording queue.
- **Phase 10 — Settings.** Full settings modal.
- **Phase 11 — Backend.** Rebuild the 9 Functions, same contract; wire Pro 5 to them.
- **Phase 12 — Parity & polish.** Walk the Part 8 checklist; M3 consistency audit; full build/smoke.
- **Phase 13 — Cutover (GATED).** See Part 9. **Not autonomous.**

---

## 6. Security & data safety (standing gates)

- API keys never in the browser — all AI/Google through the serverless proxy (faithful to Pro 4).
- OAuth tokens: keep server-side refresh-token model; **encrypt stored tokens** (Pro 4 follow-up — do
  it right in Pro 5; see MEMORY `project_backend_security_followups`).
- `phoneRelay` read-volume: design polling to avoid the ~43k-reads/day trap (MEMORY).
- No rebuild step writes to the live Firestore project. Backups/restore tested against mock first.

## 7. Rollback

Every commit is small and reversible (`git revert`). Pro 5 is isolated, so reverting rebuild
commits never affects live Pro 4. The whole effort can be abandoned by deleting `SHAMASH_PRO5_REBUILD/`.

## 8. Parity mandate

`PROGRESS.md` carries a **parity checklist**: one row per Pro 4 feature (the Part 1 table, expanded
to Map-item granularity). A subsystem is "done" only when every row is implemented, build-gated, and
smoke-verified against the Pro 4 behavior. **Faithfulness is the acceptance test.**

## 9. Cutover (separate, owner-gated — NOT autonomous)

Replacing Pro 4 with Pro 5 in production touches live users and live data: deploy path, data
continuity (same Firestore — verify read/write compatibility), version/domain swap. This is
outward-facing and hard to reverse → **requires explicit owner GO**, a written cutover plan, and a
verified rollback. Until then Pro 5 ships nowhere.

---

## Decision: ✅ GO (build) for Phases 0–12 autonomously · ⚠️ HOLD Phase 13 (cutover) for owner GO
