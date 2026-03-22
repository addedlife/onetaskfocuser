# OneTaskFocuser — Full Handoff Document
*Updated 2026-03-22. Copy this into a new chat to continue seamlessly.*

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
- **Name**: OneTaskFocuser (internal: OneTask)
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
/home/user/onetaskfocuser/
├── index.html          — loads all CDN scripts + all JS files via Babel
├── netlify.toml        — publish="."; functions="netlify/functions"
├── restore_data.html   — paste JSON → push to Firebase (overwrites current state)
├── recover.html        — preview current localStorage contents
├── HANDOFF.md          — this file
├── js/
│   ├── 00-auth.js      — Firebase Auth gate, canonicalUid(), Google sign-in
│   ├── 01-core.js      — Store object, Firebase init, constants, TIPS, SCHEMES, helpers, AI, cloud backup methods
│   ├── 02-icons.js     — SVG icon components
│   ├── 03-voice.js     — Voice input
│   ├── 04-components.js — ZenMode, BrainDump, ZenDumpReview, PostItStack, BlockedBadge, etc.
│   ├── 05-modals.js    — Modal components
│   ├── 06-shelf.js     — Completed tasks shelf
│   ├── 07-settings.js  — Settings panel + Cloud Backup UI (added this session)
│   ├── 08-app.js       — Main App component, all state, all task actions
│   └── 09-render.js    — ReactDOM.createRoot render call
└── netlify/functions/
    ├── app-config.js   — returns GEMINI_API_KEY env var to client
    └── soferai-proxy.js — proxies Gemini API calls
```

---

## 5. KEY ARCHITECTURE
- **Firestore path**: `users/{canonicalUid}/appData/appState_v4`
- **Backup path**: `users/{canonicalUid}/backups/{YYYY-MM-DD}` (added this session)
- **canonicalUid**: strips email to prefix — `rabbidanziger@anything` → `"rabbidanziger"`
- **localStorage key**: `onetaskonly_v4_{uid}` (e.g. `onetaskonly_v4_rabbidanziger`)
- **State object** (`AS`): `{ lists[], activeListId, colorScheme, mrsWWindows, geminiKey, _lsModified, ... }`
- **`_lsModified`**: Unix timestamp on state — used to compare recency across devices
- **`Store`** object in 01-core.js handles all read/write to Firebase + localStorage
- **`uT(fn)`** — helper to mutate the active list's tasks array
- **`curT`** = `displayedActT[0]` — the current focused task
- **Firestore onSnapshot** listener in 08-app.js keeps all open windows in sync (2s echo buffer)
- **`justLoaded` guard**: prevents saving immediately after load, but NOT if user interacts first
- **`beforeunload`/`pagehide`**: flushes state to Firebase when tab closes — **this caused the corruption incident (see below)**

---

## 6. CLOUD BACKUP FEATURE (added 2026-03-22 — LIVE)

Daily Firestore snapshots stored at `users/{uid}/backups/YYYY-MM-DD`.
- One snapshot per day max (throttled via localStorage flag)
- 30-day retention (auto-pruned weekly)
- Accessible from any device (cross-device, tied to Firebase user account)
- UI in Settings modal: "Show cloud backups" → list of dated entries → "Restore" button per entry

**Files changed:**

### `js/01-core.js` — Added to `Store` object after `flushSync`:
```javascript
backupCollRef() {
  if (!db || !this.uid) return null;
  return db.collection("users").doc(this.uid).collection("backups");
},
async saveCloudBackup(state) {
  if (!db || !this.uid) return;
  if (this._fbLoadStatus !== 'ok' && this._fbLoadStatus !== 'empty') return;
  const today = new Date().toISOString().slice(0, 10);
  const pruneKey = `${this.lsKey()}_last_cloud_bk`;
  if (localStorage.getItem(pruneKey) === today) return;
  const coll = this.backupCollRef();
  if (!coll) return;
  try {
    const cleaned = this._clean(state);
    await coll.doc(today).set({
      savedAt: typeof firebase !== "undefined" ? firebase.firestore.FieldValue.serverTimestamp() : new Date(),
      state: cleaned
    });
    localStorage.setItem(pruneKey, today);
    const pruneWeekKey = `${this.lsKey()}_last_cloud_prune`;
    const lastPrune = localStorage.getItem(pruneWeekKey) || '';
    const thisWeek = new Date().toISOString().slice(0, 7) + '-W' + Math.ceil(new Date().getDate() / 7);
    if (lastPrune !== thisWeek) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      try {
        const old = await coll.where(firebase.firestore.FieldPath.documentId(), '<', cutoffStr).get();
        if (!old.empty) { const batch = db.batch(); old.docs.forEach(d => batch.delete(d.ref)); await batch.commit(); }
        localStorage.setItem(pruneWeekKey, thisWeek);
      } catch(e) {}
    }
  } catch(e) { console.warn('[Store] Cloud backup failed', e); }
},
async listBackups() {
  const coll = this.backupCollRef();
  if (!coll) return [];
  try {
    const snap = await coll.orderBy('savedAt', 'desc').limit(30).get();
    return snap.docs.map(d => ({ id: d.id, savedAt: d.data().savedAt?.toDate ? d.data().savedAt.toDate() : new Date(d.id) }));
  } catch(e) { return []; }
},
async restoreFromBackup(docId) {
  const coll = this.backupCollRef();
  if (!coll) return null;
  try {
    const doc = await coll.doc(docId).get();
    if (!doc.exists) return null;
    return doc.data().state || null;
  } catch(e) { return null; }
}
```

### `js/08-app.js` — Save effect now calls cloud backup:
```javascript
Store.ls(toSave);                          // Refresh optional offline cache
Store.autoFileBackup(toSave);             // Weekly file backup
Store.saveCloudBackup(toSave);            // Daily cloud backup (Firestore)
```

### `js/07-settings.js` — Settings modal:
Added Cloud Backup Points UI section with state (`cloudBackups`, `cloudBackupsLoading`, `restoringBackup`), load handler, restore handler, and button list UI. Inserted between backup folder button and sign-out section.

**Git:** Committed + pushed to `claude/check-focused-app-10FMv` → merged to `main` → Netlify auto-deployed. Feature is live.

---

## 7. CORRUPTION INCIDENT & RECOVERY

### What Happened
A device that had been closed for days (stale localStorage) was reopened. It loaded the old localStorage state. When the tab was closed, `beforeunload` flushed that stale state to Firebase, overwriting the current/correct data.

### Root Cause
`beforeunload` writes to Firebase without checking whether local state is newer than what was loaded from Firebase. Any device with old localStorage can corrupt the cloud state when the tab closes.

### Backup Sources Evaluated

| Source | `_lsModified` | Approx Date | Aveil Completed? | Notes |
|--------|--------------|-------------|-----------------|-------|
| Stale device localStorage | `1774159533225` | ~Mar 19 | NO | This is the corrupted state that overwrote Firebase |
| File backup #1 | `1773572821555` | ~Mar 12 | NO | Oldest, ~100 duplicate tasks |
| File backup #2 | `1773947786444` | ~Mar 14 | YES | Good but older |
| **Best localStorage** | **`1773973396144`** | **~Mar 17** | **YES** | **BEST — use this** |

### Best Backup: `_lsModified: 1773973396144` (~March 17)
- `mmihzozt70i64` (Aveil Shabbos Sheva Brachos) → `completed: true`, `completedAt: 1773600418399` ✓
- Newsletter tasks completed ✓
- Watch repair tasks auto-aged to "today" priority ✓
- Newest correct timestamp of all available backups ✓

### **STATUS: RESTORE NOT YET DONE**
User still needs to restore this backup.

**How to restore:**
1. Go to: https://onetaskfocuser.netlify.app/restore_data.html
2. Paste the full JSON from the Mar 17 localStorage dump
3. Submit — overwrites Firebase with correct state

---

## 8. UTILITY PAGES

| URL | Purpose |
|-----|---------|
| `/restore_data.html` | Paste JSON → push to Firebase (overwrites current state) |
| `/recover.html` | Preview current localStorage contents |
| `?restoreLocal=1` | URL param: triggers dialog to restore localStorage → Firebase |

---

## 9. DEPLOYING

The app is a GitHub repo connected to Netlify. Push to `main` → Netlify auto-deploys.

```bash
git add -A
git commit -m "your message"
git push origin main
```

Claude Code works directly in `/home/user/onetaskfocuser` and pushes via git.

---

## 10. ACCESS CREDENTIALS

| Resource | Value |
|---|---|
| Netlify site name | `onetaskfocuser` |
| Firebase project ID | `onetaskonly-app` |
| Firebase plan | Spark (free) — no PITR, no built-in backups |
| Gemini API key | Stored in Netlify env var `GEMINI_API_KEY` (not in code) |
| Firebase API key | `AIzaSyB5UiDE9s0xjWeYa4OQ1LLJ63EwPVoSLrA` (in 01-core.js, safe to expose) |

---

## 11. CODING CONVENTIONS
- Inline styles everywhere — no CSS classes except `@keyframes` animations in index.html
- `T` = theme object from `SCHEMES[AS.colorScheme]` — use `T.tFaint`, `T.tSoft`, `T.card`, etc.
- `fontFamily:"system-ui"` for UI chrome; `Georgia,serif` for task text
- JSX with multiple siblings → wrap in `<>...</>` Fragment
- Calm/passive styling for age hints and badges — never harsh red/alarming colors
- `AS` = full app state; `uT(fn)` mutates active list's tasks

---

## 12. COMPLETED FEATURES (don't rebuild these)
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
- `_fbLoadStatus` guard — never saves empty state unless Firebase confirmed new account
- `?restoreLocal=1` emergency restore
- **Cloud backup points** (daily Firestore snapshots, Settings UI) — added 2026-03-22

---

## 13. IMMEDIATE NEXT STEPS (in order)

1. **Restore the Mar 17 backup** via `restore_data.html` (see Section 7 above) — CRITICAL, not done yet
2. **Verify** the app loads correctly: Aveil Shabbos completed, all tasks intact
3. **Test cloud backup feature** — open Settings → "Show cloud backups" → confirm dated snapshots appear after a day of use
4. **Fix the `beforeunload` stale-state bug** (see Section 14 below)

---

## 14. KNOWN BUG — `beforeunload` stale-state overwrite

**Problem:** When any device with old localStorage closes a tab, `beforeunload` flushes that old state to Firebase unconditionally — overwriting current data.

**Proposed fix:** Before flushing on close, compare `_lsModified` timestamp:
```javascript
// In beforeunload/flushSync — only write if local state is newer than what was loaded from Firebase
if (localState._lsModified >= this._fbLoadedModified) {
  this.flushSync(localState);
}
```
This requires storing `_fbLoadedModified` when Firebase data is first loaded into memory.

**This fix has NOT been implemented yet.**
