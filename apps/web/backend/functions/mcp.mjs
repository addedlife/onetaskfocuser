import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export const config = {
  path: "/mcp",
};

const PROJECT_ID = "onetaskonly-app";
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
        completed: { type: "boolean" },
        priority: { type: "string" },
        shailaId: { type: "string" },
        createdAfter: { type: "string" },
        createdBefore: { type: "string" },
        updatedAfter: { type: "string" },
        updatedBefore: { type: "string" },
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
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
      additionalProperties: false,
    },
  },
  {
    name: "search_tasks",
    description: "Search OneTask tasks by plain text across title, content, notes, and shaila linkage.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        completed: { type: "boolean" },
        priority: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "list_shailos",
    description: "List shailos for rabbidanziger, with optional status filtering and sorting.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "answered", "got_back"] },
        linkedOnly: { type: "boolean" },
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
    inputSchema: {
      type: "object",
      properties: { shailaId: { type: "string" } },
      required: ["shailaId"],
      additionalProperties: false,
    },
  },
  {
    name: "search_shailos",
    description: "Search shailos by plain text across synopsis, content, asker, answer, and parsed fields.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        status: { type: "string", enum: ["pending", "answered", "got_back"] },
        limit: { type: "number", minimum: 1, maximum: MAX_LIMIT },
      },
      required: ["query"],
      additionalProperties: false,
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
];

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method === "GET") {
    const authProblem = authorize(request);
    return json({
      name: "onetask-firestore-readonly",
      status: authProblem ? "locked" : "ready",
      project: PROJECT_ID,
      userKey: USER_KEY,
      endpoint: "/mcp",
      tools: tools.map((tool) => tool.name),
      auth: authProblem ? authProblem.message : "authorized",
    }, authProblem ? 401 : 200);
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authProblem = authorize(request);
  if (authProblem) {
    return jsonRpcError(null, -32001, authProblem.message, 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonRpcError(null, -32700, "Parse error", 400);
  }

  const requests = Array.isArray(payload) ? payload : [payload];
  const responses = [];
  for (const item of requests) {
    const response = await handleRpc(item);
    if (response) responses.push(response);
  }

  if (Array.isArray(payload)) {
    return json(responses);
  }

  return responses[0] ? json(responses[0]) : new Response(null, { status: 204, headers: corsHeaders });
}

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

    if (message.method === "notifications/initialized") {
      return null;
    }

    if (message.method === "ping") {
      return isNotification ? null : rpcResult(id, {});
    }

    if (message.method === "tools/list") {
      return isNotification ? null : rpcResult(id, { tools });
    }

    if (message.method === "tools/call") {
      const { name, arguments: args = {} } = message.params || {};
      if (!name || typeof name !== "string") {
        return rpcError(id, -32602, "tools/call requires a tool name");
      }
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
    case "list_tasks":
      return toolResult(await listTasks(args));
    case "get_task":
      return toolResult(await getTask(requiredString(args, "taskId")));
    case "search_tasks":
      return toolResult(await searchTasks(args));
    case "list_shailos":
      return toolResult(await listShailos(args));
    case "get_shaila":
      return toolResult(await getShaila(requiredString(args, "shailaId")));
    case "search_shailos":
      return toolResult(await searchShailos(args));
    case "get_settings":
      return toolResult(await getConfigDoc("settings"));
    case "get_meta":
      return toolResult(await getConfigDoc("meta"));
    case "get_legacy_app_state":
      return toolResult(await getLegacyAppState());
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function listTasks(args = {}) {
  const tasks = await readTaskList();
  const filtered = tasks
    .filter((task) => args.completed === undefined || task.completed === args.completed)
    .filter((task) => !args.priority || text(task.priority).toLowerCase() === args.priority.toLowerCase())
    .filter((task) => !args.shailaId || task.shailaId === args.shailaId)
    .filter((task) => inDateWindow(task.createdAt, args.createdAfter, args.createdBefore))
    .filter((task) => inDateWindow(task.updatedAt, args.updatedAfter, args.updatedBefore));

  return {
    source: `users/${USER_KEY}/tasks`,
    count: filtered.length,
    tasks: sortAndLimit(filtered, args.sortBy || "updatedAt", args.sortDirection || "desc", args.limit),
  };
}

async function getTask(taskId) {
  const snap = await userDoc().collection("tasks").doc(taskId).get();
  return {
    source: `users/${USER_KEY}/tasks/${taskId}`,
    found: snap.exists,
    task: snap.exists ? normalizeTask(snap.id, snap.data()) : null,
  };
}

async function searchTasks(args = {}) {
  const query = requiredString(args, "query").toLowerCase();
  const tasks = await readTaskList();
  const filtered = tasks
    .filter((task) => args.completed === undefined || task.completed === args.completed)
    .filter((task) => !args.priority || text(task.priority).toLowerCase() === args.priority.toLowerCase())
    .filter((task) => searchableText(task).includes(query));

  return {
    source: `users/${USER_KEY}/tasks`,
    query: args.query,
    count: filtered.length,
    tasks: sortAndLimit(filtered, "updatedAt", "desc", args.limit),
  };
}

async function listShailos(args = {}) {
  const [shailos, taskLinks] = await Promise.all([readShailaList(), readTaskLinks()]);
  const filtered = shailos
    .map((shaila) => ({ ...shaila, linkedTaskIds: taskLinks.get(shaila.id) || [] }))
    .filter((shaila) => !args.status || shaila.status === args.status)
    .filter((shaila) => !args.linkedOnly || shaila.linkedTaskIds.length > 0);

  return {
    source: `users/${USER_KEY}/shailos`,
    count: filtered.length,
    shailos: sortAndLimit(filtered, args.sortBy || "createdAt", args.sortDirection || "desc", args.limit),
  };
}

async function getShaila(shailaId) {
  const [snap, taskLinks] = await Promise.all([
    userDoc().collection("shailos").doc(shailaId).get(),
    readTaskLinks(),
  ]);
  return {
    source: `users/${USER_KEY}/shailos/${shailaId}`,
    found: snap.exists,
    shaila: snap.exists
      ? { ...normalizeShaila(snap.id, snap.data()), linkedTaskIds: taskLinks.get(snap.id) || [] }
      : null,
  };
}

async function searchShailos(args = {}) {
  const query = requiredString(args, "query").toLowerCase();
  const [shailos, taskLinks] = await Promise.all([readShailaList(), readTaskLinks()]);
  const filtered = shailos
    .map((shaila) => ({ ...shaila, linkedTaskIds: taskLinks.get(shaila.id) || [] }))
    .filter((shaila) => !args.status || shaila.status === args.status)
    .filter((shaila) => searchableText(shaila).includes(query));

  return {
    source: `users/${USER_KEY}/shailos`,
    query: args.query,
    count: filtered.length,
    shailos: sortAndLimit(filtered, "createdAt", "desc", args.limit),
  };
}

async function getConfigDoc(docName) {
  const snap = await userDoc().collection("config").doc(docName).get();
  return {
    source: `users/${USER_KEY}/config/${docName}`,
    found: snap.exists,
    data: snap.exists ? normalizeValue(snap.data()) : null,
  };
}

async function getLegacyAppState() {
  const snap = await userDoc().collection("appData").doc("appState_v4").get();
  return {
    source: `users/${USER_KEY}/appData/appState_v4`,
    found: snap.exists,
    data: snap.exists ? normalizeValue(snap.data()) : null,
  };
}

async function readTaskList() {
  const snap = await userDoc().collection("tasks").get();
  return snap.docs.map((doc) => normalizeTask(doc.id, doc.data()));
}

async function readShailaList() {
  const snap = await userDoc().collection("shailos").get();
  return snap.docs.map((doc) => normalizeShaila(doc.id, doc.data()));
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
    id,
    title,
    text: firstText(value.text, value.content, value.notes, title),
    status: completed ? "completed" : "open",
    completed,
    priority: value.priority ?? value.importance ?? null,
    dueDate: firstText(value.dueDate, value.due, value.deadline) || null,
    createdAt: firstText(value.createdAt, value.created, value.dateCreated) || null,
    updatedAt: firstText(value.updatedAt, value._lastModified, value.modifiedAt, value.lastEditedAt) || null,
    shailaId: value.shailaId || value.linkedShailaId || null,
    listId: value.listId || value.columnId || null,
    parentTask: value.parentTask || value.parentId || null,
    blocked: Boolean(value.blocked),
    blockedReason: value.blockedReason || null,
    raw: value,
  };
}

function normalizeShaila(id, raw = {}) {
  const value = normalizeValue(raw);
  return {
    id,
    synopsis: firstText(value.synopsis, value.title, value.summary) || null,
    content: firstText(value.content, value.question, value.text) || null,
    status: value.status || null,
    date: firstText(value.date) || null,
    createdAt: firstText(value.createdAt, value.created) || null,
    updatedAt: firstText(value.updatedAt, value._lastModified, value.modifiedAt) || null,
    askerName: value.askerName || null,
    answer: firstText(value.answer) || null,
    answererName: value.answererName || null,
    parsedShaila: value.parsedShaila || null,
    linkedTaskIds: [],
    raw: value,
  };
}

function normalizeValue(value) {
  if (value == null) return value;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeValue(item)]));
  }
  return value;
}

function userDoc() {
  return db().collection("users").doc(USER_KEY);
}

function db() {
  if (!getApps().length) {
    initializeApp({ credential: cert(serviceAccount()), projectId: PROJECT_ID });
  }
  return getFirestore();
}

function serviceAccount() {
  const rawJson = env("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (rawJson) {
    const parsed = JSON.parse(rawJson);
    if (parsed.project_id !== PROJECT_ID) {
      throw new Error("Configured Firebase service account is not scoped to onetaskonly-app.");
    }
    return parsed;
  }

  const projectId = env("FIREBASE_PROJECT_ID");
  const clientEmail = env("FIREBASE_CLIENT_EMAIL");
  const privateKey = env("FIREBASE_PRIVATE_KEY")?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase service account is not configured.");
  }
  if (projectId !== PROJECT_ID) {
    throw new Error("Configured Firebase project is not onetaskonly-app.");
  }
  return { projectId, clientEmail, privateKey };
}

function authorize(request) {
  const expected = env("MCP_READ_TOKEN");
  const allowOpen = env("MCP_ALLOW_UNAUTHENTICATED_READS") === "true";
  if (!expected && !allowOpen) {
    return new Error("MCP_READ_TOKEN is required before this endpoint will serve data.");
  }
  if (allowOpen && !expected) return null;

  const authorization = request.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== expected) {
    return new Error("Unauthorized MCP request.");
  }
  return null;
}

function env(name) {
  return globalThis.Netlify?.env?.get?.(name) ?? process.env[name];
}

function requiredString(args, key) {
  const value = args?.[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required string argument: ${key}`);
  }
  return value.trim();
}

function sortAndLimit(items, sortBy, direction, limit) {
  const cappedLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const multiplier = direction === "asc" ? 1 : -1;
  return [...items]
    .sort((a, b) => compareValues(a[sortBy], b[sortBy]) * multiplier)
    .slice(0, cappedLimit);
}

function compareValues(a, b) {
  const left = comparable(a);
  const right = comparable(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
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

function text(value) {
  return value == null ? "" : String(value);
}

function toolResult(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function jsonRpcError(id, code, message, status) {
  return json(rpcError(id, code, message), status);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/g, "[redacted private key]");
}
