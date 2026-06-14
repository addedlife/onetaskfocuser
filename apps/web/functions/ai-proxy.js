const { corsFor, processAiPayload } = require("./_ai-core.cjs");

module.exports = async (req, res) => {
  const cors = corsFor(req);

  if (!cors.isAllowed) {
    return res.status(403).set(cors.headers).json({ error: "Origin not allowed" });
  }

  if (req.method === "OPTIONS") {
    return res.status(204).set(cors.headers).end();
  }

  if (req.method !== "POST") {
    return res.status(405).set({ ...cors.headers, "Content-Type": "application/json" }).json({ error: "Method not allowed" });
  }

  try {
    const payload = req.body || {};
    const result = await processAiPayload(payload);
    return res.status(200).set({ ...cors.headers, "Content-Type": "application/json" }).json(result);
  } catch (e) {
    const retryAfter = e.retryAfterSeconds ? { "Retry-After": String(e.retryAfterSeconds) } : {};
    return res.status(e.statusCode || 502).set({ ...cors.headers, ...retryAfter, "Content-Type": "application/json" }).json({
      error: e.message || "AI proxy error",
      retryAfterSeconds: e.retryAfterSeconds || null,
    });
  }
};
