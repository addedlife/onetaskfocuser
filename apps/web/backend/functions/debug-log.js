// debug-log — Firestore-backed log collector for live debugging.
//
//   POST /.netlify/functions/debug-log
//     Body: { source, level?, msg, data? }   → writes one entry
//
//   GET  /.netlify/functions/debug-log?action=tail&limit=100
//     → { logs: [{ts, source, level, msg, data}, ...] } (oldest first)
//
//   GET  /.netlify/functions/debug-log?action=clear
//     → { deleted: N }
//
// Uses the same Firebase Admin creds as google-health.js / google-workspace.js.

let adminDb = null;
function firebaseServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) return JSON.parse(raw);
  const p = process.env.FIREBASE_PROJECT_ID;
  const e = process.env.FIREBASE_CLIENT_EMAIL;
  const k = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!p || !e || !k) return null;
  return { projectId: p, clientEmail: e, privateKey: k };
}
function getDb() {
  if (adminDb) return adminDb;
  const sa = firebaseServiceAccount();
  if (!sa) throw new Error("Missing Firebase service account env vars");
  const { cert, getApps, initializeApp } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  const app = getApps()[0] || initializeApp({ credential: cert(sa), projectId: sa.projectId || sa.project_id });
  adminDb = getFirestore(app);
  return adminDb;
}

let adminAuth = null;
function getAuth() {
  if (adminAuth) return adminAuth;
  getDb(); // ensure the Admin app is initialized
  const { getAuth: _getAuth } = require("firebase-admin/auth");
  adminAuth = _getAuth();
  return adminAuth;
}

function corsHeaders(origin = "") {
  // Only our own origins — production, our deploy previews, and localhost.
  // The old rule trusted ANY *.netlify.app site, letting a stranger's page read/clear logs.
  const ok = origin === "https://onetaskfocuser.netlify.app" ||
             /^https:\/\/[a-z0-9-]+--onetaskfocuser\.netlify\.app$/i.test(origin) ||
             /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  const allowed = ok ? origin : "https://onetaskfocuser.netlify.app";
  return {
    "Access-Control-Allow-Origin":  allowed,
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
}

function json(statusCode, body, origin) {
  return { statusCode, headers: { ...corsHeaders(origin), "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export const handler = async (event) => {
  const origin = event.headers?.origin || "";
  const q      = event.queryStringParameters || {};

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(origin), body: "" };
  }

  let db;
  try { db = getDb(); }
  catch (err) { return json(503, { error: String(err.message || err) }, origin); }

  // POST = write a log entry
  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch { return json(400, { error: "Invalid JSON body" }, origin); }

    const entry = {
      ts:     Date.now(),
      source: String(body.source || "unknown").slice(0, 120),
      level:  String(body.level  || "info").slice(0, 20),
      msg:    String(body.msg    || "").slice(0, 2000),
      data:   body.data != null ? JSON.stringify(body.data).slice(0, 5000) : null,
    };

    try {
      await db.collection("debugLogs").add(entry);
      return json(200, { ok: true }, origin);
    } catch (err) {
      return json(500, { error: String(err.message || err) }, origin);
    }
  }

  // Reading or wiping logs is privileged (logs can hold user data) — require a
  // verified sign-in. The write path above stays open so the frontend logger,
  // which posts without a token, keeps working; entries there are length-capped.
  if (q.action === "tail" || q.action === "clear") {
    const header = event.headers?.authorization || event.headers?.Authorization || "";
    const token  = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) return json(401, { error: "Sign in required" }, origin);
    try { await getAuth().verifyIdToken(token); }
    catch { return json(401, { error: "Invalid or expired sign-in" }, origin); }
  }

  // GET ?action=tail&limit=N — newest N entries, returned oldest-first
  if (q.action === "tail") {
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 100));
    try {
      const snap = await db.collection("debugLogs").orderBy("ts", "desc").limit(limit).get();
      const logs = snap.docs.map(d => d.data()).reverse();
      return json(200, { count: logs.length, logs }, origin);
    } catch (err) {
      return json(500, { error: String(err.message || err) }, origin);
    }
  }

  // GET ?action=clear — wipe the collection
  if (q.action === "clear") {
    try {
      const snap = await db.collection("debugLogs").limit(500).get();
      if (snap.empty) return json(200, { deleted: 0 }, origin);
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      return json(200, { deleted: snap.size }, origin);
    } catch (err) {
      return json(500, { error: String(err.message || err) }, origin);
    }
  }

  return json(400, { error: `Unknown action: ${q.action || "(none)"}` }, origin);
};
