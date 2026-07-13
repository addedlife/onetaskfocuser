// ── Shailos AI pipeline ──────────────────────────────────────────────────────
// Direct port of apps/shailos/src/services/geminiService.ts into the main app
// (the Shailos Tracker is native now — no iframe, no second Firebase client).
// All calls route through the same auth-gated gateways the standalone used:
//   /api/ai-proxy      — AI jobs (transcribe/parse/synopsis/research/summary)
//   /api/google-search — web search for the research flow
// The caller passes the signed-in Firebase user so we can attach an ID token.

const AI_PROXY = "/api/ai-proxy";
const SERPER_PROXY = "/api/google-search";

function getSharedAiConfig() {
  try {
    return JSON.parse(localStorage.getItem("onetask_ai_config") || "{}");
  } catch {
    return {};
  }
}

async function runAiJob(user, job, input, task = "shailos") {
  const cfg = getSharedAiConfig();
  const provider = cfg.provider || cfg.aiProvider || "gemini";
  const model = cfg.model || "";
  const geminiCredential = cfg.geminiCredential || cfg.aiGeminiCredential || "auto";
  const headers = { "Content-Type": "application/json" };
  try {
    const idToken = user?.getIdToken ? await user.getIdToken() : null;
    if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
  } catch { /* no signed-in user → proxy will 401, surfaced below */ }
  const r = await fetch(AI_PROXY, {
    method: "POST",
    headers,
    body: JSON.stringify({ job, input, task, provider, model, geminiCredential }),
  });
  const data = await r.json().catch(() => ({ error: r.statusText }));
  if (!r.ok) throw new Error(data.error || "AI gateway error");
  if (data.error) throw new Error(data.error);
  return data.output ?? data.text ?? data.raw ?? data;
}

function blobToBase64(blob) {
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onloadend = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("Audio read failed"));
    reader.readAsDataURL(blob);
  });
}

// Browsers record webm/opus; Gemini transcribes far more reliably from plain
// 16 kHz mono WAV, so decode + resample client-side before upload.
async function webmToWavBase64(webmBlob) {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor || !window.OfflineAudioContext) throw new Error("Audio conversion unavailable");

  const arrayBuf = await webmBlob.arrayBuffer();
  const audioCtx = new AudioContextCtor();
  let decoded;
  try {
    decoded = await audioCtx.decodeAudioData(arrayBuf);
  } finally {
    audioCtx.close();
  }

  const sampleRate = 16000;
  const frameCount = Math.max(1, Math.ceil(decoded.duration * sampleRate));
  const offline = new OfflineAudioContext(1, frameCount, sampleRate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  const pcm = rendered.getChannelData(0);

  const dataLen = pcm.length * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + dataLen, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, dataLen, true);
  let o = 44;
  for (let i = 0; i < pcm.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return blobToBase64(new Blob([buf], { type: "audio/wav" }));
}

async function audioPartForGemini(blob) {
  try {
    return { mimeType: "audio/wav", data: await webmToWavBase64(blob) };
  } catch {
    return { mimeType: blob.type || "audio/webm", data: await blobToBase64(blob) };
  }
}

export async function transcribeAudio(user, blob, prompt) {
  const inline = await audioPartForGemini(blob);
  const data = await runAiJob(user, "transcribe.yeshivish.v1", {
    base64: inline.data,
    mimeType: inline.mimeType,
    instruction: prompt,
    mode: "shailos",
  }, "transcription");
  return typeof data === "string" ? data : (data?.transcript || "");
}

export async function generateSynopsis(user, content) {
  const data = await runAiJob(user, "shaila.synopsis.v1", { content });
  return data?.synopsis || "";
}

export async function transcribeAndParse(user, content, isAudio) {
  let text = "";
  if (isAudio && content instanceof Blob) {
    text = await transcribeAudio(
      user,
      content,
      "Transcribe this audio exactly and faithfully. The speakers may use Yeshivish English, Hebrew, Yiddish, and halachic terms. Do not summarize or classify. Return only the transcript."
    );
  } else {
    text = String(content || "");
  }
  const data = await runAiJob(user, "shaila.parse.structured.v1", { text });
  return data?.shailos || [];
}

export async function findPotentialMatches(user, newShaila, existingShailos) {
  if (!existingShailos.length) return [];
  const existingList = existingShailos.map(s => ({ id: s.id, synopsis: s.synopsis, asker: s.askerName }));
  const data = await runAiJob(user, "shaila.find_matches.v1", { newShaila, existingShailos: existingList });
  return data?.matchIds || [];
}

// Classical seforim available on Sefaria — maps to Sefaria URL path
const SEFARIA_NAMES = {
  "shulchan aruch oc":          "Shulchan_Aruch,_Orach_Chayim",
  "shulchan aruch orach chayim":"Shulchan_Aruch,_Orach_Chayim",
  "shulchan aruch yd":          "Shulchan_Aruch,_Yoreh_De'ah",
  "shulchan aruch yoreh deah":  "Shulchan_Aruch,_Yoreh_De'ah",
  "shulchan aruch eh":          "Shulchan_Aruch,_Even_HaEzer",
  "shulchan aruch even haezer": "Shulchan_Aruch,_Even_HaEzer",
  "shulchan aruch cm":          "Shulchan_Aruch,_Choshen_Mishpat",
  "mishnah berurah":            "Mishnah_Berurah",
  "mishna berura":              "Mishnah_Berurah",
  "biur halacha":               "Mishnah_Berurah",
  "aruch hashulchan oc":        "Aruch_HaShulchan,_Orach_Chayim",
  "aruch hashulchan yd":        "Aruch_HaShulchan,_Yoreh_De'ah",
  "rambam":                     "Mishneh_Torah",
  "tur oc":                     "Tur,_Orach_Chayim",
  "tur yd":                     "Tur,_Yoreh_De'ah",
};

function buildSeferiaDeepLink(name, location) {
  const key = name.toLowerCase().trim();
  const seferiaName = Object.entries(SEFARIA_NAMES).find(([k]) => key.includes(k))?.[1];
  if (!seferiaName || !location.trim()) return null;
  const loc = location.trim().replace(/:/g, ".").replace(/\s+/g, ".");
  return `https://www.sefaria.org/${seferiaName}.${loc}`;
}

function buildSeferiaSearchLink(name, location) {
  const q = encodeURIComponent(`${name}${location ? " " + location : ""}`.trim());
  return `https://www.sefaria.org/search?q=${q}`;
}

async function searchWeb(query) {
  const r = await fetch(SERPER_PROXY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, num: 10 }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(err.error || "Search failed");
  }
  const data = await r.json();
  // Filter out PDFs and non-http links which often break or are irrelevant
  return (data.results || []).filter(
    (res) => res.link?.startsWith("http") && !res.link?.toLowerCase().endsWith(".pdf")
  );
}

// Generate up to 3 search queries approaching the shaila from different angles
async function buildSearchQueries(user, shaila) {
  const data = await runAiJob(user, "shaila.research_queries.v1", { shaila }, "research");
  const qs = data?.queries || [];
  if (qs.length) return qs.slice(0, 3);
  return [`${shaila.substring(0, 80)} halacha`];
}

function fallbackLabel(link, title) {
  try { return new URL(link).hostname.replace(/^www\./, ''); }
  catch { return title.substring(0, 35); }
}

export async function performResearch(user, shaila) {
  const queries = await buildSearchQueries(user, shaila);

  const allResultArrays = await Promise.all(queries.map(q => searchWeb(q).catch(() => [])));
  const seen = new Set();
  const results = allResultArrays.flat().filter(r => {
    if (seen.has(r.link)) return false;
    seen.add(r.link);
    return true;
  });
  if (!results.length) throw new Error("No search results found for this shaila.");

  // Follow-up queries to fill gaps
  const initialSnippets = results.slice(0, 6).map((r, i) => `[${i + 1}] ${r.title}: ${r.snippet}`).join("\n");
  const followUpData = await runAiJob(user, "shaila.research_followups.v1", { shaila, initialSnippets }, "research");
  const followUps = (followUpData?.followUpQueries || []).slice(0, 2);
  if (followUps.length) {
    const followUpResults = await Promise.all(followUps.map(q => searchWeb(q).catch(() => [])));
    followUpResults.flat().forEach(r => {
      if (!seen.has(r.link)) { seen.add(r.link); results.push(r); }
    });
  }

  // Cap at 15 for AI cost; display cap of 8 applied below
  const candidates = results.slice(0, 15);
  const articlesText = candidates
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.link}\nExcerpt: ${r.snippet}`)
    .join("\n\n");

  const parsed = await runAiJob(user, "shaila.research_summarize_sources.v1", { shaila, articlesText }, "research");
  if (!parsed?.articles?.length) throw new Error("No research data generated from search results.");

  const sources = [];
  for (const a of parsed.articles) {
    if (sources.length >= 8) break;
    // a.i is the 1-based result number the AI was shown ([N] in articlesText),
    // so the link, summary, and label all come from this one object — they can't drift apart.
    const r = candidates[a.i - 1];
    const summary = a.summary?.trim();
    if (!r || !summary) continue;
    const phrase = a.highlight?.trim();
    // Text Fragment API: #:~:text=phrase scrolls browser to that text on the page
    const url = phrase ? `${r.link}#:~:text=${encodeURIComponent(phrase)}` : r.link;
    const label = a.label?.trim() || fallbackLabel(r.link, r.title);
    sources.push({ label, url, summary });
  }

  const seforim = (parsed.seforim ?? []).map((s) => ({
    label: s.location ? `${s.name} ${s.location}` : s.name,
    url: buildSeferiaDeepLink(s.name, s.location) || buildSeferiaSearchLink(s.name, s.location),
  }));

  return { queries, sources, seforim };
}

export async function generateAnswerSummary(user, answerText) {
  const data = await runAiJob(user, "shaila.answer_summary.v1", { answerText });
  const text = typeof data === "string" ? data : "";
  return text.trim().replace(/^["'`]+|["'`]+$/g, "");
}
