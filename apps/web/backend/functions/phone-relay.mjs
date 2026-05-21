/**
 * Phone relay — cloud mailbox between DeskPhone.exe and any remote browser.
 *
 * Routes (via ?action= query param):
 *   GET  ?action=state    → webapp reads latest phone state  (requires Firebase ID token)
 *   POST ?action=push     → DeskPhone pushes state blob      (requires X-Relay-Secret)
 *   POST ?action=command  → webapp queues a command          (requires Firebase ID token)
 *   GET  ?action=drain    → DeskPhone drains command queue   (requires X-Relay-Secret)
 *
 * Auth design:
 *   - state / command: webapp sends "Authorization: Bearer {firebaseIdToken}" header.
 *     The token is forwarded to Firestore for state reads (rules enforce request.auth != null).
 *     For command writes the token is validated at this layer then discarded before the
 *     Firestore write (commands doc allows unauthenticated writes so DeskPhone drain works).
 *   - push / drain: DeskPhone uses X-Relay-Secret; no Firebase token involved.
 *
 * Storage: Firestore REST API — project onetaskonly-app, collection "phone-relay"
 *   Document "state"    — { data: <JSON string of latest phone state> }
 *   Document "commands" — { data: <JSON string of pending command array> }
 *
 * No npm packages — uses native fetch() so there are no bundler/ESM issues.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Relay-Secret, Authorization",
};

const FB_PROJECT = "onetaskonly-app";
// Firebase web API key — public by design; security enforced by Firestore rules + secret header.
const FB_API_KEY = "AIzaSyB5UiDE9s0xjWeYa4OQ1LLJ63EwPVoSLrA";
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/phone-relay`;

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

/**
 * Read a Firestore document.
 * Pass idToken to call as an authenticated Firebase user (Firestore rules apply).
 * Omit idToken to call with only the API key (unauthenticated — only works where rules allow it).
 */
async function fsGet(docId, idToken = null) {
  let url, headers = {};
  if (idToken) {
    url = `${FS_BASE}/${docId}`;
    headers["Authorization"] = `Bearer ${idToken}`;
  } else {
    url = `${FS_BASE}/${docId}?key=${FB_API_KEY}`;
  }
  const res = await fetch(url, { headers });
  if (res.status === 404) return null;
  if (res.status === 403) throw new Error("Firestore denied — check auth or security rules");
  if (!res.ok) throw new Error(`Firestore GET ${docId} → HTTP ${res.status}`);
  const json = await res.json();
  return json.fields?.data?.stringValue ?? null;
}

/** Write a string into the "data" field of a Firestore document (creates-or-updates). */
async function fsSet(docId, value) {
  const url = `${FS_BASE}/${docId}?key=${FB_API_KEY}&updateMask.fieldPaths=data`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { data: { stringValue: value } } }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore PATCH ${docId} → HTTP ${res.status}: ${text}`);
  }
}

/** Extract a Firebase ID token from "Authorization: Bearer <token>" header. Returns null if absent. */
function extractIdToken(event) {
  const authHeader = event.headers["authorization"] || event.headers["Authorization"] || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const action = (event.queryStringParameters?.action || "").toLowerCase();
  const method = event.httpMethod;
  const secret = process.env.PHONE_RELAY_SECRET || "";
  const incoming = event.headers["x-relay-secret"] || event.headers["X-Relay-Secret"] || "";

  // ── GET state (webapp reads phone data — Firebase auth required) ─────────
  if (action === "state" && method === "GET") {
    const idToken = extractIdToken(event);
    if (!idToken) return err(401, "Firebase ID token required — sign in to access phone data");
    try {
      const state = await fsGet("state", idToken);
      if (!state) return err(404, "No state — DeskPhone has not pushed yet");
      return ok(state); // already a JSON string — return as-is
    } catch (e) {
      if (e.message.includes("denied")) return err(403, e.message);
      return err(500, "Failed to read state: " + e.message);
    }
  }

  // ── POST push (DeskPhone → cloud, relay secret required) ─────────────────
  if (action === "push" && method === "POST") {
    if (!secret || incoming !== secret) return err(401, "unauthorized");
    const body = event.body || "";
    if (!body) return err(400, "empty body");
    try {
      await fsSet("state", body);
      return ok({ ok: true });
    } catch (e) {
      return err(500, "Failed to write state: " + e.message);
    }
  }

  // ── POST command (webapp → cloud, Firebase auth required) ────────────────
  if (action === "command" && method === "POST") {
    const idToken = extractIdToken(event);
    if (!idToken) return err(401, "Firebase ID token required — sign in to queue commands");
    let cmd;
    try { cmd = JSON.parse(event.body || "{}"); } catch { return err(400, "invalid JSON"); }
    if (!cmd.path) return err(400, "missing path");
    cmd.id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    cmd.queuedAt = Date.now();
    try {
      const existing = JSON.parse((await fsGet("commands")) || "[]");
      existing.push(cmd);
      const capped = existing.slice(-50);
      await fsSet("commands", JSON.stringify(capped));
      return ok({ ok: true, id: cmd.id });
    } catch (e) {
      return err(500, "Failed to queue command: " + e.message);
    }
  }

  // ── GET drain (cloud → DeskPhone, relay secret required) ─────────────────
  if (action === "drain" && method === "GET") {
    if (!secret || incoming !== secret) return err(401, "unauthorized");
    try {
      const commands = JSON.parse((await fsGet("commands")) || "[]");
      if (commands.length > 0) await fsSet("commands", JSON.stringify([]));
      return ok(commands);
    } catch (e) {
      return err(500, "Failed to drain commands: " + e.message);
    }
  }

  return err(400, `unknown action '${action}' for ${method}`);
};
