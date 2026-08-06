// ── Passkeys: biometric sign-in and re-unlock ────────────────────────────────
// Owner ask: "make a biometric login option for all auth gates".
//
// The standard for this on the web is WebAuthn — the same thing a bank app means
// by "Face ID login". The important part is what it is NOT: the fingerprint or
// face never leaves the device and this server never sees it. The device holds a
// private key that only unlocks when the sensor is satisfied; this server holds
// only the matching PUBLIC key, hands out a random challenge, and checks that
// the signature over that challenge verifies. That is why it is stronger than a
// password rather than merely more convenient — there is no shared secret to
// steal, and a phished signature is useless because the challenge is one-shot
// and bound to this site's origin.
//
// Sign-in here means: verify the assertion, then mint a Firebase custom token for
// the uid the credential belongs to. The resulting session is an ordinary
// Firebase session, indistinguishable downstream from one created by Google
// sign-in — so every gate that already trusts a Firebase session gets biometrics
// for free.
//
// The Google grant is deliberately untouched by this: mail and calendar access
// lives in a server-held refresh token from the unified sign-in, so unlocking
// with a fingerprint restores the app session without asking Google anything.
// A passkey is therefore only ever a SECOND door onto an account that already
// signed in with Google once — never a way to create one.
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const { corsHeaders, allowedOrigin } = require("./cors-helper");
const { getAdminDb, getAdminAuth } = require("./_config.cjs");

const RP_NAME = "Shamash Pro 4";
// A challenge is single-use and short-lived by design: it is what stops a
// captured signature from being replayed later.
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function canonicalUid(decoded) {
  const prefix = String(decoded.email || "").split("@")[0].toLowerCase().trim();
  return prefix || decoded.uid;
}

async function authedUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw httpError(401, "Missing app sign-in token.");
  const decoded = await getAdminAuth().verifyIdToken(token);
  return { uid: canonicalUid(decoded), firebaseUid: decoded.uid, email: decoded.email || "" };
}

// WebAuthn binds a credential to a Relying Party ID — the site's domain. It must
// be derived from the request origin rather than hardcoded, or a credential
// created on one of this app's hosts silently fails to verify on another.
function rpFromRequest(req) {
  const origin = allowedOrigin(req.headers.origin || "");
  if (!origin) throw httpError(400, "Passkeys require a known site origin.");
  let rpID;
  try { rpID = new URL(origin).hostname; } catch { throw httpError(400, "Could not read this site's domain."); }
  return { origin, rpID };
}

function credsCol(db, firebaseUid) {
  return db.collection("serverOnlyPasskeys").doc(firebaseUid).collection("credentials");
}
// Challenges are keyed by a handle the client echoes back. Sign-in has no session
// yet, so it cannot be keyed by uid.
function challengeRef(db, handle) {
  return db.collection("serverOnlyPasskeyChallenges").doc(String(handle));
}
// The credential ID is globally unique and is what an assertion presents, so it
// is the index that turns "this signature verified" into "and it belongs to that
// account" without the browser ever having to claim an identity.
function credentialIndexRef(db, credentialId) {
  return db.collection("serverOnlyPasskeyIndex").doc(String(credentialId));
}

function randomHandle() {
  return `ch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

async function putChallenge(db, handle, data) {
  await challengeRef(db, handle).set({ ...data, createdAtMs: Date.now() });
}

async function takeChallenge(db, handle) {
  const ref = challengeRef(db, handle);
  const snap = await ref.get();
  if (!snap.exists) throw httpError(400, "This sign-in attempt expired. Try again.");
  const data = snap.data() || {};
  // Single use: delete before verifying, so a replay of the same handle finds
  // nothing even if verification is still in flight.
  await ref.delete().catch(() => {});
  if (Date.now() - Number(data.createdAtMs || 0) > CHALLENGE_TTL_MS) {
    throw httpError(400, "This sign-in attempt expired. Try again.");
  }
  return data;
}

async function registerOptions(req, user) {
  const db = getAdminDb();
  const { rpID } = rpFromRequest(req);
  const existing = await credsCol(db, user.firebaseUid).get();
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: user.email || user.uid,
    userDisplayName: user.email || user.uid,
    // Ask for a resident (discoverable) credential so sign-in can start with no
    // typed identity at all — you press the button, the device offers the
    // passkey, and the account comes back with it.
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
      authenticatorAttachment: "platform",
    },
    // Re-registering the same authenticator would create a confusing duplicate.
    excludeCredentials: existing.docs.map(d => ({ id: d.id })),
  });
  const handle = randomHandle();
  await putChallenge(db, handle, { kind: "register", challenge: options.challenge, firebaseUid: user.firebaseUid });
  return { handle, options };
}

async function registerVerify(req, user, body) {
  const db = getAdminDb();
  const { origin, rpID } = rpFromRequest(req);
  const stored = await takeChallenge(db, body.handle);
  if (stored.kind !== "register" || stored.firebaseUid !== user.firebaseUid) {
    throw httpError(400, "This passkey setup attempt does not match this sign-in.");
  }
  const verification = await verifyRegistrationResponse({
    response: body.response,
    expectedChallenge: stored.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw httpError(400, "That passkey could not be verified.");
  }
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const credentialId = credential.id;
  await credsCol(db, user.firebaseUid).doc(credentialId).set({
    publicKey: Buffer.from(credential.publicKey).toString("base64"),
    counter: Number(credential.counter || 0),
    transports: Array.isArray(credential.transports) ? credential.transports : [],
    deviceType: credentialDeviceType || "",
    backedUp: !!credentialBackedUp,
    label: String(body.label || "").slice(0, 60) || "This device",
    appUid: user.uid,
    email: user.email || "",
    createdAt: new Date().toISOString(),
  });
  await credentialIndexRef(db, credentialId).set({
    firebaseUid: user.firebaseUid,
    appUid: user.uid,
    createdAt: new Date().toISOString(),
  });
  return { registered: true, credentialId };
}

async function authOptions(req) {
  const db = getAdminDb();
  const { rpID } = rpFromRequest(req);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    // No allowCredentials: the device offers whichever passkey it holds for this
    // site. Naming credentials here would leak which accounts exist to anyone
    // who asks.
  });
  const handle = randomHandle();
  await putChallenge(db, handle, { kind: "auth", challenge: options.challenge });
  return { handle, options };
}

async function authVerify(req, body) {
  const db = getAdminDb();
  const { origin, rpID } = rpFromRequest(req);
  const stored = await takeChallenge(db, body.handle);
  if (stored.kind !== "auth") throw httpError(400, "This unlock attempt does not match.");

  const credentialId = String(body?.response?.id || "");
  if (!credentialId) throw httpError(400, "No passkey was presented.");
  const indexSnap = await credentialIndexRef(db, credentialId).get();
  if (!indexSnap.exists) throw httpError(404, "This passkey is not registered for this app.");
  const firebaseUid = String(indexSnap.data()?.firebaseUid || "");
  const credSnap = await credsCol(db, firebaseUid).doc(credentialId).get();
  if (!credSnap.exists) throw httpError(404, "This passkey is no longer registered.");
  const cred = credSnap.data() || {};

  const verification = await verifyAuthenticationResponse({
    response: body.response,
    expectedChallenge: stored.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: credentialId,
      publicKey: new Uint8Array(Buffer.from(String(cred.publicKey || ""), "base64")),
      counter: Number(cred.counter || 0),
      transports: Array.isArray(cred.transports) ? cred.transports : undefined,
    },
  });
  if (!verification.verified) throw httpError(401, "That passkey did not verify.");

  // The signature counter is the cloned-authenticator check: a real authenticator
  // only ever counts up. Platform passkeys synced across devices legitimately
  // report 0, so a zero counter is not treated as suspicious.
  const newCounter = Number(verification.authenticationInfo?.newCounter || 0);
  if (newCounter > 0 && newCounter <= Number(cred.counter || 0)) {
    throw httpError(401, "This passkey looks like a copy. Sign in with Google instead.");
  }
  await credSnap.ref.set({ counter: newCounter, lastUsedAt: new Date().toISOString() }, { merge: true });

  const customToken = await getAdminAuth().createCustomToken(firebaseUid);
  return { customToken, email: cred.email || "" };
}

async function listCredentials(user) {
  const db = getAdminDb();
  const snap = await credsCol(db, user.firebaseUid).get();
  return {
    passkeys: snap.docs.map(d => ({
      id: d.id,
      label: d.data()?.label || "This device",
      createdAt: d.data()?.createdAt || "",
      lastUsedAt: d.data()?.lastUsedAt || "",
    })),
  };
}

async function removeCredential(user, body) {
  const db = getAdminDb();
  const id = String(body.credentialId || "");
  if (!id) throw httpError(400, "Which passkey should be removed?");
  await credsCol(db, user.firebaseUid).doc(id).delete().catch(() => {});
  await credentialIndexRef(db, id).delete().catch(() => {});
  return await listCredentials(user);
}

const handler = async (req, res) => {
  const origin = req.headers.origin || "";
  const headers = corsHeaders(origin, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).set(headers).end();
  if (req.method !== "POST") return res.status(405).set(headers).json({ error: "Method not allowed" });

  try {
    const body = req.body || {};
    const action = String(body.action || "");
    // The two actions that must work with no session — they are what creates one.
    if (action === "authOptions") return res.status(200).set(headers).json(await authOptions(req));
    if (action === "authVerify")  return res.status(200).set(headers).json(await authVerify(req, body));

    const user = await authedUser(req);
    if (action === "registerOptions") return res.status(200).set(headers).json(await registerOptions(req, user));
    if (action === "registerVerify")  return res.status(200).set(headers).json(await registerVerify(req, user, body));
    if (action === "list")            return res.status(200).set(headers).json(await listCredentials(user));
    if (action === "remove")          return res.status(200).set(headers).json(await removeCredential(user, body));
    return res.status(400).set(headers).json({ error: "Unknown passkey action." });
  } catch (error) {
    return res.status(error.statusCode || 500).set(headers).json({ error: error.message || "Passkey request failed." });
  }
};

module.exports = handler;
