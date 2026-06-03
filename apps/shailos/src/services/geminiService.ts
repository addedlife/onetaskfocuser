// All Shailos AI calls route through the same OneTask AI gateway.

const AI_PROXY = "/.netlify/functions/ai-proxy";
const SERPER_PROXY = "/.netlify/functions/serper-proxy";

function getSharedAiConfig(): any {
  try {
    return JSON.parse(localStorage.getItem("onetask_ai_config") || "{}");
  } catch {
    return {};
  }
}

async function runAiJob(job: string, input: object, task = "shailos"): Promise<any> {
  const cfg = getSharedAiConfig();
  const provider = cfg.provider || cfg.aiProvider || "gemini";
  const model = cfg.model || "";
  const geminiCredential = cfg.geminiCredential || cfg.aiGeminiCredential || "auto";
  const r = await fetch(AI_PROXY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job, input, task, provider, model, geminiCredential }),
  });
  const data = await r.json().catch(() => ({ error: r.statusText }));
  if (!r.ok) {
    throw new Error(data.error || "AI gateway error");
  }
  if (data.error) throw new Error(data.error);
  return data.output ?? data.text ?? data.raw ?? data;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onloadend = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("Audio read failed"));
    reader.readAsDataURL(blob);
  });
}

async function webmToWavBase64(webmBlob: Blob): Promise<string> {
  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextCtor || !window.OfflineAudioContext) throw new Error("Audio conversion unavailable");

  const arrayBuf = await webmBlob.arrayBuffer();
  const audioCtx = new AudioContextCtor();
  let decoded: AudioBuffer;
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
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
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

async function audioPartForGemini(blob: Blob): Promise<{ inlineData: { mimeType: string; data: string } }> {
  try {
    return { inlineData: { mimeType: "audio/wav", data: await webmToWavBase64(blob) } };
  } catch {
    return { inlineData: { mimeType: blob.type || "audio/webm", data: await blobToBase64(blob) } };
  }
}

export async function transcribeAudio(blob: Blob, prompt: string): Promise<string> {
  const audioPart = await audioPartForGemini(blob);
  const inline = audioPart.inlineData;
  const data = await runAiJob("transcribe.yeshivish.v1", {
    base64: inline.data,
    mimeType: inline.mimeType,
    instruction: prompt,
    mode: "shailos",
  }, "transcription");
  return typeof data === "string" ? data : (data?.transcript || "");
}

export async function generateSynopsis(content: string) {
  const data = await runAiJob("shaila.synopsis.v1", { content });
  return data?.synopsis || "";
}

export async function transcribeAndParse(content: string | Blob, isAudio: boolean) {
  let text = "";
  if (isAudio && content instanceof Blob) {
    text = await transcribeAudio(
      content,
      "Transcribe this audio exactly and faithfully. The speakers may use Yeshivish English, Hebrew, Yiddish, and halachic terms. Do not summarize or classify. Return only the transcript."
    );
  } else {
    text = String(content || "");
  }
  const data = await runAiJob("shaila.parse.structured.v1", { text });
  return data?.shailos || [];
}

export async function findPotentialMatches(newShaila: any, existingShailos: any[]) {
  if (existingShailos.length === 0) return [];
  const existingList = existingShailos.map(s => ({ id: s.id, synopsis: s.synopsis, asker: s.askerName }));
  const data = await runAiJob("shaila.find_matches.v1", { newShaila, existingShailos: existingList });
  return data?.matchIds || [];
}


// Classical seforim available on Sefaria — maps to Sefaria URL path
const SEFARIA_NAMES: Record<string, string> = {
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

function buildSeferiaDeepLink(name: string, location: string): string | null {
  const key = name.toLowerCase().trim();
  const seferiaName = Object.entries(SEFARIA_NAMES).find(([k]) => key.includes(k))?.[1];
  if (!seferiaName || !location.trim()) return null;
  const loc = location.trim().replace(/:/g, ".").replace(/\s+/g, ".");
  return `https://www.sefaria.org/${seferiaName}.${loc}`;
}

function buildSeferiaSearchLink(name: string, location: string): string {
  const q = encodeURIComponent(`${name}${location ? " " + location : ""}`.trim());
  return `https://www.sefaria.org/search?q=${q}`;
}

async function searchWeb(query: string): Promise<Array<{ title: string; link: string; snippet: string }>> {
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
    (r: { link: string }) => r.link?.startsWith("http") && !r.link?.toLowerCase().endsWith(".pdf")
  );
}

// Generate 3 search queries approaching the shaila from different angles
async function buildSearchQueries(shaila: string): Promise<string[]> {
  const data = await runAiJob("shaila.research_queries.v1", { shaila }, "research");
  const qs: string[] = data?.queries || [];
  if (qs.length) return qs.slice(0, 3);
  return [`${shaila.substring(0, 80)} halacha`];
}

export interface ResearchSource {
  label: string;
  url: string;
  summary: string;
}

export interface ResearchSefar {
  label: string;
  url: string;
}

export interface ResearchData {
  queries: string[];
  sources: ResearchSource[];
  seforim: ResearchSefar[];
}

function fallbackLabel(link: string, title: string): string {
  try { return new URL(link).hostname.replace(/^www\./, ''); }
  catch { return title.substring(0, 35); }
}

export async function performResearch(shaila: string): Promise<ResearchData> {
  const queries = await buildSearchQueries(shaila);

  const allResultArrays = await Promise.all(queries.map(q => searchWeb(q).catch(() => [])));
  const seen = new Set<string>();
  let results = allResultArrays.flat().filter(r => {
    if (seen.has(r.link)) return false;
    seen.add(r.link);
    return true;
  });
  if (!results.length) throw new Error("No search results found for this shaila.");

  // Follow-up queries to fill gaps
  const initialSnippets = results.slice(0, 6).map((r, i) => `[${i+1}] ${r.title}: ${r.snippet}`).join("\n");
  const followUpData = await runAiJob("shaila.research_followups.v1", { shaila, initialSnippets }, "research");
  const followUps: string[] = (followUpData?.followUpQueries || []).slice(0, 2);
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

  const parsed = await runAiJob("shaila.research_summarize_sources.v1", { shaila, articlesText }, "research");
  if (!parsed?.articles?.length) throw new Error("No research data generated from search results.");

  const sources: ResearchSource[] = [];
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

  const seforim: ResearchSefar[] = (parsed.seforim ?? []).map((s: any) => ({
    label: s.location ? `${s.name} ${s.location}` : s.name,
    url: buildSeferiaDeepLink(s.name, s.location) || buildSeferiaSearchLink(s.name, s.location),
  }));

  return { queries, sources, seforim };
}

export async function generateAnswerSummary(answerText: string): Promise<string> {
  const data = await runAiJob("shaila.answer_summary.v1", { answerText }, "shailos");
  const text = typeof data === "string" ? data : "";
  return text.trim().replace(/^["'`]+|["'`]+$/g, "");
}
