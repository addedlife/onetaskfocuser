// ── Can the host on the other end actually RECEIVE a command? ───────────────
//
// A phone host authenticates twice, on two independent channels:
//   • state pushes   → Firestore, with the public web API key
//   • command mailbox → Realtime Database, needing a relay_device token minted
//     from the host's per-device secret, which the owner must have approved
//
// They fail separately. A host whose device is pending approval (or whose key
// the cloud is refusing) keeps pushing a perfectly healthy status blob, so every
// remote indicator stays green while queued commands are never drained. The
// browser then waits out its full ack window and reports a timeout — the owner's
// 7/29 ticket word for word: "not sending and timing out … even though deskphone
// is up and running and all indicator panels are green".
//
// Hosts from b347 report `status.commandChannel`. Read it BEFORE queueing, so a
// deaf host produces an instant, specific refusal instead of a 30 s wait and a
// verdict that names nothing. Older hosts omit the field entirely; absent means
// "unknown", which must stay permissive — refusing to send because a host
// predates the field would be a worse bug than the one this fixes.
export function commandChannelHealth(status) {
  const ch = status?.commandChannel || status?.CommandChannel;
  if (!ch || typeof ch !== 'object') return { known: false, ok: true, reason: '' };

  const draining = ch.draining ?? ch.Draining;
  const reachable = ch.reachable ?? ch.Reachable;
  const enrollState = String(ch.enrollState ?? ch.EnrollState ?? '').toLowerCase();
  const authBlocked = ch.authBlocked ?? ch.AuthBlocked ?? null;

  // Parked host — the OTHER host holds the phone and is the one draining. That
  // is the arbitration rule working correctly, not a fault, and this host has no
  // standing to refuse a send on its behalf.
  if (draining === false) return { known: true, ok: true, parked: true, reason: '' };

  if (enrollState === 'pending') {
    return {
      known: true, ok: false,
      reason: 'This phone host is waiting for your approval, so it can’t receive commands yet. ' +
              'Approve it in Settings → Account → Phone hosts, then try again.',
    };
  }
  if (enrollState === 'revoked') {
    return {
      known: true, ok: false,
      reason: 'This phone host has been revoked, so it can’t receive commands. ' +
              'Re-approve it in Settings → Account → Phone hosts.',
    };
  }
  if (authBlocked) {
    return {
      known: true, ok: false,
      reason: `The phone host can’t sign in to the command channel: ${String(authBlocked)}`,
    };
  }
  if (reachable === false) {
    return {
      known: true, ok: false,
      reason: 'The phone host is online but has never reached the command mailbox, ' +
              'so a text queued here would sit unread. Restart the host and try again.',
    };
  }
  return { known: true, ok: true, reason: '' };
}

/** Short label for a status chip. '' when there is nothing worth saying. */
export function commandChannelLabel(status) {
  const h = commandChannelHealth(status);
  if (!h.known || h.ok) return '';
  return 'Not receiving commands';
}
