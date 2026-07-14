const { corsHeaders, allowedOrigin } = require("./cors-helper");
const { getAdminDb, getAdminAuth, googleWorkspaceClientId, googleWorkspaceClientSecret, firebaseServiceAccount } = require("./_config.cjs");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const TOKEN_SAFETY_MS = 2 * 60 * 1000;

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
  const auth = getAdminAuth();
  const decoded = await auth.verifyIdToken(token);
  return { uid: canonicalUid(decoded), firebaseUid: decoded.uid, email: decoded.email || "" };
}

// ── Per-account token storage ────────────────────────────────────────────────
// Old shape: one token at serverOnlyGoogleWorkspaceTokens/{uid}.
// New shape: one token per Google account at .../{uid}/accounts/{email}, so a
// single app-user can connect several Google accounts (e.g. work + personal)
// and view them merged. The legacy single doc is migrated on first read.
function legacyTokenDoc(db, uid) {
  return db.collection("serverOnlyGoogleWorkspaceTokens").doc(uid);
}
function accountsCol(db, uid) {
  return db.collection("serverOnlyGoogleWorkspaceTokens").doc(uid).collection("accounts");
}
function accountRef(db, uid, email) {
  return accountsCol(db, uid).doc(String(email).toLowerCase());
}

function decodeIdTokenEmail(idToken) {
  try {
    const payload = String(idToken || "").split(".")[1];
    if (!payload) return "";
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return String(JSON.parse(json).email || "").toLowerCase().trim();
  } catch {
    return "";
  }
}

async function fetchUserinfoEmail(accessToken) {
  try {
    const data = await googleJson(USERINFO_URL, accessToken);
    return String(data.email || "").toLowerCase().trim();
  } catch {
    return "";
  }
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
  const clientId = googleWorkspaceClientId();
  const clientSecret = googleWorkspaceClientSecret();
  return { clientId, available: !!(clientId && clientSecret && firebaseServiceAccount()) };
}

async function exchangeCode(req, user, body) {
  if ((req.headers["x-requested-with"]) !== "XmlHttpRequest") {
    throw httpError(400, "Missing Google authorization request header.");
  }
  const { clientId, available } = config();
  if (!available) throw httpError(503, "Google Workspace server auth is not configured.");
  const code = String(body.code || "").trim();
  if (!code) throw httpError(400, "Missing Google authorization code.");
  const origin = allowedOrigin(req.headers.origin || "");
  const db = getAdminDb();
  const tokens = await postTokenForm({
    code,
    client_id: clientId,
    client_secret: googleWorkspaceClientSecret(),
    redirect_uri: origin,
    grant_type: "authorization_code",
  });
  // Figure out which Google account this token belongs to so we can key it.
  let email = decodeIdTokenEmail(tokens.id_token);
  if (!email && tokens.access_token) email = await fetchUserinfoEmail(tokens.access_token);
  if (!email) email = String(user.email || "primary").toLowerCase();

  const ref = accountRef(db, user.uid, email);
  const previous = await ref.get();
  const previousRefreshToken = previous.exists ? previous.data()?.refreshToken : "";
  const refreshToken = tokens.refresh_token || previousRefreshToken;
  if (!refreshToken) {
    throw httpError(400, "Google did not return a refresh token. Revoke this app in Google permissions, then connect again.");
  }
  // The first account ever connected becomes "primary": it's listed first and
  // is where new calendar events are created by default. Reconnecting keeps it.
  const existingCol = await accountsCol(db, user.uid).get();
  const isPrimary = (previous.exists ? !!previous.data()?.primary : false) || existingCol.empty;
  await ref.set({
    googleEmail: email,
    primary: isPrimary,
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
  return { connected: true, account: email, accounts: await connectedEmails(user) };
}

// Returns [{ email, ... }] for every connected Google account, migrating the
// legacy single-token doc into an account entry the first time it's seen.
function sortPrimaryFirst(accounts) {
  // Primary account first, then the rest alphabetically by email — stable order
  // for the toggle and for picking a default target account.
  return [...accounts].sort((a, b) => {
    const ap = a.primary ? 0 : 1;
    const bp = b.primary ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.email < b.email ? -1 : a.email > b.email ? 1 : 0;
  });
}

async function listAccountDocs(user) {
  const db = getAdminDb();
  const snap = await accountsCol(db, user.uid).get();
  if (!snap.empty) return sortPrimaryFirst(snap.docs.map(d => ({ email: d.id, ...d.data() })));
  const legacy = await legacyTokenDoc(db, user.uid).get();
  if (legacy.exists && legacy.data()?.refreshToken) {
    const data = legacy.data();
    const email = String(data.googleEmail || data.appEmail || user.email || "primary").toLowerCase();
    // The pre-existing single account was the original one → treat it as primary.
    await accountRef(db, user.uid, email).set({ ...data, googleEmail: email, primary: true, migratedAt: new Date().toISOString() }, { merge: true });
    return [{ email, primary: true, ...data }];
  }
  return [];
}

async function connectedEmails(user) {
  return (await listAccountDocs(user)).map(a => a.email);
}

async function accessTokenFor(user, email) {
  const { clientId, available } = config();
  if (!available) throw httpError(503, "Google Workspace server auth is not configured.");
  const db = getAdminDb();
  const ref = accountRef(db, user.uid, email);
  const snap = await ref.get();
  if (!snap.exists || !snap.data()?.refreshToken) throw httpError(401, `Google account ${email} is not connected.`);
  const data = snap.data();
  if (data.accessToken && Number(data.expiresAt || 0) > Date.now() + TOKEN_SAFETY_MS) return data.accessToken;
  const refreshed = await postTokenForm({
    client_id: clientId,
    client_secret: googleWorkspaceClientSecret(),
    refresh_token: data.refreshToken,
    grant_type: "refresh_token",
  });
  const accessToken = refreshed.access_token;
  await ref.set({
    accessToken,
    expiresAt: Date.now() + Math.max(60, Number(refreshed.expires_in || 3600) - 60) * 1000,
    tokenType: refreshed.token_type || "Bearer",
    refreshedAt: new Date().toISOString(),
  }, { merge: true });
  return accessToken;
}

// Resolve which account an action targets: explicit body.account, else the
// single connected account, else error asking the caller to specify.
async function resolveAccount(user, body) {
  const requested = String(body.account || "").toLowerCase().trim();
  const docs = await listAccountDocs(user);
  if (!docs.length) throw httpError(401, "Google Workspace is not connected.");
  if (requested) {
    const match = docs.find(d => d.email === requested);
    if (!match) throw httpError(404, `Google account ${requested} is not connected.`);
    return requested;
  }
  // Default target = primary account (rabbidanziger), already sorted first.
  return docs[0].email;
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
    headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw httpError(401, "Google session expired. Connect Google again.");
    throw httpError(response.status, data?.error?.message || `Google API failed (${response.status})`);
  }
  return data;
}

async function fetchCalendarData(accessToken) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
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
    .filter(event => { if (seen.has(event.id)) return false; seen.add(event.id); return true; });
  return sortCalEvents(all).slice(0, 120);
}

async function fetchGmailData(accessToken) {
  const query = encodeURIComponent("(category:primary) OR (category:promotions is:important) OR (category:updates is:important)");
  const list = await googleJson(`https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=${query}`, accessToken);
  if (!list.messages?.length) return [];
  return Promise.all(list.messages.slice(0, 20).map(message =>
    googleJson(`https://www.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=Message-ID`, accessToken)
  ));
}

function messageIdHeader(message) {
  const headers = message?.payload?.headers || [];
  const found = headers.find(h => String(h.name || "").toLowerCase() === "message-id");
  return found ? String(found.value || "").trim() : "";
}

// Parse body.accounts into either "all" or a lowercased array of emails.
function normalizeAccountFilter(value) {
  if (!value || value === "all") return "all";
  const list = Array.isArray(value) ? value : [value];
  const emails = list.map(v => String(v).toLowerCase().trim()).filter(Boolean);
  return emails.length ? emails : "all";
}

async function summary(user, body = {}) {
  const accounts = await listAccountDocs(user);
  if (!accounts.length) throw httpError(401, "Google Workspace is not connected.");
  const filter = normalizeAccountFilter(body.accounts);
  const targets = filter === "all" ? accounts : accounts.filter(a => filter.includes(a.email));
  const used = targets.length ? targets : accounts;

  const perAccount = await Promise.all(used.map(async acct => {
    try {
      const accessToken = await accessTokenFor(user, acct.email);
      const [cal, gm] = await Promise.allSettled([fetchCalendarData(accessToken), fetchGmailData(accessToken)]);
      return {
        email: acct.email,
        calendar: cal.status === "fulfilled" ? cal.value.map(e => ({ ...e, sourceAccount: acct.email })) : [],
        gmail: gm.status === "fulfilled" ? gm.value.map(m => ({ ...m, sourceAccount: acct.email })) : [],
        error: [
          cal.status === "rejected" ? cal.reason.message : "",
          gm.status === "rejected" ? gm.reason.message : "",
        ].filter(Boolean).join("; "),
      };
    } catch (e) {
      return { email: acct.email, calendar: [], gmail: [], error: `${acct.email}: ${e.message}` };
    }
  }));

  // Merge + dedupe across accounts. The same invite shows in both mailboxes with
  // the same iCalUID; the same email carries the same RFC822 Message-ID header.
  const calSeen = new Set();
  const calendarEvents = sortCalEvents(
    perAccount.flatMap(p => p.calendar).filter(e => {
      const key = e.iCalUID || e.id;
      if (calSeen.has(key)) return false;
      calSeen.add(key);
      return true;
    })
  ).slice(0, 30);

  const mailSeen = new Set();
  // Interleave accounts by date (newest first) — never stack account A's inbox
  // on top of account B's, and never let the 30-cap silently drop one account.
  const mailTime = m => {
    const t = Number(m.internalDate);
    if (Number.isFinite(t) && t > 0) return t;
    const d = Date.parse((m.payload?.headers || []).find(h => h.name === "Date")?.value || "");
    return Number.isFinite(d) ? d : 0;
  };
  const gmailMessages = perAccount.flatMap(p => p.gmail).filter(m => {
    const key = messageIdHeader(m) || m.id;
    if (mailSeen.has(key)) return false;
    mailSeen.add(key);
    return true;
  }).sort((a, b) => mailTime(b) - mailTime(a)).slice(0, 30);

  return {
    connected: true,
    accounts: accounts.map(a => a.email),
    selectedAccounts: used.map(a => a.email),
    calendarEvents,
    gmailMessages,
    errors: perAccount.map(p => p.error).filter(Boolean),
  };
}

async function statusAction(user) {
  const { available } = config();
  if (!available) return { available: false, connected: false, accounts: [] };
  const accounts = await connectedEmails(user);
  return { available: true, connected: accounts.length > 0, accounts };
}

async function listAccountsAction(user) {
  const { available } = config();
  if (!available) return { available: false, accounts: [] };
  return { available: true, accounts: await connectedEmails(user) };
}

async function gmailMessage(user, body) {
  const id = String(body.id || "").trim();
  if (!id) throw httpError(400, "Missing Gmail message id.");
  const email = await resolveAccount(user, body);
  const accessToken = await accessTokenFor(user, email);
  return googleJson(`https://www.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, accessToken);
}

async function createCalendarEvent(user, body) {
  const eventBody = body.eventBody;
  if (!eventBody || typeof eventBody !== "object") throw httpError(400, "Missing calendar event body.");
  const email = await resolveAccount(user, body);
  const accessToken = await accessTokenFor(user, email);
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
  // An event can only be deleted from the account that owns it. Prefer the
  // event's source account if the client tells us; else fall back to default.
  const email = await resolveAccount(user, body);
  const accessToken = await accessTokenFor(user, email);
  await googleJson(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, accessToken, { method: "DELETE" });
  return { deleted: true, eventId, calendarId };
}

async function disconnect(user, body = {}) {
  const db = getAdminDb();
  const requested = String(body.account || "").toLowerCase().trim();
  const accounts = await listAccountDocs(user);
  const targets = requested ? accounts.filter(a => a.email === requested) : accounts;
  for (const acct of targets) {
    const token = acct.accessToken || acct.refreshToken || "";
    if (token) await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => {});
    await accountRef(db, user.uid, acct.email).delete().catch(() => {});
  }
  // Clean up any lingering legacy doc when fully disconnecting.
  if (!requested) await legacyTokenDoc(db, user.uid).delete().catch(() => {});
  return { connected: (await connectedEmails(user)).length > 0, accounts: await connectedEmails(user) };
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || "";
  const headers = corsHeaders(origin, "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).set(headers).end();
  if (req.method !== "POST") return res.status(405).set(headers).json({ error: "Method not allowed" });

  try {
    const body = req.body || {};
    const action = String(body.action || "status");
    const user = await authedUser(req);
    if (action === "status")              return res.status(200).set(headers).json(await statusAction(user));
    if (action === "listAccounts")        return res.status(200).set(headers).json(await listAccountsAction(user));
    if (action === "exchange")            return res.status(200).set(headers).json(await exchangeCode(req, user, body));
    if (action === "summary")             return res.status(200).set(headers).json(await summary(user, body));
    if (action === "gmailMessage")        return res.status(200).set(headers).json(await gmailMessage(user, body));
    if (action === "createCalendarEvent") return res.status(200).set(headers).json(await createCalendarEvent(user, body));
    if (action === "deleteCalendarEvent") return res.status(200).set(headers).json(await deleteCalendarEvent(user, body));
    if (action === "disconnect")          return res.status(200).set(headers).json(await disconnect(user, body));
    return res.status(400).set(headers).json({ error: "Unknown Google Workspace action." });
  } catch (error) {
    return res.status(error.statusCode || 500).set(headers).json({ error: error.message || "Google Workspace request failed." });
  }
};
