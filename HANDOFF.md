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
