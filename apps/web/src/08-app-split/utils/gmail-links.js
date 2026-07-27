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

// The plain "Open Gmail" destination — the inbox, for a KNOWN account.
//
// Owner ticket: "is there a way to specifically open Gmail in the account at which
// the email was received, now ill get an email for example to rabbidanziger and
// open email takes me to Ydanziger as that's what it was open to before." Every
// Open-Gmail entry point was hardcoded to /mail/u/0/, and /u/0 is not an account —
// it is a SESSION SLOT, meaning whichever account that browser profile happens to
// have in position zero. So the button always landed wherever Gmail was last left.
// authuser names the account by address and lets Google pick the slot, which is the
// same mechanism gmailDeepLink already uses for a specific message.
export function gmailInboxLink(account = "") {
  // Accepts an email, or an account object from the status endpoint — the server
  // returns plain strings but the account list has carried objects too, and
  // String({}) silently produces "[object Object]", which Gmail answers with a
  // sign-in-chooser page. Anything that is not recognisably an address falls back
  // to the plain inbox rather than shipping a broken authuser.
  const raw = typeof account === "string" ? account : (account?.email || account?.googleEmail || "");
  const email = String(raw || "").trim();
  return email.includes("@")
    ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#inbox`
    : "https://mail.google.com/mail/u/0/#inbox";
}

// Reply / reply-all deep link for the NerveCenter mail reader (owner ticket
// WUQh8VL). Gmail's `#inbox/<conv>` hash opens the thread but not a composer;
// appending `?compose=...` is unreliable, while the documented `to`/`su`/`body`
// compose form does not thread. The one form Gmail honours for a THREADED reply
// is the conversation hash plus the reply action segment, which opens the thread
// with its inline composer already focused — reply, or reply-all with `?all`.
//
// Sending from inside NerveCenter itself is NOT possible yet: the app only holds
// Gmail read scope (google-workspace.js exposes gmailMessage and nothing that
// sends), so an in-app send needs the gmail.send scope added to the consent
// screen — a permissions change, and the owner's call.
export function gmailReplyLink(msg = {}, all = false) {
  const base = gmailDeepLink(msg);
  return `${base}?compose=new&replyType=${all ? "replyAll" : "reply"}`;
}
