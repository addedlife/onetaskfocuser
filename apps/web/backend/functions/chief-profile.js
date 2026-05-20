const { getStore } = require("@netlify/blobs");

let adminAuth = null;

function firebaseServiceAccount() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson) return JSON.parse(rawJson);

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

function adminAuthClient() {
  if (adminAuth) return adminAuth;
  const serviceAccount = firebaseServiceAccount();
  if (!serviceAccount) throw httpError(503, "Chief profile needs Firebase service-account env vars.");
  const { cert, getApps, initializeApp } = require("firebase-admin/app");
  const { getAuth } = require("firebase-admin/auth");
  const app = getApps()[0] || initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.projectId || serviceAccount.project_id,
  });
  adminAuth = getAuth(app);
  return adminAuth;
}

function allowedOrigin(origin = "") {
  if (!origin) return "*";
  if (/^https:\/\/([a-z0-9-]+\.)?netlify\.app$/i.test(origin)) return origin;
  if (origin === "https://onetaskfocuser.netlify.app") return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return origin;
  return "https://onetaskfocuser.netlify.app";
}

function response(statusCode, body, origin) {
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
  const decoded = await adminAuthClient().verifyIdToken(token);
  return { uid: canonicalUid(decoded), firebaseUid: decoded.uid, email: decoded.email || "" };
}

function cleanString(value, max = 500) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text;
}

function cleanNote(note = {}) {
  return {
    id: cleanString(note.id || `note-${Date.now().toString(36)}`, 80),
    category: cleanString(note.category || "preference", 80),
    text: cleanString(note.text, 800),
    source: cleanString(note.source || "Chief of Staff", 120),
    linkedSource: note.linkedSource && typeof note.linkedSource === "object" ? {
      type: cleanString(note.linkedSource.type || "", 60),
      id: cleanString(note.linkedSource.id || "", 180),
      calendarId: cleanString(note.linkedSource.calendarId || "", 180),
      title: cleanString(note.linkedSource.title || "", 240),
      start: cleanString(note.linkedSource.start || "", 100),
      end: cleanString(note.linkedSource.end || "", 100),
    } : null,
    createdAt: cleanString(note.createdAt || new Date().toISOString(), 80),
  };
}

function cleanLearningEvent(event = {}) {
  return {
    ts: Number.isFinite(Number(event.ts)) ? Number(event.ts) : Date.now(),
    decision: cleanString(event.decision, 40),
    actionType: cleanString(event.actionType, 80),
    priorityId: cleanString(event.priorityId, 80),
    source: cleanString(event.source, 120),
    sourceKey: cleanString(event.sourceKey, 120),
    freshnessKey: cleanString(event.freshnessKey, 120),
    suppressionKey: cleanString(event.suppressionKey, 120),
    issueKey: cleanString(event.issueKey, 120),
    textKey: cleanString(event.textKey, 240),
    sourceTitleKey: cleanString(event.sourceTitleKey, 240),
    sourceBucket: cleanString(event.sourceBucket, 120),
  };
}

function emptyProfile(user) {
  return {
    version: 1,
    user: { uid: user.uid, email: user.email },
    notes: [],
    manualMarkdown: "",
    learning: { version: 1, events: [] },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeProfile(value, user) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const profile = {
    ...emptyProfile(user),
    ...source,
    version: 1,
    user: { uid: user.uid, email: user.email || source.user?.email || "" },
    notes: Array.isArray(source.notes) ? source.notes.map(cleanNote).filter(note => note.text).slice(-200) : [],
    manualMarkdown: String(source.manualMarkdown || "").slice(0, 12000),
    learning: {
      version: 1,
      events: Array.isArray(source.learning?.events) ? source.learning.events.map(cleanLearningEvent).slice(-200) : [],
    },
    updatedAt: cleanString(source.updatedAt || new Date().toISOString(), 80),
  };
  return profile;
}

function markdownForProfile(profile) {
  const lines = [
    "# Chief of Staff Profile",
    "",
    `Updated: ${profile.updatedAt}`,
    `User: ${profile.user?.email || profile.user?.uid || "unknown"}`,
    "",
    "## Preferences",
    "",
  ];
  if (profile.notes?.length) {
    profile.notes.forEach(note => {
      const linked = note.linkedSource?.title ? ` Source: ${note.linkedSource.title}.` : "";
      lines.push(`- [${note.category}] ${note.text}${linked}`);
    });
  } else {
    lines.push("- No saved preferences yet.");
  }
  lines.push("", "## Manual Notes", "");
  lines.push(profile.manualMarkdown?.trim() || "_No manual notes yet._");
  lines.push("", "## Learning Summary", "");
  lines.push(`- Accepted suggestions: ${(profile.learning?.events || []).filter(e => e.decision === "accepted").length}`);
  lines.push(`- Rejected suggestions: ${(profile.learning?.events || []).filter(e => e.decision === "rejected").length}`);
  lines.push("", "<!-- Edit this profile from the Chief of Staff Profile panel in Shamash Pro 4. -->", "");
  return lines.join("\n");
}

function manualSectionFromMarkdown(markdown) {
  const text = String(markdown || "").slice(0, 12000);
  const match = text.match(/## Manual Notes\s*([\s\S]*?)(?:\n## |\n<!--|$)/i);
  return (match ? match[1] : text).trim();
}

function store() {
  return getStore({ name: "chief-profile", consistency: "strong" });
}

async function readProfile(user) {
  const found = await store().get(`${user.uid}.json`, { type: "json" });
  return normalizeProfile(found, user);
}

async function writeProfile(user, profile) {
  const normalized = normalizeProfile({ ...profile, updatedAt: new Date().toISOString() }, user);
  await store().setJSON(`${user.uid}.json`, normalized);
  await store().set(`${user.uid}.md`, markdownForProfile(normalized), {
    metadata: { contentType: "text/markdown", updatedAt: normalized.updatedAt },
  });
  return normalized;
}

exports.handler = async function(event) {
  const origin = event.headers.origin || event.headers.Origin || "";
  if (event.httpMethod === "OPTIONS") return response(204, {}, origin);
  if (event.httpMethod !== "POST") return response(405, { error: "Method not allowed" }, origin);
  try {
    const body = parseBody(event);
    const action = String(body.action || "get");
    const user = await authedUser(event);
    let profile = await readProfile(user);

    if (action === "appendNote") {
      const note = cleanNote(body.note || {});
      if (!note.text) throw httpError(400, "Missing profile note text.");
      profile = await writeProfile(user, { ...profile, notes: [...profile.notes, note].slice(-200) });
    } else if (action === "recordLearning") {
      const eventRow = cleanLearningEvent(body.event || {});
      profile = await writeProfile(user, {
        ...profile,
        learning: { version: 1, events: [...(profile.learning?.events || []), eventRow].slice(-200) },
      });
    } else if (action === "replaceMarkdown") {
      profile = await writeProfile(user, { ...profile, manualMarkdown: manualSectionFromMarkdown(body.markdown) });
    } else if (action === "replaceProfile") {
      profile = await writeProfile(user, body.profile || {});
    } else if (action !== "get") {
      throw httpError(400, "Unknown Chief profile action.");
    }

    return response(200, {
      profile,
      markdown: markdownForProfile(profile),
      blobKey: `chief-profile/${user.uid}.md`,
    }, origin);
  } catch (error) {
    return response(error.statusCode || 500, { error: error.message || "Chief profile request failed." }, origin);
  }
};
