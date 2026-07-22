// ── Simulated content clone (localhost only) ────────────────────────────────
// Owner request 7/22: "do a simulated content clone, not touching live data but
// mimicking it exactly, that way I can play with the UI in preview and correct it
// before pushing live."
//
// Why this exists: on localhost the app hands itself a mock user (`dev_test_user`,
// see 00-auth.jsx) that carries no Firebase credential. Every Firestore read is
// therefore denied and the preview renders a completely EMPTY app — which makes it
// useless for judging anything that depends on content: row density, how many rows
// fit, list overflow, truncation, hero selection, card balance. Those are exactly
// the things this app's tickets are about.
//
// This module fills that gap WITHOUT any connection to the live project. It never
// reads or writes Firestore, never calls the AI proxy, never touches the phone
// relay. It works by replacing the app's own read surface with in-memory fixtures
// shaped byte-for-byte like the real payloads:
//
//   * Store.load / _listenV5 / listenShailos / subscribeBugs  → fixture objects
//   * fetch('/api/google-workspace')  → a summary payload (calendar + gmail)
//   * fetch('/api/phone-relay?action=state') → a relay state blob
//   * fetch('/api/ai-proxy')          → canned completions, so a preview session
//                                       can never spend real quota
//
// Everything is monkey-patched from OUTSIDE. No production code path is modified
// or branched, so this cannot change how the deployed app behaves; if the module is
// never invoked it may as well not exist.
//
// Writes (completing a task, editing text, marking a shaila) mutate the in-memory
// fixtures and re-emit to listeners, so the UI is genuinely interactive — you can
// click around and see real state transitions — and everything resets on reload.
//
// Fixtures are generated RELATIVE TO NOW on each load, so times, "2h ago" labels,
// today/tomorrow splits and calendar now-lines always look live.

const MOCK_TOKEN = "dev-mock-id-token";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const now = () => Date.now();
const ago = ms => now() - ms;
const soon = ms => now() + ms;
const iso = ms => new Date(ms).toISOString();

// Clock-anchored helper: today at HH:MM local, so calendar rows land on the real
// timeline rather than drifting with the hour the preview happened to open.
function todayAt(hour, minute = 0, dayOffset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

// ── Tasks ───────────────────────────────────────────────────────────────────
// Shape mirrors a per-task Firestore doc as rebuilt by Store._listenV5: the state
// object is { ...settings, lists: [{ id, name, tasks: [...] }] }.
function mockTasks() {
  const t = (id, text, priority, extra = {}) => ({
    id,
    text,
    priority,
    completed: false,
    createdAt: ago(extra._ageH != null ? extra._ageH * HOUR : 6 * HOUR),
    ...extra,
  });
  delete t._ageH;
  return [
    t("mt1", "Call the Steinberg family back about the aufruf date", "now", { _ageH: 3 }),
    t("mt2", "Finish the Shabbos HaGadol drasha — second half still rough", "now", { _ageH: 30 }),
    t("mt3", "Sign and return the mikvah maintenance contract", "now", { _ageH: 52 }),
    t("mt4", "Review the eruv inspection notes from Tuesday", "today", { _ageH: 8 }),
    t("mt5", "Confirm the kiddush sponsor for parshas Bo", "today", { _ageH: 20 }),
    t("mt6", "Send the shiur recording link to the WhatsApp group", "today", { _ageH: 4 }),
    t("mt7", "Follow up with the school about the 8th grade siyum", "today", { _ageH: 46 }),
    t("mt8", "Order seforim for the beis medrash — list is on the desk", "eventually", { _ageH: 120 }),
    t("mt9", "Schedule the annual kashrus walkthrough at the caterer", "eventually", { _ageH: 90 }),
    t("mt10", "Write up the chevra kadisha procedure changes", "eventually", { _ageH: 200 }),
    t("mt11", "Renew the shul's insurance certificate before the 1st", "today", { _ageH: 14 }),
    t("mt12", "Pick up the dry cleaning", "eventually", { _ageH: 60, mrsW: true }),
    // A couple of completed ones so the Focus/PostIt surfaces are not empty.
    { id: "mt13", text: "Send the yahrzeit reminders for this week", priority: "today", completed: true, completedAt: ago(2 * HOUR), createdAt: ago(2 * DAY) },
    { id: "mt14", text: "Call back the hospital chaplain", priority: "now", completed: true, completedAt: ago(20 * HOUR), createdAt: ago(3 * DAY) },
  ];
}

// ── Shailos ─────────────────────────────────────────────────────────────────
// Shape mirrors a users/{uid}/shailos doc. Deliberately spans every state the UI
// branches on: pending (no answer), answered (waiting to get back to the asker),
// and got_back (closed) — plus a duplicate-text pair, so the same-question collapse
// shipped in 4.103.1 is visible in preview.
function mockShailos() {
  return [
    {
      id: "ms1",
      question: "Can one allow a contractor to work on their house on chol hamoed?",
      askerName: "Yaakov Stern",
      date: iso(ago(2 * HOUR)),
      status: "pending",
      answer: "",
    },
    {
      id: "ms2",
      question: "Am I allowed to give my chassan a present during sefirah?",
      askerName: "Rivka Goldman",
      date: iso(ago(5 * HOUR)),
      status: "pending",
      answer: "",
    },
    {
      id: "ms3",
      question: "How can one create two seals for Shabbos on a hot water urn?",
      askerName: "Moshe Feldman",
      date: iso(ago(26 * HOUR)),
      status: "answered",
      answer: "Two separate covers work, provided each is placed before Shabbos and neither is moved on Shabbos itself. A single cover with a fold is not sufficient.",
      answerSummary: "Two covers, both placed before Shabbos",
    },
    {
      id: "ms4",
      question: "Is a beged that fell in the wash with a shatnez item a problem?",
      askerName: "Chana Weiss",
      date: iso(ago(30 * HOUR)),
      status: "answered",
      answer: "The beged itself is assur to wear until checked. Other items washed alongside it are mutar, though lechatchila one should wait and have them looked at.",
      answerSummary: "Beged assur until checked, others mutar",
    },
    // Same question as ms3, asked separately — exercises the 4.103.1 collapse.
    {
      id: "ms5",
      question: "How can one create two seals for Shabbos on a hot water urn?",
      askerName: "Dovid Klein",
      date: iso(ago(34 * HOUR)),
      status: "answered",
      answer: "Two separate covers work, provided each is placed before Shabbos and neither is moved on Shabbos itself.",
      answerSummary: "Two covers, both placed before Shabbos",
    },
    {
      id: "ms6",
      question: "Does a borrowed sefer torah need its own kriah check before use?",
      askerName: "Shimon Adler",
      date: iso(ago(3 * DAY)),
      status: "got_back",
      answer: "It should be checked, but a recent check by the lending shul is relied upon.",
      answerSummary: "Recent check by lender is relied upon",
    },
  ];
}

// ── Bug log ─────────────────────────────────────────────────────────────────
function mockBugs() {
  return [
    { id: "mb1", text: "Calendar card cuts off the last event on the iPad in landscape.", type: "bug", status: "unresolved", createdAtMs: ago(4 * HOUR), summary: "Calendar card clips the last event on iPad landscape." },
    { id: "mb2", text: "Would like the shailos card to show who is waiting longest first.", type: "idea", status: "unresolved", createdAtMs: ago(2 * DAY), summary: "Sort shailos by who has waited longest." },
    { id: "mb3", text: "Phone card shows a missed call that I already returned.", type: "bug", status: "unresolved", createdAtMs: ago(3 * DAY), summary: "Returned missed call still flagged." },
    { id: "mb4", text: "Mail summaries are occasionally one message behind.", type: "bug", status: "resolved", createdAtMs: ago(6 * DAY), summary: "Mail summary lagged by one message.", devNote: "Fixed by the content-keyed claim." },
  ];
}

// ── Google Calendar ─────────────────────────────────────────────────────────
// Google Calendar API v3 event shape, which is what the NerveCenter reads directly.
function mockCalendarEvents() {
  const ev = (id, summary, startMs, endMs, extra = {}) => ({
    id,
    calendarId: "primary",
    status: "confirmed",
    summary,
    start: { dateTime: iso(startMs) },
    end: { dateTime: iso(endMs) },
    updated: iso(ago(2 * DAY)),
    ...extra,
  });
  return [
    ev("mc1", "Shacharis", todayAt(7, 0), todayAt(7, 45), { colorId: "8" }),
    ev("mc2", "Daf Yomi shiur", todayAt(8, 0), todayAt(8, 45), { colorId: "8" }),
    ev("mc3", "Call with the mikvah contractor", todayAt(10, 30), todayAt(11, 0), { colorId: "6" }),
    ev("mc4", "Meeting — school board", todayAt(13, 0), todayAt(14, 0), { colorId: "11" }),
    ev("mc5", "Mincha", todayAt(14, 15), todayAt(14, 35), { colorId: "8" }),
    ev("mc6", "Chosson shiur — Weiss", todayAt(16, 0), todayAt(17, 0), { colorId: "5" }),
    ev("mc7", "Maariv", todayAt(20, 15), todayAt(20, 40), { colorId: "8" }),
    ev("mc8", "Shacharis", todayAt(7, 0, 1), todayAt(7, 45, 1), { colorId: "8" }),
    ev("mc9", "Levaya — Rosenberg", todayAt(11, 0, 1), todayAt(12, 30, 1), { colorId: "11" }),
    ev("mc10", "Kashrus walkthrough at the caterer", todayAt(15, 0, 1), todayAt(16, 30, 1), { colorId: "6" }),
  ];
}

// ── Gmail ───────────────────────────────────────────────────────────────────
// Gmail API message shape: headers live under payload.headers as {name, value},
// and unread state is the UNREAD label — both are read directly by the UI.
function mockGmailMessages() {
  const msg = (id, from, subject, snippet, atMs, unread) => ({
    id,
    threadId: `thread_${id}`,
    internalDate: String(atMs),
    labelIds: unread ? ["INBOX", "UNREAD"] : ["INBOX"],
    snippet,
    payload: {
      headers: [
        { name: "From", value: from },
        { name: "Subject", value: subject },
        { name: "Date", value: new Date(atMs).toUTCString() },
      ],
    },
  });
  return [
    msg("mg1", '"Yaakov Stern" <ystern@example.com>', "Aufruf — which Shabbos works?",
      "Wanted to check if the 14th still works for the aufruf, the hall needs an answer by Thursday.", ago(45 * MIN), true),
    msg("mg2", '"Congregation Office" <office@example.org>', "Insurance certificate expires Friday",
      "The carrier needs the signed renewal back before the 1st or coverage lapses.", ago(2 * HOUR), true),
    msg("mg3", '"Chana Weiss" <cweiss@example.com>', "Following up on my shaila",
      "Just checking whether you had a chance to look at the question about the beged.", ago(4 * HOUR), true),
    msg("mg4", '"Beis Medrash Seforim" <orders@example.com>', "Your order is ready for pickup",
      "The six volumes you asked about came in and are being held at the front.", ago(7 * HOUR), false),
    msg("mg5", '"School Administration" <admin@example.org>', "8th grade siyum — date confirmation",
      "We are holding the 22nd but need confirmation this week to book the hall.", ago(11 * HOUR), false),
    msg("mg6", '"Moshe Feldman" <mfeldman@example.com>', "Thank you",
      "Thank you for the answer about the urn, that clarified it completely.", ago(22 * HOUR), false),
    msg("mg7", '"Eruv Committee" <eruv@example.org>', "Tuesday inspection notes",
      "Two poles on the north side need attention before this Shabbos, photos attached.", ago(26 * HOUR), false),
    msg("mg8", '"Hospital Chaplaincy" <chaplain@example.org>', "Visit request — room 412",
      "A family asked whether you might be able to stop by sometime this week.", ago(2 * DAY), false),
  ];
}

// ── Phone relay ─────────────────────────────────────────────────────────────
// Shape of the single state blob a phone host pushes to the cloud, as consumed by
// NerveCenterPhoneSurface: { status, messages, calls, contacts, relayReceivedAt }.
function mockPhoneState() {
  const sms = (id, number, name, body, atMs, outgoing, read = true) => ({
    id,
    normalizedPhone: number,
    from: number,
    name,
    body,
    timestamp: iso(atMs),
    type: outgoing ? 2 : 1,
    read,
  });
  const call = (id, number, name, kind, atMs) => ({
    id,
    number,
    name,
    type: kind,
    timestamp: iso(atMs),
    duration: kind === "missed" ? 0 : 95,
  });
  return {
    status: {
      deviceName: "Galaxy Tab",
      hostPlatform: "android",
      connected: true,
      CallState: "Idle",
      voicemailCount: 1,
      updatedAt: now(),
    },
    messages: [
      sms("mm1", "+15745551201", "Yaakov Stern", "Is the 14th still good for the aufruf?", ago(18 * MIN), false, false),
      sms("mm2", "+15745551202", "Rivka Goldman", "Thank you Rabbi, that helps a lot", ago(1 * HOUR), false, false),
      sms("mm3", "+15745551203", "Shul Gabbai", "Minyan is short two for mincha today", ago(2 * HOUR), false, true),
      sms("mm4", "+15745551203", "Shul Gabbai", "I'll be there", ago(2 * HOUR - 4 * MIN), true, true),
      sms("mm5", "+15745551204", "Mrs. W", "Don't forget the dry cleaning", ago(5 * HOUR), false, true),
      sms("mm6", "+15745551205", "Moshe Feldman", "Got it, thank you very much", ago(9 * HOUR), false, true),
      sms("mm7", "+15745551206", "Caterer — Shmuel", "Can we move the walkthrough to 3?", ago(26 * HOUR), false, true),
    ],
    calls: [
      call("mk1", "+15745551201", "Yaakov Stern", "missed", ago(35 * MIN)),
      call("mk2", "+15745551207", "Unknown", "missed", ago(3 * HOUR)),
      call("mk3", "+15745551203", "Shul Gabbai", "incoming", ago(4 * HOUR)),
      call("mk4", "+15745551208", "Hospital Chaplaincy", "outgoing", ago(21 * HOUR)),
      call("mk5", "+15745551204", "Mrs. W", "incoming", ago(25 * HOUR)),
      call("mk6", "+15745551205", "Moshe Feldman", "outgoing", ago(28 * HOUR)),
    ],
    contacts: [
      { id: "mn1", displayName: "Yaakov Stern", phoneNumber: "+15745551201" },
      { id: "mn2", displayName: "Rivka Goldman", phoneNumber: "+15745551202" },
      { id: "mn3", displayName: "Shul Gabbai", phoneNumber: "+15745551203" },
      { id: "mn4", displayName: "Mrs. W", phoneNumber: "+15745551204" },
      { id: "mn5", displayName: "Moshe Feldman", phoneNumber: "+15745551205" },
      { id: "mn6", displayName: "Caterer — Shmuel", phoneNumber: "+15745551206" },
    ],
    relayReceivedAt: now(),
    commandResults: [],
  };
}

// Canned AI answers, keyed loosely by job id. A preview session must never reach the
// real proxy: it would spend live quota and, for the dashboard jobs, would also write
// into the shared cross-device claim documents that the real app depends on.
function mockAiResponse(bodyText) {
  const job = /"job"\s*:\s*"([^"]+)"/.exec(bodyText || "")?.[1] || "";
  if (job.includes("polish_items")) {
    return { output: [] }; // leave item text as-authored
  }
  if (job.includes("answer_summary")) {
    return { output: "Mutar with the usual conditions" };
  }
  if (job.includes("snapshot") || job.includes("supercrunch")) {
    return {
      output: {
        supercrunch: "Steinberg aufruf date, insurance certificate expiring, eruv poles on the north side, Weiss shaila waiting, various household items",
        signals: [
          { area: "Calendar", note: "School board at 1, chosson shiur at 4" },
          { area: "Mail", note: "Three unread — aufruf date, insurance, Weiss follow-up" },
          { area: "Tasks", note: "Drasha second half still rough" },
          { area: "Shailos", note: "Two waiting on you" },
          { area: "Phone", note: "Missed call from Yaakov Stern 35m ago" },
        ],
      },
    };
  }
  return { output: "" };
}

// Contents for the handful of documents that are read through raw Firestore rather
// than through Store, keyed by "collection/doc". Without these the AI-lane chip and
// both phone listeners sit in a permanent permission-denied retry loop, the console
// fills with errors, and the phone card renders as offline.
function mockFirestoreDoc(path) {
  if (path === "_system/ai-status") {
    return {
      currentLane: "gemini:primary",
      label: "Gemini",
      provider: "gemini",
      model: "gemini-3.1-flash-lite",
      updatedAt: now(),
      recent: [],
      usage: {
        totalToday: 34, totalThisHour: 3, totalThisMonth: 812,
        spend: { todayUsd: 0.04, monthUsd: 1.12 },
      },
      leaks: [],
    };
  }
  if (path === "_system/ai-log") return { entries: [] };
  if (path === "phone-relay/owner") {
    return {
      preferredHostId: "android-tab",
      activeHostId: "android-tab",
      activeHostLabel: "Galaxy Tab",
      heartbeatAt: now(),
      updatedAt: now(),
    };
  }
  if (path === "phone-relay/state") {
    const s = mockPhoneState();
    return { ...s, relayReceivedAt: now(), updatedAt: now() };
  }
  return null;
}

// ── Installer ───────────────────────────────────────────────────────────────
// Replaces the read surface in place. Returns silently if called twice.
let installed = false;

export async function installDevMock(Store) {
  if (installed) return;
  installed = true;

  // Live fixture state. Writes mutate these and re-notify, so the UI is genuinely
  // interactive rather than a static screenshot.
  const state = {
    tasks: mockTasks(),
    shailos: mockShailos(),
    bugs: mockBugs(),
    settings: {
      colorScheme: "claude",
      zenEnabled: false,
      aiProvider: "",
      aiModel: "",
      aiGeminiCredential: "auto",
    },
  };
  const taskSubs = new Set();
  const shailaSubs = new Set();
  const bugSubs = new Set();

  const buildState = () => ({
    ...state.settings,
    lists: [{ id: "default", name: "My Tasks", tasks: state.tasks.map(t => ({ ...t })) }],
    _lsModified: now(),
  });
  const emitTasks = () => taskSubs.forEach(fn => { try { fn(buildState()); } catch (_) {} });
  const emitShailos = () => shailaSubs.forEach(fn => { try { fn(state.shailos.map(s => ({ ...s })), false); } catch (_) {} });
  const emitBugs = () => bugSubs.forEach(fn => { try { fn(state.bugs.map(b => ({ ...b }))); } catch (_) {} });

  // ---- Store read surface -------------------------------------------------
  Store.uid = "dev_test_user";
  Store.load = async () => buildState();
  Store._listenV5 = onUpdate => {
    taskSubs.add(onUpdate);
    setTimeout(() => { try { onUpdate(buildState()); } catch (_) {} }, 0);
    return () => taskSubs.delete(onUpdate);
  };
  Store.listenShailos = cb => {
    shailaSubs.add(cb);
    setTimeout(emitShailos, 0);
    return () => shailaSubs.delete(cb);
  };
  Store.subscribeBugs = cb => {
    bugSubs.add(cb);
    setTimeout(emitBugs, 0);
    return () => bugSubs.delete(cb);
  };
  Store.loadCalendarRatings = async () => ({});
  Store.loadAiLeakTickets = async () => ({});
  Store.probeFirestore = async () => ({ ok: true, verdict: "OK (mock)" });

  // ---- Store write surface ------------------------------------------------
  // Mutates fixtures only. Nothing leaves the browser.
  Store.save = async next => {
    if (next?.lists?.[0]?.tasks) state.tasks = next.lists[0].tasks.map(t => ({ ...t }));
    const { lists, _lsModified, ...settings } = next || {};
    state.settings = { ...state.settings, ...settings };
    emitTasks();
  };
  Store.saveToFB = Store.save;
  Store.setCalendarRating = async () => {};
  Store.linkAiLeakTicket = async () => {};
  Store.markShailaAnswered = async (id, answer) => {
    const s = state.shailos.find(x => x.id === id);
    if (s) { s.status = "answered"; s.answer = answer || s.answer || "Answered."; }
    emitShailos();
  };
  Store.markShailaStatus = async (id, status) => {
    const s = state.shailos.find(x => x.id === id);
    if (s) s.status = status;
    emitShailos();
  };
  Store.addBug = async ({ text, type = "bug", status = "unresolved" } = {}) => {
    const id = `mb_${Math.random().toString(36).slice(2, 9)}`;
    state.bugs.unshift({ id, text, type, status, createdAtMs: now(), summary: String(text || "").slice(0, 120) });
    emitBugs();
    return id;
  };
  Store.updateBug = async (id, patch = {}) => {
    const b = state.bugs.find(x => x.id === id);
    if (b) Object.assign(b, patch);
    emitBugs();
  };
  Store.deleteBug = async id => {
    state.bugs = state.bugs.filter(x => x.id !== id);
    emitBugs();
  };
  Store._syncOpenTickets = async () => {};

  // ---- Network surface ----------------------------------------------------
  // Only the app's own /api/* routes are intercepted; every other request (Vite's
  // module graph, HMR, fonts) passes straight through untouched.
  const realFetch = window.fetch.bind(window);
  const json = (data, status = 200) => new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json" },
  });

  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : (input?.url || "");
    if (!url.includes("/api/")) return realFetch(input, init);

    // The whole Google path is gated on this: `useGoogleServerAuth` needs a client id
    // AND googleServerAuthAvailable, and without both the auto-fetch effect never runs,
    // so Calendar and Mail stay empty no matter what the workspace route returns.
    if (url.includes("/api/app-config")) {
      return json({
        ai: { available: { gemini: true }, provider: "gemini", model: "gemini-3.1-flash-lite" },
        integrations: {
          googleClientId: "dev-mock.apps.googleusercontent.com",
          googleServerAuthAvailable: true,
        },
      });
    }
    if (url.includes("/api/google-workspace")) {
      // Must branch on the action. The app calls "status" first and treats a response
      // without `connected: true` as a dropped link — which parks it on "Reconnect
      // Google" and means "summary" is never requested at all.
      let action = "";
      try { action = JSON.parse(typeof init?.body === "string" ? init.body : "{}").action || ""; } catch (_) {}
      const accounts = [
        { email: "rabbidanziger@example.org", primary: true },
        { email: "ydanziger@example.com", primary: false },
      ];
      if (action === "status") return json({ connected: true, accounts });
      if (action === "summary") {
        return json({
          calendarEvents: mockCalendarEvents(),
          gmailMessages: mockGmailMessages(),
          accounts,
          errors: [],
        });
      }
      return json({ ok: true, connected: true, accounts });
    }
    if (url.includes("/api/phone-relay")) {
      if (url.includes("action=state")) return json(mockPhoneState());
      return json({ ok: true, queued: true });
    }
    if (url.includes("/api/ai-proxy")) {
      let bodyText = "";
      try { bodyText = typeof init?.body === "string" ? init.body : ""; } catch (_) {}
      return json(mockAiResponse(bodyText));
    }
    if (url.includes("/api/chief-profile")) {
      return json({ profile: { notes: "Preview profile — simulated content only." } });
    }
    if (url.includes("/api/debug-log")) return json({ ok: true });
    // Any other /api/* route: an empty OK beats a red console full of 404s.
    return json({ ok: true, mock: true });
  };

  // ---- Raw Firestore surface ---------------------------------------------
  // A few reads go straight to `db` instead of through Store: the AI-lane chip
  // (_system/ai-status, _system/ai-log) and both phone listeners (phone-relay/owner,
  // phone-relay/state). Left alone they retry permission-denied forever and the phone
  // card reads as offline. This shim answers those four documents and leaves anything
  // else as a harmless empty snapshot — it never reaches the network either way.
  try {
    const { db } = await import("./01-core.js");
    if (db && typeof db.collection === "function") {
      const snapFor = path => {
        const data = mockFirestoreDoc(path);
        return {
          exists: data != null,
          id: path.split("/").pop(),
          data: () => data || {},
          metadata: { fromCache: false, hasPendingWrites: false },
          docChanges: () => [],
          forEach: () => {},
          empty: data == null,
          docs: [],
        };
      };
      const docStub = path => ({
        onSnapshot: (onNext, _onError) => {
          const cb = typeof onNext === "function" ? onNext : onNext?.next;
          if (cb) setTimeout(() => { try { cb(snapFor(path)); } catch (_) {} }, 0);
          return () => {};
        },
        get: async () => snapFor(path),
        set: async () => {},
        update: async () => {},
        delete: async () => {},
        collection: sub => collectionStub(`${path}/${sub}`),
      });
      const collectionStub = base => ({
        doc: id => docStub(id ? `${base}/${id}` : base),
        where: () => collectionStub(base),
        orderBy: () => collectionStub(base),
        limit: () => collectionStub(base),
        onSnapshot: (onNext) => {
          const cb = typeof onNext === "function" ? onNext : onNext?.next;
          if (cb) setTimeout(() => { try { cb(snapFor(base)); } catch (_) {} }, 0);
          return () => {};
        },
        get: async () => snapFor(base),
      });
      db.collection = name => collectionStub(name);
    }
  } catch (_) { /* the shim is a nicety; the Store patches above carry the app */ }

  // The app only fetches Google data when it believes an account is already linked
  // (localStorage 'ot_google_connected'), so without this the Calendar and Mail cards
  // stay empty and the intercepted /api/google-workspace route is never called.
  try { localStorage.setItem("ot_google_connected", "1"); } catch (_) {}

  console.info(
    "%c[dev-mock] Simulated content clone active — no live data is being read or written. Use ?mock=0 for the empty app, or ?realauth=1 to sign in for real.",
    "color:#9A452B;font-weight:600",
  );
}

export { MOCK_TOKEN };
