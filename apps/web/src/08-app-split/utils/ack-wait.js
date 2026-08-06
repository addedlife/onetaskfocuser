// ── Relay command acknowledgement tracker ───────────────────────────────────
// Both phone surfaces queue a command in the cloud mailbox, get an id back, and
// then have to answer one question: did the host actually RUN it? The host
// answers by putting a result object into `commandResults`, which rides its next
// state push. This module owns the waiting, so the two surfaces cannot drift
// apart again — and so the waiting is testable without React.
//
// Why the wait must be ACTIVE (owner ticket PZw6eQft, second report: "the poll
// isn't getting a response in the first wait method no matter how long it
// waits"): the NerveCenter surface runs no REST poll once seeded — it relies
// entirely on the Firestore onSnapshot listener. When that listener is slow or
// not delivering, NOTHING feeds the ack wait, so it expires no matter how long
// it is. Lengthening a wait that nothing feeds cannot help. awaitAck therefore
// goes and asks on a fixed cadence instead of waiting to be told.
//
// The second half of the same bug: both surfaces used to call refresh() right
// after the wait expired — a fetch that very often carried the ack — and then
// branch on the already-null result, throwing the answer away and reporting a
// send as failed while the host log showed it sent. `get()` after any refresh
// is the cheap guard against that, and awaitAck's final re-check does it too.

export function createAckTracker({ limit = 60 } = {}) {
  const acks = new Map();      // command id → { id, ok, error, ... }
  const waiters = new Map();   // command id → resolve(ack)

  // Feed in a host's `commandResults` array. First result for an id wins; a
  // later duplicate of the same id is ignored so a re-sent state blob cannot
  // rewrite a verdict the caller already acted on.
  function record(results) {
    if (!Array.isArray(results)) return;
    for (const r of results) {
      if (!r || !r.id || acks.has(r.id)) continue;
      acks.set(r.id, r);
      while (acks.size > limit) acks.delete(acks.keys().next().value);
      const waiter = waiters.get(r.id);
      if (waiter) { waiters.delete(r.id); waiter(r); }
    }
  }

  function get(id) {
    return acks.get(id) || null;
  }

  // Resolve as soon as this id is acknowledged, or with null after timeoutMs.
  // Passive: something else must call record().
  function waitOnce(id, timeoutMs) {
    return new Promise(resolve => {
      const existing = acks.get(id);
      if (existing) { resolve(existing); return; }
      const timer = setTimeout(() => { waiters.delete(id); resolve(null); }, timeoutMs);
      waiters.set(id, ack => { clearTimeout(timer); resolve(ack); });
    });
  }

  // Active wait: sit in short slices, and between slices call `poll` (a fetch of
  // the relay state that ends in record()). Returns the ack, or null once the
  // deadline passes. A failing poll is never a verdict — the next slice retries.
  async function awaitAck(id, { timeoutMs, pollMs = 3000, poll } = {}) {
    const existing = acks.get(id);
    if (existing) return existing;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const slice = Math.min(pollMs, deadline - Date.now());
      const ack = await waitOnce(id, slice);
      if (ack) return ack;
      if (poll) {
        try { await poll(); } catch { /* transient — keep going to the deadline */ }
        const polled = acks.get(id);
        if (polled) return polled;
      }
    }
    // One last look: a record() that landed while the final slice was unwinding
    // is an answer, not a timeout.
    return acks.get(id) || null;
  }

  return { record, get, waitOnce, awaitAck, size: () => acks.size };
}
