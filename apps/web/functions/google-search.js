// POST /api/google-search  { query, num? }
// Returns { results: [{ title, link, snippet }], engine: "gemini"|"google"|"sefaria" }
//
// Search chain, each step only tried if the one before it errors or comes
// back empty:
//   1. Gemini native Google Search grounding — true whole-web coverage,
//      near-free (Gemini 3.x: 5,000 grounded prompts/month free). See
//      gemini-grounded-search.js for why this can't hand back an
//      AI-invented URL.
//   2. Google Custom Search JSON API (GOOGLE_SEARCH_API_KEY/CSE_ID) — kept
//      as a secondary net; note the CSE currently configured is domain-
//      restricted, not whole-web, so this step is mostly inert until that's
//      reconfigured.
//   3. Sefaria's public search API (keyless, free) — the pipeline must
//      never dead-end with "no results" even if both of the above fail.
//
// Every result set (any engine) is passed through link-inspector.js, which
// drops stale/removed entries (404/410) before they reach the user.

const { corsHeaders } = require("./cors-helper");
const { inspectLinks } = require("./link-inspector");
const { geminiGroundedSearch } = require("./gemini-grounded-search");

// Sefaria's search phrase-matches multi-word queries (AND within a sliding
// window), so a long AI-generated query often returns zero hits. Retry with
// the strongest few content words before giving up.
const SEFARIA_FILLER = new Set([
  "halacha", "halakha", "halachic", "jewish", "torah", "with", "that", "this",
  "what", "when", "does", "have", "from", "into", "about", "there", "their",
  "shaila", "shailah", "question", "regarding", "concerning", "permitted", "allowed",
]);

async function sefariaSearch(query, count) {
  const call = async (q, slop) => {
    const r = await fetch("https://www.sefaria.org/api/search-wrapper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q, type: "text", size: count, field: "naive_lemmatizer", slop, source_proj: true }),
    });
    if (!r.ok) throw new Error(`Sefaria search failed (${r.status})`);
    const data = await r.json().catch(() => ({}));
    return data?.hits?.hits || [];
  };
  let hits = await call(query, 10);
  if (!hits.length) {
    // Filler words like "halacha" defeat the phrase window — retry with the
    // strongest few content words and a wide slop.
    const words = query.toLowerCase().replace(/[^a-z֐-׿\s]/g, " ").split(/\s+/)
      .filter(w => w.length > 3 && !SEFARIA_FILLER.has(w));
    const slim = words.slice(0, 3).join(" ");
    if (slim && slim !== query.toLowerCase().trim()) hits = await call(slim, 50);
  }
  return hits.map(h => {
    const ref = h._source?.ref || String(h._id || "").replace(/\s*\([^)]*\)\s*$/, "");
    const snippet = (h.highlight?.naive_lemmatizer || []).join(" … ").replace(/<\/?b>/g, "");
    return {
      title: ref,
      link: `https://www.sefaria.org/${encodeURIComponent(ref)}`,
      snippet: snippet.slice(0, 400),
    };
  }).filter(res => res.title && res.snippet);
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || "";
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return res.status(204).set(headers).end();
  }

  if (req.method !== "POST") {
    return res.status(405).set(headers).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GOOGLE_SEARCH_API_KEY || "";
  const cx = process.env.GOOGLE_SEARCH_CSE_ID || "";

  const { query, num = 8 } = req.body || {};
  if (!query || typeof query !== "string" || !query.trim()) {
    return res.status(400).set(headers).json({ error: "Missing query." });
  }

  const count = Math.min(10, Math.max(1, Number(num) || 8));

  let geminiError = "";
  try {
    const results = await geminiGroundedSearch(query.trim(), count);
    if (results.length) {
      return res.status(200).set(headers).json({ results, engine: "gemini" });
    }
    geminiError = "Gemini grounding returned no results.";
  } catch (e) {
    geminiError = e.message || "Gemini grounded search failed.";
  }

  // Google CSE next (currently domain-restricted — mostly inert), Sefaria as the keyless safety net.
  let googleError = apiKey && cx ? "" : "Google Custom Search is not configured.";
  if (!googleError) {
    const url = `https://www.googleapis.com/customsearch/v1?${new URLSearchParams({
      key: apiKey,
      cx,
      q: query.trim(),
      num: String(count),
    })}`;
    try {
      const r = await fetch(url);
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        const rawResults = (data.items || []).map(item => ({
          title: item.title || "",
          link: item.link || "",
          snippet: item.snippet || "",
        }));
        const results = await inspectLinks(rawResults);
        return res.status(200).set(headers).json({ results, engine: "google" });
      }
      googleError = data?.error?.message || `Google Search failed (${r.status})`;
    } catch (e) {
      googleError = e.message || "Search request failed.";
    }
  }

  try {
    const rawResults = await sefariaSearch(query.trim(), count);
    const results = await inspectLinks(rawResults);
    return res.status(200).set(headers).json({ results, engine: "sefaria", googleError: `${geminiError} ${googleError}`.trim() });
  } catch (e) {
    return res.status(502).set(headers).json({ error: `${geminiError} ${googleError} Fallback ${e.message || "Sefaria search failed."}`.trim() });
  }
};
