// Google Health API — OAuth flow + daily sync
// (Converted from google-health.js — Firebase Functions v2 Express signature)
//
// Env vars:
//   GOOGLE_HEALTH_CLIENT_ID, GOOGLE_HEALTH_CLIENT_SECRET
//   FIREBASE_SERVICE_ACCOUNT_JSON (or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY)

const { corsHeaders } = require("./cors-helper");
const { getAdminDb, getAdminAuth, googleHealthClientId, googleHealthClientSecret } = require("./_config.cjs");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const HEALTH_V4 = "https://health.googleapis.com/v4";
const REDIRECT  = "https://onetaskonly-app.web.app/health-callback";

const SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
].join(" ");


async function authedUid(req) {
  const header = req.headers.authorization || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) { const e = new Error("Sign in required"); e.statusCode = 401; throw e; }
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    return decoded.uid;
  } catch (_) {
    const e = new Error("Invalid or expired sign-in"); e.statusCode = 401; throw e;
  }
}

async function dlog(source, msg, data) {
  try {
    const db = getAdminDb();
    await db.collection("debugLogs").add({
      ts:     Date.now(),
      source: `gh:${source}`,
      level:  "info",
      msg:    String(msg).slice(0, 2000),
      data:   data != null ? JSON.stringify(data).slice(0, 5000) : null,
    });
  } catch {}
}

async function ensureFreshToken(db, userId) {
  const snap = await db.collection("healthConfig").doc(userId).get();
  if (!snap.exists) throw new Error("No health config for user");
  const cfg = snap.data();
  if (!cfg.googleRefreshToken) throw new Error("User has no Google Health token — needs to connect first");
  if (cfg.googleAccessToken && Date.now() < (cfg.googleTokenExpiry || 0) - 90_000) return cfg.googleAccessToken;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: cfg.googleRefreshToken,
      client_id: googleHealthClientId(),
      client_secret: googleHealthClientSecret(),
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

async function fetchSleepMinutes(accessToken, dayParts) {
  const ymd     = `${dayParts[0]}-${String(dayParts[1]).padStart(2,"0")}-${String(dayParts[2]).padStart(2,"0")}`;
  const next    = new Date(Date.UTC(dayParts[0], dayParts[1] - 1, dayParts[2] + 1));
  const ymdNext = next.toISOString().slice(0, 10);
  const filter  = `sleep.interval.civil_end_time >= "${ymd}" AND sleep.interval.civil_end_time < "${ymdNext}"`;
  const url     = `${HEALTH_V4}/users/me/dataTypes/sleep/dataPoints?${new URLSearchParams({ filter, pageSize: "25" })}`;
  const res  = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await res.text();
  let parsed = null; try { parsed = JSON.parse(body); } catch {}
  await dlog("list:sleep", `status ${res.status}`, { status: res.status, filter, body: body.slice(0, 800) });
  if (!res.ok) return null;
  const points = parsed?.dataPoints || [];
  let totalMin = 0, found = false;
  for (const pt of points) {
    const s = pt?.sleep?.summary;
    if (!s) continue;
    const m = s.minutesAsleep ?? s.minutesInSleepPeriod;
    if (m != null) { totalMin += Number(m); found = true; }
  }
  return found ? totalMin : null;
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || "";
  const headers = corsHeaders(origin, "GET, POST, OPTIONS");
  const q = req.query || {};

  if (req.method === "OPTIONS") return res.status(204).set(headers).end();

  const clientId     = googleHealthClientId();
  const clientSecret = googleHealthClientSecret();
  const action       = q.action;

  const PROTECTED = new Set(["authorize-url", "load", "sync", "save-entry", "disconnect"]);
  let authedUserId = null;
  if (PROTECTED.has(action)) {
    try { authedUserId = await authedUid(req); }
    catch (e) { return res.status(e.statusCode || 401).set(headers).json({ error: e.message }); }
  }

  if (action === "authorize-url") {
    await dlog("authorize-url", "start", { clientIdSet: !!clientId, origin });
    if (!clientId) {
      await dlog("authorize-url", "MISSING GOOGLE_HEALTH_CLIENT_ID");
      return res.status(503).set(headers).json({ error: "GOOGLE_HEALTH_CLIENT_ID not set", setup: true });
    }
    const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
      client_id: clientId, redirect_uri: REDIRECT, response_type: "code",
      scope: SCOPES, access_type: "offline", prompt: "select_account consent",
      state: authedUserId,
    });
    await dlog("authorize-url", "built URL", { userId: authedUserId, redirect: REDIRECT });
    return res.status(200).set(headers).json({ url });
  }

  if (action === "exchange") {
    const code   = q.code  || "";
    const userId = q.state || "";
    await dlog("exchange", "start", { codeLen: code.length, userId });
    if (!code || !userId)           return res.status(400).set(headers).json({ error: "Missing code or state" });
    if (!clientId || !clientSecret) return res.status(503).set(headers).json({ error: "Client credentials not configured", setup: true });
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, client_secret: clientSecret, redirect_uri: REDIRECT }),
    });
    const tokens = await r.json();
    await dlog("exchange", `token endpoint status ${r.status}`, { status: r.status, hasAccess: !!tokens.access_token, hasRefresh: !!tokens.refresh_token });
    if (!tokens.access_token) return res.status(400).set(headers).json({ error: tokens.error_description || tokens.error || "Token exchange failed" });
    const db = getAdminDb();
    await db.collection("healthConfig").doc(userId).set({
      oauthType: "google",
      googleAccessToken: tokens.access_token,
      googleRefreshToken: tokens.refresh_token || null,
      googleTokenExpiry: Date.now() + ((tokens.expires_in || 3600) - 60) * 1000,
      fitbitToken: null, userId, updatedAt: Date.now(),
    }, { merge: true });
    await dlog("exchange", "saved healthConfig — success", { userId });
    return res.status(200).set(headers).json({ success: true, userId });
  }

  if (action === "sync") {
    const userId = authedUserId;
    await dlog("sync", "start", { userId });
    const db = getAdminDb();
    let accessToken;
    try { accessToken = await ensureFreshToken(db, userId); }
    catch (err) { return res.status(500).set(headers).json({ error: String(err.message || err) }); }
    const today = new Date().toISOString().slice(0, 10);
    const [yr, mo, dy] = today.split("-").map(Number);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10).split("-").map(Number);
    const range = {
      start: { date: { year: yr,          month: mo,          day: dy          } },
      end:   { date: { year: tomorrow[0], month: tomorrow[1], day: tomorrow[2] } },
    };
    const [stepsRp, hrRp, weightRp, sleepMin] = await Promise.all([
      rollup(accessToken, "steps", range),
      rollup(accessToken, "heart-rate", range),
      rollup(accessToken, "weight", range),
      fetchSleepMinutes(accessToken, [yr, mo, dy]),
    ]);
    const GRAMS_TO_LB = 0.00220462;
    const entry = {
      date:      today,
      source:    "google",
      steps:     stepsRp?.steps?.countSum != null     ? Number(stepsRp.steps.countSum)            : null,
      heartRate: hrRp?.heartRate?.beatsPerMinuteAvg != null ? Math.round(Number(hrRp.heartRate.beatsPerMinuteAvg)) : null,
      sleep:     sleepMin  != null ? +(Number(sleepMin) / 60).toFixed(2) : null,
      weight:    weightRp?.weight?.weightGramsAvg != null ? +(Number(weightRp.weight.weightGramsAvg) * GRAMS_TO_LB).toFixed(1) : null,
      syncedAt:  Date.now(),
    };
    await db.collection("healthData").doc(userId).collection("log").doc(today).set(entry, { merge: true });
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
      const histStart = thirtyDaysAgo.toISOString().slice(0, 10).split("-").map(Number);
      const histRange = {
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
        batch.set(ref, { date: dateKey, steps: pt.steps?.countSum != null ? Number(pt.steps.countSum) : null, source: "google" }, { merge: true });
      });
      await batch.commit();
    } catch {}
    return res.status(200).set(headers).json(entry);
  }

  if (action === "load") {
    const userId = authedUserId;
    const db = getAdminDb();
    try {
      const configDoc = await db.collection("healthConfig").doc(userId).get();
      const cfg = configDoc.exists ? configDoc.data() : null;
      const config = cfg ? {
        oauthType: cfg.oauthType || null, fitbitLinked: !!cfg.fitbitLinked,
        googleFitLinked: !!cfg.googleFitLinked, goals: cfg.goals || {}, updatedAt: cfg.updatedAt || null,
      } : null;
      const today    = new Date().toISOString().slice(0, 10);
      const todayDoc = await db.collection("healthData").doc(userId).collection("log").doc(today).get();
      const todayEntry = todayDoc.exists ? { ...todayDoc.data(), date: today } : null;
      const histSnap = await db.collection("healthData").doc(userId).collection("log").orderBy("date", "desc").limit(90).get();
      const history = histSnap.docs.map(d => ({ date: d.id, ...d.data() })).reverse();
      return res.status(200).set(headers).json({ config, today: todayEntry, history });
    } catch (err) {
      return res.status(500).set(headers).json({ error: String(err.message || err) });
    }
  }

  if (action === "save-entry") {
    if (req.method !== "POST") return res.status(405).set(headers).json({ error: "Use POST" });
    const userId = authedUserId;
    const body = req.body || {};
    if (!body.date) return res.status(400).set(headers).json({ error: "Missing date" });
    const db = getAdminDb();
    const { date, ...rest } = body;
    try {
      await db.collection("healthData").doc(userId).collection("log").doc(date)
        .set({ ...rest, date, source: rest.source || "manual" }, { merge: true });
      return res.status(200).set(headers).json({ ok: true, date });
    } catch (err) {
      return res.status(500).set(headers).json({ error: String(err.message || err) });
    }
  }

  if (action === "disconnect") {
    const userId = authedUserId;
    const db = getAdminDb();
    try {
      const snap  = await db.collection("healthConfig").doc(userId).get();
      const token = snap.data()?.googleAccessToken;
      if (token) await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: "POST" });
    } catch {}
    await db.collection("healthConfig").doc(userId).update({
      oauthType: null, googleAccessToken: null, googleRefreshToken: null, googleTokenExpiry: null,
    });
    return res.status(200).set(headers).json({ success: true });
  }

  return res.status(400).set(headers).json({ error: `Unknown action: ${action || "(none)"}` });
};
