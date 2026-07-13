const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const TOKEN_SAFETY_MS = 2 * 60 * 1000;

let adminAuth = null;
let adminDb = null;

function googleClientId() {
  return String(
    process.env.GOOGLE_CLIENT_ID ||
    process.env.GOOGLE_OAUTH_CLIENT_ID ||
    process.env.VITE_GOOGLE_CLIENT_ID ||
    ""
  ).trim();
}

function googleClientSecret() {
  return String(
    process.env.GOOGLE_CLIENT_SECRET ||
    process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
    ""
  ).trim();
}

function firebaseServiceAccount() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson) return JSON.parse(rawJson);

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

function admin() {
  if (adminAuth && adminDb) return { auth: adminAuth, db: adminDb };
  const serviceAccount = firebaseServiceAccount();
  if (!serviceAccount) throw httpError(503, "Google Workspace server auth needs Firebase service-account env vars.");
  const { cert, getApps, initializeApp } = require("firebase-admin/app");
  const { getAuth } = require("firebase-admin/auth");
  const { getFirestore } = require("firebase-admin/firestore");
  const app = getApps()[0] || initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.projectId || serviceAccount.project_id,
  });
  adminAuth = getAuth(app);
  adminDb = getFirestore(app);
  return { auth: adminAuth, db: adminDb };
}

function allowedOrigin(origin = "") {
  if (!origin) return "*";
  if (/^https:\/\/([a-z0-9-]+\.)?netlify\.app$/i.test(origin)) return origin;
  if (origin === "https://onetaskfocuser.netlify.app") return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return origin;
  return "https://onetaskfocuser.netlify.app";
}

function json(statusCode, body, origin) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": allowedOrigin(origin),
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
    },
    body: JSON.stringify(body),
  };
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parseBody(event) {
  if (!event.body) return {};
  return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body);
}

function canonicalUid(decoded) {
  const prefix = String(decoded.email || "").split("@")[0].toLowerCase().trim();
  return prefix || decoded.uid;
}

async function authedUser(event) {
  const header = event.headers.authorization || event.headers.Authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw httpError(401, "Missing app sign-in token.");
  const { auth } = admin();
  const decoded = await auth.verifyIdToken(token);
  return { uid: canonicalUid(decoded), firebaseUid: decoded.uid, email: decoded.email || "" };
}

function tokenDoc(db, uid) {
  return db.collection("serverOnlyGoogleWorkspaceTokens").doc(uid);
}

async function postTokenForm(fields) {
  const body = new URLSearchParams(fields);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw httpError(response.status, data.error_description || data.error || `Google token request failed (${response.status})`);
  }
  return data;
}

function config() {
  const clientId = googleClientId();
  const clientSecret = googleClientSecret();
  return {
    clientId,
    available: !!(clientId && clientSecret && firebaseServiceAccount()),
  };
}

async function exchangeCode(event, user, body) {
  if ((event.headers["x-requested-with"] || event.headers["X-Requested-With"]) !== "XmlHttpRequest") {
    throw httpError(400, "Missing Google authorization request header.");
  }
  const { clientId, available } = config();
  if (!available) throw httpError(503, "Google Workspace server auth is not configured.");
  const code = String(body.code || "").trim();
  if (!code) throw httpError(400, "Missing Google authorization code.");
  const origin = allowedOrigin(event.headers.origin || event.headers.Origin || "");
  const { db } = admin();
  const doc = tokenDoc(db, user.uid);
  const previous = await doc.get();
  const previousRefreshToken = previous.exists ? previous.data()?.refreshToken : "";
  const tokens = await postTokenForm({
    code,
    client_id: clientId,
    client_secret: googleClientSecret(),
    redirect_uri: origin,
    grant_type: "authorization_code",
  });
  const refreshToken = tokens.refresh_token || previousRefreshToken;
  if (!refreshToken) {
    throw httpError(400, "Google did not return a refresh token. Revoke this app in Google permissions, then connect again.");
  }
  await doc.set({
    refreshToken,
    accessToken: tokens.access_token || "",
    expiresAt: Date.now() + Math.max(60, Number(tokens.expires_in || 3600) - 60) * 1000,
    scope: tokens.scope || `${CALENDAR_SCOPE} ${GMAIL_SCOPE}`,
    tokenType: tokens.token_type || "Bearer",
    appUid: user.uid,
    firebaseUid: user.firebaseUid,
    appEmail: user.email,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  return { connected: true };
}

async function accessTokenFor(user) {
  const { clientId, available } = config();
  if (!available) throw httpError(503, "Google Workspace server auth is not configured.");
  const { db } = admin();
  const doc = tokenDoc(db, user.uid);
  const snap = await doc.get();
  if (!snap.exists || !snap.data()?.refreshToken) throw httpError(401, "Google Workspace is not connected.");
  const data = snap.data();
  if (data.accessToken && Number(data.expiresAt || 0) > Date.now() + TOKEN_SAFETY_MS) return data.accessToken;
  const refreshed = await postTokenForm({
    client_id: clientId,
    client_secret: googleClientSecret(),
    refresh_token: data.refreshToken,
    grant_type: "refresh_token",
  });
  const accessToken = refreshed.access_token;
  await doc.set({
    accessToken,
    expiresAt: Date.now() + Math.max(60, Number(refreshed.expires_in || 3600) - 60) * 1000,
    tokenType: refreshed.token_type || "Bearer",
    refreshedAt: new Date().toISOString(),
  }, { merge: true });
  return accessToken;
}

function sortCalEvents(events) {
  return [...events].sort((a, b) => {
    const aAllDay = !a.start?.dateTime;
    const bAllDay = !b.start?.dateTime;
    if (aAllDay !== bAllDay) return aAllDay ? 1 : -1;
    const aKey = a.start?.dateTime || a.start?.date || "";
    const bKey = b.start?.dateTime || b.start?.date || "";
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });
}

async function googleJson(url, accessToken, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw httpError(401, "Google session expired. Connect Google again.");
    throw httpError(response.status, data?.error?.message || `Google API failed (${response.status})`);
  }
  return data;
}

async function fetchCalendarData(accessToken, { timeMin, timeMax } = {}) {
  // timeMin/timeMax come from the client (local timezone), fixing the UTC-server bug.
  // If missing, fall back to UTC day (legacy path).
  const now = new Date();
  const start = timeMin || new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const end   = timeMax || new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).toISOString();
  const eventsUrl = (calId) => `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?timeMin=${encodeURIComponent(start)}&timeMax=${encodeURIComponent(end)}&singleEvents=true&orderBy=startTime&maxResults=100`;
  let calendars = null;
  try {
    const list = await googleJson("https://www.googleapis.com/calendar/v3/users/me/calendarList?showHidden=false&maxResults=50", accessToken);
    calendars = (list.items || []).filter(cal => cal.selected !== false && cal.accessRole !== "none");
  } catch (error) {
    if (error.statusCode === 401) throw error;
  }
  if (!calendars?.length) {
    const data = await googleJson(eventsUrl("primary"), accessToken);
    // 120-cap (was 20): a zmanim calendar fills 20 slots before evening,
    // silently dropping later-day events (owner tickets rRYEUOn / Bm7Phcr).
    return sortCalEvents((data.items || []).map(event => ({ ...event, calendarId: "primary" }))).slice(0, 120);
  }
  const results = await Promise.allSettled(calendars.map(cal =>
    googleJson(eventsUrl(cal.id), accessToken)
      .then(data => (data.items || []).map(event => ({ ...event, calendarId: cal.id, calendarSummary: cal.summary || "" })))
  ));
  for (const result of results) if (result.reason?.statusCode === 401) throw result.reason;
  const seen = new Set();
  const all = results
    .flatMap(result => result.status === "fulfilled" ? result.value : [])
    .filter(event => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    });
  return sortCalEvents(all).slice(0, 120);
}

async function fetchGmailData(accessToken) {
  const query = encodeURIComponent("(category:primary) OR (category:promotions is:important) OR (category:updates is:important)");
  const list = await googleJson(`https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=${query}`, accessToken);
  if (!list.messages?.length) return [];
  return Promise.all(list.messages.slice(0, 20).map(message =>
    googleJson(`https://www.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, accessToken)
  ));
}

async function summary(user, body = {}) {
  const accessToken = await accessTokenFor(user);
  const [calendar, gmail] = await Promise.allSettled([fetchCalendarData(accessToken, body), fetchGmailData(accessToken)]);
  if (calendar.status === "rejected" && calendar.reason?.statusCode === 401) throw calendar.reason;
  if (gmail.status === "rejected" && gmail.reason?.statusCode === 401) throw gmail.reason;
  return {
    connected: true,
    calendarEvents: calendar.status === "fulfilled" ? calendar.value : [],
    gmailMessages: gmail.status === "fulfilled" ? gmail.value : [],
    errors: [
      calendar.status === "rejected" ? calendar.reason.message : "",
      gmail.status === "rejected" ? gmail.reason.message : "",
    ].filter(Boolean),
  };
}

async function status(user) {
  const { available } = config();
  if (!available) return { available: false, connected: false };
  const { db } = admin();
  const snap = await tokenDoc(db, user.uid).get();
  return { available: true, connected: !!(snap.exists && snap.data()?.refreshToken) };
}

async function gmailMessage(user, body) {
  const id = String(body.id || "").trim();
  if (!id) throw httpError(400, "Missing Gmail message id.");
  const accessToken = await accessTokenFor(user);
  return googleJson(`https://www.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, accessToken);
}

async function createCalendarEvent(user, body) {
  const eventBody = body.eventBody;
  if (!eventBody || typeof eventBody !== "object") throw httpError(400, "Missing calendar event body.");
  const accessToken = await accessTokenFor(user);
  return googleJson("https://www.googleapis.com/calendar/v3/calendars/primary/events", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(eventBody),
  });
}

async function deleteCalendarEvent(user, body) {
  const eventId = String(body.eventId || "").trim();
  const calendarId = String(body.calendarId || "primary").trim() || "primary";
  if (!eventId) throw httpError(400, "Missing calendar event id.");
  const accessToken = await accessTokenFor(user);
  await googleJson(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, accessToken, {
    method: "DELETE",
  });
  return { deleted: true, eventId, calendarId };
}

async function disconnect(user) {
  const { db } = admin();
  const doc = tokenDoc(db, user.uid);
  const snap = await doc.get();
  const token = snap.exists ? (snap.data()?.accessToken || snap.data()?.refreshToken || "") : "";
  if (token) {
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => {});
  }
  await doc.delete().catch(() => {});
  return { connected: false };
}

exports.handler = async function(event) {
  const origin = event.headers.origin || event.headers.Origin || "";
  if (event.httpMethod === "OPTIONS") return json(204, {}, origin);
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" }, origin);
  try {
    const body = parseBody(event);
    const action = String(body.action || "status");
    const user = await authedUser(event);
    if (action === "status") return json(200, await status(user), origin);
    if (action === "exchange") return json(200, await exchangeCode(event, user, body), origin);
    if (action === "summary") return json(200, await summary(user, body), origin);
    if (action === "gmailMessage") return json(200, await gmailMessage(user, body), origin);
    if (action === "createCalendarEvent") return json(200, await createCalendarEvent(user, body), origin);
    if (action === "deleteCalendarEvent") return json(200, await deleteCalendarEvent(user, body), origin);
    if (action === "disconnect") return json(200, await disconnect(user), origin);
    return json(400, { error: "Unknown Google Workspace action." }, origin);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return json(statusCode, { error: error.message || "Google Workspace request failed." }, origin);
  }
};
