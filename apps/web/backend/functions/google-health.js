// Google Health API — OAuth flow + daily sync
// API: https://developers.google.com/health
//
// Required Netlify env vars (Netlify dashboard → Site config → Environment variables):
//   GOOGLE_HEALTH_CLIENT_ID      — from console.cloud.google.com
//   GOOGLE_HEALTH_CLIENT_SECRET  — from console.cloud.google.com
//
// Shares Firebase Admin credentials with google-workspace.js:
//   FIREBASE_SERVICE_ACCOUNT_JSON  (or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY)

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const HEALTH_V4 = "https://health.googleapis.com/v4";
const REDIRECT  = "https://onetaskfocuser.netlify.app/health-callback";

// NOTE: All Google Health API scopes require the explicit .readonly suffix —
// the suffix-less variants are accepted at OAuth time but grant no data access
// (API calls return 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT).
// Heart rate + weight live under health_metrics_and_measurements; sleep is its
// own scope; steps live under activity_and_fitness.
const SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
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

// Fire-and-forget log into Firestore "debugLogs" collection (read via debug-log fn).
async function dlog(source, msg, data) {
  try {
    const db = getDb();
    await db.collection("debugLogs").add({
      ts:     Date.now(),
      source: `gh:${source}`,
      level:  "info",
      msg:    String(msg).slice(0, 2000),
      data:   data != null ? JSON.stringify(data).slice(0, 5000) : null,
    });
  } catch {}
}

// ── Token refresh ─────────────────────────────────────────────────────────────
async function ensureFreshToken(db, userId) {
  const snap = await db.collection("healthConfig").doc(userId).get();
  if (!snap.exists) throw new Error("No health config for user");
  const cfg = snap.data();
  if (!cfg.googleRefreshToken) throw new Error("User has no Google Health token — needs to connect first");

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
  const body = await res.text();
  let parsed = null; try { parsed = JSON.parse(body); } catch {}
  await dlog(`rollup:${dataType}`, `status ${res.status}`, { status: res.status, body: body.slice(0, 800) });
  if (!res.ok) return null;
  return parsed?.rollupDataPoints?.[0] || null;
}

// ── Sleep duration via dailyRollUp (same shape as steps/HR/weight) ───────────
async function fetchSleepRollup(accessToken, range) {
  const res = await fetch(`${HEALTH_V4}/users/me/dataTypes/sleep/dataPoints:dailyRollUp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ range, windowSizeDays: 1 }),
  });
  const body = await res.text();
  let parsed = null; try { parsed = JSON.parse(body); } catch {}
  await dlog("rollup:sleep", `status ${res.status}`, { status: res.status, body: body.slice(0, 800) });
  if (!res.ok) return null;
  return parsed?.rollupDataPoints?.[0] || null;
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
    await dlog("authorize-url", "start", { clientIdSet: !!clientId, clientIdPrefix: clientId.slice(0, 16), origin });
    if (!clientId) {
      await dlog("authorize-url", "MISSING GOOGLE_HEALTH_CLIENT_ID");
      return json(503, { error: "GOOGLE_HEALTH_CLIENT_ID not set in Netlify env vars", setup: true }, origin);
    }
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
    await dlog("authorize-url", "built URL", { userId, redirect: REDIRECT, scopes: SCOPES, urlLen: url.length });
    return json(200, { url }, origin);
  }

  // ── 2. Exchange authorization code for tokens ─────────────────────────────
  if (action === "exchange") {
    const code   = q.code  || "";
    const userId = q.state || "";
    await dlog("exchange", "start", { codeLen: code.length, userId, hasClientId: !!clientId, hasSecret: !!clientSecret });
    if (!code || !userId)           { await dlog("exchange", "missing code or state"); return json(400, { error: "Missing code or state" }, origin); }
    if (!clientId || !clientSecret) { await dlog("exchange", "missing client creds"); return json(503, { error: "Client credentials not configured", setup: true }, origin); }

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
    await dlog("exchange", `token endpoint status ${res.status}`, {
      status: res.status,
      hasAccess: !!tokens.access_token,
      hasRefresh: !!tokens.refresh_token,
      scope: tokens.scope,
      error: tokens.error,
      errorDesc: tokens.error_description,
    });
    if (!tokens.access_token) return json(400, { error: tokens.error_description || tokens.error || "Token exchange failed" }, origin);

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

    await dlog("exchange", "saved healthConfig — success", { userId });
    return json(200, { success: true, userId }, origin);
  }

  // ── 3. Sync today's health data ───────────────────────────────────────────
  if (action === "sync") {
    const userId = q.user_id || "";
    await dlog("sync", "start", { userId });
    if (!userId) return json(400, { error: "Missing user_id" }, origin);

    const db          = getDb();
    let accessToken;
    try {
      accessToken = await ensureFreshToken(db, userId);
      await dlog("sync", "got fresh token");
    } catch (err) {
      await dlog("sync", "ensureFreshToken threw", { err: String(err.message || err) });
      return json(500, { error: String(err.message || err) }, origin);
    }

    const today = new Date().toISOString().slice(0, 10);
    const [yr, mo, dy] = today.split("-").map(Number);
    // range.end is EXCLUSIVE and must be > start. For "today", pass [today, tomorrow).
    // range.start/end are CivilDateTime → wrap year/month/day in a `date` object.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10).split("-").map(Number);
    const range = {
      start: { date: { year: yr,          month: mo,          day: dy          } },
      end:   { date: { year: tomorrow[0], month: tomorrow[1], day: tomorrow[2] } },
    };

    const [stepsRp, hrRp, weightRp, sleepRp] = await Promise.all([
      rollup(accessToken, "steps",      range),
      rollup(accessToken, "heart-rate", range),
      rollup(accessToken, "weight",     range),
      fetchSleepRollup(accessToken, range),
    ]);

    await dlog("sync", "parsed rollups", { stepsRp, hrRp, weightRp, sleepRp });

    // Field-name notes (from observed API responses):
    //   steps.countSum            string of integer
    //   heartRate.beatsPerMinuteAvg / .restingHeartRate
    //   weight.weightAvg / .weight (likely kg, may be empty {} if no data today)
    //   sleep — field shape TBD, just log for now
    const stepsRaw  = stepsRp?.steps?.countSum            ?? stepsRp?.steps?.count;
    const hrRaw     = hrRp?.heartRate?.restingHeartRate    ?? hrRp?.heartRate?.beatsPerMinuteAvg;
    const weightRaw = weightRp?.weight?.weightAvg          ?? weightRp?.weight?.weight;
    const sleepRaw  = sleepRp?.sleep?.durationSecondsSum
                   ?? sleepRp?.sleep?.totalDurationSecondsSum
                   ?? sleepRp?.sleep?.durationSeconds;

    const entry = {
      date:      today,
      source:    "google",
      steps:     stepsRaw  != null ? Number(stepsRaw)                : null,
      heartRate: hrRaw     != null ? Math.round(Number(hrRaw))       : null,
      sleep:     sleepRaw  != null ? +(Number(sleepRaw) / 3600).toFixed(2) : null,
      weight:    weightRaw != null ? +(Number(weightRaw) * 2.20462).toFixed(1) : null, // kg → lb
      syncedAt:  Date.now(),
    };

    await dlog("sync", "built entry", entry);

    await db.collection("healthData").doc(userId).collection("log").doc(today).set(entry, { merge: true });

    // Backfill last 30 days of step history
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
      const histStart     = thirtyDaysAgo.toISOString().slice(0, 10).split("-").map(Number);
      // end is exclusive — use tomorrow so today is included in the history
      const histRange     = {
        start: { date: { year: histStart[0], month: histStart[1], day: histStart[2] } },
        end:   { date: { year: tomorrow[0],  month: tomorrow[1],  day: tomorrow[2]  } },
      };
      const histRes  = await fetch(`${HEALTH_V4}/users/me/dataTypes/steps/dataPoints:dailyRollUp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ range: histRange, windowSizeDays: 1 }),
      });
      const histData = await histRes.json();
      const batch    = db.batch();
      (histData?.rollupDataPoints || []).forEach(pt => {
        const { year, month, day } = pt.civilStartTime?.date || pt.civilStartTime || {};
        if (!year) return;
        const dateKey = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
        const ref = db.collection("healthData").doc(userId).collection("log").doc(dateKey);
        batch.set(ref, { date: dateKey, steps: pt.steps?.count ?? null, source: "google" }, { merge: true });
      });
      await batch.commit();
    } catch {}

    return json(200, entry, origin);
  }

  // ── 3b. Load config + history for the browser (bypasses Firestore rules) ─
  if (action === "load") {
    const userId = q.user_id || "";
    if (!userId) return json(400, { error: "Missing user_id" }, origin);
    const db = getDb();

    try {
      const configDoc = await db.collection("healthConfig").doc(userId).get();
      // Strip tokens — browser never needs them
      const cfg = configDoc.exists ? configDoc.data() : null;
      const config = cfg ? {
        oauthType:      cfg.oauthType      || null,
        fitbitLinked:   !!cfg.fitbitLinked,
        googleFitLinked:!!cfg.googleFitLinked,
        goals:          cfg.goals          || {},
        updatedAt:      cfg.updatedAt      || null,
      } : null;

      const today    = new Date().toISOString().slice(0, 10);
      const todayDoc = await db.collection("healthData").doc(userId).collection("log").doc(today).get();
      const todayEntry = todayDoc.exists ? { ...todayDoc.data(), date: today } : null;

      const histSnap = await db.collection("healthData").doc(userId).collection("log")
        .orderBy("date", "desc").limit(90).get();
      const history = histSnap.docs.map(d => ({ date: d.id, ...d.data() })).reverse();

      await dlog("load", "ok", { hasConfig: !!config, oauthType: config?.oauthType, hasToday: !!todayEntry, historyDays: history.length });
      return json(200, { config, today: todayEntry, history }, origin);
    } catch (err) {
      await dlog("load", "ERROR", { err: String(err.message || err) });
      return json(500, { error: String(err.message || err) }, origin);
    }
  }

  // ── 3c. Save a manual entry (browser can't write to Firestore directly) ──
  if (action === "save-entry") {
    if (event.httpMethod !== "POST") return json(405, { error: "Use POST" }, origin);
    const userId = q.user_id || "";
    if (!userId) return json(400, { error: "Missing user_id" }, origin);

    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch { return json(400, { error: "Invalid JSON body" }, origin); }
    if (!body.date) return json(400, { error: "Missing date" }, origin);

    const db = getDb();
    const { date, ...rest } = body;
    try {
      await db.collection("healthData").doc(userId).collection("log").doc(date)
        .set({ ...rest, date, source: rest.source || "manual" }, { merge: true });
      return json(200, { ok: true, date }, origin);
    } catch (err) {
      return json(500, { error: String(err.message || err) }, origin);
    }
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
