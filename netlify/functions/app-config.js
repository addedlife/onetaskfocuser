// netlify/functions/app-config.js
// Returns app-level config (shared API keys) for client use.
exports.handler = async function() {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({ geminiKey: process.env.GEMINI_API_KEY || "" })
  };
};
