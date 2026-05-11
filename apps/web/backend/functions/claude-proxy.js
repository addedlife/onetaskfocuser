// Legacy endpoint name only. Active app code uses /.netlify/functions/ai-proxy.
// This wrapper preserves old callers while routing through the central gateway.
const { corsFor, processAiPayload } = require("./_ai-core.cjs");

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

  try {
    const { prompt, maxTokens, mode, model } = JSON.parse(event.body || "{}");
    const result = await processAiPayload({
      provider: "claude",
      model,
      prompt,
      genConfig: { maxOutputTokens: maxTokens },
      mode,
      task: mode === "research" ? "research" : "compat",
    });
    return {
      statusCode: 200,
      headers: { ...cors.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ text: result.text || "" }),
    };
  } catch (e) {
    const retryAfter = e.retryAfterSeconds ? { "Retry-After": String(e.retryAfterSeconds) } : {};
    return {
      statusCode: e.statusCode || 502,
      headers: { ...cors.headers, ...retryAfter, "Content-Type": "application/json" },
      body: JSON.stringify({ error: e.message || "AI compatibility proxy error", retryAfterSeconds: e.retryAfterSeconds || null }),
    };
  }
};
