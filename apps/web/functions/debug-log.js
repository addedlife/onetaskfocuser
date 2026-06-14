// debug-log — Firestore-backed log collector for live debugging.
//
//   POST /api/debug-log
//     Body: { source, level?, msg, data? }   → writes one entry
//
//   GET  /api/debug-log?action=tail&limit=100
//     → { logs: [{ts, source, level, msg, data}, ...] } (oldest first)
//
//   GET  /api/debug-log?action=clear
//     → { deleted: N }

const { corsHeaders } = require("./cors-helper");

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
  getDb();
  const { getAuth: _getAuth } = require("firebase-admin/auth");
  adminAuth = _getAuth();
  return adminAuth;
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || "";
  const headers = corsHeaders(origin);
  const q = req.query || {};

  if (req.method === "OPTIONS") {
    return res.status(204).set(headers).end();
  }

  let db;
  try { db = getDb(); }
  catch (err) { return res.status(503).set(headers).json({ error: String(err.message || err) }); }

  if (req.method === "POST") {
    const body = req.body || {};
    const entry = {
      ts:     Date.now(),
      source: String(body.source || "unknown").slice(0, 120),
      level:  String(body.level  || "info").slice(0, 20),
      msg:    String(body.msg    || "").slice(0, 2000),
      data:   body.data != null ? JSON.stringify(body.data).slice(0, 5000) : null,
    };
    try {
      await db.collection("debugLogs").add(entry);
      return res.status(200).set(headers).json({ ok: true });
    } catch (err) {
      return res.status(500).set(headers).json({ error: String(err.message || err) });
    }
  }

  if (q.action === "tail" || q.action === "clear") {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return res.status(401).set(headers).json({ error: "Sign in required" });
    try { await getAuth().verifyIdToken(token); }
    catch { return res.status(401).set(headers).json({ error: "Invalid or expired sign-in" }); }
  }

  if (q.action === "tail") {
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 100));
    try {
      const snap = await db.collection("debugLogs").orderBy("ts", "desc").limit(limit).get();
      const logs = snap.docs.map(d => d.data()).reverse();
      return res.status(200).set(headers).json({ count: logs.length, logs });
    } catch (err) {
      return res.status(500).set(headers).json({ error: String(err.message || err) });
    }
  }

  if (q.action === "clear") {
    try {
      const snap = await db.collection("debugLogs").limit(500).get();
      if (snap.empty) return res.status(200).set(headers).json({ deleted: 0 });
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      return res.status(200).set(headers).json({ deleted: snap.size });
    } catch (err) {
      return res.status(500).set(headers).json({ error: String(err.message || err) });
    }
  }

  return res.status(400).set(headers).json({ error: `Unknown action: ${q.action || "(none)"}` });
};
