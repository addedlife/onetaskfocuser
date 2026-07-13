# PC handoff — phone-link overhaul (2026-07-10)

> **PC session status (2026-07-10 ~12:15 PM):**
> - §1 Pull — done.
> - §2 DeskPhone b329 — built, deployed, `/status` confirms `b329` running with HFP+MAP connected.
> - §3 Android APK — built (`app-debug.apk`, 12:05 PM) and handed to the owner to sideload on the tablet; **not yet confirmed installed**.
> - Found + fixed a 4.37.125 ship-stopper: `phone-host-control.js` re-exported `OWNER_LIVE_WINDOW_MS` without importing it, so the whole app crashed on load (`ReferenceError`). Fixed in 4.37.126, tests 19/19, deployed to Firebase hosting, verified live.
> - §4 — state machine + live feed verified from the PC (PC currently holds the phone). Send-a-text, rail-toggle handoff, and kill-the-tablet-host checks are pending the owner + tablet install.
> - §5 legacy-fallback removal — **do NOT do yet**; tablet host still on the pre-cid build.

_Written by the cloud Claude session that shipped web 4.37.125. The web half is
already live; this doc is the exact to-do for the PC, where the two host apps
must be rebuilt. If you open Claude Code locally, point it at this file._

## Why you're here

The web app now sends a **client message id** (`cid`) with every text and
reconciles send bubbles by that id, and both hosts got code changes so the id
survives the round trip. Until the hosts are rebuilt, the web falls back to
fuzzy matching (still works, just heuristic). Rebuilding both hosts completes
the upgrade and also activates the earlier send-double reconcile fixes.

## 1. Pull

```powershell
cd "C:\Users\ydanz\OneDrive\Documents\Shamash Pro 4 App"
git pull origin main
```

## 2. Rebuild + deploy DeskPhone (Windows host)

Changed files (all committed, no local edits needed):
- `Services/ControlApiService.cs` — `/send` + `/send-with-attachments` accept `cid`
- `Services/RelayService.cs` — relay `/send` passes `cid` through
- `ViewModels/MainViewModel.cs` — `_pendingClientMessageId` → `LocalId`
- `Services/MessageStoreService.cs` — 15-min reconcile window (b329 pending) +
  LocalId preserved across phone-copy adoption

Use the normal release pipeline (same as b328): build Release, archive to
`deployed-builds/`, bump `build.num`, add the changelog entry, launch, and
confirm `/status` shows the new build number. Suggested changelog note:

> b329 — Send bubbles now carry the web composer's message id end-to-end, so a
> text sent from any browser reconciles exactly with the phone's sent copy (no
> more heuristic matching). Also widens the local-bubble↔phone-copy reconcile
> window to 15 min while a send is in flight (clock skew left "Confirming"
> doubles forever) and keeps bubble identity across adoption.

## 3. Rebuild + install the tablet host (Android)

Changed files:
- `HostService.kt` — `/send` reads `cid` (LAN and relay both route here)
- `store/Stores.kt` — `addLocalSent(..., clientMessageId)`; whitespace-tolerant
  echo adoption; `confirming` resolves to `sent` (from the previous batch)

Build in Android Studio (or `gradlew assembleRelease` in
`apps/phone-host-android/`), install on the Galaxy tablet, confirm the
build banner in the app and that texts/calls still flow.

## 4. Verify end-to-end (5 minutes)

1. On any browser, open the phone page with `?phonediag=1` — a black overlay
   shows the raw state machine. Confirm `state: "connected"` and the active
   host.
2. Send a text from the browser. The bubble should read **Sending…** instantly,
   flip to sent, and NEVER show a second copy. In the diag overlay,
   `pendingEchoes` should appear and then empty within one push (~1–2 s on
   relay) — that's the cid reconcile working.
3. Flip the rail toggle (Phone: Tablet ⇄ PC). The label should read
   "Handing to …" and then show the new holder within ~30 s.
4. Kill the tablet host. Within ~60 s every surface should read
   "Offline — showing texts & calls from Xs ago" — and the feed must NOT blank.

## 5. After both hosts are confirmed on the new builds

Tell the next Claude session to remove the legacy fallbacks (they only exist
for pre-rebuild hosts):
- `STATE_FALLBACK_WINDOW_MS` path in `apps/web/src/08-app-split/phone-link.js`
- the fuzzy (non-cid) match branch in `pending-sms.js` `echoMatches`
- the "relay without command ids" blind-wait branch in
  `NerveCenterPhoneSurface.jsx` `post()`

## Architecture note (why nothing was rebuilt from scratch)

Device roles, confirmed 2026-07-10: the phone cannot install apps → Bluetooth
host is mandatory; the Galaxy tablet (no SIM) is the always-on primary BT
host; the PC is standby host + call audio; the iPad is a pure web consumer.
Given that, the current tablet-primary + owner-doc arbitration + cloud relay
is the right shape — the reliability work went into one shared state machine
(`phone-link.js`), exact message identity (`cid`), never-blank data, and a
committed test suite (`npm run test:phone`, 19 tests) instead of a rewrite.

---

## Addendum (2026-07-13) — three-lane link + auto-finder + call-feed record

Web 4.44.132 shipped the iPad/ActiveTab/PC toggle, the auto-finder (owner doc
`preferred` now also takes `ipad`/`auto`, plus a `hosts.{id}` presence map),
and the one-click "Record live call feed" lane. The web half is inert until
the native builds catch up. On the PC:

1. **DeskPhone (next b3xx)** — changed files, all committed:
   - `Services/RelayService.cs` — presence beacon (`WritePresenceAsync`, every
     arbitration tick, parked or not), `hosts` map parsing, auto/ipad
     arbitration via the ported `ChooseAutoHost`, `SetPreferredAsync` accepts
     all four values.
   - `Services/CallAudioBridgeService.cs` — plug-and-play carkit detection
     (`ResolveDownlinkDeviceId`/`ResolveUplinkDeviceId` by friendly-name
     markers); the downlink no longer silently opens the PC's own mic when the
     configured carkit vanished.
   Build/release per the normal pipeline; smoke: `/call-audio/state` shows the
   carkit auto-picked, and the owner doc grows `hosts.windows` within ~20 s.
2. **Android host (ActiveTab)** — `RelayClient.kt`: same presence beacon +
   auto arbitration port + four-value `writePreferred`. `gradlew assembleDebug`,
   sideload, confirm `hosts.android` appears.
3. **iPad bridge** — needs a Mac with Xcode: new
   `WebPhoneBridge/RelayPresenceService.swift` (already in the pbxproj).
   After install, `/status` gains a `cloudRelay` block and the owner doc grows
   `hosts.ios`; flipping the rail toggle to iPad starts state pushes through
   the LAN proxy.
4. **Verify auto mode**: tap the rail "Auto" chip → owner doc `preferred:
   "auto"`; kill the tablet host mid-session → the PC should take the phone
   within ~60–90 s (presence stale + takeover grace), and the web card should
   read "Connected · PC (auto)".
5. **MCP bug tools**: `apps/web/functions/mcp.js` gained
   `list_bugs`/`add_bug_note`/`set_bug_status` — deploys with the normal
   functions deploy; then cloud Claude sessions can autopull the Bug Log.
