// ── Relay device identity ─────────────────────────────────────────────────────
//
// WHY THIS EXISTS
//
// The relay used to authenticate hosts with ONE shared symmetric secret:
// PHONE_RELAY_SECRET, held as a GitHub Actions secret, baked into a .env at
// deploy time, and compared with `incoming !== secret`. The PC's copy lived in
// a JSON settings file as RelayKey. Two systems, one value, no shared source of
// truth, synced by hand.
//
// That design produced three separate multi-day outages, and each was the same
// root cause wearing a different hat:
//
//   1. The host MINTS a key that can never work. AppSettingsService generated a
//      random Guid when RelayKey was empty. A random Guid has zero chance of
//      equalling PHONE_RELAY_SECRET, so a fresh install, a wiped settings file,
//      a failed settings load, or a second process deterministically produced a
//      host that 401s forever. b342/b343 made that fail LOUDLY (persist-or-
//      abandon) but left the minting in — which is why it came back a third time.
//   2. Rotation had no overlap window. Changing the value in GitHub killed every
//      host until someone hand-edited JSON on each PC (the 7/15 outage).
//   3. The secret WAS the identity. One value, every host, every capability, no
//      expiry, no revocation, and no way to tell two DeskPhone processes apart
//      (the 7/24 collision).
//
// THE FIX — per-device credentials with an enrollment step.
//
// Industry standard for machine-to-cloud auth is not a shared secret; it is a
// per-device credential that the device generates itself, a human approves once,
// and the server can revoke individually. Same shape as pairing a new device to
// a password manager. Here that is:
//
//   • The host generates its own random secret + deviceId on first run. That is
//     now CORRECT rather than fatal, because it is supposed to be unique.
//   • It enrolls as `pending` with a human-readable label ("DeskPhone on SURFACE-PC").
//   • The owner approves it once from the web app, already signed in.
//   • We store only a SHA-256 hash of the secret — never the secret itself.
//   • Every relay call is verified against this collection, not an env var.
//
// All three failure modes die: self-minting works by design, rotation is
// per-device with no global outage, and a second process shows up as a second
// device the owner can see and revoke.
//
// PHONE_RELAY_SECRET remains valid as a legacy fallback so nothing is stranded
// mid-migration. Once every host is enrolled it can be deleted from GitHub.

const crypto = require("crypto");
const { getAdminDb, getAdminAuth } = require("./_config.cjs");

const COLLECTION = "relay-devices";

// Same two accounts firestore.rules calls isAdmin(). Kept in sync by hand and
// deliberately short — this is the list that can approve a new phone host.
const OWNER_EMAILS = ["rabbidanziger@hocsouthbend.com", "ydanziger20@gmail.com"];

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_LABEL = 80;

function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s), "utf8").digest("hex");
}

// Constant-time compare. The old `incoming !== secret` leaked length and
// prefix through timing; with hex hashes of fixed length this is safe and cheap.
function safeEqualHex(a, b) {
  const A = Buffer.from(String(a || ""), "utf8");
  const B = Buffer.from(String(b || ""), "utf8");
  if (A.length !== B.length || A.length === 0) return false;
  return crypto.timingSafeEqual(A, B);
}

function devicesCol() {
  return getAdminDb().collection(COLLECTION);
}

// ── Enrollment ────────────────────────────────────────────────────────────────
// Unauthenticated on purpose: this is the bootstrap, before the device has any
// credential the cloud recognises. It is safe because enrollment grants NOTHING
// — the device lands as `pending` and stays inert until the owner approves it.
//
// The one real attack to defend is takeover of an existing deviceId: if a
// stranger could re-enroll an already-approved id with their own secret, they
// would inherit its approval. So an existing approved/revoked doc is NEVER
// overwritten — a re-enroll must present the matching secret, in which case it
// is simply the same device re-announcing itself and we return current status.
async function enrollDevice({ deviceId, secret, label, platform }) {
  if (!DEVICE_ID_RE.test(String(deviceId || ""))) {
    return { ok: false, code: 400, error: "invalid deviceId" };
  }
  if (!secret || String(secret).length < 16) {
    return { ok: false, code: 400, error: "secret too short (16+ chars)" };
  }
  const id = String(deviceId);
  const secretHash = sha256Hex(secret);
  const cleanLabel = String(label || "").slice(0, MAX_LABEL) || "Unnamed host";
  const cleanPlatform = String(platform || "unknown").slice(0, 32);
  const ref = devicesCol().doc(id);
  const snap = await ref.get();

  if (snap.exists) {
    const d = snap.data() || {};
    const sameDevice = safeEqualHex(d.secretHash, secretHash);
    if (!sameDevice) {
      // Someone (or something) is claiming an id that already belongs to a
      // different credential. Never silently rebind it.
      return { ok: false, code: 409, error: "deviceId already registered to a different credential" };
    }
    await ref.set({ label: cleanLabel, platform: cleanPlatform, lastSeenAt: Date.now() }, { merge: true });
    return { ok: true, status: d.status || "pending", deviceId: id, alreadyEnrolled: true };
  }

  await ref.set({
    label: cleanLabel,
    platform: cleanPlatform,
    secretHash,
    status: "pending",
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    approvedAt: null,
  });
  return { ok: true, status: "pending", deviceId: id, alreadyEnrolled: false };
}

// ── Host verification ─────────────────────────────────────────────────────────
// Returns { ok, deviceId, label, legacy, reason }. `reason` is a short machine
// string the caller turns into an honest 401 body — "unauthorized" alone is what
// made the old outages so slow to diagnose.
async function verifyHost(req) {
  const deviceId = String(req.headers["x-relay-device"] || "").trim();
  const secret = String(req.headers["x-relay-secret"] || "");

  // Legacy path: no device header at all ⇒ old host build. Compare against the
  // env secret, constant-time. Delete this branch once every host is enrolled.
  if (!deviceId) {
    const envSecret = process.env.PHONE_RELAY_SECRET || "";
    if (envSecret && safeEqualHex(sha256Hex(secret), sha256Hex(envSecret))) {
      return { ok: true, deviceId: "legacy-shared-secret", label: "legacy host", legacy: true };
    }
    return { ok: false, reason: "no_device_id" };
  }

  if (!DEVICE_ID_RE.test(deviceId)) return { ok: false, reason: "bad_device_id" };

  let snap;
  try {
    snap = await devicesCol().doc(deviceId).get();
  } catch (e) {
    return { ok: false, reason: "registry_unavailable", detail: e.message };
  }
  if (!snap.exists) return { ok: false, reason: "not_enrolled" };

  const d = snap.data() || {};
  if (!safeEqualHex(d.secretHash, sha256Hex(secret))) return { ok: false, reason: "bad_secret" };
  if (d.status === "pending") return { ok: false, reason: "pending_approval", label: d.label };
  if (d.status === "revoked") return { ok: false, reason: "revoked", label: d.label };
  if (d.status !== "approved") return { ok: false, reason: "not_approved", label: d.label };

  // Fire-and-forget heartbeat: a failed lastSeen write must never fail the call.
  devicesCol().doc(deviceId).set({ lastSeenAt: Date.now() }, { merge: true }).catch(() => {});
  return { ok: true, deviceId, label: d.label, legacy: false };
}

// Human-readable 401 text per failure reason, so the log says what to DO.
function explainDenial(v) {
  switch (v.reason) {
    case "no_device_id":
      return "unauthorized — this host sent no device id and its shared secret does not match";
    case "bad_device_id":
      return "unauthorized — malformed device id";
    case "not_enrolled":
      return "unauthorized — this device is not enrolled; it must enroll and be approved in Settings → Phone hosts";
    case "bad_secret":
      return "unauthorized — device id is known but the secret does not match";
    case "pending_approval":
      return `pending approval — approve "${v.label || "this host"}" in Settings → Phone hosts to turn on remote texting and call control`;
    case "revoked":
      return `revoked — "${v.label || "this host"}" was revoked; re-approve it in Settings → Phone hosts`;
    case "registry_unavailable":
      return "device registry unavailable — try again shortly";
    default:
      return "unauthorized";
  }
}

// ── Owner verification (for the approval surface) ──────────────────────────────
// Verifies the Firebase ID token properly via the Admin SDK and checks it is one
// of the owner accounts with a verified email. Stronger than the old trick of
// "read a Firestore doc with the token and see if rules allow it".
async function verifyOwner(req) {
  const authHeader = req.headers["authorization"] || "";
  if (!authHeader.startsWith("Bearer ")) return { ok: false, error: "Firebase ID token required" };
  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false, error: "Firebase ID token required" };
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    const email = String(decoded.email || "").toLowerCase();
    if (!decoded.email_verified) return { ok: false, error: "email not verified" };
    if (!OWNER_EMAILS.includes(email)) return { ok: false, error: "not an owner account" };
    return { ok: true, email };
  } catch (e) {
    return { ok: false, error: "invalid or expired sign-in" };
  }
}

// ── Owner-facing registry operations ──────────────────────────────────────────
async function listDevices() {
  const snap = await devicesCol().get();
  return snap.docs.map((doc) => {
    const d = doc.data() || {};
    // secretHash is never returned — not even to the owner. Nothing needs it.
    return {
      deviceId: doc.id,
      label: d.label || "Unnamed host",
      platform: d.platform || "unknown",
      status: d.status || "pending",
      createdAt: d.createdAt || null,
      approvedAt: d.approvedAt || null,
      lastSeenAt: d.lastSeenAt || null,
    };
  }).sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
}

async function setDeviceStatus(deviceId, status) {
  if (!DEVICE_ID_RE.test(String(deviceId || ""))) return { ok: false, code: 400, error: "invalid deviceId" };
  if (!["approved", "revoked", "pending"].includes(status)) {
    return { ok: false, code: 400, error: "invalid status" };
  }
  const ref = devicesCol().doc(String(deviceId));
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, code: 404, error: "no such device" };
  const patch = { status };
  if (status === "approved") patch.approvedAt = Date.now();
  await ref.set(patch, { merge: true });
  return { ok: true, deviceId: String(deviceId), status };
}

// Deleting a device is how you retire a PC for good. The host can re-enroll
// (landing as pending again), which is the correct behaviour — approval is the
// gate, not obscurity.
async function deleteDevice(deviceId) {
  if (!DEVICE_ID_RE.test(String(deviceId || ""))) return { ok: false, code: 400, error: "invalid deviceId" };
  await devicesCol().doc(String(deviceId)).delete();
  return { ok: true, deviceId: String(deviceId) };
}

module.exports = {
  COLLECTION,
  OWNER_EMAILS,
  sha256Hex,
  safeEqualHex,
  enrollDevice,
  verifyHost,
  explainDenial,
  verifyOwner,
  listDevices,
  setDeviceStatus,
  deleteDevice,
};
