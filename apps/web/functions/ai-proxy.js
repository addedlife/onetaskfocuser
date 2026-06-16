const { corsFor, processAiPayload } = require("./_ai-core.cjs");

// ── Auth gate ───────────────────────────────────────────────────────────────
// This endpoint spends real money on every call (Claude/Gemini). Without an auth
// check, anyone who learns the URL can run up the bill — the CORS check is NOT
// security (it only constrains browsers; curl can spoof Origin). So we require a
// valid Firebase ID token, same as chief-profile.js. Uses the ADMIN_SA_JSON
// service-account env the other functions already rely on.
let _adminAuth = null;
function _getAdminAuth() {
  if (_adminAuth) return _adminAuth;
  const raw = process.env.ADMIN_SA_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) { const e = new Error("Auth not configured"); e.statusCode = 503; throw e; }
  const sa = JSON.parse(raw);
  const { cert, getApps, initializeApp } = require("firebase-admin/app");
  const { getAuth } = require("firebase-admin/auth");
  const app = getApps()[0] || initializeApp({ credential: cert(sa), projectId: sa.projectId || sa.project_id });
  _adminAuth = getAuth(app);
  return _adminAuth;
}
async function _requireUser(authorizationHeader) {
  const h = authorizationHeader || "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token) { const e = new Error("Sign-in required"); e.statusCode = 401; throw e; }
  await _getAdminAuth().verifyIdToken(token);
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
    const retryAfter = e.retryAfterSeconds ? { "Retry-After": String(e.retryAfterSeconds) } : {};
    return res.status(e.statusCode || 502).set({ ...cors.headers, ...retryAfter, "Content-Type": "application/json" }).json({
      error: e.message || "AI proxy error",
      retryAfterSeconds: e.retryAfterSeconds || null,
    });
  }
};
