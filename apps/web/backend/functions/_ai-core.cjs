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

const DEFAULT_PROVIDER = "gemini";
const DEFAULT_GEMINI_MODEL = "gemini-3.1-pro-preview";
const DEFAULT_OPENAI_MODEL = "gpt-5.5";
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";
const QUOTA_FALLBACK_GEMINI_MODEL = "gemini-3.1-flash-lite";
const GEMINI_DEFAULT_SAFE_RPM = 4;
const GEMINI_DEFAULT_TPM = 200000;
const GEMINI_QUEUE_TIMEOUT_MS = 55000;

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

const OPENAI_MODELS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
];

const CLAUDE_MODELS = [
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
];

const MODEL_CATALOG = [
  {
    provider: "gemini",
    model: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro Preview",
    tier: "frontier",
    note: "Advanced reasoning and coding; preview.",
  },
  {
    provider: "gemini",
    model: "gemini-3-flash-preview",
    label: "Gemini 3 Flash Preview",
    tier: "fast",
    note: "Frontier multimodal model at lower cost; preview.",
  },
  {
    provider: "gemini",
    model: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash-Lite",
    tier: "budget",
    note: "Fast, low-cost Gemini lane.",
  },
  {
    provider: "openai",
    model: "gpt-5.5",
    label: "GPT-5.5",
    tier: "frontier",
    note: "OpenAI flagship for complex reasoning and coding.",
  },
  {
    provider: "openai",
    model: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    tier: "fast",
    note: "Lower-latency, lower-cost OpenAI option.",
  },
  {
    provider: "openai",
    model: "gpt-5.4-nano",
    label: "GPT-5.4 Nano",
    tier: "budget",
    note: "Lowest-cost OpenAI option for focused jobs.",
  },
  {
    provider: "claude",
    model: "claude-opus-4-7",
    label: "Claude Opus 4.7",
    tier: "frontier",
    note: "Anthropic's strongest generally available model.",
  },
  {
    provider: "claude",
    model: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    tier: "fast",
    note: "Strong speed/intelligence balance.",
  },
  {
    provider: "claude",
    model: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    tier: "budget",
    note: "Fastest lower-cost Claude lane.",
  },
];

const MODEL_IDS_BY_PROVIDER = {
  gemini: GEMINI_MODELS,
  openai: OPENAI_MODELS,
  claude: CLAUDE_MODELS,
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

async function reserveGeminiSlot(model, estimatedTokens, credentialId = "primary") {
  const started = Date.now();

  while (Date.now() - started < GEMINI_QUEUE_TIMEOUT_MS) {
    const reservation = await reserveGeminiSlotWithFirestore(model, estimatedTokens, credentialId);
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
  if (v === "gemini" || v === "openai" || v === "claude") return v;
  if (v === "anthropic") return "claude";
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
  const defaultByProvider = {
    gemini: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    openai: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    claude: process.env.CLAUDE_MODEL || process.env.ANTHROPIC_MODEL || DEFAULT_CLAUDE_MODEL,
  };
  const fallback = process.env.AI_MODEL || defaultByProvider[provider] || DEFAULT_GEMINI_MODEL;
  const allowed = MODEL_IDS_BY_PROVIDER[provider] || GEMINI_MODELS;

  if (requested && allowed.includes(requested)) return requested;
  return allowed.includes(fallback) ? fallback : defaultByProvider[provider];
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

function isDailyQuotaError(status, message, retryAfterSecondsValue) {
  const text = String(message || "").toLowerCase();
  if (text.includes("daily safety cap") || text.includes("requestsperday") || text.includes("per day") || text.includes("rpd")) return true;
  if (status === 429 && retryAfterSecondsValue && retryAfterSecondsValue > 3600) return true;
  return false;
}

async function callGeminiOnce({ body, prompt, base64, mimeType, model, genConfig, credential }) {
  const requestBody = normalizeGeminiBody(body || (base64
    ? buildAudioGeminiBody(base64, mimeType, prompt, genConfig)
    : buildTextGeminiBody(prompt, genConfig)));
  const estimatedTokens = estimateGeminiTokens(requestBody);
  await scheduleGeminiSlot(model, estimatedTokens, credential.id);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${credential.key}`;
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
    throw httpError(r.status || 502, message, retryAfterSeconds(r.headers, data));
  }

  return { provider: "gemini", model, credential: credential.id, text: extractGeminiText(data), raw: data };
}

async function callGemini({ body, prompt, base64, mimeType, model, genConfig, credential: preferredCredential, allowQuotaFallback = true }) {
  const credentials = orderedGeminiCredentials(preferredCredential);
  if (!credentials.length) throw httpError(500, "No Gemini API key configured in Netlify env vars");

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
      if (!isDailyQuotaError(e.statusCode, e.message, e.retryAfterSeconds)) throw e;
      console.warn(`[AI] Gemini ${credential.id} hit daily quota for ${model}; trying next credential lane.`);
    }
  }

  if (allowQuotaFallback && model !== QUOTA_FALLBACK_GEMINI_MODEL) {
    await sleep(30000 + Math.floor(Math.random() * 5000));
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

function maxOutputTokensFrom(genConfig = {}, fallback = 4096) {
  const value = Number.parseInt(genConfig.maxOutputTokens || genConfig.max_output_tokens || genConfig.max_tokens || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function callOpenAI({ body, prompt, model, genConfig }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw httpError(500, "OPENAI_API_KEY not configured in Netlify env vars");

  const input = prompt || geminiBodyToPrompt(body);
  const requestBody = {
    model,
    input,
    max_output_tokens: maxOutputTokensFrom(genConfig, 4096),
  };

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    throw httpError(r.status || 502, data?.error?.message || r.statusText || "OpenAI API error", retryAfterSeconds(r.headers, data));
  }

  const text = data.output_text ||
    data.output?.flatMap(item => item.content || [])
      ?.map(part => part.text || "")
      ?.filter(Boolean)
      ?.join("") ||
    "";
  return { provider: "openai", model, text, raw: data };
}

async function callClaude({ body, prompt, model, genConfig }) {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) throw httpError(500, "ANTHROPIC_API_KEY not configured in Netlify env vars");

  const input = prompt || geminiBodyToPrompt(body);
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxOutputTokensFrom(genConfig, 4096),
      messages: [{ role: "user", content: input }],
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    throw httpError(r.status || 502, data?.error?.message || r.statusText || "Claude API error", retryAfterSeconds(r.headers, data));
  }

  const text = data.content?.map(part => part.text || "").join("") || "";
  return { provider: "claude", model, text, raw: data };
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

  const common = {
    body: payload.body,
    prompt: payload.prompt || payload.text || "",
    base64: payload.base64 || payload.audioBase64,
    mimeType: payload.mimeType,
    model,
    genConfig: payload.genConfig || {},
    credential: payload.geminiCredential || payload.credential || payload.keyLane,
  };

  if (provider === "openai") return callOpenAI(common);
  if (provider === "claude") return callClaude(common);
  return callGemini(common);
}

function publicAiConfig() {
  const provider = defaultProviderFor("text", "general");
  const model = modelFor(provider, "text", "general");
  const googleClientId = String(
    process.env.GOOGLE_CLIENT_ID ||
    process.env.GOOGLE_OAUTH_CLIENT_ID ||
    process.env.VITE_GOOGLE_CLIENT_ID ||
    ""
  ).trim();
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
        openai: !!process.env.OPENAI_API_KEY,
        claude: !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY),
        serper: !!process.env.SERPER_API_KEY,
      },
      models: {
        gemini: GEMINI_MODELS,
        openai: OPENAI_MODELS,
        claude: CLAUDE_MODELS,
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
    },
    integrations: {
      googleClientId,
      googleAvailable: !!googleClientId,
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
};
