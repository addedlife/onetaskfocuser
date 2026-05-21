/**
 * Phone relay — cloud mailbox between DeskPhone.exe and any remote browser.
 * Storage: Firestore collection "phone-relay", document "singleton".
 *
 * Routes (via ?action= query param):
 *   GET  ?action=state    → webapp reads latest phone state (public)
 *   POST ?action=push     → DeskPhone pushes state blob (requires X-Relay-Secret)
 *   POST ?action=command  → webapp queues a command (public)
 *   GET  ?action=drain    → DeskPhone drains command queue (requires X-Relay-Secret)
 */

const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const DOC_PATH = "phone-relay/singleton";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Relay-Secret",
};

function ok(body) {
  return {
    statusCode: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

function err(statusCode, msg) {
  return {
    statusCode,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify({ error: msg }),
  };
}

function initDb() {
  if (getApps().length) return getFirestore();
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson) {
    initializeApp({ credential: cert(JSON.parse(rawJson)) });
  } else {
    const projectId  = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }
  return getFirestore();
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const action   = (event.queryStringParameters?.action || "").toLowerCase();
  const method   = event.httpMethod;
  const secret   = process.env.PHONE_RELAY_SECRET || "";
  const incoming = event.headers["x-relay-secret"] || event.headers["X-Relay-Secret"] || "";

  let db;
  try {
    db = initDb();
  } catch (e) {
    return err(503, "DB init failed: " + e.message);
  }

  const docRef = db.doc(DOC_PATH);

  // ── GET state ─────────────────────────────────────────────────────────────
  if (action === "state" && method === "GET") {
    try {
      const snap = await docRef.get();
      if (!snap.exists || !snap.data()?.state) {
        return err(404, "No state — DeskPhone has not pushed yet");
      }
      return ok(snap.data().state);
    } catch (e) {
      return err(500, "Failed to read state: " + e.message);
    }
  }

  // ── POST push (DeskPhone → cloud) ─────────────────────────────────────────
  if (action === "push" && method === "POST") {
    if (!secret || incoming !== secret) return err(401, "unauthorized");
    const body = event.body || "";
    if (!body) return err(400, "empty body");
    try {
      await docRef.set({ state: body, updatedAt: new Date() }, { merge: true });
      return ok({ ok: true });
    } catch (e) {
      return err(500, "Failed to write state: " + e.message);
    }
  }

  // ── POST command (webapp → cloud) ─────────────────────────────────────────
  if (action === "command" && method === "POST") {
    let cmd;
    try { cmd = JSON.parse(event.body || "{}"); } catch { return err(400, "invalid JSON"); }
    if (!cmd.path) return err(400, "missing path");
    cmd.id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    cmd.queuedAt = Date.now();
    try {
      const snap = await docRef.get();
      const existing = JSON.parse(snap.data()?.commands || "[]");
      existing.push(cmd);
      const capped = existing.slice(-50);
      await docRef.set({ commands: JSON.stringify(capped) }, { merge: true });
      return ok({ ok: true, id: cmd.id });
    } catch (e) {
      return err(500, "Failed to queue command: " + e.message);
    }
  }

  // ── GET drain (cloud → DeskPhone) ─────────────────────────────────────────
  if (action === "drain" && method === "GET") {
    if (!secret || incoming !== secret) return err(401, "unauthorized");
    try {
      const snap = await docRef.get();
      const commands = JSON.parse(snap.data()?.commands || "[]");
      if (commands.length > 0) await docRef.set({ commands: "[]" }, { merge: true });
      return ok(commands);
    } catch (e) {
      return err(500, "Failed to drain commands: " + e.message);
    }
  }

  return err(400, `unknown action '${action}' for ${method}`);
};
