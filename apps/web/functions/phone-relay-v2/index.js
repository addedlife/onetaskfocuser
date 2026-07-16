// phoneRelayV2 — hardened, schema-validated rebuild of the phone-relay HTTP
// surface. Every path here touches only *-v2 collections/RTDB nodes; the live
// phone-relay/* data and the live phoneRelay function are completely
// untouched, so nothing here can affect the running app until an explicit
// future rewire.
//
// Fixes vs. v1 (phone-relay.js), each a confirmed gap found in that file:
//   - every payload is Zod-validated, not ad hoc truthy checks
//   - user actions use a real admin.auth().verifyIdToken(), not a
//     side-effecting Firestore read used as a proxy for "auth check"
//   - command paths are allowlisted SERVER-SIDE (schemas.js), not just in
//     the browser's CLOUD_ALLOWED_COMMANDS, which the live server ignores
//   - each host platform gets its own secret (PHONE_RELAY_V2_SECRET_WINDOWS /
//     _ANDROID) instead of one shared PHONE_RELAY_SECRET forever
//   - CORS is reused from the shared cors-helper.js allowlist, not a
//     hand-rolled "*" wildcard
//   - Firestore writes for state/media happen ONLY through this function's
//     Admin SDK — see firestore.rules' phone-relay-v2/* block, which can
//     finally be `allow write: if false` because of that
const { getAdminAuth, getAdminDatabase, getAdminDb } = require("../_config.cjs");
const { corsHeaders } = require("../cors-helper.js");
const {
  StatePushSchema,
  PushMediaSchema,
  CommandSchema,
  RelayTokenRequestSchema,
} = require("./schemas.js");

const STATE_COLLECTION = "phone-relay-v2";
const MEDIA_COLLECTION = "phone-media-v2";
const OWNER_EMAILS = ["rabbidanziger@hocsouthbend.com", "ydanziger20@gmail.com"];

function sendJson(res, status, origin, body) {
  return res.status(status).set({ ...corsHeaders(origin), "Content-Type": "application/json" }).json(body);
}

function extractIdToken(req) {
  const authHeader = req.headers["authorization"] || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

function extractHostSecret(req) {
  return req.headers["x-relay-secret"] || "";
}

// Per-platform secret, Secret-Manager-backed in production (bound to these
// env var names via `firebase functions:secrets:set`). Falls back to one
// shared PHONE_RELAY_V2_SECRET only so a local emulator run without secrets
// configured doesn't hard-fail — never rely on the fallback in production.
function hostSecretFor(hostType) {
  const name = hostType === "windows" ? "PHONE_RELAY_V2_SECRET_WINDOWS" : "PHONE_RELAY_V2_SECRET_ANDROID";
  return process.env[name] || process.env.PHONE_RELAY_V2_SECRET || "";
}

async function requireOwner(req) {
  const idToken = extractIdToken(req);
  if (!idToken) return { ok: false, status: 401, error: "Firebase ID token required" };
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken);
  } catch {
    return { ok: false, status: 401, error: "Invalid or expired token — sign in again" };
  }
  if (!decoded.email_verified || !OWNER_EMAILS.includes(decoded.email)) {
    return { ok: false, status: 403, error: "Not authorized for phone relay" };
  }
  return { ok: true, decoded };
}

function requireHostSecret(req, hostType) {
  if (hostType !== "windows" && hostType !== "android") return false;
  const expected = hostSecretFor(hostType);
  const incoming = extractHostSecret(req);
  return !!expected && incoming === expected;
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || "";
  if (req.method === "OPTIONS") {
    return res.status(204).set(corsHeaders(origin)).end();
  }

  const action = String(req.query.action || "").toLowerCase();
  const method = req.method;

  try {
    // ── state: webapp reads latest v2 phone state ───────────────────────────
    if (action === "state" && method === "GET") {
      const auth = await requireOwner(req);
      if (!auth.ok) return sendJson(res, auth.status, origin, { error: auth.error });
      const doc = await getAdminDb().collection(STATE_COLLECTION).doc("state").get();
      if (!doc.exists) return sendJson(res, 404, origin, { error: "No state pushed yet" });
      return sendJson(res, 200, origin, doc.data());
    }

    // ── push: host → cloud state snapshot ───────────────────────────────────
    if (action === "push" && method === "POST") {
      const hostType = String(req.query.hostType || req.body?.hostId || "").toLowerCase();
      if (!requireHostSecret(req, hostType)) return sendJson(res, 401, origin, { error: "unauthorized" });
      const parsed = StatePushSchema.safeParse(req.body || {});
      if (!parsed.success) return sendJson(res, 400, origin, { error: "invalid payload", details: parsed.error.issues });
      const data = { ...parsed.data, relayReceivedAt: Date.now() };
      await getAdminDb().collection(STATE_COLLECTION).doc("state").set(data);
      return sendJson(res, 200, origin, { ok: true });
    }

    // ── pushMedia: host → cloud MMS preview image ───────────────────────────
    if (action === "pushmedia" && method === "POST") {
      const hostType = String(req.query.hostType || req.body?.hostType || "").toLowerCase();
      if (!requireHostSecret(req, hostType)) return sendJson(res, 401, origin, { error: "unauthorized" });
      const parsed = PushMediaSchema.safeParse(req.body || {});
      if (!parsed.success) return sendJson(res, 400, origin, { error: "invalid payload", details: parsed.error.issues });
      await getAdminDb().collection(MEDIA_COLLECTION).doc(parsed.data.id).set({
        dataUrl: parsed.data.dataUrl,
        receivedAt: Date.now(),
      });
      return sendJson(res, 200, origin, { ok: true, id: parsed.data.id });
    }

    // ── command: webapp → cloud command queue, stamped with the CURRENT
    // leader's fencing token so a host that has since been superseded can
    // recognize a stale command and refuse to act on it.
    if (action === "command" && method === "POST") {
      const auth = await requireOwner(req);
      if (!auth.ok) return sendJson(res, auth.status, origin, { error: auth.error });
      const parsed = CommandSchema.safeParse(req.body || {});
      if (!parsed.success) return sendJson(res, 400, origin, { error: "invalid or disallowed command", details: parsed.error.issues });

      const db = getAdminDatabase();
      const leaderSnap = await db.ref("phone-relay-v2/leader").get();
      const leader = leaderSnap.val() || null;
      const cmd = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        path: parsed.data.path,
        queuedAt: Date.now(),
        fencingToken: leader?.fencingToken || 0,
      };
      const commandsRef = db.ref("phone-relay-v2/commands");
      const snap = await commandsRef.get();
      const raw = snap.val();
      const existing = Array.isArray(raw) ? raw : (raw && typeof raw === "object" ? Object.values(raw) : []);
      existing.push(cmd);
      await commandsRef.set(existing.slice(-50));
      return sendJson(res, 200, origin, { ok: true, id: cmd.id, leaderHostId: leader?.hostId || "" });
    }

    // ── diagnostics: webapp (tester UI) reads presence/leader/pending-commands.
    // RTDB rules gate those paths to relay_device-claimed hosts only, so the
    // owner's browser can't read them directly — this action reads them with
    // the Admin SDK (which bypasses rules, same as every other host-facing
    // path here) on the owner's behalf instead of widening the RTDB rules.
    if (action === "diagnostics" && method === "GET") {
      const auth = await requireOwner(req);
      if (!auth.ok) return sendJson(res, auth.status, origin, { error: auth.error });
      const db = getAdminDatabase();
      const [presenceSnap, leaderSnap, commandsSnap] = await Promise.all([
        db.ref("phone-relay-v2/presence").get(),
        db.ref("phone-relay-v2/leader").get(),
        db.ref("phone-relay-v2/commands").get(),
      ]);
      const rawCommands = commandsSnap.val();
      const commands = Array.isArray(rawCommands)
        ? rawCommands
        : (rawCommands && typeof rawCommands === "object" ? Object.values(rawCommands) : []);
      return sendJson(res, 200, origin, {
        presence: presenceSnap.val() || {},
        leader: leaderSnap.val() || null,
        pendingCommands: commands,
        serverNow: Date.now(),
      });
    }

    // ── relayToken: host → cloud, exchanges its per-platform secret for a
    // real Firebase custom token carrying relay_device + host_id claims, so
    // RTDB rules gate presence/commands per host instead of one shared
    // "deskphone-relay" identity for every install (v1's model).
    if (action === "relaytoken" && method === "POST") {
      const parsed = RelayTokenRequestSchema.safeParse(req.body || {});
      if (!parsed.success) return sendJson(res, 400, origin, { error: "invalid payload", details: parsed.error.issues });
      if (!requireHostSecret(req, parsed.data.hostType)) return sendJson(res, 401, origin, { error: "unauthorized" });
      const uid = `relay-${parsed.data.hostType}-${parsed.data.hostInstanceId || "default"}`;
      const customToken = await getAdminAuth().createCustomToken(uid, {
        relay_device: true,
        host_id: parsed.data.hostType,
      });
      return sendJson(res, 200, origin, { customToken });
    }

    return sendJson(res, 400, origin, { error: `unknown action '${action}' for ${method}` });
  } catch (e) {
    return sendJson(res, 500, origin, { error: "internal error: " + (e?.message || String(e)) });
  }
};
