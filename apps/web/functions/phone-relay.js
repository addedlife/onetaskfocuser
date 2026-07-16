/**
 * Phone relay — cloud mailbox between DeskPhone.exe and any remote browser.
 * (Converted from phone-relay.mjs — same logic, Firebase Functions v2 Express signature)
 *
 * Routes (via ?action= query param):
 *   GET  ?action=state    → webapp reads latest phone state  (requires Firebase ID token)
 *   POST ?action=push     → DeskPhone pushes state blob; response carries queued commands
 *   POST ?action=push-media → DeskPhone uploads resized picture-text images
 *   POST ?action=command  → webapp queues a command          (requires Firebase ID token)
 *   GET  ?action=drain    → DeskPhone drains command queue   (legacy, kept for back-compat)
 *
 * No npm packages — uses native fetch() for Firestore REST calls.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Relay-Secret, Authorization",
};

const { FIREBASE_PROJECT_ID, FIREBASE_WEB_API_KEY, getAdminAuth, getAdminDatabase } = require("./_config.cjs");
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/phone-relay`;
const FS_MEDIA_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/phone-media`;

function sendOk(res, body) {
  return res.status(200).set({ ...CORS, "Content-Type": "application/json" }).json(body);
}

function sendErr(res, statusCode, msg) {
  return res.status(statusCode).set({ ...CORS, "Content-Type": "application/json" }).json({ error: msg });
}

async function fsGet(docId, idToken = null) {
  const url = `${FS_BASE}/${docId}?key=${FIREBASE_WEB_API_KEY}`;
  const headers = {};
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
  const r = await fetch(url, { headers });
  if (r.status === 404) return null;
  if (r.status === 401) throw new Error("auth:token_invalid");
  if (r.status === 403) throw new Error("auth:firestore_denied");
  if (!r.ok) throw new Error(`Firestore GET ${docId} → HTTP ${r.status}`);
  const json = await r.json();
  return json.fields?.data?.stringValue ?? null;
}

async function fsSet(docId, value) {
  const url = `${FS_BASE}/${docId}?key=${FIREBASE_WEB_API_KEY}&updateMask.fieldPaths=data`;
  const r = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { data: { stringValue: value } } }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Firestore PATCH ${docId} → HTTP ${r.status}: ${text}`);
  }
}

async function fsSetMedia(docId, dataUrl) {
  const url = `${FS_MEDIA_BASE}/${encodeURIComponent(docId)}?key=${FIREBASE_WEB_API_KEY}&updateMask.fieldPaths=data`;
  const r = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { data: { stringValue: dataUrl } } }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Firestore PATCH media ${docId} → HTTP ${r.status}: ${text}`);
  }
}

// Command mailbox lives in the Realtime Database (not Firestore) so DeskPhone can
// hold a true SSE push stream on it — zero idle reads, sub-second command delivery.
// database.rules.json locks that path to auth.token.relay_device === true, which
// DeskPhone's direct SSE/drain calls carry (see RelayService.cs) but this Cloud
// Function has no such token — it uses the Admin SDK instead, which authenticates
// via service-account credentials and bypasses the rules entirely.
async function rtdbGetCommands() {
  const snap = await getAdminDatabase().ref("phone-relay/commands").get();
  const parsed = snap.val();
  if (Array.isArray(parsed)) return parsed;
  // RTDB returns an object map when array keys go sparse — normalize back.
  if (parsed && typeof parsed === "object") return Object.values(parsed);
  return [];
}

async function rtdbSetCommands(arr) {
  await getAdminDatabase().ref("phone-relay/commands").set(arr.length ? arr : null);
}

function extractIdToken(req) {
  const authHeader = req.headers["authorization"] || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    return res.status(204).set(CORS).end();
  }

  const action = (req.query.action || "").toLowerCase();
  const method = req.method;
  const secret = process.env.PHONE_RELAY_SECRET || "";
  const incoming = req.headers["x-relay-secret"] || "";

  // ── GET state (webapp reads phone data — Firebase auth required) ─────────
  if (action === "state" && method === "GET") {
    const idToken = extractIdToken(req);
    if (!idToken) return sendErr(res, 401, "Firebase ID token required — sign in to access phone data");
    try {
      const state = await fsGet("state", idToken);
      if (!state) return sendErr(res, 404, "No state — DeskPhone has not pushed yet");
      return res.status(200).set({ ...CORS, "Content-Type": "application/json" }).send(state);
    } catch (e) {
      if (e.message === "auth:token_invalid") return sendErr(res, 401, "Invalid or expired Firebase token — sign in again");
      if (e.message === "auth:firestore_denied") return sendErr(res, 403, "Firestore security rules denied access");
      return sendErr(res, 500, "Failed to read state: " + e.message);
    }
  }

  // ── POST push (DeskPhone → cloud, relay secret required) ─────────────────
  if (action === "push" && method === "POST") {
    if (!secret || incoming !== secret) return sendErr(res, 401, "unauthorized");
    // Use rawBody if available (Firebase provides it); otherwise stringify the parsed body
    const rawStr = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body || {});
    if (!rawStr || rawStr === "{}") return sendErr(res, 400, "empty body");
    let toStore = rawStr;
    try {
      const parsed = JSON.parse(rawStr);
      parsed.relayReceivedAt = Date.now();
      toStore = JSON.stringify(parsed);
    } catch (_) { /* non-JSON — store untouched */ }
    try { await fsSet("state", toStore); }
    catch (e) { return sendErr(res, 500, "Failed to write state: " + e.message); }
    let commands = [];
    try {
      const pending = await rtdbGetCommands();
      if (pending.length > 0) {
        await rtdbSetCommands([]);
        commands = pending;
      }
    } catch (_) { commands = []; }
    return sendOk(res, { ok: true, commands });
  }

  // ── POST push-media (DeskPhone → cloud, relay secret required) ───────────
  if (action === "push-media" && method === "POST") {
    if (!secret || incoming !== secret) return sendErr(res, 401, "unauthorized");
    const payload = req.body || {};
    if (!payload.id || !payload.dataUrl) return sendErr(res, 400, "missing id or dataUrl");
    try {
      await fsSetMedia(String(payload.id), String(payload.dataUrl));
      return sendOk(res, { ok: true, id: payload.id });
    } catch (e) {
      return sendErr(res, 500, "Failed to write media: " + e.message);
    }
  }

  // ── POST command (webapp → cloud, Firebase auth required) ────────────────
  if (action === "command" && method === "POST") {
    const idToken = extractIdToken(req);
    if (!idToken) return sendErr(res, 401, "Firebase ID token required — sign in to queue commands");
    try { await fsGet("state", idToken); }
    catch (e) {
      if (e.message === "auth:token_invalid") return sendErr(res, 401, "Invalid or expired sign-in — sign in again");
      return sendErr(res, 401, "Could not verify sign-in");
    }
    const cmd = req.body || {};
    if (!cmd.path) return sendErr(res, 400, "missing path");
    cmd.id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    cmd.queuedAt = Date.now();
    try {
      const existing = await rtdbGetCommands();
      existing.push(cmd);
      await rtdbSetCommands(existing.slice(-50));
      return sendOk(res, { ok: true, id: cmd.id });
    } catch (e) {
      return sendErr(res, 500, "Failed to queue command: " + e.message);
    }
  }

  // ── GET drain (cloud → DeskPhone, relay secret required) ─────────────────
  if (action === "drain" && method === "GET") {
    if (!secret || incoming !== secret) return sendErr(res, 401, "unauthorized");
    try {
      const commands = await rtdbGetCommands();
      if (commands.length > 0) await rtdbSetCommands([]);
      return sendOk(res, commands);
    } catch (e) {
      return sendErr(res, 500, "Failed to drain commands: " + e.message);
    }
  }

  // ── POST relay-token (DeskPhone → cloud, relay secret required) ──────────
  // The commands mailbox lives in the Realtime Database so DeskPhone can hold a
  // true SSE stream on it (see RelayService.cs) — but RTDB rules can't check an
  // arbitrary shared secret, only a real Firebase auth token. This mints a
  // short-lived custom token (exchanged by DeskPhone for an ID token) carrying
  // relay_device:true, which database.rules.json requires for that one path.
  if (action === "relay-token" && method === "POST") {
    if (!secret || incoming !== secret) return sendErr(res, 401, "unauthorized");
    try {
      const customToken = await getAdminAuth().createCustomToken("deskphone-relay", { relay_device: true });
      return sendOk(res, { customToken });
    } catch (e) {
      return sendErr(res, 500, "Failed to mint relay token: " + e.message);
    }
  }

  return sendErr(res, 400, `unknown action '${action}' for ${method}`);
};
