#!/usr/bin/env node
// Simulated Bluetooth host — exercises the full phoneRelayV2 presence →
// leader-election → command loop with ZERO Bluetooth hardware, so the new
// cloud model (onDisconnect-based presence, fencing-token leader election,
// live command push) can be proven correct before a single native host is
// built. Run two of these (--host=windows and --host=android) side by side
// to watch real handoffs happen.
//
// Usage:
//   node scripts/relay-tester-mock-host.mjs --host=windows --secret=<value> \
//     [--endpoint=https://us-central1-onetaskonly-app.cloudfunctions.net/phoneRelayV2] \
//     [--quality=80] [--connected=true] [--instance=mock]
//
// Ctrl+C shows the GRACEFUL disconnect path (this script clears its own
// presence before exiting). Killing the process outright (`kill -9`, closing
// the terminal) shows the UNCLEAN path — presence clears itself just the
// same, because onDisconnect() is armed server-side by Firebase's own RTDB
// connection tracking, not by any client cleanup code.
import { initializeApp } from "firebase/app";
import { getAuth, signInWithCustomToken } from "firebase/auth";
import { getDatabase, ref, onDisconnect, set, onValue, serverTimestamp } from "firebase/database";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyB5UiDE9s0xjWeYa4OQ1LLJ63EwPVoSLrA",
  authDomain: "onetaskonly-app.firebaseapp.com",
  projectId: "onetaskonly-app",
  databaseURL: "https://onetaskonly-app-default-rtdb.firebaseio.com",
  storageBucket: "onetaskonly-app.firebasestorage.app",
  messagingSenderId: "1017463520129",
  appId: "1:1017463520129:web:b4d8ca01864dfb2a35c680",
};

function parseArgs() {
  const out = {};
  for (const raw of process.argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(raw);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const args = parseArgs();
const hostId = (args.host || "").toLowerCase();
if (hostId !== "windows" && hostId !== "android") {
  console.error("Usage: node relay-tester-mock-host.mjs --host=windows|android --secret=<value> [--endpoint=URL] [--quality=N] [--connected=true|false] [--instance=id]");
  process.exit(1);
}
const secret = args.secret || process.env[`PHONE_RELAY_V2_SECRET_${hostId.toUpperCase()}`] || "";
if (!secret) {
  console.error(`No secret provided. Pass --secret=<value> or set PHONE_RELAY_V2_SECRET_${hostId.toUpperCase()} in the environment.`);
  process.exit(1);
}
const endpoint = args.endpoint || process.env.PHONE_RELAY_V2_ENDPOINT
  || "https://us-central1-onetaskonly-app.cloudfunctions.net/phoneRelayV2";
const quality = Number(args.quality ?? 80);
const connected = args.connected !== "false";
const hostInstanceId = args.instance || "mock";

function log(...a) {
  console.log(`[mock-${hostId}]`, new Date().toISOString().slice(11, 23), ...a);
}

async function main() {
  log(`requesting relay token from ${endpoint} ...`);
  const tokenRes = await fetch(`${endpoint}?action=relaytoken`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Relay-Secret": secret },
    body: JSON.stringify({ hostType: hostId, hostInstanceId }),
  });
  if (!tokenRes.ok) {
    throw new Error(`relaytoken failed: HTTP ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const { customToken } = await tokenRes.json();
  log("got custom token, signing in...");

  const app = initializeApp(FIREBASE_CONFIG);
  const auth = getAuth(app);
  await signInWithCustomToken(auth, customToken);
  log("signed in as", auth.currentUser.uid);

  const db = getDatabase(app);
  const presenceRef = ref(db, `phone-relay-v2/presence/${hostId}`);
  const commandsRef = ref(db, "phone-relay-v2/commands");
  const leaderRef = ref(db, "phone-relay-v2/leader");

  // Queue the disconnect operation BEFORE going online (Firebase's documented
  // presence pattern) so even a crash between here and the first heartbeat
  // still clears presence — no client-side cleanup code required.
  await onDisconnect(presenceRef).remove();
  log("onDisconnect armed — presence clears itself the instant this connection drops, clean or not.");

  let currentLeader = null;
  onValue(leaderRef, (snap) => {
    currentLeader = snap.val();
    const mine = currentLeader?.hostId === hostId;
    log(`leader update: hostId=${currentLeader?.hostId || "(none)"} fencingToken=${currentLeader?.fencingToken ?? "-"}${mine ? "  <- I AM LEADER" : ""}`);
  });

  async function heartbeat() {
    await set(presenceRef, { t: serverTimestamp(), connected, quality });
    log(`presence heartbeat sent (connected=${connected}, quality=${quality})`);
  }
  await heartbeat();
  const heartbeatTimer = setInterval(() => { heartbeat().catch((e) => log("heartbeat error:", e.message)); }, 15000);

  // Command drain: clear-before-dispatch (same at-most-once contract v1 used),
  // now fencing-token-checked so a command queued for a since-superseded
  // leader is visibly rejected instead of silently executed twice.
  onValue(commandsRef, async (snap) => {
    try {
      const raw = snap.val();
      const list = Array.isArray(raw) ? raw : (raw && typeof raw === "object" ? Object.values(raw) : []);
      if (!list.length) return;
      await set(commandsRef, null);
      for (const cmd of list) {
        const amLeader = currentLeader?.hostId === hostId;
        const tokenMatches = cmd.fencingToken === (currentLeader?.fencingToken ?? -1);
        if (amLeader && tokenMatches) {
          log(`EXECUTING command ${cmd.id}: ${cmd.path}`);
        } else {
          log(`REJECTING stale/misdirected command ${cmd.id}: ${cmd.path} (amLeader=${amLeader}, cmdToken=${cmd.fencingToken}, currentToken=${currentLeader?.fencingToken})`);
        }
      }
    } catch (e) {
      log("command-drain error:", e.message);
    }
  });

  // Periodic fake state push — exercises the Firestore write + Zod schema
  // validation path end to end.
  async function pushState() {
    const body = {
      hostId,
      fencingToken: currentLeader?.fencingToken || 0,
      status: { connected, mock: true },
      messages: [{ id: "mock-1", body: "hello from mock host", sendStatus: "sent" }],
      calls: [],
      contacts: [],
    };
    const r = await fetch(`${endpoint}?action=push&hostType=${hostId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Relay-Secret": secret },
      body: JSON.stringify(body),
    });
    log(`state push -> HTTP ${r.status}`);
  }
  await pushState();
  const pushTimer = setInterval(() => { pushState().catch((e) => log("push error:", e.message)); }, 30000);

  process.on("SIGINT", async () => {
    log("SIGINT received — releasing presence gracefully before exit...");
    clearInterval(heartbeatTimer);
    clearInterval(pushTimer);
    try { await set(presenceRef, null); } catch {}
    process.exit(0);
  });

  log("mock host running. Ctrl+C for graceful shutdown; kill -9 to simulate a crash (onDisconnect still fires).");
}

main().catch((e) => {
  console.error("[mock-host] fatal:", e);
  process.exit(1);
});
