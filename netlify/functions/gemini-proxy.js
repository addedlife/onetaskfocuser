// Gemini API proxy — routes browser requests to generativelanguage.googleapis.com
// Key is stored in Netlify env var GEMINI_API_KEY — never sent from browser
// POST / with JSON body { model, body } where body is the full Gemini REST request body

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

  if (!isAllowed) return { statusCode: 403, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Origin not allowed" }) };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Method not allowed" }) };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: "GEMINI_API_KEY not configured in Netlify env vars" }) };

  try {
    const { model, body } = JSON.parse(event.body);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await r.json();
    if (!r.ok) {
      return { statusCode: r.status, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: data.error?.message || "Gemini API error" }) };
    }

    return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify(data) };
  } catch (e) {
    return { statusCode: 502, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Proxy error: " + e.message }) };
  }
};
