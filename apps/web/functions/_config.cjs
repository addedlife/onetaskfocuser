// Single credential gateway for all Cloud Functions.
// Every function that needs Firebase Admin, Google OAuth credentials, or
// project constants imports from here instead of defining its own copy.

const FIREBASE_PROJECT_ID = "onetaskonly-app";
const FIREBASE_WEB_API_KEY = "AIzaSyB5UiDE9s0xjWeYa4OQ1LLJ63EwPVoSLrA";

// ── Service account ────────────────────────────────────────────────────────────
// Reads ADMIN_SA_JSON (full JSON blob) first, then falls back to three split
// env vars (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY).
function firebaseServiceAccount() {
  const raw = process.env.ADMIN_SA_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) return JSON.parse(raw);
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

// ── Firebase Admin singleton ──────────────────────────────────────────────────
// One app, db, and auth handle per process. All functions share these instead
// of each initializing a duplicate copy.
let _app = null;
let _db = null;
let _auth = null;

function getAdminApp() {
  if (_app) return _app;
  const sa = firebaseServiceAccount();
  if (!sa) {
    const e = new Error("Firebase service-account env vars are not configured.");
    e.statusCode = 503;
    throw e;
  }
  const { cert, getApps, initializeApp } = require("firebase-admin/app");
  _app = getApps()[0] || initializeApp({
    credential: cert(sa),
    projectId: sa.projectId || sa.project_id,
  });
  return _app;
}

function getAdminDb() {
  if (_db) return _db;
  getAdminApp();
  const { getFirestore } = require("firebase-admin/firestore");
  _db = getFirestore();
  return _db;
}

function getAdminAuth() {
  if (_auth) return _auth;
  getAdminApp();
  const { getAuth } = require("firebase-admin/auth");
  _auth = getAuth();
  return _auth;
}

// ── Realtime Database (Admin) ─────────────────────────────────────────────────
// Admin SDK access bypasses database.rules.json (service-account credentials),
// which is what server-side Cloud Functions code should use — the RTDB REST
// endpoint enforces those rules against real Firebase auth tokens, and Cloud
// Functions has no such token to present. Callers here are already gated by
// phone-relay.js's own auth checks (Firebase ID token or X-Relay-Secret).
let _rtdb = null;

function getAdminDatabase() {
  if (_rtdb) return _rtdb;
  const app = getAdminApp();
  // getDatabase(app, url) silently ignores the url argument — only
  // getDatabaseWithUrl(url, app) actually honors an explicit database URL.
  const { getDatabaseWithUrl } = require("firebase-admin/database");
  _rtdb = getDatabaseWithUrl(`https://${FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`, app);
  return _rtdb;
}

// ── RabbiMetrics token verification ───────────────────────────────────────────
// The rabbimetrics.web.app client (Firebase project rabbi-s-metrics) reuses the
// ai-proxy gateway. Its ID tokens carry a different audience, so they need an
// Admin app scoped to that project. verifyIdToken only checks the token
// signature against Google's public certs plus audience/issuer — it makes no
// authenticated API calls — so a projectId-only app (no service account for
// that project) is sufficient.
const RABBI_PROJECT_ID = "rabbi-s-metrics";
let _rabbiAuth = null;

function getRabbiAuth() {
  if (_rabbiAuth) return _rabbiAuth;
  const { getApps, initializeApp } = require("firebase-admin/app");
  const { getAuth } = require("firebase-admin/auth");
  const existing = getApps().find((a) => a.name === "rabbimetrics");
  const app = existing || initializeApp({ projectId: RABBI_PROJECT_ID }, "rabbimetrics");
  _rabbiAuth = getAuth(app);
  return _rabbiAuth;
}

// ── Google Workspace OAuth ────────────────────────────────────────────────────
function googleWorkspaceClientId() {
  return String(
    process.env.GOOGLE_CLIENT_ID ||
    process.env.GOOGLE_OAUTH_CLIENT_ID ||
    process.env.VITE_GOOGLE_CLIENT_ID ||
    ""
  ).trim();
}
function googleWorkspaceClientSecret() {
  return String(
    process.env.GOOGLE_CLIENT_SECRET ||
    process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
    ""
  ).trim();
}

// ── Google Health OAuth ───────────────────────────────────────────────────────
function googleHealthClientId() {
  return String(process.env.GOOGLE_HEALTH_CLIENT_ID || "").trim();
}
function googleHealthClientSecret() {
  return String(process.env.GOOGLE_HEALTH_CLIENT_SECRET || "").trim();
}

module.exports = {
  FIREBASE_PROJECT_ID,
  FIREBASE_WEB_API_KEY,
  firebaseServiceAccount,
  getAdminApp,
  getAdminDb,
  getAdminAuth,
  getAdminDatabase,
  RABBI_PROJECT_ID,
  getRabbiAuth,
  googleWorkspaceClientId,
  googleWorkspaceClientSecret,
  googleHealthClientId,
  googleHealthClientSecret,
};
