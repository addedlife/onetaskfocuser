// Serper.dev proxy — routes browser search requests through the server
// so the API key is never in the client bundle.
// POST / with JSON body { query, num? }
// Returns Serper organic search results.

const ALLOWED_ORIGINS = [
  "https://onetaskfocuser.netlify.app",
  "http://localhost:5173",
  "http://localhost:4173",
];

exports.handler = async (event) => {
  const origin = (event.headers.origin || event.headers.Origin || "").trim();
  const isAllowed = !origin || ALLOWED_ORIGINS.includes(origin);

  const cors = {
    "Access-Control-Allow-Origin":  isAllowed ? (origin || ALLOWED_ORIGINS[0]) : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (!isAllowed) {
    return { statusCode: 403, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Origin not allowed" }) };
  }

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: "SERPER_API_KEY not configured in Netlify env vars" }) };
  }

  try {
    const { query, num = 8 } = JSON.parse(event.body);

    const r = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify({ q: query, num }),
    });

    const data = await r.json();

    if (!r.ok) {
      return { statusCode: r.status, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: data?.message || r.statusText }) };
    }

    // Return only what we need — title, link, snippet
    const results = (data.organic || []).map(({ title, link, snippet }) => ({ title, link, snippet }));
    return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ results }) };

  } catch (e) {
    return { statusCode: 502, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Serper proxy error: " + e.message }) };
  }
};
