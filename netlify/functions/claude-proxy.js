// Claude API proxy — routes browser requests to api.anthropic.com to avoid CORS
// POST / with X-Claude-Key header and JSON body {prompt, maxTokens?, temperature?}
// Returns the assistant's text response

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Claude-Key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = event.headers["x-claude-key"] || event.headers["X-Claude-Key"];
  if (!apiKey) {
    return { statusCode: 400, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Missing X-Claude-Key header" }) };
  }

  try {
    const { prompt, maxTokens, temperature } = JSON.parse(event.body);
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: maxTokens || 2048,
        temperature: temperature ?? 0.7,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await r.json();
    if (data.error) {
      return { statusCode: r.status, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: data.error.message || "Claude API error" }) };
    }

    const text = data.content?.[0]?.text || "";
    return { statusCode: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ text }) };
  } catch (e) {
    return { statusCode: 502, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Proxy error: " + e.message }) };
  }
};
