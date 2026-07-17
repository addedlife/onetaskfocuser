const { corsFor, processAiPayload } = require("./_ai-core.cjs");
const { getAdminAuth, getRabbiAuth, RABBI_PROJECT_ID } = require("./_config.cjs");

// ── Auth gate ───────────────────────────────────────────────────────────────
// This endpoint spends real money on every call (Claude/Gemini). Without an auth
// check, anyone who learns the URL can run up the bill — the CORS check is NOT
// security (it only constrains browsers; curl can spoof Origin). So we require a
// valid Firebase ID token, same as chief-profile.js. Uses the ADMIN_SA_JSON
// service-account env the other functions already rely on.
//
// Two Firebase projects are trusted: this one (onetaskonly-app) and RabbiMetrics
// (rabbi-s-metrics), whose web app reuses this gateway. The unverified `aud`
// claim only routes the token to the matching verifier — the verifier then
// checks the signature AND that same audience, so a forged aud buys nothing.
function _tokenAudience(token) {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).aud || "";
  } catch { return ""; }
}

async function _requireUser(authorizationHeader) {
  const h = authorizationHeader || "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token) { const e = new Error("Sign-in required"); e.statusCode = 401; throw e; }
  const auth = _tokenAudience(token) === RABBI_PROJECT_ID ? getRabbiAuth() : getAdminAuth();
  await auth.verifyIdToken(token);
}

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
    await _requireUser(req.headers.authorization || req.headers.Authorization);
  } catch (e) {
    return res.status(e.statusCode || 401).set({ ...cors.headers, "Content-Type": "application/json" }).json({ error: e.message || "Unauthorized" });
  }

  try {
    const payload = req.body || {};
    const result = await processAiPayload(payload);
    return res.status(200).set({ ...cors.headers, "Content-Type": "application/json" }).json(result);
  } catch (e) {
    // Name the job in the failure log — request logs alone can't say WHICH caller
    // is hammering a dead gateway (owner ticket 7/16: took Firestore forensics to
    // trace the storm to dashboard-snapshot).
    const payload = req.body || {};
    const jobName = String(payload.job || payload.aiJob || payload.task || "general");
    console.warn(`[AI] request failed — job=${jobName} status=${e.statusCode || 502}: ${e.message}`);
    const retryAfter = e.retryAfterSeconds ? { "Retry-After": String(e.retryAfterSeconds) } : {};
    return res.status(e.statusCode || 502).set({ ...cors.headers, ...retryAfter, "Content-Type": "application/json" }).json({
      error: e.message || "AI proxy error",
      retryAfterSeconds: e.retryAfterSeconds || null,
    });
  }
};
