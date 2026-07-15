// True whole-web search via Gemini's native Google Search grounding tool —
// the primary backend in google-search.js, ahead of the (domain-restricted)
// Custom Search Engine and the Sefaria fallback.
//
// Only candidates[0].groundingMetadata.groundingChunks — the real search
// hits Google's own infrastructure retrieved server-side — are used as
// result links. Text the model writes in its own answer prose is never
// used as a link source, so this cannot hand the research pipeline an
// AI-invented URL (the documented Gemini grounding failure mode is inline
// citation text drifting from the real chunk list, not the chunk list
// itself being fabricated).
//
// Chunk URIs are Google redirect wrappers that can expire after a few
// days, so resolveAndInspectLinks (link-inspector.js) resolves each to its
// real final destination and drops any that don't resolve at all.

const { callGemini, DEFAULT_GEMINI_MODEL } = require("./_ai-core.cjs");
const { resolveAndInspectLinks } = require("./link-inspector");

function snippetForChunk(chunkIndex, supports) {
  const texts = (supports || [])
    .filter(s => (s.groundingChunkIndices || []).includes(chunkIndex))
    .map(s => s.segment?.text || "")
    .filter(Boolean);
  return texts.join(" ").slice(0, 400);
}

async function geminiGroundedSearch(query, count = 8) {
  const result = await callGemini({
    model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    body: {
      contents: [{ parts: [{ text: query }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
    },
  });

  const grounding = result?.raw?.candidates?.[0]?.groundingMetadata;
  const chunks = grounding?.groundingChunks || [];
  const supports = grounding?.groundingSupports || [];

  const candidates = chunks
    .map((chunk, i) => ({
      title: chunk?.web?.title || "",
      link: chunk?.web?.uri || "",
      snippet: snippetForChunk(i, supports) || chunk?.web?.title || "",
    }))
    .filter(r => r.link)
    .slice(0, count);

  if (!candidates.length) return [];
  return resolveAndInspectLinks(candidates);
}

module.exports = { geminiGroundedSearch };
