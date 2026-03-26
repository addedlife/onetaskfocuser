// Soferai proxy — routes browser requests to api.sofer.ai to avoid CORS
//
// POST /  (with X-Soferai-Key header, JSON body)
//   → POST https://api.sofer.ai/v1/transcriptions/
//   ← UUID string (job id)
//
// GET /?job_id=<uuid>&check=status
//   → GET https://api.sofer.ai/v1/transcriptions/<uuid>/status
//   ← TranscriptionInfo JSON
//
// GET /?job_id=<uuid>
//   → GET https://api.sofer.ai/v1/transcriptions/<uuid>?filter_hebrew_word_format=en
//   ← Transcription JSON  { text, info, timestamps }

const BASE = "https://api.sofer.ai";

const ALLOWED_ORIGINS = [
  "https://onetaskfocuser.netlify.app",
  "http://localhost:5173",
  "http://localhost:4173",
];

exports.handler = async (event) => {
  const origin = (event.headers.origin || event.headers.Origin || "").trim();
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const cors = {
    "Access-Control-Allow-Origin":  allowedOrigin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Soferai-Key",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }

  const apiKey =
    event.headers["x-soferai-key"] ||
    event.headers["X-Soferai-Key"];

  if (!apiKey) {
    return {
      statusCode: 400,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing X-Soferai-Key header" }),
    };
  }

  const authHeaders = {
    Authorization:  `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  try {
    const qs = event.queryStringParameters || {};

    // ── GET: status or result ─────────────────────────────────────────────
    if (event.httpMethod === "GET" && qs.job_id) {
      const url = qs.check === "status"
        ? `${BASE}/v1/transcriptions/${qs.job_id}/status`
        : `${BASE}/v1/transcriptions/${qs.job_id}?filter_hebrew_word_format=en`;

      const r = await fetch(url, { headers: authHeaders });
      const body = await r.text();
      return {
        statusCode: r.status,
        headers: { ...cors, "Content-Type": "application/json" },
        body,
      };
    }

    // ── POST: create transcription ────────────────────────────────────────
    if (event.httpMethod === "POST") {
      const r = await fetch(`${BASE}/v1/transcriptions/`, {
        method:  "POST",
        headers: authHeaders,
        body:    event.body,          // pass JSON straight through
      });
      const body = await r.text();
      return {
        statusCode: r.status,
        headers: { ...cors, "Content-Type": "application/json" },
        body,
      };
    }

    return {
      statusCode: 405,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };

  } catch (e) {
    return {
      statusCode: 502,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Proxy error: " + e.message }),
    };
  }
};
