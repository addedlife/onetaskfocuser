const { corsFor, publicAiConfig } = require("./_ai-core.cjs");

exports.handler = async function(event) {
  const cors = corsFor(event, "GET, OPTIONS");
  if (!cors.isAllowed) {
    return {
      statusCode: 403,
      headers: cors.headers,
      body: JSON.stringify({ error: "origin_not_allowed" }),
    };
  }
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors.headers, body: "" };
  }

  return {
    statusCode: 200,
    headers: { ...cors.headers, "Content-Type": "application/json" },
    body: JSON.stringify(publicAiConfig()),
  };
};
