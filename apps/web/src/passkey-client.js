// ── Biometric unlock, browser side (passkeys / WebAuthn) ────────────────────
// Owner ask: "make a biometric login option for all auth gates."
//
// Face ID, Touch ID, Windows Hello and Android's fingerprint sensor all speak
// one browser API. The important part is what it does NOT do: the fingerprint or
// face never leaves the device, and this app never receives it. The device holds
// a private key that its sensor unlocks; the server holds only the matching
// public key, hands out a one-time random challenge, and checks the signature.
// There is no shared secret to steal and nothing worth replaying.
//
// A passkey is a SECOND door onto an account that already signed in with Google
// once — never a way to create one — so it can't hand out access Google didn't
// already grant.
//
// This lives in its own module rather than in 00-auth.jsx because the settings
// screen needs it too, and settings is reached FROM the app that 00-auth renders.
// Importing it back the other way would be a cycle.
import firebase from 'firebase/compat/app';

const PASSKEY_LOCAL_KEY = "ot_passkey_ready";

export function passkeyRegisteredHere() {
  try { return localStorage.getItem(PASSKEY_LOCAL_KEY) === "1"; } catch (_) { return false; }
}

export function rememberPasskeyRegistered(on) {
  try {
    if (on) localStorage.setItem(PASSKEY_LOCAL_KEY, "1");
    else localStorage.removeItem(PASSKEY_LOCAL_KEY);
  } catch (_) {}
}

export function passkeysSupported() {
  return typeof window !== "undefined" &&
    !!window.PublicKeyCredential &&
    typeof navigator !== "undefined" &&
    !!navigator.credentials;
}

// True only where the sensor itself is available — a desktop with no Hello and
// no phone paired can support the API and still have nothing to offer.
export async function biometricAvailable() {
  if (!passkeysSupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch (_) {
    return false;
  }
}

export async function callPasskeys(action, payload = {}, idToken = "") {
  const r = await fetch("/api/passkeys", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || `Passkey request failed (${r.status})`);
  return d;
}

// Register this device's biometric as a passkey for the signed-in account.
export async function registerPasskeyForCurrentUser(label = "") {
  if (!passkeysSupported()) throw new Error("This device or browser doesn't support biometric sign-in.");
  const { startRegistration } = await import("@simplewebauthn/browser");
  const user = firebase.auth().currentUser;
  if (!user) throw new Error("Sign in first, then add biometric unlock.");
  const idToken = await user.getIdToken();
  const { handle, options } = await callPasskeys("registerOptions", {}, idToken);
  const response = await startRegistration({ optionsJSON: options });
  await callPasskeys("registerVerify", { handle, response, label }, idToken);
  rememberPasskeyRegistered(true);
  return true;
}

export async function listPasskeys() {
  const user = firebase.auth().currentUser;
  if (!user) return { passkeys: [] };
  return await callPasskeys("list", {}, await user.getIdToken());
}

export async function removePasskey(credentialId) {
  const user = firebase.auth().currentUser;
  if (!user) throw new Error("Sign in first.");
  const out = await callPasskeys("remove", { credentialId }, await user.getIdToken());
  if (!out.passkeys?.length) rememberPasskeyRegistered(false);
  return out;
}

// Returns the credential assertion result, or null if the person dismissed the
// prompt — a dismissal is a decision, not a failure, and must not be shown as an
// error or fall through to another sign-in popup.
export async function assertPasskey() {
  if (!passkeysSupported()) throw new Error("This device or browser doesn't support biometric sign-in.");
  const { startAuthentication } = await import("@simplewebauthn/browser");
  const { handle, options } = await callPasskeys("authOptions");
  let response;
  try {
    response = await startAuthentication({ optionsJSON: options });
  } catch (e) {
    // NotAllowedError is what both "cancelled" and "timed out" look like.
    if (e?.name === "NotAllowedError" || e?.name === "AbortError") return null;
    throw e;
  }
  return await callPasskeys("authVerify", { handle, response });
}
