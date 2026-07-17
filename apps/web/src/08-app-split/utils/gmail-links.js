// ── Gmail deep links ─────────────────────────────────────────────────────────
// Owner ticket 7/16: multi-account messages carry sourceAccount = the account's
// EMAIL (google-workspace.js tags them), but the old links pasted that email into
// Gmail's numeric session slot — mail.google.com/mail/u/<email>/ — which is a
// guaranteed 404 page on any device. Gmail's supported way to target an account
// by address is the authuser query parameter; Google then redirects to whichever
// /u/<n>/ session matches, so the link works regardless of the browser profile's
// account order. The hash targets the CONVERSATION, so prefer threadId — a reply's
// own message id may not resolve as a conversation id.
export function gmailDeepLink(msg = {}) {
  const conversation = encodeURIComponent(String(msg.threadId || msg.id || "").trim());
  const account = String(msg.sourceAccount || "").trim();
  return account
    ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#inbox/${conversation}`
    : `https://mail.google.com/mail/u/0/#inbox/${conversation}`;
}
