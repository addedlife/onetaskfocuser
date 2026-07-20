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
function normalizeCommands(parsed) {
  if (Array.isArray(parsed)) return parsed;
  // RTDB returns an object map when array keys go sparse — normalize back.
  if (parsed && typeof parsed === "object") return Object.values(parsed);
  return [];
}

function commandsRef() {
  return getAdminDatabase().ref("phone-relay/commands");
}

// All mailbox mutations run as RTDB transactions (atomic read-modify-write).
// The old read-then-set pattern had real races: a command queued between
// another caller's read and write was silently wiped, and two hosts pushing
// at once could BOTH receive the same commands — a duplicate-send vector
// (flagged in the 7/19 relay hardening audit).
async function rtdbAppendCommand(cmd) {
  await commandsRef().transaction((curr) => {
    const arr = normalizeCommands(curr);
    arr.push(cmd);
    return arr.slice(-50);
  });
}

async function rtdbTakeAllCommands() {
  let taken = [];
  await commandsRef().transaction((curr) => {
    taken = normalizeCommands(curr);
    return null;
  });
  return taken;
}

async function rtdbRemoveCommand(id) {
  let removed = false;
  await commandsRef().transaction((curr) => {
    const arr = normalizeCommands(curr);
    const remaining = arr.filter((c) => c?.id !== id);
    removed = remaining.length !== arr.length;
    return remaining.length ? remaining : null;
  });
  return removed;
}

// Commands that sat undelivered longer than this are dropped at delivery time,
// never handed to a host — firing a stale /send when a host finally reconnects
// would text real people hours late (owner incident 7/17: 13 commands,
// including real replies, stranded 12+ hours while every host's mailbox read
// was failing auth; delivering them on recovery would have sent duplicates).
const COMMAND_TTL_MS = 10 * 60 * 1000;

function dropExpiredCommands(all) {
  const now = Date.now();
  const fresh = [];
  const stale = [];
  for (const c of all) ((now - (Number(c?.queuedAt) || 0)) <= COMMAND_TTL_MS ? fresh : stale).push(c);
  if (stale.length) {
    // ids + age only — command paths carry private message text.
    console.warn(`[phone-relay] dropped ${stale.length} expired command(s): ` +
      stale.map((c) => `${c?.id || "?"} age=${Math.round((now - (Number(c?.queuedAt) || 0)) / 60000)}m`).join(", "));
  }
  return fresh;
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
      const pending = await rtdbTakeAllCommands();
      if (pending.length > 0) commands = dropExpiredCommands(pending);
    } catch (e) {
      // Swallowing this silently hid a dead command channel for days (7/17
      // incident) — the push must still succeed, but the failure gets logged.
      console.error("[phone-relay] push-path command drain failed:", e.message);
      commands = [];
    }
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
      await rtdbAppendCommand(cmd);
      return sendOk(res, { ok: true, id: cmd.id });
    } catch (e) {
      return sendErr(res, 500, "Failed to queue command: " + e.message);
    }
  }

  // ── POST cancel (webapp → cloud, Firebase auth required) ─────────────────
  // The webapp gives up waiting for a command ack after ~25 s and tells the
  // user it failed — but the command itself used to stay live in the mailbox
  // for its full TTL (10 min for /send), so a host reconnecting inside that
  // window fired every "failed" send anyway (owner incident 7/19: four /send
  // commands queued 8:05–8:13 PM all executed at 8:14 PM — real duplicate
  // texts). Cancel removes the command so a "failed" verdict is a guarantee.
  // `removed: false` tells the caller a host already took it (may be mid-send).
  if (action === "cancel" && method === "POST") {
    const idToken = extractIdToken(req);
    if (!idToken) return sendErr(res, 401, "Firebase ID token required — sign in to cancel commands");
    try { await fsGet("state", idToken); }
    catch (e) {
      if (e.message === "auth:token_invalid") return sendErr(res, 401, "Invalid or expired sign-in — sign in again");
      return sendErr(res, 401, "Could not verify sign-in");
    }
    const id = String((req.body || {}).id || "");
    if (!id) return sendErr(res, 400, "missing id");
    try {
      const removed = await rtdbRemoveCommand(id);
      return sendOk(res, { ok: true, removed });
    } catch (e) {
      return sendErr(res, 500, "Failed to cancel command: " + e.message);
    }
  }

  // ── GET drain (cloud → DeskPhone, relay secret required) ─────────────────
  if (action === "drain" && method === "GET") {
    if (!secret || incoming !== secret) return sendErr(res, 401, "unauthorized");
    try {
      const commands = await rtdbTakeAllCommands();
      return sendOk(res, dropExpiredCommands(commands));
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
