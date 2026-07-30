// ── Which phone controls can actually work, and where ────────────────────────
//
// Pure data + pure functions, no imports, so the node suite (`npm run test:phone`)
// exercises exactly what production runs — the same contract as phone-link.js.
// The DeskPhone Web surface, its Settings tab and its Developer Tools tab all read
// this one table, so a control's disabled state and the error a click would have
// produced can never disagree.
//
// Commands the cloud relay will even attempt. Everything else is refused before
// it is queued, with a reason from commandAvailability() below.
export const CLOUD_ALLOWED_COMMANDS = new Set([
  "/dial", "/answer", "/hangup", "/toggle-mute", "/send", "/refresh", "/connect",
  "/mark-conversation-read", "/mark-conversation-unread",
  "/delete-message", "/toggle-message-pin", "/save-contact", "/delete-contact",
]);

// Owner ticket 7/29: "many functions in phone and settings and developer logs are
// unworking in the webapp or old stuff that's not needed or used."
//
// This page drives 44 distinct host commands. The loopback host implements all of
// them, so on DeskPhone's own window (port 8765) everything works. Over the cloud
// relay only the whitelist above is even attempted, and until now every other
// control failed AFTER the click with one generic sentence. Audited command by
// command against `ControlApiService.cs` (Windows loopback, 71 routes),
// `RelayService.cs` (the Windows relay's own dispatch switch, 10 cases) and
// `HostService.kt` (the Android host, which dispatches relayed commands through
// its local API generically and so covers 26):
//
//   HOST_DESKTOP_ONLY   opens a window, an OS dialog or a folder ON that PC.
//                       There is nothing for a remote browser to relay — these
//                       are correctly local and are now disabled with a reason
//                       instead of failing on click.
//   HOST_LOOPBACK_ONLY  a real phone/store operation the Windows host implements
//                       locally but which no host dispatches over the relay, so
//                       it only works inside DeskPhone's own window.
//   PC_RELAY_GAP        whitelisted and relayable, implemented by the Android
//                       host, but MISSING from RelayService.cs's dispatch switch —
//                       so it works when the tablet holds the phone and comes back
//                       "unknown command" when the PC does. That asymmetry is the
//                       whole reason message delete/pin kept coming back as a
//                       ticket. The fix is a host build (see docs/ops/
//                       VERIFICATION_LOG.md); this table is what makes the failure
//                       legible in the meantime.
export const HOST_DESKTOP_ONLY = new Set([
  "/open-live-log", "/clear-log", "/run-ui-auditor", "/open-bluetooth-settings",
  "/open-sound-settings", "/open-contact-sync-folder", "/toggle-main-window",
  "/reset-ui-scale", "/export-messages-backup", "/import-starter-vcf",
  "/import-pending-contacts", "/skip-pending-contacts", "/audio-refresh",
  "/show-build-update-prompt", "/accept-build-update", "/snooze-build-update",
  // Bluetooth pairing drives the radio of the machine that holds the link.
  "/scan-devices", "/connect-saved-device", "/connect-scanned-device",
  "/forget-saved-device", "/set-default-saved-device",
]);
export const HOST_LOOPBACK_ONLY = new Set([
  "/delete-call-entry", "/undo-call-history-delete", "/delete-all-call-history",
  "/undo-message-delete", "/toggle-call-block", "/set-history-paused",
]);
export const PC_RELAY_GAP = new Set([
  "/delete-message", "/toggle-message-pin", "/save-contact", "/delete-contact",
]);

// Can this command work right now? `{ ok, reason }` — `reason` is shown to the
// user verbatim, as a disabled control's tooltip or as the thrown error, so it
// says what to do rather than what failed.
export function commandAvailability(path, viaCloud, activeHostId = "") {
  const bare = String(path || "").split("?")[0];
  if (!viaCloud) return { ok: true, reason: "" };
  if (bare === "/send-with-attachments") {
    return { ok: false, reason: "Picture texts need the DeskPhone window open on this PC — the cloud relay carries text only. The words alone will send from here." };
  }
  if (HOST_DESKTOP_ONLY.has(bare)) {
    return { ok: false, reason: "This one lives inside the DeskPhone app on the PC — open DeskPhone on that machine to use it." };
  }
  if (HOST_LOOPBACK_ONLY.has(bare)) {
    return { ok: false, reason: "Only available inside the DeskPhone window on the PC — no phone host relays this one yet." };
  }
  if (!CLOUD_ALLOWED_COMMANDS.has(bare)) {
    return { ok: false, reason: `"${bare}" only works with the phone host open on this device.` };
  }
  if (PC_RELAY_GAP.has(bare) && activeHostId === "windows") {
    return { ok: false, reason: "The PC host's current build doesn't accept this over the relay. It works when the tablet holds the phone, or from DeskPhone's own window." };
  }
  return { ok: true, reason: "" };
}

// The host answers an unrecognised relayed command with a bare "unknown command
// /x", which told the owner nothing. Name the gap instead.
export function explainAckError(error, path, activeHostId = "") {
  const raw = String(error || "");
  const bare = String(path || "").split("?")[0];
  if (/^unknown command/i.test(raw)) {
    const holder = activeHostId === "android" ? "The tablet host" : activeHostId === "windows" ? "The PC host" : "The phone host";
    return `${holder} does not accept "${bare}" over the relay${PC_RELAY_GAP.has(bare) && activeHostId !== "android" ? " — it works when the tablet holds the phone, or from DeskPhone's own window" : ""}.`;
  }
  return raw;
}
