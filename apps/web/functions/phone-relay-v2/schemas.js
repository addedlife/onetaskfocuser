// Zod schemas for every phoneRelayV2 action. v1 (phone-relay.js) validated
// almost nothing beyond ad hoc truthy checks — a malformed or hostile payload
// went straight into Firestore/RTDB. Every payload here is parsed and
// rejected with a clear 400 before it touches any datastore.
const { z } = require("zod");

const HOST_IDS = ["windows", "android"];

// Server-side command allowlist. v1 only enforced this in the browser
// (CLOUD_ALLOWED_COMMANDS in 10-deskphone-web.jsx) — the live server accepted
// any path string. Kept in sync with that same list; a command outside it is
// rejected here, not just hidden in the UI.
const COMMAND_PATH_ALLOWLIST = new Set([
  "/dial", "/answer", "/hangup", "/toggle-mute", "/send", "/refresh", "/connect",
  "/mark-conversation-read", "/mark-conversation-unread",
  "/delete-message", "/toggle-message-pin", "/save-contact", "/delete-contact",
]);

const CommandSchema = z.object({
  path: z.string().min(1).max(200).refine(
    (p) => COMMAND_PATH_ALLOWLIST.has(p.split("?")[0]),
    (p) => ({ message: `command path '${p.split("?")[0]}' is not in the server-side allowlist` })
  ),
});

const StatePushSchema = z
  .object({
    hostId: z.enum(HOST_IDS),
    fencingToken: z.number().int().nonnegative(),
    status: z.record(z.any()).optional().default({}),
    messages: z.array(z.record(z.any())).max(500).optional().default([]),
    calls: z.array(z.record(z.any())).max(500).optional().default([]),
    contacts: z.array(z.record(z.any())).max(2000).optional().default([]),
  })
  .passthrough();

const PushMediaSchema = z.object({
  id: z.string().min(1).max(200),
  // ~1.5MB base64 cap keeps the resulting Firestore doc comfortably under the
  // 1 MiB document ceiling after field-name/encoding overhead.
  dataUrl: z.string().startsWith("data:").max(1_500_000),
});

const RelayTokenRequestSchema = z.object({
  hostType: z.enum(HOST_IDS),
  hostInstanceId: z.string().min(1).max(100).optional(),
});

const PresenceHeartbeatSchema = z.object({
  hostId: z.enum(HOST_IDS),
  connected: z.boolean(),
  quality: z.number().min(0).max(100).optional().default(0),
  preferred: z.string().max(20).optional().nullable(),
});

module.exports = {
  HOST_IDS,
  COMMAND_PATH_ALLOWLIST,
  CommandSchema,
  StatePushSchema,
  PushMediaSchema,
  RelayTokenRequestSchema,
  PresenceHeartbeatSchema,
};
