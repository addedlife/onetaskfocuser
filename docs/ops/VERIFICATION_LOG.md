# Verification Log

## 2026-05-11

### `apps/web` — NerveCenter "Next Step" panel + Claude routing

- Added Claude provider support to `apps/web/backend/functions/_ai-core.cjs`:
  - Closed the `normalizeProvider` trapdoor that previously mapped `"claude" -> "gemini"`.
  - Added `CLAUDE_MODELS` registry (default `claude-haiku-4-5-20251001`).
  - Added `callClaude` (raw `fetch` to Anthropic Messages API, 60s abort, prompt caching via `cache_control: ephemeral` on the system prompt).
  - `processAiPayload` now dispatches `provider: "claude"` to `callClaude`; audio path remains Gemini-only.
  - `publicAiConfig` exposes `available.claude` (true when `ANTHROPIC_API_KEY` is set) and `models.claude`.
- Extended `apps/web/src/01-core.js` `callAI` to pass `system` and `messages` through to the proxy (used by new chat turns; existing Gemini callers unaffected).
- Added `NextStepCard` to `apps/web/src/08-app-split/components/NerveCenterPanel.jsx`:
  - Compact card inserted below the Google strip in the NerveCenter.
  - On mount and on user-clicked refresh, builds a sweep from tasks + shailos + calendar + Gmail + local DeskPhone `/messages` + `/calls`, then asks Claude Haiku 4.5 for one verb-first next action.
  - Inline "Ask" chat using `messages` array for multi-turn follow-ups.
  - Stores up to 10 user feedback entries (`did` / `skip`) in `localStorage` key `nc_next_step_feedback_v1`, feeds last 5 into each new sweep so the recommendation "learns" what the user passes on.
- `npm ci` passed.
- `npm run build` passed. Same preexisting 1.4 MB chunk-size warning as 2026-05-10; no new warnings.
- **Pending external configuration:** `ANTHROPIC_API_KEY` must be set in Netlify env vars for the new path to function in production. Until set, the NextStep panel will display the gateway error message; the rest of the app (including existing Gemini-backed AI calls) is unaffected.
- Not yet verified: runtime behavior in browser, live host `/messages` and `/calls` field-name mapping inside the AI sweep. Field names were modeled on the same candidates the sibling `NerveCenterPhoneSurface` uses.

## 2026-05-10

### `apps/web`

- `npm ci` passed.
- `npm run build` passed.
- `node scripts/copy-shailos-to-dist.cjs` passed and copied generated Shailos output into `dist/shailos`.
- Build warning: main web bundle is larger than 500 kB after minification. This is a performance cleanup target, not a migration failure.
- Dependency audit reported 20 vulnerabilities. This should be triaged before production cutover, but no automatic fix was applied in this migration pass.

### `apps/shailos`

- `npm ci` passed.
- `npm run build` passed.
- Build warning: Shailos bundle is larger than 500 kB after minification. This is a performance cleanup target, not a migration failure.
- Dependency audit reported 5 vulnerabilities, including 1 critical. This should be triaged before production cutover, but no automatic fix was applied in this migration pass.

### `apps/phone-host-windows`

- `dotnet build` passed.
- Existing warnings remain:
  - `InTheHand.Net.Bluetooth 4.1.0` resolves to `4.1.40`.
  - Several nullable/async warnings in existing DeskPhone source.
- No C# build errors.

### Current Conclusion

The clean Shamash Pro 4 workspace has enough source-grade files to build all three lanes independently. It is not ready for production cutover until runtime smoke tests, dependency/security triage, and deploy wiring are completed.

After verification, generated folders were removed again to keep the Pro 4 tree lean:

- `node_modules/`
- `dist/`
- `bin/`
- `obj/`

Current source-grade file count after cleanup: 162 files.

## 2026-05-10 Runtime Preview Pass

### Visible local preview

- Pro 4 production preview is running at `http://127.0.0.1:4305/?suite=nervecenter`.
- Shailos preview route is running at `http://127.0.0.1:4305/shailos/`.
- Phone host status is running at `http://127.0.0.1:8765/status`.

### Phone host API

- Launched the compiled Pro 4 `DeskPhone.exe` directly from `apps/phone-host-windows/bin/Debug/net8.0-windows10.0.19041.0`.
- `GET /status` passed.
- `GET /messages` passed.
- `GET /calls` passed.
- `GET /contacts` passed.
- Finding: `/messages` returned about 18.9 MB. It works, but this is a performance target before calling the Pro 4 phone path peak-efficient.

### Web preview

- `npm run build` passed.
- `node scripts/copy-shailos-to-dist.cjs` passed.
- `vite preview` is serving the built output on port `4305`.
- Main route returned HTTP 200.
- `/shailos/` returned HTTP 200.

### Backend functions

- Restored missed Netlify functions into `apps/web/backend/functions`.
- Added `apps/web/backend/functions/package.json` with `type: commonjs` so CommonJS Netlify functions are explicit inside the Vite app's `type: module` package.
- `node --check` passed for:
  - `ai-proxy.js`
  - `app-config.js`
  - `claude-proxy.js`
  - `gemini-proxy.js`
  - `mcp.mjs`
  - `serper-proxy.js`
  - `_ai-core.cjs`

### Remaining before go-live

- CEO visual pass in the browser.
- Dependency/security audit triage.
- Performance cleanup for large bundles and large phone `/messages` payload.

## 2026-05-10 Final Pre-Live Pass

### Netlify local runtime

- `npx netlify dev --offline --no-open --dir dist --functions backend/functions --port 4310 --functions-port 4311` started successfully.
- `http://127.0.0.1:4310/?suite=nervecenter` returned HTTP 200.
- `http://127.0.0.1:4310/.netlify/functions/app-config` returned HTTP 200 and valid AI/config JSON.

### Phone payload optimization

- Changed the Pro 4 phone host `/messages` endpoint to default to `limit=1200`.
- Added `includeAttachmentData=1` as an explicit opt-in for embedded MMS image data.
- Updated DeskPhone Web to request `/messages?limit=1200`.
- Rebuilt the phone host successfully.
- Measured payloads after relaunch:
  - `GET /messages`: about 0.69 MB.
  - `GET /messages?limit=1200`: about 0.69 MB.
  - `GET /messages?limit=1200&includeAttachmentData=1`: about 10.1 MB.
  - Previous default was about 18.9 MB.

### Final local test URLs

- Netlify-style local preview: `http://127.0.0.1:4310/?suite=nervecenter`
- Static production preview: `http://127.0.0.1:4305/?suite=nervecenter`
- Shailos route: `http://127.0.0.1:4305/shailos/`
- Phone host: `http://127.0.0.1:8765/status`

### Remaining before public live preview

- Visual approval in the local browser.
- Decide whether to create a Netlify draft deploy for a public test URL.
- Do not deprecate old folders until the public test URL passes and rollback has been confirmed.

## 2026-05-10 Draft Deploy

- Created Netlify draft deploy only, not production.
- Preview URL: `https://6a0107f21f09b1f505a3e7da--onetaskfocuser.netlify.app`
- Build logs: `https://app.netlify.com/projects/onetaskfocuser/deploys/6a0107f21f09b1f505a3e7da`
- Function logs: `https://app.netlify.com/projects/onetaskfocuser/logs/functions?scope=deploy:6a0107f21f09b1f505a3e7da`
- Public root route returned HTTP 200.
- Public `/shailos/` route returned HTTP 200.
- Public `/.netlify/functions/app-config` route returned HTTP 200.
- Production URL remains unchanged.

## 2026-05-10 Draft Preview Hotfix

### Issue Found In Preview

- AI functions were reachable locally but blocked from Netlify branch deploy URLs by the function CORS allowlist.
- Conversation recording buttons could open a blank screen because the capture component referenced recording helpers that were not imported.
- Gemini default model `gemini-2.5-flash` is currently returning quota/rate-limit errors on the configured key.

### Fixes Applied

- Allowed Netlify branch deploy origins ending in `--onetaskfocuser.netlify.app` for AI and Serper functions.
- Added the missing conversation recording imports in `ConvCapture.jsx`.
- Added a controlled Gemini quota fallback from `gemini-2.5-flash` to `gemini-2.5-flash-lite`.

### Latest Draft Preview

- Preview URL: `https://6a010ab82d99e0fff8c159c9--onetaskfocuser.netlify.app`
- Public root route returned HTTP 200.
- Public `/shailos/` route returned HTTP 200.
- Public `/.netlify/functions/app-config` route returned HTTP 200.
- Public `/.netlify/functions/ai-proxy` returned HTTP 200 from the preview origin with model `gemini-2.5-flash-lite` and response `OK`.
- `npm run build` passed after the hotfix.
- Production URL remains unchanged.

## 2026-05-10 Production Promotion

- Promoted Shamash Pro 4 to production with Netlify deploy `6a01194dc5d71bfed30a76ea`.
- Live URL: `https://onetaskfocuser.netlify.app`
- Build command passed during production deploy.
- Functions bundled from `apps/web/backend/functions`.
- Production root route returned HTTP 200.
- Production `/shailos/` route returned HTTP 200.
- Production `/.netlify/functions/app-config` route returned HTTP 200.
- Production `/.netlify/functions/ai-proxy` returned HTTP 200 from the production origin with model `gemini-2.5-flash-lite` and response `OK`.
- Legacy web, Shailos, and DeskPhone folders were preserved and marked as rollback sources, not deleted.

## 2026-05-10 Legacy Mothball Pass

- Moved old web source from `taskmanager app\sandbox` to `taskmanager app\_MOTHBALLED_ROLLBACK_ONLY_sandbox_2026-05-10`.
- Moved old Shailos source from `backup\sto-src\Shaila-Trancriber-Organizer-main` to `backup\sto-src\_MOTHBALLED_ROLLBACK_ONLY_Shaila-Trancriber-Organizer-main_2026-05-10`.
- Moved old DeskPhone source into `PC as Bluetooth call - text interface\_MOTHBALLED_ROLLBACK_ONLY_DeskPhone_2026-05-10`.
- The old DeskPhone path residue was renamed to `PC as Bluetooth call - text interface\_TOMBSTONE_DO_NOT_USE_DeskPhone_old_path_residue_2026-05-10` because Windows/OneDrive protected `.git` and scratch metadata during the move.
- Updated `BRIEF.txt` so cold-start routing points only to Shamash Pro 4 live source paths, with mothballed folders listed as rollback-only.

## 2026-05-10 DeskPhone Shortcut Cutover

- Found the desktop `DeskPhone.lnk` still pointed to the old mothballed DeskPhone launcher path.
- Released Pro 4 native DeskPhone build `b262`.
- Current live desktop shortcut:
  - `C:\Users\ydanz\OneDrive\Desktop\DeskPhone.lnk`
  - Target: `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 4 App\apps\phone-host-windows\deployed-builds\launcher\DeskPhoneLauncher.exe`
- Running host after cutover:
  - `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 4 App\apps\phone-host-windows\deployed-builds\b262\DeskPhone.exe`
- Verified `http://127.0.0.1:8765/status` returned HTTP 200 with `connected:true`.
- Verified `http://127.0.0.1:8765/messages?limit=5` returned HTTP 200.
- Verified CORS/PNA headers allow `https://onetaskfocuser.netlify.app` to call the localhost host.

## 2026-05-10 WebPhone Contact/MMS/History Fix

- Native host released as DeskPhone `b263`.
- Host API changes:
  - `/contacts` no longer truncates at 250 rows.
  - `/calls` exports up to 1000 rows instead of 100.
- WebPhone changes:
  - Message conversations are enriched from the contacts payload, so thread names can resolve even when message rows only contain numbers.
  - Call-history name matching now uses the same tolerant phone-key comparison as message/contact matching.
  - Contacts view has a search field and no longer displays only the first 80 rows.
  - Message history request increased to 5000 rows.
  - Recent MMS media request fetches attachment image data for the latest 1200 rows and caches that media payload for 60 seconds, avoiding repeated large image downloads every refresh.
- Production web deploy: `6a014b570c09106d30c7802d`.
- Verified production root, `/shailos/`, and `/.netlify/functions/app-config` returned HTTP 200.
- Verified localhost host after b263 returned HTTP 200 with `connected:true`.
- Measured localhost payloads after b263:
  - Contacts: 1731.
  - Calls: 148.
  - Messages with `limit=5000`: 5000.
  - Recent media rows with image data: 21.

## 2026-05-10 Shamash Pro 3 Tombstone Visibility Pass

- Changed `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control` from active-looking control-folder wording to explicit tombstone wording.
- Renamed `00 START HERE` to `00 TOMBSTONED - DO NOT START HERE` so Explorer no longer presents Pro 3 as the normal startup path.
- Renamed `01 ACTIVE APPS - WORK HERE` to `01 TOMBSTONED APP SHORTCUTS - DO NOT WORK HERE` so old app shortcuts no longer look like the active work area.
- Replaced Pro 3 `README.md`, `PSOT.md`, `AGENTS.md`, `BRIEF.txt`, and the CEO start note with Pro 4 pointers and rollback/archive-only warnings.
- Updated Pro 4 root `README.md` and `AGENTS.md` to match the production promotion already recorded in this log and `PROMOTION_CHECKLIST.md`.
- Full physical relocation of the Pro 3 folder remains a separate decision because it still contains mobile bridge/reference material and old path references; the visible startup surface is now tombstoned.

## 2026-05-10 Shamash Pro 3 Hard Scramble

- Converted `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control` from signage-only tombstone to structurally unusable tombstone.
- Moved 19 old top-level items into:
  `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control\_TOMBSTONED_PAYLOAD_SCRAMBLED_UNUSABLE_UNTIL_RESTORE_2026-05-10_2338`
- Scrambled each original item name inside that payload, so old direct paths like `Shamash Pro 3\android-webphone-bridge` and `Shamash Pro 3\00 TOMBSTONED - DO NOT START HERE` now fail.
- Left only the root tombstone shell:
  - `README.md`
  - `SCRAMBLE_MANIFEST.json`
  - `EMERGENCY_DESCRAMBLE_RESTORE.ps1`
  - the scrambled payload folder
- Emergency restore path is documented by `SCRAMBLE_MANIFEST.json` and executable through `EMERGENCY_DESCRAMBLE_RESTORE.ps1`; use only for explicit rollback/archive recovery.

## 2026-05-10 Central Legacy Folder Hard Scramble

- Hard-scrambled the remaining source-bearing old folders into central Pro 3 vaults so stale legacy paths fail instead of relying on filename warnings.
- Central manifest:
  `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control\CENTRAL_DESCRAMBLE_MANIFEST.json`
- Central restore script:
  `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control\EMERGENCY_DESCRAMBLE_ALL_LEGACY.ps1`
- Central readme:
  `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control\CENTRAL_DESCRAMBLE_README.md`
- Scrambled legacy roots:
  - `taskmanager app\_MOTHBALLED_ROLLBACK_ONLY_sandbox_2026-05-10`
  - `taskmanager app\backup\sto-src\_MOTHBALLED_ROLLBACK_ONLY_Shaila-Trancriber-Organizer-main_2026-05-10`
  - `PC as Bluetooth call - text interface\_MOTHBALLED_ROLLBACK_ONLY_DeskPhone_2026-05-10`
  - `PC as Bluetooth call - text interface\_TOMBSTONE_DO_NOT_USE_DeskPhone_old_path_residue_2026-05-10`
  - `taskmanager app\sandbox-cleanroom`
  - `Shamash source clones\deskphone`
  - `Shamash source clones\onetask-sandbox`
- Verification: central restore script parses, each manifest source exists, and each original destination path is absent.
- Note: the first DeskPhone move attempt created a partial duplicate in the long vault and hit Windows path-length/locked-exe limits. The authoritative DeskPhone restore source is `_V\L003_deskphone_legacy`; the partial is recorded in the central manifest as `ignore`.

## 2026-05-11 Rabbi Dashboard Retirement

- Classified `C:\Users\ydanz\OneDrive\Documents\Rabbi Dashboard` as retired/reference-only source, not active product code.
- Stopped the old Rabbi Dashboard Vite dev server that was still running from that folder.
- Archived source-grade material to:
  `C:\Users\ydanz\OneDrive\Documents\Retired Source Archives\2026-05-11-rabbi-dashboard-retirement\rabbi-dashboard-reference-source-2026-05-11.tar.gz`
- Archive manifest:
  `C:\Users\ydanz\OneDrive\Documents\Retired Source Archives\2026-05-11-rabbi-dashboard-retirement\ARCHIVE_MANIFEST.json`
- Archive SHA256:
  `A4BB453E2F0197A290633850C22B82DDC5924DE1E55828BCB825A47C687C9B3E`
- Excluded generated/local-only material from the archive: `.git`, `node_modules`, `dist`, `.launcher`, and `dev-server.log`.
- Replaced the old `Rabbi Dashboard` folder with a one-file tombstone README pointing to Pro 4 and the archive.
- Verification: archive lists expected source/docs/package/config/script files, and `Rabbi Dashboard` now contains only `README.md`.

## 2026-05-11 Retired Head Folder Move

- Moved retired Shamash-family head folders out of the top-level Documents view so they no longer look like active projects:
  - `C:\Users\ydanz\OneDrive\Documents\taskmanager app`
  - `C:\Users\ydanz\OneDrive\Documents\Rabbi Dashboard`
  - `C:\Users\ydanz\OneDrive\Documents\PC as Bluetooth call - text interface`
  - `C:\Users\ydanz\OneDrive\Documents\Shamash source clones`
- New location:
  `C:\Users\ydanz\OneDrive\Documents\Retired Source Archives\2026-05-11-retired-head-folders`
- Move manifest:
  `C:\Users\ydanz\OneDrive\Documents\Retired Source Archives\2026-05-11-retired-head-folders\HEAD_FOLDER_MOVE_MANIFEST.json`
- Verification: top-level Documents now shows `Shamash Pro 4 App`, `Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control`, and `Retired Source Archives` for Shamash-family work; the old head folder names are no longer top-level project folders.
- Note: `Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control` remains top-level only because it currently holds the central emergency descramble controls requested by the user.

## 2026-05-11 Unscramble Control Rename

- Created the clearer control-folder name requested by the user:
  `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control`
- Copied the emergency control payload, manifests, vaults, and restore scripts into that renamed control folder.
- Updated `CENTRAL_DESCRAMBLE_MANIFEST.json` and `SCRAMBLE_MANIFEST.json` so their root paths point to the renamed control folder.
- Added `LEGACY_LOCATION_RECORD.md` and `LEGACY_LOCATION_RECORD.json`.
- The legacy location record lists where the retired head folders, scrambled vaults, and compressed Rabbi Dashboard archive now live.
- The old `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 3` folder could not be renamed directly because Windows reported an open handle. It was cleared to a redirect README and marked Hidden/System; the renamed control folder is now authoritative.

## 2026-05-11 NerveCenter WebPhone Compact Pass

- Restored a root `BRIEF.txt` in the Pro 4 workspace because no local brief file was present.
- Updated WebPhone/NerveCenter phone matching to use richer contact phone fields, message peer-number selection, 10/7-digit comparison keys, `/messages?limit=5000`, and the full `/calls` endpoint.
- Compressed the NerveCenter task input into a single compact row with colored priority add buttons plus a Mrs W add button.
- Added a task `See more` reveal for the dashboard queue instead of forcing the full queue into the first glance.
- Tightened NerveCenter pane-resizer handles and reduced header/status chrome.
- Changed compact phone rows so messages and recent calls show side-by-side glance slices, with row actions hidden behind three-dot menus.
- Changed DeskPhone Web call-history rows so text/call/block/delete are available behind a three-dot overflow instead of always visible.
- Google Calendar/Gmail now refresh every 5 minutes while connected and also refresh on browser focus/visibility return; manual refresh buttons now refresh data instead of re-opening OAuth.
- `npm run build` passed in `apps/web`.
- Verified local phone host `http://127.0.0.1:8765/status` returned HTTP 200 with `connected:true`.
- Visual smoke captured via Edge/CDP from `http://127.0.0.1:4305/?suite=nervecenter`; local screenshot was reviewed but not kept as source.
- Remaining note: true Google push/webhook delivery would require a backend notification channel and explicit deploy/config approval; this pass implemented the safe client-side near-live refresh path.
- Live deploy completed with `npx netlify deploy --prod --build` from `apps/web`; production URL `https://onetaskfocuser.netlify.app`, deploy ID `6a015f2aafd56281e9c2b4f4`.

## 2026-05-11 Lean Startup Docs And Git Remote Record

- Rewrote `BRIEF.txt` as the single low-token startup file for the phrase `read brief`.
- Trimmed `README.md` to repo orientation only and moved active-session startup guidance to `BRIEF.txt`.
- Trimmed `AGENTS.md` to operating law: research-before-change, production source rules, verification gates, push policy, Netlify approval policy.
- Restored Git origin to `https://github.com/addedlife/onetaskfocuser.git`.
- Recorded that Pro 4 local `master` is clean-history and not yet reconciled with GitHub `main`; Pro 4 work should push to `codex/...` branches until `main` reconciliation is explicitly approved.

## 2026-05-11 Token-Minimal Context Map

- Reduced `BRIEF.txt` from a fuller session summary to a tiny context kernel.
- Added `docs/ops/CONTEXT_INDEX.md` as the task-area file map for accurate low-token changes.
- Updated `README.md` and `AGENTS.md` so future sessions use `BRIEF.txt` plus only the matching context-index row instead of broad doc/code rereads.

## 2026-05-11 Phone Panel Glanceability Correction

- Removed the cramped compact-mode side-by-side Messages/Recent calls subpanes from NerveCenter WebPhone.
- Replaced them with one unified `Activity` feed that interleaves recent messages and calls by timestamp.
- Moved idle connection status out of the Phone card body and into the Phone header as a tiny status dot; active call, incoming call, and voicemail still surface as compact alerts.
- Reduced Phone card body padding to reclaim vertical space for actual content.
- `npm run build` passed in `apps/web`.
- Verified the local phone host `http://127.0.0.1:8765/status` returned HTTP 200 with `connected:true`.

## 2026-05-11 Always-Live Release Rule And Task Add Collapse

- Updated startup and agent docs so verified web changes should be committed, pushed, and deployed unless the current thread says not to.
- Kept Netlify relinking as approval-only, because relinking changes site identity rather than shipping the current app.
- Changed NerveCenter task entry so the default state is four small square plus buttons; clicking a plus opens the task text box with save/cancel.
- Reduced the task `See more` affordance to a small icon-only button.
- `npm run build` passed in `apps/web`.
- Live deploy completed with `npx netlify deploy --prod` from `apps/web`; production URL `https://onetaskfocuser.netlify.app`, deploy ID `6a0164d6afd56290d7c2b438`.

## 2026-05-11 GitHub Main Reconciliation

- Preserved the previous GitHub `main` commit `27e256cf1e0f3dda6e3addbfd743ac7d0bdd31c9` as branch `archive/pre-pro4-main-20260511-011424`.
- Preserved the same old main commit as tag `archive-pre-pro4-main-20260511-011424`.
- Reconciled GitHub `main` to Pro 4 commit `00d839f81d730e96ec623bd60443c72b974b1cf9` using `git push --force-with-lease`.
- Renamed local branch `master` to `main` and set it to track `origin/main`.
- Going forward, normal source pushes can use `origin/main`; old main remains recoverable from the archive branch/tag.

## 2026-05-11 Netlify Git Trigger Recovery

- After GitHub `main` moved to Pro 4, Netlify's Git-trigger path served a 404 because the Pro 4 repo is a monorepo and the web app is under `apps/web`.
- Restored production immediately with manual deploy `6a01667f88b9f9afe8df0a04` from `apps/web`.
- Added root `netlify.toml` with `[build].base = "apps/web"` so future Git-triggered builds start from the web app directory and use the existing `apps/web/netlify.toml`.

## 2026-05-11 Security Findings Branch Verification

- Isolated worktree: `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 4 Security Fixes`
- Branch: `codex/security-findings-20260511`
- Source artifact: `C:\Users\ydanz\Downloads\codex-security-findings-2026-05-11T05-28-45.057Z.csv`
- Scope: fixed the listed security/privacy/data-integrity findings in the isolated branch only; no live Netlify deploy and no merge into the active app worktree.
- Hardened DeskPhone localhost control with a pairing token, exact CORS allowlist, token-bearing browser requests, and upload/URL/contact parsing guards.
- Hardened Netlify AI/search/config/MCP functions with explicit origin allowlists, Firebase ID-token auth for key-backed providers, request-size/rate limits, timeout reduction, and no unauthenticated MCP reads.
- Hardened Shailos identity scoping, Firestore rules, explicit AI actions, answer-save privacy, postMessage origin checks, Google token cleanup, server-managed OAuth client ID, Gmail/calendar privacy, custom-theme validation, backup restore validation, shaila sync/deletion safeguards, and per-user audio holding-pen records.
- Validation passed:
  - `npm run build` in `apps/web`
  - `npm run build` in `apps/shailos`
  - `dotnet build` in `apps/phone-host-windows`
  - `node --check` for `apps/web/backend/functions/{ai-proxy.js,gemini-proxy.js,claude-proxy.js,serper-proxy.js,app-config.js,_ai-core.cjs,mcp.mjs}`
  - `git diff --check`
- Remaining expected warnings: Vite large chunk warnings for web/Shailos and existing `.NET` NU1603 approximate package resolution for `InTheHand.Net.Bluetooth`.
