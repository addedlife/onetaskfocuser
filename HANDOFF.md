# OneTaskOnly — Full Handoff Document
*Generated 2026-03-14. Copy this into a new chat to continue seamlessly.*

---

## 1. WHO YOU'RE WORKING WITH
- User: Yosef Danziger (ydanziger20@gmail.com)
- Non-programmer, intelligent and curious. **Coding Coach Mode is ALWAYS ON.**
  - After every action, add a plain-English explanation (1–3 sentences)
  - Define programming terms in context when they come up naturally
  - Warm, direct tone — never condescending
- Firebase login username: `rabbidanziger` / Google: `rabbidanziger@hocsouthbend.com`

---

## 2. THE APP
- **Name**: OneTaskOnly (internal: OneTask)
- **Live URL**: https://onetaskfocuser.netlify.app
- **Purpose**: A focus task manager — shows one task at a time, AI-prioritized, with zen mode, brain dump, multiple lists, energy filtering, Mrs. W schedule overlay, and more.

---

## 3. TECH STACK
- **React 18** loaded from CDN (no build step — Babel transpiles in the browser)
- **Firebase Firestore** — cloud database for all user data
- **Firebase Auth** — email/password + Google sign-in
- **Netlify** — static hosting + serverless functions
- **Gemini AI** — task optimization and brain dump parsing (via Netlify function proxy)
- NO npm, NO webpack, NO build pipeline — everything is plain JS/JSX files

---

## 4. FILE STRUCTURE
```
C:\Users\ydanz\OneDrive\Documents\taskmanager app\Claude Code OneTask Project\
├── index.html          — loads all CDN scripts + all JS files via Babel
├── netlify.toml        — publish="."; functions="netlify/functions"
├── deploy.bat          — legacy deploy (unreliable in current env, use PowerShell API instead)
├── js/
│   ├── 00-auth.js      — Firebase Auth gate, canonicalUid(), Google sign-in
│   ├── 01-core.js      — Store object, Firebase init, constants, TIPS, SCHEMES, helpers, AI
│   ├── 02-icons.js     — SVG icon components
│   ├── 03-voice.js     — Voice input
│   ├── 04-components.js — ZenMode, BrainDump, ZenDumpReview, PostItStack, BlockedBadge, etc.
│   ├── 05-modals.js    — Modal components
│   ├── 06-shelf.js     — Completed tasks shelf
│   ├── 07-settings.js  — Settings panel (API key, MrsW schedule, color scheme, etc.)
│   ├── 08-app.js       — Main App component, all state, all task actions
│   └── 09-render.js    — ReactDOM.createRoot render call
└── netlify/functions/
    ├── app-config.js   — returns GEMINI_API_KEY env var to client
    └── soferai-proxy.js — proxies Gemini API calls
```

---

## 5. KEY ARCHITECTURE
- **Firestore path**: `users/{canonicalUid}/appData/appState_v4`
- **canonicalUid**: strips email to prefix — `rabbidanziger@anything` → `"rabbidanziger"`
- **localStorage key**: `onetaskonly_v4_{uid}` (e.g. `onetaskonly_v4_rabbidanziger`)
- **State object** (`AS`): `{ lists[], activeListId, colorScheme, mrsWWindows, geminiKey, ... }`
- **`Store`** object in 01-core.js handles all read/write to Firebase + localStorage
- **`uT(fn)`** — helper to mutate the active list's tasks array
- **`curT`** = `displayedActT[0]` — the current focused task
- **Firestore onSnapshot** listener in 08-app.js keeps all open windows in sync (2s echo buffer)

---

## 6. THE STORAGE BUG (FIXED) + WHAT STILL NEEDS DOING

### What happened
When the user cleared browser localStorage, the app loaded with a blank default state
and saved it to Firebase within 50ms — wiping all tasks for `rabbidanziger`. This is confirmed:
Firebase shows 0 tasks, last written 2026-03-13.

### Fix already deployed
In `js/01-core.js`, `Store` now has:
- `_fbLoadStatus`: tracks whether Firebase confirmed data exists (`'ok'`), empty (`'empty'`), or unreachable (`'error'`)
- `saveToFB()` guard: **never saves empty/default state unless Firebase confirmed the account is new**
- `setUid()` only resets status when UID actually changes (not on every render)
- `?restoreLocal=1` URL param: forces localStorage to win over Firebase and push to cloud
- `fbOffline` warning banner in 08-app.js when Firebase unreachable on load

### What still needs doing (CRITICAL)
**The architecture must be rebuilt to be Firebase-first, not localStorage-first.**
User's exact request: *"needs nothing to do with local storage and is cleanly saved in the cloud,
maintaining accurate completions deletions submissions etc without being affected by a new signing
or by local states anywhere."*

The current design: localStorage = primary, Firebase = secondary.
Required design: Firebase = only source of truth. localStorage = optional offline cache only.
Never save a blank state to Firebase. If Firebase is unreachable, show error, don't silently save.

---

## 7. DATA RECOVERY STATUS (IN PROGRESS)

The user's task data was wiped from Firebase. An iPad (Safari) likely still has the old data
in localStorage. Recovery plan:

1. `?restoreLocal=1` feature is **already deployed** to production
2. User should open **`onetaskfocuser.netlify.app/?restoreLocal=1`** on the iPad
3. The feature detects tasks in localStorage and pushes them to Firebase before Firebase can respond
4. **Issue**: iPad was showing white screen — likely Babel transpilation delay (60–90 seconds on mobile)
5. **Next step**: Confirm whether iPad shows the app after waiting longer, or try Chrome on iPad

---

## 8. DEPLOYING (IMPORTANT — USE THIS METHOD)

**`deploy.bat` does NOT work** in the current Desktop Commander (DXT) environment.
Node.js processes spawn silently with exit code 0 and no output.

**WORKING DEPLOY METHOD — PowerShell inline via Netlify REST API:**

```powershell
# Step 1: Create zip
$zipPath = "C:\Users\ydanz\deploy_temp.zip"
$tempDir = "C:\Users\ydanz\deploy_staging"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempDir | Out-Null
$src = "C:\Users\ydanz\OneDrive\Documents\taskmanager app\Claude Code OneTask Project"
Copy-Item "$src\index.html" "$tempDir\" -Force
Copy-Item "$src\netlify.toml" "$tempDir\" -Force
Copy-Item "$src\js" "$tempDir\js" -Recurse -Force
Copy-Item "$src\netlify" "$tempDir\netlify" -Recurse -Force
Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath
Remove-Item $tempDir -Recurse -Force
Write-Output "Zip size: $((Get-Item $zipPath).Length) bytes"

# Step 2: Upload to Netlify API
$token = "nfc_sFsYCTMmnimttJVAVcw6fjvS6GR4mFreac04"
$siteId = "c603b156-f9ee-4b67-bcf4-d4b7f64fbccd"
$headers = @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/zip" }
$bytes = [System.IO.File]::ReadAllBytes($zipPath)
$result = Invoke-RestMethod -Uri "https://api.netlify.com/api/v1/sites/$siteId/deploys" -Method Post -Headers $headers -Body $bytes
Write-Output "ID: $($result.id)"; Write-Output "State: $($result.state)"

# Step 3: Poll until ready
$deployId = $result.id
Start-Sleep 8
$check = Invoke-RestMethod -Uri "https://api.netlify.com/api/v1/deploys/$deployId" -Headers @{ "Authorization" = "Bearer $token" }
Write-Output "Final state: $($check.state)"
```

Run each step as a separate Desktop Commander `start_process` command (inline PowerShell).

---

## 9. ACCESS CREDENTIALS

| Resource | Value |
|---|---|
| Netlify auth token | `nfc_sFsYCTMmnimttJVAVcw6fjvS6GR4mFreac04` |
| Netlify site ID | `c603b156-f9ee-4b67-bcf4-d4b7f64fbccd` |
| Netlify site name | `onetaskfocuser` |
| Firebase project ID | `onetaskonly-app` |
| Firebase plan | Spark (free) — no PITR, no backups |
| Gemini API key | Stored in Netlify env var `GEMINI_API_KEY` (not in code) |
| Firebase API key | `AIzaSyB5UiDE9s0xjWeYa4OQ1LLJ63EwPVoSLrA` (in 01-core.js, safe to expose) |

---

## 10. CODING CONVENTIONS
- Inline styles everywhere — no CSS classes except `@keyframes` animations in index.html
- `T` = theme object from `SCHEMES[AS.colorScheme]` — use `T.tFaint`, `T.tSoft`, `T.card`, etc.
- `fontFamily:"system-ui"` for UI chrome; `Georgia,serif` for task text
- JSX with multiple siblings → wrap in `<>...</>` Fragment
- Calm/passive styling for age hints and badges — never harsh red/alarming colors
- `AS` = full app state; `uT(fn)` mutates active list's tasks

---

## 11. COMPLETED FEATURES (don't rebuild these)
- AI reprioritization on add/completion
- Zen mode + brain dump (stream-of-consciousness → AI parse → ZenDumpReview)
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

---

## 12. IMMEDIATE NEXT STEPS (in order)

1. **Confirm iPad recovery**: Did `?restoreLocal=1` work after waiting 90 seconds? If not, try Chrome on iPad
2. **Rebuild storage to Firebase-only**: Remove localStorage as primary store. Firebase is truth.
3. **Verify all settings persist**: MrsW windows, home button, API key, color scheme — all must survive cache clear
4. **Test**: Clear localStorage manually, sign in fresh, confirm all data and settings intact from Firebase
