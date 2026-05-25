// Google Health API — OAuth flow + daily sync
// Replaces the legacy Fitbit Web API (deprecated September 2026).
// New API: https://developers.google.com/health
//
// Required Netlify env vars (set in Netlify dashboard → Site config → Env vars):
//   GOOGLE_HEALTH_CLIENT_ID      — from console.cloud.google.com
//   GOOGLE_HEALTH_CLIENT_SECRET  — from console.cloud.google.com
//
// Shares Firebase Admin credentials with google-workspace.js:
//   FIREBASE_SERVICE_ACCOUNT_JSON  (or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY)

const TOKEN_URL  = "https://oauth2.googleapis.com/token";
const HEALTH_V4  = "https://health.googleapis.com/v4";
const REDIRECT   = "https://onetaskfocuser.netlify.app/health-callback";

const SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements",
  "https://www.googleapis.com/auth/googlehealth.sleep",
].join(" ");

// ── Firebase Admin (same pattern as google-workspace.js) ─────────────────────
let adminDb = null;
function firebaseServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) return JSON.parse(raw);
  const p = process.env.FIREBASE_PROJECT_ID;
  const e = process.env.FIREBASE_CLIENT_EMAIL;
  const k = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!p || !e || !k) return null;
  return { projectId: p, clientEmail: e, privateKey: k };
}
function getDb() {
  if (adminDb) return adminDb;
  const sa = firebaseServiceAccount();
  if (!sa) throw new Error("Missing Firebase service account env vars");
  const { cert, getApps, initializeApp } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  const app = getApps()[0] || initializeApp({ credential: cert(sa), projectId: sa.projectId || sa.project_id });
  adminDb = getFirestore(app);
  return adminDb;
}

// ── CORS helper ───────────────────────────────────────────────────────────────
function corsHeaders(origin = "") {
  const allowed = /^https:\/\/([a-z0-9-]+\.)?netlify\.app$/i.test(origin) ||
                  origin === "https://onetaskfocuser.netlify.app" ||
                  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
    ? origin : "https://onetaskfocuser.netlify.app";
  return {
    "Access-Control-Allow-Origin":  allowed,
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
  };
}

function json(statusCode, body, origin) {
  return { statusCode, headers: { ...corsHeaders(origin), "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

// ── Token refresh ─────────────────────────────────────────────────────────────
async function ensureFreshToken(db, userId) {
  const snap = await db.collection("healthConfig").doc(userId).get();
  if (!snap.exists) throw new Error("No health config for user");
  const cfg = snap.data();
  if (!cfg.googleRefreshToken) throw new Error("User has no Google Health token — needs to connect first");

  // Use cached token if still valid (leave 90 s buffer)
  if (cfg.googleAccessToken && Date.now() < (cfg.googleTokenExpiry || 0) - 90_000) {
    return cfg.googleAccessToken;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      refresh_token: cfg.googleRefreshToken,
      client_id:     process.env.GOOGLE_HEALTH_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_HEALTH_CLIENT_SECRET || "",
    }),
  });
  const t = await res.json();
  if (!t.access_token) throw new Error(`Token refresh failed: ${t.error || "unknown"}`);

  await db.collection("healthConfig").doc(userId).update({
    googleAccessToken: t.access_token,
    googleTokenExpiry: Date.now() + ((t.expires_in || 3600) - 60) * 1000,
  });
  return t.access_token;
}

// ── dailyRollUp helper ────────────────────────────────────────────────────────
async function rollup(accessToken, dataType, range) {
  const res = await fetch(`${HEALTH_V4}/users/me/dataTypes/${dataType}/dataPoints:dailyRollUp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ range, windowSizeDays: 1 }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.rollupDataPoints?.[0] || null;
}

// ── Sleep duration parser ─────────────────────────────────────────────────────
// Google Health returns sleep as session data; extract total duration in hours.
async function fetchSleepHours(accessToken, dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  // Use list endpoint for sleep with a date filter (sleep sessions cross midnight)
  const filter = `sleep.interval.civil_start_time >= "${dateStr}T00:00:00" AND sleep.interval.civil_start_time < "${dateStr}T23:59:59"`;
  const res = await fetch(
    `${HEALTH_V4}/users/me/dataTypes/sleep/dataPoints?filter=${encodeURIComponent(filter)}&pageSize=10`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  // Sum all sleep session durations (in ms), convert to hours
  const totalMs = (data?.dataPoints || []).reduce((sum, pt) => {
    const startMs = new Date(pt?.interval?.startTime || 0).getTime();
    const endMs   = new Date(pt?.interval?.endTime   || 0).getTime();
    return sum + Math.max(0, endMs - startMs);
  }, 0);
  return totalMs > 0 ? +(totalMs / 3_600_000).toFixed(2) : null;
}

// ── Main handler ──────────────────────────────────────────────────────────────
export const handler = async (event) => {
  const origin = event.headers?.origin || "";
  const q      = event.queryStringParameters || {};

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(origin), body: "" };
  }

  const clientId     = process.env.GOOGLE_HEALTH_CLIENT_ID     || "";
  const clientSecret = process.env.GOOGLE_HEALTH_CLIENT_SECRET || "";
  const action       = q.action;

  // ── 1. Return the Google OAuth authorization URL ──────────────────────────
  if (action === "authorize-url") {
    if (!clientId) return json(503, { error: "GOOGLE_HEALTH_CLIENT_ID not configured" }, origin);
    const userId = q.user_id || "";
    const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  REDIRECT,
      response_type: "code",
      scope:         SCOPES,
      access_type:   "offline",
      prompt:        "consent",
      state:         userId,
    });
    return json(200, { url }, origin);
  }

  // ── 2. Exchange authorization code for tokens ─────────────────────────────
  if (action === "exchange") {
    const code   = q.code  || "";
    const userId = q.state || "";
    if (!code || !userId)   return json(400, { error: "Missing code or state" }, origin);
    if (!clientId || !clientSecret) return json(503, { error: "Client credentials not configured" }, origin);

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "authorization_code",
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  REDIRECT,
      }),
    });
    const tokens = await res.json();
    if (!tokens.access_token) return json(400, { error: tokens.error || "Token exchange failed" }, origin);

    const db = getDb();

    // Fetch the user's Google Health identity to confirm the link
    let googleUserId = null;
    try {
      const idRes = await fetch(`${HEALTH_V4}/users/me/identity`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const idData = await idRes.json();
      googleUserId = idData?.name || null;
    } catch {}

    await db.collection("healthConfig").doc(userId).set({
      oauthType:          "google",
      googleAccessToken:  tokens.access_token,
      googleRefreshToken: tokens.refresh_token || null,
      googleTokenExpiry:  Date.now() + ((tokens.expires_in || 3600) - 60) * 1000,
      googleUserId,
      fitbitToken:        null,
      userId,
      updatedAt:          Date.now(),
    }, { merge: true });

    return json(200, { success: true, userId }, origin);
  }

  // ── 3. Sync today's health data from Google Health API ───────────────────
  if (action === "sync") {
    const userId = q.user_id || "";
    if (!userId) return json(400, { error: "Missing user_id" }, origin);

    const db = getDb();
    const accessToken = await ensureFreshToken(db, userId);

    const today = new Date().toISOString().slice(0, 10);
    const [yr, mo, dy] = today.split("-").map(Number);
    const range = { start: { year: yr, month: mo, day: dy }, end: { year: yr, month: mo, day: dy } };

    const [stepsRp, hrRp, weightRp, sleepHours] = await Promise.all([
      rollup(accessToken, "steps",      range),
      rollup(accessToken, "heart-rate", range),
      rollup(accessToken, "weight",     range),
      fetchSleepHours(accessToken, today),
    ]);

    const entry = {
      date:      today,
      source:    "google",
      steps:     stepsRp?.steps?.count                           ?? null,
      heartRate: hrRp?.heartRate?.restingHeartRate               ?? null,
      sleep:     sleepHours,
      weight:    weightRp?.weight?.weight                        ?? null,
      syncedAt:  Date.now(),
    };

    await db.collection("healthData").doc(userId).collection("log").doc(today).set(entry, { merge: true });

    // Also fetch last 30 days for history (lightweight — rollup only)
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
      const histStart = thirtyDaysAgo.toISOString().slice(0, 10).split("-").map(Number);
      const histRange = {
        start: { year: histStart[0], month: histStart[1], day: histStart[2] },
        end:   { year: yr, month: mo, day: dy },
      };
      const histRes = await fetch(`${HEALTH_V4}/users/me/dataTypes/steps/dataPoints:dailyRollUp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ range: histRange, windowSizeDays: 1 }),
      });
      const histData = await histRes.json();
      const batch = db.batch();
      (histData?.rollupDataPoints || []).forEach(pt => {
        const { year, month, day } = pt.civilStartTime || {};
        if (!year) return;
        const dateKey = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
        const ref = db.collection("healthData").doc(userId).collection("log").doc(dateKey);
        batch.set(ref, { date: dateKey, steps: pt.steps?.count ?? null, source: "google" }, { merge: true });
      });
      await batch.commit();
    } catch {}

    return json(200, entry, origin);
  }

  // ── 4. Disconnect / revoke ─────────────────────────────────────────────────
  if (action === "disconnect") {
    const userId = q.user_id || "";
    if (!userId) return json(400, { error: "Missing user_id" }, origin);
    const db = getDb();
    try {
      const snap = await db.collection("healthConfig").doc(userId).get();
      const token = snap.data()?.googleAccessToken;
      if (token) await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: "POST" });
    } catch {}
    await db.collection("healthConfig").doc(userId).update({
      oauthType: null, googleAccessToken: null, googleRefreshToken: null, googleTokenExpiry: null,
    });
    return json(200, { success: true }, origin);
  }

  return json(400, { error: `Unknown action: ${action || "(none)"}` }, origin);
};
