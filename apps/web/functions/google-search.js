// Google Custom Search API — replaces serper-proxy (Spark-OK: calls googleapis.com)
// POST /api/google-search  { query, num? }
// Returns { results: [{ title, link, snippet }] }
// Env vars: GOOGLE_SEARCH_API_KEY, GOOGLE_SEARCH_CSE_ID
// Free tier: 100 queries/day

const { corsHeaders } = require("./cors-helper");

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
  if (!apiKey || !cx) {
    return res.status(503).set(headers).json({ error: "Google Custom Search is not configured." });
  }

  const { query, num = 8 } = req.body || {};
  if (!query || typeof query !== "string" || !query.trim()) {
    return res.status(400).set(headers).json({ error: "Missing query." });
  }

  const count = Math.min(10, Math.max(1, Number(num) || 8));
  const url = `https://www.googleapis.com/customsearch/v1?${new URLSearchParams({
    key: apiKey,
    cx,
    q: query.trim(),
    num: String(count),
  })}`;

  try {
    const r = await fetch(url);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).set(headers).json({ error: data?.error?.message || `Google Search failed (${r.status})` });
    }
    const results = (data.items || []).map(item => ({
      title: item.title || "",
      link: item.link || "",
      snippet: item.snippet || "",
    }));
    return res.status(200).set(headers).json({ results });
  } catch (e) {
    return res.status(502).set(headers).json({ error: e.message || "Search request failed." });
  }
};
