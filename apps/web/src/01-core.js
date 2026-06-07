// === 01-core.js ===

import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyB5UiDE9s0xjWeYa4OQ1LLJ63EwPVoSLrA",
  // Our own domain (not the shared *.firebaseapp.com) so the Google sign-in round-trip
  // is same-origin and survives mobile browsers' cross-site storage blocking. Requires
  // the /__/auth/* proxy in netlify.toml plus this domain in Firebase Authorized Domains
  // and the Google OAuth client's Authorized redirect URIs.
  authDomain: "onetaskfocuser.netlify.app",
  projectId: "onetaskonly-app",
  storageBucket: "onetaskonly-app.firebasestorage.app",
  messagingSenderId: "1017463520129",
  appId: "1:1017463520129:web:b4d8ca01864dfb2a35c680"
};

let db = null;
try {
  if (typeof firebase !== "undefined") {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    // iOS works fine on WebChannel, but Android (and restrictive proxies/VPNs) keep
    // killing it, leaving the app stuck on stale IndexedDB-cached data. Auto-detect was
    // not reliably falling back, so FORCE long-polling: every client uses plain HTTP
    // long-polling, which is the reliable transport everywhere. Slightly higher latency
    // is an acceptable trade for data that actually stays fresh on Android.
    try { db.settings({ experimentalForceLongPolling: true, merge: true }); } catch (_) {}

    // ?resetCache=1 — recovery hatch for a corrupted/stuck IndexedDB cache, a documented
    // Firestore failure mode (firebase-js-sdk#8593) that serves stale/null docs forever
    // with no other fix but wiping site data. clearPersistence() must run before
    // enablePersistence() and before any listener attaches, so it's handled here first;
    // we then reload without the flag into the normal path.
    const _params = (typeof window !== "undefined") ? new URLSearchParams(window.location.search) : null;
    if (_params && _params.get("resetCache") === "1") {
      db.clearPersistence().catch(() => {}).then(() => {
        try {
          const u = new URL(window.location.href);
          u.searchParams.delete("resetCache");
          window.location.replace(u.toString());
        } catch (_) { window.location.reload(); }
      });
    } else {
      // Single-tab persistence (NOT synchronizeTabs). Multi-tab persistence is a
      // documented source of stale-data emission — mutating from a non-leader tab makes
      // Firestore emit correct→STALE→correct (firebase-js-sdk#6511). A phone/tablet PWA
      // never needs cross-tab sync, so single-tab is both safer and best-practice here.
      db.enablePersistence().catch(() => {});
    }

    // Android/iOS PWAs freeze backgrounded tabs; on resume the Firestore stream is
    // often silently stale (alive but delivering no updates), which surfaces as
    // "ultra-stale" data. Force a fresh connection when the app is foregrounded after
    // being hidden a while, or when the network returns. disableNetwork→enableNetwork
    // re-establishes the stream and flushes any queued writes.
    let _hiddenSince = 0;
    const _kickFirestore = () => { db.disableNetwork().then(() => db.enableNetwork()).catch(() => {}); };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") { _hiddenSince = Date.now(); return; }
        if (_hiddenSince && Date.now() - _hiddenSince > 5000) _kickFirestore();
        _hiddenSince = 0;
      });
    }
    if (typeof window !== "undefined") window.addEventListener("online", _kickFirestore);
  }
} catch(e) {}

// Store: per-user data layer. Call Store.setUid(uid) after login before any load/save.
// _fbLoadStatus: null=not yet loaded | 'ok'=loaded data | 'empty'=FB confirmed no doc | 'error'=FB unreachable/denied
const Store = {
  _pendingSave: null,
  _lastSavedToFB: 0,
  _lastSavedFbModified: 0,
  _fbLoadStatus: null,
  _fbLoadedTs: 0,              // _lsModified timestamp of the data we loaded FROM Firebase — our freshness baseline
  uid: null,

  // ── Sync telemetry (powers the ?diag=1 readout so staleness is observable) ──
  _lastServerSyncTs: 0,        // Date.now() of most recent server-confirmed snapshot
  _lastCacheSyncTs: 0,         // Date.now() of most recent cache-only snapshot
  _lastFromCache: null,        // did the latest snapshot come from cache?
  _noteSync(fromCache) {
    this._lastFromCache = !!fromCache;
    if (fromCache) this._lastCacheSyncTs = Date.now();
    else this._lastServerSyncTs = Date.now();
  },
  getDiagnostics() {
    return {
      uid: this.uid,
      online: (typeof navigator !== "undefined") ? navigator.onLine : null,
      loadStatus: this._fbLoadStatus,
      lastFromCache: this._lastFromCache,
      lastServerSyncTs: this._lastServerSyncTs,
      lastCacheSyncTs: this._lastCacheSyncTs,
      hasDb: !!db,
    };
  },
  async forceResync() {
    if (!db) return false;
    try { await db.disableNetwork(); await db.enableNetwork(); return true; } catch (_) { return false; }
  },

  // Direct REST probe of the Firestore backend, used by ?diag=1 to explain WHY the
  // real-time listener never syncs. The live SDK swallows transport failures silently,
  // so we bypass it with a plain fetch and classify the raw result:
  //   • fetch rejects / times out  → BLOCKED  (network/browser can't reach the server)
  //   • HTTP 401/403               → DENIED   (server reachable, auth token rejected)
  //   • HTTP 200/404               → REACHABLE (backend + auth fine; the streaming/
  //                                  long-polling transport is the thing failing)
  async probeFirestore() {
    const projectId = firebaseConfig.projectId;
    // Probe the user's REAL document path so the result mirrors the actual read and the
    // security rules apply identically. (Reserved __names__ are rejected with HTTP 400,
    // so never use them here.) Falls back to a valid generic path if not signed in yet.
    const path = this.uid ? `users/${this.uid}/appData/appState_v4` : "users/diagprobe";
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`;
    let token = null;
    try {
      const u = (typeof firebase !== "undefined") ? firebase.auth().currentUser : null;
      token = u ? await u.getIdToken() : null;
    } catch (_) {}
    const ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 12000) : null;
    const started = Date.now();
    try {
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: ctrl ? ctrl.signal : undefined,
      });
      if (timer) clearTimeout(timer);
      const ms = Date.now() - started;
      if (res.status === 200 || res.status === 404)
        return { ok: true, verdict: `REACHABLE — HTTP ${res.status} in ${ms}ms. Database + login are fine; the live-sync transport is what's failing.` };
      if (res.status === 401 || res.status === 403)
        return { ok: false, verdict: `DENIED — HTTP ${res.status} in ${ms}ms. Server reachable but your auth token was rejected (rules/account issue, not network).` };
      return { ok: false, verdict: `REACHED — HTTP ${res.status} in ${ms}ms. The server answered (so it's NOT a network block); status ${res.status} is unusual — tell Claude this number.` };
    } catch (e) {
      if (timer) clearTimeout(timer);
      const ms = Date.now() - started;
      const aborted = e && e.name === "AbortError";
      return { ok: false, verdict: aborted
        ? `BLOCKED — no answer after ${ms}ms (timed out). The network or browser is blocking firestore.googleapis.com.`
        : `BLOCKED — network error after ${ms}ms: ${(e && e.message) || e}. Can't reach firestore.googleapis.com at all.` };
    }
  },

  // Dump the live auth identity + token claims so ?diag=1 can reveal WHY a 403 happens:
  // the data folder is named by email-prefix, but the rules authorize by the token's
  // claims. If the token's email/email_verified/sign-in method differ from desktop, or
  // the folder doesn't match the token email prefix, the rules deny the read.
  async authReport() {
    const folder = this.uid || "(none)";
    try {
      const u = (typeof firebase !== "undefined") ? firebase.auth().currentUser : null;
      if (!u) return { lines: [`Signed in: NO`, `Folder: ${folder}`] };
      let claims = {}, signInProvider = "(unknown)";
      try { const r = await u.getIdTokenResult(); claims = r.claims || {}; signInProvider = claims.sign_in_provider || "(unknown)"; } catch (_) {}
      const tokenEmail = claims.email || u.email || "(none)";
      const prefixMatches = String(tokenEmail).split("@")[0].toLowerCase() === String(folder).toLowerCase();
      return { lines: [
        `Signed in: YES`,
        `Auth uid: ${u.uid}`,
        `Token email: ${tokenEmail}`,
        `Email verified: ${claims.email_verified === undefined ? u.emailVerified : claims.email_verified}`,
        `Sign-in method: ${signInProvider}`,
        `Providers: ${(u.providerData || []).map(p => p.providerId).join(", ") || "(none)"}`,
        `Reading folder: ${folder}`,
        `Folder matches token email: ${prefixMatches ? "YES" : "NO <- mismatch"}`,
      ] };
    } catch (e) {
      return { lines: [`authReport error: ${(e && e.message) || e}`] };
    }
  },

  setUid(uid) { if (this.uid !== uid) { this.uid = uid; this._fbLoadStatus = null; } },
  lsKey()  { return `onetaskonly_v4_${this.uid || "anon"}`; },
  docRef() {
    if (!db || !this.uid) return null;
    return db.collection("users").doc(this.uid).collection("appData").doc("appState_v4");
  },

  ls(d) {
    try {
      localStorage.setItem(this.lsKey(), JSON.stringify({ ...d, _lsModified: d._lsModified || Date.now() }));
    } catch(e) {}
  },

  // ── IndexedDB helpers (used to persist the backup folder handle across sessions) ──
  // IndexedDB is a separate browser storage that can hold complex objects like folder handles.
  _idb: null,
  async _openIdb() {
    if (this._idb) return this._idb;
    this._idb = await new Promise((resolve, reject) => {
      const req = indexedDB.open('onetask_fsa', 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore('kv');
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = () => reject(req.error);
    });
    return this._idb;
  },
  async _idbGet(key) {
    try {
      const db = await this._openIdb();
      return await new Promise(resolve => {
        const req = db.transaction('kv').objectStore('kv').get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      });
    } catch { return null; }
  },
  async _idbSet(key, val) {
    try {
      const db = await this._openIdb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch(e) { console.warn('[Store._idbSet]', e); }
  },

  // Called from the "Set backup folder" button in Settings.
  // Opens a folder picker — user selects the backups/ folder once.
  // The handle is stored in IndexedDB and reused on future saves.
  async chooseBackupDir() {
    if (!window.showDirectoryPicker) return false;
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'onetask-backups' });
      await this._idbSet('backupDir', handle);
      return true;
    } catch(e) {
      if (e.name !== 'AbortError') console.warn('[Store.chooseBackupDir]', e);
      return false;
    }
  },

  async getBackupDirInfo() {
    const handle = await this._idbGet('backupDir');
    if (!handle) return { available: !!window.showDirectoryPicker, set: false, name: "", permission: "missing" };
    let permission = "unknown";
    try { permission = await handle.queryPermission({ mode: 'readwrite' }); } catch(e) {}
    return { available: !!window.showDirectoryPicker, set: true, name: handle.name || "Selected folder", permission };
  },

  _backupCounts(appState, shailos) {
    return {
      lists: appState?.lists?.length || 0,
      tasks: appState?.lists?.reduce((n, l) => n + (l.tasks?.length || 0), 0) || 0,
      shailos: shailos?.length || 0,
    };
  },

  _backupStamp(withTime = false) {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    if (!withTime) return date;
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${date}_${hh}-${mm}-${ss}`;
  },

  _backupWeekStamp(now = new Date()) {
    const start = new Date(now.getFullYear(), 0, 1);
    const days = Math.floor((now - start) / (24 * 60 * 60 * 1000));
    const weekNumber = Math.ceil((now.getDay() + 1 + days) / 7);
    return `${now.getFullYear()}_W${String(weekNumber).padStart(2, '0')}`;
  },

  async _backupShailos() {
    const col = this.shailosCol();
    const shailos = [];
    if (!col) return shailos;
    try {
      const snap = await col.get();
      snap.forEach(doc => shailos.push({ id: doc.id, ...doc.data() }));
    } catch(e) {
      console.warn('[Backup] Could not fetch shailos:', e);
    }
    return shailos;
  },

  async _buildBackup(appState, reason = "manual") {
    const now = new Date();
    const shailos = await this._backupShailos();
    const cleanedAppState = appState ? this._clean(appState) : null;
    const cleanedShailos = shailos.map(s => this._clean(s));
    const counts = this._backupCounts(cleanedAppState, cleanedShailos);
    return {
      backup: {
        _backupVersion: 2,
        _backupDate: now.toISOString(),
        _uid: this.uid || "unknown",
        _source: "shamash-pro-4",
        _reason: reason,
        _contents: {
          appState: "Tasks, lists, completed-task history, priorities, app settings, pane sizes, theme and AI model choices.",
          shailos: "Shailos records, answers, got-back status, research reports and linked task fields.",
          excluded: "OAuth access tokens, backup-folder permissions, pending audio blobs, browser cache and DeskPhone host history.",
        },
        _counts: counts,
        appState: cleanedAppState,
        shailos: cleanedShailos,
      },
      counts,
    };
  },

  async _writeBackupToDir(dirHandle, fileName, content, { allowPrompt = false } = {}) {
    try {
      let perm = await dirHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted' && allowPrompt && dirHandle.requestPermission) {
        perm = await dirHandle.requestPermission({ mode: 'readwrite' });
      }
      if (perm !== 'granted') return false;
      const fh = await dirHandle.getFileHandle(fileName, { create: true });
      const w = await fh.createWritable();
      await w.write(content);
      await w.close();
      return true;
    } catch(e) {
      console.warn('[Backup] Folder write failed:', e);
      return false;
    }
  },

  async _saveJsonFile(fileName, content) {
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: 'Shamash Pro 4 backup JSON', accept: { 'application/json': ['.json'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        return true;
      } catch(e) {
        if (e.name === 'AbortError') return false;
        console.warn('[Backup] Save picker failed, falling back to download:', e);
      }
    }
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    return true;
  },

  async _pruneBackups(dirHandle, prefix, keep) {
    if (!dirHandle || !dirHandle.entries || keep < 1) return;
    try {
      const matches = [];
      for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind === 'file' && name.startsWith(prefix) && name.endsWith('.json')) matches.push(name);
      }
      matches.sort().reverse();
      await Promise.all(matches.slice(keep).map(name => dirHandle.removeEntry(name).catch(() => {})));
    } catch(e) {
      console.warn('[Backup] Could not prune old backups:', e);
    }
  },

  // Weekly auto-backup. Called from the save effect in 08-app.js (not from ls()).
  // Automatic exports write only to the user-selected folder. If no folder is
  // approved, Firebase/localStorage remain the recovery path and no file is
  // dropped into Downloads.
  // force=true skips the weekly-stamp check — use only for explicit user actions.
  // Uses the same restorable JSON shape as fullBackup.
  async autoFileBackup(d, _ignored = [], force = false) {
    if (!d || !d.lists || !d.lists.some(l => l.tasks?.length > 0)) return;
    try {
      const now = new Date();
      const weekStamp = this._backupWeekStamp(now);
      const forced = force === true;

      if (!forced) {
        const lastBk = localStorage.getItem(`${this.lsKey()}_last_file_bk`);
        if (lastBk === weekStamp) return; // already backed up this week
      }

      const { backup, counts } = await this._buildBackup(d, forced ? "explicit" : "weekly_auto");
      const content = JSON.stringify(backup, null, 2);
      const fileName = forced
        ? `onetask_explicit_backup_${this._backupStamp(true)}.json`
        : `onetask_auto_backup_${weekStamp}.json`;

      const dirHandle = await this._idbGet('backupDir');
      if (!dirHandle) {
        console.log('[Backup] Skipped file auto-backup: no backup folder selected');
        return null;
      }

      const saved = await this._writeBackupToDir(dirHandle, fileName, content, { allowPrompt: forced });
      if (!saved) {
        console.log('[Backup] Skipped file auto-backup: backup folder permission is not active');
        return null;
      }

      localStorage.setItem(`${this.lsKey()}_last_file_bk`, weekStamp);
      if (!forced) await this._pruneBackups(dirHandle, 'onetask_auto_backup_', 12);
      console.log(`[Backup] Saved to selected folder: ${fileName}`);
      return { ...counts, fileName };
    } catch(e) { console.warn('[Backup] Failed:', e); }
  },

  ll() {
    try {
      const d = localStorage.getItem(this.lsKey());
      return d ? JSON.parse(d) : null;
    } catch(e) { return null; }
  },

  async load() {
    const local  = this.ll();
    const ref    = this.docRef();

    // Emergency restore: ?restoreLocal=1 offers to push this device's localStorage to Firebase.
    if (new URLSearchParams(window.location.search).get('restoreLocal') === '1') {
      if (local && local.lists?.some(l => l.tasks?.length > 0)) {
        const taskCount = local.lists.reduce((n, l) => n + (l.tasks?.length || 0), 0);
        const ok = window.confirm(
          `This device has a local backup with ${taskCount} task(s).\n\n` +
          `Save this to Firebase? This will OVERWRITE whatever is currently saved in the cloud.\n\n` +
          `Only tap OK if you are sure this device has your most recent data.`
        );
        if (ok) {
          console.log("[Store] restoreLocal confirmed: pushing local data to Firebase");
          this._fbLoadStatus = 'ok';
          if (this._v5) {
            await this._migrateToV5(local);  // write as per-task docs
          } else if (ref) {
            await this.saveToFB(local);
          }
          return local;
        } else {
          const url = new URL(window.location.href);
          url.searchParams.delete('restoreLocal');
          window.history.replaceState({}, '', url);
        }
      }
    }

    // ── V5 per-task mode ──
    if (this._v5 && db && this.uid) {
      const version = await this._checkMigration();
      if (version === 'v5') {
        // Already migrated — load from per-task collections
        const state = await this._loadV5();
        // Only use V5 state if it actually has tasks. If collection is empty
        // (e.g. migration wrote meta but tasks failed), fall back to blob.
        if (state && state.lists?.some(l => l.tasks?.length > 0)) return state;
        console.warn("[Store] V5 collection empty or load failed, falling back to blob + re-migrate");
        // Fall through to blob load, which will attempt re-migration
      }
      {
        // Need to migrate: load blob first, then migrate
        if (ref) {
          for (const src of ["server", "cache"]) {
            try {
              const doc = await ref.get({ source: src });
              if (doc.exists && doc.data().state) {
                const blobState = doc.data().state;
                // Migrate to V5
                const ok = await this._migrateToV5(blobState);
                if (ok) {
                  this._fbLoadStatus = 'ok';
                  this._lastSavedState = JSON.parse(JSON.stringify(blobState));
                  this.ls(blobState);
                  return blobState;
                }
                // Migration failed — use blob mode as fallback
                this._fbLoadStatus = 'ok';
                this._fbLoadedTs = blobState._lsModified || 0;
                this.ls(blobState);
                return blobState;
              }
              this._fbLoadStatus = 'empty';
              return null;
            } catch(e) {
              if (src === "server") console.warn("[Store] Server fetch failed, trying cache", e);
              else { this._fbLoadStatus = 'error'; }
            }
          }
        }
        return local;
      }
    }

    // ── V4 blob mode (fallback) ──
    if (ref) {
      for (const src of ["server", "cache"]) {
        try {
          const doc = await ref.get({ source: src });
          if (doc.exists && doc.data().state) {
            const fbState = doc.data().state;
            this._fbLoadStatus = 'ok';
            this._fbLoadedTs = fbState._lsModified || 0;
            this.ls(fbState);
            return fbState;
          }
          this._fbLoadStatus = 'empty';
          return null;
        } catch(e) {
          if (src === "server") {
            console.warn("[Store] Firebase server fetch failed, trying cache", e);
          } else {
            console.warn("[Store] Firebase cache also unavailable", e);
            this._fbLoadStatus = 'error';
          }
        }
      }
    }
    return local;
  },

  async save(s)   { this.ls(s); await this.saveToFB(s); },

  // Strip undefined values from an object tree. Firebase throws
  // "Unsupported field value: undefined" if any key is explicitly undefined.
  // JSON.stringify naturally drops undefined, so round-tripping through JSON
  // is the simplest and most bulletproof way to clean the entire state.
  _clean(obj) { return JSON.parse(JSON.stringify(obj)); },

  async saveToFB(s) {
    // ── V5 per-task mode: diff and write only changed documents ──
    if (this._v5) { return this._saveV5(s); }

    // ── V4 blob mode (fallback) ──
    const ref = this.docRef();
    if (!ref || !db) return;
    const hasTasks = s?.lists?.some(l => l.tasks?.length > 0);
    if (!hasTasks) {
      // Catastrophic-delete guard: never wipe tasks that were present in last save
      if (this._lastSavedState?.lists?.some(l => l.tasks?.length > 0)) {
        console.warn("[Store] CATASTROPHIC DELETE BLOCKED (V4 path) — refusing to overwrite tasks with empty state");
        return;
      }
      if (this._fbLoadStatus !== 'ok' && this._fbLoadStatus !== 'empty') {
        console.log("[Store] Skipping blank-state save — protecting existing data");
        return;
      }
    }
    try {
      const localTs = s._lsModified || Date.now();
      const cleaned = this._clean({ ...s, _lsModified: localTs });
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const fbTs = snap.exists ? (snap.data()?.state?._lsModified || 0) : 0;
        if (fbTs > localTs) {
          console.warn("[Store] TRANSACTION BLOCKED — Firebase has newer data:", fbTs, "> local:", localTs);
          return;
        }
        tx.set(ref, {
          state: cleaned,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      });
      this._lastSavedToFB = Date.now();
      this._lastSavedFbModified = localTs;
      this._fbLoadedTs = localTs;
      this._fbLoadStatus = 'ok';
      this._fbSaveError = null;
    } catch(e) {
      console.warn("[Store] Firebase save failed", e);
      this._fbSaveError = e;
    }
  },

  // localStorage-only flush — used by beforeunload/pagehide where we must NOT
  // write to Firebase (risk of stale data overwriting fresh). localStorage is
  // safe because it only affects THIS device and will be reconciled on next load.
  flushToLocalOnly(s) { this.ls(s); },

  // ═══════════════════════════════════════════════════════════════════════════
  // V5 PER-TASK STORAGE — each task is its own Firestore document.
  // No more blob overwrites. A stale device cannot damage tasks it doesn't
  // know about because it never writes to those documents.
  // ═══════════════════════════════════════════════════════════════════════════

  _v5: true,                    // feature flag — set false to revert to blob mode
  _lastSavedState: null,        // snapshot of last saved state — used for diffing
  _taskUnsub: null,             // onSnapshot unsubscribe for tasks collection
  _settingsUnsub: null,         // onSnapshot unsubscribe for settings doc

  // ── Firestore refs for V5 collections ──
  tasksCol()    { return db && this.uid ? db.collection("users").doc(this.uid).collection("tasks") : null; },
  settingsDoc() { return db && this.uid ? db.collection("users").doc(this.uid).collection("config").doc("settings") : null; },
  metaDoc()     { return db && this.uid ? db.collection("users").doc(this.uid).collection("config").doc("meta") : null; },

  // ── Shaila ↔ Task bidirectional sync ──
  // Returns { newTasks: [...], completedTaskIds: [...] }
  //
  // Flow 1: Transcriber → Task — pending shailos without a linked task get one created
  // Flow 3: Transcriber answered → Task completed — answered shailos mark linked tasks done
  shailosCol() { return db && this.uid ? db.collection("users").doc(this.uid).collection("shailos") : null; },

  async syncShailos(currentTasks) {
    const col = this.shailosCol();
    if (!col) return { newTasks: [], completedTaskIds: [] };
    try {
      const snap = await col.get();
      if (snap.empty) return { newTasks: [], completedTaskIds: [] };

      // Build lookup: shailaId → task
      const taskByShailaId = {};
      (currentTasks || []).forEach(t => { if (t.shailaId) taskByShailaId[t.shailaId] = t; });

      const newTasks = [];
      const completedTaskIds = [];

      snap.forEach(doc => {
        const s = doc.data();
        const linkedTask = taskByShailaId[doc.id];
        const shailaText = String(s.synopsis || s.parsedShaila || s.content || "").trim();
        const canCreateTask = shailaText && shailaText.toLowerCase() !== "new shaila";

        if (!linkedTask && s.status === "pending" && canCreateTask) {
          // Flow 1: new pending shaila → create task
          newTasks.push({
            id: uid(),
            text: s.synopsis || s.content?.substring(0, 80) || s.parsedShaila?.substring(0, 80),
            completed: false,
            priority: "shaila",
            createdAt: Date.now(),
            shailaId: doc.id,
          });
        } else if (linkedTask && !linkedTask.completed && s.status === "answered") {
          // Flow 3: shaila answered in transcriber → complete the task
          completedTaskIds.push(linkedTask.id);
        }
      });

      if (newTasks.length) console.log("[Store] Shaila sync: created", newTasks.length, "task(s)");
      if (completedTaskIds.length) console.log("[Store] Shaila sync: completing", completedTaskIds.length, "answered task(s)");
      return { newTasks, completedTaskIds };
    } catch(e) {
      console.warn("[Store] Shaila sync failed:", e);
      return { newTasks: [], completedTaskIds: [] };
    }
  },

  // Flow 2: Task → Transcriber — new shaila-priority task → create shaila doc
  // Uses task.shailaId (pre-assigned) as doc ID to avoid race with onSnapshot listener
  async createShailaFromTask(task) {
    const col = this.shailosCol();
    if (!col) return null;
    try {
      const now = new Date();
      const dateStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0') + ' ' + String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
      const ref = task.shailaId ? col.doc(task.shailaId) : col.doc();
      const synopsis = task.text.length > 60 ? task.text.substring(0, 57) + "…" : task.text;
      await ref.set(this._clean({
        content: task.text,
        synopsis: synopsis,
        status: "pending",
        date: dateStr,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        userId: firebase.auth().currentUser?.uid || this.uid,
        askerName: "",
        answer: "",
        answererName: "",
        parsedShaila: task.text,
        // Marks this doc as originating from the task app so the real-time listener
        // can skip it (the corresponding task already exists in state).
        _taskAppSource: true,
      }));
      console.log("[Store] Created shaila doc from task:", ref.id);
      return ref.id;
    } catch(e) {
      console.warn("[Store] createShailaFromTask failed:", e);
      return null;
    }
  },

  // Flow 4: Task completed → Transcriber updated — mark shaila as answered
  async markShailaAnswered(shailaId, answerText) {
    const col = this.shailosCol();
    if (!col || !shailaId) return;
    try {
      await col.doc(shailaId).update({
        status: "answered",
        answer: answerText || "Completed in Shamash Pro 4",
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      console.log("[Store] Marked shaila answered:", shailaId);
    } catch(e) {
      console.warn("[Store] markShailaAnswered failed:", e);
    }
  },

  // Generic shaila status setter — "pending" | "answered" | "got_back"
  async markShailaStatus(shailaId, status) {
    const col = this.shailosCol();
    if (!col || !shailaId) return;
    try {
      await col.doc(shailaId).update({
        status: status,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      console.log("[Store] Shaila status →", status, ":", shailaId);
    } catch(e) {
      console.warn("[Store] markShailaStatus failed:", e);
    }
  },

  // Delete a shaila doc from the transcriber collection
  async deleteShailaDoc(shailaId) {
    const col = this.shailosCol();
    if (!col || !shailaId) return;
    try {
      await col.doc(shailaId).delete();
      console.log("[Store] Deleted shaila doc:", shailaId);
    } catch(e) {
      console.warn("[Store] deleteShailaDoc failed:", e);
    }
  },

  // ── Manual full backup: tasks + shailos → user-chosen JSON file ──
  async fullBackup(appState) {
    try {
      const { backup, counts } = await this._buildBackup(appState, "manual");
      const content = JSON.stringify(backup, null, 2);
      const fileName = `onetask_full_backup_${this._backupStamp(true)}.json`;

      const dirHandle = await this._idbGet('backupDir');
      if (dirHandle) {
        const savedToFolder = await this._writeBackupToDir(dirHandle, fileName, content, { allowPrompt: true });
        if (savedToFolder) {
          console.log("[Backup] Full backup saved to selected folder:", fileName, "— tasks:", counts.tasks, ", shailos:", counts.shailos);
          return { ...counts, fileName };
        }
      }

      const saved = await this._saveJsonFile(fileName, content);
      if (!saved) return null;
      console.log("[Backup] Full backup saved:", fileName, "— tasks:", counts.tasks, ", shailos:", counts.shailos);
      return { ...counts, fileName };
    } catch(e) {
      console.error("[Backup] Full backup failed:", e);
      return null;
    }
  },

  // ── Restore from backup JSON ──
  // Returns { appState, shailos, backupDate, warning } or null on error
  parseBackup(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      if (!data._backupVersion || !data.appState) {
        // Try legacy format (just appState directly)
        if (data.lists) {
          return { appState: data, shailos: [], backupDate: data._lsModified ? new Date(data._lsModified).toISOString() : null, warning: null };
        }
        return null;
      }
      return { appState: data.appState, shailos: data.shailos || [], backupDate: data._backupDate, warning: null };
    } catch(e) {
      console.error("[Backup] Parse failed:", e);
      return null;
    }
  },

  // Restore shailos from backup into Firebase
  async restoreShailos(shailos) {
    const col = this.shailosCol();
    if (!col || !shailos?.length) return 0;
    let count = 0;
    for (const s of shailos) {
      try {
        const { id, ...data } = s;
        if (id) await col.doc(id).set(this._clean(data), { merge: true });
        else await col.add(this._clean(data));
        count++;
      } catch(e) { console.warn("[Backup] Restore shaila failed:", e); }
    }
    console.log("[Backup] Restored", count, "shailos");
    return count;
  },

  // ── Full reconciliation check ──
  // Compares all shailos vs all shaila-priority tasks, returns mismatches
  // Returns { missingTasks: [{shaila doc}], missingShailos: [{task}], statusMismatches: [{task, shaila}] }
  async reconcileShailos(currentTasks) {
    const col = this.shailosCol();
    if (!col) return { missingTasks: [], missingShailos: [], statusMismatches: [] };
    try {
      const snap = await col.get();
      const shailoMap = {};
      snap.forEach(doc => { shailoMap[doc.id] = { id: doc.id, ...doc.data() }; });

      const shailaTasks = (currentTasks || []).filter(t => t.priority === "shaila" && !t.completed);
      const linkedShailaIds = new Set(shailaTasks.filter(t => t.shailaId).map(t => t.shailaId));

      // Shailos that exist in transcriber but have no task (treat missing status as pending)
      const missingTasks = Object.values(shailoMap).filter(s =>
        s.status !== "answered" && s.status !== "got_back" && !linkedShailaIds.has(s.id)
      );

      // Shaila-priority tasks that have no matching shaila doc
      const missingShailos = shailaTasks.filter(t =>
        !t.shailaId || !shailoMap[t.shailaId]
      );

      // Status mismatches: task is active but shaila is answered, or vice versa
      const statusMismatches = [];
      shailaTasks.forEach(t => {
        if (!t.shailaId) return;
        const s = shailoMap[t.shailaId];
        if (s && (s.status === "answered" || s.status === "got_back") && !t.completed) {
          statusMismatches.push({ task: t, shaila: s, type: "shaila_answered" });
        }
      });

      return { missingTasks, missingShailos, statusMismatches };
    } catch(e) {
      console.warn("[Store] reconcileShailos failed:", e);
      return { missingTasks: [], missingShailos: [], statusMismatches: [] };
    }
  },

  // Real-time listener for shaila changes (returns unsubscribe function)
  listenShailos(callback) {
    const col = this.shailosCol();
    if (!col) return () => {};
    const dlog = (msg, data) => fetch("/.netlify/functions/debug-log", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "fe:shailaListener", msg, data }),
    }).catch(() => {});
    // A Firestore onSnapshot listener is TERMINAL after its error callback fires — it
    // never reconnects on its own. Shailos have no localStorage fallback (unlike tasks),
    // so a single transport drop (iOS WebChannel kill, VPN, flaky network) used to empty
    // the shailos lane permanently until a full page reload. Tear down and resubscribe
    // with capped exponential backoff so the lane self-heals.
    let stopped = false;
    let unsub = null;
    let retryTimer = null;
    let attempt = 0;

    const subscribe = () => {
      if (stopped) return;
      dlog(attempt ? `resubscribe #${attempt}` : "subscribed");
      unsub = col.onSnapshot(snap => {
        attempt = 0; // a healthy snapshot resets the backoff
        const shailos = [];
        snap.forEach(doc => shailos.push({ id: doc.id, ...doc.data() }));
        this._noteSync(snap.metadata.fromCache);
        // Pass fromCache so the consumer can avoid destructive deletions off a cached
        // (possibly stale/partial) snapshot — important now that this listener
        // resubscribes and re-emits cache snapshots after a transport drop.
        callback(shailos, snap.metadata.fromCache);
      }, err => {
        dlog("listener ERROR", { err: String(err?.message || err), attempt });
        console.warn("[Store] Shaila listener error — resubscribing:", err);
        try { unsub && unsub(); } catch (_) {}
        unsub = null;
        if (stopped) return;
        const delay = Math.min(30000, 1000 * Math.pow(2, attempt));
        attempt += 1;
        retryTimer = setTimeout(subscribe, delay);
      });
    };

    subscribe();

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      try { unsub && unsub(); } catch (_) {}
    };
  },

  // ── Extract settings fields from AS (everything except lists and tasks) ──
  _extractSettings(s) {
    const { lists, _lsModified, ...settings } = s || {};
    return settings;
  },

  // ── Flatten tasks from AS blob into a Map<id, taskWithListId> ──
  _flattenTasks(s) {
    const map = new Map();
    if (!s?.lists) return map;
    for (const list of s.lists) {
      for (let i = 0; i < (list.tasks || []).length; i++) {
        const task = list.tasks[i];
        map.set(task.id, { ...task, listId: list.id, _sortIndex: i });
      }
    }
    return map;
  },

  // ── Check if migration from V4 blob to V5 per-task is needed ──
  async _checkMigration() {
    const meta = this.metaDoc();
    if (!meta) return 'v4';
    try {
      const snap = await meta.get({ source: "server" });
      if (snap.exists && snap.data()?.schema === 'v5_pertask') return 'v5';
    } catch(e) {
      // Try cache if server fails
      try {
        const snap = await meta.get({ source: "cache" });
        if (snap.exists && snap.data()?.schema === 'v5_pertask') return 'v5';
      } catch(e2) {}
    }
    return 'v4';
  },

  // ── Migrate from V4 blob to V5 per-task documents ──
  // Uses a batched write — atomic: all docs are written or none are.
  // The old appState_v4 document is kept as a backup.
  async _migrateToV5(blobState) {
    if (!db || !this.uid || !blobState?.lists) return false;
    console.log("[Store] Starting V4 → V5 migration...");
    try {
      const CHUNK = 400; // stay well under Firestore's 500-op batch limit

      // Collect all task write ops up front
      const taskOps = [];
      for (const list of blobState.lists) {
        for (const task of (list.tasks || [])) {
          let docId = task.id;
          if (typeof docId === 'number') docId = String(docId);
          if (typeof docId !== 'string' || !docId || docId.includes('/')) {
            docId = 't_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
          }
          taskOps.push({
            ref: this.tasksCol().doc(docId),
            data: this._clean({ ...task, id: docId, listId: list.id, _lastModified: Date.now() }),
          });
        }
      }

      const settings = this._extractSettings(blobState);
      settings._lists = blobState.lists.map((l, i) => ({ id: l.id, name: l.name, order: i }));
      settings._lastModified = Date.now();

      // Commit tasks in chunks of CHUNK. Settings + meta go in the FINAL batch
      // so migration is only marked complete when every task is written.
      if (taskOps.length === 0) {
        const batch = db.batch();
        batch.set(this.settingsDoc(), this._clean(settings));
        batch.set(this.metaDoc(), { schema: 'v5_pertask', migratedAt: Date.now(), taskCount: 0 });
        await batch.commit();
      } else {
        for (let i = 0; i < taskOps.length; i += CHUNK) {
          const chunk = taskOps.slice(i, i + CHUNK);
          const batch = db.batch();
          chunk.forEach(({ ref, data }) => batch.set(ref, data));
          if (i + CHUNK >= taskOps.length) {
            // Last chunk — attach settings + meta so the whole migration is atomic per-chunk
            batch.set(this.settingsDoc(), this._clean(settings));
            batch.set(this.metaDoc(), { schema: 'v5_pertask', migratedAt: Date.now(), taskCount: taskOps.length });
          }
          await batch.commit();
        }
      }

      console.log("[Store] V5 migration complete:", taskOps.length, "tasks written");
      return true;
    } catch(e) {
      console.error("[Store] V5 migration FAILED:", e);
      return false;
    }
  },

  // ── Load from V5 per-task collections ──
  // Reads all tasks + settings, reconstructs the AS blob shape the app expects.
  async _loadV5() {
    const col = this.tasksCol();
    const settRef = this.settingsDoc();
    if (!col || !settRef) return null;

    try {
      // Load tasks and settings in parallel
      const [taskSnap, settSnap] = await Promise.all([
        col.get({ source: "server" }).catch(() => col.get({ source: "cache" })),
        settRef.get({ source: "server" }).catch(() => settRef.get({ source: "cache" }))
      ]);

      const settings = settSnap.exists ? settSnap.data() : {};
      const listMeta = settings._lists || [{ id: "default", name: "My Tasks", order: 0 }];
      delete settings._lists;
      delete settings._lastModified;

      // Group tasks by listId
      const tasksByList = {};
      taskSnap.forEach(doc => {
        const t = doc.data();
        const lid = t.listId || "default";
        if (!tasksByList[lid]) tasksByList[lid] = [];
        // Remove internal fields from task data (metadata, not part of the task)
        const { listId, _lastModified, _sortIndex, ...taskData } = t;
        taskData._sortIndex = _sortIndex ?? 9999; // keep for sorting, strip after
        tasksByList[lid].push(taskData);
      });

      // Sort each list's tasks by _sortIndex (preserves user's manual ordering)
      for (const lid in tasksByList) {
        tasksByList[lid].sort((a, b) => (a._sortIndex ?? 9999) - (b._sortIndex ?? 9999));
        tasksByList[lid].forEach(t => delete t._sortIndex); // clean up
      }

      // Reconstruct lists array
      const lists = listMeta
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map(lm => ({
          id: lm.id,
          name: lm.name,
          tasks: tasksByList[lm.id] || []
        }));

      // Reconstruct the full AS blob
      const state = { ...settings, lists, _lsModified: Date.now() };
      this._fbLoadStatus = 'ok';
      this._lastSavedState = JSON.parse(JSON.stringify(state)); // deep clone for diffing
      this.ls(state);
      console.log("[Store] V5 loaded:", taskSnap.size, "tasks,", listMeta.length, "lists");
      return state;
    } catch(e) {
      console.error("[Store] V5 load failed:", e);
      this._fbLoadStatus = 'error';
      return null;
    }
  },

  // ── Save to V5: diff-based, writes ONLY changed documents ──
  // Compares current state against _lastSavedState to find what changed.
  async _saveV5(s) {
    if (!db || !this.uid) return;
    const col = this.tasksCol();
    const settRef = this.settingsDoc();
    if (!col || !settRef) return;

    // SAFETY: catastrophic-delete guard
    const hasTasks = s?.lists?.some(l => l.tasks?.length > 0);
    if (!hasTasks) {
      // Never wipe tasks that were present when we last saved
      if (this._lastSavedState?.lists?.some(l => l.tasks?.length > 0)) {
        console.warn("[Store] V5: CATASTROPHIC DELETE BLOCKED — refusing to overwrite tasks with empty state");
        return;
      }
      // Never save empty state if we haven't confirmed the Firebase load status
      if (this._fbLoadStatus !== 'ok' && this._fbLoadStatus !== 'empty') {
        console.log("[Store] V5: Skipping blank-state save");
        return;
      }
    }

    try {
      const newTasks = this._flattenTasks(s);
      const oldTasks = this._lastSavedState ? this._flattenTasks(this._lastSavedState) : new Map();

      const batch = db.batch();
      let ops = 0;

      // Find tasks that changed or were added
      for (const [id, task] of newTasks) {
        const old = oldTasks.get(id);
        if (!old || JSON.stringify(old) !== JSON.stringify(task)) {
          const cleaned = this._clean({ ...task, _lastModified: Date.now() });
          batch.set(col.doc(id), cleaned);
          ops++;
        }
      }

      // Find tasks that were deleted (in old but not in new)
      for (const [id] of oldTasks) {
        if (!newTasks.has(id)) {
          batch.delete(col.doc(id));
          ops++;
        }
      }

      // Check if settings changed
      const newSettings = this._extractSettings(s);
      const oldSettings = this._lastSavedState ? this._extractSettings(this._lastSavedState) : {};
      // Include list metadata
      newSettings._lists = s.lists.map((l, i) => ({ id: l.id, name: l.name, order: i }));
      oldSettings._lists = this._lastSavedState?.lists?.map((l, i) => ({ id: l.id, name: l.name, order: i }));

      if (JSON.stringify(newSettings) !== JSON.stringify(oldSettings)) {
        newSettings._lastModified = Date.now();
        batch.set(settRef, this._clean(newSettings));
        ops++;
      }

      if (ops === 0) return; // nothing changed

      await batch.commit();
      this._lastSavedState = JSON.parse(JSON.stringify(s)); // update snapshot
      this._lastSavedToFB = Date.now();
      this._fbLoadStatus = 'ok';
      this._fbSaveError = null;
      console.log("[Store] V5 saved:", ops, "document(s) written");
    } catch(e) {
      console.warn("[Store] V5 save failed:", e);
      this._fbSaveError = e;
    }
  },

  // ── V5 collection listener — returns unsubscribe function ──
  // Listens to the tasks COLLECTION (not a single document). Each change is
  // a single task add/modify/remove — surgical, not a blob replace.
  // Self-healing: a Firestore onSnapshot listener is terminal after its error
  // callback fires. We resubscribe with exponential backoff so a transport drop
  // (backgrounded PWA, flaky network) doesn't silently kill the stream forever.
  _listenV5(onUpdate) {
    const col = this.tasksCol();
    const settRef = this.settingsDoc();
    if (!col || !settRef) return () => {};

    const taskCache = new Map();
    let settings = {};
    let listMeta = [{ id: "default", name: "My Tasks", order: 0 }];
    let initialized = false;
    let stopped = false;
    let unsubTasks = null, unsubSettings = null;
    let taskRetry = null, settRetry = null;
    let taskAttempt = 0, settAttempt = 0;

    const rebuild = () => {
      const lists = listMeta
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map(lm => ({
          id: lm.id,
          name: lm.name,
          tasks: [...taskCache.values()].filter(t => (t.listId || "default") === lm.id)
            .sort((a, b) => (a._sortIndex ?? 9999) - (b._sortIndex ?? 9999))
            .map(({ listId, _lastModified, _sortIndex, ...t }) => t)
        }));
      return { ...settings, lists, _lsModified: Date.now() };
    };

    const subscribeTasks = () => {
      if (stopped) return;
      unsubTasks = col.onSnapshot(snap => {
        taskAttempt = 0; // healthy stream resets backoff
        this._noteSync(snap.metadata.fromCache);
        let changed = false;
        snap.docChanges().forEach(change => {
          if (change.type === "added" || change.type === "modified") {
            taskCache.set(change.doc.id, change.doc.data());
            changed = true;
          } else if (change.type === "removed") {
            taskCache.delete(change.doc.id);
            changed = true;
          }
        });
        // Always mark initialized after first snapshot, even if collection is empty,
        // so subsequent real changes are not silently dropped.
        initialized = true;
        // Always push state on any change — including the first snapshot.
        // The wasInitialized guard previously skipped the first snapshot assuming
        // load() already had the same data. But tasks added on another device between
        // load() and the first snapshot land in taskCache and never reach the UI
        // until a subsequent change triggers onUpdate. Removing the guard means
        // the first snapshot is always authoritative; App.jsx's adoptedRemote guard
        // prevents this from bouncing back as a save. Safe because setAS() is idempotent.
        if (changed) {
          const newState = rebuild();
          this._lastSavedState = JSON.parse(JSON.stringify(newState));
          onUpdate(newState);
        }
      }, err => {
        console.warn("[Store] V5 task listener error — resubscribing:", err);
        try { unsubTasks && unsubTasks(); } catch (_) {}
        unsubTasks = null;
        if (stopped) return;
        const delay = Math.min(30000, 1000 * Math.pow(2, taskAttempt));
        taskAttempt += 1;
        taskRetry = setTimeout(subscribeTasks, delay);
      });
    };

    const subscribeSettings = () => {
      if (stopped) return;
      unsubSettings = settRef.onSnapshot(snap => {
        settAttempt = 0;
        if (!snap.exists) return;
        const data = snap.data();
        listMeta = data._lists || listMeta;
        const { _lists, _lastModified, ...rest } = data;
        settings = rest;
        if (initialized) {
          const newState = rebuild();
          this._lastSavedState = JSON.parse(JSON.stringify(newState));
          onUpdate(newState);
        }
      }, err => {
        console.warn("[Store] V5 settings listener error — resubscribing:", err);
        try { unsubSettings && unsubSettings(); } catch (_) {}
        unsubSettings = null;
        if (stopped) return;
        const delay = Math.min(30000, 1000 * Math.pow(2, settAttempt));
        settAttempt += 1;
        settRetry = setTimeout(subscribeSettings, delay);
      });
    };

    subscribeTasks();
    subscribeSettings();

    return () => {
      stopped = true;
      clearTimeout(taskRetry); clearTimeout(settRetry);
      try { unsubTasks && unsubTasks(); } catch (_) {}
      try { unsubSettings && unsubSettings(); } catch (_) {}
    };
  }
};

const BEFORE_SHAVUOS_PRIORITY_ID = "before_shavuos";
const BEFORE_SHAVUOS_PRIORITY = {
  id: BEFORE_SHAVUOS_PRIORITY_ID,
  label: "Before Shavuos",
  color: "#0B57D0",
  weight: 6,
  superPinned: true,
};

// Shavuos has passed — retire the priority from the picker while preserving
// its label/color on any tasks that were already assigned to it.
function ensureBeforeShavuosPriority(priorities = []) {
  const list = Array.isArray(priorities) ? priorities.filter(Boolean) : [];
  return list.map(p => p.id === BEFORE_SHAVUOS_PRIORITY_ID ? { ...p, deleted: true } : p);
}

function beforeShavuosFirst(tasks = []) { return tasks; }

const DEF_PRI = [
  {id:"shaila", label:"Shaila", color:"#C8A84C", weight:5, isShaila:true},
  {id:"now",    label:"Now",    color:"#E09AB8", weight:3},
  {id:"today",  label:"Today",  color:"#E0B472", weight:2},
  {id:"eventually", label:"Eventually", color:"#7EB0DE", weight:1}
];

const DEF_AGE_THRESHOLDS = {shaila: 24, now: 48, today: 120, eventually: 336};

const SCHEMES = {
  googleVoice:{name:"Google Voice",     bg:"#FFFFFF",bgW:"#F8F9FA",card:"#FFFFFF",text:"#202124",tSoft:"#5F6368",tFaint:"#5F6368",brd:"#DADCE0",brdS:"#E8EAED",grad:["#FFFFFF","#F8F9FA","#F1F3F4"],primary:"#00796B",onPrimary:"#FFFFFF",tonal:"#E0F2F1",onTonal:"#00695C",success:"#137333",danger:"#D93025",warning:"#8A5A00"},
  material:  {name:"Material Light",  bg:"#F8FAFD",bgW:"#EEF3FA",card:"#FFFFFF",text:"#182230",tSoft:"#465568",tFaint:"#5A6678",brd:"#D6DDE8",brdS:"#E8EDF5",grad:["#F8FAFD","#EEF3FA","#E3EAF5"],primary:"#0B57D0",onPrimary:"#FFFFFF",tonal:"#D3E3FD",onTonal:"#041E49"},
  materialDark:{name:"Material Dark", bg:"#0F141B",bgW:"#18202B",card:"#1E2733",text:"#EEF3FA",tSoft:"#C4CCD8",tFaint:"#98A4B3",brd:"#3B4756",brdS:"#293441",grad:["#0F141B","#141B24","#1E2733"],primary:"#A8C7FA",onPrimary:"#062E6F",tonal:"#1F3B63",onTonal:"#D3E3FD",glow:true},
  claude:    {name:"Claude Cream",    bg:"#FAF9F6",bgW:"#F0EDE6",card:"#FFFFFF",text:"#1F1A15",tSoft:"#51443A",tFaint:"#73665B",brd:"#DCD6CB",brdS:"#EEE9E1",grad:["#FAF9F6","#F2EFE8","#E8E1D7"],primary:"#9A452B",onPrimary:"#FFFFFF",tonal:"#F7E4DA",onTonal:"#71331F"},
  navyGold:  {name:"Navy Gold",       bg:"#07111F",bgW:"#0D1B2E",card:"#122235",text:"#F7FAFF",tSoft:"#D6DEE9",tFaint:"#A5B3C4",brd:"#304258",brdS:"#1F3147",grad:["#07111F","#0B1728","#122235"],primary:"#F2C14E",onPrimary:"#1F1600",tonal:"#3A321B",onTonal:"#FFE7A3",glow:true},
  midnight:  {name:"Midnight Focus",  bg:"#1A1B2E",bgW:"#222340",card:"#252748",text:"#E0DCF0",tSoft:"#9994B8",tFaint:"#AAA5C8",brd:"#3A3860",brdS:"#2E2D50",grad:["#1A1B2E","#1E1F38","#222340"]},
  forest:    {name:"Forest Calm",     bg:"#E4EBE0",bgW:"#D4DDD0",card:"#EEF2EB",text:"#344030",tSoft:"#50624A",tFaint:"#4F5F49",brd:"#C4D0BC",brdS:"#D8E0D4",grad:["#E4EBE0","#D8E2D2","#CCD6C4"]},
  sunset:    {name:"Warm Sunset",     bg:"#F0E0D0",bgW:"#E8D4C0",card:"#F8EEE2",text:"#4A3428",tSoft:"#705040",tFaint:"#765040",brd:"#DCC8B4",brdS:"#E8D8C8",grad:["#F0E0D0","#E8D0BC","#E0C4B0"]},
  ocean:     {name:"Ocean Breeze",    bg:"#DDE8EE",bgW:"#CCDCE4",card:"#EAF0F4",text:"#2A3840",tSoft:"#486070",tFaint:"#495E6B",brd:"#B8CCD6",brdS:"#D0DDE4",grad:["#DDE8EE","#D0DEE6","#C4D4DE"]},
  lavender:  {name:"Lavender Haze",   bg:"#EAE6F2",bgW:"#DFD9EC",card:"#F2EFF7",text:"#36304A",tSoft:"#564878",tFaint:"#665578",brd:"#CCC6E0",brdS:"#DDD8EC",grad:["#EAE6F2","#E4DEF0","#DAD2EA"]},
  sage:      {name:"Sage & Cream",    bg:"#E6EDE4",bgW:"#D6DFD2",card:"#EEF3EC",text:"#2E4030",tSoft:"#4A6248",tFaint:"#50614E",brd:"#C0CEBC",brdS:"#D4DECE",grad:["#E6EDE4","#DAEBD6","#CEDEC8"]},
  slate:     {name:"Dusty Slate",     bg:"#E4ECF0",bgW:"#D6E2E8",card:"#EEF3F6",text:"#2C3E46",tSoft:"#466070",tFaint:"#4B6370",brd:"#BECCD6",brdS:"#D2DFE6",grad:["#E4ECF0","#D8E8F0","#CCDEE8"]},
  rose:      {name:"Dusty Rose",      bg:"#F0E4E4",bgW:"#E6D4D4",card:"#F6EEEE",text:"#422C2C",tSoft:"#6A4444",tFaint:"#745050",brd:"#D4BCBC",brdS:"#E6D0D0",grad:["#F0E4E4","#ECD8D8","#E6CCCC"]},
  parchment: {name:"Old Parchment",   bg:"#F2EAD8",bgW:"#EAE0C8",card:"#F8F2E8",text:"#3C2E18",tSoft:"#5E4A2A",tFaint:"#715A38",brd:"#DCC8A0",brdS:"#EAD8B8",grad:["#F2EAD8","#ECE2CA","#E6D6BA"]},
  starlit:   {name:"Starlit Night",   bg:"#0C1220",bgW:"#111828",card:"#141E30",text:"#EEF2FF",tSoft:"#C0CCE8",tFaint:"#8899BB",brd:"#263050",brdS:"#1C2640",grad:["#0C1220","#101826","#141E30"],glow:true},
  obsidian:  {name:"Obsidian",        bg:"#181818",bgW:"#202020",card:"#242424",text:"#E0E0E0",tSoft:"#999999",tFaint:"#949494",brd:"#363636",brdS:"#2A2A2A",grad:["#181818","#1E1E1E","#242424"]},
  deepocean: {name:"Deep Ocean",      bg:"#0A1628",bgW:"#0E1C32",card:"#12223C",text:"#C8D8F0",tSoft:"#AFC4E4",tFaint:"#96ADD0",brd:"#1E3450",brdS:"#162A42",grad:["#0A1628","#0E1C32","#12223C"],glow:true},
  ember:     {name:"Dying Ember",     bg:"#1A1210",bgW:"#221816",card:"#281E1A",text:"#E8D0C0",tSoft:"#D2B8A8",tFaint:"#B79C8A",brd:"#3A2820",brdS:"#2E2018",grad:["#1A1210","#201614","#261A18"]},
};
Object.keys(SCHEMES).forEach(id => { SCHEMES[id] = ensureSchemeContrast(SCHEMES[id]); });

const PALETTE = ["#C8A84C","#E09AB8","#E0B472","#7EB0DE","#9BD4A0","#D4A0D8","#E0A090","#A0D0C8","#C8B8E0","#E0C890","#90BCE0","#D8B090","#A8C8A0","#E8A0A0","#A0A8E0","#C0D890"];
const PROMPTS = ["Just one small thing...","Start anywhere...","Brain dump mode...","Five minutes is enough...","Clear your mind..."];

// TIPS: each with source label and source URL for citations in Insights
const TIPS = [
  {t:"The two-minute rule: if it takes less than two minutes, do it now.", s:"David Allen — Getting Things Done", cat:"Focus", url:"https://gettingthingsdone.com/"},
  {t:"Implementation intentions increase follow-through by 2–3×. Saying 'I will do X at time Y in place Z' works.", s:"Gollwitzer (1999)", cat:"Science", url:"https://doi.org/10.1037/0033-295X.106.3.525"},
  {t:"Task switching costs 23 minutes of refocus time on average.", s:"Mark et al. (2005)", cat:"Science", url:"https://doi.org/10.1145/1056808.1057012"},
  {t:"Writing tasks down releases mental tension caused by unfinished items.", s:"Masicampo & Baumeister (2011)", cat:"Science", url:"https://doi.org/10.1037/a0024192"},
  {t:"Front-load important decisions to the morning when willpower is highest.", s:"Baumeister & Tierney — Willpower", cat:"Focus", url:"https://www.willpowerbook.com/"},
  {t:"The Progress Principle: small wins create more motivation than big milestones.", s:"Amabile & Kramer (2011) — HBR", cat:"Motivation", url:"https://hbr.org/2011/05/the-power-of-small-wins"},
  {t:"Timeboxing is the most consistently cited useful productivity method among knowledge workers.", s:"HBR / Eyal (2022)", cat:"Focus", url:"https://hbr.org/2022/03/the-most-useful-productivity-hack"},
  {t:"Top producers work in 52-minute sessions with 17-minute breaks.", s:"DeskTime study (2014)", cat:"Focus", url:"https://desktime.com/blog/17-52-ratio-most-productive"},
  {t:"Moderate ambient noise around 70 dB enhances creative performance.", s:"Mehta et al. (2012)", cat:"Environment", url:"https://doi.org/10.1086/665048"},
  {t:"Temptation bundling — pairing tasks you should do with things you love — boosts completion.", s:"Milkman et al. (2013)", cat:"Motivation", url:"https://doi.org/10.1287/mnsc.1120.1530"},
  {t:"Self-compassion after procrastinating reduces future procrastination. Guilt makes it worse.", s:"Wohl et al. (2010)", cat:"ADHD", url:"https://doi.org/10.1016/j.paid.2010.01.030"},
  {t:"A short walk boosts creative thinking by up to 60%.", s:"Oppezzo & Schwartz (2014)", cat:"Environment", url:"https://doi.org/10.1037/a0036577"},
  {t:"Visualizing the process (not the outcome) reduces start anxiety significantly.", s:"Taylor et al. (1998)", cat:"ADHD", url:"https://doi.org/10.1037/0022-3514.74.2.429"},
  {t:"Accountability partners raise goal completion rates from 65% to 95%.", s:"Matthews (2015) — Dominican University", cat:"Motivation", url:"https://scholar.dominican.edu/cgi/viewcontent.cgi?article=1265&context=news-releases"},
  {t:"About 20% of effort produces 80% of results. Identify the vital few.", s:"Koch — The 80/20 Principle", cat:"Focus", url:"https://www.80-20principle.com/"},
  {t:"The five-minute rule: commit only to starting for five minutes. Starting is the hardest part.", s:"CBT tradition", cat:"ADHD", url:"https://www.psychologytoday.com/us/therapy-types/cognitive-behavioral-therapy"},
  {t:"ADHD brains respond strongly to interest, challenge, urgency, and passion — not importance.", s:"Barkley — Taking Charge of Adult ADHD", cat:"ADHD", url:"https://guilford.com/books/Taking-Charge-of-Adult-ADHD/Russell-Barkley/9781462546855"},
  {t:"External reminders and systems compensate for working memory deficits in ADHD.", s:"Brown — Smart but Stuck", cat:"ADHD", url:"https://www.amazon.com/Smart-but-Stuck-Unleashing-Trapped/dp/0470888016"},
  {t:"Breaking tasks into micro-steps reduces the activation energy required to begin.", s:"Hallowell & Ratey — Driven to Distraction", cat:"ADHD", url:"https://drhallowell.com/books/driven-to-distraction/"},
  {t:"'Good enough' done today consistently outperforms 'perfect' that never gets started.", s:"Voltaire (adapted)", cat:"Motivation", url:null},
  {t:"Dopamine spikes from completing small tasks sustain the motivation to continue.", s:"Schultz (1997) — Science", cat:"Science", url:"https://doi.org/10.1126/science.275.5306.1593"},
  {t:"Body doubling — working alongside others, even silently — significantly boosts ADHD output.", s:"Solanto et al. (2010)", cat:"ADHD", url:"https://doi.org/10.1007/s10803-009-0734-0"},
  {t:"For most chronotypes: cognitive work before 1pm, routine tasks after 2pm.", s:"Circadian biology research", cat:"Environment", url:"https://www.nigms.nih.gov/education/fact-sheets/Pages/Circadian-Rhythms.aspx"},
  {t:"Completion rituals — even a simple checkmark — reinforce habit loops and task identity.", s:"Duhigg — The Power of Habit", cat:"Motivation", url:"https://charlesduhigg.com/the-power-of-habit/"},
  {t:"Incomplete tasks occupy working memory. Write them down and your brain releases the tension.", s:"Zeigarnik (1927)", cat:"Science", url:"https://en.wikipedia.org/wiki/Zeigarnik_effect"},
  {t:"Starting anywhere is better than finding the optimal starting point.", s:"ACT / CBT tradition", cat:"Focus", url:"https://contextualscience.org/act"},
  {t:"Transition time between tasks is not wasted — it is neurologically necessary for re-entry into flow.", s:"Csikszentmihalyi — Flow", cat:"Focus", url:"https://en.wikipedia.org/wiki/Flow_(psychology)"},
  {t:"Labeling emotions before starting a task reduces amygdala reactivity and lowers avoidance.", s:"Lieberman et al. (2007)", cat:"ADHD", url:"https://doi.org/10.1037/0033-295X.114.2.420"},
  {t:"A 'parking lot' list for stray thoughts during focus prevents hyperfocus derailment.", s:"GTD methodology", cat:"ADHD", url:"https://gettingthingsdone.com/"},
  {t:"Physical momentum (making your bed, one pushup) activates behavioral momentum for larger tasks.", s:"Behavioral psychology", cat:"Motivation", url:"https://en.wikipedia.org/wiki/Behavioral_momentum"},
];

// Yeshivish correction map
const YC = {
  "shyla":"shaila","shayla":"shaila","shy la":"shaila","shy los":"shailos","shaylas":"shailos",
  "holla ka":"halacha","hello ka":"halacha","gomorrah":"gemara","go mara":"gemara",
  "toe raw":"Torah","tore uh":"Torah","shall con":"Shulchan","school con":"Shulchan",
  "rob a":"Rava","a buy":"Abaye","rash":"Rashi","raw she":"Rashi",
  "toss a fist":"Tosafos","rome bomb":"Rambam","rome ban":"Ramban",
  "chew va":"teshuvah","pee sock":"pesak","moot sir":"mutar","moo tar":"mutar",
  "ah sir":"assur","a sir":"assur","shah bus":"Shabbos","shabbat":"Shabbos",
  "shot boss":"Shabbos","cash root":"kashrus","sue car":"sukkah","make va":"mikvah",
  "ned ah":"niddah","to fill in":"tefillin","ma zoozah":"mezuzah",
  "shoe or":"shiur","she or":"shiur","call ale":"kollel","bait din":"beis din",
  "bra ha":"bracha","brock ah":"bracha","safe ache":"safeik","tar use":"treif",
  "tray of":"treif","flay shick":"fleishig","milk a":"milchig","par of":"pareve",
  "she do":"shidduch","see mon":"simcha",
  "dav in":"daven","dove in":"daven","dobbin":"daven","dovening":"davening","dove an ing":"davening",
  "minka":"mincha","mint ha":"mincha","mean ha":"mincha",
  "my rev":"maariv","mar iv":"maariv","my reef":"maariv",
  "shock wrist":"shacharis","shock harris":"shacharis","shack wrist":"shacharis",
  "ha sham":"Hashem","hosh em":"Hashem","hash em":"Hashem",
  "bar rock ha sham":"Baruch Hashem","borrow hashem":"Baruch Hashem",
  "brok hashem":"Baruch Hashem","bark hashem":"Baruch Hashem","barack hashem":"Baruch Hashem",
  "kid dish":"kiddush","key douche":"kiddush",
  "yum tuff":"Yom Tov","yum tove":"Yom Tov","yom tove":"Yom Tov",
  "yum kipper":"Yom Kippur","young kipper":"Yom Kippur",
  "pay sock":"Pesach","pays hot":"Pesach","pay suck":"Pesach",
  "sue coasts":"Sukkos","suck us":"Sukkos",
  "shavoo us":"Shavuos","shove oh is":"Shavuos",
  "motsy shabbos":"Motzei Shabbos","nazi shabbos":"Motzei Shabbos","moth see shabbos":"Motzei Shabbos",
  "half roaster":"chavrusa","have rooster":"chavrusa","have roosa":"chavrusa","hover oosa":"chavrusa",
  "base mad rash":"beis medrash","bites med rash":"beis medrash","base mid rash":"beis medrash","bass medrash":"beis medrash",
  "who mash":"chumash","hoo mash":"chumash","shoe mash":"chumash",
  "mish no":"mishnah","miss no":"mishnah","mission a":"mishnah",
  "sheer":"shiur","she ear":"shiur","sure":"shiur",
  "mack lockets":"machlokes","mock locusts":"machlokes","my cloaks":"machlokes",
  "safar ah":"svara","so far ah":"svara","savara":"svara",
  "push out":"pshat","p shot":"pshat","pee shot":"pshat","pea shot":"pshat",
  "rosh uh shiva":"rosh yeshiva","rush yeshiva":"rosh yeshiva","rush you shiva":"rosh yeshiva",
  "block her":"bochur","bocker":"bochur","boxer":"bochur","botcher":"bochur",
  "you she va":"yeshiva","ya shiva":"yeshiva",
  "call ill":"kollel","coal l":"kollel",
  "cash rust":"kashrus","cash rules":"kashrus",
  "ha lock ah":"halacha","hollow ha":"halacha",
  "tack less":"tachlis","talk less":"tachlis","tock list":"tachlis",
  "sod it":"tzaddik","sod ick":"tzaddik","zah dick":"tzaddik",
  "give all dig":"gevaldig","give all dick":"gevaldig",
  "said duck uh":"tzedakah","suh dock uh":"tzedakah","zuh doc ah":"tzedakah",
  "ha soona":"chasuna","hoss in a":"chasuna","hossana":"chasuna",
  "hoss in":"chassan","ha son":"chassan",
  "call uh":"kallah","collar":"kallah",
  "mosseltov":"mazel tov","muzzle tough":"mazel tov"
};

function cleanYT(r) {
  let t = r;
  for (const [w, x] of Object.entries(YC).sort((a, b) => b[0].length - a[0].length)) {
    t = t.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), x);
  }
  return t;
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
// Canonical storage key from email prefix — unifies email/password + Google auth.
// rabbidanziger@onetaskapp.local → "rabbidanziger" (same path as rabbidanziger@hocsouthbend.org)
function canonicalUid(user) {
  if (!user) return null;
  const prefix = (user.email || "").split("@")[0].toLowerCase().trim();
  return prefix || user.uid;
}
function gG() { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; }
function gP(p, id) { return p.find(x => x.id === id) || p.filter(x => !x.deleted).slice(-1)[0] || DEF_PRI[3]; }
function pBg(c) {
  const r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
  return `rgb(${Math.round(r+(255-r)*.82)},${Math.round(g+(255-g)*.82)},${Math.round(b+(255-b)*.82)})`;
}

// Luminance of a hex color (0=black, 1=white)
function _lum(hex) {
  const f = v => { const s = parseInt(v,16)/255; return s <= 0.03928 ? s/12.92 : Math.pow((s+0.055)/1.055,2.4); };
  return 0.2126*f(hex.slice(1,3)) + 0.7152*f(hex.slice(3,5)) + 0.0722*f(hex.slice(5,7));
}

function _isHexColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim());
}

function _toHexColor(value) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (_isHexColor(raw)) return raw.toUpperCase();
  const match = raw.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (!match) return null;
  const channels = match.slice(1, 4).map(n => Math.max(0, Math.min(255, Number(n))));
  return `#${channels.map(n => n.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function _contrastRatio(a, b) {
  const aHex = _toHexColor(a);
  const bHex = _toHexColor(b);
  if (!aHex || !bHex) return 21;
  const l1 = _lum(aHex);
  const l2 = _lum(bHex);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function _mixHex(from, to, amount) {
  const fromHex = _toHexColor(from);
  const toHex = _toHexColor(to);
  if (!fromHex || !toHex) return from;
  const f = fromHex.replace("#", "");
  const t = toHex.replace("#", "");
  const next = [0, 2, 4].map(i => {
    const a = parseInt(f.slice(i, i + 2), 16);
    const b = parseInt(t.slice(i, i + 2), 16);
    return Math.round(a + (b - a) * amount).toString(16).padStart(2, "0");
  }).join("");
  return `#${next}`.toUpperCase();
}

function _readableOn(fg, bg, min = 4.5) {
  const fgHex = _toHexColor(fg);
  const bgHex = _toHexColor(bg);
  if (!fgHex || !bgHex) return fg;
  if (_contrastRatio(fgHex, bgHex) >= min) return fgHex;
  const target = _lum(bgHex) > 0.45 ? "#000000" : "#FFFFFF";
  for (let step = 1; step <= 24; step++) {
    const next = _mixHex(fgHex, target, step / 24);
    if (_contrastRatio(next, bgHex) >= min) return next;
  }
  return _contrastRatio("#000000", bgHex) >= _contrastRatio("#FFFFFF", bgHex) ? "#000000" : "#FFFFFF";
}

function _readableAcross(fg, backgrounds, min = 4.5) {
  let next = fg;
  const bgs = backgrounds.map(_toHexColor).filter(Boolean);
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const bg of bgs) {
      const adjusted = _readableOn(next, bg, min);
      if (adjusted !== next) {
        next = adjusted;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return next;
}

function ensureSchemeContrast(scheme = {}) {
  const out = { ...scheme };
  const surfaces = [out.bg, out.bgW, out.card].filter(_isHexColor);
  const textBase = out.text || "#202124";
  out.text = _readableAcross(textBase, [...surfaces, out.tonal], 4.5);
  out.tSoft = _readableAcross(out.tSoft || out.text, surfaces, 4.5);
  out.tFaint = _readableAcross(out.tFaint || out.tSoft, surfaces, 4.5);
  if (out.primary) {
    out.primary = _readableAcross(out.primary, surfaces, 4.5);
    out.onPrimary = _readableAcross(out.onPrimary || textOnColor(out.primary), [out.primary], 4.5);
  }
  if (out.tonal) out.onTonal = _readableAcross(out.onTonal || out.text, [out.tonal], 4.5);
  ["success", "danger", "warning"].forEach(key => {
    if (out[key]) out[key] = _readableAcross(out[key], surfaces, 4.5);
  });
  return out;
}

// Returns white or dark text for readable text ON a colored background (e.g. focus card, chips)
function textOnColor(bgColor) {
  return _lum(bgColor) > 0.35 ? "#2D2520" : "#FFFFFF";
}

// Returns a darkened priority color suitable for use AS TEXT on a light card background
// Maps each priority base color → a pre-computed dark variant that passes 4.5:1 on light cards
const _priTextMap = {
  "#C8A84C":"#7A6520","#5A9E7C":"#3A7058","#E09AB8":"#8B5F72","#E0B472":"#826842","#7EB0DE":"#4F6F8C",
  "#9BD4A0":"#4A8A54","#D4A0D8":"#7A4A7E","#E0A090":"#8A4A3A","#A0D0C8":"#3A7A70",
  "#C8B8E0":"#5A4A7A","#E0C890":"#7A6A30","#90BCE0":"#3A6A8A","#D8B090":"#7A5A30",
  "#A8C8A0":"#4A7A42","#E8A0A0":"#8A3A3A","#A0A8E0":"#3A428A","#C0D890":"#5A7A28"
};
function priText(color) {
  return _priTextMap[color] || color;
}

// For pBg pastel backgrounds: returns appropriate text color.
// Dark themes can have light text, so test the actual row background.
function textOnPastel(schemeId, fallbackText, pastelBg = null) {
  if (pastelBg) return _readableOn(fallbackText, pastelBg, 4.5);
  if (schemeId === "midnight") return "#3D3838";
  return fallbackText;
}
function dayKey() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function tipOfDay(s) { let h = 0; for (let i = 0; i < s.length; i++) h = ((h<<5)-h+s.charCodeAt(i))|0; return Math.abs(h) % TIPS.length; }
function fmtMs(ms) { const m = Math.round(ms/6e4); if (m < 60) return `${m}m`; const h = Math.floor(m/60); if (h < 24) return `${h}h ${m%60}m`; return `${Math.floor(h/24)}d ${h%24}h`; }

function getMrsWPriority(pris, mrsWWindows) {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  const min = now.getMinutes();
  const timeVal = hour * 60 + min;
  const windows = mrsWWindows || {monThu: {start: "08:30", end: "13:00"}, fri: {start: "08:30", end: "10:00"}};
  function parseTime(s) { const [h, m] = s.split(":").map(Number); return h * 60 + m; }
  let isHighTime = false;
  if (day >= 1 && day <= 4) {
    const s = parseTime(windows.monThu.start), e = parseTime(windows.monThu.end);
    isHighTime = timeVal >= s && timeVal < e;
  } else if (day === 5) {
    const s = parseTime(windows.fri.start), e = parseTime(windows.fri.end);
    isHighTime = timeVal >= s && timeVal < e;
  }
  if (isHighTime) {
    const ap = pris.filter(p => !p.deleted && !p.isShaila);
    ap.sort((a, b) => b.weight - a.weight);
    return ap[0]?.id || "now";
  } else {
    const ap = pris.filter(p => !p.deleted);
    ap.sort((a, b) => a.weight - b.weight);
    return ap[0]?.id || "eventually";
  }
}

function getTaskAgeHours(task) { return (Date.now() - task.createdAt) / 3600000; }
function isTaskAged(task, pris, thresholds) {
  const th = thresholds || DEF_AGE_THRESHOLDS;
  const pri = gP(pris, task.priority);
  const hours = getTaskAgeHours(task);
  const limit = th[task.priority] ?? th[pri.id] ?? 72;
  return hours > limit;
}

// The server gateway chooses the default Gemini model; Settings can override it once for every AI job.
export const GEMINI_MODEL = "server-configured";
export const AI_PROXY_ENDPOINT = "/.netlify/functions/ai-proxy";

function normalizeAiOpts(aiOpts) {
  if (!aiOpts || typeof aiOpts === "string") return {};
  return aiOpts;
}

async function callAIProxy(payload) {
  try {
    const r = await fetch(AI_PROXY_ENDPOINT, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) {
      console.warn("[AI] Gateway error:", d.error || r.statusText);
      return null;
    }
    return d;
  } catch(e) {
    console.warn("[AI] Gateway call failed:", e);
    return null;
  }
}

async function runAIJob(job, input={}, aiOpts, options={}) {
  const opts = normalizeAiOpts(aiOpts);
  const d = await callAIProxy({
    job,
    input,
    mode: options.mode || opts.mode,
    provider: opts.provider,
    model: opts.model,
    geminiCredential: opts.geminiCredential,
    genConfig: options.genConfig || options,
  });
  return d || null;
}

async function callGemini(gk, prompt, genConfig={}) {
  const opts = normalizeAiOpts(gk);
  return callAI(prompt, {...opts, provider: "gemini"}, genConfig);
}

// Unified audio transcription — use this for ALL inline audio calls instead of raw fetch.
async function callGeminiAudio(gk, base64, mimeType, textPrompt, genConfig={}) {
  const opts = normalizeAiOpts(gk);
  const d = await runAIJob("transcribe.yeshivish.v1", {
    base64,
    mimeType,
    instruction: textPrompt,
    mode: opts.audioTask || "plain",
  }, opts, { genConfig });
  return d?.output?.transcript || d?.text || null;
}

// Compatibility wrapper for older callers that explicitly ask for Gemini.
async function callGeminiProxy(prompt, genConfig={}) {
  return callAI(prompt, {provider: "gemini"}, genConfig);
}

// Generic AI dispatcher. Every active app call goes through ai-proxy.
async function callAI(prompt, aiOpts, genConfig={}) {
  const opts = normalizeAiOpts(aiOpts);
  const d = await callAIProxy({
    kind: "text",
    task: opts.task || "general",
    provider: opts.provider || "gemini",
    model: opts.model,
    geminiCredential: opts.geminiCredential,
    prompt,
    genConfig,
  });
  return d?.text || null;
}

function optTasks(tasks, pris) {
  const now = Date.now();
  const comp    = tasks.filter(t => t.completed);
  const blocked = tasks.filter(t => !t.completed && t.blocked);          // always sink to bottom
  const pin     = tasks.filter(t => !t.completed && !t.blocked && t.pinned && !t.parentTask);
  const unp     = tasks.filter(t => !t.completed && !t.blocked && !t.pinned && !t.parentTask);

  const mW = Math.max(...pris.filter(p => !p.deleted).map(p => p.weight), 1);
  const scoreTask = (t) => {
    const p = gP(pris, t.priority);
    const age = (now - t.createdAt) / 36e5;
    const n = p.weight / mW;
    const sr = n > .8 ? .3 : n > .5 ? .8 : 1.5;
    const tu = /\b(urgent|asap|deadline|critical|shaila|shailos|psak)\b/i.test(t.text) ? 5
             : /\b(soon|important|meeting|call)\b/i.test(t.text) ? 2
             : /\b(maybe|someday|eventually)\b/i.test(t.text) ? -2 : 0;
    const ageBonus = Math.min(age * sr, 30);
    const sb = age > 48 ? Math.min(Math.log2(age/48)*3, 10) : 0;
    const sh = p.isShaila ? 50 : 0;
    const mw = t.mrsW ? 3 : 0;
    return p.weight*100 + ageBonus + tu + sb + sh + mw;
  };

  // Build group map: parentName -> sorted subtasks (exclude blocked subtasks)
  const groupMap = {};
  tasks.filter(t => !t.completed && !t.blocked && t.parentTask).forEach(t => {
    if (!groupMap[t.parentTask]) groupMap[t.parentTask] = [];
    groupMap[t.parentTask].push(t);
  });
  Object.values(groupMap).forEach(subs => subs.sort((a,b) => (a.stepIndex||0)-(b.stepIndex||0)));

  // Pinned groups (any subtask pinned = whole group pinned)
  const pinnedGroupNames = new Set(
    Object.entries(groupMap)
      .filter(([, subs]) => subs.some(s => s.pinned))
      .map(([gn]) => gn)
  );

  // Score a subtask group by its parent's priority weight ONLY — no age/stale bonuses.
  // Subtasks should stay anchored to their parent's priority level, not float up
  // because individual steps have been sitting in the queue for a long time.
  const scoreGroup = (gn, subs) => {
    const parentTask = unp.find(t => t.text === gn);
    if (parentTask) {
      const p = gP(pris, parentTask.priority);
      return p.weight * 100;  // priority only, no age drift
    }
    // No parent found — use the first subtask's priority
    const p = gP(pris, subs[0]?.priority);
    return (p?.weight || 0) * 100;
  };

  // Parent tasks that have subtask groups should not also appear as standalone items
  const groupParentNames = new Set(Object.keys(groupMap));

  // Scored items: regular unpinned tasks + unpinned groups (as one unit)
  const sc = [
    ...unp.filter(t => !groupParentNames.has(t.text)).map(t => ({type:'task', task:t, _s:scoreTask(t)})),
    ...Object.entries(groupMap)
      .filter(([gn]) => !pinnedGroupNames.has(gn))
      .map(([gn, subs]) => ({type:'group', groupName:gn, subs, _s:scoreGroup(gn, subs)}))
  ];
  sc.sort((a, b) => b._s - a._s);

  // Build final list
  const final = [...pin];
  [...pinnedGroupNames].forEach(gn => final.push(...(groupMap[gn] || [])));
  sc.forEach(item => {
    if (item.type === 'task') final.push(item.task);
    else final.push(...item.subs);
  });

  // Deduplicate by id (safety net)
  const seen = new Set();
  const deduped = final.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });

  return [...beforeShavuosFirst(deduped), ...blocked, ...comp];
}

async function aiOptTasks(tasks, pris, aiOpts) {
  const actv    = tasks.filter(t => !t.completed && !t.blocked);
  const blocked = tasks.filter(t => !t.completed && t.blocked);
  const comp    = tasks.filter(t => t.completed);
  if (!aiOpts || actv.length < 2) return optTasks(tasks, pris);
  // Represent groups as single items (use parent name + first subtask)
  const groupMap = {};
  actv.filter(t => t.parentTask).forEach(t => { if (!groupMap[t.parentTask]) groupMap[t.parentTask] = []; groupMap[t.parentTask].push(t); });
  const standalones = actv.filter(t => !t.parentTask);
  const items = [
    ...standalones,
    ...Object.entries(groupMap).map(([gn, subs]) => ({...subs[0], text: gn, _groupName: gn}))
  ];
  const now2 = Date.now();
  const fmtAge = (t) => { const h = Math.round((now2 - (t.createdAt||now2)) / 3600000); if (h < 1) return 'just added'; if (h < 24) return `${h}h old`; return `${Math.floor(h/24)}d old`; };
  const desc = items.map((t, i) => {
    const age = fmtAge(t);
    const stale = ((now2 - (t.createdAt||now2)) / 86400000) > 2 ? ' ⚠stale' : '';
    const flags = [t.mrsW ? '★mrsW' : null].filter(Boolean).join(' ');
    return `${i+1}. [${gP(pris, t.priority).label}] ${t.text}${t._groupName ? ` (group: ${groupMap[t._groupName].length} steps)` : ''} — ${age}${stale}${flags ? ' '+flags : ''}`;
  }).join('\n');
  const priLabels = pris.filter(p => !p.deleted).sort((a,b) => b.weight-a.weight).map(p => p.label).join(' > ');
  const nowD = new Date();
  const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][nowD.getDay()];
  const timeStr = nowD.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  const job = await runAIJob("task.optimize.basic.v1", {
    dayName,
    timeStr,
    priorityLabels: priLabels,
    tasks: desc,
  }, aiOpts);
  const order = Array.isArray(job?.output) ? job.output : null;
  if (!order) return optTasks(tasks, pris);
  const reorderedItems = order.map(n => items[n-1]).filter(Boolean);
  const seen = new Set();
  const deduped = reorderedItems.filter(t => { if (seen.has(t._groupName || t.id)) return false; seen.add(t._groupName || t.id); return true; });
  const missed = items.filter(t => !seen.has(t._groupName || t.id));
  const finalItems = [...deduped, ...missed];
  // Rebuild full task list: expand groups back to subtasks
  const result = [];
  finalItems.forEach(item => {
    if (item._groupName) result.push(...(groupMap[item._groupName] || []));
    else result.push(item);
  });
  return [...beforeShavuosFirst(result), ...blocked, ...comp];
}

// Smart manual prioritization — returns {optimized, alreadyOptimal, insight, pinOverride}
// Pins are fully respected; AI only reorders unpinned tasks.
// If something unpinned is SO urgent it should jump above pins, AI flags pinOverride.
async function aiOptTasksWithAnalysis(tasks, pris, aiOpts) {
  const actv    = tasks.filter(t => !t.completed && !t.blocked);
  const blocked = tasks.filter(t => !t.completed && t.blocked);
  const comp = tasks.filter(t => t.completed);

  // ── Separate pinned vs unpinned (respects group pinning) ──────────────
  const pinnedGroupNames = new Set(
    actv.filter(t => t.parentTask && t.pinned).map(t => t.parentTask)
  );
  const isPinned = t => (!t.parentTask && t.pinned) || (t.parentTask && pinnedGroupNames.has(t.parentTask));
  const pinnedActv   = actv.filter(t => isPinned(t));
  const unpinnedActv = actv.filter(t => !isPinned(t));

  if (!aiOpts || unpinnedActv.length < 2) {
    return { optimized: optTasks(tasks, pris), alreadyOptimal: true, insight: unpinnedActv.length < 2 ? "Not enough unpinned tasks to reorder." : "", pinOverride: null };
  }

  // ── Build items from unpinned only ────────────────────────────────────
  const groupMap = {};
  unpinnedActv.filter(t => t.parentTask).forEach(t => { if (!groupMap[t.parentTask]) groupMap[t.parentTask] = []; groupMap[t.parentTask].push(t); });
  const standalones = unpinnedActv.filter(t => !t.parentTask);
  const items = [
    ...standalones,
    ...Object.entries(groupMap).map(([gn, subs]) => ({...subs[0], text: gn, _groupName: gn}))
  ];

  const now2 = Date.now();
  const fmtAge = t => { const h = Math.round((now2-(t.createdAt||now2))/3600000); if(h<1)return'just added'; if(h<24)return`${h}h old`; return`${Math.floor(h/24)}d old`; };
  const desc = items.map((t,i) => {
    const age = fmtAge(t);
    const stale = ((now2-(t.createdAt||now2))/86400000) > 2 ? ' ⚠stale' : '';
    const flags = [t.mrsW?'★mrsW':null].filter(Boolean).join(' ');
    return `${i+1}. [${gP(pris,t.priority).label}] ${t.text}${t._groupName?` (group: ${groupMap[t._groupName].length} steps)`:''}  — ${age}${stale}${flags?' '+flags:''}`;
  }).join('\n');

  const pinnedCtx = pinnedActv.length > 0
    ? `\nCurrently PINNED at top (user-locked — do NOT include in "order"):\n${pinnedActv.map(t=>`  • "${t.text}" [${gP(pris,t.priority).label}]`).join('\n')}`
    : '';

  const priLabels = pris.filter(p=>!p.deleted).sort((a,b)=>b.weight-a.weight).map(p=>p.label).join(' > ');
  const nowD = new Date();
  const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][nowD.getDay()];
  const timeStr = nowD.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  const hour = nowD.getHours();
  const energyCtx = hour<12 ? 'morning — quick win first, then deeper work' : hour<15 ? 'early afternoon — meaningful work over admin' : 'late afternoon/evening — favor wrap-up and completable items';

  const job = await runAIJob("task.optimize.analysis.v1", {
    dayName,
    timeStr,
    energyContext: energyCtx,
    pinnedContext: pinnedCtx,
    unpinnedTasks: desc,
    priorityLabels: priLabels,
  }, aiOpts);
  const parsed = job?.output;
  if (!parsed || !Array.isArray(parsed.order)) return { optimized: optTasks(tasks, pris), alreadyOptimal: false, insight: "", pinOverride: null };

  // ── Rebuild unpinned in AI order ───────────────────────────────────────
  const reorderedItems = parsed.order.map(n => items[n-1]).filter(Boolean);
  const seen = new Set();
  const deduped = reorderedItems.filter(t => { if(seen.has(t._groupName||t.id))return false; seen.add(t._groupName||t.id); return true; });
  const missed = items.filter(t => !seen.has(t._groupName||t.id));
  const reorderedUnpinned = [];
  [...deduped, ...missed].forEach(item => {
    if (item._groupName) reorderedUnpinned.push(...(groupMap[item._groupName]||[]));
    else reorderedUnpinned.push(item);
  });

  // Normal result: pinned first, then AI-reordered unpinned, blocked always last
  const optimized = [...beforeShavuosFirst([...pinnedActv, ...reorderedUnpinned]), ...blocked, ...comp];

  // ── Pin override ───────────────────────────────────────────────────────
  let pinOverride = null;
  if (parsed.urgentOverride && pinnedActv.length > 0) {
    const uo = parsed.urgentOverride;
    const overrideItem = items[(uo.taskNumber||0) - 1];
    if (overrideItem) {
      const urgentExpanded = overrideItem._groupName
        ? (groupMap[overrideItem._groupName]||[]).map(t=>({...t, pinned:true}))
        : [{...overrideItem, pinned:true}];
      const urgentIds = new Set(urgentExpanded.map(t=>t.id));
      const remainingUnpinned = reorderedUnpinned.filter(t => !urgentIds.has(t.id));
      pinOverride = {
        taskName: overrideItem._groupName || overrideItem.text,
        reason: uo.reason || "",
        optimizedWithOverride: [...beforeShavuosFirst([...urgentExpanded, ...pinnedActv, ...remainingUnpinned]), ...blocked, ...comp]
      };
    }
  }

  return { optimized, alreadyOptimal: !!parsed.alreadyOptimal, insight: parsed.insight||"", pinOverride };
}

// ─── Auto-aging: nudge stale tasks up one priority tier ─────────────────────
// Thresholds: Eventually → next tier after 14 days; all other non-top tiers after 21 days
// Uses prioritySetAt (when task entered current tier) or createdAt as fallback.
// Returns {tasks, anyChanged}. Only the priority field is changed — so AI reordering
// (which never touches priority fields) cannot undo the promotion.
function applyTaskAging(tasks, pris) {
  const sorted = [...pris].filter(p => !p.deleted).sort((a,b) => b.weight - a.weight);
  if (sorted.length < 2) return { tasks, anyChanged: false };
  const now = Date.now();
  let anyChanged = false;
  const updated = tasks.map(t => {
    if (t.completed || t.pinned || t.snoozedUntil || t.parentTask) return t;
    const priIdx = sorted.findIndex(p => p.id === t.priority);
    if (priIdx <= 0) return t; // already at highest
    const isLowest = priIdx === sorted.length - 1;
    const thresholdMs = (isLowest ? 14 : 21) * 24 * 60 * 60 * 1000;
    const enteredAt = t.prioritySetAt || t.createdAt || now;
    if ((now - enteredAt) >= thresholdMs) {
      anyChanged = true;
      const newPri = sorted[priIdx - 1];
      return {
        ...t,
        priority: newPri.id,
        prioritySetAt: now,
        autoAged: true,
        agedFromPriId: t.agedFromPriId || t.priority,   // original pre-aging id (for undo)
        agedFromLabel: t.agedFromLabel || sorted[priIdx].label, // original label (for display)
      };
    }
    return t;
  });
  return { tasks: updated, anyChanged };
}

// AI first-step suggestion: returns a single crisp action-verb sentence
async function suggestFirstStep(taskText, aiOpts) {
  if (!aiOpts) return null;
  const job = await runAIJob("task.first_step.v1", { taskText }, aiOpts);
  const r = job?.text || "";
  return r ? r.replace(/^["'`]|["'`]$/g, "").trim() : null;
}

// Parse a transcript into individual shailos + answers + askedBy + answeredBy
async function aiParseShailos(text, aiOpts) {
  const job = await runAIJob("shaila.parse.simple.v1", { transcript: text }, aiOpts, { genConfig: { temperature: 0.1 } });
  const items = Array.isArray(job?.output) ? job.output : [];
  if (!items.length) throw new Error("no shailos parsed");
  // Coerce every field to a string before trimming — the model occasionally returns a
  // number/null for a field, and calling .trim() on that used to crash the whole parse.
  const str = v => (v == null ? "" : String(v)).trim();
  return items
    .map(i => ({
      id: uid(),
      shaila: str(i?.shaila),
      answer: str(i?.answer) || null,
      askedBy: str(i?.askedBy) || null,
      answeredBy: str(i?.answeredBy) || null,
    }))
    .filter(i => i.shaila);
}

// Generate new calm color schemes via Gemini
async function aiGenSchemes(aiOpts, existingNames) {
  const job = await runAIJob("settings.color_schemes.v1", { existingNames }, aiOpts);
  const items = Array.isArray(job?.output) ? job.output : [];
  if (!items.length) throw new Error("no schemes generated");
  return items
    .filter(s => s.id && s.name && s.bg && s.text && Array.isArray(s.grad) && s.grad.length === 3)
    .map(ensureSchemeContrast);
}

// Detect embedded answers in existing shaila texts (bulk, single AI call)
async function aiDetectShailaAnswers(shailas, aiOpts) {
  if (!shailas.length) return [];
  const list = shailas.map((s, i) => `${i+1}. [id:${s.id}] ${s.text}`).join("\n");
  const job = await runAIJob("shaila.detect_answers.v1", { shailos: list }, aiOpts, { genConfig: { temperature: 0.1 } });
  return Array.isArray(job?.output) ? job.output.filter(x => x?.id && x?.answer) : [];
}

async function aiParseConversation(transcript, currentTasks, currentShailos, aiOpts) {
  const taskSnap = currentTasks.slice(0,20).map((t,i)=>`${i+1}. [${t.priority}] ${t.text}`).join("\n") || "(none)";
  const shailaSnap = currentShailos.slice(0,15).map((s,i)=>`${i+1}. ${s.synopsis||s.content||"shaila"}`).join("\n") || "(none)";
  const job = await runAIJob("conversation.extract.v1", { transcript, taskSnap, shailaSnap }, aiOpts, { genConfig: { temperature: 0.1, maxOutputTokens: 8192 } });
  if (!job?.output) throw new Error("Could not parse AI response");
  return job.output;
}

const DEFAULT_CALENDAR_TIME_ZONE = "America/New_York";

function dateTimeHasExplicitZone(value) {
  return /(?:z|[+-]\d{2}:?\d{2})$/i.test(String(value || "").trim());
}

function withCalendarEventDefaults(eventBody, defaultTimeZone = DEFAULT_CALENDAR_TIME_ZONE) {
  const event = eventBody && typeof eventBody === "object" ? { ...eventBody } : {};
  delete event.defaultTimeZone;
  delete event.timeZone;
  const applyZone = part => {
    if (!part || typeof part !== "object") return part;
    const next = { ...part };
    if (next.dateTime && !next.timeZone && !dateTimeHasExplicitZone(next.dateTime)) {
      next.timeZone = defaultTimeZone;
    }
    return next;
  };
  return {
    ...event,
    start: applyZone(event.start),
    end: applyZone(event.end),
    reminders: event.reminders || { useDefault: false, overrides: [] },
  };
}

async function aiParseCalendarEvent(description, aiOpts, options = {}) {
  const defaultTimeZone = options.defaultTimeZone || DEFAULT_CALENDAR_TIME_ZONE;
  const today = options.today || new Date().toISOString().slice(0, 10);
  const job = await runAIJob(
    "schedule.parse_event.v1",
    { today, description, defaultTimeZone },
    aiOpts || {},
    { genConfig: { maxOutputTokens: 700 } }
  );
  if (!job?.output) throw new Error("Could not parse event - try rephrasing.");
  return withCalendarEventDefaults(job.output, defaultTimeZone);
}

async function aiParseBrainDump(text, pris, aiOpts) {
  const activePris = pris.filter(p => !p.deleted).sort((a,b) => b.weight-a.weight);
  const priOptions = activePris.map(p => `"${p.id}" = ${p.label}`).join(", ");
  const lowestPri = activePris[activePris.length-1]?.id || "eventually";
  const validIds = new Set(activePris.map(p => p.id));
  const job = await runAIJob("task.parse_brain_dump.v1", { text, priorityOptions: priOptions, lowestPriority: lowestPri }, aiOpts);
  const output = job?.output;
  const taskItems = Array.isArray(output) ? output : (Array.isArray(output?.tasks) ? output.tasks : []);
  const scheduleItems = Array.isArray(output?.scheduleItems) ? output.scheduleItems : [];
  const items = [
    ...taskItems.filter(i => i?.text?.trim()).map(i => ({
      cat: "tasks",
      id: uid(),
      text: i.text.trim(),
      priority: validIds.has(i.priority) ? i.priority : lowestPri
    })),
    ...scheduleItems.filter(i => i?.text?.trim()).map(i => ({
      cat: "scheduleItems",
      id: uid(),
      text: i.text.trim(),
      when: i.when ? String(i.when).trim() : null
    })),
  ];
  if (!items.length) throw new Error("nothing parsed");
  return items;
}


async function aiSummarizeAnswer(answerText, aiOpts) {
  const job = await runAIJob("shaila.answer_summary.v1", { answerText }, aiOpts, { genConfig: { temperature: 0.1, maxOutputTokens: 24 } });
  return job?.text?.trim().replace(/^["'`]+|["'`]+$/g, "") || "";
}

export { firebaseConfig, db, Store, DEF_PRI, DEF_AGE_THRESHOLDS, BEFORE_SHAVUOS_PRIORITY_ID, BEFORE_SHAVUOS_PRIORITY, ensureBeforeShavuosPriority, SCHEMES, PALETTE, PROMPTS, TIPS, YC, cleanYT, uid, canonicalUid, gG, gP, pBg, _lum, textOnColor, ensureSchemeContrast, _priTextMap, priText, textOnPastel, dayKey, tipOfDay, fmtMs, getMrsWPriority, getTaskAgeHours, isTaskAged, callAI, runAIJob, callGemini, callGeminiAudio, optTasks, aiOptTasks, aiOptTasksWithAnalysis, applyTaskAging, suggestFirstStep, aiParseShailos, aiGenSchemes, aiDetectShailaAnswers, aiParseBrainDump, aiParseCalendarEvent, withCalendarEventDefaults, DEFAULT_CALENDAR_TIME_ZONE, aiParseConversation, aiSummarizeAnswer };
