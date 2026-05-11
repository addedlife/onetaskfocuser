const ALLOWED_ORIGINS = [
  "https://onetaskfocuser.netlify.app",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:4173",
];

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;

  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === "https:" && hostname.endsWith("--onetaskfocuser.netlify.app");
  } catch {
    return false;
  }
}

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const QUOTA_FALLBACK_GEMINI_MODEL = "gemini-2.5-flash-lite";
const GEMINI_DEFAULT_SAFE_RPM = 4;
const GEMINI_DEFAULT_TPM = 200000;
const GEMINI_QUEUE_TIMEOUT_MS = 55000;

const GEMINI_FREE_LIMITS = {
  "gemini-2.5-pro": { rpm: 5, tpm: 250000, rpd: 100 },
  "gemini-2.5-flash": { rpm: 10, tpm: 250000, rpd: 250 },
  "gemini-2.5-flash-lite": { rpm: 15, tpm: 250000, rpd: 1000 },
};

const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
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
  const safeRpm = positiveIntEnv("GEMINI_SAFE_RPM", GEMINI_DEFAULT_SAFE_RPM);
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

function firebaseServiceAccount() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson) return JSON.parse(rawJson);

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

function firestoreLimiter() {
  if (process.env.GEMINI_RATE_LIMIT_STORE === "memory") return null;
  if (firestoreLimiterChecked) return firestoreLimiterDb;
  firestoreLimiterChecked = true;

  try {
    const serviceAccount = firebaseServiceAccount();
    if (!serviceAccount) return null;
    const { cert, getApps, initializeApp } = require("firebase-admin/app");
    const { getFirestore } = require("firebase-admin/firestore");
    const app = getApps()[0] || initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.projectId || serviceAccount.project_id,
    });
    firestoreLimiterDb = getFirestore(app);
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

function reserveInState(state, model, estimatedTokens, now) {
  const limits = geminiLimitsFor(model);
  const minuteWindowMs = 60000;
  const minIntervalMs = Math.ceil(minuteWindowMs / limits.rpm);
  const dayKey = pacificDayKey(new Date(now));
  const daily = state.perModelDaily[model] || { dayKey, count: 0 };
  if (daily.dayKey !== dayKey) {
    daily.dayKey = dayKey;
    daily.count = 0;
  }
  state.perModelDaily[model] = daily;

  if (daily.count >= limits.rpd) {
    const retryAfterSecondsValue = Math.ceil(millisUntilNextPacificMidnight(new Date(now)) / 1000);
    throw httpError(429, `Gemini daily safety cap reached for ${model}; retry after the Pacific-time quota reset.`, retryAfterSecondsValue);
  }

  pruneSince(state.requestStarts, now - minuteWindowMs);
  pruneSince(state.tokenStarts, now - minuteWindowMs);

  const recentTokens = state.tokenStarts.reduce((sum, event) => sum + event.tokens, 0);
  const lastStart = state.requestStarts.at(-1)?.at || 0;
  const spacingWait = Math.max(0, minIntervalMs - (now - lastStart));
  const rpmWait = state.requestStarts.length >= limits.rpm
    ? Math.max(0, minuteWindowMs - (now - state.requestStarts[0].at))
    : 0;
  const tpmWait = recentTokens + estimatedTokens > limits.tpm && state.tokenStarts.length
    ? Math.max(0, minuteWindowMs - (now - state.tokenStarts[0].at))
    : 0;
  const waitMs = Math.max(spacingWait, rpmWait, tpmWait);

  if (waitMs > 0) return { waitMs, limits };

  state.requestStarts.push({ at: now, model });
  state.tokenStarts.push({ at: now, tokens: estimatedTokens, model });
  daily.count += 1;
  return { waitMs: 0, limits, estimatedTokens };
}

async function reserveGeminiSlotWithFirestore(model, estimatedTokens) {
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
    reservation = reserveInState(state, model, estimatedTokens, Date.now());
    if (reservation.waitMs <= 0) {
      tx.set(ref, { ...state, updatedAt: Date.now() });
    }
  });
  return reservation;
}

async function reserveGeminiSlotInMemory(model, estimatedTokens, started) {
  const limits = geminiLimitsFor(model);

  while (Date.now() - started < GEMINI_QUEUE_TIMEOUT_MS) {
    const now = Date.now();
    const reservation = reserveInState(geminiLimiterState, model, estimatedTokens, now);
    if (reservation.waitMs <= 0) return reservation;

    await sleep(Math.min(reservation.waitMs + Math.floor(Math.random() * 250), 5000));
  }

  throw httpError(429, "Gemini gateway is pacing requests to protect the quota; retry shortly.", 30);
}

async function reserveGeminiSlot(model, estimatedTokens) {
  const started = Date.now();

  while (Date.now() - started < GEMINI_QUEUE_TIMEOUT_MS) {
    const reservation = await reserveGeminiSlotWithFirestore(model, estimatedTokens);
    if (!reservation) return reserveGeminiSlotInMemory(model, estimatedTokens, started);
    if (reservation.waitMs <= 0) return reservation;
    await sleep(Math.min(reservation.waitMs + Math.floor(Math.random() * 250), 5000));
  }

  throw httpError(429, "Gemini gateway is pacing requests to protect the quota; retry shortly.", 30);
}

function scheduleGeminiSlot(model, estimatedTokens) {
  const run = () => reserveGeminiSlot(model, estimatedTokens);
  const scheduled = geminiLimiterState.queue.then(run, run);
  geminiLimiterState.queue = scheduled.catch(() => {});
  return scheduled;
}

const YESHIVISH_SYSTEM = `You are assisting a rabbi and Orthodox Jewish community. You understand "Yeshivish", a dialect blending English with Hebrew, Aramaic, and Yiddish Torah terms.

Key vocabulary:
- shaila/shaylos = halachic question(s) | psak/paskening = halachic ruling
- halacha = Jewish law | gemara = Talmud | mishnah = Mishna | chumash = Pentateuch
- Rashi/Tosafos = classic Talmud commentators | Rambam/Ramban = medieval authorities
- Shabbos = Sabbath | Yom Tov = Jewish holiday | davening = prayer
- shiur = Torah class | kollel = full-time Torah study institution
- beis medrash = Torah study hall | rosh yeshiva = yeshiva head
- chavrusa = study partner | machlokes = halachic dispute | svara = logical argument
- mutar/assur = permitted/forbidden | kashrus = dietary laws | treif = non-kosher
- fleishig/milchig/pareve = meat / dairy / neutral | mikvah = ritual bath
- mezuzah = doorpost parchment | tefillin = phylacteries | bracha = blessing
- kiddush = Shabbos wine sanctification | teshuvah = repentance
- tzaddik = righteous person | tzedakah = charity | chasuna = wedding
- mazel tov = congratulations | Baruch Hashem / B"H = thank God / with God's help
- pshat = simple meaning | tachlis = bottom line / practical point

Interpret all content in this Torah, halachic, and Orthodox Jewish community context. When processing voice transcripts or tasks, recognize and correctly interpret these terms even when phonetically transcribed.`;

function normalizeProvider(value) {
  const v = String(value || "").trim().toLowerCase();
  return v === "gemini" || v === "claude" ? "gemini" : null;
}

function defaultTextProvider() {
  return "gemini";
}

function defaultProviderFor(kind, task) {
  return "gemini";
}

function modelFor(provider, kind, task, requestedModel) {
  const requested = String(requestedModel || "").trim();
  const fallback =
    process.env.AI_MODEL ||
    process.env.GEMINI_MODEL ||
    DEFAULT_GEMINI_MODEL;

  if (requested && GEMINI_MODELS.includes(requested)) return requested;
  return GEMINI_MODELS.includes(fallback) ? fallback : DEFAULT_GEMINI_MODEL;
}

function corsFor(event, methods = "POST, OPTIONS") {
  const origin = (event.headers.origin || event.headers.Origin || "").trim();
  const isAllowed = isAllowedOrigin(origin);
  return {
    isAllowed,
    headers: {
      "Access-Control-Allow-Origin": isAllowed ? (origin || ALLOWED_ORIGINS[0]) : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Headers": "Content-Type",
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

async function callGemini({ body, prompt, base64, mimeType, model, genConfig, allowQuotaFallback = true }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw httpError(500, "GEMINI_API_KEY not configured in Netlify env vars");

  const requestBody = normalizeGeminiBody(body || (base64
    ? buildAudioGeminiBody(base64, mimeType, prompt, genConfig)
    : buildTextGeminiBody(prompt, genConfig)));
  const estimatedTokens = estimateGeminiTokens(requestBody);
  await scheduleGeminiSlot(model, estimatedTokens);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);
  let r;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(fetchTimeout);
  }

  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    const message = data?.error?.message || r.statusText || "Gemini API error";
    if (allowQuotaFallback && r.status === 429 && model !== QUOTA_FALLBACK_GEMINI_MODEL) {
      await sleep(30000 + Math.floor(Math.random() * 5000));
      return callGemini({
        body: requestBody,
        prompt,
        base64,
        mimeType,
        model: QUOTA_FALLBACK_GEMINI_MODEL,
        genConfig,
        allowQuotaFallback: false,
      });
    }
    throw httpError(r.status || 502, message, retryAfterSeconds(r.headers, data));
  }

  return { provider: "gemini", model, text: extractGeminiText(data), raw: data };
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

async function processAiPayload(payload = {}) {
  const task = String(payload.task || "").trim() || "general";
  const kind = normalizeKind(payload);
  const requestedProvider = normalizeProvider(payload.provider);
  const provider = requestedProvider || defaultProviderFor(kind, task);

  if (kind === "audio" && provider !== "gemini") {
    throw httpError(400, "Audio transcription is configured through the central gateway but requires a Gemini audio-capable provider.");
  }

  const model = modelFor(provider, kind, task, payload.model);

  return callGemini({
    body: payload.body,
    prompt: payload.prompt || payload.text || "",
    base64: payload.base64 || payload.audioBase64,
    mimeType: payload.mimeType,
    model,
    genConfig: payload.genConfig || {},
  });
}

function publicAiConfig() {
  const model = modelFor("gemini", "text", "general");
  const googleClientId = String(
    process.env.GOOGLE_CLIENT_ID ||
    process.env.GOOGLE_OAUTH_CLIENT_ID ||
    process.env.VITE_GOOGLE_CLIENT_ID ||
    ""
  ).trim();
  return {
    ai: {
      defaultProvider: "gemini",
      provider: "gemini",
      model,
      textModel: model,
      audioModel: model,
      researchModel: model,
      available: {
        gemini: !!process.env.GEMINI_API_KEY,
        serper: !!process.env.SERPER_API_KEY,
      },
      models: {
        gemini: GEMINI_MODELS,
      },
      rateLimit: {
        strategy: "server-side queue",
        safeRpm: geminiLimitsFor(model).rpm,
        safeTpm: geminiLimitsFor(model).tpm,
        safeRpd: geminiLimitsFor(model).rpd,
      },
    },
    integrations: {
      googleClientId,
      googleAvailable: !!googleClientId,
    },
    googleClientId,
    geminiKey: !!process.env.GEMINI_API_KEY,
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
};
