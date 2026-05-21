/**
 * Phone relay — cloud mailbox between DeskPhone.exe and any remote browser.
 *
 * Routes (via ?action= query param):
 *   GET  ?action=state    → webapp reads latest phone state (public)
 *   POST ?action=push     → DeskPhone pushes state blob (requires X-Relay-Secret)
 *   POST ?action=command  → webapp queues a command (public)
 *   GET  ?action=drain    → DeskPhone drains command queue (requires X-Relay-Secret)
 *
 * Storage: Netlify Blobs, store name "phone-relay", two keys:
 *   "state"    — latest JSON state pushed by DeskPhone
 *   "commands" — JSON array of pending commands
 *
 * Written as ESM (.mjs) so @netlify/blobs uses its ESM entry point and avoids
 * the require()-of-ESM crash in @netlify/runtime-utils.
 */

import { getStore } from "@netlify/blobs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Relay-Secret",
};

function ok(body) {
  return {
    statusCode: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

function err(statusCode, msg) {
  return {
    statusCode,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify({ error: msg }),
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const action = (event.queryStringParameters?.action || "").toLowerCase();
  const method = event.httpMethod;
  const secret = process.env.PHONE_RELAY_SECRET || "";
  const incoming = event.headers["x-relay-secret"] || event.headers["X-Relay-Secret"] || "";

  let store;
  try {
    store = getStore("phone-relay");
  } catch (e) {
    return err(503, "Blobs store unavailable: " + e.message);
  }

  // ── GET state ─────────────────────────────────────────────────────────────
  if (action === "state" && method === "GET") {
    try {
      const state = await store.get("state", { type: "text" });
      if (!state) return err(404, "No state — DeskPhone has not pushed yet");
      return ok(state); // already a JSON string, return as-is
    } catch (e) {
      return err(500, "Failed to read state: " + e.message);
    }
  }

  // ── POST push (DeskPhone → cloud) ─────────────────────────────────────────
  if (action === "push" && method === "POST") {
    if (!secret || incoming !== secret) return err(401, "unauthorized");
    const body = event.body || "";
    if (!body) return err(400, "empty body");
    try {
      await store.set("state", body);
      return ok({ ok: true });
    } catch (e) {
      return err(500, "Failed to write state: " + e.message);
    }
  }

  // ── POST command (webapp → cloud) ─────────────────────────────────────────
  if (action === "command" && method === "POST") {
    let cmd;
    try { cmd = JSON.parse(event.body || "{}"); } catch { return err(400, "invalid JSON"); }
    if (!cmd.path) return err(400, "missing path");
    cmd.id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    cmd.queuedAt = Date.now();
    try {
      const existing = (await store.get("commands", { type: "json" })) || [];
      existing.push(cmd);
      const capped = existing.slice(-50);
      await store.set("commands", JSON.stringify(capped));
      return ok({ ok: true, id: cmd.id });
    } catch (e) {
      return err(500, "Failed to queue command: " + e.message);
    }
  }

  // ── GET drain (cloud → DeskPhone) ─────────────────────────────────────────
  if (action === "drain" && method === "GET") {
    if (!secret || incoming !== secret) return err(401, "unauthorized");
    try {
      const commands = (await store.get("commands", { type: "json" })) || [];
      if (commands.length > 0) await store.set("commands", JSON.stringify([]));
      return ok(commands);
    } catch (e) {
      return err(500, "Failed to drain commands: " + e.message);
    }
  }

  return err(400, `unknown action '${action}' for ${method}`);
};
