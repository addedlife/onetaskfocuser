# ANALYSIS 10 — Data + AI core (`apps/web/src/01-core.js`, 2008 lines)

> The authoritative spec for Pro 5's Phase 2. Read from the REAL source (commit at HEAD). This file
> is the warehouse: Firebase client, the `Store` persistence engine, color/contrast, date/Hebrew utils,
> task aging + Mrs. W, the AI gateway, and every AI job. Shabbos engine is in `src/shabbos.js` (separate).

## 1. Firebase / persistence
- `firebaseConfig`: project **onetaskonly-app**, authDomain **onetaskonly-app.firebaseapp.com** (the single
  canonical OAuth origin; web.app bounces here). `experimentalForceLongPolling: true` (Android reliability).
  IndexedDB persistence **disabled** — Firestore is the live source of truth; no stale cache served.
  `?resetCache=1` wipes a stuck IndexedDB; `?diag=1` uses `probeFirestore`/`authReport`.
- **Identity:** `canonicalUid(user)` = email prefix lowercased (`rabbidanziger@…` → `rabbidanziger`), unifying
  email/password + Google. Data path: `users/{uid}/…`.
- **Two storage modes** (`Store._v5 = true`):
  - **V5 (current): one Firestore doc per task.** Collections: `users/{uid}/tasks/{taskId}`,
    config doc `users/{uid}/config/settings`, `users/{uid}/config/meta` (`{schema:'v5_pertask'}`),
    shailos `users/{uid}/shailos/{id}`. Settings doc holds everything except tasks, plus `_lists`
    (`[{id,name,order}]`) and `_lastModified`.
  - **V4 (legacy fallback): one blob doc** `users/{uid}/appData/appState_v4` = `{state:{...AS}}`.
  - `_migrateToV5(blob)` batches (chunks of 400, <500 op limit) tasks → per-task docs, keeps the blob.
- **In-memory "AS" blob shape:** `{ lists: [{id, name, tasks: Task[]}], ...settings, _lsModified }`.
  `_flattenTasks` → `Map<id, {...task, listId, _sortIndex}>`; `_loadV5`/`_listenV5.rebuild` reconstruct
  `lists[].tasks[]` sorted by `_sortIndex`.
- **Safety (HANDOFF §9 — load-bearing):** catastrophic-delete guard refuses to overwrite non-empty tasks
  with empty state (both V4 + V5 save paths); blank-state save skipped unless load status is `ok`/`empty`;
  V4 save is a transaction that aborts if Firestore `_lsModified` is newer; `beforeunload` flushes
  **localStorage only** (never FB). `_saveV5` is diff-based (writes only changed/added/deleted docs).
- **Listeners self-heal:** `listenShailos` + `_listenV5` resubscribe with capped exponential backoff
  (onSnapshot is terminal after its error cb). Tasks have a localStorage fallback; **shailos do not**.
- **Backups:** File System Access API folder handle persisted in IndexedDB (`onetask_fsa` store, key
  `backupDir`). `autoFileBackup` (daily, dedup by YYYY-MM-DD, keeps 30), `fullBackup` (manual), weekly
  stamp. `_buildBackup` → `{_backupVersion:2, appState, shailos, _counts, …}`. `parseBackup`/`restoreShailos`.

## 2. Task shape (REAL field names — supersedes APP_ATLAS guesses)
`id` · `text` · `priority` (tier id) · `completed` (bool) · `createdAt` (ms) · `listId` (V5).
Lifecycle: `blocked` (truthy → sinks to bottom) · `snoozedUntil` (park til tomorrow) · `pinned`.
Grouping: `parentTask` (= the PARENT'S TEXT, not an id) · `stepIndex` (order in group).
Aging: `prioritySetAt` · `autoAged` · `agedFromPriId` · `agedFromLabel`. Mrs. W: `mrsW`.
Shaila link: `shailaId`. Internal: `_sortIndex` · `_lastModified`.
⚠️ `energy` (⚡/🌊) and context tags (@home/@phone) are referenced by the Feature Map but NOT set in
01-core — confirm their exact field names in `App.jsx` addTask/`04-components` (Phase 0.3/0.6) before relying.

## 3. Shaila shape + sync
Doc fields: `content` (full Q) · `synopsis` (short) · `status` ∈ **`pending`|`answered`|`got_back`** ·
`date` ("YYYY-MM-DD HH:MM") · `createdAt`/`updatedAt` (serverTimestamp) · `userId` · `askerName` ·
`answer` · `answererName` · `parsedShaila` · `_taskAppSource` (created from a task). Research fields live
in `apps/shailos` (Phase 0.9).
**Shaila↔task flows:** (1) pending shaila w/o task → create `priority:"shaila"` task w/ `shailaId`;
(2) new shaila-priority task → `createShailaFromTask` (uses `task.shailaId` as doc id); (3) shaila answered
→ complete linked task; (4) task completed → `markShailaAnswered`. `reconcileShailos` finds mismatches.

## 4. Priorities / aging / Mrs. W
`DEF_PRI` (REAL): `shaila`#C8A84C w5 isShaila · `now`#E09AB8 w3 · `today`#E0B472 w2 · `eventually`#7EB0DE w1.
Priority fields: `id,label,color,weight,isShaila?,deleted?(soft),superPinned?`. `gP(pris,id)` looks up.
`DEF_AGE_THRESHOLDS = {shaila:24, now:48, today:120, eventually:336}` (hours). `applyTaskAging`: Eventually
promotes after 14d, other non-top tiers after 21d (uses `prioritySetAt`||`createdAt`; sets `autoAged`).
`getMrsWPriority`: windows Mon–Thu 08:30–13:00, Fri 08:30–10:00 → in-window returns highest non-shaila
weight, else lowest weight. (`BEFORE_SHAVUOS` priority is retired/`deleted` — Shavuos passed.)

## 5. `optTasks(tasks, pris)` — the non-AI smart sort (reproduce faithfully)
Splits completed / blocked (always bottom) / pinned / unpinned. `scoreTask` = `weight*100` + age bonus
(scaled by how high the tier is) + keyword urgency (`urgent|asap|deadline|critical|shaila|psak`→+5,
`soon|important|meeting|call`→+2, `maybe|someday|eventually`→−2) + stale log-bonus (>48h) + `isShaila`→+50
+ `mrsW`→+3. Subtask groups (`parentTask`) scored by parent weight only (no age drift); any pinned subtask
pins the group. Final = pinned, pinned groups, scored items desc, then blocked, then completed.

## 6. AI gateway (client side — prompts are SERVER-SIDE)
`AI_PROXY_ENDPOINT = "/api/ai-proxy"`, 30s abort. `callAIProxy(payload)` attaches Firebase ID token
(Bearer), returns parsed JSON or **null** on error/timeout (callers degrade gracefully). Dispatchers:
- `runAIJob(job, input, aiOpts, {mode,genConfig})` → `{job, input, mode, provider, model, geminiCredential, genConfig}`
- `callAI(prompt, aiOpts, genConfig)` → `{kind:"text", task, provider, model, prompt, genConfig}` (default provider gemini — **Pro 5 default = claude** per owner)
- `callGeminiAudio(gk, base64, mime, prompt)` → job `transcribe.yeshivish.v1`, returns `output.transcript`.
**Job IDs + outputs:** `task.optimize.basic.v1`(→ index array) · `task.optimize.analysis.v1`(→{order,
alreadyOptimal,insight,urgentOverride}) · `task.first_step.v1`(text) · `shaila.parse.simple.v1`(→[{shaila,
answer,askedBy,answeredBy}], temp 0.1) · `settings.color_schemes.v1` · `shaila.detect_answers.v1`(→[{id,
answer}]) · `conversation.extract.v1`(temp 0.1, 8192) · `schedule.parse_event.v1`(→GCal event body;
`withCalendarEventDefaults` adds tz America/New_York + reminders) · `task.parse_brain_dump.v1`(→tasks +
scheduleItems) · `shaila.answer_summary.v1`(temp 0.1, 24 tok). The 11 prompt templates live in
`apps/web/functions/ai-proxy.js`/`_ai-core.cjs` → Phase 0.11 / Phase 11.

## 7. Constants & utils to port
- **8 SCHEMES (real hex)** — fields `bg,bgW,card,text,tSoft,tFaint,brd,brdS,grad[3],primary,onPrimary,
  tonal,onTonal,success,danger,warning,glow?`. ⚠️ Pro 5's `theme/schemes.ts` currently uses *approx* values —
  reconcile to these real hexes (FIDELITY TODO). `ensureSchemeContrast` runs on every scheme at load
  (Pro 5 has `theme/contrast.ts` — wire it into scheme application).
- `PALETTE` (16 random task-accent hexes), `PROMPTS` (5), `TIPS` (30, each `{t,s,cat,url}` with citations).
- **`YC`** Yeshivish phonetic-correction map (~120 entries) + `cleanYT(text)` — domain-critical for
  transcription; port verbatim. `uid()`, `canonicalUid`, `gG` greeting, `dayKey`, `tipOfDay`, `fmtMs`,
  `pBg` (pastel), `textOnColor`/`priText`/`_priTextMap`.

## 8. Pro 5 mapping (structural improvements, behavior identical)
- `services/store.ts` — the `Store` object, rebuilt: typed, mock-backed by default, real Firestore behind a
  flag; keep ALL safety guards (catastrophic-delete, transaction freshness, self-healing listeners). Same
  collection paths/shapes so it reads existing data at cutover.
- `services/ai.ts` — `callAIProxy`/`runAIJob`/`callAI` + one typed function per job. Same job IDs/inputs.
  Default provider **claude** (`claude-haiku-4-5-20251001`), caching on.
- `lib/` — `ids`, `priorities` (gP, DEF_PRI), `aging` (applyTaskAging, isTaskAged, getTaskAgeHours),
  `mrsW`, `optimize` (optTasks), `yeshivish` (YC+cleanYT), `dates` (dayKey, fmtMs, greeting), `tips`.
- Normalize tasks into the store keyed by id+listId (cleaner than nested `lists[].tasks[]`); map to/from
  the persisted `lists[].tasks[]` / per-task-doc shapes at the persistence boundary.
