// Gemini API proxy — routes browser requests to Google's Gemini API to avoid CORS
// and to keep the API key off the client bundle.
// Key is stored in Netlify env var GEMINI_API_KEY — never sent from browser.
// POST / with JSON body { model, body }

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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: "GEMINI_API_KEY not configured in Netlify env vars" }) };
  }

  try {
    const { model, body } = JSON.parse(event.body);
    // Allowlist of valid models — reject anything that no longer exists (e.g. gemini-3.1-pro-preview).
    // Old shailos bundles send stale model names; force them to the current working model.
    const ALLOWED_MODELS = new Set([
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-2.0-flash",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
    ]);
    const modelName = (model && ALLOWED_MODELS.has(model)) ? model : "gemini-2.5-flash";

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 minutes
    let r;
    try {
      r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(fetchTimeout);
    }

    const data = await r.json();

    if (!r.ok) {
      const errMsg = data?.error?.message || r.statusText;
      return { statusCode: r.status, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: errMsg }) };
    }

    return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify(data) };
  } catch (e) {
    return { statusCode: 502, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Proxy error: " + e.message }) };
  }
};
