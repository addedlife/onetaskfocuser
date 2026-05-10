const { corsFor, processAiPayload } = require("./_ai-core.cjs");

exports.handler = async (event) => {
  const cors = corsFor(event);

  if (!cors.isAllowed) {
    return {
      statusCode: 403,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Origin not allowed" }),
    };
  }

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors.headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { ...cors.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const payload = event.body ? JSON.parse(event.body) : {};
    const result = await processAiPayload(payload);
    return {
      statusCode: 200,
      headers: { ...cors.headers, "Content-Type": "application/json" },
      body: JSON.stringify(result),
    };
  } catch (e) {
    return {
      statusCode: e.statusCode || 502,
      headers: { ...cors.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ error: e.message || "AI proxy error" }),
    };
  }
};
