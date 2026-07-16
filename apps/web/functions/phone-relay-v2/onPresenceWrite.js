// Event-driven leader election. v1's arbitration was a client-side heuristic
// re-run on a 15s heartbeat with a 90s staleness window — a crashed host
// could appear to hold the phone for up to 90s. Presence writes now carry
// onDisconnect() (armed by each host the instant it connects), so RTDB itself
// notices a dropped connection within seconds; this function reacts to that
// write immediately instead of polling, recomputes the winner via the one
// canonical scoring implementation (arbitration.js -> vendored phone-link.js),
// and writes a monotonically increasing fencing token so a stale leader that
// wakes up late can never be mistaken for the current one.
const { onValueWritten } = require("firebase-functions/v2/database");
const { getAdminDatabase } = require("../_config.cjs");
const { computeLeader } = require("./arbitration.js");

exports.onPhoneRelayV2PresenceWrite = onValueWritten(
  { ref: "/phone-relay-v2/presence/{hostId}", region: "us-central1" },
  async () => {
    const db = getAdminDatabase();
    const [presenceSnap, leaderSnap] = await Promise.all([
      db.ref("phone-relay-v2/presence").get(),
      db.ref("phone-relay-v2/leader").get(),
    ]);
    const presence = presenceSnap.val() || {};
    const currentLeader = leaderSnap.val() || null;
    const next = await computeLeader({ presence, currentLeader, now: Date.now() });
    if (next.changed) {
      const { changed, ...toWrite } = next;
      await db.ref("phone-relay-v2/leader").set(toWrite);
    }
  }
);
