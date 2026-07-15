const ALLOWED_ORIGINS = [
  "https://onetaskonly-app.web.app",
  "https://onetaskonly-app.firebaseapp.com",
  // RabbiMetrics (Firebase project rabbi-s-metrics) shares this gateway for its
  // AI score suggestions; its users authenticate with rabbi-s-metrics ID tokens
  // (see _requireUser in ai-proxy.js).
  "https://rabbimetrics.web.app",
  "https://rabbi-s-metrics.web.app",
  "https://rabbi-s-metrics.firebaseapp.com",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:4173",
];

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

const DEFAULT_PROVIDER = "gemini";
const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";
const QUOTA_FALLBACK_GEMINI_MODEL = "gemini-3.1-flash-lite";
// Last-resort fallback once every Gemini credential lane is genuinely exhausted (not on
// ordinary request errors). Haiku: cheap and fast, appropriate for a safety-net lane that
// should rarely fire and shouldn't run up cost when it does.
const CLAUDE_FALLBACK_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_CALENDAR_TIME_ZONE = "America/New_York";
const GEMINI_DEFAULT_SAFE_RPM = 4;
const GEMINI_DEFAULT_TPM = 200000;
// Queue wait + upstream fetch (20s) together must stay under the Netlify function budget
// (~26-30s): if a caller waits in the pacing queue past the Lambda wall it dies as
// Sandbox.Timedout (an opaque 502) instead of returning a clean 429 the client can back off from.
const GEMINI_QUEUE_TIMEOUT_MS = 8000;

const GEMINI_FREE_LIMITS = {
  "gemini-3.1-pro-preview": { rpm: 4, tpm: 250000, rpd: 90 },
  "gemini-3-flash-preview": { rpm: 8, tpm: 250000, rpd: 180 },
  "gemini-3.1-flash-lite": { rpm: 15, tpm: 250000, rpd: 1000 },
  "gemini-2.5-pro": { rpm: 5, tpm: 250000, rpd: 100 },
  "gemini-2.5-flash": { rpm: 10, tpm: 250000, rpd: 250 },
  "gemini-2.5-flash-lite": { rpm: 15, tpm: 250000, rpd: 1000 },
};

const GEMINI_MODELS = [
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
];

const MODEL_CATALOG = [
  { provider: "gemini", model: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview", tier: "frontier", note: "Advanced reasoning and coding; preview." },
  { provider: "gemini", model: "gemini-3-flash-preview",  label: "Gemini 3 Flash Preview",  tier: "fast",     note: "Frontier multimodal model at lower cost; preview." },
  { provider: "gemini", model: "gemini-3.1-flash-lite",   label: "Gemini 3.1 Flash-Lite",   tier: "budget",   note: "Fast, low-cost Gemini lane." },
];

const MODEL_IDS_BY_PROVIDER = {
  gemini: GEMINI_MODELS,
};

const GEMINI_CREDENTIALS = [
  { id: "primary", label: "Gemini Primary", env: "GEMINI_API_KEY" },
  { id: "overflow-01", label: "Gemini Overflow 01", env: "Gemini_Overflow_01" },
];

const geminiLimiterState = globalThis.__shamashGeminiLimiterState || {
  queue: Promise.resolve(),
  requestStarts: [],
  tokenStarts: [],
  perModelDaily: {},
};
globalThis.__shamashGeminiLimiterState = geminiLimiterState;
let firestoreLimiterDb = null;
let firestoreLimiterChecked = false;

function positiveIntEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function geminiLimitsFor(model) {
  const published = GEMINI_FREE_LIMITS[model] || GEMINI_FREE_LIMITS[DEFAULT_GEMINI_MODEL];
  // Default to the model's own published RPM: a single global safe-RPM (4) throttled the
  // 15-RPM flash-lite lane to pro-preview speed and starved the dashboard jobs into 429s.
  const safeRpm = positiveIntEnv("GEMINI_SAFE_RPM", published.rpm);
  const safeTpm = positiveIntEnv("GEMINI_SAFE_TPM", Math.min(GEMINI_DEFAULT_TPM, published.tpm));
  const modelRpd = positiveIntEnv(`GEMINI_SAFE_RPD_${model.replace(/[^A-Z0-9]/gi, "_").toUpperCase()}`, Math.floor(published.rpd * 0.9));
  return {
    rpm: Math.max(1, Math.min(safeRpm, published.rpm)),
    tpm: Math.max(1000, Math.min(safeTpm, published.tpm)),
    rpd: Math.max(1, Math.min(modelRpd, published.rpd)),
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pruneSince(list, cutoff) {
  while (list.length && list[0].at <= cutoff) list.shift();
}

function pacificDayKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function millisUntilNextPacificMidnight(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = Number(part.value);
    return acc;
  }, {});
  const elapsed = ((parts.hour * 60 + parts.minute) * 60 + parts.second) * 1000;
  return (24 * 60 * 60 * 1000) - elapsed;
}

function firestoreLimiter() {
  if (process.env.GEMINI_RATE_LIMIT_STORE === "memory") return null;
  if (firestoreLimiterChecked) return firestoreLimiterDb;
  firestoreLimiterChecked = true;

  try {
    const { getAdminDb } = require("./_config.cjs");
    firestoreLimiterDb = getAdminDb();
  } catch (e) {
    console.warn("[AI] Firestore rate limiter unavailable; using in-memory limiter:", e.message);
    firestoreLimiterDb = null;
  }

  return firestoreLimiterDb;
}

function estimateGeminiTokens(body) {
  let textChars = 0;
  let audioBytes = 0;

  function visit(value) {
    if (!value) return;
    if (typeof value === "string") {
      textChars += value.length;
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;
    const inline = value.inline_data || value.inlineData;
    if (inline?.data) {
      audioBytes += Math.ceil(String(inline.data).length * 0.75);
      return;
    }
    Object.entries(value).forEach(([key, child]) => {
      if (key !== "data") visit(child);
    });
  }

  visit(body?.systemInstruction || body?.system_instruction);
  visit(body?.contents);

  const textTokens = Math.ceil(textChars / 4);
  const audioTokens = Math.ceil(audioBytes / 320);
  return Math.max(1, textTokens + audioTokens + 64);
}

function reserveInState(state, model, estimatedTokens, now, credentialId = "primary") {
  const limits = geminiLimitsFor(model);
  const minuteWindowMs = 60000;
  const minIntervalMs = Math.ceil(minuteWindowMs / limits.rpm);
  const dayKey = pacificDayKey(new Date(now));
  const laneKey = `${credentialId}:${model}`;
  const daily = state.perModelDaily[laneKey] || { dayKey, count: 0 };
  if (daily.dayKey !== dayKey) {
    daily.dayKey = dayKey;
    daily.count = 0;
  }
  state.perModelDaily[laneKey] = daily;

  if (daily.count >= limits.rpd) {
    const retryAfterSecondsValue = Math.ceil(millisUntilNextPacificMidnight(new Date(now)) / 1000);
    throw httpError(429, `Gemini daily safety cap reached for ${credentialId}/${model}; retry after the Pacific-time quota reset.`, retryAfterSecondsValue);
  }

  pruneSince(state.requestStarts, now - minuteWindowMs);
  pruneSince(state.tokenStarts, now - minuteWindowMs);

  const recentRequests = state.requestStarts.filter(event => (event.credentialId || "primary") === credentialId);
  const recentTokenStarts = state.tokenStarts.filter(event => (event.credentialId || "primary") === credentialId);
  const recentTokens = recentTokenStarts.reduce((sum, event) => sum + event.tokens, 0);
  const lastStart = recentRequests.at(-1)?.at || 0;
  const spacingWait = Math.max(0, minIntervalMs - (now - lastStart));
  const rpmWait = recentRequests.length >= limits.rpm
    ? Math.max(0, minuteWindowMs - (now - recentRequests[0].at))
    : 0;
  const tpmWait = recentTokens + estimatedTokens > limits.tpm && recentTokenStarts.length
    ? Math.max(0, minuteWindowMs - (now - recentTokenStarts[0].at))
    : 0;
  const waitMs = Math.max(spacingWait, rpmWait, tpmWait);

  if (waitMs > 0) return { waitMs, limits };

  state.requestStarts.push({ at: now, model, credentialId });
  state.tokenStarts.push({ at: now, tokens: estimatedTokens, model, credentialId });
  daily.count += 1;
  return { waitMs: 0, limits, estimatedTokens };
}

async function reserveGeminiSlotWithFirestore(model, estimatedTokens, credentialId) {
  const db = firestoreLimiter();
  if (!db) return null;

  const ref = db.collection("_system").doc("gemini-rate-limiter");
  let reservation = null;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const state = {
      requestStarts: Array.isArray(data.requestStarts) ? data.requestStarts : [],
      tokenStarts: Array.isArray(data.tokenStarts) ? data.tokenStarts : [],
      perModelDaily: data.perModelDaily && typeof data.perModelDaily === "object" ? data.perModelDaily : {},
    };
    reservation = reserveInState(state, model, estimatedTokens, Date.now(), credentialId);
    if (reservation.waitMs <= 0) {
      tx.set(ref, { ...state, updatedAt: Date.now() });
    }
  });
  return reservation;
}

async function reserveGeminiSlotInMemory(model, estimatedTokens, started, credentialId) {
  const limits = geminiLimitsFor(model);

  while (Date.now() - started < GEMINI_QUEUE_TIMEOUT_MS) {
    const now = Date.now();
    const reservation = reserveInState(geminiLimiterState, model, estimatedTokens, now, credentialId);
    if (reservation.waitMs <= 0) return reservation;

    await sleep(Math.min(reservation.waitMs + Math.floor(Math.random() * 250), 5000));
  }

  throw httpError(429, "Gemini gateway is pacing requests to protect the quota; retry shortly.", 30);
}

// The Firestore reservation is a transaction on ONE shared document — every Gemini call
// from every client contends on it. Under load those transactions retry internally and can
// hang well past the Lambda budget, turning the rate limiter itself into the outage. Bound
// each attempt hard and fall back to the per-container in-memory limiter instead of hanging.
const FIRESTORE_RESERVE_TIMEOUT_MS = 4000;

async function reserveGeminiSlot(model, estimatedTokens, credentialId = "primary") {
  const started = Date.now();

  while (Date.now() - started < GEMINI_QUEUE_TIMEOUT_MS) {
    let reservation;
    try {
      reservation = await Promise.race([
        reserveGeminiSlotWithFirestore(model, estimatedTokens, credentialId),
        sleep(FIRESTORE_RESERVE_TIMEOUT_MS).then(() => { throw new Error("Firestore limiter reservation timed out (hot document)"); }),
      ]);
    } catch (e) {
      if (e?.statusCode) throw e; // real pacing/quota 429s pass through
      console.warn("[AI] Firestore limiter slow or contended; using in-memory limiter:", e.message);
      return reserveGeminiSlotInMemory(model, estimatedTokens, started, credentialId);
    }
    if (!reservation) return reserveGeminiSlotInMemory(model, estimatedTokens, started, credentialId);
    if (reservation.waitMs <= 0) return reservation;
    await sleep(Math.min(reservation.waitMs + Math.floor(Math.random() * 250), 5000));
  }

  throw httpError(429, "Gemini gateway is pacing requests to protect the quota; retry shortly.", 30);
}

function scheduleGeminiSlot(model, estimatedTokens, credentialId = "primary") {
  const run = () => reserveGeminiSlot(model, estimatedTokens, credentialId);
  const scheduled = geminiLimiterState.queue.then(run, run);
  geminiLimiterState.queue = scheduled.catch(() => {});
  return scheduled;
}

const YESHIVISH_SYSTEM = `You are assisting a rabbi and Orthodox Jewish community. You understand "Yeshivish", a dialect blending English with Hebrew, Aramaic, and Yiddish Torah terms.

Key vocabulary:
- shaila/shaylos/shailah = halachic question(s) | psak/paskening/posek = halachic ruling/decisor
- halacha = Jewish law | gemara = Talmud | mishnah = Mishna | chumash = Pentateuch | parsha = Torah portion
- Rashi/Tosafos = classic Talmud commentators | Rambam/Ramban/Shulchan Aruch/Mishna Berura = halachic authorities
- Shabbos = Sabbath | Yom Tov = Jewish holiday | Yom Kippur/Rosh Hashana/Pesach/Sukkos/Shavuos = major holidays
- davening/daven = prayer | shacharis/mincha/maariv/mussaf = morning/afternoon/evening/additional prayer
- shiur/shiurim = Torah class(es) | kollel = full-time Torah study institution | yeshiva = Torah academy
- beis medrash = Torah study hall | rosh yeshiva/rebbe = yeshiva head/teacher | bochur = yeshiva student
- chavrusa = study partner | machlokes = halachic dispute | svara = logical argument | pshat = simple meaning
- mutar/assur = permitted/forbidden | lechatchila/bedieved = ideally/after the fact
- d'oraisa/d'rabbanan = biblical/rabbinic level | safek = doubt | bittul = nullification | chazaka = presumption
- kashrus/kosher = dietary laws | treif = non-kosher | bishul = cooking | borer = selecting
- fleishig/milchig/pareve = meat/dairy/neutral | chalav yisrael = Jewish-supervised milk
- pas yisrael/bishul yisrael = Jewish-supervised bread/cooking | bishul akum = non-Jewish cooking
- toiveling/toiveled = immersing vessels in mikveh | mikvah = ritual bath | niddah = family purity laws
- kitniyos = legumes (Pesach) | chametz = leavened grain (forbidden on Pesach)
- mezuzah = doorpost parchment | tefillin = phylacteries | bracha/brachos = blessing(s)
- kiddush = Shabbos/Yom Tov sanctification | havdalah = end-of-Shabbos ceremony
- eruv = boundary enabling Shabbos carrying | melachos = forbidden Shabbos labors
- chatzos = halachic midday/midnight | shkiah = sunset | tzeis = nightfall | zman/zmanim = halachic time(s)
- bein hashmashos = twilight period | beis din = rabbinical court | geder = halachic boundary
- teshuvah = repentance | tzaddik = righteous person | tzedakah = charity | chasuna = wedding
- mazel tov = congratulations | sheva brachos = post-wedding celebrations
- Baruch Hashem / B"H = thank God | mamash = truly/literally | takeh = really/indeed
- tachlis = bottom line / practical point | nebech = unfortunately | klal = general rule
- nafka mina = practical halachic difference | nochri/goy = non-Jew | ger = convert

Interpret all content in this Torah, halachic, and Orthodox Jewish community context. When processing voice transcripts or tasks, recognize and correctly interpret these terms even when phonetically transcribed.`;

const AI_JOB_VERSION = "2026-05-18";

function truncateText(value, max = 4000) {
  const text = String(value || "");
  return text.length > max ? text.slice(0, max) : text;
}

function compactLines(lines) {
  return lines.filter(Boolean).join("\n\n");
}

function jsonBlock(value) {
  return JSON.stringify(value, null, 2);
}

function stripJsonFences(text) {
  return String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractJsonText(text, shape) {
  const clean = stripJsonFences(text);
  if (shape === "array") {
    const match = clean.match(/\[[\s\S]*\]/);
    return match ? match[0] : clean;
  }
  if (shape === "object") {
    const match = clean.match(/\{[\s\S]*\}/);
    return match ? match[0] : clean;
  }
  const arrayMatch = clean.match(/\[[\s\S]*\]/);
  const objectMatch = clean.match(/\{[\s\S]*\}/);
  return arrayMatch?.[0] || objectMatch?.[0] || clean;
}

function parseJsonOutput(text, shape) {
  return JSON.parse(extractJsonText(text, shape));
}

function validationError(message) {
  const e = new Error(message);
  e.isValidationError = true;
  return e;
}

function ensureArray(value, label = "output") {
  if (!Array.isArray(value)) throw validationError(`${label} must be an array`);
  return value;
}

function ensureObject(value, label = "output") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw validationError(`${label} must be an object`);
  return value;
}

function cleanString(value, max = 1000) {
  return truncateText(String(value || "").trim(), max);
}

function normalizeStringArray(value, maxItems = 30, maxLen = 500) {
  return ensureArray(value)
    .map(item => cleanString(item, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeNumberArray(value, maxItems = 100) {
  return ensureArray(value)
    .map(item => Number.parseInt(item, 10))
    .filter(Number.isFinite)
    .slice(0, maxItems);
}

function normalizeEmailInputs(emails = []) {
  return ensureArray(emails, "emails").slice(0, 20).map((email, index) => ({
    index: index + 1,
    subject: cleanString(email.subject, 180),
    from: cleanString(email.from, 140),
    date: cleanString(email.date, 80),
    body: cleanString(email.body || email.snippet, 380),
  }));
}

function normalizeItemInputs(items = []) {
  return ensureArray(items, "items").slice(0, 12).map(item => ({
    id: cleanString(item.id, 120),
    kind: cleanString(item.kind || "item", 40),
    source: cleanString(item.source || item.text, 600),
  })).filter(item => item.id && item.source);
}

function normalizeChiefContext(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const phone = source.phone && typeof source.phone === "object" && !Array.isArray(source.phone) ? source.phone : {};
  const profile = source.profile && typeof source.profile === "object" && !Array.isArray(source.profile) ? source.profile : {};
  return {
    currentTime: cleanString(source.currentTime, 80),
    localeTime: cleanString(source.localeTime, 120),
    tasks: ensureArray(source.tasks || [], "tasks").slice(0, 18).map(task => ({
      text: cleanString(task?.text, 300),
      priority: cleanString(task?.priority, 80),
      ageHours: Number.isFinite(Number(task?.ageHours)) ? Number(task.ageHours) : null,
    })).filter(task => task.text),
    shailos: ensureArray(source.shailos || [], "shailos").slice(0, 12).map(shaila => ({
      text: cleanString(shaila?.text, 300),
      status: cleanString(shaila?.status, 80),
    })).filter(shaila => shaila.text),
    calendar: ensureArray(source.calendar || [], "calendar").slice(0, 24).map(evt => ({
      id: cleanString(evt?.id, 120),
      sourceKey: cleanString(evt?.sourceKey, 80),
      freshnessKey: cleanString(evt?.freshnessKey, 80),
      summary: cleanString(evt?.summary, 220),
      start: cleanString(evt?.start, 80),
      end: cleanString(evt?.end, 80),
      label: cleanString(evt?.label, 120),
      now: !!evt?.now,
      past: !!evt?.past,
      special: !!evt?.special,
      routine: !!evt?.routine,
    })).filter(evt => evt.summary),
    emails: ensureArray(source.emails || [], "emails").slice(0, 12).map(email => ({
      id: cleanString(email?.id, 120),
      threadId: cleanString(email?.threadId, 120),
      sourceKey: cleanString(email?.sourceKey, 80),
      freshnessKey: cleanString(email?.freshnessKey, 80),
      from: cleanString(email?.from, 120),
      subject: cleanString(email?.subject, 220),
      summary: cleanString(email?.summary || email?.snippet, 280),
      date: cleanString(email?.date, 100),
    })).filter(email => email.subject || email.summary),
    phone: {
      online: !!phone.online,
      status: cleanString(phone.status, 140),
      unreadTexts: Number.isFinite(Number(phone.unreadTexts)) ? Number(phone.unreadTexts) : 0,
      missedCalls: Number.isFinite(Number(phone.missedCalls)) ? Number(phone.missedCalls) : 0,
      voicemailCount: Number.isFinite(Number(phone.voicemailCount)) ? Number(phone.voicemailCount) : 0,
      texts: ensureArray(phone.texts || [], "phone.texts").slice(0, 8).map(item => ({
        name: cleanString(item?.name, 120),
        preview: cleanString(item?.preview, 220),
        time: cleanString(item?.time, 80),
        unread: !!item?.unread,
      })).filter(item => item.name || item.preview),
      calls: ensureArray(phone.calls || [], "phone.calls").slice(0, 8).map(item => ({
        name: cleanString(item?.name, 120),
        kind: cleanString(item?.kind, 80),
        time: cleanString(item?.time, 80),
        needsReturnCall: !!item?.needsReturnCall,
      })).filter(item => item.name || item.kind),
    },
    profile: {
      notes: ensureArray(profile.notes || [], "profile.notes").slice(-20).map(note => cleanString(note, 260)).filter(Boolean),
    },
    learning: (() => {
      const l = source.learning;
      if (!l || typeof l !== "object" || Array.isArray(l)) return {};
      return {
        acceptedActionTypes: l.acceptedActionTypes && typeof l.acceptedActionTypes === "object" ? l.acceptedActionTypes : {},
        rejectedActionTypes: l.rejectedActionTypes && typeof l.rejectedActionTypes === "object" ? l.rejectedActionTypes : {},
        recentlyRejected: ensureArray(l.recentlyRejected || [], "learning.recentlyRejected")
          .slice(0, 10)
          .map(r => ({ textKey: cleanString(r?.textKey || "", 120), actionType: cleanString(r?.actionType || "", 80) }))
          .filter(r => r.textKey),
      };
    })(),
    sessionSuppressed: ensureArray(source.sessionSuppressed || [], "sessionSuppressed")
      .slice(0, 8)
      .map(s => cleanString(typeof s === "string" ? s : (s?.text || ""), 260))
      .filter(Boolean),
  };
}

function normalizeChiefBrief(value) {
  const o = ensureObject(value);
  return {
    brief: cleanString(o.brief || o.summary, 1400),
    summary: cleanString(o.summary || o.brief, 520),
    nextAction: cleanString(o.nextAction, 280),
    why: cleanString(o.why, 360),
    focusArea: cleanString(o.focusArea || "operations", 80),
    urgency: ["now", "today", "soon", "watch"].includes(o.urgency) ? o.urgency : "today",
    sources: normalizeStringArray(o.sources || [], 6, 80),
    signals: ensureArray(o.signals || [], "signals").slice(0, 6).map(s => ({
      area: cleanString(s?.area, 60),
      note: cleanString(s?.note, 200),
    })).filter(s => s.area && s.note),
  };
}

function normalizeChiefTaskSuggestions(value) {
  const o = Array.isArray(value) ? { suggestions: value } : ensureObject(value);
  return {
    suggestions: ensureArray(o.suggestions || []).slice(0, 4).map(item => ({
      text: cleanString(item?.text, 320),
      priorityId: cleanString(item?.priorityId || item?.priority, 80),
      source: cleanString(item?.source, 40),
      sourceKey: cleanString(item?.sourceKey, 80),
      freshnessKey: cleanString(item?.freshnessKey, 80),
      actionType: cleanString(item?.actionType, 40),
      sourceTitle: cleanString(item?.sourceTitle || item?.title, 220),
      reason: cleanString(item?.reason, 220),
    })).filter(item => item.text),
  };
}

function responseJsonInstruction(shape, schemaDescription) {
  return compactLines([
    `Return ONLY valid JSON ${shape === "array" ? "array" : "object"}. No markdown, no commentary.`,
    schemaDescription ? `Required shape:\n${schemaDescription}` : "",
  ]);
}

function normalizeShailaRecord(row) {
  const o = ensureObject(row, "shaila");
  return {
    askerName: cleanString(o.askerName || o.askedBy, 120),
    shailaContent: cleanString(o.shailaContent || o.content || o.shaila, 4000),
    answer: cleanString(o.answer, 4000),
    answererName: cleanString(o.answererName || o.answeredBy, 120),
    reasons: cleanString(o.reasons, 2000),
    synopsis: cleanString(o.synopsis, 200),
    parsedShaila: cleanString(o.parsedShaila || o.shailaContent || o.shaila, 5000),
  };
}

function normalizeConversationExtract(value) {
  const o = ensureObject(value);
  return {
    tasks: ensureArray(o.tasks || []).map(item => ({
      text: cleanString(item?.text, 500),
      priority: ["now", "today", "eventually"].includes(item?.priority) ? item.priority : "eventually",
      schedulingHint: item?.schedulingHint ? cleanString(item.schedulingHint, 200) : null,
    })).filter(item => item.text),
    completions: ensureArray(o.completions || []).map(item => ({
      text: cleanString(item?.text, 500),
      matchedTask: item?.matchedTask == null ? null : Number(item.matchedTask),
    })).filter(item => item.text),
    shailos: ensureArray(o.shailos || []).map(item => ({
      synopsis: cleanString(item?.synopsis, 200),
      content: cleanString(item?.content, 3000),
      askerName: item?.askerName ? cleanString(item.askerName, 160) : null,
      answer: cleanString(item?.answer, 3000),
    })).filter(item => item.synopsis || item.content),
    gotBacks: ensureArray(o.gotBacks || []).map(item => ({
      synopsis: cleanString(item?.synopsis, 300),
      matchedShailaIndex: item?.matchedShailaIndex == null ? null : Number(item.matchedShailaIndex),
    })).filter(item => item.synopsis),
    scheduleItems: ensureArray(o.scheduleItems || []).map(item => ({
      text: cleanString(item?.text, 500),
      when: item?.when ? cleanString(item.when, 200) : null,
      date: item?.date ? cleanString(item.date, 120) : null,
      time: item?.time ? cleanString(item.time, 120) : null,
      durationMinutes: Number.isFinite(Number(item?.durationMinutes)) ? Number(item.durationMinutes) : null,
      missingDetails: normalizeStringArray(item?.missingDetails || [], 4, 80),
      unclearReason: cleanString(item?.unclearReason, 260),
    })).filter(item => item.text),
    reminders: ensureArray(o.reminders || []).map(item => ({
      text: cleanString(item?.text, 500),
    })).filter(item => item.text),
  };
}

function normalizeBrainDumpExtract(value) {
  const o = Array.isArray(value) ? { tasks: value, scheduleItems: [] } : ensureObject(value);
  return {
    tasks: ensureArray(o.tasks || []).map(item => ({
      text: cleanString(item?.text, 600),
      priority: cleanString(item?.priority, 100),
    })).filter(item => item.text),
    scheduleItems: ensureArray(o.scheduleItems || []).map(item => ({
      text: cleanString(item?.text, 500),
      when: item?.when ? cleanString(item.when, 200) : null,
    })).filter(item => item.text),
  };
}

function dateTimeHasExplicitZone(value) {
  return /(?:z|[+-]\d{2}:?\d{2})$/i.test(String(value || "").trim());
}

function normalizeEventDatePart(part, defaultTimeZone = DEFAULT_CALENDAR_TIME_ZONE) {
  const o = ensureObject(part);
  const next = { ...o };
  if (next.timeZone) next.timeZone = cleanString(next.timeZone, 80);
  if (next.dateTime && !next.timeZone && !dateTimeHasExplicitZone(next.dateTime)) {
    next.timeZone = defaultTimeZone;
  }
  return next;
}

function normalizeCalendarEvent(value) {
  const o = ensureObject(value);
  if (!o.summary || !o.start || !o.end) throw validationError("calendar event requires summary, start, and end");
  const defaultTimeZone = cleanString(o.defaultTimeZone || o.timeZone || DEFAULT_CALENDAR_TIME_ZONE, 80) || DEFAULT_CALENDAR_TIME_ZONE;
  const { defaultTimeZone: _defaultTimeZone, timeZone: _timeZone, ...event } = o;
  return {
    ...event,
    summary: cleanString(o.summary, 300),
    start: normalizeEventDatePart(o.start, defaultTimeZone),
    end: normalizeEventDatePart(o.end, defaultTimeZone),
    reminders: o.reminders || { useDefault: false, overrides: [] },
  };
}

function normalizeColorSchemes(value) {
  return ensureArray(value).slice(0, 4).map(s => {
    const o = ensureObject(s, "scheme");
    return {
      id: cleanString(o.id, 40).toLowerCase().replace(/[^a-z0-9_-]/g, ""),
      name: cleanString(o.name, 80),
      bg: cleanString(o.bg, 20),
      bgW: cleanString(o.bgW, 20),
      card: cleanString(o.card, 20),
      text: cleanString(o.text, 20),
      tSoft: cleanString(o.tSoft, 20),
      tFaint: cleanString(o.tFaint, 20),
      brd: cleanString(o.brd, 20),
      brdS: cleanString(o.brdS, 20),
      grad: normalizeStringArray(o.grad || [], 3, 20),
    };
  }).filter(s => s.id && s.name && s.bg && s.text && s.grad.length === 3);
}

const AI_JOB_REGISTRY = {
  "transcribe.yeshivish.v1": {
    kind: "audio",
    task: "transcription",
    output: "text",
    genConfig: { temperature: 0, maxOutputTokens: 8192 },
    buildPrompt(input = {}) {
      const mode = cleanString(input.mode || input.taskMode || "plain", 40);
      const callerInstruction = cleanString(input.instruction || input.prompt, 1000);
      return compactLines([
        YESHIVISH_SYSTEM,
        `Job: verbatim audio transcription. Mode: ${mode}.`,
        "Transcribe exactly and faithfully. The speaker may use Yeshivish English, Hebrew, Yiddish, and halachic terms.",
        "Use standard spellings for common Torah terms when the audio is clear. Do not summarize, classify, invent missing words, or add meta-commentary.",
        callerInstruction,
        "Return only the transcript text.",
      ]);
    },
    normalizeText(text) {
      return cleanString(text, 50000);
    },
  },
  "conversation.extract.v1": {
    task: "conversation-extract",
    output: "json",
    shape: "object",
    genConfig: { temperature: 0.1, maxOutputTokens: 8192 },
    schema: '{"tasks":[{"text":"full description — who, what, context","priority":"now|today|eventually","schedulingHint":null}],"completions":[{"text":"...","matchedTask":null}],"shailos":[{"synopsis":"Topic: Core Question","content":"Is it permitted to...?","askerName":null,"answer":""}],"gotBacks":[{"synopsis":"...","matchedShailaIndex":null}],"scheduleItems":[{"text":"event title","when":null,"date":null,"time":null,"durationMinutes":null,"missingDetails":["date","time","duration"],"unclearReason":"what is unclear"}],"reminders":[{"text":"..."}]}',
    buildPrompt(input = {}) {
      return compactLines([
        YESHIVISH_SYSTEM,
        "You are extracting every actionable item from a Yeshivish English recording.",
        `Transcript:\n${truncateText(input.transcript, 20000)}`,
        `Current task queue:\n${truncateText(input.taskSnap || input.currentTasks || "(none)", 6000)}`,
        `Open shailos:\n${truncateText(input.shailaSnap || input.currentShailos || "(none)", 6000)}`,
        "Rules: Extract ONLY new items discussed in the transcript. Do NOT include any tasks from the 'Current task queue' in the 'tasks' output array. Do NOT include any shailos from the 'Open shailos' list in the 'shailos' output array. The current task queue and open shailos lists are provided ONLY so you can reference their 1-based indices in 'completions[].matchedTask' or 'gotBacks[].matchedShailaIndex' if the transcript mentions they are completed or resolved.",
        "Never merge unrelated items; preserve halachic/Jewish terms exactly.",
        "Halachic questions always go to shailos. Got-back answers go to gotBacks. Fixed-time appointments, meetings, calls at a date/time, deadlines with a time, and calendar entries go to scheduleItems even when details are incomplete.",
        "CLASSIFICATION GUARD — a shaila is ONLY an unresolved halachic question that needs a ruling (psak). Errands, phone calls, purchases, repairs, research, and follow-ups are tasks even when they involve halachic topics, rabbis, seforim, or shul matters. 'Look up the sugya' or 'call the posek back' is a TASK; the underlying question itself is a shaila only if the transcript actually poses it. When genuinely unsure whether something is a task or a shaila, put it in tasks.",
        "Never downgrade an intended calendar event into a task because date, time, or duration is missing. Put unclear fields as null and list them in missingDetails.",
        "For scheduleItems, text is only the event title/action, date is the spoken date if clear, time is the spoken start time if clear, durationMinutes is the duration if clear, and unclearReason explains ambiguity briefly.",
        "TASKS — write text with full context: include the person's name, what needs to be done, and any relevant detail. Bad: 'Call back'. Good: 'Call Mrs. Lerman about the stove kashrus question'. If the speaker mentions a specific date or time for the task (e.g. 'Tuesday at 3pm', 'this Sunday morning'), put that in schedulingHint; otherwise schedulingHint is null.",
        "SHAILOS — write content as a natural halachic question in question form: 'Is it permitted to...?', 'What is the halacha regarding...?', 'Can one...?'. Include the full scenario detail (the specific item, action, and circumstances). Extract askerName when a person's name is identifiable as the one who asked. If an answer or ruling was given in the recording, capture it verbatim in answer.",
        responseJsonInstruction("object", this.schema),
      ]);
    },
    validate: normalizeConversationExtract,
  },
  "task.optimize.basic.v1": {
    task: "task-optimize",
    output: "json",
    shape: "array",
    genConfig: { temperature: 0.1, maxOutputTokens: 2048 },
    schema: '[3,1,4,2]',
    buildPrompt(input = {}) {
      return compactLines([
        "You are a productivity optimizer for someone with ADHD.",
        `It is ${cleanString(input.dayName, 40)} at ${cleanString(input.timeStr, 40)}.`,
        `Priority levels, highest to lowest: ${cleanString(input.priorityLabels, 500)}`,
        "Rules: priority tier is the hard outer constraint; within a tier use urgency, staleness, MrsW timing, energy, and dependencies.",
        `Tasks:\n${truncateText(input.tasks || input.desc, 12000)}`,
        responseJsonInstruction("array", this.schema),
      ]);
    },
    validate: normalizeNumberArray,
  },
  "task.optimize.analysis.v1": {
    task: "task-optimize-analysis",
    output: "json",
    shape: "object",
    genConfig: { temperature: 0.1, maxOutputTokens: 3072 },
    schema: '{"order":[1,2],"alreadyOptimal":false,"insight":"Max 20 words using task names.","urgentOverride":null}',
    buildPrompt(input = {}) {
      return compactLines([
        "You are an elite executive function coach for someone with ADHD.",
        `Today is ${cleanString(input.dayName, 40)} at ${cleanString(input.timeStr, 40)} (${cleanString(input.energyContext, 200)}).`,
        "Reorder only the unpinned tasks. Pinned tasks are user locked. Use urgentOverride only for true exceptions.",
        `Pinned tasks:\n${truncateText(input.pinnedContext || "(none)", 4000)}`,
        `Unpinned tasks:\n${truncateText(input.unpinnedTasks || input.desc, 12000)}`,
        `Priority levels, highest to lowest: ${cleanString(input.priorityLabels, 500)}`,
        "Rules: priority first; then urgency, stale debt, one momentum win, energy-time fit, and group integrity.",
        responseJsonInstruction("object", this.schema),
      ]);
    },
    validate(value) {
      const o = ensureObject(value);
      return {
        order: normalizeNumberArray(o.order || []),
        alreadyOptimal: !!o.alreadyOptimal,
        insight: cleanString(o.insight, 220),
        urgentOverride: o.urgentOverride && typeof o.urgentOverride === "object"
          ? { taskNumber: Number(o.urgentOverride.taskNumber), reason: cleanString(o.urgentOverride.reason, 180) }
          : null,
      };
    },
  },
  "task.first_step.v1": {
    task: "task-first-step",
    output: "text",
    genConfig: { temperature: 0, maxOutputTokens: 80 },
    buildPrompt(input = {}) {
      return compactLines([
        "You are a task coach.",
        `Task: "${cleanString(input.taskText, 1000)}"`,
        'Give one concrete first step. Start with an action verb. Under 12 words. No vague "start working on it". Return only the step.',
      ]);
    },
  },
  "task.parse_brain_dump.v1": {
    task: "task-parse-brain-dump",
    output: "json",
    shape: "object",
    genConfig: { temperature: 0.1, maxOutputTokens: 4096 },
    schema: '{"tasks":[{"text":"task description","priority":"priority_id"}],"scheduleItems":[{"text":"event description","when":null}]}',
    buildPrompt(input = {}) {
      return compactLines([
        YESHIVISH_SYSTEM,
        "Parse this brain dump into individual actionable tasks and fixed-time schedule items.",
        `Priority options: ${cleanString(input.priorityOptions, 1000)}`,
        `Default priority if unclear: ${cleanString(input.lowestPriority, 80)}`,
        `Brain dump:\n${truncateText(input.text, 12000)}`,
        "Split compound sentences. Ignore filler. Fixed-time appointments, calls, meetings, deadlines with a date/time, and calendar entries go to scheduleItems only.",
        responseJsonInstruction("object", this.schema),
      ]);
    },
    validate: normalizeBrainDumpExtract,
  },
  "task.breakdown.v1": {
    task: "task-breakdown",
    output: "json",
    shape: "array",
    genConfig: { temperature: 0.2, maxOutputTokens: 1024 },
    schema: '["small concrete action step"]',
    buildPrompt(input = {}) {
      return compactLines([
        "You are a productivity assistant for ADHD.",
        `Task: "${cleanString(input.taskText, 1200)}"`,
        "Break it into 3 to 7 small concrete action steps. No time estimates.",
        responseJsonInstruction("array", this.schema),
      ]);
    },
    validate: value => normalizeStringArray(value, 7, 220),
  },
  "task.breakdown_revise.v1": {
    task: "task-breakdown-revise",
    output: "json",
    shape: "object",
    genConfig: { temperature: 0.2, maxOutputTokens: 1536 },
    schema: '{"explanation":"short explanation","steps":["updated step"]}',
    buildPrompt(input = {}) {
      return compactLines([
        "You are helping revise a task breakdown for ADHD-friendly execution.",
        `Task: "${cleanString(input.taskText, 1200)}"`,
        `Current steps:\n${jsonBlock(input.steps || [])}`,
        `User request: "${cleanString(input.userRequest, 1500)}"`,
        "Return an updated concise step list.",
        responseJsonInstruction("object", this.schema),
      ]);
    },
    validate(value) {
      const o = ensureObject(value);
      return { explanation: cleanString(o.explanation, 300), steps: normalizeStringArray(o.steps || [], 8, 220) };
    },
  },
  "task.unblock.v1": {
    task: "task-unblock",
    output: "text",
    genConfig: { temperature: 0.2, maxOutputTokens: 700 },
    buildPrompt(input = {}) {
      return compactLines([
        "An ADHD user is stuck on a task.",
        `Task: "${cleanString(input.taskText, 1000)}"`,
        input.ageDays ? `Waiting time: ${Number(input.ageDays)} days.` : "",
        `Obstacle: "${cleanString(input.obstacle, 1000)}"`,
        "Give exactly 3 concrete, practical suggestions. Each under 2 sentences. Format exactly as numbered lines 1, 2, 3.",
      ]);
    },
  },
  "dashboard.chief_of_staff.v1": {
    model: QUOTA_FALLBACK_GEMINI_MODEL, // high-frequency dashboard job: use the 1000/day flash-lite lane
    task: "dashboard-chief-of-staff",
    output: "json",
    shape: "object",
    genConfig: { temperature: 0.1, maxOutputTokens: 1200 },
    schema: '{"brief":"2-4 short declarative status statements — same clipped factual tone as signals, no framing or advice","summary":"terse comma-separated list of the actual items across all sources — name the thing not the category (e.g. \'Kashrus research, $100 CashApp transfer, bank account closure\'); no counts, no category nouns; trailing \'various [X] items\' if more remain","nextAction":"single concrete next move","why":"clear reason why this is the top priority right now","focusArea":"calendar|tasks|shailos|mail|phone|operations","urgency":"now|today|soon|watch","sources":["Calendar","Tasks"],"signals":[{"area":"Calendar","note":"terse Apple-notification-style condensed status for this area"}]}',
    buildPrompt(input = {}) {
      const context = normalizeChiefContext(input.context || input);
      return compactLines([
        YESHIVISH_SYSTEM,
        "You are the user's Chief of Staff. Your job is full situational awareness across every source — not just the next calendar item.",
        "Tone: calm, steady, and factual. State what is there without dramatizing it. The user is capable of handling what is in front of him — lay it out plainly, not urgently.",
        "Scan ALL sources equally: Calendar, Gmail, Tasks, Shailos, phone calls, and texts.",
        "Do NOT default to the next calendar item just because it exists. Weigh every source against actual consequence: What needs the user's attention first? What is waiting on a decision? What is happening or imminent?",
        "Missed calls, unread texts, unanswered shailos, and emails with clear asks are as valid as calendar events. Weigh them by real consequence, not source type.",
        "Routine calendar items (regular davening, standard learning sessions, recurring meetings) are background context only — not the next action unless happening right now or actively blocking work.",
        "Treat a missed call as actionable only when phone.missedCalls is positive or a call row has needsReturnCall true.",
        "Write 'brief': 2–4 short, clipped, declarative status statements. Same factual tone as the signals — state what is there, not what to do. No framing phrases, no 'you should', no advice. Write each sentence like a status line, e.g. 'You have 3 Now tasks. 1 missed call from Reuven. Next calendar item is Mincha at 4pm. 2 unread emails, top from Dr. Cohen.'",
        "Write 'summary': a terse comma-separated list of the actual named items across all sources — task text, email topics, shaila subjects, caller names, calendar events. Name the thing, not the category. Never use counts or category nouns ('3 tasks', '2 shailos', 'emails'). If more items exist than fit, end with 'various [X] items' (e.g. 'Kashrus research, $100 CashApp transfer, bank account closure, various household items'). One line, no periods.",
        "Pick 'nextAction': the single most useful concrete move across all sources. Write 'why' with clear reasoning — explain why this is the right next step.",
        "Write 'signals': one entry per area that has active data (Calendar, Mail, Tasks, Shailos, Phone). Each note is the area's status — what is there, not advice.",
        "Write every 'note' in Apple's notification-summary style: a terse, telegraphic condensation of the key facts. Drop articles, filler, and weak verbs where the meaning survives; lead with the most concrete fact; pack multiple items with commas or semicolons; sentence case; no preamble like 'You have' or 'There are'. Examples: 'Dentist 3pm; lunch with David 1pm'; 'From Chase: overdraft transfer made, split purchases with Pay in 4'; 'David, Mom, unknown'.",
        "Email accuracy: attribute an email ONLY to its 'from' field — never guess who wrote, initiated, or replied to a thread. Summarize only what the subject/summary text literally says; if it is too thin to be sure, state the subject plainly rather than paraphrasing into something it does not say.",
        "Do NOT restate the area's own name or a bare count of that area in its note — the UI already labels each line with its area. Say 'Pending: kashrus of the pot' not '2 shailos: kashrus of the pot'; say 'David, Mom' not '3 missed calls: David, Mom'.",
        "Use profile notes as durable preferences. If a note says avoid a reminder class, skip it unless clearly consequential.",
        "Do not invent facts, do not claim actions were taken, and do not give halachic rulings. If data is thin, say what is visible.",
        `Current snapshot:\n${jsonBlock(context)}`,
        context.sessionSuppressed?.length ? `Already dismissed this session — skip these and find something different:\n${jsonBlock(context.sessionSuppressed)}` : "",
        context.learning?.recentlyRejected?.length ? `Recently rejected across sessions — avoid unless clearly urgent:\n${jsonBlock(context.learning.recentlyRejected.map(r => r.textKey))}` : "",
        responseJsonInstruction("object", this.schema),
      ]);
    },
    validate: normalizeChiefBrief,
  },
  "dashboard.task_suggestions.v1": {
    model: QUOTA_FALLBACK_GEMINI_MODEL, // high-frequency dashboard job: use the 1000/day flash-lite lane
    task: "dashboard-task-suggestions",
    output: "json",
    shape: "object",
    genConfig: { temperature: 0.1, maxOutputTokens: 900 },
    schema: '{"suggestions":[{"text":"task to create","priorityId":"priority_id","source":"Calendar|Mail","sourceKey":"sourceKey from source row if available","freshnessKey":"freshnessKey from source row if available","actionType":"reply|call|confirm|prepare|schedule|send|pay|register|follow_up","sourceTitle":"source item","reason":"why this is taskable"}]}',
    buildPrompt(input = {}) {
      const context = normalizeChiefContext(input.context || input);
      const priorityOptions = ensureArray(input.priorityOptions || [], "priorityOptions").slice(0, 8).map(priority => ({
        id: cleanString(priority?.id, 80),
        label: cleanString(priority?.label, 120),
        rank: Number.isFinite(Number(priority?.rank)) ? Number(priority.rank) : null,
      })).filter(priority => priority.id);
      const existingTasks = ensureArray(input.existingTasks || [], "existingTasks").slice(0, 80).map(task => cleanString(task?.text || task, 260)).filter(Boolean);
      const learningProfile = input.learningProfile && typeof input.learningProfile === "object" && !Array.isArray(input.learningProfile)
        ? input.learningProfile
        : {};
      return compactLines([
        YESHIVISH_SYSTEM,
        "You are finding taskable follow-up items from Calendar and Gmail for an executive dashboard.",
        "Suggest only concrete user actions that are visible in the provided Calendar or Gmail data and are not already represented in existing tasks.",
        "Do not suggest routine calendar attendance by itself. Do suggest prep, reply, bring, call, send, confirm, register, pay, review, or deadline work when the source implies action.",
        "Choose one priorityId from the priority options. Use the highest priority only for urgent, same-day, blocking, or time-sensitive work.",
        "Use the learning profile and profile notes as preference signals: favor accepted action types and priority patterns; avoid action types or reminder classes the user repeatedly rejects unless the current source is clearly new or time-sensitive.",
        "When a source row has sourceKey or freshnessKey, copy those exact values into the suggestion.",
        `Priority options:\n${jsonBlock(priorityOptions)}`,
        `Learning profile:\n${jsonBlock(learningProfile)}`,
        `Profile notes:\n${jsonBlock(context.profile?.notes || [])}`,
        `Existing tasks:\n${jsonBlock(existingTasks)}`,
        `Calendar and Gmail snapshot:\n${jsonBlock({ currentTime: context.localeTime || context.currentTime, calendar: context.calendar, emails: context.emails })}`,
        "Return at most 4 suggestions. If nothing taskable is visible, return an empty suggestions array.",
        responseJsonInstruction("object", this.schema),
      ]);
    },
    validate: normalizeChiefTaskSuggestions,
  },
  "dashboard.river_rank.v1": {
    model: QUOTA_FALLBACK_GEMINI_MODEL, // high-frequency dashboard job: use the 1000/day flash-lite lane
    task: "dashboard-river-rank",
    output: "json",
    shape: "object",
    genConfig: { temperature: 0.1, maxOutputTokens: 8192 },
    schema: '{"ranking":[{"id":"item id copied exactly","score":"0-100 urgency","label":"terse 3-7 word restatement, no trailing punctuation","reason":"1-3 word priority tag e.g. deadline today / awaiting reply / payment due / routine"}]}',
    buildPrompt(input = {}) {
      const items = ensureArray(input.items || [], "items").slice(0, 100).map(it => ({
        id: cleanString(it?.id, 120),
        type: cleanString(it?.type, 20),
        text: cleanString(it?.text, 220),
        meta: cleanString(it?.meta, 100),
      })).filter(it => it.id);
      return compactLines([
        YESHIVISH_SYSTEM,
        "You are prioritizing ONE unified action list ('the river') that mixes tasks, shailos (halachic questions awaiting the rabbi's answer), calendar events, and emails for an executive.",
        "Give every item a 'score' from 0 to 100 for how much it needs his attention right now: 100 = urgent, time-critical, blocking, or a hard deadline; 0 = trivial, informational, no action.",
        "SHAILOS ARE ALWAYS THE HIGHEST PRIORITY. Any open shaila (type='shaila') MUST score 90 or above — a real person is waiting for a reply. Do not let any task, email, or calendar item outrank a shaila unless the shaila is marked as already answered.",
        "Weigh real consequence, not the source type. An email with a clear ask, a payment due, or a question awaiting reply can outrank a routine task. A newsletter, notification, or no-reply blast scores low. A meeting happening now or within the hour scores high; a routine recurring event scores low unless imminent.",
        "Score EVERY id you are given, exactly once, and copy each id verbatim. Do not invent ids or add commentary.",
        "Also write 'label': a terse 3-7 word restatement of what the item is — no fluff, no trailing punctuation. For an email, lead with what it actually wants.",
        "Also write 'reason': a 1-3 word tag for why it ranks where it does (e.g. 'deadline today', 'awaiting reply', 'payment due', 'happening now', 'routine', 'fyi').",
        `Current time: ${cleanString(input.currentTime, 80)}`,
        `Items:\n${jsonBlock(items)}`,
        responseJsonInstruction("object", this.schema),
      ]);
    },
    validate(value) {
      const o = ensureObject(value);
      return {
        ranking: ensureArray(o.ranking || [], "ranking").map(r => ({
          id: cleanString(r?.id, 120),
          score: Math.max(0, Math.min(100, Math.round(Number(r?.score)) || 0)),
          label: cleanString(r?.label, 80),
          reason: cleanString(r?.reason, 28),
        })).filter(r => r.id),
      };
    },
  },
  "dashboard.nervecenter_summary.v1": {
    model: QUOTA_FALLBACK_GEMINI_MODEL, // high-frequency dashboard job: use the 1000/day flash-lite lane
    task: "dashboard-nervecenter-summary",
    output: "json",
    shape: "object",
    genConfig: { temperature: 0.1, maxOutputTokens: 600 },
    schema: '{"supercrunch":"terse comma-separated list of the actual items across all sources — name the thing not the category; no counts, no category nouns; trailing \'various [X] items\' if more remain","signals":[{"area":"Calendar","note":"terse Apple-notification-style note for this area"}]}',
    buildPrompt(input = {}) {
      const context = normalizeChiefContext(input.context || input);
      return compactLines([
        YESHIVISH_SYSTEM,
        "You are generating two display strings for a NerveCenter dashboard header.",
        "Scan ALL sources: Calendar, Gmail, Tasks, Shailos, phone calls, and texts.",
        "Routine calendar items (regular davening, standard learning sessions, recurring meetings) are background context only. Calendar items marked past:true are already over — ignore them completely.",
        "Write 'supercrunch': a terse comma-separated list of the actual named items across all sources — task text, email topics, shaila subjects, caller names, calendar events. Name the thing, not the category. Never use counts or category nouns ('3 tasks', '2 shailos', 'emails'). If more items exist than fit, end with 'various [X] items'. One line, no periods. Example: 'Kashrus research, $100 CashApp transfer, bank account closure, various household items'.",
        "Cross-source coverage rule: before listing a second item from any one source, you must include the single most important item from every other active source. Tasks will often dominate the data — resist that bias. If calendar, mail, shailos, and phone each have active items, each gets at least one entry in supercrunch before any source gets a second entry.",
        "Write 'signals': one entry per area that has active data (Calendar, Mail, Tasks, Shailos, Phone). Each note is Apple notification-summary style: terse, telegraphic, leads with the most concrete fact. Drop articles and filler. Pack multiple items with commas or semicolons.",
        "Do NOT restate the area's own name or use bare counts in a note — the UI already labels each line. Say 'Pending: kashrus of the pot' not '2 shailos'; say 'David, Mom' not '3 missed calls: David, Mom'.",
        "Do not invent facts. If data is thin, say what is visible.",
        "Strict reliability rule: use ONLY facts visible in the snapshot. Do not infer names, deadlines, rulings, completed work, or actions taken.",
        "Strict ordering rule: order supercrunch items by perceived urgency/consequence. Do not explain the urgency and do not include labels like urgent, today, soon, category names, or counts.",
        "Length rule: supercrunch is one comma-separated line of item names. Signal notes are up to 5 words each, semicolon-separated when multiple items fit — use the full allowance so each note is self-explanatory, not cryptic.",
        "Strict omission rule: omit inactive categories from signals. If no source has active visible items, return an empty supercrunch and empty signals.",
        `Current snapshot:\n${jsonBlock(context)}`,
        responseJsonInstruction("object", this.schema),
      ]);
    },
    validate(value) {
      const o = ensureObject(value);
      return {
        supercrunch: cleanString(o.supercrunch, 220),
        signals: ensureArray(o.signals || [], "signals").slice(0, 6).map(s => ({
          area: cleanString(s?.area, 60),
          note: cleanString(s?.note, 200),
        })).filter(s => s.area && s.note),
      };
    },
  },
  "dashboard.snapshot.v1": {
    model: QUOTA_FALLBACK_GEMINI_MODEL, // consolidated page-load call: replaces separate nervecenter_summary + task_suggestions calls
    task: "dashboard-snapshot",
    output: "json",
    shape: "object",
    genConfig: { temperature: 0.1, maxOutputTokens: 1600 },
    schema: '{"supercrunch":"terse comma-separated list of actual items across all sources","signals":[{"area":"Calendar","note":"terse note"}],"taskSuggestions":[{"text":"task to create","priorityId":"priority_id","source":"Calendar|Mail","sourceKey":"","freshnessKey":"","actionType":"reply|call|confirm|prepare|schedule|send|pay|register|follow_up","sourceTitle":"source item","reason":"why taskable"}]}',
    buildPrompt(input = {}) {
      const context = normalizeChiefContext(input.context || input);
      const priorityOptions = ensureArray(input.priorityOptions || [], "priorityOptions").slice(0, 8).map(priority => ({
        id: cleanString(priority?.id, 80),
        label: cleanString(priority?.label, 120),
        rank: Number.isFinite(Number(priority?.rank)) ? Number(priority.rank) : null,
      })).filter(priority => priority.id);
      const existingTasks = ensureArray(input.existingTasks || [], "existingTasks").slice(0, 80).map(task => cleanString(task?.text || task, 260)).filter(Boolean);
      const learningProfile = input.learningProfile && typeof input.learningProfile === "object" && !Array.isArray(input.learningProfile)
        ? input.learningProfile : {};
      return compactLines([
        YESHIVISH_SYSTEM,
        "You are producing a consolidated dashboard snapshot in one pass — two outputs combined.",
        "",
        "PART 1 — NerveCenter summary. Scan ALL sources: Calendar, Gmail, Tasks, Shailos, phone calls, texts.",
        "Write 'supercrunch': a terse comma-separated list of the actual named items — task text, email topics, shaila subjects, caller names, calendar events. Name the thing, not the category. Never use counts or category nouns ('3 tasks', '2 shailos', 'emails'). End with 'various [X] items' if more remain. One line, no periods.",
        "Cross-source coverage rule: before listing a second item from any one source, include the single most important item from every other active source.",
        "Write 'signals': one entry per area that has active data (Calendar, Mail, Tasks, Shailos, Phone). Each note leads with the most concrete fact, up to 5 words, semicolons for multiple items. Be telegraphic but not cryptic — drop articles, keep context.",
        "Routine calendar items (regular davening, standard learning sessions, recurring meetings) are background context only. Calendar items marked past:true are already over — ignore them.",
        "Do NOT restate the area name or use bare counts in a note.",
        "",
        "PART 2 — Task suggestions. Find taskable follow-up items from Calendar and Gmail not already in existing tasks.",
        "Do not suggest routine calendar attendance. Do suggest prep, reply, bring, call, send, confirm, register, pay, review when the source implies action.",
        "Choose one priorityId from the priority options. Use highest priority only for urgent, same-day, blocking, or time-sensitive work.",
        "Use the learning profile as a preference signal: favor accepted action types; avoid repeatedly-rejected classes unless the source is clearly new or time-sensitive.",
        "When a source row has sourceKey or freshnessKey, copy those exact values into the suggestion.",
        `Priority options:\n${jsonBlock(priorityOptions)}`,
        `Learning profile:\n${jsonBlock(learningProfile)}`,
        `Profile notes:\n${jsonBlock(context.profile?.notes || [])}`,
        `Existing tasks:\n${jsonBlock(existingTasks)}`,
        `Current snapshot:\n${jsonBlock(context)}`,
        "Return at most 4 taskSuggestions. If nothing taskable, return an empty taskSuggestions array.",
        responseJsonInstruction("object", this.schema),
      ]);
    },
    validate(value) {
      const o = ensureObject(value);
      return {
        supercrunch: cleanString(o.supercrunch, 220),
        signals: ensureArray(o.signals || [], "signals").slice(0, 6).map(s => ({
          area: cleanString(s?.area, 60),
          note: cleanString(s?.note, 200),
        })).filter(s => s.area && s.note),
        taskSuggestions: ensureArray(o.taskSuggestions || [], "taskSuggestions").map(r => ({
          text: cleanString(r?.text, 260),
          priorityId: cleanString(r?.priorityId, 80),
          source: cleanString(r?.source, 40),
          sourceKey: cleanString(r?.sourceKey, 80),
          freshnessKey: cleanString(r?.freshnessKey, 80),
          actionType: cleanString(r?.actionType, 40),
          sourceTitle: cleanString(r?.sourceTitle, 160),
          reason: cleanString(r?.reason, 160),
        })).filter(r => r.text),
      };
    },
  },
  "dashboard.chief_dialogue.v1": {
    model: QUOTA_FALLBACK_GEMINI_MODEL, // high-frequency dashboard job: use the 1000/day flash-lite lane
    task: "dashboard-chief-dialogue",
    output: "text",
    genConfig: { temperature: 0.2, maxOutputTokens: 1100 },
    buildPrompt(input = {}) {
      const context = normalizeChiefContext(input.context || {});
      return compactLines([
        YESHIVISH_SYSTEM,
        "You are the user's Chief of Staff — advisor, scanner, and learner.",
        "If the user is correcting you, instructing you, or expressing a preference (e.g. 'I already handled that', 'focus on X not Y', 'stop suggesting Z', 'remember I prefer', 'going forward', 'you should know', 'train you'), acknowledge it warmly and confirm what you have noted. Say something like 'Got it — noted for future scans' or 'I will keep that in mind going forward.' Be specific about what preference you recorded.",
        "If the user asks a question or wants a different recommendation, answer concisely from the dashboard data. Be practical and direct.",
        "If the user asks what else is on the plate, summarize the other areas from the snapshot — do not repeat the dismissed item.",
        "Do not claim to send, schedule, call, or mark anything done in the real world — you can only advise and note preferences.",
        "If profile notes apply, honor them.",
        `Current snapshot:\n${jsonBlock(context)}`,
        input.brief ? `Current brief:\n${jsonBlock(input.brief)}` : "",
        input.history ? `Recent dialogue:\n${truncateText(input.history, 3000)}` : "",
        `User: ${cleanString(input.question, 1600)}`,
        "Answer in 2-6 sentences. If the user is training you, be specific about what preference you noted.",
      ]);
    },
    normalizeText(text) {
      return cleanString(text, 1600);
    },
  },
  "dashboard.email_summaries.v1": {
    model: QUOTA_FALLBACK_GEMINI_MODEL, // high-frequency dashboard job: use the 1000/day flash-lite lane
    task: "email-summary",
    output: "json",
    shape: "array",
    genConfig: { temperature: 0, maxOutputTokens: 800 },
    schema: '["1-2 direct sentences in the sender\'s voice — specific, no meta-commentary"]',
    buildPrompt(input = {}) {
      return compactLines([
        "Summarize each email in 1–2 punchy sentences written as if you are the sender speaking directly.",
        "ACCURACY IS THE FIRST RULE. Use ONLY facts literally present in the subject, from, and body fields. Never invent, infer, or embellish facts, times, dates, or rulings that are not stated.",
        "Attribution: the 'from' field is the ONLY person whose voice you may use. Never guess who wrote, initiated, or replied. If the body quotes or forwards someone else, do not present their words as the sender's.",
        "If the body/snippet is too thin to summarize confidently, fall back to a plain factual line built from the subject (e.g. 'Re: <subject> — from <sender name>'). A boring accurate line always beats a fluent guess.",
        "Use the sender's voice and tone. Include specifics: names, amounts, deadlines, links — but only ones that appear in the input.",
        "Never begin with 'This email', 'The sender', 'I wanted to', or any phrase that describes the email rather than delivering it.",
        "Examples of the right style: 'Your invoice for $840 is due Friday.' | 'Tickets available: $18/$36/$72 — book at adireit.com.' | 'Can we reschedule Thursday's call to 3pm?'",
        `Emails:\n${jsonBlock(normalizeEmailInputs(input.emails || []))}`,
        responseJsonInstruction("array", this.schema),
      ]);
    },
    validate: value => normalizeStringArray(value, 20, 240),
  },
  "dashboard.polish_items.v1": {
    model: QUOTA_FALLBACK_GEMINI_MODEL, // high-frequency dashboard job: use the 1000/day flash-lite lane
    task: "dashboard-polish",
    output: "json",
    shape: "array",
    genConfig: { temperature: 0, maxOutputTokens: 900 },
    schema: '[{"id":"same id","summary":"polished display text"}]',
    buildPrompt(input = {}) {
      return compactLines([
        YESHIVISH_SYSTEM,
        "Polish hurried personal task and shaila notes for a compact executive dashboard.",
        "Preserve meaning exactly. Do not add facts, names, dates, or rulings. Make each item clear, calm, and short. Max 12 words each.",
        `Items:\n${jsonBlock(normalizeItemInputs(input.items || []))}`,
        responseJsonInstruction("array", this.schema),
      ]);
    },
    validate(value) {
      return ensureArray(value).map(item => ({
        id: cleanString(item?.id, 120),
        summary: cleanString(item?.summary, 200),
      })).filter(item => item.id && item.summary);
    },
  },
  "schedule.parse_event.v1": {
    task: "schedule-parse",
    output: "json",
    shape: "object",
    genConfig: { temperature: 0, maxOutputTokens: 700 },
    schema: '{"summary":"...","start":{"dateTime":"RFC3339","timeZone":"America/New_York"},"end":{"dateTime":"RFC3339","timeZone":"America/New_York"},"reminders":{"useDefault":false,"overrides":[{"method":"popup","minutes":10}]}}',
    buildPrompt(input = {}) {
      const defaultTimeZone = cleanString(input.defaultTimeZone || DEFAULT_CALENDAR_TIME_ZONE, 80) || DEFAULT_CALENDAR_TIME_ZONE;
      return compactLines([
        `Today is ${cleanString(input.today, 40)}.`,
        `Default time zone: ${defaultTimeZone}.`,
        `Description: "${cleanString(input.description, 2000)}"`,
        "Parse this natural language event into a Google Calendar event body. Use all-day date fields only when the user clearly describes an all-day event.",
        `For timed events, include start.timeZone and end.timeZone. Use ${defaultTimeZone} unless the user explicitly says another time zone.`,
        responseJsonInstruction("object", this.schema),
      ]);
    },
    validate: normalizeCalendarEvent,
  },
  "analytics.insight.v1": {
    task: "analytics-insight",
    output: "text",
    genConfig: { temperature: 0.2, maxOutputTokens: 1000 },
    buildPrompt(input = {}) {
      return compactLines([
        "You are a professional productivity analyst. Analyze task completion data and provide a structured, data-driven summary.",
        "Do not compare completion times across priority tiers. Tone: professional, direct, useful.",
        `Priority tiers: ${cleanString(input.priorityTiers, 500)}`,
        `Data:\n${jsonBlock(input.data || {})}`,
        "Output exactly three bullet observations and one TAKEAWAY sentence. Reference specific numbers or task names.",
      ]);
    },
  },
  "analytics.chat.v1": {
    task: "analytics-chat",
    output: "text",
    genConfig: { temperature: 0.25, maxOutputTokens: 1400 },
    buildPrompt(input = {}) {
      return compactLines([
        "You are a warm, expert ADHD productivity analyst. Give detailed, data-driven answers from a supportive perspective.",
        "Do not compare completion times across priority tiers. Ground every insight in the user's actual data.",
        `Data snapshot:\n${jsonBlock(input.data || {})}`,
        input.previousChat ? `Previous chat:\n${truncateText(input.previousChat, 4000)}` : "",
        `User question: ${cleanString(input.question, 1200)}`,
        "Answer in 4-8 sentences. No headers.",
      ]);
    },
  },
  "dashboard.focus_suggestions.v1": {
    model: QUOTA_FALLBACK_GEMINI_MODEL, // same cheap/fast lane as the other dashboard jobs
    task: "focus-suggestions",
    output: "json",
    shape: "array",
    genConfig: { temperature: 0.3, maxOutputTokens: 500 },
    schema: '["one clear, positive-only sentence naming a specific task/shaila and why it is a good one to do now"]',
    buildPrompt(input = {}) {
      return compactLines([
        YESHIVISH_SYSTEM,
        "Look at everything on this person's plate and the days ahead, then pick exactly the THREE best things to focus on right now.",
        "Weigh industry-standard prioritization signals: how long something has waited, stated priority/urgency, and whether an upcoming calendar event (English or Hebrew/Jewish date) makes it more or less time-sensitive (e.g. a shaila or errand tied to an approaching Yom Tov).",
        "Tone is STRICTLY positive and encouraging - never say a thing is overdue, stale, critical, or has been neglected. Frame each pick as a good, doable next move, not a warning.",
        "Do not invent tasks, dates, or facts not present in the data below.",
        `Current time: ${cleanString(input.currentTime, 60)}. Hebrew date: ${cleanString(input.hebrewDate, 40)}.`,
        `Open tasks:\n${jsonBlock(ensureArray(input.tasks).slice(0, 60).map(t => ({
          text: cleanString(t?.text, 200), priority: cleanString(t?.priority, 40),
          ageHours: Number.isFinite(Number(t?.ageHours)) ? Math.round(Number(t.ageHours)) : null,
        })))}`,
        `Open shailos:\n${jsonBlock(ensureArray(input.shailos).slice(0, 30).map(s => ({
          text: cleanString(s?.text, 200), askedBy: cleanString(s?.askedBy, 80),
          ageHours: Number.isFinite(Number(s?.ageHours)) ? Math.round(Number(s.ageHours)) : null,
        })))}`,
        `Upcoming calendar (next few days, English + Hebrew/Jewish events alike):\n${jsonBlock(ensureArray(input.calendarEvents).slice(0, 40).map(e => ({
          summary: cleanString(e?.summary, 160), start: cleanString(e?.start, 60),
        })))}`,
        "Return exactly 3 items. Each item: one sentence, names the specific task/shaila, gives a brief positive reason (age/priority/upcoming-event context only if it genuinely applies). No harsh language, no edit/retry framing needed - this is a one-shot suggestion.",
        responseJsonInstruction("array", this.schema),
      ]);
    },
    validate: value => normalizeStringArray(value, 3, 240),
  },
  "settings.color_schemes.v1": {
    task: "settings-color-schemes",
    output: "json",
    shape: "array",
    genConfig: { temperature: 0.4, maxOutputTokens: 1800 },
    schema: '[{"id":"slug","name":"Name","bg":"#ffffff","bgW":"#ffffff","card":"#ffffff","text":"#111111","tSoft":"#333333","tFaint":"#666666","brd":"#cccccc","brdS":"#dddddd","grad":["#ffffff","#eeeeee","#dddddd"]}]',
    buildPrompt(input = {}) {
      return compactLines([
        "Generate 4 calm, relaxing color schemes for a minimal productivity app UI.",
        `Avoid duplicating existing schemes: ${normalizeStringArray(input.existingNames || [], 80, 80).join(", ")}`,
        "All colors must be low-saturation and readable. Use valid 6-digit hex strings.",
        responseJsonInstruction("array", this.schema),
      ]);
    },
    validate: normalizeColorSchemes,
  },
  "shaila.parse.simple.v1": {
    task: "shaila-parse-simple",
    output: "json",
    shape: "array",
    genConfig: { temperature: 0.1, maxOutputTokens: 4096 },
    schema: '[{"shaila":"clean question","answer":"clean ruling or null","askedBy":"name or null","answeredBy":"name or null"}]',
    buildPrompt(input = {}) {
      return compactLines([
        YESHIVISH_SYSTEM,
        "Extract and cleanly formulate each individual halachic question and any answer from this transcript.",
        "Preserve halachic content and terminology. Clean filler and false starts. Infer asker and answerer only when supported by context.",
        `Transcript:\n${truncateText(input.transcript, 18000)}`,
        responseJsonInstruction("array", this.schema),
      ]);
    },
    validate(value) {
      return ensureArray(value).map(item => ({
        shaila: cleanString(item?.shaila, 2000),
        answer: item?.answer ? cleanString(item.answer, 2000) : null,
        askedBy: item?.askedBy ? cleanString(item.askedBy, 160) : null,
        answeredBy: item?.answeredBy ? cleanString(item.answeredBy, 160) : null,
      })).filter(item => item.shaila);
    },
  },
  "shaila.parse.structured.v1": {
    task: "shaila-parse-structured",
    output: "json",
    shape: "object",
    genConfig: { temperature: 0.1, maxOutputTokens: 6144 },
    schema: '{"shailos":[{"askerName":"","shailaContent":"","answer":"","answererName":"","reasons":"","synopsis":"","parsedShaila":""}]}',
    buildPrompt(input = {}) {
      return compactLines([
        YESHIVISH_SYSTEM,
        "You are an expert transcriber and halachic query parser.",
        "Identify multiple distinct shailos or sub-shailos. Include answer, answerer, and reasons when present. If no answer was given, answer must be an empty string.",
        'Synopsis must be a concise complete thought, 3-8 words, formatted like "Topic: Core Question".',
        `Text:\n${truncateText(input.text || input.transcript, 20000)}`,
        responseJsonInstruction("object", this.schema),
      ]);
    },
    validate(value) {
      const o = ensureObject(value);
      return { shailos: ensureArray(o.shailos || []).map(normalizeShailaRecord).filter(s => s.shailaContent || s.parsedShaila) };
    },
  },
  "shaila.synopsis.v1": {
    task: "shaila-synopsis",
    output: "json",
    shape: "object",
    genConfig: { temperature: 0.1, maxOutputTokens: 120 },
    schema: '{"synopsis":"Topic: Core Question"}',
    buildPrompt(input = {}) {
      return compactLines([
        YESHIVISH_SYSTEM,
        "Create an extremely concise halachic synopsis, 3-8 words.",
        'Format: "Topic: Core Question" or "Topic: Specific Detail".',
        `Content: "${cleanString(input.content, 3000)}"`,
        responseJsonInstruction("object", this.schema),
      ]);
    },
    validate(value) {
      const o = ensureObject(value);
      const synopsis = cleanString(o.synopsis, 200);
      if (!synopsis) throw validationError("synopsis required");
      return { synopsis };
    },
  },
  "shaila.find_matches.v1": {
    task: "shaila-find-matches",
    output: "json",
    shape: "object",
    genConfig: { temperature: 0, maxOutputTokens: 700 },
    schema: '{"matchIds":["id"]}',
    buildPrompt(input = {}) {
      return compactLines([
        YESHIVISH_SYSTEM,
        "Compare a new shaila to existing shailos and identify likely follow-up, answer-call, or clarification matches.",
        `New shaila:\n${jsonBlock(input.newShaila || {})}`,
        `Existing shailos:\n${jsonBlock((input.existingShailos || []).slice(0, 80))}`,
        "Only include matches with reasonable probability. Order most likely first.",
        responseJsonInstruction("object", this.schema),
      ]);
    },
    validate(value) {
      const o = ensureObject(value);
      return { matchIds: normalizeStringArray(o.matchIds || [], 20, 120) };
    },
  },
  "shaila.detect_answers.v1": {
    model: QUOTA_FALLBACK_GEMINI_MODEL,
    task: "shaila-detect-answers",
    output: "json",
    shape: "array",
    genConfig: { temperature: 0.1, maxOutputTokens: 4096 },
    schema: '[{"id":"the_id","answer":"clean ruling text"}]',
    buildPrompt(input = {}) {
      return compactLines([
        YESHIVISH_SYSTEM,
        "These are halachic questions. Some have answers embedded in their text, usually in parentheses or as a following statement.",
        "Only return entries where an answer was actually found. Preserve full halachic meaning.",
        `Shailos:\n${truncateText(input.shailos || input.list, 18000)}`,
        responseJsonInstruction("array", this.schema),
      ]);
    },
    validate(value) {
      return ensureArray(value).map(item => ({
        id: cleanString(item?.id, 120),
        answer: cleanString(item?.answer, 2000),
      })).filter(item => item.id && item.answer);
    },
  },
  "shaila.match_answers_in_transcript.v1": {
    task: "shaila-match-answers",
    output: "json",
    shape: "array",
    genConfig: { temperature: 0, maxOutputTokens: 3072 },
    schema: '[{"id":"exact ID","shaila":"question text","answer":"extracted answer"}]',
    buildPrompt(input = {}) {
      return compactLines([
        YESHIVISH_SYSTEM,
        "Identify whether this transcript answers any listed open shailos.",
        `Open shailos:\n${truncateText(input.openShailos || "", 10000)}`,
        `Transcript:\n${truncateText(input.transcript, 16000)}`,
        "Only return confident matches. Partial or implied answers may be included when clearly present.",
        responseJsonInstruction("array", this.schema),
      ]);
    },
    validate(value) {
      return ensureArray(value).map(item => ({
        id: cleanString(item?.id, 120),
        shaila: cleanString(item?.shaila, 1200),
        answer: cleanString(item?.answer, 3000),
      })).filter(item => item.id && item.answer);
    },
  },
  "shaila.answer_summary.v1": {
    model: QUOTA_FALLBACK_GEMINI_MODEL,
    task: "shaila-answer-summary",
    output: "text",
    genConfig: { temperature: 0.1, maxOutputTokens: 40 },
    buildPrompt(input = {}) {
      return compactLines([
        YESHIVISH_SYSTEM,
        "Summarize this halachic answer in 4-6 words. Start with the ruling. Preserve key terms like mutar, assur, bedieved, lechatchila.",
        `Answer: ${truncateText(input.answerText || input.answer, 1000)}`,
        "Return only the summary.",
      ]);
    },
  },
  "shaila.research_queries.v1": {
    model: QUOTA_FALLBACK_GEMINI_MODEL,
    task: "shaila-research-queries",
    output: "json",
    shape: "object",
    genConfig: { temperature: 0, maxOutputTokens: 300 },
    schema: '{"queries":["query1","query2","query3"]}',
    buildPrompt(input = {}) {
      return compactLines([
        YESHIVISH_SYSTEM,
        "Generate 3 different Google search queries for this halachic or kashrut question.",
        "Query 1: broad halachic category. Query 2: exact product/scenario. Query 3: posek/agency perspective.",
        "Keep brand/product names when relevant. Include halacha, kosher, or kashrut in at least one query.",
        `Question: "${cleanString(input.shaila, 800)}"`,
        responseJsonInstruction("object", this.schema),
      ]);
    },
    validate(value) {
      const o = ensureObject(value);
      return { queries: normalizeStringArray(o.queries || [], 3, 240) };
    },
  },
  "shaila.research_followups.v1": {
    model: QUOTA_FALLBACK_GEMINI_MODEL,
    task: "shaila-research-followups",
    output: "json",
    shape: "object",
    genConfig: { temperature: 0, maxOutputTokens: 300 },
    schema: '{"followUpQueries":["query1","query2"]}',
    buildPrompt(input = {}) {
      return compactLines([
        YESHIVISH_SYSTEM,
        `A posek needs to research this shaila: "${cleanString(input.shaila, 800)}"`,
        `Initial search results:\n${truncateText(input.initialSnippets, 5000)}`,
        "If obvious gaps remain, generate 1-2 targeted follow-up search queries. If sufficient, return an empty array.",
        responseJsonInstruction("object", this.schema),
      ]);
    },
    validate(value) {
      const o = ensureObject(value);
      return { followUpQueries: normalizeStringArray(o.followUpQueries || [], 2, 240) };
    },
  },
  "shaila.research_summarize_sources.v1": {
    model: QUOTA_FALLBACK_GEMINI_MODEL,
    task: "shaila-research-sources",
    output: "json",
    shape: "object",
    genConfig: { temperature: 0, maxOutputTokens: 4096 },
    schema: '{"articles":[{"i":1,"label":"OU (Rabbi Hauer)","summary":"rules the bracha is ha-eitz","highlight":"short verbatim phrase"}],"seforim":[{"name":"Shulchan Aruch OC","location":"451:1"}]}',
    buildPrompt(input = {}) {
      return compactLines([
        YESHIVISH_SYSTEM,
        "You are a research assistant finding sources for a posek. Your job is quality over quantity — surface only the directly relevant rulings, and skip everything else.",
        `Shaila: "${cleanString(input.shaila, 1200)}"`,
        `Search results:\n${truncateText(input.articlesText, 24000)}`,
        "Return an 'articles' array with ONE object for each search result that is directly relevant. SKIP irrelevant results entirely — do not emit an object for them.",
        "Each article object has exactly these fields:",
        "  i: the result number shown in brackets — result [3] has i=3. This MUST equal the bracketed number, because the citation link is taken from that exact result. Getting i wrong sends the reader to the wrong webpage.",
        "  label: short attribution — org name and/or posek (e.g. 'Nishmat Yoatzot', 'Dinonline', 'Star-K', 'Rav Moshe Feinstein'). 2–5 words max.",
        "  summary: ONE sentence, the specific ruling or halachic finding for THIS shaila. START with the ruling itself — never with the source name, 'states that', 'notes that', or any attribution phrase. GOOD: 'Tevilah may be delayed when there is genuine need.' BAD: 'Nishmat Yoatzot states that tevilah may be delayed...'",
        "  highlight: a short verbatim phrase (3–10 words) copied exactly from THIS result's excerpt, used to scroll the reader to the relevant text.",
        "FILTER AGGRESSIVELY: omit any result that is (a) only tangentially related, (b) about a different halachic topic that merely shares a keyword, (c) a YouTube video, product listing, or general overview with no specific psak. Aim for only 5–8 genuinely relevant articles.",
        responseJsonInstruction("object", this.schema),
      ]);
    },
    validate(value) {
      const o = ensureObject(value);
      const articles = ensureArray(o.articles || [])
        .map(a => ({
          i: Number.parseInt(a?.i, 10),
          label: cleanString(a?.label, 60),
          summary: cleanString(a?.summary, 1000),
          highlight: cleanString(a?.highlight, 120),
        }))
        .filter(a => Number.isFinite(a.i) && a.summary)
        .slice(0, 15);
      return {
        articles,
        seforim: ensureArray(o.seforim || []).map(s => ({
          name: cleanString(s?.name, 160),
          location: cleanString(s?.location, 80),
        })).filter(s => s.name),
      };
    },
  },
};

function publicJobCatalog() {
  return Object.keys(AI_JOB_REGISTRY).sort().map(id => ({
    id,
    task: AI_JOB_REGISTRY[id].task,
    kind: AI_JOB_REGISTRY[id].kind || "text",
    output: AI_JOB_REGISTRY[id].output || "text",
  }));
}

function normalizeProvider(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "gemini") return v;
  return null;
}

function defaultTextProvider() {
  return normalizeProvider(process.env.AI_PROVIDER) || DEFAULT_PROVIDER;
}

function defaultProviderFor(kind, task) {
  if (kind === "audio") return "gemini";
  return defaultTextProvider();
}

function modelFor(provider, kind, task, requestedModel) {
  const requested = String(requestedModel || "").trim();
  const defaultModel = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const fallback = process.env.AI_MODEL || defaultModel;
  const allowed = GEMINI_MODELS;

  if (requested && allowed.includes(requested)) return requested;
  return allowed.includes(fallback) ? fallback : defaultModel;
}

function envValue(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function geminiCredentialCatalog() {
  return GEMINI_CREDENTIALS.map(credential => {
    const key = credential.id === "overflow-01"
      ? envValue("Gemini_Overflow_01", "GEMINI_OVERFLOW_01")
      : envValue(credential.env);
    return { ...credential, key, available: !!key };
  });
}

function publicGeminiCredentialCatalog() {
  return geminiCredentialCatalog().map(({ key, env, ...publicCredential }) => publicCredential);
}

function normalizeGeminiCredential(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "overflow" || v === "overflow_01" || v === "gemini_overflow_01") return "overflow-01";
  if (v === "primary" || v === "gemini" || v === "main") return "primary";
  if (v === "auto" || !v) return "auto";
  return GEMINI_CREDENTIALS.some(credential => credential.id === v) ? v : "auto";
}

function orderedGeminiCredentials(preferred = "auto") {
  const available = geminiCredentialCatalog().filter(credential => credential.available);
  if (!available.length) return [];
  const normalized = normalizeGeminiCredential(preferred);
  if (normalized === "auto") return available;
  return [
    ...available.filter(credential => credential.id === normalized),
    ...available.filter(credential => credential.id !== normalized),
  ];
}

function corsFor(event, methods = "POST, OPTIONS") {
  const origin = (event.headers.origin || event.headers.Origin || "").trim();
  const isAllowed = isAllowedOrigin(origin);
  return {
    isAllowed,
    headers: {
      "Access-Control-Allow-Origin": isAllowed ? (origin || ALLOWED_ORIGINS[0]) : ALLOWED_ORIGINS[0],
      // Authorization must be preflight-approved for cross-origin callers
      // (rabbimetrics.web.app sends its Firebase ID token in that header;
      // same-origin Shamash calls never preflight, so this only affects them).
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": methods,
    },
  };
}

function normalizeGeminiPart(part) {
  if (!part || typeof part !== "object") return part;
  if (part.inlineData) {
    return {
      inline_data: {
        mime_type: part.inlineData.mimeType || part.inlineData.mime_type || "application/octet-stream",
        data: part.inlineData.data,
      },
    };
  }
  if (part.inline_data) {
    return {
      inline_data: {
        mime_type: part.inline_data.mime_type || part.inline_data.mimeType || "application/octet-stream",
        data: part.inline_data.data,
      },
    };
  }
  return part;
}

function normalizeGeminiBody(body) {
  if (!body || typeof body !== "object") return body;
  const clone = { ...body };
  if (Array.isArray(clone.contents)) {
    clone.contents = clone.contents.map(content => ({
      ...content,
      parts: Array.isArray(content.parts) ? content.parts.map(normalizeGeminiPart) : content.parts,
    }));
  }
  return clone;
}

function extractGeminiText(data) {
  return data?.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("") || "";
}

function geminiBodyHasAudio(body) {
  return !!body?.contents?.some(content =>
    content?.parts?.some(part => part?.inline_data || part?.inlineData)
  );
}

function partsToText(parts) {
  return (parts || []).map(part => {
    if (part?.text) return part.text;
    if (part?.inline_data || part?.inlineData) return "[audio attachment]";
    return "";
  }).filter(Boolean).join("\n");
}

function geminiBodyToPrompt(body) {
  const sections = [];
  const systemParts = body?.systemInstruction?.parts || body?.system_instruction?.parts;
  const system = partsToText(systemParts);
  if (system) sections.push(system);
  for (const content of body?.contents || []) {
    const text = partsToText(content.parts);
    if (text) sections.push(text);
  }
  return sections.join("\n\n").trim();
}

function buildTextGeminiBody(prompt, genConfig = {}) {
  return {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 4096, ...genConfig },
  };
}

function buildAudioGeminiBody(base64, mimeType, prompt, genConfig = {}) {
  return {
    contents: [{ parts: [
      { inline_data: { mime_type: mimeType || "audio/wav", data: base64 } },
      { text: prompt || "Transcribe this audio exactly." },
    ] }],
    generationConfig: { temperature: 0, maxOutputTokens: 8192, ...genConfig },
  };
}

async function callGeminiOnce({ body, prompt, base64, mimeType, model, genConfig, credential }) {
  const requestBody = normalizeGeminiBody(body || (base64
    ? buildAudioGeminiBody(base64, mimeType, prompt, genConfig)
    : buildTextGeminiBody(prompt, genConfig)));
  const estimatedTokens = estimateGeminiTokens(requestBody);
  await scheduleGeminiSlot(model, estimatedTokens, credential.id);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${credential.key}`;
  const controller = new AbortController();
  // Must stay inside the ~30s Netlify function budget (together with the queue wait):
  // a hung upstream otherwise dies as Sandbox.Timedout instead of a clean retryable error.
  const fetchTimeout = setTimeout(() => controller.abort(), 20000);
  let r;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (e) {
    if (e?.name === "AbortError") throw httpError(504, "Gemini upstream timed out after 20s; retry shortly.", 15);
    throw e;
  } finally {
    clearTimeout(fetchTimeout);
  }

  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    const message = data?.error?.message || r.statusText || "Gemini API error";
    throw httpError(r.status || 502, message, retryAfterSeconds(r.headers, data));
  }

  return { provider: "gemini", model, credential: credential.id, text: extractGeminiText(data), raw: data };
}

async function callGemini({ body, prompt, base64, mimeType, model, genConfig, credential: preferredCredential, allowQuotaFallback = true }) {
  const credentials = orderedGeminiCredentials(preferredCredential);
  if (!credentials.length) throw httpError(500, "No Gemini API key configured in Firebase Functions env vars");

  const requestBody = normalizeGeminiBody(body || (base64
    ? buildAudioGeminiBody(base64, mimeType, prompt, genConfig)
    : buildTextGeminiBody(prompt, genConfig)));
  let lastError = null;

  for (const credential of credentials) {
    try {
      return await callGeminiOnce({
        body: requestBody,
        prompt,
        base64,
        mimeType,
        model,
        genConfig,
        credential,
      });
    } catch (e) {
      lastError = e;
      // Any 429 is worth trying the next credential lane, not just ones whose message
      // literally reads like a daily cap. A per-minute pacing-queue timeout on one
      // credential (reserveGeminiSlot giving up after GEMINI_QUEUE_TIMEOUT_MS) 429s with
      // a short retryAfter and a generic "pacing requests" message — that used to throw
      // straight through here without ever trying the overflow credential, which has its
      // own independent RPM/RPD budget and was very likely free. A burst of traffic on one
      // model (e.g. research's grounded search sharing the flash-lite lane with the
      // dashboard-polish job) could fill the primary lane's per-minute slot and silently
      // fail every caller on it instead of spilling over.
      if (e.statusCode !== 429) throw e;
      console.warn(`[AI] Gemini ${credential.id} returned 429 for ${model} (${e.message}); trying next credential lane.`);
    }
  }

  if (allowQuotaFallback && model !== QUOTA_FALLBACK_GEMINI_MODEL) {
    // The fallback model has its own independent quota lane, so there is nothing to wait
    // out — and a long sleep here overruns the Netlify function budget and turns every
    // daily-cap event into a Sandbox.Timedout 502. Brief jitter only, to de-thunder herds.
    await sleep(500 + Math.floor(Math.random() * 1000));
    return callGemini({
      body: requestBody,
      prompt,
      base64,
      mimeType,
      model: QUOTA_FALLBACK_GEMINI_MODEL,
      genConfig,
      credential: preferredCredential,
      allowQuotaFallback: false,
    });
  }

  throw lastError || httpError(429, "All Gemini credential lanes reached their daily safety cap.", 3600);
}

async function callClaude({ body, prompt, genConfig }) {
  const apiKey = process.env.ANTHROPIC_API_KEY || "";
  if (!apiKey) throw httpError(500, "ANTHROPIC_API_KEY not configured — Claude fallback is unavailable.");

  const input = prompt || geminiBodyToPrompt(body);
  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), 2 * 60 * 1000);
  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_FALLBACK_MODEL,
        max_tokens: maxOutputTokensFrom(genConfig, 4096),
        messages: [{ role: "user", content: input }],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(fetchTimeout);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    throw httpError(r.status || 502, data?.error?.message || r.statusText || "Claude API error", retryAfterSeconds(r.headers, data));
  }

  const text = data.content?.map(part => part.text || "").join("") || "";
  return { provider: "claude", model: CLAUDE_FALLBACK_MODEL, credential: "fallback", text, raw: data };
}

// ── Live AI-lane status ─────────────────────────────────────────────────────
// A small owner-visible record of which lane (Gemini primary / overflow / Claude
// fallback) is actually serving requests right now, and why it last switched. Kept
// cheap: an in-memory cache (mirrors the rate-limiter's globalThis pattern above)
// means we only touch Firestore when the lane actually changes, not on every call.
const aiLaneState = globalThis.__shamashAiLaneState || { currentLane: null };
globalThis.__shamashAiLaneState = aiLaneState;

const AI_LANE_LABELS = {
  "gemini:primary": "Gemini",
  "gemini:overflow-01": "Gemini · overflow",
  "claude:fallback": "Claude · fallback",
};

function laneIdFor(result) {
  if (result.provider === "claude") return "claude:fallback";
  return `gemini:${result.credential || "primary"}`;
}

async function recordAiLaneEvent(result, reason = "") {
  const lane = laneIdFor(result);
  if (lane === aiLaneState.currentLane) return; // no change — skip the Firestore write
  aiLaneState.currentLane = lane;

  const db = firestoreLimiter();
  if (!db) return;

  const label = AI_LANE_LABELS[lane] || lane;
  const ref = db.collection("_system").doc("ai-status");
  try {
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : {};
      const recent = Array.isArray(data.recent) ? data.recent : [];
      recent.push({ lane, label, at: Date.now(), reason: reason || "" });
      while (recent.length > 15) recent.shift();
      tx.set(ref, {
        currentLane: lane,
        label,
        provider: result.provider,
        model: result.model,
        updatedAt: Date.now(),
        recent,
      });
    });
  } catch (e) {
    console.warn("[AI] Failed to record lane status (non-fatal):", e.message);
  }
}

// Wraps callGemini with a genuine last-resort Claude tier. Only fires once every
// Gemini credential lane is truly exhausted (callGemini's own final throw) — never on
// ordinary request errors, which should surface to the caller as-is. Audio callers never
// reach this (Claude has no transcription capability; see the kind==="audio" gate in
// processAiPayload).
async function callWithFallback(common) {
  try {
    const result = await callGemini(common);
    recordAiLaneEvent(result).catch(() => {});
    return result;
  } catch (e) {
    if (e.statusCode !== 429) throw e;
    try {
      const result = await callClaude(common);
      recordAiLaneEvent(result, e.message || "Gemini exhausted").catch(() => {});
      return result;
    } catch (claudeError) {
      console.warn("[AI] Claude fallback also failed:", claudeError.message);
      throw e; // Gemini's exhaustion error is the more informative one for the caller
    }
  }
}

function maxOutputTokensFrom(genConfig = {}, fallback = 4096) {
  const value = Number.parseInt(genConfig.maxOutputTokens || genConfig.max_output_tokens || genConfig.max_tokens || "", 10);
  // Cap client-supplied token counts so a bad/hostile config can't run up cost.
  const MAX_ALLOWED = 32768;
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(value, MAX_ALLOWED);
}


function retryAfterSeconds(headers, data) {
  const retryAfter = headers?.get?.("retry-after");
  if (retryAfter) {
    const parsed = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(1, Math.ceil((date - Date.now()) / 1000));
  }
  const retryInfo = data?.error?.details?.find(detail => detail?.["@type"] === "type.googleapis.com/google.rpc.RetryInfo");
  const retryDelay = retryInfo?.retryDelay;
  const match = typeof retryDelay === "string" ? retryDelay.match(/^(\d+(?:\.\d+)?)s$/) : null;
  if (match) return Math.max(1, Math.ceil(Number(match[1])));
  return undefined;
}

function normalizeKind(payload) {
  const explicit = String(payload.kind || payload.type || "").trim().toLowerCase();
  if (explicit === "audio" || explicit === "transcription" || explicit === "audio_transcription") return "audio";
  if (payload.base64 || payload.audioBase64) return "audio";
  if (geminiBodyHasAudio(payload.body)) return "audio";
  return "text";
}

async function repairJsonJob({ jobId, job, input, text, parseError, payload, provider, model }) {
  const repairPrompt = compactLines([
    "Repair this AI job response so it matches the required JSON contract.",
    `Job: ${jobId}`,
    job.schema ? `Required shape:\n${job.schema}` : "",
    `Validation or parse error: ${parseError.message || String(parseError)}`,
    `Original input summary:\n${truncateText(JSON.stringify(input || {}), 3000)}`,
    `Previous response:\n${truncateText(text, 12000)}`,
    "Return ONLY corrected JSON. No markdown, no commentary.",
  ]);
  return processAiPayload({
    kind: "text",
    task: `${job.task || jobId}-repair`,
    provider,
    model,
    geminiCredential: payload.geminiCredential || payload.credential || payload.keyLane,
    prompt: repairPrompt,
    genConfig: {
      temperature: 0,
      maxOutputTokens: maxOutputTokensFrom(job.genConfig || {}, 4096),
    },
  });
}

async function runAiJobPayload(payload = {}) {
  const jobId = String(payload.job || payload.aiJob || "").trim();
  const job = AI_JOB_REGISTRY[jobId];
  if (!job) throw httpError(400, `Unknown AI job: ${jobId || "(missing)"}`);

  const input = payload.input && typeof payload.input === "object" ? payload.input : {};
  const kind = job.kind || normalizeKind(payload);
  const prompt = job.buildPrompt ? job.buildPrompt(input, payload) : (payload.prompt || payload.text || "");
  const provider = kind === "audio"
    ? "gemini"
    : (payload.provider || payload.aiProvider || undefined);
  // Per-job default model (job.model) lets high-frequency dashboard jobs run on the
  // high-quota flash-lite lane instead of burning the 90/day pro-preview cap.
  const model = payload.model || payload.aiModel || job.model || undefined;
  const genConfig = { ...(job.genConfig || {}), ...(payload.genConfig || {}) };
  const started = Date.now();
  const aiResult = await processAiPayload({
    kind,
    task: job.task || jobId,
    provider,
    model,
    geminiCredential: payload.geminiCredential || payload.credential || payload.keyLane,
    prompt,
    base64: input.base64 || payload.base64 || payload.audioBase64,
    mimeType: input.mimeType || payload.mimeType,
    genConfig,
  });

  const text = cleanString(aiResult.text || "", job.output === "text" ? 50000 : 100000);
  let output;

  if ((job.output || "text") === "json") {
    let parsed;
    try {
      parsed = parseJsonOutput(text, job.shape);
      output = job.validate ? job.validate(parsed, input) : parsed;
    } catch (parseError) {
      const repaired = await repairJsonJob({
        jobId,
        job,
        input,
        text,
        parseError,
        payload,
        provider: aiResult.provider,
        model: aiResult.model,
      });
      const repairedText = cleanString(repaired.text || "", 100000);
      // Guard the second parse: if even the repaired output is invalid JSON, return a
      // clear 422 instead of throwing an opaque 500 from the catch block.
      try {
        parsed = parseJsonOutput(repairedText, job.shape);
      } catch (repairParseError) {
        throw httpError(422, `AI job '${jobId}' returned invalid JSON even after repair: ${repairParseError?.message || repairParseError}`);
      }
      output = job.validate ? job.validate(parsed, input) : parsed;
      return {
        job: jobId,
        version: AI_JOB_VERSION,
        provider: repaired.provider,
        model: repaired.model,
        output,
        text: typeof output === "string" ? output : JSON.stringify(output),
        repaired: true,
        elapsedMs: Date.now() - started,
      };
    }
  } else {
    const normalized = job.normalizeText ? job.normalizeText(text, input) : text.trim();
    output = jobId === "transcribe.yeshivish.v1" ? { transcript: normalized } : normalized;
  }

  return {
    job: jobId,
    version: AI_JOB_VERSION,
    provider: aiResult.provider,
    model: aiResult.model,
    output,
    text: typeof output === "string" ? output : (output?.transcript || JSON.stringify(output)),
    elapsedMs: Date.now() - started,
  };
}

async function processAiPayload(payload = {}) {
  if (payload.job || payload.aiJob) return runAiJobPayload(payload);

  const task = String(payload.task || "").trim() || "general";
  const kind = normalizeKind(payload);
  const requestedProvider = normalizeProvider(payload.provider);
  const provider = requestedProvider || defaultProviderFor(kind, task);

  if (kind === "audio" && provider !== "gemini") {
    throw httpError(400, "Audio transcription is configured through the central gateway but requires a Gemini audio-capable provider.");
  }

  const model = modelFor(provider, kind, task, payload.model);

  const common = {
    body: payload.body,
    prompt: payload.prompt || payload.text || "",
    base64: payload.base64 || payload.audioBase64,
    mimeType: payload.mimeType,
    model,
    genConfig: payload.genConfig || {},
    credential: payload.geminiCredential || payload.credential || payload.keyLane,
  };

  return kind === "audio" ? callGemini(common) : callWithFallback(common);
}

function publicAiConfig() {
  const provider = defaultProviderFor("text", "general");
  const model = modelFor(provider, "text", "general");
  const { googleWorkspaceClientId, googleWorkspaceClientSecret, firebaseServiceAccount: _configSA } = require("./_config.cjs");
  const googleClientId = googleWorkspaceClientId();
  const googleClientSecret = googleWorkspaceClientSecret();
  const googleServerAuthAvailable = !!(googleClientId && googleClientSecret && _configSA());
  return {
    ai: {
      defaultProvider: provider,
      provider,
      model,
      textModel: model,
      audioModel: modelFor("gemini", "audio", "transcription"),
      researchModel: model,
      available: {
        gemini: geminiCredentialCatalog().some(credential => credential.available),
        claudeFallback: !!process.env.ANTHROPIC_API_KEY,
        googleSearch: !!(process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CSE_ID),
      },
      models: {
        gemini: GEMINI_MODELS,
      },
      catalog: MODEL_CATALOG,
      defaultGeminiCredential: "auto",
      credentialLanes: {
        gemini: publicGeminiCredentialCatalog(),
      },
      rateLimit: {
        strategy: "server-side queue",
        safeRpm: geminiLimitsFor(modelFor("gemini", "text", "general")).rpm,
        safeTpm: geminiLimitsFor(modelFor("gemini", "text", "general")).tpm,
        safeRpd: geminiLimitsFor(modelFor("gemini", "text", "general")).rpd,
      },
      jobs: publicJobCatalog(),
    },
    integrations: {
      googleClientId,
      googleAvailable: !!googleClientId,
      googleAuthMode: googleServerAuthAvailable ? "server" : "token",
      googleServerAuthAvailable,
    },
    googleClientId,
    geminiKey: geminiCredentialCatalog().some(credential => credential.available),
  };
}

function httpError(statusCode, message, retryAfterSecondsValue) {
  const e = new Error(message);
  e.statusCode = statusCode;
  if (retryAfterSecondsValue) e.retryAfterSeconds = retryAfterSecondsValue;
  return e;
}

module.exports = {
  corsFor,
  processAiPayload,
  publicAiConfig,
  callGemini,
  DEFAULT_GEMINI_MODEL,
};
