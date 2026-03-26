// netlify/functions/app-config.js
// Returns app-level config (shared API keys) for client use.
// CORS is intentionally restricted to the production origin — the key must not
// be retrievable from arbitrary third-party sites.
const ALLOWED_ORIGINS = [
  "https://onetaskfocuser.netlify.app",
  "http://localhost:5173",
  "http://localhost:4173",
];

exports.handler = async function(event) {
  const origin = (event.headers.origin || event.headers.Origin || "").trim();
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": corsOrigin,
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
      body: "",
    };
  }

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": corsOrigin,
    },
    body: JSON.stringify({ geminiKey: process.env.GEMINI_API_KEY || "" }),
  };
};
