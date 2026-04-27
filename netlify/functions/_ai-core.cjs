const ALLOWED_ORIGINS = [
  "https://onetaskfocuser.netlify.app",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:4173",
];

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
];

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
  const isAllowed = !origin || ALLOWED_ORIGINS.includes(origin);
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

async function callGemini({ body, prompt, base64, mimeType, model, genConfig }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw httpError(500, "GEMINI_API_KEY not configured in Netlify env vars");

  const requestBody = normalizeGeminiBody(body || (base64
    ? buildAudioGeminiBody(base64, mimeType, prompt, genConfig)
    : buildTextGeminiBody(prompt, genConfig)));

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
    throw httpError(r.status || 502, data?.error?.message || r.statusText || "Gemini API error");
  }

  return { provider: "gemini", model, text: extractGeminiText(data), raw: data };
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
    },
    geminiKey: !!process.env.GEMINI_API_KEY,
  };
}

function httpError(statusCode, message) {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
}

module.exports = {
  corsFor,
  processAiPayload,
  publicAiConfig,
};
