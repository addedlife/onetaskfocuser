// Google Fit REST API — OAuth flow + daily sync
// Docs: https://developers.google.com/fit/rest/v1/reference
//
// Google Cloud Console setup (one-time):
//   1. console.cloud.google.com → APIs & Services → Library
//   2. Search "Fitness API" and Enable it
//   3. APIs & Services → Credentials → Create OAuth 2.0 Client ID (Web application)
//   4. Authorized redirect URIs: https://onetaskfocuser.netlify.app/health-callback
//   5. Set in Netlify env vars: GOOGLE_HEALTH_CLIENT_ID, GOOGLE_HEALTH_CLIENT_SECRET
//
// Shares Firebase Admin credentials with google-workspace.js.

const TOKEN_URL   = "https://oauth2.googleapis.com/token";
const FITNESS_API = "https://www.googleapis.com/fitness/v1/users/me";
const REDIRECT    = "https://onetaskfocuser.netlify.app/health-callback";

const SCOPES = [
  "https://www.googleapis.com/auth/fitness.activity.read",
  "https://www.googleapis.com/auth/fitness.heart_rate.read",
  "https://www.googleapis.com/auth/fitness.sleep.read",
  "https://www.googleapis.com/auth/fitness.body.read",
].join(" ");

// Google Fit data type names
const DT_STEPS  = "com.google.step_count.delta";
const DT_HR     = "com.google.heart_rate.bpm";
const DT_SLEEP  = "com.google.sleep.segment";
const DT_WEIGHT = "com.google.weight";

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
  if (!cfg.googleRefreshToken) throw new Error("User has no Google Fit token — needs to connect first");

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

// ── Aggregate fitness data from Google Fit ────────────────────────────────────
// bucketMs = how long each bucket is (86400000 = one day per bucket)
async function fetchAggregate(accessToken, startMs, endMs, bucketMs) {
  const body = {
    aggregateBy: [
      { dataTypeName: DT_STEPS  },
      { dataTypeName: DT_HR     },
      { dataTypeName: DT_SLEEP  },
      { dataTypeName: DT_WEIGHT },
    ],
    bucketByTime:    { durationMillis: String(bucketMs) },
    startTimeMillis: String(startMs),
    endTimeMillis:   String(endMs),
  };

  const res = await fetch(`${FITNESS_API}/dataset:aggregate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Fitness aggregate (${res.status}): ${errText.slice(0, 400)}`);
  }
  return res.json();
}

// ── Parse one bucket into a health entry ─────────────────────────────────────
function parseBucket(bucket, dateStr) {
  let steps = 0, hrSum = 0, hrCount = 0, weightKg = null, sleepMs = 0;

  for (const ds of (bucket?.dataset || [])) {
    const dType = ds.dataTypeName || ds.dataSourceId || "";

    for (const pt of (ds.point || [])) {
      if (dType.includes("step_count")) {
        steps += pt.value?.[0]?.intVal || 0;

      } else if (dType.includes("heart_rate")) {
        const bpm = pt.value?.[0]?.fpVal;
        if (bpm) { hrSum += bpm; hrCount++; }

      } else if (dType.includes("sleep.segment")) {
        const stage = pt.value?.[0]?.intVal;
        // Stage 4 = Awake; 1=Light 2=Deep 3=REM — only count actual sleep
        if (stage !== 4) {
          const sNs = Number(pt.startTimeNanos || 0);
          const eNs = Number(pt.endTimeNanos   || 0);
          sleepMs += (eNs - sNs) / 1_000_000;
        }

      } else if (dType.includes(".weight")) {
        const kg = pt.value?.[0]?.fpVal;
        if (kg) weightKg = kg;
      }
    }
  }

  return {
    date:      dateStr,
    source:    "google",
    steps:     steps > 0  ? steps                              : null,
    heartRate: hrCount > 0 ? Math.round(hrSum / hrCount)       : null,
    weight:    weightKg != null ? +(weightKg * 2.20462).toFixed(1) : null,
    sleep:     sleepMs > 600_000 ? +(sleepMs / 3_600_000).toFixed(2) : null,
    syncedAt:  Date.now(),
  };
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

  // ── 1. Build the Google OAuth authorization URL ───────────────────────────
  if (action === "authorize-url") {
    if (!clientId) return json(503, {
      error: "GOOGLE_HEALTH_CLIENT_ID not set in Netlify env vars — see setup guide in Health → Setup Guide",
    }, origin);

    const userId = q.user_id || "";
    const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  REDIRECT,
      response_type: "code",
      scope:         SCOPES,
      access_type:   "offline",
      prompt:        "select_account consent",
      state:         userId,
    });
    return json(200, { url }, origin);
  }

  // ── 2. Exchange authorization code for tokens ─────────────────────────────
  if (action === "exchange") {
    const code   = q.code  || "";
    const userId = q.state || "";
    if (!code || !userId)           return json(400, { error: "Missing code or state" }, origin);
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
    if (!tokens.access_token) {
      return json(400, { error: tokens.error_description || tokens.error || "Token exchange failed" }, origin);
    }

    const db = getDb();
    await db.collection("healthConfig").doc(userId).set({
      oauthType:          "google",
      googleAccessToken:  tokens.access_token,
      googleRefreshToken: tokens.refresh_token || null,
      googleTokenExpiry:  Date.now() + ((tokens.expires_in || 3600) - 60) * 1000,
      fitbitToken:        null,
      userId,
      updatedAt:          Date.now(),
    }, { merge: true });

    return json(200, { success: true, userId }, origin);
  }

  // ── 3. Sync today + last 30 days from Google Fit ──────────────────────────
  if (action === "sync") {
    const userId = q.user_id || "";
    if (!userId) return json(400, { error: "Missing user_id" }, origin);

    const db          = getDb();
    const accessToken = await ensureFreshToken(db, userId);

    const now      = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    // Start of today (UTC), end = start of tomorrow − 1 ms
    const todayMs  = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const endMs    = todayMs + 86_400_000 - 1;
    const startMs  = todayMs - 29 * 86_400_000; // 30 days including today

    const aggData = await fetchAggregate(accessToken, startMs, endMs, 86_400_000);

    const batch = db.batch();
    let   todayEntry = null;

    for (const bucket of (aggData?.bucket || [])) {
      const bucketMs = Number(bucket.startTimeMillis || 0);
      const dateStr  = new Date(bucketMs).toISOString().slice(0, 10);
      const entry    = parseBucket(bucket, dateStr);

      const ref = db.collection("healthData").doc(userId).collection("log").doc(dateStr);
      batch.set(ref, entry, { merge: true });

      if (dateStr === todayStr) todayEntry = entry;
    }

    await batch.commit();

    return json(200, todayEntry || { date: todayStr, source: "google", steps: null, heartRate: null, sleep: null, weight: null, syncedAt: Date.now() }, origin);
  }

  // ── 4. Disconnect / revoke ────────────────────────────────────────────────
  if (action === "disconnect") {
    const userId = q.user_id || "";
    if (!userId) return json(400, { error: "Missing user_id" }, origin);
    const db = getDb();
    try {
      const snap  = await db.collection("healthConfig").doc(userId).get();
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
