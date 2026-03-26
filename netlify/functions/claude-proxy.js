// Claude API proxy — routes browser requests to api.anthropic.com to avoid CORS
// Key is stored in Netlify env var CLAUDE_API_KEY — never sent from browser
// POST / with JSON body {prompt, maxTokens?, mode?}
// mode "research" enables web_search tool for halachic source lookup

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
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: "CLAUDE_API_KEY not configured in Netlify env vars" }) };
  }

  try {
    const { prompt, maxTokens, mode } = JSON.parse(event.body);
    const isResearch = mode === "research";

    const body = {
      model: "claude-opus-4-5",
      max_tokens: maxTokens || 3000,
      messages: [{ role: "user", content: prompt }],
      ...(isResearch && {
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
      }),
    };

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "web-search-2025-03-05",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await r.json();
    if (data.error) {
      return { statusCode: r.status, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: data.error.message || "Claude API error" }) };
    }

    // Extract text from potentially multi-block response (web search returns tool_use + text blocks)
    const text = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n\n");

    return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ text }) };
  } catch (e) {
    return { statusCode: 502, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Proxy error: " + e.message }) };
  }
};
