
import {createRequire as ___nfyCreateRequire} from "module";
import {fileURLToPath as ___nfyFileURLToPath} from "url";
import {dirname as ___nfyPathDirname} from "path";
let __filename=___nfyFileURLToPath(import.meta.url);
let __dirname=___nfyPathDirname(___nfyFileURLToPath(import.meta.url));
let require=___nfyCreateRequire(import.meta.url);


// backend/functions/mcp.mjs
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
var config = {
  path: "/mcp"
};
var PROJECT_ID = "onetaskonly-app";
var USER_KEY = "rabbidanziger";
var DEFAULT_LIMIT = 50;
var MAX_LIMIT = 200;
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version",
  "Access-Control-Expose-Headers": "mcp-protocol-version",
  "MCP-Protocol-Version": "2025-11-25"
};
var tools = [
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
        limit: { type: "number", minimum: 1, maximum: MAX_LIMIT }
      },
      additionalProperties: false
    }
  },
  {
    name: "get_task",
    description: "Get one OneTask task by taskId.",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
      additionalProperties: false
    }
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
        limit: { type: "number", minimum: 1, maximum: MAX_LIMIT }
      },
      required: ["query"],
      additionalProperties: false
    }
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
        limit: { type: "number", minimum: 1, maximum: MAX_LIMIT }
      },
      additionalProperties: false
    }
  },
  {
    name: "get_shaila",
    description: "Get one shaila by shailaId.",
    inputSchema: {
      type: "object",
      properties: { shailaId: { type: "string" } },
      required: ["shailaId"],
      additionalProperties: false
    }
  },
  {
    name: "search_shailos",
    description: "Search shailos by plain text across synopsis, content, asker, answer, and parsed fields.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        status: { type: "string", enum: ["pending", "answered", "got_back"] },
        limit: { type: "number", minimum: 1, maximum: MAX_LIMIT }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "get_settings",
    description: "Get OneTask settings from users/rabbidanziger/config/settings.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "get_meta",
    description: "Get OneTask metadata from users/rabbidanziger/config/meta.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "get_legacy_app_state",
    description: "Get the legacy backup blob at users/rabbidanziger/appData/appState_v4.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  }
];
async function handler(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method === "GET") {
    const authProblem2 = authorize(request);
    return json({
      name: "onetask-firestore-readonly",
      status: authProblem2 ? "locked" : "ready",
      project: PROJECT_ID,
      userKey: USER_KEY,
      endpoint: "/mcp",
      tools: tools.map((tool) => tool.name),
      auth: authProblem2 ? authProblem2.message : "authorized"
    }, authProblem2 ? 401 : 200);
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
  const isNotification = id === void 0 || id === null;
  try {
    if (message.method === "initialize") {
      return isNotification ? null : rpcResult(id, {
        protocolVersion: message.params?.protocolVersion || "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "onetask-firestore-readonly", version: "1.0.0" }
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
  const filtered = tasks.filter((task) => args.completed === void 0 || task.completed === args.completed).filter((task) => !args.priority || text(task.priority).toLowerCase() === args.priority.toLowerCase()).filter((task) => !args.shailaId || task.shailaId === args.shailaId).filter((task) => inDateWindow(task.createdAt, args.createdAfter, args.createdBefore)).filter((task) => inDateWindow(task.updatedAt, args.updatedAfter, args.updatedBefore));
  return {
    source: `users/${USER_KEY}/tasks`,
    count: filtered.length,
    tasks: sortAndLimit(filtered, args.sortBy || "updatedAt", args.sortDirection || "desc", args.limit)
  };
}
async function getTask(taskId) {
  const snap = await userDoc().collection("tasks").doc(taskId).get();
  return {
    source: `users/${USER_KEY}/tasks/${taskId}`,
    found: snap.exists,
    task: snap.exists ? normalizeTask(snap.id, snap.data()) : null
  };
}
async function searchTasks(args = {}) {
  const query = requiredString(args, "query").toLowerCase();
  const tasks = await readTaskList();
  const filtered = tasks.filter((task) => args.completed === void 0 || task.completed === args.completed).filter((task) => !args.priority || text(task.priority).toLowerCase() === args.priority.toLowerCase()).filter((task) => searchableText(task).includes(query));
  return {
    source: `users/${USER_KEY}/tasks`,
    query: args.query,
    count: filtered.length,
    tasks: sortAndLimit(filtered, "updatedAt", "desc", args.limit)
  };
}
async function listShailos(args = {}) {
  const [shailos, taskLinks] = await Promise.all([readShailaList(), readTaskLinks()]);
  const filtered = shailos.map((shaila) => ({ ...shaila, linkedTaskIds: taskLinks.get(shaila.id) || [] })).filter((shaila) => !args.status || shaila.status === args.status).filter((shaila) => !args.linkedOnly || shaila.linkedTaskIds.length > 0);
  return {
    source: `users/${USER_KEY}/shailos`,
    count: filtered.length,
    shailos: sortAndLimit(filtered, args.sortBy || "createdAt", args.sortDirection || "desc", args.limit)
  };
}
async function getShaila(shailaId) {
  const [snap, taskLinks] = await Promise.all([
    userDoc().collection("shailos").doc(shailaId).get(),
    readTaskLinks()
  ]);
  return {
    source: `users/${USER_KEY}/shailos/${shailaId}`,
    found: snap.exists,
    shaila: snap.exists ? { ...normalizeShaila(snap.id, snap.data()), linkedTaskIds: taskLinks.get(snap.id) || [] } : null
  };
}
async function searchShailos(args = {}) {
  const query = requiredString(args, "query").toLowerCase();
  const [shailos, taskLinks] = await Promise.all([readShailaList(), readTaskLinks()]);
  const filtered = shailos.map((shaila) => ({ ...shaila, linkedTaskIds: taskLinks.get(shaila.id) || [] })).filter((shaila) => !args.status || shaila.status === args.status).filter((shaila) => searchableText(shaila).includes(query));
  return {
    source: `users/${USER_KEY}/shailos`,
    query: args.query,
    count: filtered.length,
    shailos: sortAndLimit(filtered, "createdAt", "desc", args.limit)
  };
}
async function getConfigDoc(docName) {
  const snap = await userDoc().collection("config").doc(docName).get();
  return {
    source: `users/${USER_KEY}/config/${docName}`,
    found: snap.exists,
    data: snap.exists ? normalizeValue(snap.data()) : null
  };
}
async function getLegacyAppState() {
  const snap = await userDoc().collection("appData").doc("appState_v4").get();
  return {
    source: `users/${USER_KEY}/appData/appState_v4`,
    found: snap.exists,
    data: snap.exists ? normalizeValue(snap.data()) : null
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
  const links = /* @__PURE__ */ new Map();
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
    raw: value
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
    raw: value
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
  return [...items].sort((a, b) => compareValues(a[sortBy], b[sortBy]) * multiplier).slice(0, cappedLimit);
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
    if (value !== null && value !== void 0 && typeof value !== "object") return String(value);
  }
  return "";
}
function text(value) {
  return value == null ? "" : String(value);
}
function toolResult(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload
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
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/g, "[redacted private key]");
}
export {
  config,
  handler as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiYmFja2VuZC9mdW5jdGlvbnMvbWNwLm1qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHsgY2VydCwgZ2V0QXBwcywgaW5pdGlhbGl6ZUFwcCB9IGZyb20gXCJmaXJlYmFzZS1hZG1pbi9hcHBcIjtcclxuaW1wb3J0IHsgZ2V0RmlyZXN0b3JlIH0gZnJvbSBcImZpcmViYXNlLWFkbWluL2ZpcmVzdG9yZVwiO1xyXG5cclxuZXhwb3J0IGNvbnN0IGNvbmZpZyA9IHtcclxuICBwYXRoOiBcIi9tY3BcIixcclxufTtcclxuXHJcbmNvbnN0IFBST0pFQ1RfSUQgPSBcIm9uZXRhc2tvbmx5LWFwcFwiO1xyXG5jb25zdCBVU0VSX0tFWSA9IFwicmFiYmlkYW56aWdlclwiO1xyXG5jb25zdCBERUZBVUxUX0xJTUlUID0gNTA7XHJcbmNvbnN0IE1BWF9MSU1JVCA9IDIwMDtcclxuXHJcbmNvbnN0IGNvcnNIZWFkZXJzID0ge1xyXG4gIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luXCI6IFwiKlwiLFxyXG4gIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kc1wiOiBcIkdFVCwgUE9TVCwgT1BUSU9OU1wiLFxyXG4gIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVyc1wiOiBcImF1dGhvcml6YXRpb24sIGNvbnRlbnQtdHlwZSwgbWNwLXByb3RvY29sLXZlcnNpb25cIixcclxuICBcIkFjY2Vzcy1Db250cm9sLUV4cG9zZS1IZWFkZXJzXCI6IFwibWNwLXByb3RvY29sLXZlcnNpb25cIixcclxuICBcIk1DUC1Qcm90b2NvbC1WZXJzaW9uXCI6IFwiMjAyNS0xMS0yNVwiLFxyXG59O1xyXG5cclxuY29uc3QgdG9vbHMgPSBbXHJcbiAge1xyXG4gICAgbmFtZTogXCJsaXN0X3Rhc2tzXCIsXHJcbiAgICBkZXNjcmlwdGlvbjogXCJMaXN0IE9uZVRhc2sgdGFza3MgZm9yIHJhYmJpZGFuemlnZXIsIHdpdGggb3B0aW9uYWwgcmVhZC1vbmx5IGZpbHRlcmluZyBhbmQgc29ydGluZy5cIixcclxuICAgIGlucHV0U2NoZW1hOiB7XHJcbiAgICAgIHR5cGU6IFwib2JqZWN0XCIsXHJcbiAgICAgIHByb3BlcnRpZXM6IHtcclxuICAgICAgICBjb21wbGV0ZWQ6IHsgdHlwZTogXCJib29sZWFuXCIgfSxcclxuICAgICAgICBwcmlvcml0eTogeyB0eXBlOiBcInN0cmluZ1wiIH0sXHJcbiAgICAgICAgc2hhaWxhSWQ6IHsgdHlwZTogXCJzdHJpbmdcIiB9LFxyXG4gICAgICAgIGNyZWF0ZWRBZnRlcjogeyB0eXBlOiBcInN0cmluZ1wiIH0sXHJcbiAgICAgICAgY3JlYXRlZEJlZm9yZTogeyB0eXBlOiBcInN0cmluZ1wiIH0sXHJcbiAgICAgICAgdXBkYXRlZEFmdGVyOiB7IHR5cGU6IFwic3RyaW5nXCIgfSxcclxuICAgICAgICB1cGRhdGVkQmVmb3JlOiB7IHR5cGU6IFwic3RyaW5nXCIgfSxcclxuICAgICAgICBzb3J0Qnk6IHsgdHlwZTogXCJzdHJpbmdcIiwgZW51bTogW1wiY3JlYXRlZEF0XCIsIFwidXBkYXRlZEF0XCIsIFwicHJpb3JpdHlcIiwgXCJ0aXRsZVwiXSB9LFxyXG4gICAgICAgIHNvcnREaXJlY3Rpb246IHsgdHlwZTogXCJzdHJpbmdcIiwgZW51bTogW1wiYXNjXCIsIFwiZGVzY1wiXSB9LFxyXG4gICAgICAgIGxpbWl0OiB7IHR5cGU6IFwibnVtYmVyXCIsIG1pbmltdW06IDEsIG1heGltdW06IE1BWF9MSU1JVCB9LFxyXG4gICAgICB9LFxyXG4gICAgICBhZGRpdGlvbmFsUHJvcGVydGllczogZmFsc2UsXHJcbiAgICB9LFxyXG4gIH0sXHJcbiAge1xyXG4gICAgbmFtZTogXCJnZXRfdGFza1wiLFxyXG4gICAgZGVzY3JpcHRpb246IFwiR2V0IG9uZSBPbmVUYXNrIHRhc2sgYnkgdGFza0lkLlwiLFxyXG4gICAgaW5wdXRTY2hlbWE6IHtcclxuICAgICAgdHlwZTogXCJvYmplY3RcIixcclxuICAgICAgcHJvcGVydGllczogeyB0YXNrSWQ6IHsgdHlwZTogXCJzdHJpbmdcIiB9IH0sXHJcbiAgICAgIHJlcXVpcmVkOiBbXCJ0YXNrSWRcIl0sXHJcbiAgICAgIGFkZGl0aW9uYWxQcm9wZXJ0aWVzOiBmYWxzZSxcclxuICAgIH0sXHJcbiAgfSxcclxuICB7XHJcbiAgICBuYW1lOiBcInNlYXJjaF90YXNrc1wiLFxyXG4gICAgZGVzY3JpcHRpb246IFwiU2VhcmNoIE9uZVRhc2sgdGFza3MgYnkgcGxhaW4gdGV4dCBhY3Jvc3MgdGl0bGUsIGNvbnRlbnQsIG5vdGVzLCBhbmQgc2hhaWxhIGxpbmthZ2UuXCIsXHJcbiAgICBpbnB1dFNjaGVtYToge1xyXG4gICAgICB0eXBlOiBcIm9iamVjdFwiLFxyXG4gICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgcXVlcnk6IHsgdHlwZTogXCJzdHJpbmdcIiB9LFxyXG4gICAgICAgIGNvbXBsZXRlZDogeyB0eXBlOiBcImJvb2xlYW5cIiB9LFxyXG4gICAgICAgIHByaW9yaXR5OiB7IHR5cGU6IFwic3RyaW5nXCIgfSxcclxuICAgICAgICBsaW1pdDogeyB0eXBlOiBcIm51bWJlclwiLCBtaW5pbXVtOiAxLCBtYXhpbXVtOiBNQVhfTElNSVQgfSxcclxuICAgICAgfSxcclxuICAgICAgcmVxdWlyZWQ6IFtcInF1ZXJ5XCJdLFxyXG4gICAgICBhZGRpdGlvbmFsUHJvcGVydGllczogZmFsc2UsXHJcbiAgICB9LFxyXG4gIH0sXHJcbiAge1xyXG4gICAgbmFtZTogXCJsaXN0X3NoYWlsb3NcIixcclxuICAgIGRlc2NyaXB0aW9uOiBcIkxpc3Qgc2hhaWxvcyBmb3IgcmFiYmlkYW56aWdlciwgd2l0aCBvcHRpb25hbCBzdGF0dXMgZmlsdGVyaW5nIGFuZCBzb3J0aW5nLlwiLFxyXG4gICAgaW5wdXRTY2hlbWE6IHtcclxuICAgICAgdHlwZTogXCJvYmplY3RcIixcclxuICAgICAgcHJvcGVydGllczoge1xyXG4gICAgICAgIHN0YXR1czogeyB0eXBlOiBcInN0cmluZ1wiLCBlbnVtOiBbXCJwZW5kaW5nXCIsIFwiYW5zd2VyZWRcIiwgXCJnb3RfYmFja1wiXSB9LFxyXG4gICAgICAgIGxpbmtlZE9ubHk6IHsgdHlwZTogXCJib29sZWFuXCIgfSxcclxuICAgICAgICBzb3J0Qnk6IHsgdHlwZTogXCJzdHJpbmdcIiwgZW51bTogW1wiY3JlYXRlZEF0XCIsIFwidXBkYXRlZEF0XCIsIFwiZGF0ZVwiLCBcInN0YXR1c1wiXSB9LFxyXG4gICAgICAgIHNvcnREaXJlY3Rpb246IHsgdHlwZTogXCJzdHJpbmdcIiwgZW51bTogW1wiYXNjXCIsIFwiZGVzY1wiXSB9LFxyXG4gICAgICAgIGxpbWl0OiB7IHR5cGU6IFwibnVtYmVyXCIsIG1pbmltdW06IDEsIG1heGltdW06IE1BWF9MSU1JVCB9LFxyXG4gICAgICB9LFxyXG4gICAgICBhZGRpdGlvbmFsUHJvcGVydGllczogZmFsc2UsXHJcbiAgICB9LFxyXG4gIH0sXHJcbiAge1xyXG4gICAgbmFtZTogXCJnZXRfc2hhaWxhXCIsXHJcbiAgICBkZXNjcmlwdGlvbjogXCJHZXQgb25lIHNoYWlsYSBieSBzaGFpbGFJZC5cIixcclxuICAgIGlucHV0U2NoZW1hOiB7XHJcbiAgICAgIHR5cGU6IFwib2JqZWN0XCIsXHJcbiAgICAgIHByb3BlcnRpZXM6IHsgc2hhaWxhSWQ6IHsgdHlwZTogXCJzdHJpbmdcIiB9IH0sXHJcbiAgICAgIHJlcXVpcmVkOiBbXCJzaGFpbGFJZFwiXSxcclxuICAgICAgYWRkaXRpb25hbFByb3BlcnRpZXM6IGZhbHNlLFxyXG4gICAgfSxcclxuICB9LFxyXG4gIHtcclxuICAgIG5hbWU6IFwic2VhcmNoX3NoYWlsb3NcIixcclxuICAgIGRlc2NyaXB0aW9uOiBcIlNlYXJjaCBzaGFpbG9zIGJ5IHBsYWluIHRleHQgYWNyb3NzIHN5bm9wc2lzLCBjb250ZW50LCBhc2tlciwgYW5zd2VyLCBhbmQgcGFyc2VkIGZpZWxkcy5cIixcclxuICAgIGlucHV0U2NoZW1hOiB7XHJcbiAgICAgIHR5cGU6IFwib2JqZWN0XCIsXHJcbiAgICAgIHByb3BlcnRpZXM6IHtcclxuICAgICAgICBxdWVyeTogeyB0eXBlOiBcInN0cmluZ1wiIH0sXHJcbiAgICAgICAgc3RhdHVzOiB7IHR5cGU6IFwic3RyaW5nXCIsIGVudW06IFtcInBlbmRpbmdcIiwgXCJhbnN3ZXJlZFwiLCBcImdvdF9iYWNrXCJdIH0sXHJcbiAgICAgICAgbGltaXQ6IHsgdHlwZTogXCJudW1iZXJcIiwgbWluaW11bTogMSwgbWF4aW11bTogTUFYX0xJTUlUIH0sXHJcbiAgICAgIH0sXHJcbiAgICAgIHJlcXVpcmVkOiBbXCJxdWVyeVwiXSxcclxuICAgICAgYWRkaXRpb25hbFByb3BlcnRpZXM6IGZhbHNlLFxyXG4gICAgfSxcclxuICB9LFxyXG4gIHtcclxuICAgIG5hbWU6IFwiZ2V0X3NldHRpbmdzXCIsXHJcbiAgICBkZXNjcmlwdGlvbjogXCJHZXQgT25lVGFzayBzZXR0aW5ncyBmcm9tIHVzZXJzL3JhYmJpZGFuemlnZXIvY29uZmlnL3NldHRpbmdzLlwiLFxyXG4gICAgaW5wdXRTY2hlbWE6IHsgdHlwZTogXCJvYmplY3RcIiwgcHJvcGVydGllczoge30sIGFkZGl0aW9uYWxQcm9wZXJ0aWVzOiBmYWxzZSB9LFxyXG4gIH0sXHJcbiAge1xyXG4gICAgbmFtZTogXCJnZXRfbWV0YVwiLFxyXG4gICAgZGVzY3JpcHRpb246IFwiR2V0IE9uZVRhc2sgbWV0YWRhdGEgZnJvbSB1c2Vycy9yYWJiaWRhbnppZ2VyL2NvbmZpZy9tZXRhLlwiLFxyXG4gICAgaW5wdXRTY2hlbWE6IHsgdHlwZTogXCJvYmplY3RcIiwgcHJvcGVydGllczoge30sIGFkZGl0aW9uYWxQcm9wZXJ0aWVzOiBmYWxzZSB9LFxyXG4gIH0sXHJcbiAge1xyXG4gICAgbmFtZTogXCJnZXRfbGVnYWN5X2FwcF9zdGF0ZVwiLFxyXG4gICAgZGVzY3JpcHRpb246IFwiR2V0IHRoZSBsZWdhY3kgYmFja3VwIGJsb2IgYXQgdXNlcnMvcmFiYmlkYW56aWdlci9hcHBEYXRhL2FwcFN0YXRlX3Y0LlwiLFxyXG4gICAgaW5wdXRTY2hlbWE6IHsgdHlwZTogXCJvYmplY3RcIiwgcHJvcGVydGllczoge30sIGFkZGl0aW9uYWxQcm9wZXJ0aWVzOiBmYWxzZSB9LFxyXG4gIH0sXHJcbl07XHJcblxyXG5leHBvcnQgZGVmYXVsdCBhc3luYyBmdW5jdGlvbiBoYW5kbGVyKHJlcXVlc3QpIHtcclxuICBpZiAocmVxdWVzdC5tZXRob2QgPT09IFwiT1BUSU9OU1wiKSB7XHJcbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlKG51bGwsIHsgc3RhdHVzOiAyMDQsIGhlYWRlcnM6IGNvcnNIZWFkZXJzIH0pO1xyXG4gIH1cclxuXHJcbiAgaWYgKHJlcXVlc3QubWV0aG9kID09PSBcIkdFVFwiKSB7XHJcbiAgICBjb25zdCBhdXRoUHJvYmxlbSA9IGF1dGhvcml6ZShyZXF1ZXN0KTtcclxuICAgIHJldHVybiBqc29uKHtcclxuICAgICAgbmFtZTogXCJvbmV0YXNrLWZpcmVzdG9yZS1yZWFkb25seVwiLFxyXG4gICAgICBzdGF0dXM6IGF1dGhQcm9ibGVtID8gXCJsb2NrZWRcIiA6IFwicmVhZHlcIixcclxuICAgICAgcHJvamVjdDogUFJPSkVDVF9JRCxcclxuICAgICAgdXNlcktleTogVVNFUl9LRVksXHJcbiAgICAgIGVuZHBvaW50OiBcIi9tY3BcIixcclxuICAgICAgdG9vbHM6IHRvb2xzLm1hcCgodG9vbCkgPT4gdG9vbC5uYW1lKSxcclxuICAgICAgYXV0aDogYXV0aFByb2JsZW0gPyBhdXRoUHJvYmxlbS5tZXNzYWdlIDogXCJhdXRob3JpemVkXCIsXHJcbiAgICB9LCBhdXRoUHJvYmxlbSA/IDQwMSA6IDIwMCk7XHJcbiAgfVxyXG5cclxuICBpZiAocmVxdWVzdC5tZXRob2QgIT09IFwiUE9TVFwiKSB7XHJcbiAgICByZXR1cm4ganNvbih7IGVycm9yOiBcIk1ldGhvZCBub3QgYWxsb3dlZFwiIH0sIDQwNSk7XHJcbiAgfVxyXG5cclxuICBjb25zdCBhdXRoUHJvYmxlbSA9IGF1dGhvcml6ZShyZXF1ZXN0KTtcclxuICBpZiAoYXV0aFByb2JsZW0pIHtcclxuICAgIHJldHVybiBqc29uUnBjRXJyb3IobnVsbCwgLTMyMDAxLCBhdXRoUHJvYmxlbS5tZXNzYWdlLCA0MDEpO1xyXG4gIH1cclxuXHJcbiAgbGV0IHBheWxvYWQ7XHJcbiAgdHJ5IHtcclxuICAgIHBheWxvYWQgPSBhd2FpdCByZXF1ZXN0Lmpzb24oKTtcclxuICB9IGNhdGNoIHtcclxuICAgIHJldHVybiBqc29uUnBjRXJyb3IobnVsbCwgLTMyNzAwLCBcIlBhcnNlIGVycm9yXCIsIDQwMCk7XHJcbiAgfVxyXG5cclxuICBjb25zdCByZXF1ZXN0cyA9IEFycmF5LmlzQXJyYXkocGF5bG9hZCkgPyBwYXlsb2FkIDogW3BheWxvYWRdO1xyXG4gIGNvbnN0IHJlc3BvbnNlcyA9IFtdO1xyXG4gIGZvciAoY29uc3QgaXRlbSBvZiByZXF1ZXN0cykge1xyXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYW5kbGVScGMoaXRlbSk7XHJcbiAgICBpZiAocmVzcG9uc2UpIHJlc3BvbnNlcy5wdXNoKHJlc3BvbnNlKTtcclxuICB9XHJcblxyXG4gIGlmIChBcnJheS5pc0FycmF5KHBheWxvYWQpKSB7XHJcbiAgICByZXR1cm4ganNvbihyZXNwb25zZXMpO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHJlc3BvbnNlc1swXSA/IGpzb24ocmVzcG9uc2VzWzBdKSA6IG5ldyBSZXNwb25zZShudWxsLCB7IHN0YXR1czogMjA0LCBoZWFkZXJzOiBjb3JzSGVhZGVycyB9KTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlUnBjKG1lc3NhZ2UpIHtcclxuICBpZiAoIW1lc3NhZ2UgfHwgbWVzc2FnZS5qc29ucnBjICE9PSBcIjIuMFwiIHx8IHR5cGVvZiBtZXNzYWdlLm1ldGhvZCAhPT0gXCJzdHJpbmdcIikge1xyXG4gICAgcmV0dXJuIHJwY0Vycm9yKG1lc3NhZ2U/LmlkID8/IG51bGwsIC0zMjYwMCwgXCJJbnZhbGlkIFJlcXVlc3RcIik7XHJcbiAgfVxyXG5cclxuICBjb25zdCBpZCA9IG1lc3NhZ2UuaWQ7XHJcbiAgY29uc3QgaXNOb3RpZmljYXRpb24gPSBpZCA9PT0gdW5kZWZpbmVkIHx8IGlkID09PSBudWxsO1xyXG5cclxuICB0cnkge1xyXG4gICAgaWYgKG1lc3NhZ2UubWV0aG9kID09PSBcImluaXRpYWxpemVcIikge1xyXG4gICAgICByZXR1cm4gaXNOb3RpZmljYXRpb24gPyBudWxsIDogcnBjUmVzdWx0KGlkLCB7XHJcbiAgICAgICAgcHJvdG9jb2xWZXJzaW9uOiBtZXNzYWdlLnBhcmFtcz8ucHJvdG9jb2xWZXJzaW9uIHx8IFwiMjAyNS0xMS0yNVwiLFxyXG4gICAgICAgIGNhcGFiaWxpdGllczogeyB0b29sczoge30gfSxcclxuICAgICAgICBzZXJ2ZXJJbmZvOiB7IG5hbWU6IFwib25ldGFzay1maXJlc3RvcmUtcmVhZG9ubHlcIiwgdmVyc2lvbjogXCIxLjAuMFwiIH0sXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChtZXNzYWdlLm1ldGhvZCA9PT0gXCJub3RpZmljYXRpb25zL2luaXRpYWxpemVkXCIpIHtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKG1lc3NhZ2UubWV0aG9kID09PSBcInBpbmdcIikge1xyXG4gICAgICByZXR1cm4gaXNOb3RpZmljYXRpb24gPyBudWxsIDogcnBjUmVzdWx0KGlkLCB7fSk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKG1lc3NhZ2UubWV0aG9kID09PSBcInRvb2xzL2xpc3RcIikge1xyXG4gICAgICByZXR1cm4gaXNOb3RpZmljYXRpb24gPyBudWxsIDogcnBjUmVzdWx0KGlkLCB7IHRvb2xzIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChtZXNzYWdlLm1ldGhvZCA9PT0gXCJ0b29scy9jYWxsXCIpIHtcclxuICAgICAgY29uc3QgeyBuYW1lLCBhcmd1bWVudHM6IGFyZ3MgPSB7fSB9ID0gbWVzc2FnZS5wYXJhbXMgfHwge307XHJcbiAgICAgIGlmICghbmFtZSB8fCB0eXBlb2YgbmFtZSAhPT0gXCJzdHJpbmdcIikge1xyXG4gICAgICAgIHJldHVybiBycGNFcnJvcihpZCwgLTMyNjAyLCBcInRvb2xzL2NhbGwgcmVxdWlyZXMgYSB0b29sIG5hbWVcIik7XHJcbiAgICAgIH1cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgY2FsbFRvb2wobmFtZSwgYXJncyk7XHJcbiAgICAgIHJldHVybiBpc05vdGlmaWNhdGlvbiA/IG51bGwgOiBycGNSZXN1bHQoaWQsIHJlc3VsdCk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJwY0Vycm9yKGlkLCAtMzI2MDEsIGBNZXRob2Qgbm90IGZvdW5kOiAke21lc3NhZ2UubWV0aG9kfWApO1xyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICByZXR1cm4gcnBjRXJyb3IoaWQgPz8gbnVsbCwgLTMyNjAzLCBzYWZlRXJyb3IoZXJyb3IpKTtcclxuICB9XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGNhbGxUb29sKG5hbWUsIGFyZ3MpIHtcclxuICBzd2l0Y2ggKG5hbWUpIHtcclxuICAgIGNhc2UgXCJsaXN0X3Rhc2tzXCI6XHJcbiAgICAgIHJldHVybiB0b29sUmVzdWx0KGF3YWl0IGxpc3RUYXNrcyhhcmdzKSk7XHJcbiAgICBjYXNlIFwiZ2V0X3Rhc2tcIjpcclxuICAgICAgcmV0dXJuIHRvb2xSZXN1bHQoYXdhaXQgZ2V0VGFzayhyZXF1aXJlZFN0cmluZyhhcmdzLCBcInRhc2tJZFwiKSkpO1xyXG4gICAgY2FzZSBcInNlYXJjaF90YXNrc1wiOlxyXG4gICAgICByZXR1cm4gdG9vbFJlc3VsdChhd2FpdCBzZWFyY2hUYXNrcyhhcmdzKSk7XHJcbiAgICBjYXNlIFwibGlzdF9zaGFpbG9zXCI6XHJcbiAgICAgIHJldHVybiB0b29sUmVzdWx0KGF3YWl0IGxpc3RTaGFpbG9zKGFyZ3MpKTtcclxuICAgIGNhc2UgXCJnZXRfc2hhaWxhXCI6XHJcbiAgICAgIHJldHVybiB0b29sUmVzdWx0KGF3YWl0IGdldFNoYWlsYShyZXF1aXJlZFN0cmluZyhhcmdzLCBcInNoYWlsYUlkXCIpKSk7XHJcbiAgICBjYXNlIFwic2VhcmNoX3NoYWlsb3NcIjpcclxuICAgICAgcmV0dXJuIHRvb2xSZXN1bHQoYXdhaXQgc2VhcmNoU2hhaWxvcyhhcmdzKSk7XHJcbiAgICBjYXNlIFwiZ2V0X3NldHRpbmdzXCI6XHJcbiAgICAgIHJldHVybiB0b29sUmVzdWx0KGF3YWl0IGdldENvbmZpZ0RvYyhcInNldHRpbmdzXCIpKTtcclxuICAgIGNhc2UgXCJnZXRfbWV0YVwiOlxyXG4gICAgICByZXR1cm4gdG9vbFJlc3VsdChhd2FpdCBnZXRDb25maWdEb2MoXCJtZXRhXCIpKTtcclxuICAgIGNhc2UgXCJnZXRfbGVnYWN5X2FwcF9zdGF0ZVwiOlxyXG4gICAgICByZXR1cm4gdG9vbFJlc3VsdChhd2FpdCBnZXRMZWdhY3lBcHBTdGF0ZSgpKTtcclxuICAgIGRlZmF1bHQ6XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biB0b29sOiAke25hbWV9YCk7XHJcbiAgfVxyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBsaXN0VGFza3MoYXJncyA9IHt9KSB7XHJcbiAgY29uc3QgdGFza3MgPSBhd2FpdCByZWFkVGFza0xpc3QoKTtcclxuICBjb25zdCBmaWx0ZXJlZCA9IHRhc2tzXHJcbiAgICAuZmlsdGVyKCh0YXNrKSA9PiBhcmdzLmNvbXBsZXRlZCA9PT0gdW5kZWZpbmVkIHx8IHRhc2suY29tcGxldGVkID09PSBhcmdzLmNvbXBsZXRlZClcclxuICAgIC5maWx0ZXIoKHRhc2spID0+ICFhcmdzLnByaW9yaXR5IHx8IHRleHQodGFzay5wcmlvcml0eSkudG9Mb3dlckNhc2UoKSA9PT0gYXJncy5wcmlvcml0eS50b0xvd2VyQ2FzZSgpKVxyXG4gICAgLmZpbHRlcigodGFzaykgPT4gIWFyZ3Muc2hhaWxhSWQgfHwgdGFzay5zaGFpbGFJZCA9PT0gYXJncy5zaGFpbGFJZClcclxuICAgIC5maWx0ZXIoKHRhc2spID0+IGluRGF0ZVdpbmRvdyh0YXNrLmNyZWF0ZWRBdCwgYXJncy5jcmVhdGVkQWZ0ZXIsIGFyZ3MuY3JlYXRlZEJlZm9yZSkpXHJcbiAgICAuZmlsdGVyKCh0YXNrKSA9PiBpbkRhdGVXaW5kb3codGFzay51cGRhdGVkQXQsIGFyZ3MudXBkYXRlZEFmdGVyLCBhcmdzLnVwZGF0ZWRCZWZvcmUpKTtcclxuXHJcbiAgcmV0dXJuIHtcclxuICAgIHNvdXJjZTogYHVzZXJzLyR7VVNFUl9LRVl9L3Rhc2tzYCxcclxuICAgIGNvdW50OiBmaWx0ZXJlZC5sZW5ndGgsXHJcbiAgICB0YXNrczogc29ydEFuZExpbWl0KGZpbHRlcmVkLCBhcmdzLnNvcnRCeSB8fCBcInVwZGF0ZWRBdFwiLCBhcmdzLnNvcnREaXJlY3Rpb24gfHwgXCJkZXNjXCIsIGFyZ3MubGltaXQpLFxyXG4gIH07XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGdldFRhc2sodGFza0lkKSB7XHJcbiAgY29uc3Qgc25hcCA9IGF3YWl0IHVzZXJEb2MoKS5jb2xsZWN0aW9uKFwidGFza3NcIikuZG9jKHRhc2tJZCkuZ2V0KCk7XHJcbiAgcmV0dXJuIHtcclxuICAgIHNvdXJjZTogYHVzZXJzLyR7VVNFUl9LRVl9L3Rhc2tzLyR7dGFza0lkfWAsXHJcbiAgICBmb3VuZDogc25hcC5leGlzdHMsXHJcbiAgICB0YXNrOiBzbmFwLmV4aXN0cyA/IG5vcm1hbGl6ZVRhc2soc25hcC5pZCwgc25hcC5kYXRhKCkpIDogbnVsbCxcclxuICB9O1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBzZWFyY2hUYXNrcyhhcmdzID0ge30pIHtcclxuICBjb25zdCBxdWVyeSA9IHJlcXVpcmVkU3RyaW5nKGFyZ3MsIFwicXVlcnlcIikudG9Mb3dlckNhc2UoKTtcclxuICBjb25zdCB0YXNrcyA9IGF3YWl0IHJlYWRUYXNrTGlzdCgpO1xyXG4gIGNvbnN0IGZpbHRlcmVkID0gdGFza3NcclxuICAgIC5maWx0ZXIoKHRhc2spID0+IGFyZ3MuY29tcGxldGVkID09PSB1bmRlZmluZWQgfHwgdGFzay5jb21wbGV0ZWQgPT09IGFyZ3MuY29tcGxldGVkKVxyXG4gICAgLmZpbHRlcigodGFzaykgPT4gIWFyZ3MucHJpb3JpdHkgfHwgdGV4dCh0YXNrLnByaW9yaXR5KS50b0xvd2VyQ2FzZSgpID09PSBhcmdzLnByaW9yaXR5LnRvTG93ZXJDYXNlKCkpXHJcbiAgICAuZmlsdGVyKCh0YXNrKSA9PiBzZWFyY2hhYmxlVGV4dCh0YXNrKS5pbmNsdWRlcyhxdWVyeSkpO1xyXG5cclxuICByZXR1cm4ge1xyXG4gICAgc291cmNlOiBgdXNlcnMvJHtVU0VSX0tFWX0vdGFza3NgLFxyXG4gICAgcXVlcnk6IGFyZ3MucXVlcnksXHJcbiAgICBjb3VudDogZmlsdGVyZWQubGVuZ3RoLFxyXG4gICAgdGFza3M6IHNvcnRBbmRMaW1pdChmaWx0ZXJlZCwgXCJ1cGRhdGVkQXRcIiwgXCJkZXNjXCIsIGFyZ3MubGltaXQpLFxyXG4gIH07XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGxpc3RTaGFpbG9zKGFyZ3MgPSB7fSkge1xyXG4gIGNvbnN0IFtzaGFpbG9zLCB0YXNrTGlua3NdID0gYXdhaXQgUHJvbWlzZS5hbGwoW3JlYWRTaGFpbGFMaXN0KCksIHJlYWRUYXNrTGlua3MoKV0pO1xyXG4gIGNvbnN0IGZpbHRlcmVkID0gc2hhaWxvc1xyXG4gICAgLm1hcCgoc2hhaWxhKSA9PiAoeyAuLi5zaGFpbGEsIGxpbmtlZFRhc2tJZHM6IHRhc2tMaW5rcy5nZXQoc2hhaWxhLmlkKSB8fCBbXSB9KSlcclxuICAgIC5maWx0ZXIoKHNoYWlsYSkgPT4gIWFyZ3Muc3RhdHVzIHx8IHNoYWlsYS5zdGF0dXMgPT09IGFyZ3Muc3RhdHVzKVxyXG4gICAgLmZpbHRlcigoc2hhaWxhKSA9PiAhYXJncy5saW5rZWRPbmx5IHx8IHNoYWlsYS5saW5rZWRUYXNrSWRzLmxlbmd0aCA+IDApO1xyXG5cclxuICByZXR1cm4ge1xyXG4gICAgc291cmNlOiBgdXNlcnMvJHtVU0VSX0tFWX0vc2hhaWxvc2AsXHJcbiAgICBjb3VudDogZmlsdGVyZWQubGVuZ3RoLFxyXG4gICAgc2hhaWxvczogc29ydEFuZExpbWl0KGZpbHRlcmVkLCBhcmdzLnNvcnRCeSB8fCBcImNyZWF0ZWRBdFwiLCBhcmdzLnNvcnREaXJlY3Rpb24gfHwgXCJkZXNjXCIsIGFyZ3MubGltaXQpLFxyXG4gIH07XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGdldFNoYWlsYShzaGFpbGFJZCkge1xyXG4gIGNvbnN0IFtzbmFwLCB0YXNrTGlua3NdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xyXG4gICAgdXNlckRvYygpLmNvbGxlY3Rpb24oXCJzaGFpbG9zXCIpLmRvYyhzaGFpbGFJZCkuZ2V0KCksXHJcbiAgICByZWFkVGFza0xpbmtzKCksXHJcbiAgXSk7XHJcbiAgcmV0dXJuIHtcclxuICAgIHNvdXJjZTogYHVzZXJzLyR7VVNFUl9LRVl9L3NoYWlsb3MvJHtzaGFpbGFJZH1gLFxyXG4gICAgZm91bmQ6IHNuYXAuZXhpc3RzLFxyXG4gICAgc2hhaWxhOiBzbmFwLmV4aXN0c1xyXG4gICAgICA/IHsgLi4ubm9ybWFsaXplU2hhaWxhKHNuYXAuaWQsIHNuYXAuZGF0YSgpKSwgbGlua2VkVGFza0lkczogdGFza0xpbmtzLmdldChzbmFwLmlkKSB8fCBbXSB9XHJcbiAgICAgIDogbnVsbCxcclxuICB9O1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBzZWFyY2hTaGFpbG9zKGFyZ3MgPSB7fSkge1xyXG4gIGNvbnN0IHF1ZXJ5ID0gcmVxdWlyZWRTdHJpbmcoYXJncywgXCJxdWVyeVwiKS50b0xvd2VyQ2FzZSgpO1xyXG4gIGNvbnN0IFtzaGFpbG9zLCB0YXNrTGlua3NdID0gYXdhaXQgUHJvbWlzZS5hbGwoW3JlYWRTaGFpbGFMaXN0KCksIHJlYWRUYXNrTGlua3MoKV0pO1xyXG4gIGNvbnN0IGZpbHRlcmVkID0gc2hhaWxvc1xyXG4gICAgLm1hcCgoc2hhaWxhKSA9PiAoeyAuLi5zaGFpbGEsIGxpbmtlZFRhc2tJZHM6IHRhc2tMaW5rcy5nZXQoc2hhaWxhLmlkKSB8fCBbXSB9KSlcclxuICAgIC5maWx0ZXIoKHNoYWlsYSkgPT4gIWFyZ3Muc3RhdHVzIHx8IHNoYWlsYS5zdGF0dXMgPT09IGFyZ3Muc3RhdHVzKVxyXG4gICAgLmZpbHRlcigoc2hhaWxhKSA9PiBzZWFyY2hhYmxlVGV4dChzaGFpbGEpLmluY2x1ZGVzKHF1ZXJ5KSk7XHJcblxyXG4gIHJldHVybiB7XHJcbiAgICBzb3VyY2U6IGB1c2Vycy8ke1VTRVJfS0VZfS9zaGFpbG9zYCxcclxuICAgIHF1ZXJ5OiBhcmdzLnF1ZXJ5LFxyXG4gICAgY291bnQ6IGZpbHRlcmVkLmxlbmd0aCxcclxuICAgIHNoYWlsb3M6IHNvcnRBbmRMaW1pdChmaWx0ZXJlZCwgXCJjcmVhdGVkQXRcIiwgXCJkZXNjXCIsIGFyZ3MubGltaXQpLFxyXG4gIH07XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGdldENvbmZpZ0RvYyhkb2NOYW1lKSB7XHJcbiAgY29uc3Qgc25hcCA9IGF3YWl0IHVzZXJEb2MoKS5jb2xsZWN0aW9uKFwiY29uZmlnXCIpLmRvYyhkb2NOYW1lKS5nZXQoKTtcclxuICByZXR1cm4ge1xyXG4gICAgc291cmNlOiBgdXNlcnMvJHtVU0VSX0tFWX0vY29uZmlnLyR7ZG9jTmFtZX1gLFxyXG4gICAgZm91bmQ6IHNuYXAuZXhpc3RzLFxyXG4gICAgZGF0YTogc25hcC5leGlzdHMgPyBub3JtYWxpemVWYWx1ZShzbmFwLmRhdGEoKSkgOiBudWxsLFxyXG4gIH07XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGdldExlZ2FjeUFwcFN0YXRlKCkge1xyXG4gIGNvbnN0IHNuYXAgPSBhd2FpdCB1c2VyRG9jKCkuY29sbGVjdGlvbihcImFwcERhdGFcIikuZG9jKFwiYXBwU3RhdGVfdjRcIikuZ2V0KCk7XHJcbiAgcmV0dXJuIHtcclxuICAgIHNvdXJjZTogYHVzZXJzLyR7VVNFUl9LRVl9L2FwcERhdGEvYXBwU3RhdGVfdjRgLFxyXG4gICAgZm91bmQ6IHNuYXAuZXhpc3RzLFxyXG4gICAgZGF0YTogc25hcC5leGlzdHMgPyBub3JtYWxpemVWYWx1ZShzbmFwLmRhdGEoKSkgOiBudWxsLFxyXG4gIH07XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHJlYWRUYXNrTGlzdCgpIHtcclxuICBjb25zdCBzbmFwID0gYXdhaXQgdXNlckRvYygpLmNvbGxlY3Rpb24oXCJ0YXNrc1wiKS5nZXQoKTtcclxuICByZXR1cm4gc25hcC5kb2NzLm1hcCgoZG9jKSA9PiBub3JtYWxpemVUYXNrKGRvYy5pZCwgZG9jLmRhdGEoKSkpO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiByZWFkU2hhaWxhTGlzdCgpIHtcclxuICBjb25zdCBzbmFwID0gYXdhaXQgdXNlckRvYygpLmNvbGxlY3Rpb24oXCJzaGFpbG9zXCIpLmdldCgpO1xyXG4gIHJldHVybiBzbmFwLmRvY3MubWFwKChkb2MpID0+IG5vcm1hbGl6ZVNoYWlsYShkb2MuaWQsIGRvYy5kYXRhKCkpKTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gcmVhZFRhc2tMaW5rcygpIHtcclxuICBjb25zdCBsaW5rcyA9IG5ldyBNYXAoKTtcclxuICBjb25zdCB0YXNrcyA9IGF3YWl0IHJlYWRUYXNrTGlzdCgpO1xyXG4gIGZvciAoY29uc3QgdGFzayBvZiB0YXNrcykge1xyXG4gICAgaWYgKCF0YXNrLnNoYWlsYUlkKSBjb250aW51ZTtcclxuICAgIGNvbnN0IGN1cnJlbnQgPSBsaW5rcy5nZXQodGFzay5zaGFpbGFJZCkgfHwgW107XHJcbiAgICBjdXJyZW50LnB1c2godGFzay5pZCk7XHJcbiAgICBsaW5rcy5zZXQodGFzay5zaGFpbGFJZCwgY3VycmVudCk7XHJcbiAgfVxyXG4gIHJldHVybiBsaW5rcztcclxufVxyXG5cclxuZnVuY3Rpb24gbm9ybWFsaXplVGFzayhpZCwgcmF3ID0ge30pIHtcclxuICBjb25zdCB2YWx1ZSA9IG5vcm1hbGl6ZVZhbHVlKHJhdyk7XHJcbiAgY29uc3QgdGl0bGUgPSBmaXJzdFRleHQodmFsdWUudGl0bGUsIHZhbHVlLnRleHQsIHZhbHVlLmNvbnRlbnQsIHZhbHVlLm5hbWUsIHZhbHVlLmxhYmVsKTtcclxuICBjb25zdCBjb21wbGV0ZWQgPSBCb29sZWFuKHZhbHVlLmNvbXBsZXRlZCB8fCB2YWx1ZS5kb25lIHx8IHZhbHVlLnN0YXR1cyA9PT0gXCJjb21wbGV0ZWRcIik7XHJcbiAgcmV0dXJuIHtcclxuICAgIGlkLFxyXG4gICAgdGl0bGUsXHJcbiAgICB0ZXh0OiBmaXJzdFRleHQodmFsdWUudGV4dCwgdmFsdWUuY29udGVudCwgdmFsdWUubm90ZXMsIHRpdGxlKSxcclxuICAgIHN0YXR1czogY29tcGxldGVkID8gXCJjb21wbGV0ZWRcIiA6IFwib3BlblwiLFxyXG4gICAgY29tcGxldGVkLFxyXG4gICAgcHJpb3JpdHk6IHZhbHVlLnByaW9yaXR5ID8/IHZhbHVlLmltcG9ydGFuY2UgPz8gbnVsbCxcclxuICAgIGR1ZURhdGU6IGZpcnN0VGV4dCh2YWx1ZS5kdWVEYXRlLCB2YWx1ZS5kdWUsIHZhbHVlLmRlYWRsaW5lKSB8fCBudWxsLFxyXG4gICAgY3JlYXRlZEF0OiBmaXJzdFRleHQodmFsdWUuY3JlYXRlZEF0LCB2YWx1ZS5jcmVhdGVkLCB2YWx1ZS5kYXRlQ3JlYXRlZCkgfHwgbnVsbCxcclxuICAgIHVwZGF0ZWRBdDogZmlyc3RUZXh0KHZhbHVlLnVwZGF0ZWRBdCwgdmFsdWUuX2xhc3RNb2RpZmllZCwgdmFsdWUubW9kaWZpZWRBdCwgdmFsdWUubGFzdEVkaXRlZEF0KSB8fCBudWxsLFxyXG4gICAgc2hhaWxhSWQ6IHZhbHVlLnNoYWlsYUlkIHx8IHZhbHVlLmxpbmtlZFNoYWlsYUlkIHx8IG51bGwsXHJcbiAgICBsaXN0SWQ6IHZhbHVlLmxpc3RJZCB8fCB2YWx1ZS5jb2x1bW5JZCB8fCBudWxsLFxyXG4gICAgcGFyZW50VGFzazogdmFsdWUucGFyZW50VGFzayB8fCB2YWx1ZS5wYXJlbnRJZCB8fCBudWxsLFxyXG4gICAgYmxvY2tlZDogQm9vbGVhbih2YWx1ZS5ibG9ja2VkKSxcclxuICAgIGJsb2NrZWRSZWFzb246IHZhbHVlLmJsb2NrZWRSZWFzb24gfHwgbnVsbCxcclxuICAgIHJhdzogdmFsdWUsXHJcbiAgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gbm9ybWFsaXplU2hhaWxhKGlkLCByYXcgPSB7fSkge1xyXG4gIGNvbnN0IHZhbHVlID0gbm9ybWFsaXplVmFsdWUocmF3KTtcclxuICByZXR1cm4ge1xyXG4gICAgaWQsXHJcbiAgICBzeW5vcHNpczogZmlyc3RUZXh0KHZhbHVlLnN5bm9wc2lzLCB2YWx1ZS50aXRsZSwgdmFsdWUuc3VtbWFyeSkgfHwgbnVsbCxcclxuICAgIGNvbnRlbnQ6IGZpcnN0VGV4dCh2YWx1ZS5jb250ZW50LCB2YWx1ZS5xdWVzdGlvbiwgdmFsdWUudGV4dCkgfHwgbnVsbCxcclxuICAgIHN0YXR1czogdmFsdWUuc3RhdHVzIHx8IG51bGwsXHJcbiAgICBkYXRlOiBmaXJzdFRleHQodmFsdWUuZGF0ZSkgfHwgbnVsbCxcclxuICAgIGNyZWF0ZWRBdDogZmlyc3RUZXh0KHZhbHVlLmNyZWF0ZWRBdCwgdmFsdWUuY3JlYXRlZCkgfHwgbnVsbCxcclxuICAgIHVwZGF0ZWRBdDogZmlyc3RUZXh0KHZhbHVlLnVwZGF0ZWRBdCwgdmFsdWUuX2xhc3RNb2RpZmllZCwgdmFsdWUubW9kaWZpZWRBdCkgfHwgbnVsbCxcclxuICAgIGFza2VyTmFtZTogdmFsdWUuYXNrZXJOYW1lIHx8IG51bGwsXHJcbiAgICBhbnN3ZXI6IGZpcnN0VGV4dCh2YWx1ZS5hbnN3ZXIpIHx8IG51bGwsXHJcbiAgICBhbnN3ZXJlck5hbWU6IHZhbHVlLmFuc3dlcmVyTmFtZSB8fCBudWxsLFxyXG4gICAgcGFyc2VkU2hhaWxhOiB2YWx1ZS5wYXJzZWRTaGFpbGEgfHwgbnVsbCxcclxuICAgIGxpbmtlZFRhc2tJZHM6IFtdLFxyXG4gICAgcmF3OiB2YWx1ZSxcclxuICB9O1xyXG59XHJcblxyXG5mdW5jdGlvbiBub3JtYWxpemVWYWx1ZSh2YWx1ZSkge1xyXG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gdmFsdWU7XHJcbiAgaWYgKHR5cGVvZiB2YWx1ZT8udG9EYXRlID09PSBcImZ1bmN0aW9uXCIpIHJldHVybiB2YWx1ZS50b0RhdGUoKS50b0lTT1N0cmluZygpO1xyXG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkgcmV0dXJuIHZhbHVlLm1hcChub3JtYWxpemVWYWx1ZSk7XHJcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIikge1xyXG4gICAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhPYmplY3QuZW50cmllcyh2YWx1ZSkubWFwKChba2V5LCBpdGVtXSkgPT4gW2tleSwgbm9ybWFsaXplVmFsdWUoaXRlbSldKSk7XHJcbiAgfVxyXG4gIHJldHVybiB2YWx1ZTtcclxufVxyXG5cclxuZnVuY3Rpb24gdXNlckRvYygpIHtcclxuICByZXR1cm4gZGIoKS5jb2xsZWN0aW9uKFwidXNlcnNcIikuZG9jKFVTRVJfS0VZKTtcclxufVxyXG5cclxuZnVuY3Rpb24gZGIoKSB7XHJcbiAgaWYgKCFnZXRBcHBzKCkubGVuZ3RoKSB7XHJcbiAgICBpbml0aWFsaXplQXBwKHsgY3JlZGVudGlhbDogY2VydChzZXJ2aWNlQWNjb3VudCgpKSwgcHJvamVjdElkOiBQUk9KRUNUX0lEIH0pO1xyXG4gIH1cclxuICByZXR1cm4gZ2V0RmlyZXN0b3JlKCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHNlcnZpY2VBY2NvdW50KCkge1xyXG4gIGNvbnN0IHJhd0pzb24gPSBlbnYoXCJGSVJFQkFTRV9TRVJWSUNFX0FDQ09VTlRfSlNPTlwiKTtcclxuICBpZiAocmF3SnNvbikge1xyXG4gICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShyYXdKc29uKTtcclxuICAgIGlmIChwYXJzZWQucHJvamVjdF9pZCAhPT0gUFJPSkVDVF9JRCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb25maWd1cmVkIEZpcmViYXNlIHNlcnZpY2UgYWNjb3VudCBpcyBub3Qgc2NvcGVkIHRvIG9uZXRhc2tvbmx5LWFwcC5cIik7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcGFyc2VkO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgcHJvamVjdElkID0gZW52KFwiRklSRUJBU0VfUFJPSkVDVF9JRFwiKTtcclxuICBjb25zdCBjbGllbnRFbWFpbCA9IGVudihcIkZJUkVCQVNFX0NMSUVOVF9FTUFJTFwiKTtcclxuICBjb25zdCBwcml2YXRlS2V5ID0gZW52KFwiRklSRUJBU0VfUFJJVkFURV9LRVlcIik/LnJlcGxhY2UoL1xcXFxuL2csIFwiXFxuXCIpO1xyXG4gIGlmICghcHJvamVjdElkIHx8ICFjbGllbnRFbWFpbCB8fCAhcHJpdmF0ZUtleSkge1xyXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRmlyZWJhc2Ugc2VydmljZSBhY2NvdW50IGlzIG5vdCBjb25maWd1cmVkLlwiKTtcclxuICB9XHJcbiAgaWYgKHByb2plY3RJZCAhPT0gUFJPSkVDVF9JRCkge1xyXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJlZCBGaXJlYmFzZSBwcm9qZWN0IGlzIG5vdCBvbmV0YXNrb25seS1hcHAuXCIpO1xyXG4gIH1cclxuICByZXR1cm4geyBwcm9qZWN0SWQsIGNsaWVudEVtYWlsLCBwcml2YXRlS2V5IH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGF1dGhvcml6ZShyZXF1ZXN0KSB7XHJcbiAgY29uc3QgZXhwZWN0ZWQgPSBlbnYoXCJNQ1BfUkVBRF9UT0tFTlwiKTtcclxuICBjb25zdCBhbGxvd09wZW4gPSBlbnYoXCJNQ1BfQUxMT1dfVU5BVVRIRU5USUNBVEVEX1JFQURTXCIpID09PSBcInRydWVcIjtcclxuICBpZiAoIWV4cGVjdGVkICYmICFhbGxvd09wZW4pIHtcclxuICAgIHJldHVybiBuZXcgRXJyb3IoXCJNQ1BfUkVBRF9UT0tFTiBpcyByZXF1aXJlZCBiZWZvcmUgdGhpcyBlbmRwb2ludCB3aWxsIHNlcnZlIGRhdGEuXCIpO1xyXG4gIH1cclxuICBpZiAoYWxsb3dPcGVuICYmICFleHBlY3RlZCkgcmV0dXJuIG51bGw7XHJcblxyXG4gIGNvbnN0IGF1dGhvcml6YXRpb24gPSByZXF1ZXN0LmhlYWRlcnMuZ2V0KFwiYXV0aG9yaXphdGlvblwiKSB8fCBcIlwiO1xyXG4gIGNvbnN0IHRva2VuID0gYXV0aG9yaXphdGlvbi5yZXBsYWNlKC9eQmVhcmVyXFxzKy9pLCBcIlwiKS50cmltKCk7XHJcbiAgaWYgKCF0b2tlbiB8fCB0b2tlbiAhPT0gZXhwZWN0ZWQpIHtcclxuICAgIHJldHVybiBuZXcgRXJyb3IoXCJVbmF1dGhvcml6ZWQgTUNQIHJlcXVlc3QuXCIpO1xyXG4gIH1cclxuICByZXR1cm4gbnVsbDtcclxufVxyXG5cclxuZnVuY3Rpb24gZW52KG5hbWUpIHtcclxuICByZXR1cm4gZ2xvYmFsVGhpcy5OZXRsaWZ5Py5lbnY/LmdldD8uKG5hbWUpID8/IHByb2Nlc3MuZW52W25hbWVdO1xyXG59XHJcblxyXG5mdW5jdGlvbiByZXF1aXJlZFN0cmluZyhhcmdzLCBrZXkpIHtcclxuICBjb25zdCB2YWx1ZSA9IGFyZ3M/LltrZXldO1xyXG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIgfHwgIXZhbHVlLnRyaW0oKSkge1xyXG4gICAgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIHJlcXVpcmVkIHN0cmluZyBhcmd1bWVudDogJHtrZXl9YCk7XHJcbiAgfVxyXG4gIHJldHVybiB2YWx1ZS50cmltKCk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHNvcnRBbmRMaW1pdChpdGVtcywgc29ydEJ5LCBkaXJlY3Rpb24sIGxpbWl0KSB7XHJcbiAgY29uc3QgY2FwcGVkTGltaXQgPSBNYXRoLm1pbihNYXRoLm1heChOdW1iZXIobGltaXQpIHx8IERFRkFVTFRfTElNSVQsIDEpLCBNQVhfTElNSVQpO1xyXG4gIGNvbnN0IG11bHRpcGxpZXIgPSBkaXJlY3Rpb24gPT09IFwiYXNjXCIgPyAxIDogLTE7XHJcbiAgcmV0dXJuIFsuLi5pdGVtc11cclxuICAgIC5zb3J0KChhLCBiKSA9PiBjb21wYXJlVmFsdWVzKGFbc29ydEJ5XSwgYltzb3J0QnldKSAqIG11bHRpcGxpZXIpXHJcbiAgICAuc2xpY2UoMCwgY2FwcGVkTGltaXQpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjb21wYXJlVmFsdWVzKGEsIGIpIHtcclxuICBjb25zdCBsZWZ0ID0gY29tcGFyYWJsZShhKTtcclxuICBjb25zdCByaWdodCA9IGNvbXBhcmFibGUoYik7XHJcbiAgaWYgKGxlZnQgPCByaWdodCkgcmV0dXJuIC0xO1xyXG4gIGlmIChsZWZ0ID4gcmlnaHQpIHJldHVybiAxO1xyXG4gIHJldHVybiAwO1xyXG59XHJcblxyXG5mdW5jdGlvbiBjb21wYXJhYmxlKHZhbHVlKSB7XHJcbiAgaWYgKHZhbHVlID09IG51bGwgfHwgdmFsdWUgPT09IFwiXCIpIHJldHVybiBcIlwiO1xyXG4gIGNvbnN0IHRpbWUgPSBEYXRlLnBhcnNlKHZhbHVlKTtcclxuICByZXR1cm4gTnVtYmVyLmlzTmFOKHRpbWUpID8gU3RyaW5nKHZhbHVlKS50b0xvd2VyQ2FzZSgpIDogdGltZTtcclxufVxyXG5cclxuZnVuY3Rpb24gaW5EYXRlV2luZG93KHZhbHVlLCBhZnRlciwgYmVmb3JlKSB7XHJcbiAgaWYgKCFhZnRlciAmJiAhYmVmb3JlKSByZXR1cm4gdHJ1ZTtcclxuICBjb25zdCB0aW1lID0gRGF0ZS5wYXJzZSh2YWx1ZSk7XHJcbiAgaWYgKE51bWJlci5pc05hTih0aW1lKSkgcmV0dXJuIGZhbHNlO1xyXG4gIGlmIChhZnRlciAmJiB0aW1lIDwgRGF0ZS5wYXJzZShhZnRlcikpIHJldHVybiBmYWxzZTtcclxuICBpZiAoYmVmb3JlICYmIHRpbWUgPiBEYXRlLnBhcnNlKGJlZm9yZSkpIHJldHVybiBmYWxzZTtcclxuICByZXR1cm4gdHJ1ZTtcclxufVxyXG5cclxuZnVuY3Rpb24gc2VhcmNoYWJsZVRleHQodmFsdWUpIHtcclxuICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodmFsdWUgPz8gXCJcIikudG9Mb3dlckNhc2UoKTtcclxufVxyXG5cclxuZnVuY3Rpb24gZmlyc3RUZXh0KC4uLnZhbHVlcykge1xyXG4gIGZvciAoY29uc3QgdmFsdWUgb2YgdmFsdWVzKSB7XHJcbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiICYmIHZhbHVlLnRyaW0oKSkgcmV0dXJuIHZhbHVlLnRyaW0oKTtcclxuICAgIGlmICh2YWx1ZSAhPT0gbnVsbCAmJiB2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIFN0cmluZyh2YWx1ZSk7XHJcbiAgfVxyXG4gIHJldHVybiBcIlwiO1xyXG59XHJcblxyXG5mdW5jdGlvbiB0ZXh0KHZhbHVlKSB7XHJcbiAgcmV0dXJuIHZhbHVlID09IG51bGwgPyBcIlwiIDogU3RyaW5nKHZhbHVlKTtcclxufVxyXG5cclxuZnVuY3Rpb24gdG9vbFJlc3VsdChwYXlsb2FkKSB7XHJcbiAgcmV0dXJuIHtcclxuICAgIGNvbnRlbnQ6IFt7IHR5cGU6IFwidGV4dFwiLCB0ZXh0OiBKU09OLnN0cmluZ2lmeShwYXlsb2FkLCBudWxsLCAyKSB9XSxcclxuICAgIHN0cnVjdHVyZWRDb250ZW50OiBwYXlsb2FkLFxyXG4gIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJwY1Jlc3VsdChpZCwgcmVzdWx0KSB7XHJcbiAgcmV0dXJuIHsganNvbnJwYzogXCIyLjBcIiwgaWQsIHJlc3VsdCB9O1xyXG59XHJcblxyXG5mdW5jdGlvbiBycGNFcnJvcihpZCwgY29kZSwgbWVzc2FnZSkge1xyXG4gIHJldHVybiB7IGpzb25ycGM6IFwiMi4wXCIsIGlkLCBlcnJvcjogeyBjb2RlLCBtZXNzYWdlIH0gfTtcclxufVxyXG5cclxuZnVuY3Rpb24ganNvblJwY0Vycm9yKGlkLCBjb2RlLCBtZXNzYWdlLCBzdGF0dXMpIHtcclxuICByZXR1cm4ganNvbihycGNFcnJvcihpZCwgY29kZSwgbWVzc2FnZSksIHN0YXR1cyk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGpzb24oYm9keSwgc3RhdHVzID0gMjAwKSB7XHJcbiAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeShib2R5KSwge1xyXG4gICAgc3RhdHVzLFxyXG4gICAgaGVhZGVyczoge1xyXG4gICAgICAuLi5jb3JzSGVhZGVycyxcclxuICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uOyBjaGFyc2V0PXV0Zi04XCIsXHJcbiAgICB9LFxyXG4gIH0pO1xyXG59XHJcblxyXG5mdW5jdGlvbiBzYWZlRXJyb3IoZXJyb3IpIHtcclxuICBjb25zdCBtZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xyXG4gIHJldHVybiBtZXNzYWdlLnJlcGxhY2UoLy0tLS0tQkVHSU4gUFJJVkFURSBLRVktLS0tLVtcXHNcXFNdKy0tLS0tRU5EIFBSSVZBVEUgS0VZLS0tLS0vZywgXCJbcmVkYWN0ZWQgcHJpdmF0ZSBrZXldXCIpO1xyXG59XHJcbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7QUFBQSxTQUFTLE1BQU0sU0FBUyxxQkFBcUI7QUFDN0MsU0FBUyxvQkFBb0I7QUFFdEIsSUFBTSxTQUFTO0FBQUEsRUFDcEIsTUFBTTtBQUNSO0FBRUEsSUFBTSxhQUFhO0FBQ25CLElBQU0sV0FBVztBQUNqQixJQUFNLGdCQUFnQjtBQUN0QixJQUFNLFlBQVk7QUFFbEIsSUFBTSxjQUFjO0FBQUEsRUFDbEIsK0JBQStCO0FBQUEsRUFDL0IsZ0NBQWdDO0FBQUEsRUFDaEMsZ0NBQWdDO0FBQUEsRUFDaEMsaUNBQWlDO0FBQUEsRUFDakMsd0JBQXdCO0FBQzFCO0FBRUEsSUFBTSxRQUFRO0FBQUEsRUFDWjtBQUFBLElBQ0UsTUFBTTtBQUFBLElBQ04sYUFBYTtBQUFBLElBQ2IsYUFBYTtBQUFBLE1BQ1gsTUFBTTtBQUFBLE1BQ04sWUFBWTtBQUFBLFFBQ1YsV0FBVyxFQUFFLE1BQU0sVUFBVTtBQUFBLFFBQzdCLFVBQVUsRUFBRSxNQUFNLFNB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
