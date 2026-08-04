// MCP server — Firestore tools for OneTask/Shailos
// (Converted from mcp.mjs — ESM → CJS, Web Fetch API → Express req/res)
// Read-only for app data (tasks/shailos/config), with ONE sanctioned write
// surface: the Bug Log ticket workflow (notes + status), so cloud Claude
// sessions can autopull and work tickets without the PC-only admin key.
// The wire name stays "onetask-firestore-readonly" for connector back-compat.

const { FIREBASE_PROJECT_ID, getAdminApp, getAdminAuth, getAdminDatabase, getAdminDb } = require("./_config.cjs");
const USER_KEY = "rabbidanziger";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version",
  "Access-Control-Expose-Headers": "mcp-protocol-version",
  "MCP-Protocol-Version": "2025-11-25",
};

const tools = [
  {
    name: "list_tasks",
    description: "List OneTask tasks for rabbidanziger, with optional read-only filtering and sorting.",
    inputSchema: {
      type: "object",
      properties: {
        completed: { type: "boolean" }, priority: { type: "string" }, shailaId: { type: "string" },
        createdAfter: { type: "string" }, createdBefore: { type: "string" },
        updatedAfter: { type: "string" }, updatedBefore: { type: "string" },
        sortBy: { type: "string", enum: ["createdAt", "updatedAt", "priority", "title"] },
        sortDirection: { type: "string", enum: ["asc", "desc"] },
        limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_task",
    description: "Get one OneTask task by taskId.",
    inputSchema: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"], additionalProperties: false },
  },
  {
    name: "search_tasks",
    description: "Search OneTask tasks by plain text across title, content, notes, and shaila linkage.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" }, completed: { type: "boolean" }, priority: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
      },
      required: ["query"], additionalProperties: false,
    },
  },
  {
    name: "list_shailos",
    description: "List shailos for rabbidanziger, with optional status filtering and sorting.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "answered", "got_back"] }, linkedOnly: { type: "boolean" },
        sortBy: { type: "string", enum: ["createdAt", "updatedAt", "date", "status"] },
        sortDirection: { type: "string", enum: ["asc", "desc"] },
        limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_shaila",
    description: "Get one shaila by shailaId.",
    inputSchema: { type: "object", properties: { shailaId: { type: "string" } }, required: ["shailaId"], additionalProperties: false },
  },
  {
    name: "search_shailos",
    description: "Search shailos by plain text across synopsis, content, asker, answer, and parsed fields.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" }, status: { type: "string", enum: ["pending", "answered", "got_back"] },
        limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
      },
      required: ["query"], additionalProperties: false,
    },
  },
  {
    name: "get_settings",
    description: "Get OneTask settings from users/rabbidanziger/config/settings.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_meta",
    description: "Get OneTask metadata from users/rabbidanziger/config/meta.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_legacy_app_state",
    description: "Get the legacy backup blob at users/rabbidanziger/appData/appState_v4.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  // ── Bug Log (users/rabbidanziger/bugs) ────────────────────────────────────
  // The owner's standing "connect the buglog for autopull" workflow: any Claude
  // session with the MCP token can pull the ticket list and leave work notes —
  // no service-account key needed (that key only lives on the owner's PC, so
  // cloud sessions used to be blind here). Same semantics as
  // tools/bug-log-reader: closing a ticket REQUIRES a resolution note.
  {
    name: "list_bugs",
    description: "List Bug Log tickets for rabbidanziger. Default returns unresolved only; pass status 'all' for everything.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["unresolved", "paused", "resolved", "future", "all"] },
        limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
      },
      additionalProperties: false,
    },
  },
  {
    name: "add_bug_note",
    description: "Append a work note to a Bug Log ticket (status unchanged).",
    inputSchema: {
      type: "object",
      properties: { bugId: { type: "string" }, note: { type: "string" } },
      required: ["bugId", "note"], additionalProperties: false,
    },
  },
  {
    name: "set_bug_status",
    description: "Set a Bug Log ticket's status. Marking 'resolved' requires a note — every resolution carries the coder's process notes.",
    inputSchema: {
      type: "object",
      properties: {
        bugId: { type: "string" },
        status: { type: "string", enum: ["unresolved", "paused", "resolved", "future"] },
        note: { type: "string" },
      },
      required: ["bugId", "status"], additionalProperties: false,
    },
  },

  // ── General Firebase access ───────────────────────────────────────────────
  // The tools above are one named tool per known shape, which is why a cloud
  // session could work the Bug Log and nothing else. These are the general
  // ones: any Firestore path, any Realtime Database path, Storage, Auth. Owner
  // asked for this directly on 2026-08-04 ("I want firebase access from cloud
  // for lots of things not just buglogs").
  //
  // Reads are unrestricted within the project. Writes are not: see assertWritePath.
  {
    name: "firestore_get",
    description: "Read one Firestore document by full path, e.g. 'users/rabbidanziger/config/settings'. Optionally list its subcollection names.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, withSubcollections: { type: "boolean" } },
      required: ["path"], additionalProperties: false,
    },
  },
  {
    name: "firestore_list",
    description: "List documents in a Firestore collection by path, e.g. 'users/rabbidanziger/bugs'. Use fields[] to return only the fields you need — that is what keeps a big collection readable.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        where: {
          type: "array",
          description: "Filters, e.g. [{\"field\":\"status\",\"op\":\"==\",\"value\":\"unresolved\"}].",
          items: {
            type: "object",
            properties: { field: { type: "string" }, op: { type: "string" }, value: {} },
            required: ["field", "op", "value"], additionalProperties: false,
          },
        },
        orderBy: { type: "string" },
        direction: { type: "string", enum: ["asc", "desc"] },
        fields: { type: "array", items: { type: "string" } },
        limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
      },
      required: ["path"], additionalProperties: false,
    },
  },
  {
    name: "firestore_set",
    description: "WRITE a Firestore document. Merges by default. Requires confirm:true, and the path must be under users/rabbidanziger.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" }, data: { type: "object" },
        merge: { type: "boolean", description: "Default true. false REPLACES the whole document." },
        confirm: { type: "boolean" },
      },
      required: ["path", "data", "confirm"], additionalProperties: false,
    },
  },
  {
    name: "firestore_delete",
    description: "DELETE a Firestore document. Requires confirm:true and a path under users/rabbidanziger. Does not touch subcollections — it reports them instead.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, confirm: { type: "boolean" } },
      required: ["path", "confirm"], additionalProperties: false,
    },
  },
  {
    name: "rtdb_get",
    description: "Read a Realtime Database path (phone relay queue, host heartbeats, presence), e.g. 'relay/devices'. shallow:true returns only key names — use it first on a node you do not know the size of.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, shallow: { type: "boolean" } },
      required: ["path"], additionalProperties: false,
    },
  },
  {
    name: "rtdb_set",
    description: "WRITE a Realtime Database path. Requires confirm:true. Refuses the live relay command queue — a bad write there breaks phone messaging.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, data: {}, confirm: { type: "boolean" } },
      required: ["path", "data", "confirm"], additionalProperties: false,
    },
  },
  {
    name: "storage_list",
    description: "List Cloud Storage objects under a prefix, e.g. 'phone-media/'. Returns name, size, contentType, updated.",
    inputSchema: {
      type: "object",
      properties: { prefix: { type: "string" }, limit: { type: "number", minimum: 1, maximum: MAX_LIMIT } },
      additionalProperties: false,
    },
  },
  {
    name: "storage_read",
    description: "Read one Cloud Storage object: metadata always, plus a time-limited signed URL, plus the text itself when it is small and textual.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, maxBytes: { type: "number", minimum: 1, maximum: 200000 } },
      required: ["path"], additionalProperties: false,
    },
  },
  {
    name: "auth_get_user",
    description: "Look up a Firebase Auth user by uid or email. Returns profile and provider info, never a credential.",
    inputSchema: {
      type: "object",
      properties: { uid: { type: "string" }, email: { type: "string" } },
      additionalProperties: false,
    },
  },
];

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    return res.status(204).set(corsHeaders).end();
  }

  if (req.method === "GET") {
    const authProblem = authorize(req);
    const status = authProblem ? 401 : 200;
    return res.status(status).set({ ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }).json({
      name: "onetask-firestore-readonly",
      status: authProblem ? "locked" : "ready",
      project: FIREBASE_PROJECT_ID, userKey: USER_KEY, endpoint: "/mcp",
      tools: tools.map(t => t.name),
      auth: authProblem ? authProblem.message : "authorized",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).set({ ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }).json({ error: "Method not allowed" });
  }

  const authProblem = authorize(req);
  if (authProblem) {
    return res.status(401).set({ ...corsHeaders, "Content-Type": "application/json; charset=utf-8" })
      .json(rpcError(null, -32001, authProblem.message));
  }

  const payload = req.body;
  if (!payload) {
    return res.status(400).set({ ...corsHeaders, "Content-Type": "application/json; charset=utf-8" })
      .json(rpcError(null, -32700, "Parse error"));
  }

  const requests = Array.isArray(payload) ? payload : [payload];
  const responses = [];
  for (const item of requests) {
    const response = await handleRpc(item);
    if (response) responses.push(response);
  }

  const ct = { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" };
  if (Array.isArray(payload)) {
    return res.status(200).set(ct).json(responses);
  }
  if (responses[0]) return res.status(200).set(ct).json(responses[0]);
  return res.status(204).set(ct).end();
};

async function handleRpc(message) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return rpcError(message?.id ?? null, -32600, "Invalid Request");
  }
  const id = message.id;
  const isNotification = id === undefined || id === null;
  try {
    if (message.method === "initialize") {
      return isNotification ? null : rpcResult(id, {
        protocolVersion: message.params?.protocolVersion || "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "onetask-firestore-readonly", version: "1.0.0" },
      });
    }
    if (message.method === "notifications/initialized") return null;
    if (message.method === "ping") return isNotification ? null : rpcResult(id, {});
    if (message.method === "tools/list") return isNotification ? null : rpcResult(id, { tools });
    if (message.method === "tools/call") {
      const { name, arguments: args = {} } = message.params || {};
      if (!name || typeof name !== "string") return rpcError(id, -32602, "tools/call requires a tool name");
      const result = await callTool(name, args);
      return isNotification ? null : rpcResult(id, result);
    }
    return rpcError(id, -32601, `Method not found: ${message.method}`);
  } catch (error) {
    return rpcError(id ?? null, -32603, safeError(error));
  }
}

async function callTool(name, args) {
  switch (name) {
    case "list_tasks":         return toolResult(await listTasks(args));
    case "get_task":           return toolResult(await getTask(requiredString(args, "taskId")));
    case "search_tasks":       return toolResult(await searchTasks(args));
    case "list_shailos":       return toolResult(await listShailos(args));
    case "get_shaila":         return toolResult(await getShaila(requiredString(args, "shailaId")));
    case "search_shailos":     return toolResult(await searchShailos(args));
    case "get_settings":       return toolResult(await getConfigDoc("settings"));
    case "get_meta":           return toolResult(await getConfigDoc("meta"));
    case "get_legacy_app_state": return toolResult(await getLegacyAppState());
    case "list_bugs":          return toolResult(await listBugs(args));
    case "add_bug_note":       return toolResult(await addBugNote(requiredString(args, "bugId"), requiredString(args, "note")));
    case "set_bug_status":     return toolResult(await setBugStatus(requiredString(args, "bugId"), requiredString(args, "status"), args.note));
    case "firestore_get":      return toolResult(await firestoreGet(args));
    case "firestore_list":     return toolResult(await firestoreList(args));
    case "firestore_set":      return toolResult(await firestoreSet(args));
    case "firestore_delete":   return toolResult(await firestoreDelete(args));
    case "rtdb_get":           return toolResult(await rtdbGet(args));
    case "rtdb_set":           return toolResult(await rtdbSet(args));
    case "storage_list":       return toolResult(await storageList(args));
    case "storage_read":       return toolResult(await storageRead(args));
    case "auth_get_user":      return toolResult(await authGetUser(args));
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Bug Log tools ────────────────────────────────────────────────────────────
async function listBugs(args = {}) {
  const status = args.status || "unresolved";
  const col = userDoc().collection("bugs");
  const snap = status === "all" ? await col.get() : await col.where("status", "==", status).get();
  const bugs = snap.docs
    .map(doc => ({ id: doc.id, ...normalizeValue(doc.data()) }))
    .sort((a, b) => (Number(b.createdAtMs) || 0) - (Number(a.createdAtMs) || 0))
    .slice(0, Math.min(Math.max(Number(args.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT));
  return { source: `users/${USER_KEY}/bugs`, status, count: bugs.length, bugs };
}

async function addBugNote(bugId, note) {
  const ref = userDoc().collection("bugs").doc(bugId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`No bug with id ${bugId}`);
  const prior = Array.isArray(snap.data().notes) ? snap.data().notes : [];
  await ref.update({ notes: [...prior, { text: note, atMs: Date.now() }], updatedAtMs: Date.now() });
  return { source: `users/${USER_KEY}/bugs/${bugId}`, ok: true, noted: note };
}

async function setBugStatus(bugId, status, note) {
  const allowed = ["unresolved", "paused", "resolved", "future"];
  if (!allowed.includes(status)) throw new Error(`status must be one of ${allowed.join(", ")}`);
  const noteText = typeof note === "string" ? note.trim() : "";
  if (status === "resolved" && !noteText) throw new Error("Resolving a ticket requires a resolution note.");
  const ref = userDoc().collection("bugs").doc(bugId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`No bug with id ${bugId}`);
  const update = { status, updatedAtMs: Date.now() };
  if (noteText) {
    const prior = Array.isArray(snap.data().notes) ? snap.data().notes : [];
    update.notes = [...prior, { text: noteText, atMs: Date.now() }];
  }
  await ref.update(update);
  return { source: `users/${USER_KEY}/bugs/${bugId}`, ok: true, status, noted: noteText || null };
}

async function listTasks(args = {}) {
  const tasks = await readTaskList();
  const filtered = tasks
    .filter(t => args.completed === undefined || t.completed === args.completed)
    .filter(t => !args.priority || text(t.priority).toLowerCase() === args.priority.toLowerCase())
    .filter(t => !args.shailaId || t.shailaId === args.shailaId)
    .filter(t => inDateWindow(t.createdAt, args.createdAfter, args.createdBefore))
    .filter(t => inDateWindow(t.updatedAt, args.updatedAfter, args.updatedBefore));
  return { source: `users/${USER_KEY}/tasks`, count: filtered.length, tasks: sortAndLimit(filtered, args.sortBy || "updatedAt", args.sortDirection || "desc", args.limit) };
}

async function getTask(taskId) {
  const snap = await userDoc().collection("tasks").doc(taskId).get();
  return { source: `users/${USER_KEY}/tasks/${taskId}`, found: snap.exists, task: snap.exists ? normalizeTask(snap.id, snap.data()) : null };
}

async function searchTasks(args = {}) {
  const query = requiredString(args, "query").toLowerCase();
  const tasks = await readTaskList();
  const filtered = tasks
    .filter(t => args.completed === undefined || t.completed === args.completed)
    .filter(t => !args.priority || text(t.priority).toLowerCase() === args.priority.toLowerCase())
    .filter(t => searchableText(t).includes(query));
  return { source: `users/${USER_KEY}/tasks`, query: args.query, count: filtered.length, tasks: sortAndLimit(filtered, "updatedAt", "desc", args.limit) };
}

async function listShailos(args = {}) {
  const [shailos, taskLinks] = await Promise.all([readShailaList(), readTaskLinks()]);
  const filtered = shailos
    .map(s => ({ ...s, linkedTaskIds: taskLinks.get(s.id) || [] }))
    .filter(s => !args.status || s.status === args.status)
    .filter(s => !args.linkedOnly || s.linkedTaskIds.length > 0);
  return { source: `users/${USER_KEY}/shailos`, count: filtered.length, shailos: sortAndLimit(filtered, args.sortBy || "createdAt", args.sortDirection || "desc", args.limit) };
}

async function getShaila(shailaId) {
  const [snap, taskLinks] = await Promise.all([userDoc().collection("shailos").doc(shailaId).get(), readTaskLinks()]);
  return {
    source: `users/${USER_KEY}/shailos/${shailaId}`, found: snap.exists,
    shaila: snap.exists ? { ...normalizeShaila(snap.id, snap.data()), linkedTaskIds: taskLinks.get(snap.id) || [] } : null,
  };
}

async function searchShailos(args = {}) {
  const query = requiredString(args, "query").toLowerCase();
  const [shailos, taskLinks] = await Promise.all([readShailaList(), readTaskLinks()]);
  const filtered = shailos
    .map(s => ({ ...s, linkedTaskIds: taskLinks.get(s.id) || [] }))
    .filter(s => !args.status || s.status === args.status)
    .filter(s => searchableText(s).includes(query));
  return { source: `users/${USER_KEY}/shailos`, query: args.query, count: filtered.length, shailos: sortAndLimit(filtered, "createdAt", "desc", args.limit) };
}

async function getConfigDoc(docName) {
  const snap = await userDoc().collection("config").doc(docName).get();
  return { source: `users/${USER_KEY}/config/${docName}`, found: snap.exists, data: snap.exists ? normalizeValue(snap.data()) : null };
}

async function getLegacyAppState() {
  const snap = await userDoc().collection("appData").doc("appState_v4").get();
  return { source: `users/${USER_KEY}/appData/appState_v4`, found: snap.exists, data: snap.exists ? normalizeValue(snap.data()) : null };
}

async function readTaskList() {
  const snap = await userDoc().collection("tasks").get();
  return snap.docs.map(doc => normalizeTask(doc.id, doc.data()));
}

async function readShailaList() {
  const snap = await userDoc().collection("shailos").get();
  return snap.docs.map(doc => normalizeShaila(doc.id, doc.data()));
}

async function readTaskLinks() {
  const links = new Map();
  const tasks = await readTaskList();
  for (const task of tasks) {
    if (!task.shailaId) continue;
    const current = links.get(task.shailaId) || [];
    current.push(task.id);
    links.set(task.shailaId, current);
  }
  return links;
}

function normalizeTask(id, raw = {}) {
  const value = normalizeValue(raw);
  const title = firstText(value.title, value.text, value.content, value.name, value.label);
  const completed = Boolean(value.completed || value.done || value.status === "completed");
  return {
    id, title,
    text: firstText(value.text, value.content, value.notes, title),
    status: completed ? "completed" : "open", completed,
    priority: value.priority ?? value.importance ?? null,
    dueDate: firstText(value.dueDate, value.due, value.deadline) || null,
    createdAt: firstText(value.createdAt, value.created, value.dateCreated) || null,
    updatedAt: firstText(value.updatedAt, value._lastModified, value.modifiedAt, value.lastEditedAt) || null,
    shailaId: value.shailaId || value.linkedShailaId || null,
    listId: value.listId || value.columnId || null,
    parentTask: value.parentTask || value.parentId || null,
    blocked: Boolean(value.blocked), blockedReason: value.blockedReason || null, raw: value,
  };
}

function normalizeShaila(id, raw = {}) {
  const value = normalizeValue(raw);
  return {
    id,
    synopsis: firstText(value.synopsis, value.title, value.summary) || null,
    content: firstText(value.content, value.question, value.text) || null,
    status: value.status || null, date: firstText(value.date) || null,
    createdAt: firstText(value.createdAt, value.created) || null,
    updatedAt: firstText(value.updatedAt, value._lastModified, value.modifiedAt) || null,
    askerName: value.askerName || null, answer: firstText(value.answer) || null,
    answererName: value.answererName || null, parsedShaila: value.parsedShaila || null,
    linkedTaskIds: [], raw: value,
  };
}

// ── General Firebase tools ───────────────────────────────────────────────────
// One rule holds all of them together: READS go anywhere in the project, WRITES
// are fenced. The fence is here, in the repo, rather than in the token — a token
// is all-or-nothing and cannot say "not that path".

const WRITE_ROOT = `users/${USER_KEY}`;

function cleanPath(raw, kind) {
  const path = String(raw || "").trim().replace(/^\/+|\/+$/g, "");
  if (!path) throw new Error("path is required");
  if (path.includes("..")) throw new Error("path may not contain '..'");
  const depth = path.split("/").length;
  if (kind === "doc" && depth % 2 !== 0) {
    throw new Error(`'${path}' is a collection path (odd number of segments). Use firestore_list for collections.`);
  }
  if (kind === "collection" && depth % 2 === 0) {
    throw new Error(`'${path}' is a document path (even number of segments). Use firestore_get for documents.`);
  }
  return path;
}

// Writes are confined to the owner's own data. Everything the app stores lives
// under users/rabbidanziger, so this costs nothing real, and it means a confused
// session cannot reach another user's tree, a config collection, or a system
// document. Reads are deliberately NOT fenced: reading is recoverable.
function assertWritePath(path, confirm) {
  if (confirm !== true) throw new Error("This tool writes. Pass confirm:true once you are sure.");
  if (path !== WRITE_ROOT && !path.startsWith(`${WRITE_ROOT}/`)) {
    throw new Error(`Writes are limited to ${WRITE_ROOT}/**. Refused: ${path}`);
  }
}

async function firestoreGet(args = {}) {
  const path = cleanPath(args.path, "doc");
  const snap = await getAdminDb().doc(path).get();
  const out = { path, exists: snap.exists, data: snap.exists ? normalizeValue(snap.data()) : null };
  if (args.withSubcollections) {
    out.subcollections = (await getAdminDb().doc(path).listCollections()).map(c => c.id);
  }
  return out;
}

async function firestoreList(args = {}) {
  const path = cleanPath(args.path, "collection");
  const limit = Math.min(Math.max(Number(args.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  let query = getAdminDb().collection(path);
  for (const f of Array.isArray(args.where) ? args.where : []) {
    query = query.where(requiredString(f, "field"), requiredString(f, "op"), f.value);
  }
  if (args.orderBy) query = query.orderBy(args.orderBy, args.direction === "asc" ? "asc" : "desc");
  // The field mask is applied server-side when given, so a collection of hundreds
  // of fat documents comes back as hundreds of one-liners instead of megabytes.
  const fields = Array.isArray(args.fields) ? args.fields.filter(Boolean) : [];
  if (fields.length) query = query.select(...fields);
  const snap = await query.limit(limit).get();
  return {
    path, count: snap.size, limit,
    truncated: snap.size === limit,
    documents: snap.docs.map(d => ({ id: d.id, ...normalizeValue(d.data()) })),
  };
}

async function firestoreSet(args = {}) {
  const path = cleanPath(args.path, "doc");
  assertWritePath(path, args.confirm);
  const data = args.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("data must be an object");
  const merge = args.merge !== false;
  await getAdminDb().doc(path).set(data, { merge });
  return { path, ok: true, mode: merge ? "merge" : "replace", fields: Object.keys(data) };
}

async function firestoreDelete(args = {}) {
  const path = cleanPath(args.path, "doc");
  assertWritePath(path, args.confirm);
  // Deleting a document does NOT delete its subcollections in Firestore — they
  // become orphans that still cost storage and still answer queries. Refusing is
  // better than silently leaving them: the caller can empty them first.
  const subs = (await getAdminDb().doc(path).listCollections()).map(c => c.id);
  if (subs.length) {
    throw new Error(`'${path}' has subcollections (${subs.join(", ")}). Deleting the document would orphan them — delete their documents first.`);
  }
  await getAdminDb().doc(path).delete();
  return { path, ok: true, deleted: true };
}

// RTDB paths that must never be written from a session: the live command queue
// and the host presence tree. A malformed write to either stops phone messaging
// for real, and neither is something a coding session has a reason to author.
const RTDB_WRITE_DENY = [/^relay\/(commands|queue)(\/|$)/i, /^presence(\/|$)/i, /^hosts(\/|$)/i];

async function rtdbGet(args = {}) {
  const path = String(args.path || "").trim().replace(/^\/+|\/+$/g, "");
  if (!path) throw new Error("path is required");
  const ref = getAdminDatabase().ref(path);
  if (args.shallow) {
    // No shallow flag on the Admin SDK, so read keys and report only those. Still
    // the right first call on an unknown node: the ANSWER stays small even when
    // the node is not, which is what the caller is protecting against.
    const snap = await ref.get();
    const val = snap.val();
    if (val && typeof val === "object") return { path, shallow: true, keys: Object.keys(val), count: Object.keys(val).length };
    return { path, shallow: true, value: val };
  }
  const snap = await ref.get();
  return { path, exists: snap.exists(), value: snap.val() };
}

async function rtdbSet(args = {}) {
  const path = String(args.path || "").trim().replace(/^\/+|\/+$/g, "");
  if (!path) throw new Error("path is required");
  if (args.confirm !== true) throw new Error("This tool writes. Pass confirm:true once you are sure.");
  if (RTDB_WRITE_DENY.some(rx => rx.test(path))) {
    throw new Error(`'${path}' is live phone-link state and is not writable through this endpoint.`);
  }
  await getAdminDatabase().ref(path).set(args.data);
  return { path, ok: true };
}

function storageBucket() {
  const { getStorage } = require("firebase-admin/storage");
  return getStorage(getAdminApp()).bucket(`${FIREBASE_PROJECT_ID}.firebasestorage.app`);
}

async function storageList(args = {}) {
  const limit = Math.min(Math.max(Number(args.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const [files] = await storageBucket().getFiles({ prefix: args.prefix || undefined, maxResults: limit });
  return {
    prefix: args.prefix || "", count: files.length, truncated: files.length === limit,
    files: files.map(f => ({
      name: f.name, size: Number(f.metadata?.size) || 0,
      contentType: f.metadata?.contentType || null, updated: f.metadata?.updated || null,
    })),
  };
}

async function storageRead(args = {}) {
  const path = String(args.path || "").trim().replace(/^\/+/, "");
  if (!path) throw new Error("path is required");
  const file = storageBucket().file(path);
  const [exists] = await file.exists();
  if (!exists) return { path, exists: false };
  const [meta] = await file.getMetadata();
  const size = Number(meta.size) || 0;
  const contentType = meta.contentType || "";
  const [url] = await file.getSignedUrl({ action: "read", expires: Date.now() + 60 * 60 * 1000 });
  const out = { path, exists: true, size, contentType, updated: meta.updated || null, signedUrl: url, signedUrlExpiresInMinutes: 60 };
  const maxBytes = Math.min(Number(args.maxBytes) || 40000, 200000);
  const textual = /^(text\/|application\/(json|xml|javascript|x-ndjson))/i.test(contentType);
  if (textual && size > 0 && size <= maxBytes) {
    const [buf] = await file.download();
    out.text = buf.toString("utf8");
  } else if (textual) {
    out.textOmitted = `file is ${size} bytes, over maxBytes ${maxBytes}`;
  }
  return out;
}

async function authGetUser(args = {}) {
  const auth = getAdminAuth();
  const user = args.uid ? await auth.getUser(String(args.uid).trim())
    : args.email ? await auth.getUserByEmail(String(args.email).trim())
    : (() => { throw new Error("pass uid or email"); })();
  return {
    uid: user.uid, email: user.email || null, emailVerified: user.emailVerified,
    displayName: user.displayName || null, disabled: user.disabled,
    created: user.metadata?.creationTime || null, lastSignIn: user.metadata?.lastSignInTime || null,
    providers: (user.providerData || []).map(p => p.providerId),
  };
}

function normalizeValue(value) {
  if (value == null) return value;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeValue(v)]));
  return value;
}

function userDoc() {
  return getAdminDb().collection("users").doc(USER_KEY);
}

function authorize(req) {
  const expected = process.env.MCP_READ_TOKEN;
  const allowOpen = process.env.MCP_ALLOW_UNAUTHENTICATED_READS === "true";
  if (!expected && !allowOpen) return new Error("MCP_READ_TOKEN is required before this endpoint will serve data.");
  if (allowOpen && !expected) return null;
  const authorization = req.headers.authorization || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== expected) return new Error("Unauthorized MCP request.");
  return null;
}

function requiredString(args, key) {
  const value = args?.[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing required string argument: ${key}`);
  return value.trim();
}

function sortAndLimit(items, sortBy, direction, limit) {
  const cappedLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const multiplier = direction === "asc" ? 1 : -1;
  return [...items].sort((a, b) => compareValues(a[sortBy], b[sortBy]) * multiplier).slice(0, cappedLimit);
}

function compareValues(a, b) {
  const left = comparable(a), right = comparable(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function comparable(value) {
  if (value == null || value === "") return "";
  const time = Date.parse(value);
  return Number.isNaN(time) ? String(value).toLowerCase() : time;
}

function inDateWindow(value, after, before) {
  if (!after && !before) return true;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return false;
  if (after && time < Date.parse(after)) return false;
  if (before && time > Date.parse(before)) return false;
  return true;
}

function searchableText(value) {
  return JSON.stringify(value ?? "").toLowerCase();
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value !== null && value !== undefined && typeof value !== "object") return String(value);
  }
  return "";
}

function text(value) { return value == null ? "" : String(value); }

function toolResult(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
}

function rpcResult(id, result) { return { jsonrpc: "2.0", id, result }; }
function rpcError(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/g, "[redacted private key]");
}
