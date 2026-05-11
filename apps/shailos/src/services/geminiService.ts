// All Shailos AI calls route through the same OneTask AI gateway.
import { auth } from "../firebase";

const AI_PROXY = "/.netlify/functions/ai-proxy";
const SERPER_PROXY = "/.netlify/functions/serper-proxy";

function getSharedAiConfig(): any {
  try {
    return JSON.parse(localStorage.getItem("onetask_ai_config") || "{}");
  } catch {
    return {};
  }
}

async function callGemini(body: object, task = "shailos"): Promise<any> {
  const cfg = getSharedAiConfig();
  const provider = "gemini";
  const model = cfg.model || "";
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Sign in before using AI.");
  const r = await fetch(AI_PROXY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ task, provider, model, body }),
  });
  const data = await r.json().catch(() => ({ error: r.statusText }));
  if (!r.ok) {
    throw new Error(data.error || "AI gateway error");
  }
  if (data.error) throw new Error(data.error);
  return data.raw || data;
}

function getText(data: any): string {
  return data?.text || data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
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

const SYSTEM_INSTRUCTION = `You are an expert transcriber and halachic query parser.
You specialize in recognizing terminology of a Yeshivish English, Yiddish, and Hebrew dialect.
Common terms include: Shaila, Halacha, Pasken, Muttar, Assur, B'diavad, L'chatchila, etc.

Your task is to:
1. Faithfully transcribe the conversation if audio is provided.
2. Identify if there are multiple distinct shailos (questions) or sub-shailos in the input.
3. Parse EACH shaila into a specific format:
   "Shaila: [date][name of asker if found][the shaila and any points relevant to it][the answer if found, including the name of the answerer (e.g., CC for R' Chaim Cohen, YCD for R' Yosef Chaim Danziger, or any other name identified), and any reasons given in the transcript]."

If the input contains multiple questions, return an array of objects, one for each question.
For each shaila:
- Identify the asker, the core question, any context, and if an answer was already given on the call.
- Identify the answerer if an answer was given. Common ones are CC (R' Chaim Cohen) and YCD (R' Yosef Chaim Danziger), but it could be anyone.
- If an answer was given, provide the answer text and reasons.
- If no answer was given, the "answer" field MUST be an empty string "". DO NOT use placeholder text like "Waiting for answer...", "N/A", or "None".
- Include all reasons provided in the transcript.
- Create a "synopsis" which is a non-verbatim, extremely concise "complete thought" (3-8 words) summarizing the core HALACHIC question.
  FORMAT: "Topic: Core Question" or "Topic: Specific Detail".
  EXAMPLES:
    - "Non-mevushal juice: Mechallel Shabbos touch?"
    - "Mevushal wine: Hiddur for 4 cups?"
    - "Tevilas Keilim: Electric toaster?"
  DO NOT include conversational filler or non-halachic actions like "Should she cancel order". Focus on the halachic point.`;

export async function transcribeAudio(blob: Blob, prompt: string): Promise<string> {
  const audioPart = await audioPartForGemini(blob);
  const data = await callGemini({
    contents: [{ parts: [
      audioPart,
      { text: prompt },
    ]}],
  }, "transcription");
  return getText(data);
}

export async function generateSynopsis(content: string) {
  const data = await callGemini({
    contents: [{ parts: [{ text: `Create an extremely concise halachic synopsis (3-8 words) for the following content.
  FORMAT: "Topic: Core Question" or "Topic: Specific Detail".
  EXAMPLES:
    - "Non-mevushal juice: Mechallel Shabbos touch?"
    - "Tevilas Keilim: Electric toaster?"

  Content: "${content}"` }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: { synopsis: { type: "STRING" } },
        required: ["synopsis"],
      },
    },
  });
  const result = JSON.parse(getText(data));
  return result.synopsis;
}

export async function transcribeAndParse(content: string | Blob, isAudio: boolean) {
  let parts: any[] = [];

  if (isAudio && content instanceof Blob) {
    const transcript = await transcribeAudio(
      content,
      "Transcribe this audio exactly and faithfully. The speakers may use Yeshivish English, Hebrew, Yiddish, and halachic terms. Do not summarize or classify. Return only the transcript."
    );
    parts.push({ text: `Please parse this transcript. If there are multiple shailos, split them and parse each one according to the system instructions:\n\n${transcript}` });
  } else {
    parts.push({ text: `Please parse this text. If there are multiple shailos, split them and parse each one according to the system instructions:\n\n${content}` });
  }

  const data = await callGemini({
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          shailos: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                askerName:     { type: "STRING" },
                shailaContent: { type: "STRING" },
                answer:        { type: "STRING" },
                answererName:  { type: "STRING" },
                reasons:       { type: "STRING" },
                synopsis:      { type: "STRING", description: "A non-verbatim, concise complete thought (3-8 words) summarizing the question." },
                parsedShaila:  { type: "STRING", description: "The full formatted string as requested." },
              },
              required: ["parsedShaila", "shailaContent", "synopsis"],
            },
          },
        },
        required: ["shailos"],
      },
    },
  });

  const result = JSON.parse(getText(data));
  return result.shailos;
}

export async function findPotentialMatches(newShaila: any, existingShailos: any[]) {
  if (existingShailos.length === 0) return [];

  const existingList = existingShailos.map(s => ({ id: s.id, synopsis: s.synopsis, asker: s.askerName }));
  const data = await callGemini({
    contents: [{ parts: [{ text: `A new shaila has been recorded/parsed:
  Asker: ${newShaila.askerName}
  Content: ${newShaila.shailaContent}

  Compare this to the following existing shailos and identify if this new recording is likely a follow-up, a return call with an answer, or a clarification for one of them.

  Existing Shailos:
  ${JSON.stringify(existingList)}

  Return an array of potential match IDs, ordered from most to least probable. Only include matches with a reasonable probability. If none, return an empty array.` }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          matchIds: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["matchIds"],
      },
    },
  });

  const result = JSON.parse(getText(data));
  return result.matchIds;
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
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Sign in before using search.");
  const r = await fetch(SERPER_PROXY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
  const data = await callGemini({
    contents: [{ parts: [{ text: `Generate 3 different Google search queries for this halachic/kashrut question. Each must approach it from a different angle:

Query 1 — broad halachic category: the general topic in standard halachic terms (e.g. "chametz gamur machine matzah Pesach halacha")
Query 2 — specific scenario or product: the exact situation described, keeping brand names if relevant (e.g. "year-round matzah box chametz label sell before Pesach")
Query 3 — posek/agency perspective: likely sources (OU, Star-K, CRC, Halachipedia, Igros Moshe, Mishnah Berurah) and the precise halachic question (e.g. "OU Star-K machine matzah chametz gamur mechiyas chametz ruling")

Rules:
- Use standard English transliterations (Pesach, Shabbos, shiur, libun, maror, mechiyas, etc.)
- Translate Yeshivish colloquialisms to standard halachic terms
- Keep brand/product names when the question is about a specific product
- Include "halacha" or "kosher" or "kashrut" in at least one query
- Return ONLY a JSON array of exactly 3 query strings

Question: "${shaila.substring(0, 400)}"` }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 200,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT" as const,
        properties: {
          queries: { type: "ARRAY" as const, items: { type: "STRING" as const } },
        },
        required: ["queries"],
      },
    },
  }, "research");
  try {
    const parsed = JSON.parse(getText(data));
    const qs: string[] = parsed.queries || [];
    if (qs.length) return qs.slice(0, 3);
  } catch {}
  // fallback: single broad query
  return [`${shaila.substring(0, 80)} halacha`];
}

export async function performResearch(shaila: string) {
  // Step 1: Generate 3 search angles in parallel
  const queries = await buildSearchQueries(shaila);

  // Step 2: Run all 3 searches simultaneously — deduplicate by URL
  const allResultArrays = await Promise.all(queries.map(q => searchWeb(q).catch(() => [])));
  const seen = new Set<string>();
  let results = allResultArrays.flat().filter(r => {
    if (seen.has(r.link)) return false;
    seen.add(r.link);
    return true;
  });
  if (!results.length) throw new Error("No search results found for this shaila.");

  // Step 3: Gemini identifies gaps → generates 1-2 targeted follow-up queries
  const initialSnippets = results.slice(0, 6).map((r, i) => `[${i+1}] ${r.title}: ${r.snippet}`).join("\n");
  const followUpData = await callGemini({
    contents: [{ parts: [{ text: `A posek needs to research this shaila: "${shaila.substring(0, 300)}"

Initial search results (titles + snippets):
${initialSnippets}

Do these results directly address the specific question? If there are obvious gaps — e.g. no ruling from a major agency (OU, Star-K, CRC), no relevant sefer cited, wrong topic entirely — generate 1-2 targeted follow-up search queries to fill those gaps. If the results are sufficient, return an empty array.

Return ONLY a JSON object: { "followUpQueries": ["query1", "query2"] }` }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 150,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT" as const,
        properties: {
          followUpQueries: { type: "ARRAY" as const, items: { type: "STRING" as const } },
        },
        required: ["followUpQueries"],
      },
    },
  }, "research");

  try {
    const fp = JSON.parse(getText(followUpData));
    const followUps: string[] = (fp.followUpQueries || []).slice(0, 2);
    if (followUps.length) {
      const followUpResults = await Promise.all(followUps.map(q => searchWeb(q).catch(() => [])));
      followUpResults.flat().forEach(r => {
        if (!seen.has(r.link)) { seen.add(r.link); results.push(r); }
      });
    }
  } catch {}

  const articlesText = results
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.link}\nExcerpt: ${r.snippet}`)
    .join("\n\n");

  // Step 3: Gemini reads snippets → per-article one-line summary + seforim + highlight phrase
  // CRITICAL: No synthesis, no conclusions, no psak. Each article gets its own line.
  const data = await callGemini({
    contents: [{ parts: [{ text: `You are a research assistant finding sources for a posek. Report ONLY what each article says. Do NOT draw conclusions, do NOT synthesize, do NOT add your own reasoning.

SHAILA: "${shaila}"

SEARCH RESULTS:
${articlesText}

Return a JSON object with:
- "articleSummaries": For each search result (by 0-based index), a single sentence of what THAT article says about the shaila. Start with the source name (e.g. "OU Torah states...", "Star-K notes...", "Halachipedia records..."). If an article is clearly not relevant to the shaila, use empty string.
- "articleHighlights": For each search result (by 0-based index), a 1-3 word key term almost certainly on that page and specific to this shaila (e.g. "chametz gamur", "year-round matzah", "libun gamur"). Short only — must match actual text on the page. Empty string if not relevant.
- "seforim": Array of halachic seforim explicitly named in the snippets. Each: { "name": full name (e.g. "Shulchan Aruch OC", "Mishnah Berurah", "Igros Moshe"), "location": siman:seif if given (e.g. "451:1"), or empty string }` }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT" as const,
        properties: {
          articleSummaries: {
            type: "ARRAY" as const,
            items: { type: "STRING" as const },
          },
          articleHighlights: {
            type: "ARRAY" as const,
            items: { type: "STRING" as const },
          },
          seforim: {
            type: "ARRAY" as const,
            items: {
              type: "OBJECT" as const,
              properties: {
                name:     { type: "STRING" as const },
                location: { type: "STRING" as const },
              },
              required: ["name", "location"],
            },
          },
        },
        required: ["articleSummaries", "articleHighlights", "seforim"],
      },
    },
  }, "research");

  const raw = getText(data);
  if (!raw.trim()) throw new Error("No research data generated from search results.");

  let parsed: { articleSummaries: string[]; articleHighlights: string[]; seforim: Array<{ name: string; location: string }> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }

  // Build output — document all search queries used, then list each source with what it says
  const lines: string[] = [
    `*Searched: ${queries.join(" · ")}*`,
    "",
    "---",
    "**Sources found:**",
    "",
  ];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const summary = parsed.articleSummaries?.[i]?.trim();
    if (!summary) continue; // skip irrelevant results
    const phrase = parsed.articleHighlights?.[i]?.trim();
    // Text Fragment API: #:~:text=phrase scrolls browser to that text on the page
    const url = phrase ? `${r.link}#:~:text=${encodeURIComponent(phrase)}` : r.link;
    lines.push(`- [${r.title}](${url}) — ${summary}`);
  }

  if (parsed.seforim?.length) {
    lines.push("", "**Seforim mentioned:**", "");
    for (const s of parsed.seforim) {
      const deepLink = buildSeferiaDeepLink(s.name, s.location);
      const link = deepLink || buildSeferiaSearchLink(s.name, s.location);
      const label = s.location ? `${s.name} ${s.location}` : s.name;
      lines.push(`- [${label}](${link})`);
    }
  }

  return lines.join("\n");
}

export async function generateAnswerSummary(answerText: string): Promise<string> {
  const data = await callGemini({
    contents: [{ parts: [{ text: `Summarize this halachic answer in 4-6 words. Output ONLY the summary — no quotes, no explanation. Start with the ruling. Preserve key Yeshivish terms (mutar, assur, bedieved, lechatchila, etc.).\n\nAnswer: ${answerText.substring(0, 600)}` }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 24 },
  });
  return getText(data).trim().replace(/^["'`]+|["'`]+$/g, '');
}
