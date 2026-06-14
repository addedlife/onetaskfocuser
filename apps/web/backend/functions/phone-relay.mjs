/**
 * Phone relay — cloud mailbox between DeskPhone.exe and any remote browser.
 *
 * Routes (via ?action= query param):
 *   GET  ?action=state    → webapp reads latest phone state  (requires Firebase ID token)
 *   POST ?action=push     → DeskPhone pushes state blob; response carries any queued
 *                           commands so a separate drain poll is unnecessary (X-Relay-Secret)
 *   POST ?action=command  → webapp queues a command          (requires Firebase ID token)
 *   GET  ?action=drain    → DeskPhone drains command queue   (requires X-Relay-Secret)
 *                           [legacy — superseded by the push response; kept for back-compat]
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
// Picture-text images are too big for the 1 MiB state doc, so each one lives in its
// own document in a separate "phone-media" collection. DeskPhone uploads a resized
// preview; the webapp reads it back by id (Firestore rule: read if request.auth != null).
const FS_MEDIA_BASE = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/phone-media`;

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
 * Pass idToken for authenticated reads (Firestore rules: request.auth != null).
 * Always includes the API key so Firebase can route the request to the right project.
 *
 * Required Firestore security rules for phone-relay collection:
 *   allow read: if request.auth != null;  // state doc — webapp reads with user token
 *   allow write: if true;                 // all writes gated at Netlify function layer
 * For the commands doc, allow read, write: if true (DeskPhone drains without user token).
 */
async function fsGet(docId, idToken = null) {
  const url = `${FS_BASE}/${docId}?key=${FB_API_KEY}`;
  const headers = {};
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
  const res = await fetch(url, { headers });
  if (res.status === 404) return null;
  if (res.status === 401) throw new Error("auth:token_invalid");
  if (res.status === 403) throw new Error("auth:firestore_denied");
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

/** Write an image preview (a data: URL string) into phone-media/{id}. Create-or-update. */
async function fsSetMedia(docId, dataUrl) {
  const url = `${FS_MEDIA_BASE}/${encodeURIComponent(docId)}?key=${FB_API_KEY}&updateMask.fieldPaths=data`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { data: { stringValue: dataUrl } } }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore PATCH media ${docId} → HTTP ${res.status}: ${text}`);
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
      if (e.message === "auth:token_invalid") return err(401, "Invalid or expired Firebase token — sign in again");
      if (e.message === "auth:firestore_denied") return err(403, "Firestore security rules denied access — set allow read: if request.auth != null for phone-relay/state");
      return err(500, "Failed to read state: " + e.message);
    }
  }

  // ── POST push (DeskPhone → cloud, relay secret required) ─────────────────
  if (action === "push" && method === "POST") {
    if (!secret || incoming !== secret) return err(401, "unauthorized");
    const body = event.body || "";
    if (!body) return err(400, "empty body");
    // Stamp the server-side receive time into the blob. DeskPhone heartbeats on a short
    // interval, so a recent relayReceivedAt means the PC is *currently* connected — that's
    // how remote devices tell live texts/calls from a stale snapshot of a closed PC.
    // Stamped here (not on the PC) so it works without a DeskPhone rebuild and doesn't
    // depend on the PC's clock. Falls back to storing the raw body if it isn't JSON.
    let toStore = body;
    try {
      const parsed = JSON.parse(body);
      parsed.relayReceivedAt = Date.now();
      toStore = JSON.stringify(parsed);
    } catch (_) { /* non-JSON payload — store untouched */ }
    try {
      await fsSet("state", toStore);
    } catch (e) {
      return err(500, "Failed to write state: " + e.message);
    }
    // Piggyback the command drain onto the heartbeat push. DeskPhone used to run a
    // SEPARATE poll (?action=drain) every 2 s, reading the commands doc ~43k times/day
    // even when idle. Now each ~5 s push returns any queued commands in the same round
    // trip, so the host no longer needs the standalone drain loop. (?action=drain stays
    // below for back-compat with hosts that haven't updated yet.)
    let commands = [];
    try {
      const pending = JSON.parse((await fsGet("commands")) || "[]");
      if (pending.length > 0) {
        await fsSet("commands", JSON.stringify([])); // clear FIRST so a failure leaves the
        commands = pending;                          // queue intact rather than double-deliver
      }
    } catch (_) {
      // A drain failure must never fail the push — state is already saved. Leave the
      // queue untouched; the next heartbeat retries it.
      commands = [];
    }
    return ok({ ok: true, commands });
  }

  // ── POST push-media (DeskPhone → cloud, relay secret required) ───────────
  // Body: { id, dataUrl }. Stores one resized picture-text image in phone-media/{id}.
  if (action === "push-media" && method === "POST") {
    if (!secret || incoming !== secret) return err(401, "unauthorized");
    let payload;
    try { payload = JSON.parse(event.body || "{}"); } catch { return err(400, "invalid JSON"); }
    if (!payload.id || !payload.dataUrl) return err(400, "missing id or dataUrl");
    try {
      await fsSetMedia(String(payload.id), String(payload.dataUrl));
      return ok({ ok: true, id: payload.id });
    } catch (e) {
      return err(500, "Failed to write media: " + e.message);
    }
  }

  // ── POST command (webapp → cloud, Firebase auth required) ────────────────
  if (action === "command" && method === "POST") {
    const idToken = extractIdToken(event);
    if (!idToken) return err(401, "Firebase ID token required — sign in to queue commands");
    // Presence isn't enough — actually VERIFY the token. We have no firebase-admin here
    // (this function is deliberately dependency-free), so we validate by doing an
    // authenticated Firestore read: phone-relay/state requires request.auth != null, so a
    // forged/expired token trips a 401 there and we reject. A valid token reads fine (or
    // 404 if nothing pushed yet — still proves the token was accepted). Fail closed.
    try {
      await fsGet("state", idToken);
    } catch (e) {
      if (e.message === "auth:token_invalid") return err(401, "Invalid or expired sign-in — sign in again");
      return err(401, "Could not verify sign-in");
    }
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
