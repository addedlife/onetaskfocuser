// chief-profile — user preference + learning store (Firestore-backed)
// Firestore paths: users/{uid}/chiefProfile/profile  and  .../markdown

const { corsHeaders } = require("./cors-helper");

let adminAuth = null;
let adminDb = null;

function firebaseServiceAccount() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson) return JSON.parse(rawJson);
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

function adminClient() {
  if (adminAuth && adminDb) return { auth: adminAuth, db: adminDb };
  const serviceAccount = firebaseServiceAccount();
  if (!serviceAccount) throw httpError(503, "Chief profile needs Firebase service-account env vars.");
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
  const { auth } = adminClient();
  const decoded = await auth.verifyIdToken(token);
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

function cleanLearningEvent(evt = {}) {
  return {
    ts: Number.isFinite(Number(evt.ts)) ? Number(evt.ts) : Date.now(),
    decision: cleanString(evt.decision, 40),
    actionType: cleanString(evt.actionType, 80),
    priorityId: cleanString(evt.priorityId, 80),
    source: cleanString(evt.source, 120),
    sourceKey: cleanString(evt.sourceKey, 120),
    freshnessKey: cleanString(evt.freshnessKey, 120),
    suppressionKey: cleanString(evt.suppressionKey, 120),
    issueKey: cleanString(evt.issueKey, 120),
    textKey: cleanString(evt.textKey, 240),
    sourceTitleKey: cleanString(evt.sourceTitleKey, 240),
    sourceBucket: cleanString(evt.sourceBucket, 120),
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
  return {
    ...emptyProfile(user),
    ...source,
    version: 1,
    user: { uid: user.uid, email: user.email || source.user?.email || "" },
    notes: Array.isArray(source.notes) ? source.notes.map(cleanNote).filter(n => n.text).slice(-200) : [],
    manualMarkdown: String(source.manualMarkdown || "").slice(0, 12000),
    learning: {
      version: 1,
      events: Array.isArray(source.learning?.events) ? source.learning.events.map(cleanLearningEvent).slice(-200) : [],
    },
    updatedAt: cleanString(source.updatedAt || new Date().toISOString(), 80),
  };
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

async function readProfile(db, user) {
  const snap = await db.collection("users").doc(user.uid).collection("chiefProfile").doc("profile").get();
  return normalizeProfile(snap.exists ? snap.data() : null, user);
}

async function writeProfile(db, user, profile) {
  const normalized = normalizeProfile({ ...profile, updatedAt: new Date().toISOString() }, user);
  const profileRef = db.collection("users").doc(user.uid).collection("chiefProfile").doc("profile");
  const markdownRef = db.collection("users").doc(user.uid).collection("chiefProfile").doc("markdown");
  await Promise.all([
    profileRef.set(normalized),
    markdownRef.set({ content: markdownForProfile(normalized), updatedAt: normalized.updatedAt }),
  ]);
  return normalized;
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || "";
  const headers = { ...corsHeaders(origin, "POST, OPTIONS"), "Vary": "Origin" };

  if (req.method === "OPTIONS") return res.status(204).set(headers).end();
  if (req.method !== "POST") return res.status(405).set(headers).json({ error: "Method not allowed" });

  try {
    const body = req.body || {};
    const action = String(body.action || "get");
    const user = await authedUser(req);
    const { db } = adminClient();
    let profile = await readProfile(db, user);

    if (action === "appendNote") {
      const note = cleanNote(body.note || {});
      if (!note.text) throw httpError(400, "Missing profile note text.");
      profile = await writeProfile(db, user, { ...profile, notes: [...profile.notes, note].slice(-200) });
    } else if (action === "recordLearning") {
      const eventRow = cleanLearningEvent(body.event || {});
      profile = await writeProfile(db, user, {
        ...profile,
        learning: { version: 1, events: [...(profile.learning?.events || []), eventRow].slice(-200) },
      });
    } else if (action === "replaceMarkdown") {
      profile = await writeProfile(db, user, { ...profile, manualMarkdown: manualSectionFromMarkdown(body.markdown) });
    } else if (action === "replaceProfile") {
      profile = await writeProfile(db, user, body.profile || {});
    } else if (action !== "get") {
      throw httpError(400, "Unknown Chief profile action.");
    }

    return res.status(200).set(headers).json({
      profile,
      markdown: markdownForProfile(profile),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).set(headers).json({ error: error.message || "Chief profile request failed." });
  }
};
