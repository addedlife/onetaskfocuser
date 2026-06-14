const { onRequest } = require("firebase-functions/v2/https");

const aiProxy       = require("./ai-proxy");
const appConfig     = require("./app-config");
const debugLog      = require("./debug-log");
const chiefProfile  = require("./chief-profile");
const googleWorkspace = require("./google-workspace");
const googleHealth  = require("./google-health");
const phoneRelay    = require("./phone-relay");
const mcpHandler    = require("./mcp");
const googleSearch  = require("./google-search");

exports.aiProxy         = onRequest({ timeoutSeconds: 300, memory: "256MiB", region: "us-central1" }, aiProxy);
exports.appConfig       = onRequest({ timeoutSeconds: 15,  memory: "128MiB", region: "us-central1" }, appConfig);
exports.debugLog        = onRequest({ timeoutSeconds: 10,  memory: "128MiB", region: "us-central1" }, debugLog);
exports.chiefProfile    = onRequest({ timeoutSeconds: 30,  memory: "256MiB", region: "us-central1" }, chiefProfile);
exports.googleWorkspace = onRequest({ timeoutSeconds: 60,  memory: "256MiB", region: "us-central1" }, googleWorkspace);
exports.googleHealth    = onRequest({ timeoutSeconds: 30,  memory: "256MiB", region: "us-central1" }, googleHealth);
exports.phoneRelay      = onRequest({ timeoutSeconds: 10,  memory: "128MiB", region: "us-central1" }, phoneRelay);
exports.mcp             = onRequest({ timeoutSeconds: 60,  memory: "256MiB", region: "us-central1" }, mcpHandler);
exports.googleSearch    = onRequest({ timeoutSeconds: 15,  memory: "128MiB", region: "us-central1" }, googleSearch);
