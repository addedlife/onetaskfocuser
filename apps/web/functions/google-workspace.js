const { corsHeaders, allowedOrigin } = require("./cors-helper");
const { getAdminDb, getAdminAuth, googleWorkspaceClientId, googleWorkspaceClientSecret, firebaseServiceAccount } = require("./_config.cjs");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
// Sending is a SEPARATE scope from reading, and gmail.send is the narrow one:
// it permits sending only, not reading, not deleting, not modifying labels. An
// account connected before this scope existed holds a refresh token without it,
// and Google does not retroactively widen a grant — those accounts get a clear
// 403 from sendGmailReply telling them to reconnect, rather than a silent failure.
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
// Deleting needs gmail.modify — there is no narrower "trash only" scope. modify
// permits label changes and trashing but NOT permanent deletion, which requires
// the full https://mail.google.com/ grant and is deliberately not requested: a
// trashed message is recoverable from Gmail's Trash for 30 days, a purged one is
// gone. "Delete" in this app therefore means "moves to Trash in the real
// account", which is what Gmail's own delete button does.
const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
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
    scope: tokens.scope || `${CALENDAR_SCOPE} ${GMAIL_SCOPE} ${GMAIL_SEND_SCOPE} ${GMAIL_MODIFY_SCOPE}`,
    tokenType: tokens.token_type || "Bearer",
    appUid: user.uid,
    firebaseUid: user.firebaseUid,
    appEmail: user.email,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  return { connected: true, account: email, accounts: await connectedEmails(user) };
}

// ── One signing, both gates (owner ticket MsISWD2d) ─────────────────────────
// The app used to authenticate TWICE: Firebase Auth's Google provider for the
// app session, then a second, separate Google authorization for Gmail/Calendar.
// Two consent screens for one human decision, and — because they were separate
// — nothing made them land on the same Google account, which is how the second
// mailbox kept ending up unconnected.
//
// The industry-standard shape is a single OAuth 2.0 authorization-code request
// carrying BOTH sets of scopes: OpenID Connect identity scopes (openid, email,
// profile) and the API scopes. One code comes back and is exchanged once, and
// that one exchange yields both halves — an `id_token` (who this is) and a
// `refresh_token` (durable API access, held server-side, never in the browser).
// The id_token is turned into a Firebase custom token so the app session is a
// normal Firebase session with all its usual persistence and auto-refresh; the
// refresh token is stored exactly where the existing connect flow stores it, so
// everything downstream of here is unchanged.
//
// Additional mailboxes stay INCREMENTAL AUTHORIZATION — Google's own recommended
// pattern — and go through `exchange` as before: an extra grant on an existing
// session, not a second login.
function decodeIdTokenClaims(idToken) {
  try {
    const payload = String(idToken || "").split(".")[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

// The id_token's signature is deliberately NOT re-verified here, and that is the
// documented rule rather than a shortcut: this token did not arrive from the
// browser, it came back to this server over TLS from Google's token endpoint in
// direct response to a request authenticated with our client secret. Google's
// own guidance is that tokens received that way can be trusted without
// re-validation. The claims below are still checked, because a token that is
// authentic but meant for a DIFFERENT client would otherwise be accepted.
function assertIdTokenUsable(claims, clientId) {
  if (!claims) throw httpError(401, "Google did not return an identity token.");
  const aud = String(claims.aud || "");
  if (aud !== String(clientId)) throw httpError(401, "Google identity token was issued for a different app.");
  const iss = String(claims.iss || "");
  if (iss !== "accounts.google.com" && iss !== "https://accounts.google.com") {
    throw httpError(401, "Google identity token has an unexpected issuer.");
  }
  if (Number(claims.exp || 0) * 1000 < Date.now()) throw httpError(401, "Google identity token has already expired.");
  const email = String(claims.email || "").toLowerCase().trim();
  if (!email) throw httpError(401, "Google identity token carries no email address.");
  // The Firestore rules gate on email_verified, so an unverified Google account
  // must not be able to mint a session that would then be denied at every read.
  if (claims.email_verified !== true && claims.email_verified !== "true") {
    throw httpError(403, "This Google account's email address is not verified.");
  }
  return email;
}

// Find the existing Firebase user for this Google account, or create one. Looking
// up by email first is what keeps a returning owner on their ORIGINAL uid — all
// their data hangs off it, so minting a new one would silently present an empty
// app.
async function firebaseUserForGoogleAccount(email, claims) {
  const auth = getAdminAuth();
  const displayName = email.split("@")[0].toLowerCase();
  try {
    const existing = await auth.getUserByEmail(email);
    if (!existing.emailVerified) {
      await auth.updateUser(existing.uid, { emailVerified: true });
    }
    return existing;
  } catch (e) {
    if (e?.code !== "auth/user-not-found") throw e;
  }
  return auth.createUser({
    email,
    emailVerified: true,
    displayName,
    ...(claims?.picture ? { photoURL: String(claims.picture) } : {}),
  });
}

async function signInWithGoogleCode(req, body) {
  if ((req.headers["x-requested-with"]) !== "XmlHttpRequest") {
    throw httpError(400, "Missing Google authorization request header.");
  }
  const { clientId, available } = config();
  if (!available) throw httpError(503, "Google Workspace server auth is not configured.");
  const code = String(body.code || "").trim();
  if (!code) throw httpError(400, "Missing Google authorization code.");
  const origin = allowedOrigin(req.headers.origin || "");
  const tokens = await postTokenForm({
    code,
    client_id: clientId,
    client_secret: googleWorkspaceClientSecret(),
    redirect_uri: origin,
    grant_type: "authorization_code",
  });
  const claims = decodeIdTokenClaims(tokens.id_token);
  const email = assertIdTokenUsable(claims, clientId);
  const record = await firebaseUserForGoogleAccount(email, claims);
  const user = { uid: email.split("@")[0].toLowerCase(), firebaseUid: record.uid, email };

  // Store the mail/calendar half of the same grant. A refresh token is only
  // issued on the FIRST consent for a given client+account, so a returning user
  // re-signing in gets none — keeping the stored one is what makes this
  // repeatable rather than a one-shot that breaks the second time.
  const db = getAdminDb();
  const ref = accountRef(db, user.uid, email);
  const previous = await ref.get();
  const refreshToken = tokens.refresh_token || (previous.exists ? previous.data()?.refreshToken : "");
  let workspaceConnected = false;
  if (refreshToken) {
    const existingCol = await accountsCol(db, user.uid).get();
    const isPrimary = (previous.exists ? !!previous.data()?.primary : false) || existingCol.empty;
    await ref.set({
      googleEmail: email,
      primary: isPrimary,
      refreshToken,
      accessToken: tokens.access_token || "",
      expiresAt: Date.now() + Math.max(60, Number(tokens.expires_in || 3600) - 60) * 1000,
      scope: tokens.scope || `${CALENDAR_SCOPE} ${GMAIL_SCOPE} ${GMAIL_SEND_SCOPE} ${GMAIL_MODIFY_SCOPE}`,
      tokenType: tokens.token_type || "Bearer",
      appUid: user.uid,
      firebaseUid: user.firebaseUid,
      appEmail: email,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    workspaceConnected = true;
  }

  const customToken = await getAdminAuth().createCustomToken(record.uid);
  return {
    customToken,
    account: email,
    // False here is not a failure: it means Google withheld a refresh token
    // because this account had already consented and none was stored. The client
    // shows the ordinary "connect mail" path rather than pretending mail works.
    workspaceConnected,
    accounts: workspaceConnected ? await connectedEmails(user) : [],
  };
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
  // Falling back to every account when the requested one matched nothing is the
  // right behaviour — an empty inbox would be worse — but doing it SILENTLY is
  // what made the account switcher look dead: you picked one account, got both,
  // and nothing said the choice had been dropped. The client reads
  // `selectedAccounts` back and resets its stored filter when this happens.
  const used = targets.length ? targets : accounts;
  const filterDropped = filter !== "all" && !targets.length;

  const perAccount = await Promise.all(used.map(async acct => {
    try {
      const accessToken = await accessTokenFor(user, acct.email);
      const [cal, gm] = await Promise.allSettled([fetchCalendarData(accessToken), fetchGmailData(accessToken)]);
      return {
        email: acct.email,
        calendar: cal.status === "fulfilled" ? cal.value.map(e => ({ ...e, sourceAccount: acct.email })) : [],
        gmail: gm.status === "fulfilled" ? gm.value.map(m => ({ ...m, sourceAccount: acct.email })) : [],
        // Name the account in the message. It used to read "Google session
        // expired. Connect Google again." with nothing saying WHICH of two
        // accounts had expired (owner: "if eg rabbidanziger is authed it never
        // shows missing ydanziger auth and my emails are 3 days stale").
        error: [
          cal.status === "rejected" ? cal.reason.message : "",
          gm.status === "rejected" ? gm.reason.message : "",
        ].filter(Boolean).map(m => `${acct.email} — ${m}`).join("; "),
      };
    } catch (e) {
      return { email: acct.email, calendar: [], gmail: [], error: `${acct.email} — ${e.message}` };
    }
  }));

  // Accounts NOT being displayed right now (the owner has filtered to one) are
  // still checked — a refresh-token probe, no data fetch, so it costs one cheap
  // token call each. Without this, a second account whose grant has been revoked
  // is completely silent: it is not queried, so it produces no error, so nothing
  // ever says its mail stopped arriving. That is the three-days-stale case.
  const unchecked = accounts.filter(a => !used.some(u => u.email === a.email));
  const unusedErrors = (await Promise.all(unchecked.map(async acct => {
    try {
      await accessTokenFor(user, acct.email);
      return "";
    } catch (e) {
      return `${acct.email} — ${e.message}`;
    }
  }))).filter(Boolean);

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
    errors: [
      ...(filterDropped
        ? [`${filter.join(", ")} is not a connected Google account — showing every connected account instead.`]
        : []),
      ...perAccount.map(p => p.error).filter(Boolean),
      ...unusedErrors,
    ],
    // Which accounts failed, by email — so the UI can name them rather than
    // concatenating error prose.
    failedAccounts: [
      ...perAccount.filter(p => p.error).map(p => p.email),
      ...unchecked.filter((a, i) => unusedErrors.some(e => e.startsWith(a.email))).map(a => a.email),
    ],
    grants: await accountsWithAbilities(user),
  };
}

// Which extra powers a stored grant actually carries. Google does NOT widen an
// existing refresh token when the app starts asking for more, so an account
// connected before send/delete existed is read-only forever until it reconnects.
// Reporting that up front is what lets the UI say "reconnect to enable delete"
// instead of showing a Delete button that 403s (owner ticket: a silently stale
// grant is worse than a missing feature, because it looks like it works).
function grantAbilities(accountDoc) {
  const scope = String(accountDoc?.scope || "");
  return {
    canSend: scope.includes(GMAIL_SEND_SCOPE),
    canDelete: scope.includes(GMAIL_MODIFY_SCOPE),
  };
}

async function accountsWithAbilities(user) {
  const docs = await listAccountDocs(user);
  return docs.map(d => ({ email: d.email, primary: !!d.primary, ...grantAbilities(d) }));
}

async function statusAction(user) {
  const { available } = config();
  if (!available) return { available: false, connected: false, accounts: [], grants: [] };
  const grants = await accountsWithAbilities(user);
  return { available: true, connected: grants.length > 0, accounts: grants.map(g => g.email), grants };
}

async function listAccountsAction(user) {
  const { available } = config();
  if (!available) return { available: false, accounts: [], grants: [] };
  const grants = await accountsWithAbilities(user);
  return { available: true, accounts: grants.map(g => g.email), grants };
}

// ── Send a reply, for real ───────────────────────────────────────────────────
// Owner: "Email now has reply, problem is it doesn't reply, just kicks you to the
// email webpage, so functionally no more useful than open Gmail." Correct — the
// old Reply button was a deep link. This actually sends.
//
// Threading is the part that has to be right, or the reply shows up in Gmail as a
// new unrelated conversation. Three things together do it: the In-Reply-To header
// (the parent's Message-ID), a References chain (the parent's chain plus the
// parent), and Gmail's own threadId on the send call. Gmail will silently start a
// new thread if the headers disagree with the threadId, so both are set from the
// SAME fetched parent message rather than from anything the client passed in.
async function sendGmailReply(user, body) {
  const id = String(body.id || "").trim();
  const text = String(body.text || "").trim();
  if (!id) throw httpError(400, "Missing the id of the message being replied to.");
  if (!text) throw httpError(400, "Cannot send an empty reply.");
  const replyAll = body.all === true;

  const email = await resolveAccount(user, body);
  const accessToken = await accessTokenFor(user, email);

  // The parent, fetched server-side: the client's copy is a list-view summary and
  // may not carry the headers threading depends on.
  const parent = await googleJson(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Reply-To`,
    accessToken,
  );
  const header = (name) => (parent?.payload?.headers || [])
    .find(h => String(h.name || "").toLowerCase() === name.toLowerCase())?.value || "";

  const messageId = header("Message-ID");
  const references = [header("References"), messageId].filter(Boolean).join(" ");
  const rawSubject = header("Subject") || "(no subject)";
  const subject = /^re:/i.test(rawSubject.trim()) ? rawSubject : `Re: ${rawSubject}`;

  // Reply goes to Reply-To when the sender set one, else From — the same rule every
  // mail client follows, and the reason a mailing-list reply lands in the right place.
  const to = header("Reply-To") || header("From");
  if (!to) throw httpError(422, "That message has no sender address to reply to.");

  // Reply-all adds the original To and Cc, minus this account itself — replying to
  // yourself is never intended and Gmail will happily do it if asked.
  const extra = replyAll
    ? [header("To"), header("Cc")].filter(Boolean).join(", ")
    : "";
  const stripSelf = (list) => list
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .filter(addr => !addr.toLowerCase().includes(email.toLowerCase()));
  const ccList = extra ? [...new Set(stripSelf(extra))] : [];

  const headers = [
    `To: ${to}`,
    ...(ccList.length ? [`Cc: ${ccList.join(", ")}`] : []),
    `Subject: ${subject}`,
    ...(messageId ? [`In-Reply-To: ${messageId}`, `References: ${references}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ];
  const mime = `${headers.join("\r\n")}\r\n\r\n${text}\r\n`;
  // base64url, per the Gmail API's raw field.
  const raw = Buffer.from(mime, "utf8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  try {
    const sent = await googleJson("https://www.googleapis.com/gmail/v1/users/me/messages/send", accessToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw, threadId: parent.threadId || undefined }),
    });
    return { ok: true, id: sent.id, threadId: sent.threadId, to, cc: ccList, subject, account: email };
  } catch (e) {
    // The one failure worth naming precisely: an account connected before the send
    // scope existed. Google answers 403 and the fix is a reconnect, not a retry.
    if (e?.statusCode === 403) {
      throw httpError(403, `${email} was connected before sending was enabled. Reconnect Google to allow replies to be sent.`);
    }
    throw e;
  }
}

async function gmailMessage(user, body) {
  const id = String(body.id || "").trim();
  if (!id) throw httpError(400, "Missing Gmail message id.");
  const email = await resolveAccount(user, body);
  const accessToken = await accessTokenFor(user, email);
  return googleJson(`https://www.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, accessToken);
}

// ── Delete an email, for real ────────────────────────────────────────────────
// Owner: "I NEED A WORKING DELETE option for emails that deletes it live in my
// real email acct also." This trashes the message in Gmail itself — same effect
// as Gmail's own delete button, recoverable from Trash for 30 days. Permanent
// purge is deliberately NOT offered: it needs the full-mailbox scope and there
// is no undo for it.
//
// Threads vs messages: a conversation the owner is looking at in the app is one
// message row, so one message is trashed. Trashing the whole thread would also
// bin the owner's own sent replies in it, which is not what "delete this email"
// means to anyone.
async function trashGmailMessage(user, body) {
  const id = String(body.id || "").trim();
  if (!id) throw httpError(400, "Missing the id of the message to delete.");
  const email = await resolveAccount(user, body);
  const accessToken = await accessTokenFor(user, email);
  try {
    const result = await googleJson(
      `https://www.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}/trash`,
      accessToken,
      { method: "POST" },
    );
    return { ok: true, id: result.id || id, threadId: result.threadId, account: email, trashed: true };
  } catch (e) {
    // Same failure shape as sendGmailReply: an account connected before the
    // modify scope existed answers 403, and the fix is a reconnect, not a retry.
    if (e?.statusCode === 403) {
      throw httpError(403, `${email} was connected before deleting was enabled. Reconnect Google to allow mail to be deleted from inside the app.`);
    }
    if (e?.statusCode === 404) throw httpError(404, "That message no longer exists in Gmail — it may already be deleted.");
    throw e;
  }
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

// Arm Gmail push for every connected account. Required lazily rather than at module
// load to avoid a require cycle: gmail-push.js pulls accessTokenFor/listAccountDocs
// back out of this file.
async function armGmailPush(user) {
  const { registerWatchesFor } = require("./gmail-push.js");
  return { watches: await registerWatchesFor(user) };
}

const handler = async (req, res) => {
  const origin = req.headers.origin || "";
  const headers = corsHeaders(origin, "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).set(headers).end();
  if (req.method !== "POST") return res.status(405).set(headers).json({ error: "Method not allowed" });

  try {
    const body = req.body || {};
    const action = String(body.action || "status");
    // The ONE action that runs without a session, because it is what creates the
    // session. It authenticates itself: an authorization code is single-use and
    // only Google can mint one for our client id.
    if (action === "signIn") return res.status(200).set(headers).json(await signInWithGoogleCode(req, body));
    const user = await authedUser(req);
    if (action === "status")              return res.status(200).set(headers).json(await statusAction(user));
    if (action === "listAccounts")        return res.status(200).set(headers).json(await listAccountsAction(user));
    if (action === "exchange")            return res.status(200).set(headers).json(await exchangeCode(req, user, body));
    if (action === "summary")             return res.status(200).set(headers).json(await summary(user, body));
    if (action === "gmailMessage")        return res.status(200).set(headers).json(await gmailMessage(user, body));
    if (action === "sendGmailReply")      return res.status(200).set(headers).json(await sendGmailReply(user, body));
    if (action === "trashGmailMessage")   return res.status(200).set(headers).json(await trashGmailMessage(user, body));
    if (action === "createCalendarEvent") return res.status(200).set(headers).json(await createCalendarEvent(user, body));
    if (action === "deleteCalendarEvent") return res.status(200).set(headers).json(await deleteCalendarEvent(user, body));
    if (action === "disconnect")          return res.status(200).set(headers).json(await disconnect(user, body));
    if (action === "armGmailPush")        return res.status(200).set(headers).json(await armGmailPush(user));
    return res.status(400).set(headers).json({ error: "Unknown Google Workspace action." });
  } catch (error) {
    return res.status(error.statusCode || 500).set(headers).json({ error: error.message || "Google Workspace request failed." });
  }
};

// The HTTP handler stays the default export (index.js passes it to onRequest), with
// the token/account helpers hung off it so gmail-push.js can reuse them rather than
// duplicating the refresh-token dance.
module.exports = handler;
module.exports.accessTokenFor = accessTokenFor;
module.exports.listAccountDocs = listAccountDocs;
