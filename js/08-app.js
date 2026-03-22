// === 08-app.js ===

function App({ user, onSignOut }) {
  Store.setUid(canonicalUid(user));
  // ─── State ───────────────────────────────────────────────────────────────
  const [AS, setAS] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [selPri, setSelPri] = useState(null);
  const [tab, setTab] = useState("focus");
  const [justComp, setJustComp] = useState(false);
  const [showRip, setShowRip] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editTx, setEditTx] = useState("");
  const [zen, setZen] = useState(false);
  const [justOpt, setJustOpt] = useState(false);
  const [showSet, setShowSet] = useState(false);
  const [showLM, setShowLM] = useState(false);
  const [showListMgr, setShowListMgr] = useState(false);
  // tipIdx/dailyTip removed — replaced by carousel (tipViewIdx)
  const [delConf, setDelConf] = useState(null);
  const [navExp, setNavExp] = useState(false);
  const [chgPri, setChgPri] = useState(null);         // task id being re-prioritized
  const [chgPriScope, setChgPriScope] = useState('one'); // 'one' = just this step, 'group' = all siblings
  const [showBulk, setShowBulk] = useState(false);
  const [showBD, setShowBD] = useState(null);
  const [celeb, setCeleb] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [openGroups, setOpenGroups] = useState(new Set());
  const [groupAdding, setGroupAdding] = useState(null);
  const [optLoading, setOptLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [blockedModal, setBlockedModal] = useState(null);
  const [ctxPicker, setCtxPicker] = useState(null);
  const [firstStepModal, setFirstStepModal] = useState(null); // {task, step, loading, edited}
  const [energyModal, setEnergyModal] = useState(false);
  const [showBodyDouble, setShowBodyDouble] = useState(false);
  const [bdMinimized, setBdMinimized] = useState(false);
  const [jsMinimized, setJsMinimized] = useState(false);
  const [showBrainDump, setShowBrainDump] = useState(false);
  const [showShailos, setShowShailos] = useState(false);
  const [justStartId, setJustStartId] = useState(null);
  const [tipCat, setTipCat] = useState("All");
  const [showOverwhelm, setShowOverwhelm] = useState(false);
  const [focusModeActive, setFocusModeActive] = useState(false);
  const [mrsWPriLive, setMrsWPriLive] = useState(null); // live Mrs. W priority
  const [blockedResume, setBlockedResume] = useState(null); // task id to show nudge for
  const [staleNudge, setStaleNudge] = useState(null);       // task object that's been waiting 7+ days
  // Insights tab state
  const [tipViewIdx, setTipViewIdx] = useState(() => tipOfDay(dayKey())); // init to today's daily tip
  const [aiInsight, setAiInsight] = useState(null);       // AI-generated insight string
  const [aiInsightLoading, setAiInsightLoading] = useState(false);
  // AI Chat dialog state
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [aiChatHistory, setAiChatHistory] = useState([]);
  const [aiChatInput, setAiChatInput] = useState("");
  const [aiChatLoading, setAiChatLoading] = useState(false);
  // Queue overflow menu (removed — merged into gear settings modal)
  // Drawer menus on main entry screen
  const [showAides, setShowAides] = useState(false);     // start/sustain aides (body double, just start)
  const [showEntryTools, setShowEntryTools] = useState(false); // task entry tools (bulk, brain dump)
  // Completed post-it stack
  const [postItOpen, setPostItOpen] = useState(false);  // animated stack expanded state
  const [optConfirm, setOptConfirm] = useState(null); // {insight, optimized} — "already optimal" confirmation
  const [showVoice, setShowVoice] = useState(false); // voice input triggered from priority mic
  const [searchQ, setSearchQ] = useState(""); // queue search
  const [qAddPri, setQAddPri] = useState(null); // queue quick-add priority
  const [qAddText, setQAddText] = useState(""); // queue quick-add text
  const [isPrioritizing] = useState(false); // legacy — kept for safety, unused
  const tasksRef = useRef([]);               // always-current tasks for async AI calls
  const asRef    = useRef(null);             // mirror of AS — always current, used by beforeunload flush
  const justLoaded = useRef(false);           // true for one render cycle after initial load — skip auto-save
  const lastSavedModified = useRef(0);       // _lsModified of last save/load — sync comparison baseline
  const adoptedRemote = useRef(false);       // true when onSnapshot adopted remote data — skip next save
  const [zenDumpParsed, setZenDumpParsed] = useState([]);   // AI-parsed brain dump tasks
  const [zenDumpParsing, setZenDumpParsing] = useState(false);
  const [showZenReview, setShowZenReview] = useState(false);
  const [entryEnergy, setEntryEnergy] = useState(null); // energy level for new task: null | "high" | "low"
  const [clockTime, setClockTime] = useState(() => new Date());
  const [queueToast, setQueueToast] = useState(null); // {color, tmr} for "Added to queue" notice
  const [queueToastKey, setQueueToastKey] = useState(0);
  const queueToastTmr = useRef(null);
  const toastTmrRef   = useRef(null);
  const [deletedUndo, setDeletedUndo] = useState(null); // {task, listId} for undo
  const deletedTmr = useRef(null);
  const [parkedUndo, setParkedUndo] = useState(null); // {task, listId} for undo park
  const parkedTmr = useRef(null);
  // ─── New feature state ───────────────────────────────────────────────────
  const [compFlash, setCompFlash] = useState(false);      // brief ✓ overlay on card
  const [showStreak, setShowStreak] = useState(false);    // "On a roll!" celebration
  const [showBlockReflect, setShowBlockReflect] = useState(false); // what's in the way modal
  const [showShailaManager, setShowShailaManager] = useState(false); // shaila log panel
  const [minTick, setMinTick] = useState(0);              // ticks every 60s for snooze auto-wake
  const sessionCompCount = useRef(0);                     // session completions (no re-render needed)
  const [sharedGeminiKey, setSharedGeminiKey] = useState(""); // app-level key from server
  const [fbOffline, setFbOffline] = useState(false);      // Firebase unreachable on load — warn user

  const inRef = useRef(null);
  const edRef = useRef(null);
  const idleTmr = useRef(null);
  const navTmr = useRef(null);
  const priTmr = useRef(null);
  const inputTmr = useRef(null);
  const inter = useRef(false);
  const appRef = useRef(null);
  const saveTmr = useRef(null);
  const autoOptTmr = useRef(null);
  const mrsWTmr = useRef(null);
  const blockedTmr = useRef({});
  const chatEndRef = useRef(null);

  const [ph] = useState(() => PROMPTS[Math.floor(Math.random() * PROMPTS.length)]);

  const defS = {
    lists: [{id:"default", name:"My Tasks", tasks:[]}],
    activeListId: "default",
    priorities: [
      {id:"now",        label:"Now",        color:"#E09AB8", weight:3},
      {id:"today",      label:"Today",      color:"#E0B472", weight:2},
      {id:"eventually", label:"Eventually", color:"#7EB0DE", weight:1},
    ],
    colorScheme: "claude",
    zenEnabled: false,
    geminiKey: "",
    soferaiKey: "",
    completionSound: true,
    overwhelmThreshold: 7,
    ageThresholds: {...DEF_AGE_THRESHOLDS},
    mrsWWindows: {monThu:{start:"08:30",end:"13:00"}, fri:{start:"08:30",end:"10:00"}},
    autoOptimize: false,
    currentEnergy: null, // "high" | "low" | null
  };

  // ─── Load / Save ─────────────────────────────────────────────────────────
  useEffect(() => {
    Store.load().then(s => {
      if (s && s.lists) {
        if (!s.priorities) s.priorities = defS.priorities.map(p=>({...p}));
        if (!s.colorScheme) s.colorScheme = "claude";
        if (s.zenEnabled === undefined) s.zenEnabled = false;
        if (!s.geminiKey) s.geminiKey = "";
        if (!s.soferaiKey) s.soferaiKey = "";
        if (!s.ageThresholds) s.ageThresholds = {...DEF_AGE_THRESHOLDS};
        if (!s.mrsWWindows) s.mrsWWindows = defS.mrsWWindows;
        if (s.completionSound === undefined) s.completionSound = true;
        if (!s.overwhelmThreshold) s.overwhelmThreshold = 7;
        // Mark justLoaded so the save-effect skips the immediate echo-back to Firebase
        justLoaded.current = true;
        lastSavedModified.current = s._lsModified || 0; // baseline for sync comparison
        setAS(s); setLoaded(true); return;
      }
      // If Firebase failed (not just empty), warn the user — their data might be recoverable
      if (Store._fbLoadStatus === 'error') setFbOffline(true);
      
      // USE OFFLINE CACHE ONLY IF FIREBASE IS UNREACHABLE
      const localData = Store.ll();
      if (Store._fbLoadStatus === 'error' && localData && localData.lists && localData.lists.some(l => l.tasks?.length > 0)) {
         console.warn("Firebase was unreachable! Fusing with offline local cache.");
         const fused = {...defS, ...localData, _lsModified: Date.now()};
         lastSavedModified.current = fused._lsModified;
         setAS(fused);
         setLoaded(true);
         return;
      }

      // New account (Firebase confirmed empty) or Firebase offline fallback
      setAS(defS); setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded || !AS) return;
    // Skip the very first save that fires because `loaded` just flipped to true.
    // We just loaded this data FROM Firebase — writing it straight back would risk
    // overwriting data that was externally pushed (e.g. from merge.html) between
    // the time the page started loading and the time Firebase responded.
    if (justLoaded.current) { justLoaded.current = false; return; }
    // Skip saves triggered by adopting remote data (onSnapshot / visibility sync).
    // Without this guard, adopting remote data would stamp a new _lsModified and
    // re-save, causing the other device to adopt, re-stamp, re-save — infinite loop.
    if (adoptedRemote.current) { adoptedRemote.current = false; asRef.current = AS; return; }
    // ── Centralized _lsModified stamping ──
    // Every mutation flows through this effect before reaching Firebase.
    // By stamping here instead of in 30+ individual setAS() calls, no mutation
    // can forget to bump the timestamp — which previously caused settings,
    // list ops, undo, and priority changes to be invisible to cross-device sync.
    const now = Date.now();
    const toSave = { ...AS, _lsModified: now };
    lastSavedModified.current = now;
    asRef.current = toSave;                    // keep ref current for beforeunload flush
    Store.ls(toSave);                          // Refresh optional offline cache
    Store.autoFileBackup(toSave);              // Weekly file backup
    clearTimeout(saveTmr.current);
    saveTmr.current = setTimeout(() => Store.saveToFB(toSave), 1500); // debounced Firebase write
    return () => clearTimeout(saveTmr.current);
  }, [AS, loaded]);

  // (beforeunload/pagehide flushing is consolidated in the effect below with the periodic sync)

  // ─── Shared Gemini key (server-side, used when user has no personal key) ───
  useEffect(() => {
    fetch("/.netlify/functions/app-config")
      .then(r => r.json())
      .then(d => { if (d.geminiKey) setSharedGeminiKey(d.geminiKey); })
      .catch(() => {});
  }, []);


  // ─── Auto-aging: nudge stale tasks up one priority tier on load ─────────────
  useEffect(() => {
    if (!loaded || !pris.length) return;
    // First: undo any auto-aging on subtasks (subtasks should not age independently)
    const origTasks = AS.lists[0]?.tasks || [];
    let subtaskUndone = false;
    const tasksBeforeAging = origTasks.map(t => {
      if (t.parentTask && t.autoAged && t.agedFromPriId) {
        subtaskUndone = true;
        return { ...t, priority: t.agedFromPriId, autoAged: false, agedFromPriId: undefined, agedFromLabel: undefined, prioritySetAt: undefined };
      }
      return t;
    });
    const { tasks: aged, anyChanged } = applyTaskAging(tasksBeforeAging, pris);
    // Only write if something actually changed — subtask de-aging OR regular aging.
    // Without this guard, every page load would create a phantom Firebase save.
    if (!anyChanged && !subtaskUndone) return;
    if (!anyChanged) { uT(() => tasksBeforeAging); return; }
    const count = aged.filter(t => t.autoAged && !origTasks.find(o => o.id===t.id && o.autoAged)).length;
    uT(() => aged);
    if (count > 0) showToast(`↑ ${count} task${count!==1?"s":""} nudged up — been sitting too long`, 8000);
  }, [loaded]); // eslint-disable-line

  // ─── Shaila → Task auto-sync ──────────────────────────────────────────────
  // Checks the shailos collection for pending shailos not yet linked to a task.
  // Creates a task at "shaila" priority for each new one.
  useEffect(() => {
    if (!loaded) return;
    const tasks = AS?.lists?.find(l => l.id === AS.activeListId)?.tasks || [];
    Store.syncShailos(tasks).then(newTasks => {
      if (newTasks.length) {
        uT(ts => [...ts, ...newTasks]);
        showToast(`📋 ${newTasks.length} new shaila${newTasks.length!==1?"s":""} added to your queue`, 6000);
      }
    });
  }, [loaded]); // eslint-disable-line

  // ─── Real-time cross-window sync ─────────────────────────────────────────
  // V5: listens to the tasks COLLECTION + settings doc (per-document changes)
  // V4: listens to the single blob document (legacy fallback)
  useEffect(() => {
    if (!loaded || !db) return;

    if (Store._v5) {
      // V5: per-task collection listener — each task change is surgical
      const unsub = Store._listenV5((newState) => {
        adoptedRemote.current = true;
        lastSavedModified.current = newState._lsModified || Date.now();
        Store.ls(newState);
        setAS(newState);
      });
      return () => unsub();
    }

    // V4 fallback: single-document listener
    const ref = Store.docRef(); if (!ref) return;
    const unsub = ref.onSnapshot(snap => {
      if (!snap.exists) return;
      const fbState = snap.data()?.state;
      if (!fbState) return;
      const fbTs = fbState._lsModified || 0;
      if (fbTs > lastSavedModified.current) {
        adoptedRemote.current = true;
        lastSavedModified.current = fbTs;
        Store._fbLoadedTs = fbTs;
        Store.ls(fbState);
        setAS(fbState);
      }
    }, () => {});
    return () => unsub();
  }, [loaded]); // eslint-disable-line

  // ─── Visibility-change sync ──────────────────────────────────────────────
  // iOS Safari kills WebSocket listeners in the background. Force a server
  // fetch when the app comes back into view. In V5 mode, reload from per-task
  // collections; in V4, from the blob document.
  useEffect(() => {
    if (!loaded || !db) return;
    async function syncFromServer() {
      // V5: collection listener handles reconnection automatically.
      // Do NOT reload from server here — _loadV5() stamps a fresh timestamp
      // that makes empty results look "newer", wiping real data.
      if (Store._v5) return;
      // V4 fallback
      const ref = Store.docRef();
      if (!ref) return;
      try {
        const snap = await ref.get({ source: "server" });
        if (!snap.exists) return;
        const fbState = snap.data()?.state;
        if (!fbState) return;
        const fbTs = fbState._lsModified || 0;
        if (fbTs > lastSavedModified.current) {
          adoptedRemote.current = true;
          lastSavedModified.current = fbTs;
          Store._fbLoadedTs = fbTs;
          Store.ls(fbState);
          setAS(fbState);
        }
      } catch(e) {}
    }
    function onVisibility() {
      if (document.visibilityState === "visible") syncFromServer();
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", syncFromServer);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", syncFromServer);
    };
  }, [loaded]); // eslint-disable-line

  // ─── Tab-close flush + periodic Firebase sync ───────────────────────────
  // beforeunload/pagehide: save to localStorage ONLY — NEVER to Firebase.
  // This is the structural fix for stale-data corruption. Every single data
  // loss incident was caused by a stale tab's beforeunload flushing old data
  // to Firebase. localStorage is safe because it only affects this device.
  // The debounced save (above) and periodic sync (below) handle Firebase writes
  // during normal operation when we have time to do it safely via transaction.
  useEffect(() => {
    if (!loaded) return;
    function flushLocal() {
      const cur = asRef.current;
      if (cur) Store.flushToLocalOnly(cur);
    }
    window.addEventListener("beforeunload", flushLocal);
    window.addEventListener("pagehide", flushLocal);
    // Periodic Firebase sync — catches anything the debounce missed
    // (e.g. user idle for 15s after a change that was debounced then cancelled)
    const iv = setInterval(() => {
      const cur = asRef.current;
      if (cur && (cur._lsModified || 0) > Store._lastSavedFbModified) {
        Store.saveToFB(cur);
      }
    }, 15000);
    return () => {
      window.removeEventListener("beforeunload", flushLocal);
      window.removeEventListener("pagehide", flushLocal);
      clearInterval(iv);
    };
  }, [loaded]);

  // ─── Derived state ───────────────────────────────────────────────────────
  // Effective Gemini key: user's own key takes priority; falls back to shared app key
  const effectiveGK = AS?.geminiKey || sharedGeminiKey;
  const aiOpts = AS ? {provider: AS.aiProvider || 'gemini', geminiKey: effectiveGK, claudeKey: AS.claudeApiKey} : null;
  const hasAI = aiOpts && (aiOpts.provider === 'claude' ? !!aiOpts.claudeKey : !!aiOpts.geminiKey);
  const sc = SCHEMES[AS?.colorScheme] || AS?.customSchemes?.[AS?.colorScheme] || SCHEMES.claude;
  const T = {...sc, shadow:"0 2px 12px rgba(0,0,0,0.06)", shadowLg:"0 6px 24px rgba(0,0,0,0.09)"};
  // Share theme with Shaila sub-app via localStorage
  try { localStorage.setItem('onetask_theme', JSON.stringify(sc)); } catch(e) {}
  const softBorderC = AS?.colorScheme === "midnight" ? "#7A78A8" : "#B8A88E";
  const pris = AS?.priorities || DEF_PRI;
  const aList = AS ? AS.lists.find(l => l.id === AS.activeListId) || AS.lists[0] : null;
  const tasks = aList?.tasks || [];
  tasksRef.current = tasks; // keep ref fresh for async AI calls
  const actT = tasks.filter(t => !t.completed);
  const compT = tasks.filter(t => t.completed);
  const allComp = AS ? AS.lists.flatMap(l => l.tasks.filter(t => t.completed)) : [];
  const ap = pris.filter(p => !p.deleted);

  // Energy-filtered + snooze-filtered queue
  const curEnergy = AS?.currentEnergy;
  const displayedActT = useMemo(() => {
    const now = Date.now();
    const unsnooze = actT.filter(t => !t.snoozedUntil || t.snoozedUntil <= now);
    if (!curEnergy) return unsnooze;
    return unsnooze.filter(t => !t.energy || t.energy === curEnergy);
  }, [actT, curEnergy, minTick]);

  // Overwhelm: focus mode is now OPT-IN (not auto-triggered)
  // C06: subtask groups count as 1 item for effective count
  const parentGroups = [...new Set(actT.filter(t=>t.parentTask).map(t=>t.parentTask))];
  const standaloneCount = actT.filter(t => !t.parentTask).length;
  const effectiveCount = standaloneCount + parentGroups.length; // groups count as 1
  const overwhelmThreshold = AS?.overwhelmThreshold || 7;
  const isOverwhelmed = focusModeActive; // now opt-in only
  const queueT = isOverwhelmed ? displayedActT.slice(0, 3) : displayedActT;
  const snoozedT = useMemo(() => {
    const now = Date.now();
    return actT.filter(t => t.snoozedUntil && t.snoozedUntil > now);
  }, [actT, minTick]);
  // Queue filter: for groups, show only the first subtask as a position marker (rendered as SubtaskGroup)
  const seenGroupsInQueue = new Set();
  const queueTFiltered = queueT.filter(t => {
    if (!t.parentTask) {
      // Regular task: filter by search
      if (!searchQ.trim()) return true;
      return t.text.toLowerCase().includes(searchQ.toLowerCase());
    }
    // Subtask: show only the first one per group (as position marker for SubtaskGroup)
    if (seenGroupsInQueue.has(t.parentTask)) return false;
    // Check if this group matches search
    if (searchQ.trim()) {
      const groupSubs = actT.filter(s => s.parentTask === t.parentTask);
      const matches = t.parentTask.toLowerCase().includes(searchQ.toLowerCase()) ||
                      groupSubs.some(s => s.text.toLowerCase().includes(searchQ.toLowerCase()));
      if (!matches) return false;
    }
    seenGroupsInQueue.add(t.parentTask);
    return true;
  });
  const curT = displayedActT[0] || null;

  // Priority picker: pre-compute whether the task being re-prioritized is a subtask.
  // Kept outside JSX so Babel standalone doesn't have to parse it inside an expression.
  const chgPriTask      = chgPri ? actT.find(t => t.id === chgPri) : null;
  const chgPriIsSubtask = !!chgPriTask?.parentTask;

  // Today's completion count
  const todayCompCount = useMemo(() => {
    const s = new Date(); s.setHours(0,0,0,0);
    return compT.filter(t => t.completedAt && t.completedAt >= s.getTime()).length;
  }, [compT]);

  // ─── Mrs. W live priority refresh (S11) ──────────────────────────────────
  useEffect(() => {
    const refresh = () => setMrsWPriLive(getMrsWPriority(pris, AS?.mrsWWindows));
    refresh();
    mrsWTmr.current = setInterval(refresh, 60000);
    return () => clearInterval(mrsWTmr.current);
  }, [pris, AS?.mrsWWindows]);

  // ─── Clock tick ──────────────────────────────────────────────────────────
  useEffect(() => {
    const iv = setInterval(() => setClockTime(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  // ─── Minute tick (snooze auto-wake) ──────────────────────────────────────
  useEffect(() => {
    const iv = setInterval(() => setMinTick(t => t + 1), 60000);
    return () => clearInterval(iv);
  }, []);

  // ─── One-time shaila restore (via ?restoreShailos=1 URL param) ─────────
  useEffect(() => {
    if (!loaded || !AS) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("restoreShailos") !== "1") return;
    const shailaPri = pris.find(p => p.isShaila)?.id || "shaila";
    const shailaTexts = [
      'Shaila: Mrs. Shapira - 1 Do/should bnei Torah avoid seed oils (cottonseed etc.), which are considered kitniyos in E"Y, for Pesach in America as well?',
      'Shaila: Mrs. Shapira - 2 What is the status of quinoa which has an Ashkenazi hechsher here but not in E"Y?',
      'Shaila: Mrs. Shapira - 3 Is the idea of drinking wine as opposed to grape juice at the Seder because of the chashash that yayin mevushal isn\'t fit for melachim the case?',
      'Shaila: Mrs. Shapira - 4 Would there even be a hiddur in drinking non-mevushal wine as opposed to non-mevushal grape juice?',
      'Shaila: Mrs. Shapira - 5 What about mevushal wine, is there any hiddur in that at all?',
      'Shaila: Mrs. Shapira - 6 Should she cancel the non-mevushal grape juice order and just get regular grape juice instead, or is the issue with her sister\'s Shabbos observance and touching the non-mevushal grape juice not a problem at all for the non-mevushal grape juice?',
      'Shaila: Mrs. Shapira - 7 Can she use eggs in the Pesach "kitchen" (her basement) from her chametz fridge?',
      'Shaila: Mrs. Shapira - 8 Can she use chicken, which is in the plastic package and in a bag (although the bag is not sealed) from her chametz fridge, if she wipes off the package?',
      'Shaila: Uriel Gross. Double oven used simultaneously one kfp one not?',
    ];
    // Only add if not already present (prevent duplicates on re-run)
    const existing = new Set(tasks.map(t => t.text));
    const toAdd = shailaTexts.filter(t => !existing.has(t));
    if (toAdd.length > 0) {
      // Build the new state directly and FORCE immediate save to Firebase.
      // The normal save path uses a 1500ms debounce — too slow for a one-shot
      // restore. A race with onSnapshot could overwrite the shailos before
      // the debounce fires. So we save synchronously here.
      const newTasks = [...tasks, ...toAdd.map(text => ({
        id: uid(), text, priority: shailaPri, completed: false,
        createdAt: Date.now(), weight: 999,
      }))];
      const newAS = { ...AS };
      const li = newAS.lists.findIndex(l => l.id === newAS.activeListId);
      if (li >= 0) newAS.lists[li] = { ...newAS.lists[li], tasks: newTasks };
      newAS._lsModified = Date.now();
      lastSavedModified.current = newAS._lsModified;
      setAS(newAS);
      Store.ls(newAS);
      Store.saveToFB(newAS);  // immediate — no debounce
      console.log("[restoreShailos] Force-saved", toAdd.length, "shailos to Firebase");
    }
    // Remove the URL param so it doesn't re-trigger
    params.delete("restoreShailos");
    const newUrl = params.toString() ? `${window.location.pathname}?${params}` : window.location.pathname;
    window.history.replaceState({}, "", newUrl);
  }, [loaded]);

  // ─── Blocked task resume nudge ────────────────────────────────────────────
  useEffect(() => {
    actT.filter(t => t.blocked && t.blockedUntil).forEach(t => {
      if (blockedTmr.current[t.id]) return; // already scheduled
      const remaining = Math.max(0, t.blockedUntil - Date.now());
      blockedTmr.current[t.id] = setTimeout(() => {
        setBlockedResume(t.id);
        delete blockedTmr.current[t.id];
      }, remaining);
    });
    // Clean up timers for tasks no longer blocked
    Object.keys(blockedTmr.current).forEach(id => {
      if (!actT.find(t => t.id === id && t.blocked)) {
        clearTimeout(blockedTmr.current[id]);
        delete blockedTmr.current[id];
      }
    });
  }, [actT]);

  // ─── Stale task nudge — fires once per session, 3s after load ───────────
  useEffect(() => {
    if (!loaded || !pris.length) return;
    const now = Date.now();
    const WEEK   = 7  * 86400000;
    const RESNOOZE = 3 * 86400000; // don't re-nudge same task for 3 days after "Later"
    const candidate = actT
      .filter(t =>
        !t.completed && !t.blocked && !t.parentTask &&
        (now - (t.createdAt || 0)) > WEEK &&
        (!t.staleNudgedAt || (now - t.staleNudgedAt) > RESNOOZE)
      )
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0]; // oldest first
    if (candidate) {
      const tmr = setTimeout(() => setStaleNudge(candidate), 3000);
      return () => clearTimeout(tmr);
    }
  }, [loaded]); // eslint-disable-line

  // Auto-optimize interval removed — AI prioritizes every 5 events instead

  // ─── Helpers ─────────────────────────────────────────────────────────────
  function uT(fn) { setAS(p => { const activeId = p.lists.find(l => l.id === p.activeListId) ? p.activeListId : p.lists[0]?.id; return {...p, activeListId: activeId, lists: p.lists.map(l => l.id === activeId ? {...l, tasks: fn(l.tasks)} : l)}; }); }
  function doOpt(t) { return optTasks(t, pris); }
  function flashOpt() { setJustOpt(true); setTimeout(() => setJustOpt(false), 800); }
  const zenOn = AS?.zenEnabled === true;

  function showToast(msg, dur=10000, color) {
    clearTimeout(toastTmrRef.current);
    setToast({msg, color});
    toastTmrRef.current = setTimeout(() => setToast(null), dur);
  }
  function dismissToast() {
    clearTimeout(toastTmrRef.current);
    setToast(null);
  }

  // ─── Manual launchpad AI prioritization ──────────────────────────────────
  async function launchpadOptimize() {
    if (!hasAI || optLoading) return;
    setOptLoading(true);
    try {
      const {optimized, alreadyOptimal, insight, pinOverride} = await aiOptTasksWithAnalysis(tasksRef.current, pris, aiOpts);
      if (pinOverride) {
        uT(() => optimized); // apply normal reorder (pins respected) first
        setOptConfirm({kind:"pinOverride", ...pinOverride, normalInsight: insight});
      } else if (alreadyOptimal) {
        setOptConfirm({kind:"optimal", insight, optimized});
      } else {
        uT(() => optimized);
        showToast(insight || "Queue reordered ✦", 3500);
      }
    } catch(e) { showToast("Couldn't reach AI — try again", 2500); }
    setOptLoading(false);
  }

  // ─── Zen brain dump capture ───────────────────────────────────────────────
  async function captureZenDump(text) {
    if (!text.trim()) return;
    const activePris = pris.filter(p=>!p.deleted).sort((a,b)=>a.weight-b.weight);
    const lowestPri = activePris[0]?.id || 'eventually';
    const fallback = () => {
      let lines = text.split('\n').filter(l=>l.trim());
      if (lines.length <= 1) {
        lines = text.split(/(?<=[.!?])\s+|;\s*/).map(l=>l.trim()).filter(Boolean);
        if (lines.length <= 1) lines = [text.trim()];
      }
      setZenDumpParsed(p=>[...p,...lines.map(l=>({id:uid(),text:l,priority:lowestPri}))]);
    };
    if (!hasAI) { fallback(); return; }
    setZenDumpParsing(true);
    try {
      const parsed = await aiParseBrainDump(text, pris, aiOpts);
      if (parsed.length > 0) {
        setZenDumpParsed(p=>[...p,...parsed]);
      } else {
        fallback();
      }
    } catch(e) { fallback(); }
    setZenDumpParsing(false);
  }

  // ─── Priority selector dismiss (B10, B11) ────────────────────────────────
  useEffect(() => {
    if (!selPri) return;
    clearTimeout(priTmr.current);
    priTmr.current = setTimeout(() => { if (!newTask.trim() && !showVoice) setSelPri(null); }, 5000);
    return () => clearTimeout(priTmr.current);
  }, [selPri, newTask, showVoice]);

  // B10/B11 fix: dismiss only on tap outside input area, preserve text
  useEffect(() => {
    if (!selPri) return;
    const h = e => {
      if (showVoiceRef.current) return; // voice panel open — never dismiss via click-outside
      const area = document.querySelector('[data-input-area]');
      if (area && area.contains(e.target)) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      // B11 fix: DON'T erase task text - just close selector
      setSelPri(null);
      // Only clear text if it's truly empty
    };
    const t = setTimeout(() => document.addEventListener('click', h), 100);
    return () => { clearTimeout(t); document.removeEventListener('click', h); };
  }, [selPri]);

  // ─── Zen mode (B6 fix) ───────────────────────────────────────────────────
  const zenOnRef = useRef(zenOn);
  useEffect(() => { zenOnRef.current = zenOn; }, [zenOn]);
  const showVoiceRef = useRef(showVoice);
  useEffect(() => { showVoiceRef.current = showVoice; }, [showVoice]);

  const resetIdle = useCallback(() => {
    clearTimeout(idleTmr.current);
    if (!zenOnRef.current || !curT || zen || tab !== "focus" || showVoiceRef.current) return;
    idleTmr.current = setTimeout(() => {
      setZen(z => {
        if (!z && curT && tab === "focus" && zenOnRef.current && !showVoiceRef.current) return true;
        return z;
      });
    }, 5000);
  }, [curT?.id, zen, tab]);

  useEffect(() => {
    if (zen || tab !== "focus") return;
    const el = appRef.current;
    if (!el) return;
    const f = () => resetIdle();
    el.addEventListener("keydown", f);
    el.addEventListener("touchstart", f);
    el.addEventListener("click", f);
    resetIdle();
    return () => {
      el.removeEventListener("keydown", f);
      el.removeEventListener("touchstart", f);
      el.removeEventListener("click", f);
      clearTimeout(idleTmr.current);
    };
  }, [resetIdle, zen, tab]);

  const pauseZ = () => { inter.current = true; clearTimeout(idleTmr.current); };
  const resumeZ = () => { inter.current = false; resetIdle(); };
  const exitZen = useCallback(() => { setZen(false); setTimeout(resetIdle, 100); }, [resetIdle]);

  // BUG FIX: If zen is active but curT becomes null (last task completed), auto-exit zen
  useEffect(() => { if (zen && !curT) exitZen(); }, [zen, curT?.id]); // eslint-disable-line
  // Show brain dump review when zen exits and there are captured items
  useEffect(() => { if (!zen && (zenDumpParsed.length > 0 || zenDumpParsing)) setShowZenReview(true); }, [zen]); // eslint-disable-line
  const expandNav = () => { clearTimeout(navTmr.current); setNavExp(true); navTmr.current = setTimeout(() => setNavExp(false), 5000); };

  // ─── Task actions ─────────────────────────────────────────────────────────
  function addTask(e) {
    if (e?.preventDefault) e.preventDefault();
    const tx = newTask.trim();
    if (!tx || !selPri) return;
    const newT = {id:uid(), text:tx, completed:false, priority:selPri, createdAt:Date.now()};
    if (entryEnergy) newT.energy = entryEnergy;
    uT(ts => [...ts, newT]);
    setNewTask(""); setSelPri(null); setEntryEnergy(null); flashOpt();
    // Show "Added to queue" toast in priority color
    clearTimeout(queueToastTmr.current);
    const priColor = gP(pris, newT.priority).color;
    setQueueToast(priColor);
    setQueueToastKey(k => k + 1);
    queueToastTmr.current = setTimeout(() => setQueueToast(null), 5000);
  }

  function addVT(text, pri) {
    if (!text.trim()) return;
    uT(ts => [...ts, {id:uid(), text:text.trim(), completed:false, priority:pri, createdAt:Date.now()}]);
    flashOpt();
  }

  function compTask(id, goodEnough=false, isLegacy=false) {
    if (!isLegacy) {
      setJustComp(true); setShowRip(true); setCompFlash(true);
      if (AS?.completionSound) playCompletionSound();
      sessionCompCount.current++;
    }
    const cnt = sessionCompCount.current;
    setTimeout(() => {
      uT(ts => {
        const task = ts.find(t => t.id === id);
        const u = ts.map(t => t.id===id ? {...t, completed:true, completedAt:isLegacy?null:Date.now(), goodEnough} : t);
        if (task?.parentTask) {
          const r = u.filter(t => t.parentTask === task.parentTask && !t.completed);
          if (r.length === 0) { setCeleb(true); setTimeout(() => setCeleb(false), 3000); }
        }
        return u;
      });
      if (!isLegacy) {
        setJustComp(false); setShowRip(false); setCompFlash(false);
        // Show streak celebration every 3 completions in a session
        if (cnt > 0 && cnt % 3 === 0) {
          setShowStreak(true);
          setTimeout(() => setShowStreak(false), 2600);
        }
      }
    }, isLegacy ? 0 : 600);
    // C06: don't setZen(false) here — zen mode stays active, shows next task
  }

  // Good Enough completion (S10)
  function goodEnoughTask(id) { compTask(id, true); }
  function legacyCompTask(id) { compTask(id, false, true); showToast("Logged ✓ (no timestamp)", 2000); }

  function uncompTask(id) { uT(ts => doOpt(ts.map(t => t.id===id ? {...t, completed:false, completedAt:undefined, goodEnough:undefined} : t))); }
  function delTask(id) {
    const task = tasks.find(t => t.id === id);
    uT(ts => ts.filter(t => t.id !== id));
    if (task) {
      clearTimeout(deletedTmr.current);
      setDeletedUndo({task, listId: AS.activeListId});
      deletedTmr.current = setTimeout(() => setDeletedUndo(null), 6000);
    }
  }
  function parkTask(id) {
    const tasks = AS?.lists.find(l=>l.id===AS.activeListId)?.tasks || [];
    const task = tasks.find(t => t.id === id);
    const tom = new Date(); tom.setDate(tom.getDate() + 1); tom.setHours(9, 0, 0, 0);
    uT(ts => ts.map(t => t.id === id ? {...t, snoozedUntil: tom.getTime()} : t));
    if (task) {
      clearTimeout(parkedTmr.current);
      setParkedUndo({task, listId: AS.activeListId});
      parkedTmr.current = setTimeout(() => setParkedUndo(null), 6000);
    }
  }

  function wakeTask(id) {
    uT(ts => ts.map(t => t.id === id ? {...t, snoozedUntil: undefined} : t));
  }

  function saveShailaField(id, field, value) {
    setAS(p => ({...p, lists: p.lists.map(l => ({...l, tasks: l.tasks.map(t => t.id===id ? {...t, [field]: value} : t)}))}));
  }

  function addShailas(items) {
    const shailaPriId = pris.find(p => p.isShaila)?.id || "shaila";
    const newTasks = items.map(item => ({
      id: item.id, text: item.shaila, priority: shailaPriId,
      shailaAnswer: item.answer || "",
      askedBy: item.askedBy || "", answeredBy: item.answeredBy || "",
      createdAt: Date.now(),
      blocked: false, completed: false, energy: null, pinned: false,
    }));
    setAS(p => ({...p, lists: p.lists.map(l =>
      l.id === p.activeListId ? {...l, tasks: [...l.tasks, ...newTasks]} : l
    )}));
    setShowVoice(false);
  }

  // ─── Undo auto-aging on a task ───────────────────────────────────────────
  function undoAging(id) {
    uT(ts => ts.map(t => t.id !== id ? t : {
      ...t, priority: t.agedFromPriId || t.priority,
      autoAged: false, agedFromPriId: undefined, agedFromLabel: undefined, prioritySetAt: undefined
    }));
  }

  // ─── AI first step: open modal, fetch suggestion ─────────────────────────
  async function openFirstStep(task) {
    setFirstStepModal({task, step: null, loading: true, edited: ""});
    try {
      const step = await suggestFirstStep(task.text, aiOpts);
      setFirstStepModal(m => m ? {...m, loading: false, step, edited: step || ""} : null);
    } catch(e) {
      setFirstStepModal(m => m ? {...m, loading: false, step: null, edited: ""} : null);
    }
  }

  // ─── Create the confirmed first step as a Now task ───────────────────────
  function confirmFirstStep() {
    if (!firstStepModal?.edited?.trim()) return;
    const nowPri = [...pris].filter(p=>!p.deleted).sort((a,b)=>b.weight-a.weight)[0];
    if (!nowPri) return;
    uT(ts => [{id:uid(), text:firstStepModal.edited.trim(), priority:nowPri.id, createdAt:Date.now(), prioritySetAt:Date.now(), completed:false}, ...ts]);
    showToast("First step added as Now ✦", 5000);
    setFirstStepModal(null);
  }

  function delGroup(parentTaskName) { uT(ts => ts.filter(t => t.parentTask !== parentTaskName && !(t.text === parentTaskName && ts.some(s => s.parentTask === t.text)))); }
  function cloneTask(t) { uT(ts => doOpt([...ts, {id:uid(), text:t.text, completed:false, priority:t.priority, createdAt:Date.now()}])); flashOpt(); }

  function moveTop(id) {
    uT(ts => {
      const a = ts.filter(t => !t.completed), c = ts.filter(t => t.completed);
      const tg = a.find(t => t.id === id); if (!tg) return ts;
      if (tg.parentTask) {
        // Move whole group to top
        const groupTasks = a.filter(t => t.parentTask === tg.parentTask).map(t => ({...t, pinned:true}));
        const rest = a.filter(t => t.parentTask !== tg.parentTask);
        return [...groupTasks, ...rest, ...c];
      }
      // Check if this task is a group parent (has subtasks)
      const subs = a.filter(t => t.parentTask === tg.text);
      if (subs.length) {
        const rest = a.filter(t => t.id !== id && t.parentTask !== tg.text);
        return [{...tg, pinned:true}, ...subs.map(t=>({...t,pinned:true})), ...rest, ...c];
      }
      const rest = a.filter(t => t.id !== id);
      return [{...tg, pinned:true}, ...rest, ...c];
    });
  }

  function unpinTask(id) { uT(ts => ts.map(t => t.id===id ? {...t, pinned:false} : t)); }

  function handleDrop(tid) {
    if (!dragId || dragId === tid) return;
    uT(ts => {
      const a = ts.filter(t => !t.completed), c = ts.filter(t => t.completed);
      const dragTask = a.find(t => t.id===dragId);
      const dropTask = a.find(t => t.id===tid);
      if (!dragTask || !dropTask) return ts;
      // If dragging a group, move ALL its subtasks together as a block
      const movingIds = dragTask.parentTask
        ? new Set(a.filter(t => t.parentTask===dragTask.parentTask).map(t=>t.id))
        : new Set([dragId]);
      const moving = a.filter(t => movingIds.has(t.id)).map(t=>({...t, pinned:true}));
      // Drop anchor: use the first subtask of drop target's group, or the task itself
      const anchorId = dropTask.parentTask
        ? a.find(t => t.parentTask===dropTask.parentTask)?.id
        : tid;
      const rest = a.filter(t => !movingIds.has(t.id));
      const ai = rest.findIndex(t => t.id===anchorId);
      if (ai < 0) rest.push(...moving);
      else rest.splice(ai, 0, ...moving);
      return [...rest, ...c];
    });
    setDragId(null);
  }

  // Block task — durationMs controls when the "still blocked?" nudge fires
  function blockTask(id, note, durationMs) {
    setBlockedModal(null);
    const now = Date.now();
    uT(ts => {
      const task = ts.find(t => t.id===id); if (!task) return ts;
      const active = ts.filter(t => !t.completed);
      const comp = ts.filter(t => t.completed);
      const others = active.filter(t => t.id !== id);
      const blocked = {...task, blocked:true, blockedAt:now, blockedUntil:now+durationMs, blockedDuration:durationMs, blockedNote:note, priority:task._origPriority||task.priority, _origPriority:task.priority};
      return [...others, blocked, ...comp];
    });
  }

  // Resume blocked task (F8)
  function resumeBlocked(id) {
    setBlockedResume(null);
    uT(ts => doOpt(ts.map(t => t.id===id ? {...t, blocked:false, blockedAt:undefined, blockedNote:undefined, priority:t._origPriority||t.priority, _origPriority:undefined} : t)));
  }

  // Mrs. W task (S11)
  function addMrsWTask(text, pri) {
    if (!text.trim()) return;
    uT(ts => doOpt([...ts, {id:uid(), text:text.trim(), completed:false, priority:pri||mrsWPriLive||"eventually", createdAt:Date.now(), mrsW:true}]));
    flashOpt();
  }

  // AI optimize
  async function manOpt() {
    if (hasAI && actT.length >= 3) {
      setOptLoading(true);
      const optimized = await aiOptTasks(tasks, pris, aiOpts);
      uT(() => optimized);
      setOptLoading(false);
    } else {
      uT(ts => doOpt(ts));
    }
    flashOpt();
  }

  function startEd(t) { setEditId(t.id); setEditTx(t.text); setTimeout(() => edRef.current?.focus(), 50); }
  function saveEd(id) { const tx = editTx.trim(); if (!tx) { setEditId(null); return; } uT(ts => ts.map(t => t.id===id ? {...t, text:tx} : t)); setEditId(null); }
  function chgPriority(tid, np, scope) {
    uT(ts => {
      const task = ts.find(t => t.id === tid);
      if (scope === 'group' && task?.parentTask) {
        // Change all uncompleted siblings to the new priority
        return doOpt(ts.map(t => t.parentTask === task.parentTask && !t.completed ? {...t, priority:np} : t));
      }
      return doOpt(ts.map(t => t.id===tid ? {...t, priority:np} : t));
    });
    setChgPri(null);
    setChgPriScope('one');
  }

  // Park all remaining (uncompleted) steps of a subtask group at the lowest priority.
  // The current step stays as-is; siblings get bumped down so they stop competing.
  function parkRestOfGroup(task) {
    if (!task?.parentTask) return;
    const lowestPri = [...pris].filter(p => !p.deleted).sort((a,b) => a.weight - b.weight)[0]?.id || 'eventually';
    uT(ts => doOpt(ts.map(t =>
      t.parentTask === task.parentTask && !t.completed && t.id !== task.id
        ? {...t, priority: lowestPri}
        : t
    )));
    showToast('Remaining steps parked — get back to them when ready', 3000);
  }
  function addList() { const n = prompt("New list name:"); if (!n?.trim()) return; const id = uid(); setAS(p => ({...p, lists:[...p.lists,{id,name:n.trim(),tasks:[]}], activeListId:id})); }
  function renList(id) { const l = AS.lists.find(x=>x.id===id); if (!l) return; const n = prompt("Rename:", l.name); if (!n?.trim()) return; setAS(p => ({...p, lists:p.lists.map(x=>x.id===id?{...x,name:n.trim()}:x)})); }
  function doDelList(id) { setDelConf(null); if (AS.lists.length<=1) return; setAS(p => { const nl=p.lists.filter(l=>l.id!==id); return {...p,lists:nl,activeListId:p.activeListId===id?nl[0].id:p.activeListId}; }); }
  function switchList(id) { setAS(p => ({...p, activeListId:id})); setShowLM(false); }
  function addPri(label, color) {
    const id="pri_"+uid();
    // Custom priorities rank below Eventually(1) by default — weight 0 so they never outrank builtins
    // unless the user manually drags/edits them up
    const customWeights = pris.filter(p=>!p.deleted&&!["shaila","now","today","eventually"].includes(p.id)&&!p.isShaila).map(p=>p.weight);
    const w = customWeights.length > 0 ? Math.max(...customWeights) - 0.1 : 0.5;
    setAS(p=>({...p,priorities:[...p.priorities,{id,label,color,weight:w}]}));
  }
  function remPri(id) { if(id==="shaila")return; if(ap.length<=1)return; setAS(p=>({...p,priorities:p.priorities.map(x=>x.id===id?{...x,deleted:true}:x)})); }
  function bulkAdd(items) { uT(ts => doOpt([...ts, ...items.map(i=>({id:uid(),text:i.text,completed:false,priority:i.priority,createdAt:Date.now()}))])); setShowBulk(false); flashOpt(); }

  // B12 fix: steps stored with just the step text, parentTask stored separately
  function confirmBD(pt, sts) {
    const pp = showBD?.priority || ap[1]?.id || ap[0]?.id;
    uT(ts => doOpt([
      ...ts.filter(t => showBD?.id ? t.id !== showBD.id : true),
      ...sts.map((text, i) => ({
        id: uid(),
        text: text, // B12: no "Step N of parent:" prefix
        completed: false,
        priority: pp,
        createdAt: Date.now(),
        parentTask: pt,
        stepIndex: i + 1,
        totalSteps: sts.length
      }))
    ]));
    setShowBD(null); flashOpt();
  }

  // Add a single subtask to an existing group (or create a new group on any task)
  function addSubtask(parentTaskName, text, priority) {
    const siblings = actT.filter(t => t.parentTask === parentTaskName);
    const newIdx = siblings.length + 1;
    const pri = priority || siblings[0]?.priority || ap[1]?.id || ap[0]?.id;
    const newSub = { id: uid(), text: text.trim(), completed: false, priority: pri, createdAt: Date.now(), parentTask: parentTaskName, stepIndex: newIdx, totalSteps: newIdx };
    // Update totalSteps on all siblings
    uT(ts => doOpt([...ts.map(t => t.parentTask === parentTaskName ? {...t, totalSteps: newIdx} : t), newSub]));
    flashOpt();
  }

  // Convert a regular task into a crystal group (start manual subtask mode)
  function startManualGroup(task) {
    // Turn task into first crystal, keep same text as parent label
    uT(ts => doOpt(ts.map(t => t.id === task.id ? {...t, parentTask: task.text, stepIndex: 1, totalSteps: 1} : t)));
    flashOpt();
  }

  // Remove duplicate unparented tasks — keeps the first occurrence of each text,
  // drops any later copies. Completed tasks and subtasks are left alone.
  function deduplicateTasks() {
    const current = tasksRef.current || [];
    const seen = new Set();
    const hasDupes = current.some(t => {
      if (t.parentTask || t.completed) return false;
      const k = t.text.trim().toLowerCase();
      if (seen.has(k)) return true;
      seen.add(k);
      return false;
    });
    if (!hasDupes) { showToast("✓ No duplicates found", 3000); return; }

    uT(ts => {
      const seenKeys = new Set();
      let removed = 0;
      const deduped = ts.filter(t => {
        if (t.parentTask || t.completed) return true;
        const k = t.text.trim().toLowerCase();
        if (seenKeys.has(k)) { removed++; return false; }
        seenKeys.add(k);
        return true;
      });
      showToast(`✓ Removed ${removed} duplicate${removed === 1 ? "" : "s"}`, 3000);
      return deduped;
    });
  }

  const metrics = useMemo(() => {
    const c = allComp.filter(t => t.completedAt && t.createdAt);
    if (!c.length) return null;
    const byP = {};
    pris.forEach(p => { byP[p.id] = {ts:[], c:p.color, l:p.label}; });
    let tot = 0;
    c.forEach(t => { const ms = t.completedAt - t.createdAt; tot += ms; if (byP[t.priority]) byP[t.priority].ts.push(ms); });
    const pS = Object.entries(byP).filter(([,v])=>v.ts.length>0).map(([k,v])=>({id:k,l:v.l,c:v.c,n:v.ts.length,a:fmtMs(v.ts.reduce((a,b)=>a+b,0)/v.ts.length)}));
    const byH = {};
    c.forEach(t => { const h = new Date(t.completedAt).getHours(); byH[h]=(byH[h]||0)+1; });
    const bH = Object.entries(byH).sort((a,b)=>b[1]-a[1])[0];
    // B8 fix: midnight = 12:00 AM not 0:00 AM
    const pT = bH ? (parseInt(bH[0])===0?"12:00 AM":parseInt(bH[0])<12?`${bH[0]}:00 AM`:parseInt(bH[0])===12?"12:00 PM":`${parseInt(bH[0])-12}:00 PM`) : null;
    const byD = {};
    c.forEach(t => { const d = new Date(t.completedAt).toLocaleDateString("en-US",{weekday:"long"}); byD[d]=(byD[d]||0)+1; });
    const bD = Object.entries(byD).sort((a,b)=>b[1]-a[1])[0];
    const ds = new Set(c.map(t=>new Date(t.completedAt).toDateString()));
    let sk = 0; const td = new Date();
    for (let i=0; i<365; i++) { const d=new Date(td); d.setDate(d.getDate()-i); if(ds.has(d.toDateString()))sk++;else break; }
    const goodEnoughCount = c.filter(t => t.goodEnough).length;
    return {total:c.length, avg:fmtMs(tot/c.length), pS, bD, pT, sk, cL:c.sort((a,b)=>b.completedAt-a.completedAt), goodEnoughCount};
  }, [allComp, pris]);

  const advice = useMemo(() => {
    if (!metrics) return [];
    const a = [];
    if (metrics.pT) a.push(`Your peak hour is ${metrics.pT} — schedule your hardest tasks then.`);
    if (metrics.bD) a.push(`Best day: ${metrics.bD[0]}s (${metrics.bD[1]} tasks). Try to batch difficult work then.`);
    if (metrics.sk >= 3) a.push(`${metrics.sk}-day streak! That's real momentum.`);
    if (!metrics.sk) a.push("No completions today. Try the 5-minute rule: just start for five minutes.");
    if (metrics.goodEnoughCount > 0) a.push(`${metrics.goodEnoughCount} task${metrics.goodEnoughCount!==1?"s":""} marked "good enough" — that's smart ADHD energy management.`);
    if (!a.length) a.push("Keep going!");
    return a;
  }, [metrics]);

  // dailyTip removed — tipCarouselItem is now the single source of truth
  const dateStr = new Date().toLocaleDateString("en-US", {weekday:"long", month:"long", day:"numeric"});

  const TIP_CATS = ["All", ...new Set(TIPS.map(t => t.cat))];
  const filteredTips = tipCat === "All" ? TIPS : TIPS.filter(t => t.cat === tipCat);

  // Carousel helpers
  const tipCarouselList = filteredTips;
  const tipCarouselIdx = Math.min(tipViewIdx, tipCarouselList.length - 1);
  const tipCarouselItem = tipCarouselList[tipCarouselIdx] || TIPS[0];

  // Reset carousel index when category changes
  useEffect(() => { setTipViewIdx(0); }, [tipCat]);

  // AI insight generator
  const genAiInsight = async () => {
    if (!hasAI || !metrics) return;
    setAiInsightLoading(true);
    setAiInsight(null);
    const recentDone = metrics.cL.slice(0,10).map(t=>t.text).join("; ");
    const priTiers = pris.filter(p=>!p.deleted).sort((a,b)=>b.weight-a.weight).map(p=>p.label).join(" → ");
    const priBreakdownDetailed = metrics.pS.map(p=>`${p.l}: ${p.n} done, avg ${p.a}`).join("; ");
    const prompt = `You are a professional productivity analyst. Analyze this user's task completion data and provide a structured, data-driven summary.

CRITICAL RULES:
- NEVER compare completion times across priority tiers. "Eventually" tasks take longer than "Now" tasks BY DESIGN — different categories entirely. Treat each tier independently.
- Tone: professional and direct. Not critical or judgmental. Not overly enthusiastic or cheerleader-ish. Just clear, honest, useful.
- Surface real patterns from the data. If something is genuinely working well, note it factually.
- Each bullet must reference specific numbers or task names from the data.

Priority tiers (high urgency → low urgency): ${priTiers}
Each tier has fundamentally different expected timeframes — this is by design.

Data:
- Total completed: ${metrics.total} tasks
- Current streak: ${metrics.sk} days
- Peak hour: ${metrics.pT || "unknown"}
- Best day: ${metrics.bD ? metrics.bD[0] : "unknown"} (${metrics.bD ? metrics.bD[1] + " tasks" : ""})
- By priority tier (completed): ${priBreakdownDetailed}
- Overall avg completion time: ${metrics.avg}
- Good enough completions: ${metrics.goodEnoughCount || 0}
- Recent completions: ${recentDone}

REQUIRED OUTPUT FORMAT — use this exact structure, no preamble, no extra text:
• [First observation — a specific pattern grounded in the data]
• [Second observation — a different angle, e.g. timing, energy, or tier consistency]
• [Third observation — something actionable or forward-looking]
TAKEAWAY: [The single most useful thing to know. One sentence. Specific.]`;
    const result = await callAI(prompt, aiOpts);
    setAiInsight(result || "Complete more tasks to generate a personalized insight.");
    setAiInsightLoading(false);
  };

  // AI Chat — ask questions about task data
  const sendAiChat = async (msg) => {
    if (!hasAI || !metrics || !msg.trim()) return;
    const userMsg = msg.trim();
    setAiChatHistory(h => {
      const updated = [...h, {role:"user", text:userMsg}];
      return updated.slice(-60); // Archive limit: keep last 60 messages
    });
    setAiChatInput("");
    setAiChatLoading(true);
    const recentDone = metrics.cL.slice(0,20).map(t => `"${t.text}" (${t.priority}, ${t.completedAt?Math.round((t.completedAt-t.createdAt)/60000)+"min":"?"})`).join("; ");
    const priBreakdown = metrics.pS.map(p=>`${p.l}:${p.n} done, avg ${p.a}`).join("; ");
    const activeBreakdown = actT.map(t => `"${t.text}" [${gP(pris,t.priority).label}]${t.blocked?" BLOCKED":""}${t.pinned?" PINNED":""}`).join("; ");
    const prevChat = aiChatHistory.slice(-6).map(m => `${m.role}: ${m.text}`).join("\n");
    const priTiersChat = pris.filter(p=>!p.deleted).sort((a,b)=>b.weight-a.weight).map(p=>p.label).join(" → ");
    const sysPrompt = `You are a warm, expert ADHD productivity analyst. Give detailed, data-driven answers with specific numbers and patterns — always from a supportive, non-critical perspective.

CRITICAL RULES:
- NEVER compare completion times across priority tiers. "Eventually" tasks take longer than "Now" tasks BY DESIGN — they are a completely different category, like comparing a sprint to a marathon. Treat each tier independently and never present the difference as a problem.
- Never be critical, judgmental, or frame anything as a failure.
- Ground every insight in the user's actual data.
- Priority tiers (high urgency → low): ${priTiersChat}

Data snapshot:
- Total completed: ${metrics.total} tasks
- Active queue: ${actT.length} tasks (${actT.filter(t=>t.pinned).length} pinned, ${actT.filter(t=>t.blocked).length} blocked)
- Current streak: ${metrics.sk} days
- Peak completion hour: ${metrics.pT||"unknown"}
- Best completion day: ${metrics.bD ? metrics.bD[0]+" ("+metrics.bD[1]+" tasks)" : "unknown"}
- Priority breakdown completed: ${priBreakdown}
- Overall avg completion time: ${metrics.avg}
- Good enough completions: ${metrics.goodEnoughCount || 0} of ${metrics.total} (${metrics.total?Math.round((metrics.goodEnoughCount||0)/metrics.total*100):0}%)
- Active tasks: ${activeBreakdown}
- Recent completions: ${recentDone}

${prevChat ? "Previous chat:\n" + prevChat + "\n" : ""}User question: ${userMsg}

Give a thorough, analytical response (4-8 sentences) with specific numbers and actionable insights. No bullet points or headers.`;
    const result = await callAI(sysPrompt, aiOpts);
    setAiChatHistory(h => {
      const updated = [...h, {role:"ai", text:result || "I couldn't analyze that. Try a different question."}];
      return updated.slice(-60);
    });
    setAiChatLoading(false);
  };

  const chatBoxRef = useRef(null);

  // Autoscroll chat to bottom — scrolls the CHAT BOX only, never the page
  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [aiChatHistory, aiChatLoading]);

  // Helper: change tab and close any open menus
  const switchTab = (t) => { setTab(t); setShowLM(false); setNavExp(false); setShowAides(false); setShowEntryTools(false); };

  if (!AS) return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"system-ui",color:"#999"}}>Loading...</div>;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div ref={appRef} style={{height:"100vh",overflow:"hidden",background:`linear-gradient(170deg,${T.grad[0]} 0%,${T.grad[1]} 50%,${T.grad[2]} 100%)`,fontFamily:"Georgia,'Palatino Linotype','Book Antiqua',serif",color:T.text,display:"flex",flexDirection:"column",alignItems:"center"}}>

      {/* Overlays */}
      {zen && curT && <ZenMode task={curT} pris={pris} T={T} onExit={exitZen} onDone={(isl)=>isl?legacyCompTask(curT.id):compTask(curT.id)}
        justStartId={justStartId} curTaskId={curT?.id} onDoneJustStart={()=>setJustStartId(null)} jsMinimized={jsMinimized} onRestoreJs={()=>setJsMinimized(false)}
        showBodyDouble={showBodyDouble} bdMinimized={bdMinimized} onRestoreBd={()=>setBdMinimized(false)} onCloseBd={()=>{setShowBodyDouble(false);setBdMinimized(false);}}
        onCapture={captureZenDump} zenDumpParsing={zenDumpParsing}
        onOpenShailos={()=>setShowShailos(true)}
      />}
      {showZenReview && (
        <ZenDumpReview
          tasks={zenDumpParsed} pris={pris} T={T} parsing={zenDumpParsing}
          onSubmit={(items) => {
            items.forEach(item => uT(ts => [...ts, {id:uid(),text:item.text,priority:item.priority,completed:false,createdAt:Date.now()}]));
            setZenDumpParsed([]); setShowZenReview(false);
          }}
          onDismiss={() => { setZenDumpParsed([]); setShowZenReview(false); }}
        />
      )}
      {celeb && <Confetti colors={ap.map(p=>p.color)}/>}
      {/* Queue "Added" toast — global, shows regardless of active tab */}
      {queueToast && (
        <div key={queueToastKey} style={{position:"fixed",bottom:"clamp(90px,14vh,130px)",left:"50%",transform:"translateX(-50%)",background:queueToast,color:"#fff",borderRadius:20,padding:"6px 16px",fontSize:12,fontWeight:700,fontFamily:"system-ui",whiteSpace:"nowrap",boxShadow:"0 3px 16px rgba(0,0,0,0.22)",animation:"ot-queue-toast 5s ease forwards",pointerEvents:"none",zIndex:9800}}>
          ✦ Added to queue
        </div>
      )}
      {optConfirm && (
        <div style={{position:"fixed",inset:0,zIndex:9900,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.38)"}}>
          <div style={{background:T.card,borderRadius:22,padding:"32px 36px",maxWidth:360,width:"88%",boxShadow:"0 14px 56px rgba(0,0,0,0.28)",textAlign:"center",animation:"ot-fade 0.2s"}}>
            {optConfirm.kind === "pinOverride" ? (
              <>
                <div style={{fontSize:28,marginBottom:14,lineHeight:1}}>📌</div>
                <p style={{fontSize:15,fontWeight:700,color:T.text,margin:"0 0 8px",fontFamily:"system-ui",letterSpacing:.2}}>Override a pin?</p>
                <p style={{fontSize:13,color:T.tSoft,margin:"0 0 6px",fontFamily:"system-ui",lineHeight:1.5}}>AI flagged <strong style={{color:T.text}}>{optConfirm.taskName}</strong> as urgent enough to jump above your pinned tasks.</p>
                <p style={{fontSize:12,color:T.tFaint,margin:"0 0 26px",fontFamily:"system-ui",lineHeight:1.5,fontStyle:"italic"}}>{optConfirm.reason}</p>
                <div style={{display:"flex",gap:10,justifyContent:"center"}}>
                  <button onClick={()=>{uT(()=>optConfirm.optimizedWithOverride);setOptConfirm(null);showToast("Moved above pins ✦",2500);}}
                    style={{padding:"9px 20px",borderRadius:11,border:"none",background:T.text,cursor:"pointer",fontSize:13,fontFamily:"system-ui",color:T.bg||"#fff",fontWeight:700}}>
                    Yes, move above pins
                  </button>
                  <button onClick={()=>setOptConfirm(null)}
                    style={{padding:"9px 20px",borderRadius:11,border:`1px solid ${T.brd}`,background:"none",cursor:"pointer",fontSize:13,fontFamily:"system-ui",color:T.tSoft,fontWeight:500}}>
                    Keep pins
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{fontSize:30,marginBottom:14,lineHeight:1}}>✦</div>
                <p style={{fontSize:15,fontWeight:700,color:T.text,margin:"0 0 10px",fontFamily:"system-ui",letterSpacing:.2}}>Queue already looks sharp</p>
                <p style={{fontSize:13,color:T.tSoft,margin:"0 0 26px",fontFamily:"system-ui",lineHeight:1.6}}>{optConfirm.insight || "The current order is already well-prioritized."}</p>
                <div style={{display:"flex",gap:10,justifyContent:"center"}}>
                  <button onClick={()=>{uT(()=>optConfirm.optimized);setOptConfirm(null);showToast("Reordered anyway ✦",2500);}}
                    style={{padding:"9px 22px",borderRadius:11,border:`1px solid ${T.brd}`,background:"none",cursor:"pointer",fontSize:13,fontFamily:"system-ui",color:T.tSoft,fontWeight:500}}>
                    Reorder anyway
                  </button>
                  <button onClick={()=>setOptConfirm(null)}
                    style={{padding:"9px 24px",borderRadius:11,border:"none",background:T.text,cursor:"pointer",fontSize:13,fontFamily:"system-ui",color:T.bg||"#fff",fontWeight:700}}>
                    Got it
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {firstStepModal && (
        <div style={{position:"fixed",inset:0,zIndex:9900,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.38)"}} onClick={()=>setFirstStepModal(null)}>
          <div onClick={e=>e.stopPropagation()} style={{background:T.card,borderRadius:22,padding:"28px 28px 24px",maxWidth:380,width:"90%",boxShadow:"0 14px 56px rgba(0,0,0,0.28)",animation:"ot-fade 0.2s"}}>
            <div style={{fontSize:22,marginBottom:6,lineHeight:1}}>✦</div>
            <p style={{fontSize:13,fontWeight:700,color:T.text,margin:"0 0 4px",fontFamily:"system-ui",letterSpacing:.2}}>First step</p>
            <p style={{fontSize:12,color:T.tFaint,margin:"0 0 16px",fontFamily:"Georgia,serif",fontStyle:"italic",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{firstStepModal.task.text}</p>
            {firstStepModal.loading ? (
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"12px 0 20px",color:T.tFaint,fontSize:12,fontFamily:"system-ui"}}>
                <div style={{width:14,height:14,borderRadius:"50%",border:`2px solid ${T.tFaint}`,borderTopColor:"transparent",animation:"ot-spin 0.7s linear infinite"}}/>
                Thinking…
              </div>
            ) : (
              <>
                <input
                  autoFocus
                  value={firstStepModal.edited}
                  onChange={e=>setFirstStepModal(m=>({...m,edited:e.target.value}))}
                  onKeyDown={e=>{if(e.key==="Enter")confirmFirstStep();if(e.key==="Escape")setFirstStepModal(null);}}
                  placeholder="Describe the first step…"
                  style={{width:"100%",fontSize:13,fontFamily:"Georgia,serif",border:`1px solid ${T.brd}`,borderRadius:10,padding:"9px 12px",outline:"none",color:T.text,background:T.bgW,boxSizing:"border-box",marginBottom:16}}
                />
                <div style={{display:"flex",gap:10,justifyContent:"center"}}>
                  <button onClick={()=>setFirstStepModal(null)}
                    style={{padding:"9px 20px",borderRadius:11,border:`1px solid ${T.brd}`,background:"none",cursor:"pointer",fontSize:13,fontFamily:"system-ui",color:T.tSoft,fontWeight:500}}>
                    Cancel
                  </button>
                  <button onClick={confirmFirstStep} disabled={!firstStepModal.edited?.trim()}
                    style={{padding:"9px 24px",borderRadius:11,border:"none",background:firstStepModal.edited?.trim()?T.text:"#aaa",cursor:firstStepModal.edited?.trim()?"pointer":"default",fontSize:13,fontFamily:"system-ui",color:T.bg||"#fff",fontWeight:700}}>
                    Create as Now ✦
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {toast && <Toast message={toast.msg} color={toast.color} onDismiss={dismissToast}/>}
      {deletedUndo && (
        <div style={{position:"fixed",bottom:"clamp(55px,9vh,80px)",left:"50%",transform:"translateX(-50%)",background:T.card,border:`1px solid ${T.brd}`,borderRadius:16,padding:"8px 14px",fontSize:12,fontFamily:"system-ui",color:T.tSoft,whiteSpace:"nowrap",boxShadow:T.shadowLg,display:"flex",alignItems:"center",gap:10,zIndex:9800,animation:"ot-fade 0.2s"}}>
          <span style={{color:T.tFaint}}>Task deleted</span>
          <button onClick={()=>{clearTimeout(deletedTmr.current);setAS(p=>({...p,lists:p.lists.map(l=>l.id===deletedUndo.listId?{...l,tasks:[...l.tasks,deletedUndo.task]}:l)}));setDeletedUndo(null);}} style={{background:"none",border:`1px solid ${T.brd}`,borderRadius:8,padding:"3px 10px",cursor:"pointer",fontSize:11,fontWeight:600,color:T.text,fontFamily:"system-ui"}}>Undo</button>
        </div>
      )}
      {parkedUndo && (
        <div style={{position:"fixed",bottom:"clamp(55px,9vh,80px)",left:"50%",transform:"translateX(-50%)",background:T.card,border:`1px solid ${T.brd}`,borderRadius:16,padding:"8px 14px",fontSize:12,fontFamily:"system-ui",color:T.tSoft,whiteSpace:"nowrap",boxShadow:T.shadowLg,display:"flex",alignItems:"center",gap:10,zIndex:9800,animation:"ot-fade 0.2s"}}>
          <span style={{color:T.tFaint}}>☀️ Parked until tomorrow</span>
          <button onClick={()=>{clearTimeout(parkedTmr.current);setAS(p=>({...p,lists:p.lists.map(l=>l.id===parkedUndo.listId?{...l,tasks:l.tasks.map(t=>t.id===parkedUndo.task.id?{...t,snoozedUntil:parkedUndo.task.snoozedUntil}:t)}:l)}));setParkedUndo(null);}} style={{background:"none",border:`1px solid ${T.brd}`,borderRadius:8,padding:"3px 10px",cursor:"pointer",fontSize:11,fontWeight:600,color:T.text,fontFamily:"system-ui"}}>Undo</button>
        </div>
      )}

      {/* Floating drawer menus */}
      {showEntryTools && (
        <div style={{position:"fixed",inset:0,zIndex:8000}} onClick={()=>setShowEntryTools(false)}>
          <div onClick={e=>e.stopPropagation()} style={{position:"absolute",bottom:"clamp(100px,18vh,160px)",left:"50%",transform:"translateX(-50%)",background:T.card,borderRadius:16,border:`1px solid ${T.brd}`,boxShadow:T.shadowLg,padding:8,minWidth:200,animation:"ot-fade 0.15s"}}>
            <button onClick={()=>{setShowBrainDump(true);setShowEntryTools(false);}} style={{width:"100%",padding:"10px 14px",border:"none",background:"transparent",cursor:"pointer",fontSize:12,fontFamily:"system-ui",color:T.tSoft,display:"flex",alignItems:"center",gap:10,borderRadius:10,textAlign:"left"}} onMouseEnter={e=>e.currentTarget.style.background=T.bgW} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <IC.Brain s={13} c={T.tSoft}/> Brain Dump
            </button>
            <button onClick={()=>{setShowBulk(true);setShowEntryTools(false);}} style={{width:"100%",padding:"10px 14px",border:"none",background:"transparent",cursor:"pointer",fontSize:12,fontFamily:"system-ui",color:T.tSoft,display:"flex",alignItems:"center",gap:10,borderRadius:10,textAlign:"left"}} onMouseEnter={e=>e.currentTarget.style.background=T.bgW} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <IC.Plus s={13} c={T.tSoft}/> Bulk Add
            </button>
            <button onClick={()=>{setShowBD(true);setShowEntryTools(false);}} style={{width:"100%",padding:"10px 14px",border:"none",background:"transparent",cursor:"pointer",fontSize:12,fontFamily:"system-ui",color:T.tSoft,display:"flex",alignItems:"center",gap:10,borderRadius:10,textAlign:"left"}} onMouseEnter={e=>e.currentTarget.style.background=T.bgW} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <IC.Split s={13} c={T.tSoft}/> Shatter a task
            </button>
          </div>
        </div>
      )}
      {showAides && (
        <div style={{position:"fixed",inset:0,zIndex:8000}} onClick={()=>setShowAides(false)}>
          <div onClick={e=>e.stopPropagation()} style={{position:"absolute",bottom:"clamp(100px,18vh,160px)",left:"50%",transform:"translateX(-50%)",background:T.card,borderRadius:16,border:`1px solid ${T.brd}`,boxShadow:T.shadowLg,padding:8,minWidth:200,animation:"ot-fade 0.15s"}}>
            <button onClick={()=>{if(curT)setJustStartId(justStartId===curT?.id?null:curT?.id);setShowAides(false);}} disabled={!curT} style={{width:"100%",padding:"10px 14px",border:"none",background:"transparent",cursor:curT?"pointer":"default",fontSize:12,fontFamily:"system-ui",color:curT?T.tSoft:T.tFaint,display:"flex",alignItems:"center",gap:10,borderRadius:10,textAlign:"left",opacity:curT?1:.5}} onMouseEnter={e=>{if(curT)e.currentTarget.style.background=T.bgW;}} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <IC.Timer s={13} c={T.tSoft}/> Just Start (2 min)
            </button>
            <button onClick={()=>{setShowBodyDouble(true);setShowAides(false);}} style={{width:"100%",padding:"10px 14px",border:"none",background:"transparent",cursor:"pointer",fontSize:12,fontFamily:"system-ui",color:T.tSoft,display:"flex",alignItems:"center",gap:10,borderRadius:10,textAlign:"left"}} onMouseEnter={e=>e.currentTarget.style.background=T.bgW} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <IC.Person s={13} c={T.tSoft}/> Body Double
            </button>
            {curT && (
              <button onClick={()=>{setZen(true);setShowAides(false);}} style={{width:"100%",padding:"10px 14px",border:"none",background:"transparent",cursor:"pointer",fontSize:12,fontFamily:"system-ui",color:T.tSoft,display:"flex",alignItems:"center",gap:10,borderRadius:10,textAlign:"left"}} onMouseEnter={e=>e.currentTarget.style.background=T.bgW} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <IC.Moon s={13} c={T.tSoft}/> Enter Zen Mode
              </button>
            )}
            <button onClick={()=>{goodEnoughTask(curT?.id);setShowAides(false);}} disabled={!curT} style={{width:"100%",padding:"10px 14px",border:"none",background:"transparent",cursor:curT?"pointer":"default",fontSize:12,fontFamily:"system-ui",color:curT?T.tSoft:T.tFaint,display:"flex",alignItems:"center",gap:10,borderRadius:10,textAlign:"left",opacity:curT?1:.5}} onMouseEnter={e=>{if(curT)e.currentTarget.style.background=T.bgW;}} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <span style={{fontSize:16,lineHeight:1}}>≈</span> Good Enough
            </button>
            {curT && (
              <button onClick={()=>{setBlockedModal(curT);setShowAides(false);}} style={{width:"100%",padding:"10px 14px",border:"none",background:"transparent",cursor:"pointer",fontSize:12,fontFamily:"system-ui",color:T.tSoft,display:"flex",alignItems:"center",gap:10,borderRadius:10,textAlign:"left"}} onMouseEnter={e=>e.currentTarget.style.background=T.bgW} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <IC.Pause s={13} c={T.tSoft}/> Blocked
              </button>
            )}
            {curT && (
              <button onClick={()=>{setChgPri(curT.id);setShowAides(false);}} style={{width:"100%",padding:"10px 14px",border:"none",background:"transparent",cursor:"pointer",fontSize:12,fontFamily:"system-ui",color:T.tSoft,display:"flex",alignItems:"center",gap:10,borderRadius:10,textAlign:"left"}} onMouseEnter={e=>e.currentTarget.style.background=T.bgW} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <IC.PriC s={13} c={T.tSoft}/> Change Priority
              </button>
            )}
            {curT && (
              <button onClick={()=>{delTask(curT.id);setShowAides(false);}} style={{width:"100%",padding:"10px 14px",border:"none",background:"transparent",cursor:"pointer",fontSize:12,fontFamily:"system-ui",color:"#C94040",display:"flex",alignItems:"center",gap:10,borderRadius:10,textAlign:"left"}} onMouseEnter={e=>e.currentTarget.style.background=T.bgW} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <IC.Trash s={13} c="#C94040"/> Delete Task
              </button>
            )}
          </div>
        </div>
      )}

      {/* Firebase offline warning — shown when Firebase was unreachable on load */}
      {fbOffline && (
        <div style={{position:"fixed",top:0,left:0,right:0,zIndex:10000,background:"#C94040",color:"#fff",padding:"12px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",fontFamily:"system-ui",fontSize:13,gap:12}}>
          <span>⚠️ Could not reach cloud storage — your tasks may still be safe in Firebase. Refresh to retry, or check your connection.</span>
          <button onClick={()=>setFbOffline(false)} style={{padding:"6px 14px",borderRadius:8,background:"rgba(255,255,255,0.2)",border:"1px solid rgba(255,255,255,0.4)",cursor:"pointer",fontSize:12,color:"#fff",flexShrink:0}}>Dismiss</button>
        </div>
      )}


      {/* Modals */}
      {showBulk && <BulkAdd pris={pris} T={T} onAddAll={bulkAdd} onClose={()=>setShowBulk(false)}/>}
      {showBD !== null && <TaskBD task={showBD===true?null:showBD} pris={pris} T={T} onConfirm={confirmBD} onClose={()=>setShowBD(null)} aiOpts={aiOpts}/>}
      {showListMgr && <ListManager AS={AS} setAS={setAS} T={T} onClose={()=>setShowListMgr(false)}/>}
      {showBodyDouble && <BodyDoubleTimer T={T} minimized={bdMinimized} onMinimize={()=>setBdMinimized(true)} onRestore={()=>setBdMinimized(false)} onClose={()=>{setShowBodyDouble(false);setBdMinimized(false);}}/>}
      {/* Floating minimized pills */}
      {justStartId && jsMinimized && (
        <div onClick={()=>setJsMinimized(false)} style={{position:"fixed",bottom:16,right:16,zIndex:9200,background:curT?gP(pris,curT.priority).color:"#7EB0DE",borderRadius:20,padding:"6px 12px",display:"flex",alignItems:"center",gap:6,cursor:"pointer",boxShadow:"0 2px 12px rgba(0,0,0,0.2)",animation:"ot-fade 0.2s"}}>
          <IC.Timer s={12} c="#fff"/>
          <span style={{fontSize:11,color:"#fff",fontFamily:"system-ui",fontWeight:700}}>Just Start</span>
        </div>
      )}
      {/* Voice input — root level so it survives tab switches */}
      {showVoice && selPri && (
        <VoiceInput
          onResult={t=>{addVT(t,selPri);setShowVoice(false);}}
          onClose={()=>setShowVoice(false)}
          onAddShailos={addShailas}
          color={gP(pris,selPri).color}
          T={T}
          soferaiKey={AS.soferaiKey}
          geminiKey={aiOpts?.geminiKey}
        />
      )}
      {showBrainDump && <BrainDump T={T} pris={pris} onCapture={(text)=>{captureZenDump(text);setShowZenReview(true);setShowBrainDump(false);}} onClose={()=>setShowBrainDump(false)}/>}
      {/* Shaila Transcriber — full-screen iframe overlay */}
      {showShailos && (
        <div style={{position:"fixed",inset:0,zIndex:9000,background:T.bg,display:"flex",flexDirection:"column",animation:"ot-fade 0.2s"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px",borderBottom:`1px solid ${T.brd}`,background:T.card,flexShrink:0}}>
            <span style={{fontSize:14,fontWeight:600,color:T.text,fontFamily:"system-ui"}}>Shaila Transcriber</span>
            <button onClick={()=>setShowShailos(false)} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,color:T.tSoft,padding:4}}>✕</button>
          </div>
          <iframe src="/shailos/" style={{flex:1,border:"none",width:"100%"}} title="Shaila Transcriber"/>
        </div>
      )}
      {blockedModal && <BlockedModal task={blockedModal} T={T} pris={pris} onBlock={blockTask} onClose={()=>setBlockedModal(null)}/>}
      {/* Context tags removed */}
      {showSet && <SettingsModal AS={AS} setAS={setAS} T={T} ap={ap} onClose={()=>setShowSet(false)} onSignOut={onSignOut}
        onOptimize={launchpadOptimize} optLoading={optLoading} hasAI={hasAI}
        onBulkAdd={()=>{setShowSet(false);setShowBulk(true);}} onShatter={()=>{setShowSet(false);setShowBD(true);}}
        onDedup={()=>{deduplicateTasks();}}
        curEnergy={curEnergy} onSetEnergy={e=>setAS(p=>({...p,currentEnergy:e}))}
        focusModeActive={focusModeActive} onToggleFocusMode={()=>setFocusModeActive(f=>!f)}
        effectiveCount={effectiveCount} overwhelmThreshold={overwhelmThreshold}
      />}

      {/* Blocked resume nudge */}
      {blockedResume && actT.find(t=>t.id===blockedResume) && (
        <div style={{position:"fixed",bottom:80,left:"50%",transform:"translateX(-50%)",background:T.card,border:`1.5px solid ${T.brd}`,borderRadius:14,padding:"12px 16px",boxShadow:T.shadowLg,zIndex:9500,maxWidth:340,width:"90%",animation:"ot-fade 0.3s"}}>
          <p style={{fontSize:13,fontWeight:600,margin:"0 0 4px",fontFamily:"system-ui"}}>Ready to try again?</p>
          <p style={{fontSize:12,color:T.tSoft,margin:"0 0 10px",fontFamily:"system-ui"}}>{actT.find(t=>t.id===blockedResume)?.text}</p>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>{
              // Snooze: push blockedUntil forward by the same duration originally chosen
              const task = actT.find(t=>t.id===blockedResume);
              const dur = task?.blockedDuration || 3*3600000;
              uT(ts=>ts.map(t=>t.id===blockedResume?{...t,blockedUntil:Date.now()+dur}:t));
              if(blockedTmr.current[blockedResume]){clearTimeout(blockedTmr.current[blockedResume]);delete blockedTmr.current[blockedResume];}
              setBlockedResume(null);
            }} style={{flex:1,padding:"7px",borderRadius:8,border:`1px solid ${T.brd}`,background:"none",cursor:"pointer",fontSize:11,fontFamily:"system-ui",color:T.tSoft}}>Later</button>
            <button onClick={()=>resumeBlocked(blockedResume)} style={{flex:1,padding:"7px",borderRadius:8,border:"none",background:ap[0]?.color,color:textOnColor(ap[0]?.color||"#5A9E7C"),cursor:"pointer",fontSize:11,fontFamily:"system-ui",fontWeight:600}}>Resume</button>
          </div>
        </div>
      )}

      {/* Stale task nudge — fires 3s after load for tasks waiting 7+ days */}
      {staleNudge && actT.find(t => t.id === staleNudge.id) && (
        <div style={{position:"fixed",bottom:80,left:"50%",transform:"translateX(-50%)",background:T.card,border:`1.5px solid ${T.brd}`,borderRadius:14,padding:"14px 16px",boxShadow:T.shadowLg,zIndex:9490,maxWidth:360,width:"90%",animation:"ot-fade 0.3s"}}>
          <p style={{fontSize:11,fontWeight:700,color:T.tFaint,fontFamily:"system-ui",margin:"0 0 3px",textTransform:"uppercase",letterSpacing:.5}}>
            ⏳ Waiting {Math.floor((Date.now()-(staleNudge.createdAt||Date.now()))/86400000)} days
          </p>
          <p style={{fontSize:13,color:T.text,margin:"0 0 10px",fontFamily:"Georgia,serif",lineHeight:1.4}}>{staleNudge.text}</p>
          <p style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",margin:"0 0 10px"}}>Prioritize it now, or break it into smaller steps?</p>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            <button onClick={()=>{
              uT(ts => ts.map(t => t.id===staleNudge.id ? {...t, staleNudgedAt:Date.now()} : t));
              setStaleNudge(null);
            }} style={{flex:1,padding:"7px",borderRadius:8,border:`1px solid ${T.brd}`,background:"none",cursor:"pointer",fontSize:11,fontFamily:"system-ui",color:T.tSoft,minWidth:60}}>Later</button>
            <button onClick={()=>{
              const topPri = [...pris].filter(p=>!p.deleted).sort((a,b)=>b.weight-a.weight)[0];
              if (topPri) chgPriority(staleNudge.id, topPri.id, 'one');
              setStaleNudge(null);
            }} style={{flex:1,padding:"7px",borderRadius:8,border:"none",background:"#C49040",color:"#fff",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"system-ui",minWidth:80}}>Make it Now</button>
            <button onClick={()=>{
              setShowBD(staleNudge);
              setStaleNudge(null);
            }} style={{flex:1,padding:"7px",borderRadius:8,border:`1px solid ${T.brd}`,background:T.bgW,cursor:"pointer",fontSize:11,fontFamily:"system-ui",color:T.text,minWidth:90}}>Break it down</button>
          </div>
        </div>
      )}

      {/* Priority change picker */}
      {chgPri && (
        <div style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,0.3)",display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>{setChgPri(null);setChgPriScope('one');}}>
          <div onClick={e=>e.stopPropagation()} style={{background:T.card,borderRadius:18,padding:"20px 24px",boxShadow:T.shadowLg,maxWidth:320,width:"90%"}}>
            {chgPriIsSubtask && (
              <div style={{display:"flex",gap:6,marginBottom:14,background:T.bg,borderRadius:10,padding:4}}>
                {[{v:'one',label:'This step only'},{v:'group',label:'All remaining steps'}].map(opt => (
                  <button key={opt.v} onClick={()=>setChgPriScope(opt.v)} style={{flex:1,padding:"6px 0",borderRadius:8,border:"none",background:chgPriScope===opt.v?T.card:"transparent",fontWeight:chgPriScope===opt.v?700:400,color:chgPriScope===opt.v?T.text:T.tFaint,fontSize:11,cursor:"pointer",fontFamily:"system-ui",boxShadow:chgPriScope===opt.v?"0 1px 4px rgba(0,0,0,0.1)":"none"}}>
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
            <p style={{fontSize:13,fontWeight:600,margin:"0 0 14px",fontFamily:"system-ui"}}>
              {chgPriIsSubtask && chgPriScope==='group' ? 'Change all remaining steps:' : 'Change priority:'}
            </p>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              {ap.map(p => (
                <button key={p.id} onClick={()=>chgPriority(chgPri,p.id,chgPriIsSubtask?chgPriScope:'one')} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 14px",borderRadius:10,border:`2px solid ${p.color}`,background:pBg(p.color),cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"system-ui",color:T.text}}>
                  <div style={{width:12,height:12,borderRadius:"50%",background:p.color}}/>{p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {delConf && (
        <div style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setDelConf(null)}>
          <div onClick={e=>e.stopPropagation()} style={{background:T.card,borderRadius:22,padding:"32px 28px",maxWidth:340,textAlign:"center",boxShadow:T.shadowLg}}>
            <h3 style={{margin:"0 0 12px",fontSize:18,fontWeight:500}}>Delete list?</h3>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setDelConf(null)} style={{flex:1,padding:12,borderRadius:12,border:`1px solid ${T.brd}`,background:T.card,cursor:"pointer",fontFamily:"system-ui",fontSize:13,fontWeight:600,color:T.tSoft}}>Cancel</button>
              <button onClick={()=>doDelList(delConf)} style={{flex:1,padding:12,borderRadius:12,border:"none",background:"#E07070",color:"#fff",cursor:"pointer",fontFamily:"system-ui",fontSize:13,fontWeight:600}}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Streak celebration overlay */}
      {showStreak && (
        <div style={{position:"fixed",top:"50%",left:"50%",zIndex:9990,pointerEvents:"none",animation:"ot-streak 2.6s forwards",textAlign:"center",fontFamily:"system-ui"}}>
          <div style={{fontSize:48,marginBottom:6}}>🔥</div>
          <div style={{fontSize:20,fontWeight:700,color:T.text,textShadow:"0 2px 12px rgba(0,0,0,0.12)"}}>On a roll!</div>
          <div style={{fontSize:13,color:T.tSoft,marginTop:4}}>{todayCompCount} done today</div>
        </div>
      )}

      {/* BlockReflectModal */}
      {showBlockReflect && curT && (
        <BlockReflectModal task={curT} T={T} aiOpts={aiOpts} onClose={()=>setShowBlockReflect(false)}/>
      )}

      {/* ShailaManager */}
      {showShailaManager && (
        <ShailaManager AS={AS} T={T} aiOpts={aiOpts} onSaveField={saveShailaField} onClose={()=>setShowShailaManager(false)}/>
      )}

      {/* Noise texture */}
      <div style={{position:"fixed",inset:0,pointerEvents:"none",opacity:.025,backgroundImage:`url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`}}/>

      <div style={{width:"100%",maxWidth:"min(800px, 95vw)",padding:"0 clamp(16px,3vw,32px)",position:"relative",zIndex:1,height:"100vh",overflowY:tab==="focus"?"hidden":"auto",display:"flex",flexDirection:"column"}}>

        {/* ===== FOCUS TAB ===== */}
        {tab === "focus" && (
          <div style={{animation:"ot-fade 0.3s",display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",overflow:"hidden"}}>

            {/* ── Center spine ── */}
            <div style={{display:"flex",flexDirection:"column",alignItems:"stretch",gap:"clamp(18px,3.5vh,36px)",width:"min(88vw,500px)"}}>

              {/* ── Above-card row: clock (left) + done checkmark (right) ── */}
              {curT ? (() => {
                const cp0 = gP(pris, curT.priority);
                const cardColor0 = cp0.isShaila ? "#2ECC71" : cp0.color;
                const CK = 28;
                return (
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",padding:"0 2px",height:CK}}>
                    <div style={{display:"flex",alignItems:"baseline",gap:10}}>
                      <span style={{fontSize:CK,fontFamily:"system-ui",fontWeight:300,color:T.tSoft,letterSpacing:3,lineHeight:1,display:"block"}}>
                        {clockTime.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}
                      </span>
                      {todayCompCount > 0 && <span style={{fontSize:11,fontFamily:"system-ui",fontWeight:600,color:T.tFaint,letterSpacing:.3}}>✓ {todayCompCount} today</span>}
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:4}}>
                      {AS.legacyCompleteUI && <button onClick={()=>legacyCompTask(curT.id)} title="Legacy complete (no timestamp)" style={{background:"none",border:"none",cursor:"pointer",padding:0,display:"flex",alignItems:"center",justifyContent:"center",width:CK,height:CK,opacity:.35,transition:"opacity 0.2s"}} onMouseEnter={e=>e.currentTarget.style.opacity=0.9} onMouseLeave={e=>e.currentTarget.style.opacity=.35}><IC.Clock s={CK-4} c={cardColor0}/></button>}
                      <button onClick={()=>compTask(curT.id)} title="Done" style={{background:"none",border:"none",cursor:"pointer",padding:0,display:"flex",alignItems:"center",justifyContent:"center",width:CK,height:CK,opacity:.55,transition:"opacity 0.2s"}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.55}>
                        <IC.Check s={CK} c={cardColor0}/>
                      </button>
                    </div>
                  </div>
                );
              })() : (
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",padding:"0 2px",height:28}}>
                  <span style={{fontSize:28,fontFamily:"system-ui",fontWeight:300,color:T.tSoft,letterSpacing:3,lineHeight:1,display:"block"}}>
                    {clockTime.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}
                  </span>
                  <div style={{width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center",opacity:.3}}><IC.Check s={28} c={T.brdS}/></div>
                </div>
              )}

              {/* Task card */}
              {curT ? (() => {
                const cp = gP(pris, curT.priority);
                const cardColor = cp.isShaila ? "#2ECC71" : cp.color;
                const _fc = textOnColor(cardColor);
                const _fc50 = _lum(cardColor) > 0.35 ? "rgba(45,37,32,0.50)" : "rgba(255,255,255,0.55)";
                const _fc40 = _lum(cardColor) > 0.35 ? "rgba(45,37,32,0.45)" : "rgba(255,255,255,0.45)";
                const _fcBg = _lum(cardColor) > 0.35 ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.18)";
                const _fcBgH = _lum(cardColor) > 0.35 ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.25)";
                const _fcBgL = _lum(cardColor) > 0.35 ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.12)";
                const _fcBrd = _lum(cardColor) > 0.35 ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.4)";
                const _fc70 = _lum(cardColor) > 0.35 ? "rgba(45,37,32,0.65)" : "rgba(255,255,255,0.7)";
                const _fc60 = _lum(cardColor) > 0.35 ? "rgba(45,37,32,0.55)" : "rgba(255,255,255,0.6)";
                return (
                  <>
                    {/* Card — full column width */}
                    <div style={{background:cardColor,borderRadius:"clamp(22px,4vw,32px)",padding:"clamp(28px,5vh,56px) clamp(24px,4vw,48px)",width:"100%",minHeight:"clamp(130px,20vh,260px)",textAlign:"center",boxShadow:`0 12px 50px ${cardColor}35`,transition:"all 0.4s",transform:justComp?"scale(0.94)":"scale(1)",opacity:justComp?.3:1,animation:"ot-fade 0.5s",position:"relative",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",overflow:"hidden",gap:8}}>
                      {showRip && <Ripple color={_fc}/>}
                      {/* Completion flash overlay */}
                      {compFlash && <div style={{position:"absolute",inset:0,borderRadius:"inherit",display:"flex",alignItems:"center",justifyContent:"center",zIndex:10,animation:"ot-comp-flash 0.6s forwards",pointerEvents:"none",background:cardColor}}><span style={{fontSize:72,color:_fc,lineHeight:1}}>✓</span></div>}
                      <span style={{fontSize:11,color:_fc50,fontFamily:"system-ui",fontWeight:700,letterSpacing:1.5,textTransform:"uppercase"}}>{cp.label}</span>
                      {curT.mrsW && <span style={{fontSize:11,color:_fc40,fontFamily:"system-ui",fontWeight:600,letterSpacing:.5}}>Mrs. W</span>}
                      {editId === curT.id ? (
                        <div style={{display:"flex",gap:8,width:"100%"}} onFocus={pauseZ} onBlur={resumeZ}>
                          <input ref={edRef} value={editTx} onChange={e=>setEditTx(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveEd(curT.id);if(e.key==="Escape")setEditId(null);}} style={{flex:1,fontSize:"clamp(16px,3vw,22px)",fontFamily:"Georgia,serif",border:`2px solid ${_fcBrd}`,borderRadius:14,padding:"10px 16px",outline:"none",color:_fc,background:_fcBgL}}/>
                          <button onClick={()=>saveEd(curT.id)} style={{background:_fcBg,color:_fc,border:"none",borderRadius:14,padding:"10px 18px",cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"system-ui"}}>Save</button>
                        </div>
                      ) : (
                        <div onClick={()=>startEd(curT)} style={{cursor:"text",maxHeight:"100%",overflow:"hidden",width:"100%"}}>
                          <AutoFitText text={curT.text} maxSize={Math.min(48,window.innerWidth*0.08)} minSize={16} color={_fc} style={{maxHeight:"clamp(70px,18vh,200px)"}}/>
                          {curT.parentTask && <p style={{fontSize:"clamp(10px,1.5vw,13px)",color:_fc50,marginTop:8,fontFamily:"system-ui"}}>Step {curT.stepIndex||1} of {curT.totalSteps||"?"} of {curT.parentTask}</p>}
                          {curT.blockedNote && <p style={{fontSize:10,color:_fc40,marginTop:4,fontFamily:"system-ui",fontStyle:"italic"}}>Blocked: {curT.blockedNote}</p>}
                          {(() => {
                            if (!curT.createdAt) return null;
                            const d = Math.floor(getTaskAgeHours(curT) / 24);
                            if (d < 1) return null;
                            return <p style={{fontSize:10,color:_fc40,marginTop:4,fontFamily:"system-ui",fontWeight:500,letterSpacing:.3}}>{d === 1 ? "since yesterday" : `${d} days waiting`}</p>;
                          })()}
                        </div>
                      )}
                    </div>

                    {/* Just Start timer if active */}
                    {justStartId === curT.id && !jsMinimized && <div style={{width:"100%"}}><JustStartTimer color={cp.color} T={T} onMinimize={()=>setJsMinimized(true)} onDone={()=>{setJustStartId(null);setJsMinimized(false);}}/></div>}

                    {/* Park + Reflect quick-action row */}
                    <div style={{display:"flex",gap:8,justifyContent:"center",width:"100%"}}>
                      <button onClick={()=>parkTask(curT.id)}
                        style={{flex:1,padding:"7px 0",fontSize:11,fontFamily:"system-ui",fontWeight:600,color:T.tFaint,background:"none",border:`1px solid ${T.brd}`,borderRadius:10,cursor:"pointer",letterSpacing:.3,transition:"all 0.15s"}}
                        onMouseEnter={e=>{e.currentTarget.style.borderColor=T.brdS;e.currentTarget.style.color=T.tSoft;}}
                        onMouseLeave={e=>{e.currentTarget.style.borderColor=T.brd;e.currentTarget.style.color=T.tFaint;}}>
                        💤 Park til tomorrow
                      </button>
                      {getTaskAgeHours(curT) >= 72 && (
                        <button onClick={()=>setShowBlockReflect(true)}
                          style={{flex:1,padding:"7px 0",fontSize:11,fontFamily:"system-ui",fontWeight:600,color:T.tFaint,background:"none",border:`1px solid ${T.brd}`,borderRadius:10,cursor:"pointer",letterSpacing:.3,transition:"all 0.15s"}}
                          onMouseEnter={e=>{e.currentTarget.style.borderColor=T.brdS;e.currentTarget.style.color=T.tSoft;}}
                          onMouseLeave={e=>{e.currentTarget.style.borderColor=T.brd;e.currentTarget.style.color=T.tFaint;}}>
                          🔍 What's in the way?
                        </button>
                      )}
                    </div>
                  </>
                );
              })() : (
                <div style={{width:"100%",textAlign:"center",animation:"ot-fade 0.4s",padding:"clamp(24px,5vh,48px) 0"}}>
                  <div style={{width:52,height:52,borderRadius:"50%",background:pBg("#9EBD8A"),display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px",opacity:.6}}><IC.Check s={22} c="#9EBD8A"/></div>
                  <p style={{color:T.tSoft,fontSize:"clamp(13px,2vw,16px)",margin:0}}>{compT.length>0?"All clear.":"Add your first task."}</p>
                </div>
              )}

              {/* Priority circles — full column width, evenly spaced, dismiss on outside click */}
              <div style={{width:"100%",display:"flex",flexDirection:"column",alignItems:"center",gap:"clamp(10px,2vh,20px)",paddingTop:"clamp(12px,2.5vh,28px)"}} onFocus={pauseZ} onBlur={resumeZ}
                ref={el=>{
                  if(!el)return;
                  el._outsideHandler=el._outsideHandler||((e)=>{if(selPri&&!el.contains(e.target)&&!e.target.closest('[data-voice-panel]')){setSelPri(null);setNewTask("");}});
                  document.removeEventListener("mousedown",el._outsideHandler);
                  document.addEventListener("mousedown",el._outsideHandler);
                }}>

                {/* Main circle row — Shaila + built-in priorities */}
                <div style={{display:"flex",justifyContent:"space-around",alignItems:"flex-end",width:"100%",paddingTop:4}}>
                  {ap.filter(p=>p.isShaila||["now","today","eventually"].includes(p.id)).map(p=>{
                    const a = selPri===p.id;
                    const shailaGreen="#2ECC71";
                    const clr = p.isShaila ? shailaGreen : p.color;
                    const sz = a ? "clamp(82px,13vw,104px)" : "clamp(70px,11vw,90px)";
                    return (
                      <div key={p.id} style={{display:"flex",flexDirection:"column",alignItems:"center"}}
                        onMouseEnter={e=>{const m=e.currentTarget.querySelector(".mic-btn");if(m)m.style.opacity=1;}}
                        onMouseLeave={e=>{const m=e.currentTarget.querySelector(".mic-btn");if(m)m.style.opacity=a?1:0;}}>
                        <button className="mic-btn" onClick={()=>{setSelPri(p.id);setShowVoice(true);}} title="Voice input" style={{width:30,height:30,borderRadius:"50%",background:clr,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",opacity:a?1:0,transition:"opacity 0.2s",marginBottom:8,flexShrink:0}}><IC.Mic s={13} c="#fff"/></button>
                        <button onClick={()=>setSelPri(a?null:p.id)} title={p.label} style={{width:sz,height:sz,borderRadius:"50%",background:clr,border:a?`3px solid ${softBorderC}`:"3px solid transparent",cursor:"pointer",transition:"all 0.25s",boxShadow:p.isShaila?(a?`0 0 28px ${shailaGreen}90,0 0 56px ${shailaGreen}40`:`0 0 16px ${shailaGreen}65,0 0 32px ${shailaGreen}30`):(a?`0 6px 28px ${clr}65`:`0 3px 12px ${clr}35`),flexShrink:0}}/>
                        <span style={{fontSize:12,color:T.tFaint,fontFamily:"system-ui",fontWeight:600,textAlign:"center",marginTop:10,letterSpacing:.3}}>{p.isShaila?"Shaila":p.label}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Custom priorities row — sorted by weight desc, smaller circles, below builtins */}
                {ap.filter(p=>!p.isShaila&&!["now","today","eventually"].includes(p.id)).length>0 && (
                  <div style={{display:"flex",justifyContent:"center",gap:"clamp(16px,3vw,28px)",alignItems:"flex-end",width:"100%",paddingTop:2,opacity:.85}}>
                    {[...ap.filter(p=>!p.isShaila&&!["now","today","eventually"].includes(p.id))].sort((a,b)=>b.weight-a.weight).map(p=>{
                      const a = selPri===p.id;
                      return (
                        <div key={p.id} style={{display:"flex",flexDirection:"column",alignItems:"center"}}
                          onMouseEnter={e=>{const m=e.currentTarget.querySelector(".mic-btn");if(m)m.style.opacity=1;}}
                          onMouseLeave={e=>{const m=e.currentTarget.querySelector(".mic-btn");if(m)m.style.opacity=a?1:0;}}>
                          <button className="mic-btn" onClick={()=>{setSelPri(p.id);setShowVoice(true);}} title="Voice input" style={{width:22,height:22,borderRadius:"50%",background:p.color,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",opacity:a?1:0,transition:"opacity 0.2s",marginBottom:6,flexShrink:0}}><IC.Mic s={10} c="#fff"/></button>
                          <button onClick={()=>setSelPri(a?null:p.id)} title={p.label} style={{width:a?"clamp(40px,6vw,52px)":"clamp(32px,5vw,44px)",height:a?"clamp(40px,6vw,52px)":"clamp(32px,5vw,44px)",borderRadius:"50%",background:p.color,border:a?`2px solid ${softBorderC}`:"2px solid transparent",cursor:"pointer",transition:"all 0.2s",boxShadow:a?`0 4px 16px ${p.color}60`:`0 2px 8px ${p.color}25`,flexShrink:0}}/>
                          <span style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui",fontWeight:600,textAlign:"center",marginTop:7,letterSpacing:.3}}>{p.label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}


                {/* Text input — full column width */}
                {selPri && (
                  <div data-input-area="true" style={{width:"100%",animation:"ot-fade 0.2s"}}>
                    <form onSubmit={addTask} style={{display:"flex",gap:8,alignItems:"flex-end"}}>
                      <textarea ref={inRef} value={newTask} onChange={e=>{setNewTask(e.target.value);e.target.style.height="auto";e.target.style.height=Math.min(e.target.scrollHeight,120)+"px";}} placeholder={selPri==="shaila"?"Who + what shaila?":ph} autoFocus onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();addTask(e);}if(e.key==="Escape"){setSelPri(null);setNewTask("");}}} rows={1} style={{flex:1,padding:"clamp(10px,1.5vw,14px) clamp(12px,2vw,18px)",fontSize:"clamp(14px,2vw,16px)",border:`2px solid ${gP(pris,selPri).color}`,borderRadius:14,outline:"none",background:T.card,color:T.text,fontFamily:"Georgia,serif",resize:"none",overflow:"hidden",minHeight:44,lineHeight:1.4}}/>
                      <button type="button" onClick={()=>setEntryEnergy(e=>e===null?"high":e==="high"?"low":null)} title={entryEnergy?`Energy: ${entryEnergy}`:"Set energy"} style={{width:44,height:44,borderRadius:14,border:`1.5px solid ${entryEnergy?"#E07040":T.brd}`,background:entryEnergy==="high"?"#E0704018":entryEnergy==="low"?"#7EB0DE18":T.bgW,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,transition:"all 0.2s"}}>
                        {entryEnergy==="high"?"⚡":entryEnergy==="low"?"🌊":"·"}
                      </button>
                      <button type="button" onClick={addTask} style={{background:gP(pris,selPri).color,border:"none",borderRadius:14,width:44,height:44,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}><IC.Plus s={16} c={textOnColor(gP(pris,selPri).color)}/></button>
                    </form>
                    {newTask.trim().length>3 && (
                      <button onClick={()=>{const txt=newTask.trim();if(!txt)return;setNewTask("");setSelPri(null);setShowBD({id:"__new__",text:txt,priority:selPri});}} style={{marginTop:6,width:"100%",padding:"6px 0",fontSize:11,fontFamily:"system-ui",fontWeight:700,color:priText(gP(pris,selPri).color),background:"none",border:`1px dashed ${gP(pris,selPri).color}60`,borderRadius:10,cursor:"pointer",letterSpacing:.5,opacity:.85}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.75}>
                        ✦ Shatter into crystals
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>{/* end spine */}

            {/* ── Side columns — shared helper + symmetric top/bottom groups ── */}
            {(()=>{
              // pin range: top of clock row → bottom of circles
              // spine height ≈ 28(clock)+gap+card+gap+circles+gap+customrow ≈ 420px centered
              const PIN_TOP = "calc(50vh - 210px)";
              const PIN_BOT = "calc(50vh - 210px)";
              const EDGE = "clamp(14px,2.5vw,28px)";

              const mkIcon = (item, i) => {
                if (!item || item === "sep") return <div key={i} style={{width:20,height:1,background:T.brdS,alignSelf:"center",flexShrink:0,margin:"2px 0"}}/>;
                if (item.icon === "zen-toggle") return (
                  <div key={i} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1,opacity:.5,transition:"opacity 0.15s",cursor:"pointer"}}
                    onClick={()=>setAS(p=>({...p,zenEnabled:!p.zenEnabled}))}
                    onMouseEnter={e=>{e.currentTarget.style.opacity=1;const l=e.currentTarget.querySelector(".sl2");if(l)l.style.opacity=1;}}
                    onMouseLeave={e=>{e.currentTarget.style.opacity=.5;const l=e.currentTarget.querySelector(".sl2");if(l)l.style.opacity=0;}}>
                    <div style={{width:34,height:34,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
                      <IC.Moon s={16} c={T.tSoft}/>
                      {zenOn  && <svg width={12} height={12} viewBox="0 0 13 13" style={{position:"absolute",bottom:2,right:2}}><circle cx={6.5} cy={6.5} r={6} fill="#2ECC71"/><polyline points="3,6.5 5.5,9 10,4" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      {!zenOn && <svg width={12} height={12} viewBox="0 0 13 13" style={{position:"absolute",bottom:2,right:2}}><circle cx={6.5} cy={6.5} r={5.5} fill={T.bgW} stroke="#B06060" strokeWidth={1.5}/><line x1={3} y1={10} x2={10} y2={3} stroke="#B06060" strokeWidth={1.5} strokeLinecap="round"/></svg>}
                    </div>
                    <span className="sl2" style={{fontSize:8,fontFamily:"system-ui",color:T.tFaint,opacity:0,transition:"opacity 0.15s",whiteSpace:"nowrap"}}>{zenOn?"Auto-zen on":"Auto-zen off"}</span>
                  </div>
                );
                return (
                  <div key={i} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1,opacity:.5,transition:"opacity 0.15s",cursor:"pointer"}}
                    onClick={item.action}
                    onMouseEnter={e=>{e.currentTarget.style.opacity=1;const l=e.currentTarget.querySelector(".sl2");if(l)l.style.opacity=1;}}
                    onMouseLeave={e=>{e.currentTarget.style.opacity=.5;const l=e.currentTarget.querySelector(".sl2");if(l)l.style.opacity=0;}}>
                    <div style={{width:34,height:34,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center"}}>{item.icon}</div>
                    <span className="sl2" style={{fontSize:8,fontFamily:"system-ui",color:T.tFaint,opacity:0,transition:"opacity 0.15s",whiteSpace:"nowrap"}}>{item.label}</span>
                  </div>
                );
              };

              // LEFT column: nav (top) + add-tools (bottom)
              const leftTop = [
                {icon:<IC.List s={16} c={T.tSoft}/>, label:`Queue${effectiveCount>0?" ("+effectiveCount+")":""}`, action:()=>switchTab("queue")},
                {icon:<IC.Bulb s={16} c={T.tSoft}/>, label:"Insights", action:()=>switchTab("insights")},
                {icon:<span style={{fontSize:15,lineHeight:1,color:T.tSoft}}>✡</span>, label:"Shaila log", action:()=>setShowShailaManager(true)},
                {icon:<IC.Gear s={16} c={T.tSoft}/>, label:"Settings", action:()=>setShowSet(true)},
              ];
              const spinnerIcon = <div style={{width:16,height:16,borderRadius:"50%",border:`2px solid ${T.tSoft}`,borderTopColor:"transparent",animation:"ot-spin 0.7s linear infinite"}}/>;
              const leftBot = [
                {icon: optLoading ? spinnerIcon : <IC.Sparkle s={16} c={T.tSoft}/>, label: optLoading ? "Thinking…" : hasAI ? "AI Prioritize" : "Prioritize", action: launchpadOptimize},
                {icon:<IC.Brain s={16} c={T.tSoft}/>, label:"Brain dump", action:()=>setShowBrainDump(true)},
                {icon:<IC.Plus  s={16} c={T.tSoft}/>, label:"Bulk add",   action:()=>setShowBulk(true)},
                {icon:<IC.Split s={16} c={T.tSoft}/>, label:"Shatter",    action:()=>setShowBD(true)},
              ];

              // RIGHT column: zen (top) + task-actions (bottom, task-conditional ones only when task exists)
              const rightTop = [
                {icon:<IC.Moon s={16} c={T.tSoft}/>, label:"Enter zen", action:()=>setZen(true)},
                {icon:"zen-toggle", label:"Auto-zen"},
              ];
              const rightBot = [
                {icon:<IC.Timer  s={16} c={T.tSoft}/>, label:"Just Start",   action:()=>{if(curT)setJustStartId(justStartId===curT?.id?null:curT?.id);}},
                {icon:<IC.Person s={16} c={T.tSoft}/>, label:"Body double",  action:()=>setShowBodyDouble(true)},
                ...(curT ? [
                  "sep",
                  {icon:<span style={{fontSize:16,lineHeight:1,color:T.tSoft,fontFamily:"Georgia,serif"}}>≈</span>, label:"Good enough", action:()=>goodEnoughTask(curT.id)},
                  {icon:<IC.Pause s={16} c={T.tSoft}/>, label:"Mark blocked",     action:()=>setBlockedModal(curT)},
                  {icon:<IC.PriC  s={16} c={T.tSoft}/>, label:"Change priority",  action:()=>setChgPri(curT.id)},
                  ...(curT?.parentTask ? [{icon:<span style={{fontSize:13,lineHeight:1}}>🌿</span>, label:"Park rest for later", action:()=>parkRestOfGroup(curT)}] : []),
                  "sep",
                  {icon:<IC.Trash s={16} c="#C06060"/>, label:"Delete",           action:()=>delTask(curT.id)},
                ] : []),
              ];

              const colStyle = (side) => ({
                position:"fixed", [side]: EDGE,
                top: PIN_TOP, bottom: PIN_BOT,
                display:"flex", flexDirection:"column",
                justifyContent:"space-between", alignItems:"center",
                zIndex:200,
              });

              return <>
                {/* Left column */}
                <div style={colStyle("left")}>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>{leftTop.map(mkIcon)}</div>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>{leftBot.map(mkIcon)}</div>
                </div>
                {/* Right column */}
                <div style={colStyle("right")}>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>{rightTop.map(mkIcon)}</div>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>{rightBot.map(mkIcon)}</div>
                </div>
              </>;
            })()}

            {/* PostIt stack — bottom left, high z so expanded cards float above icon columns */}
            {compT.length > 0 && (
              <div style={{position:"fixed",bottom:"clamp(24px,4vh,48px)",left:"clamp(16px,3vw,32px)",zIndex:9000}}>
                <PostItStack tasks={compT} pris={pris} T={T} open={postItOpen} onToggle={()=>setPostItOpen(p=>!p)} onUncomp={uncompTask} onClone={cloneTask}/>
              </div>
            )}

          </div>
        )}

        {/* ===== NON-FOCUS HEADER ===== */}
        {tab !== "focus" && (
          <>
            <header style={{textAlign:"center",paddingTop:40,paddingBottom:4,flexShrink:0}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                <h1 style={{fontSize:24,fontWeight:600,margin:0}}>OneTaskOnly</h1>
                <button onClick={()=>setShowSet(true)} style={{background:"none",border:"none",cursor:"pointer",padding:4,opacity:.4}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.4}><IC.Gear s={15} c={T.tSoft}/></button>
              </div>
              <p style={{color:T.tFaint,fontSize:13,margin:"4px 0 0",fontStyle:"italic"}}>{gG()} — {dateStr}</p>
              <div style={{marginTop:6,display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
                <span style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui"}}>@{user?.displayName || user?.email?.split("@")[0] || ""}</span>
                <button onClick={()=>setShowShailos(true)} style={{fontSize:11,color:T.accent||"#C8A84C",fontFamily:"system-ui",background:"none",border:"none",cursor:"pointer",textDecoration:"underline",textUnderlineOffset:2,padding:0}}>Shailos</button>
                <button onClick={()=>{if(onSignOut)onSignOut();}} style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",background:"none",border:"none",cursor:"pointer",textDecoration:"underline",textUnderlineOffset:2,padding:0}}>sign out</button>
              </div>
            </header>
            <div style={{display:"flex",gap:3,marginTop:16,background:T.bgW,borderRadius:16,padding:3,flexShrink:0,position:"relative"}}>
              <TabBtn T={T} active={false} onClick={()=>switchTab("focus")} icon={<IC.Focus s={13} c={T.tSoft}/>} label="Launchpad"/>
              <div style={{position:"relative",flex:1,display:"flex"}}>
                <TabBtn T={T} active={tab==="queue"} onClick={()=>switchTab("queue")} icon={<IC.List s={13} c={tab==="queue"?T.text:T.tSoft}/>} label={`Queue (${effectiveCount})`}/>
              </div>
              <TabBtn T={T} active={tab==="insights"} onClick={()=>switchTab("insights")} icon={<IC.Bulb s={13} c={tab==="insights"?T.text:T.tSoft}/>} label="Insights"/>
            </div>
          </>
        )}

        {/* ===== QUEUE TAB ===== */}
        {tab === "queue" && (
          <div style={{animation:"ot-fade 0.3s",marginTop:24,flex:1}}>
            {/* Queue header: task count + energy indicator + overflow menu */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:13,fontWeight:600,fontFamily:"system-ui",color:T.tSoft}}>{effectiveCount} task{effectiveCount!==1?"s":""}</span>
                {curEnergy && (
                  <span style={{fontSize:10,fontFamily:"system-ui",padding:"2px 8px",borderRadius:8,border:`1px solid ${curEnergy==="high"?"#E07040":"#7EB0DE"}`,color:curEnergy==="high"?"#B85030":"#4A7898",fontWeight:600}}>
                    {curEnergy==="high"?"⚡ High energy":"🌊 Low energy"}
                    <button onClick={()=>setAS(p=>({...p,currentEnergy:null}))} style={{marginLeft:4,background:"none",border:"none",cursor:"pointer",fontSize:11,color:T.tFaint,padding:0,lineHeight:1}}>✕</button>
                  </span>
                )}
                {effectiveCount > overwhelmThreshold && (
                  <span style={{fontSize:10,fontFamily:"system-ui",padding:"2px 8px",borderRadius:8,background:focusModeActive?"#E0B47240":"transparent",border:`1px solid ${focusModeActive?"#E0B47280":T.brd}`,color:focusModeActive?"#C08830":T.tSoft,fontWeight:600,cursor:"pointer"}} onClick={()=>setFocusModeActive(f=>!f)}>
                    😶 {focusModeActive ? "Focus mode on" : "Focus mode"}
                  </span>
                )}
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
              {/* ✦ AI Prioritize — direct button */}
              <button
                onClick={launchpadOptimize}
                disabled={optLoading}
                title={hasAI ? "AI Prioritize queue" : "Prioritize queue"}
                style={{width:32,height:32,borderRadius:10,border:`1px solid ${T.brd}`,background:T.bgW,cursor:optLoading?"default":"pointer",display:"flex",alignItems:"center",justifyContent:"center",opacity:optLoading?0.5:1,flexShrink:0}}
              >
                {optLoading
                  ? <div style={{width:12,height:12,borderRadius:"50%",border:`2px solid ${T.tSoft}`,borderTopColor:"transparent",animation:"ot-spin 0.7s linear infinite"}}/>
                  : <IC.Sparkle s={14} c={T.tSoft}/>}
              </button>
              {/* ⚙ Settings — consolidated gear */}
              <button onClick={()=>setShowSet(true)} style={{width:32,height:32,borderRadius:10,border:`1px solid ${T.brd}`,background:T.bgW,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}} title="Settings">
                <IC.Gear s={15} c={T.tSoft}/>
              </button>
              </div>{/* end right-side flex row */}
            </div>

            {/* Search bar */}
            <div style={{marginBottom:8,position:"relative"}}>
              <input
                value={searchQ}
                onChange={e=>setSearchQ(e.target.value)}
                placeholder="Search tasks..."
                style={{width:"100%",padding:"9px 14px",paddingRight:searchQ?36:14,fontSize:13,border:`1px solid ${T.brd}`,borderRadius:12,outline:"none",background:T.bgW,color:T.text,fontFamily:"system-ui"}}
              />
              {searchQ && (
                <button onClick={()=>setSearchQ("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:14,color:T.tFaint,padding:"2px 4px",lineHeight:1,fontFamily:"system-ui"}} title="Clear search">×</button>
              )}
            </div>

            {/* Quick-add row */}
            <div style={{marginBottom:14,background:T.card,border:`1px solid ${T.brd}`,borderRadius:12,padding:"8px 10px",display:"flex",flexDirection:"column",gap:8}}>
              {/* Priority pills */}
              <div style={{display:"flex",gap:5,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui",flexShrink:0}}>Add:</span>
                {[...ap].sort((a,b)=>{
                  const ab = !a.id.startsWith('pri_'), bb = !b.id.startsWith('pri_');
                  if (ab !== bb) return bb - ab; // built-ins first
                  return b.weight - a.weight;    // then by weight desc
                }).map((p, idx) => {
                  const sel = qAddPri === p.id;
                  const clr = p.isShaila ? "#2ECC71" : p.color;
                  // Big = all built-ins (shaila/now/today/eventually); Small = custom priorities (pri_xxx)
                  const isBig = !p.id.startsWith('pri_');
                  return (
                    <button key={p.id} onClick={()=>setQAddPri(sel?null:p.id)} title={p.label}
                      style={{padding:isBig?"5px 13px":"3px 9px",borderRadius:20,background:sel?clr:clr+"22",border:`1.5px solid ${clr}`,cursor:"pointer",fontSize:isBig?11:10,fontWeight:700,fontFamily:"system-ui",color:sel?textOnColor(clr):clr,flexShrink:0,transition:"all 0.15s",boxShadow:sel?`0 2px 8px ${clr}50`:"none"}}
                    >{p.label}</button>
                  );
                })}
              </div>
              {/* Text input — shown once priority selected */}
              {qAddPri && (
                <form onSubmit={e=>{e.preventDefault();const t=qAddText.trim();if(!t)return;const newQT={id:uid(),text:t,completed:false,priority:qAddPri,createdAt:Date.now()};uT(ts=>doOpt([...ts,newQT]));setQAddText("");setQAddPri(null);clearTimeout(queueToastTmr.current);const clr=gP(pris,newQT.priority).isShaila?"#2ECC71":gP(pris,newQT.priority).color;setQueueToast(clr);setQueueToastKey(k=>k+1);queueToastTmr.current=setTimeout(()=>setQueueToast(null),5000);triggerAIPrioritize();}} style={{display:"flex",gap:6,animation:"ot-fade 0.15s"}}>
                  <input autoFocus value={qAddText} onChange={e=>setQAddText(e.target.value)}
                    onKeyDown={e=>{if(e.key==="Escape"){setQAddPri(null);setQAddText("");}}}
                    placeholder={qAddPri==="shaila"?"Who + what shaila?":"What needs doing?"}
                    style={{flex:1,padding:"7px 12px",fontSize:13,border:`1.5px solid ${gP(pris,qAddPri).isShaila?"#2ECC71":gP(pris,qAddPri).color}`,borderRadius:10,outline:"none",background:T.bgW,color:T.text,fontFamily:"Georgia,serif"}}/>
                  <button type="submit" style={{background:gP(pris,qAddPri).isShaila?"#2ECC71":gP(pris,qAddPri).color,border:"none",borderRadius:10,width:34,height:34,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>
                    <IC.Plus s={14} c={textOnColor(gP(pris,qAddPri).isShaila?"#2ECC71":gP(pris,qAddPri).color)}/>
                  </button>
                </form>
              )}
            </div>




            {/* Queue: all tasks in one continuous card — groups inline, no gaps */}
            {queueTFiltered.length > 0 ? (
              <div style={{background:T.card,borderRadius:16,border:`1px solid ${T.brd}`,overflow:"hidden",boxShadow:T.shadow}}>
                {(() => {
                  let pos = 0;
                  return queueTFiltered.map((task, idx) => {
                    if (task.parentTask) {
                      // === GROUP ROW — same layout as regular task + ONE expand icon ===
                      const tp = gP(pris, task.priority);
                      const gSteps = actT.filter(t => t.parentTask === task.parentTask && !t.completed).sort((a,b)=>(a.stepIndex||0)-(b.stepIndex||0));
                      const gDone = actT.filter(t => t.parentTask === task.parentTask && t.completed).length;
                      const gTotal = gSteps.length + gDone;
                      const gPct = gTotal > 0 ? gDone / gTotal : 0;
                      const isOpen = openGroups.has(task.parentTask);
                      const isAddingHere = groupAdding === task.parentTask;
                      const isF = pos === 0;
                      const dispPos = pos + 1;
                      pos++;
                      const _qText = isF ? textOnPastel(AS.colorScheme, T.text) : T.tSoft;
                      return (
                        <React.Fragment key={`grp-${task.parentTask}`}>
                          {/* Header — identical layout to a regular task row */}
                          <div draggable onDragStart={()=>setDragId(task.id)} onDragOver={e=>e.preventDefault()} onDrop={()=>handleDrop(task.id)}
                            style={{display:"flex",alignItems:"center",gap:6,padding:"12px 10px",borderBottom:`1px solid ${T.brdS}`,borderLeft:`3px solid ${tp.color}`,background:isF?pBg(tp.color):"transparent",cursor:"grab"}}>
                            <span style={{cursor:"grab",padding:"2px",opacity:.35,flexShrink:0}}><IC.Grab s={12} c={T.tSoft}/></span>
                            <span style={{width:20,height:20,borderRadius:"50%",background:isF?tp.color:"transparent",border:isF?"none":`1.5px solid ${T.tFaint}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:isF?textOnColor(tp.color):T.tFaint,fontWeight:600,fontFamily:"system-ui",flexShrink:0}}>
                              {dispPos}
                            </span>
                            <span onClick={()=>setOpenGroups(prev=>{const n=new Set(prev);n.has(task.parentTask)?n.delete(task.parentTask):n.add(task.parentTask);return n;})}
                              style={{flex:1,fontSize:14,cursor:"pointer",fontWeight:isF?500:400,color:_qText,fontFamily:"Georgia,serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{task.parentTask}</span>
                            <div style={{width:8,height:8,borderRadius:"50%",background:tp.color,flexShrink:0,opacity:.7}}/>
                            <div style={{display:"flex",gap:0,flexShrink:0}}>
                              <button onClick={e=>{e.stopPropagation();compTask(gSteps[0]?.id);}} title="Complete next step" style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}><IC.Check s={13} c={tp.color}/></button>
                              {AS.legacyCompleteUI && <button onClick={e=>{e.stopPropagation();legacyCompTask(gSteps[0]?.id);}} title="Legacy complete (no timestamp)" style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}><IC.Clock s={12} c={tp.color}/></button>}
                              <button onClick={e=>{e.stopPropagation();moveTop(gSteps[0]?.id);}} title="To top" style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}><IC.MoveTop s={12} c={T.tSoft}/></button>
                              <button onClick={e=>{e.stopPropagation();setChgPri(gSteps[0]?.id);}} title="Change priority" style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}><IC.PriC s={12} c={T.tSoft}/></button>
                              <button onClick={e=>{e.stopPropagation();setOpenGroups(prev=>{const n=new Set(prev);n.add(task.parentTask);return n;});setGroupAdding(task.parentTask);}} title="Add step" style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35,fontSize:11}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}>✦+</button>
                              <button onClick={e=>{e.stopPropagation();gSteps.forEach(s=>delTask(s.id));}} title="Delete group" style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.3}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.3}><IC.Trash s={12} c={T.tFaint}/></button>
                              {/* THE one extra icon — expand/collapse steps */}
                              <button onClick={e=>{e.stopPropagation();setOpenGroups(prev=>{const n=new Set(prev);n.has(task.parentTask)?n.delete(task.parentTask):n.add(task.parentTask);return n;});}} title={isOpen?"Hide steps":"Show steps"} style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}><IC.Chev d={isOpen?"up":"down"} s={12} c={T.tSoft}/></button>
                            </div>
                          </div>
                          {/* Subtle progress bar */}
                          <div style={{background:T.brd,height:2,overflow:"hidden"}}><div style={{width:`${gPct*100}%`,height:"100%",background:tp.color,transition:"width 0.4s"}}/></div>
                          {/* Expanded subtask rows */}
                          {isOpen && <>
                            {gSteps.map((st) => (
                              <div key={st.id} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px 7px 28px",borderBottom:`1px solid ${T.brdS}`,background:"transparent"}}>
                                <button onClick={e=>{e.stopPropagation();compTask(st.id);}} style={{width:18,height:18,borderRadius:"50%",border:`1.5px solid ${tp.color}`,background:"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}} title="Complete step"><IC.Check s={10} c={tp.color}/></button>
                                {editId === st.id ? (
                                  <input ref={edRef} value={editTx} onChange={e=>setEditTx(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveEd(st.id);if(e.key==="Escape")setEditId(null);}} onBlur={()=>saveEd(st.id)} style={{flex:1,fontSize:13,fontFamily:"Georgia,serif",border:`1px solid ${tp.color}80`,borderRadius:6,padding:"3px 7px",outline:"none",color:T.text,background:T.bgW}}/>
                                ) : (
                                  <span onClick={()=>startEd(st)} style={{flex:1,fontSize:13,color:T.tSoft,cursor:"text",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                    {st.stepIndex && <span style={{fontSize:10,color:T.tFaint,marginRight:4,fontFamily:"system-ui"}}>#{st.stepIndex}</span>}{st.text}
                                  </span>
                                )}
                                <button onClick={e=>{e.stopPropagation();delTask(st.id);}} style={{background:"none",border:"none",cursor:"pointer",padding:2,opacity:.3}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.3}><IC.Trash s={11} c={T.tFaint}/></button>
                              </div>
                            ))}
                            {gDone > 0 && <div style={{padding:"3px 10px 3px 28px",fontSize:10,color:T.tFaint,fontFamily:"system-ui",borderBottom:`1px solid ${T.brdS}`}}>{gDone} step{gDone!==1?"s":""} completed ✓</div>}
                            {isAddingHere && (
                              <div style={{display:"flex",gap:6,padding:"6px 10px 6px 28px",alignItems:"center",borderBottom:`1px solid ${T.brdS}`}}>
                                <input autoFocus placeholder="New step…"
                                  onKeyDown={e=>{const tx=e.target.value.trim();if(e.key==="Enter"&&tx){addSubtask(task.parentTask,tx);e.target.value="";setGroupAdding(null);}if(e.key==="Escape")setGroupAdding(null);}}
                                  onBlur={e=>{const tx=e.target.value.trim();if(tx)addSubtask(task.parentTask,tx);setGroupAdding(null);}}
                                  style={{flex:1,fontSize:13,fontFamily:"Georgia,serif",border:`1px solid ${tp.color}80`,borderRadius:8,padding:"5px 10px",outline:"none",background:T.bgW,color:T.text}}/>
                              </div>
                            )}
                          </>}
                        </React.Fragment>
                      );
                    } else {
                      // === REGULAR TASK ROW ===
                      const tp = gP(pris, task.priority);
                      const aged = isTaskAged(task, pris, AS.ageThresholds);
                      const isF = pos === 0;
                      const dispPos = pos + 1;
                      pos++;
                      const _qText = isF ? textOnPastel(AS.colorScheme, T.text) : T.tSoft;
                      const _qSoft = isF ? textOnPastel(AS.colorScheme, T.tSoft) : T.tSoft;
                      return (
                        <div key={task.id} draggable onDragStart={()=>setDragId(task.id)} onDragOver={e=>e.preventDefault()} onDrop={()=>handleDrop(task.id)} style={{display:"flex",alignItems:"center",gap:6,padding:"12px 10px",borderBottom:`1px solid ${T.brdS}`,borderLeft:`3px solid ${tp.color}`,background:isF?pBg(tp.color):(task.blocked?pBg("#E0B472"):"transparent"),cursor:"grab",opacity:task.blocked?.6:1}}>
                          <span style={{cursor:"grab",padding:"2px",opacity:.35,flexShrink:0}}><IC.Grab s={12} c={_qSoft}/></span>
                          <span style={{width:20,height:20,borderRadius:"50%",background:isF?tp.color:"transparent",border:isF?"none":`1.5px solid ${T.tFaint}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:isF?textOnColor(tp.color):T.tFaint,fontWeight:600,fontFamily:"system-ui",flexShrink:0}}>{dispPos}</span>
                          {editId === task.id ? (
                            <input ref={edRef} value={editTx} onChange={e=>setEditTx(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveEd(task.id);if(e.key==="Escape")setEditId(null);}} onBlur={()=>saveEd(task.id)} style={{flex:1,fontSize:14,fontFamily:"Georgia,serif",border:`1px solid ${tp.color}80`,borderRadius:8,padding:"4px 8px",outline:"none",color:textOnPastel(AS.colorScheme, T.text),background:pBg(tp.color)}}/>
                          ) : (
                            <div style={{flex:1,display:"flex",flexDirection:"column",gap:1,minWidth:0}}>
                              <span onClick={()=>startEd(task)} style={{fontSize:14,cursor:"text",fontWeight:isF?500:400,color:_qText,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                {task.pinned && <span style={{fontSize:10,marginRight:4,opacity:.5}}>📌</span>}
                                {task.text}
                              </span>
                              {task.blocked && task.blockedNote && (
                                <span style={{fontSize:10,fontStyle:"italic",color:"#A06820",fontFamily:"system-ui",opacity:.8}}>⏸ {task.blockedNote}</span>
                              )}
                              {(aged || task.autoAged || task.mrsW || task.blocked || task.energy) && (
                                <div style={{display:"flex",gap:3,flexWrap:"wrap",marginTop:2,opacity:.8}}>
                                  {aged && <AgeBadge task={task} pris={pris} thresholds={AS.ageThresholds} T={T}/>}
                                  {task.autoAged && (
                                    <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:10,fontFamily:"system-ui",padding:"1px 6px 1px 5px",borderRadius:6,background:"#7EB0DE18",border:"1px solid #7EB0DE60",color:"#4A7898",fontWeight:600,lineHeight:1.4}}>
                                      ↑ {task.agedFromLabel||"Eventually"}
                                      <button onClick={e=>{e.stopPropagation();undoAging(task.id);}} title="Undo nudge" style={{background:"none",border:"none",cursor:"pointer",fontSize:10,color:"#4A789880",padding:0,lineHeight:1,marginLeft:1}}>✕</button>
                                    </span>
                                  )}
                                  {task.energy && <EnergyBadge energy={task.energy} T={T}/>}
                                  {task.mrsW && <MrsWBadge T={T}/>}
                                  {task.blocked && <BlockedBadge task={task} T={T}/>}
                                </div>
                              )}
                            </div>
                          )}
                          <div style={{width:8,height:8,borderRadius:"50%",background:tp.color,flexShrink:0,opacity:.7}}/>
                          <div draggable={false} onPointerDown={e=>e.stopPropagation()} style={{display:"flex",gap:0,flexShrink:0}}>
                            <button onClick={e=>{e.stopPropagation();compTask(task.id);}} title="Mark done" style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}><IC.Check s={13} c={tp.color}/></button>
                            {AS.legacyCompleteUI && <button onClick={e=>{e.stopPropagation();legacyCompTask(task.id);}} title="Legacy complete (no timestamp)" style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}><IC.Clock s={12} c={tp.color}/></button>}
                            <button onClick={e=>{e.stopPropagation();moveTop(task.id);}} title="Top" style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}><IC.MoveTop s={12} c={T.tSoft}/></button>
                            {task.pinned && <button onClick={e=>{e.stopPropagation();unpinTask(task.id);}} title="Unpin" style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35,fontSize:10}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}>📍</button>}
                            <button onClick={e=>{e.stopPropagation();setChgPri(task.id);}} style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}><IC.PriC s={12} c={T.tSoft}/></button>
                            <button onClick={e=>{e.stopPropagation();setShowBD(task);}} style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35}} title="Shatter with AI" onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}><IC.Split s={12} c={T.tSoft}/></button>
                            <button onClick={e=>{e.stopPropagation();openFirstStep(task);}} title="Suggest first step with AI" style={{background:"none",border:"none",cursor:hasAI?"pointer":"default",padding:3,opacity:hasAI?.35:.15,fontSize:11}} onMouseEnter={e=>{if(hasAI)e.currentTarget.style.opacity=1;}} onMouseLeave={e=>e.currentTarget.style.opacity=hasAI?.35:.15}>✦→</button>
                            <button onClick={e=>{e.stopPropagation();startManualGroup(task);}} style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35,fontSize:11}} title="Add subtasks manually" onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}>✦+</button>
                            <button onClick={e=>{e.stopPropagation();delTask(task.id);}} style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.3}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.3}><IC.Trash s={12} c={T.tFaint}/></button>
                          </div>
                        </div>
                      );
                    }
                  });
                })()}
              </div>
            ) : (
              <div style={{background:T.card,borderRadius:16,padding:"40px 20px",border:`1px solid ${T.brd}`,textAlign:"center",boxShadow:T.shadow}}><p style={{color:T.tFaint,fontSize:14,margin:0}}>{searchQ.trim()?"No tasks match your search":"No tasks in queue"}</p></div>
            )}

            {/* Snoozed tasks — faded at bottom of queue */}
            {snoozedT.length > 0 && (
              <div style={{marginTop:16,opacity:0.55}}>
                <p style={{fontSize:9,fontWeight:700,letterSpacing:1.5,color:T.tFaint,fontFamily:"system-ui",margin:"0 0 8px 4px",textTransform:"uppercase"}}>💤 Sleeping</p>
                <div style={{background:T.card,borderRadius:14,border:`1px solid ${T.brd}`,overflow:"hidden",boxShadow:T.shadow}}>
                  {snoozedT.map((t, i) => {
                    const d = new Date(t.snoozedUntil);
                    const tom = new Date(); tom.setDate(tom.getDate()+1);
                    const wakeLabel = d.toDateString() === tom.toDateString()
                      ? `tomorrow ${d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}`
                      : d.toLocaleDateString("en-US",{month:"short",day:"numeric"}) + " " + d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});
                    const cp = gP(pris, t.priority);
                    return (
                      <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:i<snoozedT.length-1?`1px solid ${T.brd}`:"none"}}>
                        <div style={{width:8,height:8,borderRadius:"50%",background:cp.isShaila?"#2ECC71":cp.color,flexShrink:0,opacity:0.6}}/>
                        <div style={{flex:1,minWidth:0}}>
                          <p style={{margin:0,fontSize:12,color:T.tSoft,fontFamily:"Georgia,serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.text}</p>
                          <p style={{margin:"2px 0 0",fontSize:10,color:T.tFaint,fontFamily:"system-ui"}}>wakes {wakeLabel}</p>
                        </div>
                        <button onClick={()=>wakeTask(t.id)}
                          style={{flexShrink:0,padding:"4px 10px",fontSize:10,fontFamily:"system-ui",fontWeight:600,color:T.tSoft,background:"none",border:`1px solid ${T.brd}`,borderRadius:8,cursor:"pointer",whiteSpace:"nowrap"}}
                          onMouseEnter={e=>{e.currentTarget.style.borderColor=T.brdS;e.currentTarget.style.color=T.text;}}
                          onMouseLeave={e=>{e.currentTarget.style.borderColor=T.brd;e.currentTarget.style.color=T.tSoft;}}>
                          ↑ Wake now
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===== SHELF TAB ===== */}
        {/* Shelf tab removed — completed tasks live in Insights */}

        {/* ===== INSIGHTS TAB — Redesigned ===== */}
        {tab === "insights" && (
          <div style={{animation:"ot-fade 0.3s",marginTop:24}}>

            {/* ── AI Insight card (requires AI key) ── */}
            {hasAI && (
              <div style={{background:T.card,borderRadius:18,border:`1px solid ${T.brd}`,padding:"18px 20px",marginBottom:18,boxShadow:T.shadow}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <h3 style={{fontSize:10,fontWeight:700,color:T.tFaint,margin:0,fontFamily:"system-ui",textTransform:"uppercase",letterSpacing:1.5}}>✦ AI Coach Insight</h3>
                  <button
                    onClick={genAiInsight}
                    disabled={aiInsightLoading || !metrics}
                    style={{fontSize:10,fontFamily:"system-ui",fontWeight:600,padding:"4px 10px",borderRadius:8,border:`1px solid ${T.brd}`,background:T.bgW,cursor:metrics?("pointer"):"default",color:T.tSoft,opacity:aiInsightLoading?.5:1}}
                  >
                    {aiInsightLoading ? "Thinking..." : aiInsight ? "↻ Refresh" : "Generate"}
                  </button>
                </div>
                {aiInsightLoading && (
                  <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0"}}>
                    <span style={{display:"inline-block",width:14,height:14,borderRadius:"50%",border:`2px solid ${T.tSoft}`,borderTopColor:"transparent",animation:"ot-spin 0.8s linear infinite"}}/>
                    <span style={{fontSize:12,color:T.tFaint,fontFamily:"system-ui"}}>Analyzing your data...</span>
                  </div>
                )}
                {aiInsight && !aiInsightLoading && (() => {
                  const lines = aiInsight.split('\n').map(l => l.trim()).filter(Boolean);
                  const bullets = lines.filter(l => l.startsWith('•'));
                  const takeawayLine = lines.find(l => l.toUpperCase().startsWith('TAKEAWAY:'));
                  if (bullets.length === 0) {
                    return <p style={{fontSize:13,lineHeight:1.65,color:T.text,margin:"0 0 12px"}}>{aiInsight}</p>;
                  }
                  return (
                    <div style={{marginBottom:12}}>
                      <ul style={{margin:"0 0 10px",padding:0,listStyle:"none"}}>
                        {bullets.map((b,i) => (
                          <li key={i} style={{display:"flex",gap:8,alignItems:"flex-start",fontSize:13,lineHeight:1.6,color:T.text,marginBottom:5}}>
                            <span style={{color:T.tSoft,marginTop:3,flexShrink:0,fontSize:10}}>●</span>
                            <span>{b.replace(/^•\s*/,'')}</span>
                          </li>
                        ))}
                      </ul>
                      {takeawayLine && (
                        <div style={{borderTop:`1px solid ${T.brd}`,paddingTop:10,marginTop:2,display:"flex",gap:8,alignItems:"flex-start"}}>
                          <span style={{fontSize:9,fontWeight:700,color:T.tFaint,fontFamily:"system-ui",textTransform:"uppercase",letterSpacing:1.2,paddingTop:3,flexShrink:0,whiteSpace:"nowrap"}}>Key Takeaway</span>
                          <span style={{fontSize:13,fontWeight:600,color:T.text,lineHeight:1.5}}>{takeawayLine.replace(/^TAKEAWAY:\s*/i,'')}</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
                {!aiInsight && !aiInsightLoading && (
                  <p style={{fontSize:13,color:T.tFaint,margin:0,fontFamily:"system-ui"}}>{metrics ? "Tap Generate for a personalized insight based on your task history." : "Complete tasks to enable personalized insights."}</p>
                )}

                {/* Quick analysis buttons */}
                {aiInsight && metrics && (
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8,marginBottom:8}}>
                    {[
                      ["Completion time by tier","Within each priority tier, how consistent and fast am I? Any patterns worth knowing?"],
                      ["Task type patterns","What patterns do you see in my task types and topics?"],
                      ["Productivity trends","What are my productivity trends over time?"],
                      ["Recommendations","Based on all my data, what should I focus on?"]
                    ].map(([label, prompt]) => (
                      <button key={label} onClick={()=>{setAiChatOpen(true);sendAiChat(prompt);}} style={{padding:"5px 10px",borderRadius:8,border:`1px solid ${T.brd}`,background:T.bgW,fontSize:11,fontFamily:"system-ui",fontWeight:600,color:T.tSoft,cursor:"pointer"}}>{label}</button>
                    ))}
                  </div>
                )}

                {/* Chat toggle */}
                {metrics && (
                  <button onClick={()=>setAiChatOpen(o=>!o)} style={{width:"100%",padding:"6px",fontSize:10,fontFamily:"system-ui",fontWeight:600,color:T.tSoft,background:"none",border:`1px solid ${T.brd}`,borderRadius:8,cursor:"pointer",marginTop:4}}>
                    {aiChatOpen ? "Close chat ▲" : "Ask questions about my data ▼"}
                  </button>
                )}

                {/* Chat dialog */}
                {aiChatOpen && (
                  <div style={{marginTop:10,borderTop:`1px solid ${T.brd}`,paddingTop:10}}>
                    {/* Chat history */}
                    <div ref={chatBoxRef} style={{maxHeight:300,overflowY:"auto",marginBottom:8}}>
                      {(aiChatHistory.length > 60 ? aiChatHistory.slice(-60) : aiChatHistory).map((m, i) => (
                        <div key={i} style={{marginBottom:8,display:"flex",flexDirection:"column",alignItems:m.role==="user"?"flex-end":"flex-start"}}>
                          <div style={{maxWidth:"85%",padding:"8px 12px",borderRadius:m.role==="user"?"12px 12px 2px 12px":"12px 12px 12px 2px",background:m.role==="user"?T.text:T.bgW,color:m.role==="user"?(T.bg||"#fff"):(AS?.colorScheme==="midnight"?"#E0DCF0":T.text),fontSize:13,lineHeight:1.5,fontFamily:m.role==="user"?"system-ui":"inherit"}}>
                            {m.text}
                          </div>
                        </div>
                      ))}
                      {aiChatLoading && (
                        <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 0"}}>
                          <span style={{display:"inline-block",width:12,height:12,borderRadius:"50%",border:`2px solid ${T.tSoft}`,borderTopColor:"transparent",animation:"ot-spin 0.8s linear infinite"}}/>
                          <span style={{fontSize:12,color:T.tFaint,fontFamily:"system-ui"}}>Analyzing...</span>
                        </div>
                      )}
                      <div ref={chatEndRef}/>
                    </div>
                    {/* Chat input */}
                    <div style={{display:"flex",gap:6}}>
                      <input
                        value={aiChatInput}
                        onChange={e=>setAiChatInput(e.target.value)}
                        onKeyDown={e=>{if(e.key==="Enter"&&aiChatInput.trim())sendAiChat(aiChatInput);}}
                        placeholder="Ask about your patterns, times, priorities..."
                        style={{flex:1,padding:"8px 12px",fontSize:13,border:`1px solid ${T.brd}`,borderRadius:10,outline:"none",background:T.bgW,color:AS?.colorScheme==="midnight"?"#E0DCF0":T.text,fontFamily:"system-ui"}}
                      />
                      <button onClick={()=>aiChatInput.trim()&&sendAiChat(aiChatInput)} disabled={aiChatLoading||!aiChatInput.trim()} style={{padding:"8px 14px",borderRadius:10,border:"none",background:T.text,color:T.bg||"#fff",fontSize:12,fontWeight:700,fontFamily:"system-ui",cursor:"pointer",opacity:aiChatLoading||!aiChatInput.trim()?.4:1}}>Send</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Tip Carousel ── */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <h2 style={{fontSize:16,fontWeight:600,margin:0}}>Tips</h2>
              <span style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui"}}>{tipCarouselIdx+1} / {tipCarouselList.length}</span>
            </div>

            {/* Category filter pills */}
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
              {TIP_CATS.map(cat => (
                <button key={cat} onClick={()=>setTipCat(cat)} style={{padding:"4px 12px",borderRadius:10,border:`1px solid ${tipCat===cat?T.text:T.brd}`,background:tipCat===cat?T.text:"transparent",color:tipCat===cat?(SCHEMES[AS.colorScheme]?.bg||"#fff"):T.tSoft,fontSize:10,fontFamily:"system-ui",fontWeight:600,cursor:"pointer"}}>{cat}</button>
              ))}
            </div>

            {/* Single tip card */}
            <div style={{background:T.card,borderRadius:18,border:`1px solid ${T.brd}`,padding:"22px 20px",marginBottom:10,minHeight:120,animation:"ot-fade 0.2s",position:"relative"}}>
              <p style={{fontSize:15,lineHeight:1.65,color:T.text,margin:"0 0 14px"}}>{tipCarouselItem.t}</p>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  {tipCarouselItem.s ? (
                    <a href={`https://www.google.com/search?q=${encodeURIComponent(tipCarouselItem.s + " " + tipCarouselItem.t.slice(0,40))}`} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:T.tSoft,fontFamily:"system-ui",fontStyle:"italic",textDecoration:"underline",textDecorationColor:T.brd}}>
                      {tipCarouselItem.s}
                    </a>
                  ) : (
                    <span style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",fontStyle:"italic"}}>{tipCarouselItem.s}</span>
                  )}
                  <span style={{background:T.bgW,borderRadius:4,padding:"1px 6px",fontSize:11,fontFamily:"system-ui",fontWeight:700,color:T.tFaint,border:`1px solid ${T.brd}`}}>{tipCarouselItem.cat}</span>
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button
                    onClick={()=>setTipViewIdx(i=>(i-1+tipCarouselList.length)%tipCarouselList.length)}
                    style={{padding:"6px 14px",borderRadius:10,border:`1px solid ${T.brd}`,background:T.bgW,cursor:"pointer",fontSize:13,color:T.tSoft,fontFamily:"system-ui",lineHeight:1}}
                    title="Previous tip"
                  >←</button>
                  <button
                    onClick={()=>setTipViewIdx(i=>(i+1)%tipCarouselList.length)}
                    style={{padding:"6px 14px",borderRadius:10,border:`1px solid ${T.brd}`,background:T.bgW,cursor:"pointer",fontSize:13,color:T.tSoft,fontFamily:"system-ui",lineHeight:1}}
                    title="Next tip"
                  >→</button>
                </div>
              </div>
            </div>

            {/* ── Stats (collapsible) ── */}
            {metrics ? (
              <details style={{marginTop:24}} open={false}>
                <summary style={{fontSize:13,fontWeight:600,fontFamily:"system-ui",cursor:"pointer",color:T.tSoft,listStyle:"none",display:"flex",alignItems:"center",gap:6,marginBottom:12,userSelect:"none"}}>
                  <span style={{fontSize:10,opacity:.6}}>▶</span> Your stats
                </summary>
                <div style={{paddingTop:8}}>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
                    <div style={{background:T.card,borderRadius:14,padding:"16px",border:`1px solid ${T.brd}`,textAlign:"center"}}><div style={{fontSize:26,fontWeight:600}}>{metrics.total}</div><div style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",marginTop:2}}>Completed</div><div style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",marginTop:4,opacity:.7}}>Total tasks you've finished</div></div>
                    <div style={{background:T.card,borderRadius:14,padding:"16px",border:`1px solid ${T.brd}`,textAlign:"center"}}><div style={{fontSize:26,fontWeight:600}}>{metrics.avg}</div><div style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",marginTop:2}}>Avg time</div><div style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",marginTop:4,opacity:.7}}>Average time from creation to done</div></div>
                    <div style={{background:T.card,borderRadius:14,padding:"16px",border:`1px solid ${T.brd}`,textAlign:"center"}}><div style={{fontSize:26,fontWeight:600}}>{metrics.sk}d</div><div style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",marginTop:2}}>Streak</div><div style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",marginTop:4,opacity:.7}}>Consecutive days with completions</div></div>
                    <div style={{background:T.card,borderRadius:14,padding:"16px",border:`1px solid ${T.brd}`,textAlign:"center"}}><div style={{fontSize:15,fontWeight:600}}>{metrics.pT||"—"}</div><div style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",marginTop:2}}>Peak hour</div><div style={{fontSize:11,color:T.tFaint,fontFamily:"system-ui",marginTop:4,opacity:.7}}>Your most productive time of day</div></div>
                  </div>
                  {metrics.goodEnoughCount > 0 && (
                    <div style={{background:pBg("#9BD4A0"),borderRadius:12,padding:"12px 16px",border:"1px solid #9BD4A040",marginBottom:14,display:"flex",gap:10,alignItems:"center"}}>
                      <IC.GoodEnough s={16} c="#3A7242"/>
                      <div><p style={{fontSize:12,fontWeight:600,margin:0,color:"#3A7242",fontFamily:"system-ui"}}>{metrics.goodEnoughCount} "good enough" completions</p><p style={{fontSize:11,color:"#3A7242",margin:0,fontFamily:"system-ui"}}>That's pragmatic productivity at its finest.</p></div>
                    </div>
                  )}
                  <div style={{background:T.card,borderRadius:16,border:`1px solid ${T.brd}`,padding:16,marginBottom:14}}>
                    <h3 style={{fontSize:10,fontWeight:700,color:T.tFaint,margin:"0 0 12px",fontFamily:"system-ui",textTransform:"uppercase",letterSpacing:1.5}}>By Priority</h3>
                    {metrics.pS.map(p => (
                      <div key={p.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:`1px solid ${T.brdS}`}}>
                        <div style={{width:10,height:10,borderRadius:"50%",background:p.c,flexShrink:0}}/>
                        <span style={{flex:1,fontSize:13,fontFamily:"system-ui",fontWeight:500}}>{p.l}</span>
                        <span style={{fontSize:12,color:T.tSoft,fontFamily:"system-ui"}}>{p.n} done</span>
                        <span style={{fontSize:12,color:T.tSoft,fontFamily:"system-ui",minWidth:60,textAlign:"right"}}>avg {p.a}</span>
                      </div>
                    ))}
                  </div>
                  {/* Pattern insights (rule-based) */}
                  {advice.length > 0 && (
                    <div style={{background:T.card,borderRadius:16,border:`1px solid ${T.brd}`,padding:16,marginBottom:14}}>
                      <h3 style={{fontSize:10,fontWeight:700,color:T.tFaint,margin:"0 0 12px",fontFamily:"system-ui",textTransform:"uppercase",letterSpacing:1.5}}>Patterns</h3>
                      {advice.map((a,i) => <p key={i} style={{fontSize:13,lineHeight:1.6,margin:i<advice.length-1?"0 0 10px":0,padding:"9px 11px",background:T.bgW,borderRadius:10,fontFamily:"system-ui"}}>{a}</p>)}
                    </div>
                  )}
                  <div style={{background:T.card,borderRadius:16,border:`1px solid ${T.brd}`,overflow:"hidden",marginBottom:32}}>
                    <h3 style={{fontSize:10,fontWeight:700,color:T.tFaint,margin:0,padding:"12px 14px 8px",fontFamily:"system-ui",textTransform:"uppercase",letterSpacing:1.5}}>Completion Log</h3>
                    <div style={{maxHeight:280,overflowY:"auto"}}>
                      {metrics.cL.map(t => {
                        const tp = gP(pris, t.priority);
                        return (
                          <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 14px",borderTop:`1px solid ${T.brdS}`}}>
                            <div style={{width:8,height:8,borderRadius:"50%",background:tp.color,flexShrink:0}}/>
                            <span style={{flex:1,fontSize:13,color:T.tSoft}}>
                              {t.goodEnough&&<span style={{fontSize:11,marginRight:4,opacity:.6}}>≈</span>}
                              {t.text}
                            </span>
                            <button onClick={()=>cloneTask(t)} title="Clone as new task" style={{background:"none",border:"none",cursor:"pointer",padding:3,opacity:.35,flexShrink:0}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.35}><IC.Clone s={12} c={T.tFaint}/></button>
                            <div style={{fontSize:10,color:T.tFaint,fontFamily:"system-ui",textAlign:"right",flexShrink:0}}>
                              <div>{new Date(t.createdAt).toLocaleDateString()}</div>
                              <div>→ {new Date(t.completedAt).toLocaleDateString()}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </details>
            ) : (
              <div style={{background:T.card,borderRadius:16,padding:"24px 20px",border:`1px solid ${T.brd}`,textAlign:"center",marginBottom:32}}><p style={{color:T.tFaint,fontSize:14,margin:0}}>Complete tasks to see your stats</p></div>
            )}
          </div>
        )}

        {tab !== "focus" && <footer style={{textAlign:"center",padding:"20px 0 36px",borderTop:`1px solid ${T.brdS}`,marginTop:16,flexShrink:0}}><p style={{color:T.tFaint,fontSize:12,fontStyle:"italic",margin:0}}>One thing at a time.</p></footer>}
      </div>

      {/* ── Floating "Record Shaila" button — always visible except during Zen ── */}
      {!zen && (
        <button
          onClick={() => window.open("/shailos/", "_blank")}
          style={{
            position:"fixed", bottom:24, right:24, zIndex:9999,
            background:"#C8A84C", color:"#fff", border:"none",
            borderRadius:50, padding:"14px 20px",
            fontSize:14, fontWeight:600, fontFamily:"system-ui",
            cursor:"pointer", boxShadow:"0 4px 16px rgba(0,0,0,.25)",
            display:"flex", alignItems:"center", gap:8,
            transition:"transform 0.15s, box-shadow 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.07)"; e.currentTarget.style.boxShadow = "0 6px 24px rgba(0,0,0,.35)"; }}
          onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,.25)"; }}
          title="Record a new shaila"
        >
          <span style={{fontSize:18}}>📋</span> Shaila
        </button>
      )}
    </div>
  );
}
