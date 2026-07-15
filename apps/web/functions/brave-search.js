// Free whole-web search via the Brave Search API (2,000 queries/month free).
// Primary backend in google-search.js — Google CSE can't do whole-web search
// on a newly created engine (Google restricts that toggle to legacy engines
// only) and Gemini's native grounding now requires a paid Prepay balance, so
// Brave is the only real $0 whole-web option left.
//
// Brave's /res/v1/web/search response is real, independently-indexed search
// hits (title, url, description) — never text an AI model wrote — so this
// can't hand the research pipeline an AI-invented URL. Still passed through
// link-inspector.js since any search index can serve a stale/removed page.

async function braveSearch(query, count = 8) {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY || "";
  if (!apiKey) throw new Error("Brave Search is not configured.");

  const url = `https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({
    q: query,
    count: String(Math.min(20, count)),
  })}`;

  const r = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(data?.error?.message || `Brave Search failed (${r.status})`);
  }

  return (data?.web?.results || [])
    .map(item => ({
      title: item.title || "",
      link: item.url || "",
      snippet: (item.description || "").replace(/<\/?strong>/g, ""),
    }))
    .filter(r => r.title && r.link)
    .slice(0, count);
}

module.exports = { braveSearch };
