/**
 * Gmail push notifications — real push, no polling.
 *
 * Owner ticket (7/19): "new emails should post when they come in — that's the whole
 * point — how can I do that with a listener without polling?"
 *
 * You cannot put a Firestore listener on Gmail; onSnapshot is a Firestore feature.
 * So this bridges the two worlds:
 *
 *   Gmail (mail arrives)
 *     -> users.watch() has registered a Pub/Sub topic, so Google publishes instantly
 *     -> Pub/Sub topic "gmail-push"
 *     -> onGmailNotification (this file, a native v2 Pub/Sub trigger)
 *     -> writes a CHANGE FLAG to users/{uid}/pushState/mail
 *     -> the web app's onSnapshot fires and pulls fresh mail on demand
 *
 * Nothing polls anywhere in that chain.
 *
 * PRIVACY (owner decision 7/19): this deliberately stores NO message content. The
 * flag doc carries only "something changed, at this time, on this account". Subject
 * lines, senders and snippets are never written to Firestore — the app fetches those
 * straight from Gmail when it decides to display them, exactly as it does today. The
 * cost is a short fetch when mail arrives; the benefit is that a database compromise
 * exposes timestamps, not correspondence.
 *
 * Gmail watches expire after 7 days (Google's hard limit), so renewGmailWatches
 * re-registers them daily. A watch that lapses means mail silently stops arriving,
 * which is the main failure mode worth guarding.
 */
const { onMessagePublished } = require("firebase-functions/v2/pubsub");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getAdminDb } = require("./_config.cjs");
const { accessTokenFor, listAccountDocs } = require("./google-workspace.js");

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const TOPIC_NAME = "projects/onetaskonly-app/topics/gmail-push";
// Google expires a watch 7 days out. Re-register anything inside this window so a
// missed renewal run doesn't leave a gap where mail stops flowing.
const RENEW_WHEN_WITHIN_MS = 3 * 24 * 60 * 60 * 1000;

// Reverse index so a notification (which identifies the mailbox only by email
// address) can find the user compartment it belongs to in a single read.
// Server-only: firestore.rules denies clients any access to this collection.
function watchIndexRef(db, email) {
  return db.collection("serverOnlyGmailWatches").doc(String(email).toLowerCase());
}

function pushStateRef(db, uid) {
  return db.collection("users").doc(uid).collection("pushState").doc("mail");
}

/**
 * Register (or refresh) a Gmail watch for every account a user has connected.
 * Safe to call repeatedly — Gmail treats a repeat watch as an extension.
 */
async function registerWatchesFor(user) {
  const db = getAdminDb();
  const accounts = await listAccountDocs(user);
  const results = [];
  for (const account of accounts) {
    const email = account.email;
    try {
      const accessToken = await accessTokenFor(user, email);
      const res = await fetch(`${GMAIL_API}/users/${encodeURIComponent(email)}/watch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ topicName: TOPIC_NAME, labelIds: ["INBOX"], labelFilterBehavior: "include" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
      await watchIndexRef(db, email).set({
        uid: user.uid,
        email,
        historyId: String(body.historyId || ""),
        expiration: Number(body.expiration) || 0,
        updatedAt: Date.now(),
      }, { merge: true });
      results.push({ email, ok: true, expiration: Number(body.expiration) || 0 });
    } catch (e) {
      console.error(`[gmail-push] watch registration failed for ${email}:`, e.message);
      results.push({ email, ok: false, error: e.message });
    }
  }
  return results;
}

/**
 * Pub/Sub trigger. A native v2 trigger rather than an HTTP endpoint on purpose:
 * Eventarc authenticates the delivery, so there is no public URL to secure and no
 * hand-rolled JWT verification to get subtly wrong.
 */
const onGmailNotification = onMessagePublished(
  { topic: "gmail-push", region: "us-central1", retry: false },
  async event => {
    let payload = {};
    try {
      const raw = event.data?.message?.data;
      if (!raw) return;
      payload = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    } catch (e) {
      console.error("[gmail-push] undecodable notification:", e.message);
      return;
    }
    const email = String(payload.emailAddress || "").toLowerCase();
    if (!email) return;

    const db = getAdminDb();
    const indexSnap = await watchIndexRef(db, email).get();
    if (!indexSnap.exists) {
      // A watch we no longer track — most likely a disconnected account whose watch
      // hasn't expired yet. Nothing to notify; it lapses on its own within 7 days.
      console.warn(`[gmail-push] notification for untracked mailbox ${email}`);
      return;
    }
    const { uid } = indexSnap.data();
    if (!uid) return;

    const historyId = String(payload.historyId || "");
    // The flag, and only the flag. changedAt is what the client listener keys on.
    await pushStateRef(db, uid).set({
      changedAt: Date.now(),
      account: email,
      historyId,
    }, { merge: true });
    await watchIndexRef(db, email).set({ historyId, lastNotifiedAt: Date.now() }, { merge: true });
  },
);

/**
 * Daily renewal. Gmail hard-expires a watch after 7 days; without this, push simply
 * stops and mail appears to silently stall.
 */
const renewGmailWatches = onSchedule(
  { schedule: "17 7 * * *", timeZone: "America/New_York", region: "us-central1" },
  async () => {
    const db = getAdminDb();
    const snap = await db.collection("serverOnlyGmailWatches").get();
    const cutoff = Date.now() + RENEW_WHEN_WITHIN_MS;
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      if (Number(data.expiration || 0) > cutoff) continue;
      if (!data.uid) continue;
      try {
        await registerWatchesFor({ uid: data.uid, email: data.email || "" });
        console.log(`[gmail-push] renewed watch for ${doc.id}`);
      } catch (e) {
        // Expected weekly while the OAuth consent screen stays in Testing mode:
        // refresh tokens expire after 7 days and the user must sign in again.
        console.error(`[gmail-push] renewal failed for ${doc.id}:`, e.message);
      }
    }
  },
);

module.exports = { registerWatchesFor, onGmailNotification, renewGmailWatches };
