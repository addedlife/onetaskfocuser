// Serper.dev proxy. Server-side keys require server-side auth, not CORS-only checks.
const { authorizeFunctionRequest, corsFor } = require("./_ai-core.cjs");

exports.handler = async (event) => {
  const cors = corsFor(event);

  if (!cors.isAllowed) {
    return { statusCode: 403, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Origin not allowed" }) };
  }

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors.headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: { ...cors.headers, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: { ...cors.headers, "Content-Type": "application/json" }, body: JSON.stringify({ error: "SERPER_API_KEY not configured in Netlify env vars" }) };
  }

  try {
    await authorizeFunctionRequest(event, "serper");
    const { query, num = 8 } = JSON.parse(event.body || "{}");
    const cleanQuery = String(query || "").trim();
    if (!cleanQuery) {
      return { statusCode: 400, headers: { ...cors.headers, "Content-Type": "application/json" }, body: JSON.stringify({ error: "query is required" }) };
    }

    const r = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify({ q: cleanQuery, num: Math.min(Math.max(Number(num) || 8, 1), 10) }),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { statusCode: r.status, headers: { ...cors.headers, "Content-Type": "application/json" }, body: JSON.stringify({ error: data?.message || r.statusText }) };
    }

    const results = (data.organic || []).map(({ title, link, snippet }) => ({ title, link, snippet }));
    return { statusCode: 200, headers: { ...cors.headers, "Content-Type": "application/json" }, body: JSON.stringify({ results }) };
  } catch (e) {
    return { statusCode: e.statusCode || 502, headers: { ...cors.headers, "Content-Type": "application/json" }, body: JSON.stringify({ error: e.message || "Serper proxy error" }) };
  }
};
