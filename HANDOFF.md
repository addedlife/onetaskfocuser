# HANDOFF — Storage / sync rebuild + open issues

_Last updated: 2026-06-02. Written for a fresh Claude Code session running **locally on the
PC** (which can `firebase login` and reach Firestore directly — no pasting required).
Read this top to bottom before changing any storage code._

---

## 0. How to use this doc
You are picking up a multi-day effort to fix chronic "stale data" problems in **Shamash
Pro 4** (the web app under `apps/web`). The web session that wrote this could NOT see the
live Firestore data (no Firebase connector, no secrets store in Claude-on-web), so it kept
diagnosing blind and got several things wrong. **Your #1 advantage is direct Firebase
access. Use it to MEASURE before you change anything.** Do not repeat the remote-guessing.

---

## 1. Current situation (the live incident)
- The owner uses **iPad + desktop** (these update fine) and an **Android tablet** that has
  been **chronically ultra-stale** for months.
- Most recent event: on the Android device the owner ran the new **full reset** button
  (clear caches + unregister SW + `?resetCache=1`). Result: **the Android device now shows
  NO tasks at all** (was: stale tasks; now: empty).
- **Unverified:** whether the server (`users/rabbidanziger`) still holds all the tasks.
  Desktop/iPad presumably still show them (= data safe), but this was never confirmed with
  hard data. **FIRST JOB: confirm the server data is intact (see §3).**
- **Data-loss risk to guard against:** a device that loads *empty* and then saves could
  overwrite the server with emptiness. A "refuse catastrophic delete" guard was designed
  but **NOT yet implemented** (see §7).

---

## 2. Critical facts (verify, don't trust blindly)
- **Firebase project:** `onetaskonly-app`
- **App account in use:** `rabbidanziger@hocsouthbend.com` (confirmed via the connected
  Google Drive owner). 
- **UID scheme:** `canonicalUid(user)` in `apps/web/src/01-core.js` returns the **email
  prefix**, lowercased → uid = **`rabbidanziger`** (NOT the Firebase Auth random uid).
- **Firestore layout (all under `users/{uid}/`):**
  - `tasks/{taskId}` — V5 per-task docs: `{ text, priority, completed, listId, _sortIndex,
    shailaId?, parentTask?, type?, createdAt, _lastModified }`
  - `config/settings` — app settings + `_lists` (list metadata array)
  - `config/meta` — `{ schema: 'v5_pertask' }` migration marker
  - `appData/appState_v4` — **legacy V4 blob** `{ state: <whole AS> }`
  - `shailos/{shailaId}` — `{ content, parsedShaila?, synopsis?, answer?, status:
    'pending'|'answered'|'got_back', userId, createdAt, updatedAt }`
- **Local mirrors:** `localStorage["onetaskonly_v4_<uid>"]` (AS blob) + the Firestore SDK's
  own IndexedDB offline cache (`enablePersistence`).
- ⚠️ **Rules inconsistency to audit with real access:** `apps/shailos/firestore.rules`
  gates `users/{userId}/**` on `request.auth.uid == userId`, but the app writes under
  `users/{emailPrefix}` while `auth.uid` is the Firebase random uid — these don't match,
  yet the app works. That means the **deployed** rules are almost certainly more permissive
  than the repo (likely `allow if request.auth != null`), which is a **security hole**
  (any signed-in user could read/write any other user's tree). **Check the live rules in
  the Firebase console and reconcile.**

---

## 3. FIRST: measure the server (with your local Firebase access)
Do this before touching storage code:
```bash
firebase login            # or use a service account
firebase firestore:databases:list --project onetaskonly-app
```
Then read the actual data, e.g. with a tiny `firebase-admin` script or the Firebase MCP:
- Count docs in `users/rabbidanziger/tasks` → is the data on the server? (confirms the
  Android empty was a local-only problem, or reveals real loss).
- Read `users/rabbidanziger/config/meta` (schema), `config/settings` (`_lists`),
  `appData/appState_v4` (does the legacy blob still exist?), and `shailos` count.
- **Back up everything first**: dump `users/rabbidanziger/**` to a JSON file and keep it.
If tasks are present on the server → data is safe; the chronic Android problem is
client-side (code/cache/transport). If the server is empty/short → STOP and restore from
the V4 blob, the owner's exported backup, or the `localStorage` of a device that still has
them (the app has a `?restoreLocal=1` path in `Store.load()` for pushing a device's
localStorage up).

---

## 4. Root cause of the chronic staleness (the real disease)
The data layer hand-rolls offline sync with **four competing sources of truth** that fight
each other:
1. `localStorage["onetaskonly_v4_*"]` blob (used as a fallback source)
2. Firestore `appData/appState_v4` blob doc (legacy V4)
3. Firestore `users/{uid}/tasks` per-task collection (V5)
4. The Firestore SDK's own IndexedDB offline cache

Plus manual reconciliation in `App.jsx` (shaila↔task sync, bulk deletion logic) and dual
load/migrate paths in `Store.load()`. This tangle is why data goes stale, empties, or
"holds onto" old categories depending on which source wins on a given device.

**Industry-standard fix (the target):** Firestore + its built-in offline persistence as
the **single source of truth**. One per-task collection, one settings doc, one listener;
writes go straight to Firestore (SDK queues them offline and syncs on reconnect). Delete
the localStorage-as-source layer, the V4 blob path, and the manual reconciliation. Keep the
existing `rebuild()` that reconstructs the UI's AS-blob shape so the UI layer is untouched.

---

## 5. The planned rebuild (do this WITH real data + a backup in hand)
1. **Back up** `users/rabbidanziger/**` (see §3).
2. In `apps/web/src/01-core.js` `Store`:
   - Make the **V5 per-task collection the only source**. Remove the V4-blob fallback in
     `load()` and the `localStorage` fallback as a *source of truth* (localStorage may stay
     as a last-resort read-only cache, but must never win over a server-confirmed load).
   - Collapse `load()` to: ensure migration once (V4 blob → per-task, if `appData` still
     has data and `tasks` is empty), then read the collection; otherwise just attach the
     live listener and let the SDK cache serve offline.
   - Keep the resilient `_listenV5` (self-resubscribe) and `listenShailos` already added.
   - Keep `experimentalForceLongPolling` + single-tab `enablePersistence()` (already set).
3. **Migration safety (non-negotiable):** the migration must only ADD/transform, never bulk
   delete. Verify task counts before/after. Run it once against a test account or with the
   backup ready to restore.
4. Simplify the `App.jsx` shaila↔task reconciliation; keep the `fromCache` guard on
   deletions (already added) so a cached snapshot can't delete tasks.
5. Verify on a real device via `?diag=1` (see §8): `Latest snapshot = from server`,
   `Last server sync` recent, tasks present.

---

## 6. What this session already changed (all on `main`, deployed)
Newest first (see `git log`):
- `403a66f` — **On-device diagnostics** `?diag=1` overlay (`src/diagnostics.jsx`) + sync
  telemetry in `Store` (`getDiagnostics()`, `_noteSync`, `forceResync()`); build stamp via
  vite `define` (`__BUILD_COMMIT__/__BUILD_TIME__`).
- `0b51826` — Firestore: **single-tab** `enablePersistence()` (was `synchronizeTabs:true`,
  a documented stale-emit source, firebase-js-sdk#6511) + **`?resetCache=1`** hatch
  (`clearPersistence()` then reload, for corrupted IndexedDB, #8593).
- `7411bdb` — Service worker **navigates its clients on activate** to break the stale-PWA
  trap (Android resumes old code); proactive `registration.update()`; **forceLongPolling**
  (was autoDetect); cache bumped to `v3`.
- `4cd24f4` — AI hardening: timeouts on OpenAI/Claude calls, `maxOutputTokens` cap,
  repair-parse guard; frontend AI error handling (Zen dump batch, reorder spinner, shaila
  parse string-coercion).
- `b8bc36a` — **Resilient task listener** `_listenV5` (self-resubscribe; the empty error
  handler was the real "ultra-stale" bug); foreground/online Firestore reconnect kick;
  shaila deletion guarded by `fromCache`; `postJson` timeout; SW `networkFirst` timeout.
- `215766d` — Resilient `listenShailos`; SW cache bump (v2); mobile `MobileSection` hoisted
  out of render (was remounting every clock tick, dropping taps); login redirect errors
  surfaced; phone "not connected" label.

Note: several of these were the right *direction* but never confirmed against real data.
Re-verify with `?diag=1` once you know the server truth.

---

## 7. NOT DONE — the data-protection guard (implement this early)
Designed but **not implemented** (session was interrupted). Add a "refuse catastrophic
delete" guard so an empty/short load can never wipe the server:
- In `Store._saveV5(s)` (`apps/web/src/01-core.js`, ~line 951) **before** building the
  delete batch: if the new state has 0 tasks (or e.g. <25% of `_lastSavedState`'s task
  count) while `_lastSavedState` had many, **abort the save** and log/flag, unless an
  explicit user "clear all" intent is set. The current guard only blocks blank saves when
  `_fbLoadStatus` is not `ok`/`empty` — it does NOT protect the `ok`/`empty` case, which is
  exactly the Android failure mode.
- Mirror the same guard in `Store.saveToFB(s)` (V4 path, ~line 410).
This is pure protection and low-risk; ship it first.

---

## 8. Diagnostic tooling available (use it to verify on devices)
- **`?diag=1`** → `https://onetaskfocuser.netlify.app/?diag=1` shows a black overlay
  (`src/diagnostics.jsx`): build commit/time (is the device on fresh code?), account uid,
  online state, latest-snapshot source (server vs CACHE), last server-sync age, load
  status, whether a SW controls the page. Buttons: Force resync, Reset Firestore cache,
  full reset (unregister SW + clear caches + reload).
- **`?resetCache=1`** → clears the Firestore IndexedDB cache then reloads clean.
- Build stamp: compare `Build time` on the device to the latest deploy to detect stale code.

---

## 9. Safety rules / do-not-break
- **Back up `users/rabbidanziger/**` before any storage change.** Non-negotiable.
- Migration may **only add/transform, never bulk-delete**. Verify counts.
- Don't push a storage refactor straight to `main` (auto-deploys to the owner's live prod)
  without first verifying against the backup / a test account. (Normal small fixes: the
  owner wants push-to-`main`.)
- Operating Law (`AGENTS.md`): research current best practice before a change; if it
  conflicts with the local plan, flag it and get confirmation. The owner explicitly asked
  for **research-first, always**.
- Record verification in `docs/ops/VERIFICATION_LOG.md`.

## 10. Getting Firebase access locally (so you're not blocked like the web session was)
- `firebase login` (Firebase CLI) for interactive access, OR
- a service-account JSON + `firebase-admin` in a Node script, OR
- the Firebase MCP: `npx -y firebase-tools@latest experimental:mcp` added as a custom MCP
  server. Any of these let you read/back-up/migrate directly.

## 11. File map (apps/web/src)
- `01-core.js` — Firebase init, `Store` (load/save/listeners/migration/telemetry),
  `canonicalUid`, AI helpers. **Main target of the rebuild.**
- `00-auth.jsx` — auth gate, login, redirect handling, mounts `?diag=1` overlay.
- `diagnostics.jsx` — the `?diag=1` overlay.
- `08-app-split/App.jsx` — app shell, data orchestration, shaila↔task reconciliation,
  Google OAuth/health.
- `08-app-split/components/NerveCenterPanel.jsx` — dashboard (mobile `MobileSection`).
- `offline-support.js` + `public/sw.js` — service worker registration + caching.
- `apps/shailos/` — the AI Studio Shailos applet (writes shailos to the same project).
- `apps/web/backend/functions/` — Netlify functions (`_ai-core.cjs` AI brain, `mcp.mjs`,
  google-*, `phone-relay.mjs`). Open audit items: MCP hardcoded to one user + optional
  unauthenticated reads; `debug-log` unauthenticated; relay command validation.
- `apps/phone-host-windows/` — native C# DeskPhone host. Open: `MapService._seenHandles`
  not reset on reconnect (stale SMS sync); `ControlApiService` binds `0.0.0.0` no auth.
  (These affect phone features, NOT task freshness.)

---

## 12. Lesson for the next session
The web session diagnosed the Android staleness wrong repeatedly because it never had
ground-truth from the device or the server. **You do.** Pull the real Firestore data and
read the device's `?diag=1` BEFORE writing code. Measure, then fix.

---

## 13. AI Gateway Architecture — current state (2026-06-12)

_This section was written after a full redesign of the dashboard AI layer in commits
`0dc63f7` and `bf14d50`. Read it before touching any AI-related code._

---

### 13.1 The problem that was fixed

The app previously fired **5+ simultaneous AI calls on every page load**, all targeting
the same `gemini-3.1-flash-lite` quota lane (15 RPM free tier = 1 slot per 4 seconds).
The Netlify Lambda function queue times out at **8 seconds**. A 5th simultaneous job waits
20+ seconds → guaranteed 429 every load. `dashboard.river_rank.v1` (the Task River AI
prioritizer) always fired last and always lost. The result was the "AI restrained" loop
the user saw.

Secondary problem: the 90-second snapshot refresh gap, combined with frequent Gmail/task
updates, was burning through the **1,000 RPD** (requests per day) free-tier limit.

---

### 13.2 Architecture now — two calls per page load

| Time | Call | What it does |
|------|------|-------------|
| T+0s | `dashboard.snapshot.v1` | Single consolidated call: NerveCenter summary + task suggestions combined |
| T+4s | `dashboard.river_rank.v1` | Task River AI prioritization (4-second startup delay ensures snapshot gets its slot first) |
| After Gmail loads | `dashboard.email_summaries.v1` | One-sentence summaries per email; ID-based dedup prevents re-runs |
| User clicks "✦ Brief me" | `dashboard.chief_of_staff.v1` | **Beta — manual-only.** Never auto-fires. |

**Removed as auto-fire jobs (2026-06-12):**
- `dashboard.nervecenter_summary.v1` — merged into snapshot
- `dashboard.task_suggestions.v1` — merged into snapshot
- `dashboard.chief_of_staff.v1` auto-fire — now pill-only (see §13.5)

---

### 13.3 AI model used everywhere

All dashboard jobs use `QUOTA_FALLBACK_GEMINI_MODEL = "gemini-3.1-flash-lite"` (defined
in `apps/web/backend/functions/_ai-core.cjs` line ~24). This is the free-tier model with
the highest RPD allowance (1,000/day, 15 RPM). Do NOT change individual jobs to other
models without understanding cross-job quota contention.

The **wrong model name `"gemini-2.5-flash-lite"`** was briefly introduced in commit
`e0c7925` and reverted in `0dc63f7`. If you ever see that string again, remove it.

---

### 13.4 Throttle constants — the three brakes on quota usage

**Snapshot** (`NerveCenterPanel.jsx` lines ~231–234):
```
SNAPSHOT_CACHE_MS   = 20 * 60 * 1000   // 20 min cache TTL
SNAPSHOT_MIN_GAP_MS =  8 * 60 * 1000   // 8 min min-gap between calls (shared across tabs via localStorage)
SNAPSHOT_LAST_RUN_KEY = 'ot_nc_snapshot_last_run_v1'
SNAPSHOT_CACHE_KEY    = 'ot_nc_snapshot_v1'
```

**River rank** (`TaskRiverPanel.jsx` lines ~16–17):
```
RANK_MIN_GAP_MS = 4 * 60 * 1000   // 4 min min-gap (shared across tabs via localStorage)
RANK_LAST_RUN_KEY = 'ot_river_rank_last_run_v1'
```
Throttle is bypassed for: user-triggered reprioritize (`lastRankKeyRef === ''`), and
retries after failure (`retryStreakRef.current > 0`).

**Email summaries** (`App.jsx` inside `applyEmailSummaries`):
```
EMAIL_SUMMARIES_IDS_KEY = 'ot_email_summaries_ids_v1'
```
Dedup by sorted message-ID string — re-runs only when the inbox composition changes.

**Estimated RPD with these brakes:** ~200–250/day (well inside the 1,000 free-tier limit
even with two tabs open, since all three throttles use localStorage which is shared across
tabs on the same origin).

---

### 13.5 Chief of Staff — beta / pill-only

`dashboard.chief_of_staff.v1` **does not auto-fire**. The auto-fire `useEffect` was
removed and replaced with a manual trigger only.

**UI:** A "✦ Brief me — beta" pill button renders on the Chief of Staff page when no
brief is loaded and it isn't loading. Clicking it increments `chiefRefreshNonce`, which
triggers the effect.

**Code location:** `NerveCenterPanel.jsx`
- Effect: lines ~1139–1213 (deps: `[chiefRefreshNonce, chiefPage]` only — no `chiefScanKey`)
- Pill button: around line ~2001–2005
- The effect still reads/writes the `CHIEF_SCAN_CACHE_KEY` localStorage cache, so a
  cached brief loads instantly without a new API call when the user opens the page.

---

### 13.6 Full AI job registry (all jobs in `_ai-core.cjs`)

| Job ID | Model | Trigger | Purpose |
|--------|-------|---------|---------|
| `dashboard.snapshot.v1` | flash-lite | Page load (8-min throttle) | NerveCenter summary + task suggestions combined |
| `dashboard.river_rank.v1` | flash-lite | Items change (4-min throttle, 4s startup delay) | Task River prioritization scores + labels |
| `dashboard.email_summaries.v1` | flash-lite | Gmail load (ID dedup) | One-sentence summaries per email |
| `dashboard.chief_of_staff.v1` | flash-lite | User clicks "Brief me" only | Executive next-action brief |
| `dashboard.chief_dialogue.v1` | flash-lite | User submits a question in CoS chat | Conversational follow-up in Chief chat |
| `dashboard.polish_items.v1` | flash-lite | User-triggered (polish button) | Rewrites raw task/shaila text for clarity |
| `dashboard.nervecenter_summary.v1` | flash-lite | **ORPHANED** — no longer called from client | Legacy job; kept for back-compat but nothing fires it |
| `dashboard.task_suggestions.v1` | flash-lite | **ORPHANED** — no longer called from client | Legacy job; kept for back-compat but nothing fires it |
| `transcribe.yeshivish.v1` | Gemini audio | Voice input | Yeshivish-aware speech-to-text |
| `halacha.*` | various | On demand | Halacha research/psak generation |

---

### 13.7 `dashboard.snapshot.v1` — what it returns

The server-side job (`_ai-core.cjs` line ~1050) returns one JSON object:
```json
{
  "supercrunch": "terse comma-separated list of named items across all sources",
  "signals": [{ "area": "Calendar", "note": "terse note" }],
  "taskSuggestions": [{ "text": "...", "priorityId": "...", "source": "...", ... }]
}
```
The client (`NerveCenterPanel.jsx` snapshot effect) splits this:
- `supercrunch` + `signals` → `setNcSummary()`
- `taskSuggestions` → processed through `decorateTaskSuggestion` + dedup filters → `setTaskSuggestions()`
- Full result cached under `SNAPSHOT_CACHE_KEY` in localStorage

Input to the job: `{ context: chiefContext, priorityOptions, existingTasks, learningProfile }`

---

### 13.8 How to diagnose AI failures

**"AI restrained — retry in Xs"** (TaskRiver status bar):
- `retryIn` state is set → river_rank failed, retry countdown is running
- First failure retries at 20s, then 45s, then 90s max delay
- If it keeps failing: check the Netlify function log for 429s (quota) or 502s (Lambda timeout)

**"AI unavailable"** (TaskRiver):
- `aiState === 'error'` with no retry pending
- Usually means all retry attempts exhausted, or `aiOpts` is null (AI gateway not configured)

**NerveCenter summary missing / blank**:
- Check `ncSummaryError` state — the UI shows an error pill with a Retry button
- Check `console.warn("[Snapshot]...")` messages in browser console
- Check `localStorage['ot_nc_snapshot_last_run_v1']` timestamp — if very recent, the 8-min gate is holding

**To force a fresh snapshot immediately** (debug only):
```javascript
localStorage.removeItem('ot_nc_snapshot_last_run_v1');
localStorage.removeItem('ot_nc_snapshot_v1');
// then reload
```

**To reset the river rank throttle:**
```javascript
localStorage.removeItem('ot_river_rank_last_run_v1');
```

---

### 13.9 What is still NOT done

1. **Settings toggle for Claude Haiku** — the Settings UI has visual provider-selection
   controls but they don't reliably wire through to all dashboard jobs. The toggle exists,
   instructions for Haiku setup don't. Low priority.

2. **`dashboard.nervecenter_summary.v1` and `dashboard.task_suggestions.v1`** are orphaned
   in the registry. They still exist on the server and are safe to call directly. They're
   not harmful, but they waste space. Could be removed from the registry in a cleanup pass
   (low risk — nothing calls them).

3. **Firestore rules security issue** — documented in §2 above; unrelated to AI but still
   open.

---

### 13.10 Server infrastructure

- **Netlify Lambda:** `apps/web/backend/functions/ai-proxy.js` + `_ai-core.cjs`
- **Function budget:** ~26–30s total execution time per invocation
- **Gemini quota gate:** Firestore-backed rate limiter (`reserveGeminiSlot`). Shared across
  all Lambda invocations via Firestore. Queue timeout: 8 seconds. If a job waits >8s in
  the Firestore queue it gets a 429 that propagates to the client.
- **Retry-after:** The 429 response includes a `retryAfterSeconds` hint but `callAIProxy`
  in `01-core.js` currently returns null on any error (does not expose the hint to the
  client). If you need smart retry timing, wire `retryAfterSeconds` from the Lambda
  response through `callAIProxy`.

---

_Next session: read §13 first, then `BRIEF.txt` for live state._
