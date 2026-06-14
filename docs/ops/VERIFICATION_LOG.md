# Verification Log

## 2026-06-14 DeskPhone b320 — theme propagation to standalone WebShell (4.17.65)

- Scope: theme propagation in the standalone WebView2 native shell (`WebShellWindow`) which was previously rendering default colors (`T=GV_CLEAN`) since it has no parent iframe to send it `postMessage` theme events.
- Fix:
  - C# host: `AppSettingsService.Settings` persists `LastThemeColors` dictionary across app restarts; `MainViewModel.cs` updates this dictionary inside `ApplyTheme` and invokes `mw.PushThemeToWebShell` to dispatch a WebView2 `dp-theme-update` message; `/status` endpoint exposes `activeTheme` containing `palette` and `colors`.
  - WebView2: `WebShellWindow` stores `_lastColors` and pushes to `Web.CoreWebView2` as soon as it initializes.
  - Web (`main.jsx`): `StandaloneShell` fetches initial theme colors from `/status` on mount and listens for `dp-theme-update` web messages via `window.chrome.webview` to update React state `T` in real-time.
  - Settings: Removed the redundant, non-functional "Dark mode" toggle checkbox from appearance panel in `10-deskphone-web.jsx`.
- Gates: `npm run build` → 0 errors, bundle `index-DzbVC8Eo.js`; `dotnet build -c Release` → 0 errors + deploy.ps1 OK. BUILD-VERIFIED — b320 deployed, launched, and checked.


## 2026-06-14 DeskPhone b314 — message-list responsive layout (4.17.62)

- Scope: finish rate-limit-frozen Cursor session — CSS-only fix for the DeskPhone WebView2 message-list column overflow + stacked layout chrome.
- Web (`10-deskphone-web.jsx`, v4.17.62): `dp-message-shell` made a container-query root (`container-type:size`, `container-name:message-shell`). List column changed from `minmax(210px, saved-width)` to `minmax(0, min(saved-width, 36cqw))` so the saved drag width is a cap, not a floor — list shrinks proportionally. `@container message-shell (≤720px)` stacks list above thread based on actual shell width instead of viewport; `@container (≤900px)` trims filter buttons and avatars for denser rows. Stacked/narrow states hide filter tabs, history badge, phone-number subtitle; `dp-thread-calls` compacted to `min(152px,28vh)` with muted sidebar bg and small uppercase `CALLS` label; vertical split row heights reduced `220–320px → 128–240px`.
- Native host (b314): `changelog.json` + `build.num` 314→315; Release build archived to `deployed-builds/b314`; desktop shortcuts updated (Latest + Previous b313); deploy commit `009e6ff`. Running b313 received build-update handoff offer.
- Web commit `235986a` pushed to `origin/main`; Netlify Git-triggered deploy initiated.
- Gates: `npm run build` (apps/web) → 0 errors, bundle `index-CjZmGE6O.js`; `dotnet build -c Release` → 0 errors + deploy.ps1 OK. BUILD-VERIFIED ONLY — runtime smoke on live DeskPhone WebView2 shell recommended after accepting b314 handoff.

## 2026-06-14 DeskPhone WebView2 — WPF UI toggle, resize reflow, thread search scope (4.17.61)

- Scope: finish interrupted session — three DeskPhone WebView2 fixes shipped together (web + native host source).
- Web (`10-deskphone-web.jsx`): thread header (including conversation search) moved inside `dp-thread-messages` so search no longer spans the call-history rail; container queries on thread pane/messages stack call history below messages when pane ≤700px and wrap header controls when messages column ≤520px; flexible grid min-widths replace rigid 340px/260px floors that caused overflow on drag-resize.
- Native host (`ControlApiService.cs`, `MainWindow.xaml.cs`, `MainViewModel.cs`, `WebShellWindow.xaml`): `POST /toggle-main-window` + `mainWindowXamlVisible` in `/status`; Settings → Appearance button shows/hides legacy WPF MainWindow (default hidden); WebView2 stretches/clips to window bounds.
- Gates: `npm run build` (apps/web) → 0 errors; `dotnet build -c Debug` (phone-host-windows) → 0 errors. BUILD-VERIFIED ONLY for resize reflow and WPF toggle — runtime smoke on live DeskPhone WebView2 shell recommended.

## 2026-06-14 DeskPhone b313 — native Release deploy (WebView2 reflow + WPF toggle)

- Scope: changelog + Release deploy for the b313 host build carrying the WebView2 fixes from 864d953.
- b313 (`changelog.json`, `build.num` 313→314): Release build archived to `deployed-builds/b313`; desktop shortcuts updated (Latest + Previous b312); deploy commit `f3d6d37`.
- Gates: `npm run build` → 0 errors; `dotnet build -c Release` → 0 errors + deploy.ps1 OK. RUNTIME-VERIFIED: `http://127.0.0.1:8765/status` reports `"build":"b313  06/14/26 1:19 am"`, `mainWindowXamlVisible:false`. Running instance received build-update handoff offer (user accept required).

## 2026-06-12 One design system — DeskPhone teal restyle (b303), webapp embeds DeskPhone (4.17.49), tokens consolidated (4.17.50)

- Scope: three sequential releases. (1) b303: WPF DeskPhone restyled to match the web phone screen exactly — pure style, zero functional changes. (2) web 4.17.49: the desktop Phone screen auto-embeds the UI DeskPhone itself serves when the loopback host answers. (3) web 4.17.50: 10-deskphone-web's COLORS palette now derives from ui-tokens GV_CLEAN.
- b303 (`Themes/Palettes/Google.xaml`, `App.xaml`, `MainViewModel.cs`): every blue accent key → teal family (#00796B/#00695C/#E0F2F1/#003731 = GV_CLEAN.accent family); beyond the spec table, the remaining blue-tinted neutrals were also de-blued to the web phone's actual values (sidebar/hover/input surfaces, green/red accents, text greys, BubbleIn/Border) so the app truly matches — amber family kept (no web equivalent), BgSelected kept at the specced #E0F2F1 (note: web uses #F1F3F4 there). App.xaml default palette BlueGold → Google (runtime still applies PreferredPalette: light=Google, dark=BlueGold). Removed the b301 OpenModernUiOnLaunch auto-open block; `OpenModernUiCommand` (manual button) stays. Also committed WebShellWindow.xaml(.cs) — shipped in b299 but never tracked; the repo did not compile from a clean clone without them.
- 4.17.49 (`App.jsx`, `NerveCenterPhoneSurface.jsx`, `ui-tokens.jsx`): the spec targeted NerveCenterPhoneSurface, but on desktop the full Phone view renders DeskPhoneWebPanel directly in App.jsx (the non-compact surface only renders on mobile, where loopback is unreachable by definition) — so the goal was implemented in App.jsx: a 1.5s `/status` probe (re-probe every 25s) swaps DeskPhoneWebPanel for an iframe of `http://127.0.0.1:8765/?standalone=deskphone` with a 200ms `nc-phone-surface-fade` (DUR.base); falls back transparently when the PC dies. The specced surface-level swap was also added (engages via its existing transport resolution). Host verified to send no X-Frame-Options/CSP — no host change needed. Chromium-only by design; browsers that block HTTP-loopback frames also fail the probe.
- 4.17.50 (`10-deskphone-web.jsx`): COLORS keeps its role names but 12 of 20 keys now reference GV_CLEAN (bg/hover/bgSoft/accent/accentDark/success/danger/text/muted/faint/divider); 8 literals stay local with no GV_CLEAN equivalent (light accent tints #E0F2F1/#CEEAD6/#FCE8E6, #137333, textSecond #3C4043, textOnAccent, border-strong #BDC1C6). Zero values changed. Audited clean (nothing replaceable without changing values): NerveCenterPanel (category/priority fallbacks), TaskRiverPanel (river lane palette), SuitePanels (error tints), AppSuiteChrome + 06-shelf (hex-free), 04-components (legacy OneTask warm theme — different design language by intent).
- Gates: b303 `dotnet build -c Release -p:Platform=ARM64` → 0 errors, deployed + relaunched, `/status` reports "b303 06/12/26 12:02 am". Web: `npm run build` → 0 errors ×2. RUNTIME-VERIFIED in dev preview: `?suite=phone` rendered the DeskPhone iframe with live conversations (probe → direct → embed); `?standalone=deskphone` surface resolves --dp-blue #00796B / --dp-border #DADCE0 / surface #FFFFFF from tokens, "This device: b303". Commits 3aa7c5f, 5398ee8, 556325d, a656d5c.

## 2026-06-10 NC boxes view — denser task rows, card expand-to-page, Tasks/Shailos icon swap (4.15.37)

- Reported: mobile unstacked (boxes) view tasks list still too spacious — halve it (~2 more tasks visible); each card should expand on tap to full page height; Shailos' checklist icon ("rule") should move to Tasks, with Shailos getting a classy question mark.
- Density root cause (shipped from prior session, was uncommitted): `index.html` sets `button{min-height:36px}` globally; min-height beats height, so every icon button shorter than 36px silently propped row heights open. `gvIconButton` now sets inline `minHeight` from its height override (`ui-tokens.jsx`). On top of that, boxes-view task-row Done/Delete buttons shrank 22→16px (compact) / 30→24px (comfortable), comfortable `rowMinH` 28→22.
- Card expand (`NerveCenterPanel.jsx`): new ephemeral `expandedBoxId` state; rows-orientation boxes grid switches to `min-content`/`minmax(0,1fr)` rows. `MobileBox` gained `expanded`/`collapsed`/`onToggleExpand` — header tap toggles expand (was: open full surface; that moved to a trailing `open_in_new` button), collapsed cards render header-only via `display:none` content (Phone pollers stay mounted), scroll-away header suspended while expanded/collapsed. Desktop 5-column boxes unchanged.
- Icon swap: Tasks `task_alt`→`rule`, Shailos `rule`→`question_mark` across NerveCenterPanel (boxes, accordion, full panel, tab bar, action categories, signal chips), AppSuiteChrome rail, SuitePanels Shailos header, App.jsx shaila actions. The "Done" action keeps `task_alt`.
- Gates: `npm run build` (apps/web) → 0 errors. Preview-verified at 420px (desktop boxes layout): expand → 629px card + 22px strips, collapse → even 143px rows; icon names confirmed in a11y tree; 24px icon button computes min-height 24px (was 36).

## 2026-06-09 Mobile NerveCenter — Email/Calendar "loading forever" + cards stuck "Waiting on summary"

- Reported: On mobile browser, the Email and Calendar cards spin "Loading…" indefinitely, and every card stays on "Waiting on summary" with no summary ever arriving.
- Root cause (shared): no client-side fetch in the Google/AI load path had a timeout. A bare `fetch()` never rejects when a mobile connection stalls mid-flight (radio sleep), so a single stalled request hung forever. Two specific manifestations: (a) the browser-token loader awaited the AI email-summary job *inside* `fetchGmailData`, and set Calendar + Mail state together only after `Promise.allSettled([cal, mail])` settled — so a hung AI gateway froze the Calendar card too; (b) `callAIProxy` (NerveCenter `dashboard.nervecenter_summary.v1`) had no timeout, so a stalled AI request left `ncSummaryLoading` true forever → every card's signal note stuck on "Waiting on summary".
- Fix 1 (`01-core.js`): `callAIProxy` now uses an `AbortController` with a 30s timeout (server budget ≤26s). A stalled gateway aborts → returns null → callers degrade to "no summary" instead of an infinite spinner.
- Fix 2 (`App.jsx`): added a shared `fetchWithTimeout` (20s) and routed every Calendar/Gmail/Workspace fetch through it (`callGoogleWorkspace`, `fetchCalendarData` list+primary+per-calendar, `fetchGmailData` list+messages, `loadGoogleEmailDetail`). A dropped request now surfaces as a recoverable error, not a frozen card.
- Fix 3 (`App.jsx`): decoupled the browser-token load. Calendar and Mail now resolve and render independently (whichever finishes first), so a slow Mail step can no longer hold the Calendar card. The AI email summaries were pulled out of `fetchGmailData` into a non-blocking `applyEmailSummaries(msgs)` that renders raw mail first and merges one-line summaries by message id when (if) the AI returns.
- Fix 4 (`NerveCenterPanel.jsx`): the "Waiting on summary" caption now shows only while `ncSummaryLoading` is true. Once the AI job finishes (even producing nothing / gateway down), the caption clears so cards render their own content instead of a permanently stuck "Waiting…".
- Gates: `npm run build` (apps/web) → 0 errors, bundle `index-Cke9jSvq.js`. BUILD-VERIFIED ONLY — the timeouts/decoupling target a mobile network-stall failure mode that requires runtime verification on the affected device (use `?diag=1`).

## 2026-06-07 DeskPhone Connection Reliability — Faster Reconnect + Ghost-Connection Detection (b291)

- Reported: Connection still flaky and droppy after b285 fixes; requires frequent manual resets; phone coming back into range takes too long to auto-reconnect.
- Root cause 1 (slow reconnect after phone returns): `AutoReconnectRetryWindow` was 90s. After a failed attempt, the watchdog (30s interval) was rate-limited for 90s, meaning the phone could be back in range for up to 89s before the next attempt. The 90s was originally to cover the MAP retry cycle, but the in-flight guards (`_autoReconnectInFlight`, `IsConnecting`) already prevent concurrent reconnects. Fixed: 90s → 30s, matching the watchdog interval.
- Root cause 2 (HFP ghost-connection hangup): `SendAsync` had no write timeout. Ghost RFCOMM sockets accept `WriteLineAsync` silently (Windows buffers the write) without throwing, so the 30s keepalive probe write never failed and the read loop was permanently stuck. Fixed: added a 5s `CancelAfter` on the write in `SendAsync`; write timeout propagates to the outer `finally` → `StatusChanged("HFP disconnected")` → reconnect fires.
- Root cause 3 (MAP ghost-connection / silent poll-loop death): `PerformDeltaSyncAsync` had no wall-clock timeout — a dead RFCOMM socket could block the OBEX read indefinitely, freezing the poll loop. Worse: `catch (OperationCanceledException) { break; }` was not guarded by `ct.IsCancellationRequested`, so any `OperationCanceledException` (including a future sync timeout) would silently kill the poll loop. Fixed: (a) changed guard to `when (ct.IsCancellationRequested)` so non-shutdown OCEs fall to `catch (Exception ex) → QueueAutoReconnect`; (b) wrapped all per-round OBEX calls (FetchHandlesAsync, PerformDeltaSyncAsync, RefreshPhoneReadStates, ReconcileDeletes) in a 20s linked `CancellationTokenSource`.
- Gates: `dotnet build DeskPhone.csproj -p:Platform=ARM64 -c Release` → 0 errors, 2 pre-existing NU1603 warnings. b291 deployed (build.num → 292). Pushed `d332412` to origin/main. BUILD-VERIFIED ONLY — end-to-end requires runtime testing with a phone that drops in and out of range.

## 2026-06-07 Six NerveCenter / Phone Recurring Issues

- Issues: (1) missed-call resolve check insufficient; (2) no manual resolve button on web phone screen; (3) call/thread history capped too low; (4) accordion card fonts too small; (5) supercrunch brief sounding like advice; (7) task list diverges across devices.
- Root cause (1): `isMissedCallResolved` checked only `recentCalls` (sliced to 10), so any handling call outside the top 10 didn't count as a resolution. Fixed: now checks full `calls` array. Integrated with remote's `resolvedMissed` + `missedKey` scheme (persisted in localStorage, cross-tab sync via CustomEvent).
- Root cause (2): Web phone screen had no way to manually mark a missed call resolved if automatic detection didn't catch it. Remote commit `9d7b886` had already added a direct toggle button (green check / undo) directly on each call row. My duplicate in-menu button was removed; the row-level toggle remains.
- Root cause (3): Threads and recentCalls both sliced to 10; activity feed capped at 8/14. Fixed: 10→20 for threads/calls, 8/14→12/20 for activity feed.
- Root cause (4): `MobileSection` header title/preview at 11px, badge at 9px. Fixed: title/preview→13px, badge→11px. Chief brief signal area label NC_TYPE.small→meta (13px), note text NC_TYPE.control→15px. Kept remote's chip-icon design.
- Root cause (5): AI schema described `brief` as "3-5 sentence natural language synthesis" which models render as advisory prose. Fixed: schema and prompt instruction now specify "2-4 short declarative status statements — same clipped factual tone as signals, no framing or advice." Remote's Apple-style note description for signals preserved.
- Root cause (7): `_listenV5` in 01-core.js had a `wasInitialized` guard preventing the first Firestore snapshot from calling `onUpdate`. Tasks added on device A between `load()` completing and the first `onSnapshot` firing on device B would land in `taskCache` but never reach the UI — invisible until another change triggered a subsequent snapshot. Fix: removed the guard; first snapshot now always calls `onUpdate` when `changed=true`. App.jsx's `adoptedRemote` guard prevents the update from bouncing back as a save.
- Gates: `npm run build` (apps/web) → 0 errors, bundle `index-fFUoLPAJ.js`. Pushed to `origin/main` (commit `1ecba98`). BUILD-VERIFIED ONLY — cross-device task sync requires runtime verification with two live devices.

## 2026-06-05 DeskPhone Connection Reliability — Auto-Reconnect + Ghost-Connected Fix (b285)

- Reported: DeskPhone does not auto-reconnect when default phone comes back in range after being lost. Also reports "Connected" when the link has silently dropped and won't update calls/texts until user manually refreshes connection.
- Root cause 1 (no auto-reconnect after failed attempt): A failed reconnect attempt calls `ResetConnectionSessionAsync`, which cancels `_sessionCts` — killing the MAP poll loop. If MAP connect also fails (phone still out of range), `StartPollLoop` is never called, leaving nothing to invoke `QueueAutoReconnect` again after the 90s rate-limit window. The watchdog loop was missing.
- Root cause 2 (HFP disconnect doesn't trigger reconnect): `QueueAutoReconnect` was only called from the MAP poll loop. If MAP's RFCOMM was in a ghost-connected state (Windows BT RFCOMM holds sockets open for 30-120s after radio link loss), `_map.IsConnected` stayed true and the poll loop never detected the drop — even though HFP correctly fired "HFP disconnected". Nobody acted on that event.
- Root cause 3 (ghost connection undetected): No liveness probe on HFP. A quiet-but-dead connection looked identical to a quiet-but-alive one indefinitely.
- Fix 1 (HFP keepalive — `HfpService.cs`): `ReadLoopAsync` now sets a 30s read deadline per iteration via a linked `CancellationTokenSource`. On timeout (no AT traffic for 30s, not user-cancel), sends `AT+NREC=0` as a liveness probe. If the write throws (socket dead), exception propagates to outer catch → `StatusChanged("HFP disconnected")` fires. Ghost-connection detection window: max 30s (was: never / up to 120s).
- Fix 2 (HFP disconnect triggers reconnect — `MainViewModel.cs` `StatusHfp` setter): Added `QueueAutoReconnect("HFP status: " + value)` call when the new status is non-connected. Existing guards in `QueueAutoReconnect` (`IsConnecting`, `_nextAutoReconnectUtc`, `_autoReconnectInFlight`) make this safe: fires are suppressed during active connect/reset, during the 90s rate-limit window, and if a reconnect is already in flight.
- Fix 3 (persistent watchdog — `MainViewModel.cs`): Added `_appCts` (app-lifetime `CancellationTokenSource`, cancelled only in `Shutdown()`) and `StartConnectionWatchdog`. Watchdog runs every 30s on a background thread, calls `QueueAutoReconnect` when `!IsFullyConnected && !IsConnecting`. Because it uses `_appCts` (not `_sessionCts`), it survives any number of failed reconnect attempts that cancel `_sessionCts`. Started from `InitializeDataAsync` after initial auto-connect. Cancelled and disposed in `Shutdown()`.
- Gates: `dotnet build DeskPhone.csproj -p:Platform=ARM64 -c Release` → 0 errors, 2 pre-existing NU1603 warnings. b285 deployed and running DeskPhone notified. BUILD-VERIFIED ONLY — end-to-end (real drop + recovery) requires runtime verification on device.

## 2026-06-05 Profile Autoload Recovery + Phone-Relay Liveness

- Reported (two issues): (1) After signing in with Google, shailos + tasks access is restored, but a cold app start autoloads a "bad profile" with no access, forcing a manual sign-out/sign-in; (2) the phone relay works but the webapp can't tell whether the PC/DeskPhone is *currently* connected, so the user can't trust that live texts/calls are arriving.
- Root cause (1): data is foldered by email-prefix (`canonicalUid`) but the deployed Firestore rules authorize by the verified Google identity (see `01-core.js:151` note + `firestore.rules` `isAdmin()` keyed on `rabbidanziger@hocsouthbend.com`/`email_verified`). A persisted non-Google/unverified session that maps to the same folder cold-starts, gets a Firestore 403, and renders empty; the app had no `.catch` on `Store.load()` and no denial handling, so it silently showed the broken profile.
- Root cause (2): the relay `state` doc carried no freshness marker. The webapp lit the green "Live" cloud the instant it read the doc, even if the PC closed hours earlier — no way to distinguish a live link from a stale snapshot.
- Fix (1) — auth/profile (user chose "Auto + remember Google"): `00-auth.jsx` remembers the last working Google email (`ot_last_google_email`) on popup + redirect sign-in and pre-selects it via Google `login_hint`; AuthGate gains `handleSessionLostAccess` → sets a recovery notice + `signOut()` so the user lands on Google sign-in (one tap). `App.jsx` load effect now classifies a no-data load: it runs `Store.probeFirestore()` (authoritative REST probe) and only on a DEFINITIVE 401/403 DENIED — never a network BLOCK, never when usable local data exists, never for the dev user — calls `onSessionLostAccess()`. Guarded by sessionStorage `ot_access_recovery` (set on recovery, cleared on a confirmed-good load) so it can't loop. Added a `.catch` so a rejected load (the common permission-denied case) also recovers/falls back instead of hanging.
- Fix (2) — phone-relay liveness: `phone-relay.mjs` `push` now stamps `relayReceivedAt = Date.now()` into the state blob server-side (works without a DeskPhone rebuild; independent of the PC clock; falls back to raw store if the body isn't JSON). `NerveCenterPhoneSurface.jsx` reads `relayReceivedAt` from both the REST poll and the onSnapshot listener, ticks a 5s clock, and derives `relayStale`/`phoneLinkLive` against a 30s window (DeskPhone heartbeats ~5s). The control-bar indicator now shows green "Live" vs amber "cloud_off · {age}", a prominent stale banner appears when the PC looks offline, and `onOnlineChange`/`onStatusSummary`/`phoneActivitySnapshot` report true liveness so the NerveCenter tile can't claim "connected" over data from a closed PC. LAN/desktop path unchanged (liveness = the just-completed `/status` fetch).
- Gates: `npm run build` (apps/web) → 0 errors, bundle `index-CKuGaXfB.js`; markers `relayReceivedAt`/`cloud_off`/`PC offline`/`ot_access_recovery`/`login_hint`/`probeFirestore` present. `node --check phone-relay.mjs` OK. BUILD-VERIFIED ONLY — not yet runtime-verified on a real device / live Netlify deploy. The relay stamp ships in the Netlify function (deploys with the web build); no DeskPhone rebuild required for liveness.

## 2026-06-04 Phone Relay — Real-Time Push (kill the 6.5s poll, push on change)

- Reported: remote phone-bridge relay (phone → PC → cloud → all signed-in devices) works glitchily/incompletely. Root cause was architectural, not a bug: both ends were timer-based. DeskPhone pushed state every 5s regardless of changes; every browser polled `phone-relay?action=state` every 6.5s. New-text worst case ≈11.5s, and a dropped client poll/listener went silently stale (same terminal-listener class as the shailos/V5 fixes).
- DeskPhone (`Services/RelayService.cs`): added `PushNow()` — a coalescing throttle (idle → immediate; mid-burst → single trailing push ≥900ms apart, blob rebuilt from live callbacks at send time so the latest state always lands). All pushes (5s heartbeat + PushNow) serialize through a `SemaphoreSlim` gate so two writes never race the doc. Relayed commands now `PushNow()` their result so remote call/text actions reflect in ~1s. Cloud blob trimmed 500 → 150 messages (onSnapshot re-sends the whole doc to every device per change → keep it small/mobile-data-cheap, well under Firestore's 1 MiB doc cap; LAN `/messages` path still serves full 5000).
- DeskPhone (`ViewModels/MainViewModel.cs`): `RebuildConversations()` — the single funnel for every inbound/sent/read-state change — now calls `_relay.PushNow()`.
- Web (`08-app-split/components/NerveCenterPhoneSurface.jsx`): in relay mode, replaced reliance on the 6.5s poll with a real-time Firestore `onSnapshot` listener on `phone-relay/state`. Mirrors `Store.listenShailos`: self-resubscribes on capped exponential backoff because an onSnapshot listener is TERMINAL after its error callback. Extracted shared `applyPhoneState()` so poll and listener apply data identically; existing signature refs dedupe redundant renders, so both sources coexist safely (poll stays as a safety net). Net new-text latency ≈1–2s to every signed-in device; dropped listeners self-heal.
- Security: read path unchanged — `onSnapshot` reads through the existing deployed rule `match /phone-relay/state { allow read: if request.auth != null }` (same rule the REST relay read used), present in `apps/shailos/firestore.rules`. No rules change needed. Pre-existing posture noted (not introduced here): `phone-relay/state` write is open at the Firestore layer (gated only by the function's `X-Relay-Secret`); textbook hardening would move the function to the Firebase Admin SDK so the doc can be `allow write: if false`. Deferred.
- Gates: `npm run build` (apps/web) → 0 errors, bundle `index-e5dFDoZ6.js`; `relay listener error` + `phone-relay` markers present in shipped JS. `dotnet build DeskPhone.csproj` → 0 errors, 15 pre-existing warnings. BUILD-VERIFIED ONLY — end-to-end (real phone + running DeskPhone + deployed Netlify) not yet runtime-verified on-device. The PushNow half ships in the DeskPhone `.exe`, which must be rebuilt/redeployed separately; a web-only deploy makes browsers real-time but the PC still pushes on the 5s heartbeat until the host is updated.

## 2026-06-02 On-Device Diagnostics + Cache-Layer Fixes (stop guessing the Android staleness)

- After repeated remote misdiagnosis of "Android ultra-stale", switched approach to instrumentation. Research-first per Operating Law (firebase-js-sdk#6511 multi-tab stale-emit; #8593 corrupted IndexedDB; Firestore offline docs recommend surfacing `fromCache`).
- Data layer (01-core.js): dropped multi-tab persistence (`enablePersistence()` single-tab) to avoid the #6511 stale-emit bug; added `?resetCache=1` recovery hatch (`clearPersistence()` then clean reload) for #8593; kept `experimentalForceLongPolling`. Added sync telemetry (`_noteSync` on every task/shaila snapshot records server-vs-cache + timestamps) and `getDiagnostics()` / `forceResync()`.
- New `?diag=1` overlay (src/diagnostics.jsx, mounted from AuthGate) reports build commit/time, account uid, online state, latest-snapshot source (server vs CACHE), last server-sync age, load status, and whether a SW controls the page — plus Force-resync, Reset-Firestore-cache, and full-reset (unregister SW + clear caches + reload) buttons. This makes staleness observable from the device instead of guessed remotely.
- Build stamp injected via vite `define` (`__BUILD_COMMIT__`/`__BUILD_TIME__`) from Netlify `COMMIT_REF`.
- `npm run build` passes (COMMIT_REF stamped); diagnostics + telemetry markers present in bundle.
- Next step is data-driven: read the device's `?diag=1` values to determine stale-code vs stale-data before any further change.

## 2026-06-01 Round 2 — Live-Listener Resilience, Backgrounded-PWA Staleness, Review Triage

- Follow-up report: Android tablet task data still ultra-stale, shailos still not repopulating; requested a top-to-bottom review.
- Found the real cause of persisting staleness: the task live-listener `_listenV5` (01-core.js) had an EMPTY error handler `}, () => {}` for BOTH the tasks and settings `onSnapshot` listeners — same terminal-listener bug as shailos, but only shailos was fixed in round 1. A transport drop (backgrounded mobile PWA, WebChannel kill) killed the task stream permanently → frozen on cached data. Fixed: both now resubscribe with capped exponential backoff; cleanup stops retries.
- Added a foreground/online Firestore reconnect (01-core.js init): backgrounded mobile PWAs get a silently-stale stream on resume; `disableNetwork()→enableNetwork()` on `visibilitychange→visible` (after >30s hidden) and on `online` forces a fresh connection and flushes queued writes.
- Closed a data-loss path amplified by round-1's resubscribe: the shaila→task sync (App.jsx ~1007) deleted tasks whose `shailaId` was absent from a snapshot; resubscribe re-emits CACHED snapshots, so a stale/partial cache could wrongly delete shaila tasks. Threaded `snap.metadata.fromCache` through `listenShailos` and now skip deletions on cached snapshots (server-confirmed only). This also fixes a pre-existing latent bug.
- `postJson` (10-deskphone-web.jsx) had no timeout/abort (unlike `readJson`) — a hung DeskPhone froze the UI on POST commands. Added the same AbortController timeout (HOST_FETCH_TIMEOUT_MS).
- Service worker `networkFirst` (public/sw.js) had no fetch timeout — slow/half-open connections hung navigation. Bounded to 6s, then cache fallback.
- Reviewed broader agent findings and TRIAGED rather than blanket-applying (to avoid regressions): rejected the "cross-account localStorage leak" claim (lsKey is already UID-namespaced, 01-core.js:44) and the "conditional useEffect = hooks violation" claim (early return inside an effect body is legal). Deferred riskier/lower-value items (V5 `initialized` race rework, adoptedRemote re-entry, Shabbos DST math, relay backend hardening, IndexedDB quota handling) as they need targeted testing and were not the reported failure.
- `npm run build` passed in `apps/web`; generated `assets/index-DK0tKNoa.js`; large-bundle warning remains. Markers verified in bundle: `resubscribing`, `disableNetwork`/`enableNetwork`, `timed out`, `fromCache`; `dist/sw.js` shows `onetask-offline-v2` with AbortController.
- Pushed to `origin/main` per standing instruction.

## 2026-06-01 Firebase Reachability, Shailos Resilience, Mobile Menu, Login Error, Stale-Cache Purge

- Reported regressions: Firebase not connecting / shailos empty (worked the prior day), Android installed app serving very stale data, mobile login broken, mobile Tasks ··· menu not working, and the NerveCenter Chief tile saying "quiet" when the phone is simply not connected.
- Confirmed `origin/main` == working branch HEAD (`423bb90`), so the prior long-polling revert is live; today's breakage is device-side reachability, not the reverted init.
- Root-cause map: (a) iOS/Android WebChannel transport gets killed → "can't reach Firebase" + Firestore serves stale IndexedDB cache; (b) `listenShailos` onSnapshot is terminal on error and never resubscribed, and shailos have no localStorage fallback, so one transport drop empties the lane permanently; (c) service worker `cacheFirst` assets never purged (static `CACHE_NAME`); (d) mobile `MobileSection` was defined inside render → recreated every clock tick → remount dropped taps/keystrokes (broken ··· menu + task composer focus loss); (e) mobile `signInWithRedirect` errors were only `console.warn`-ed, leaving the user on a silent login screen; (f) Chief snapshot tile showed "quiet" regardless of phone connectivity.
- Fixes (apps/web): `01-core.js` re-added `db.settings({ experimentalAutoDetectLongPolling: true, merge: true })` (desktop keeps WebChannel, blocked networks fall back to long-polling) and rewrote `listenShailos` to self-resubscribe with capped exponential backoff so a transport hiccup can't empty shailos; `public/sw.js` bumped `CACHE_NAME` to `onetask-offline-v2` so installed PWAs purge stale bundles on activate; `NerveCenterPanel.jsx` hoisted `MobileSection` to module scope (state via props) so it re-renders instead of remounting, and made the Phone Chief tile read `phoneActivitySummary.online` → "not connected" vs "quiet"; `00-auth.jsx` surfaces redirect sign-in errors (`unauthorized-domain`, `web-storage-unsupported`, generic) to the LoginScreen instead of swallowing them.
- `npm run build` passed in `apps/web`; generated `assets/index-DEkOnu5N.js`; existing large-bundle warning remains. `dist/sw.js` shows `onetask-offline-v2`. Bundle marker check found `experimentalAutoDetectLongPolling`, `resubscribe`, `not connected`, `isn't authorized for Google sign-in`, and `expandedId`.
- `git diff --check` clean. Pushed to branch `claude/firebase-shailos-debug-Zm62h` (NOT main — needs merge to main for Netlify to deploy).
- Action item NOT fixable in code: the default `*.firebaseapp.com` authDomain + Safari/iOS tracking-prevention is the likely deeper mobile-login blocker; verify `onetaskfocuser.netlify.app` and `onetaskonly-app.firebaseapp.com` are in Firebase → Auth → Settings → Authorized domains. On-device verification of mobile menu/login still required (cannot reproduce iOS/Android from CI container).

### `apps/web`

- `npm ci` passed.
- `npm run build` passed.
- `node scripts/copy-shailos-to-dist.cjs` passed and copied generated Shailos output into `dist/shailos`.
- Build warning: main web bundle is larger than 500 kB after minification. This is a performance cleanup target, not a migration failure.
- Dependency audit reported 20 vulnerabilities. This should be triaged before production cutover, but no automatic fix was applied in this migration pass.

### `apps/shailos`

- `npm ci` passed.
- `npm run build` passed.
- Build warning: Shailos bundle is larger than 500 kB after minification. This is a performance cleanup target, not a migration failure.
- Dependency audit reported 5 vulnerabilities, including 1 critical. This should be triaged before production cutover, but no automatic fix was applied in this migration pass.

### `apps/phone-host-windows`

- `dotnet build` passed.
- Existing warnings remain:
  - `InTheHand.Net.Bluetooth 4.1.0` resolves to `4.1.40`.
  - Several nullable/async warnings in existing DeskPhone source.
- No C# build errors.

### Current Conclusion

The clean Shamash Pro 4 workspace has enough source-grade files to build all three lanes independently. It is not ready for production cutover until runtime smoke tests, dependency/security triage, and deploy wiring are completed.

After verification, generated folders were removed again to keep the Pro 4 tree lean:

- `node_modules/`
- `dist/`
- `bin/`
- `obj/`

Current source-grade file count after cleanup: 162 files.

## 2026-05-10 Runtime Preview Pass

### Visible local preview

- Pro 4 production preview is running at `http://127.0.0.1:4305/?suite=nervecenter`.
- Shailos preview route is running at `http://127.0.0.1:4305/shailos/`.
- Phone host status is running at `http://127.0.0.1:8765/status`.

### Phone host API

- Launched the compiled Pro 4 `DeskPhone.exe` directly from `apps/phone-host-windows/bin/Debug/net8.0-windows10.0.19041.0`.
- `GET /status` passed.
- `GET /messages` passed.
- `GET /calls` passed.
- `GET /contacts` passed.
- Finding: `/messages` returned about 18.9 MB. It works, but this is a performance target before calling the Pro 4 phone path peak-efficient.

### Web preview

- `npm run build` passed.
- `node scripts/copy-shailos-to-dist.cjs` passed.
- `vite preview` is serving the built output on port `4305`.
- Main route returned HTTP 200.
- `/shailos/` returned HTTP 200.

### Backend functions

- Restored missed Netlify functions into `apps/web/backend/functions`.
- Added `apps/web/backend/functions/package.json` with `type: commonjs` so CommonJS Netlify functions are explicit inside the Vite app's `type: module` package.
- `node --check` passed for:
  - `ai-proxy.js`
  - `app-config.js`
  - `claude-proxy.js`
  - `gemini-proxy.js`
  - `mcp.mjs`
  - `serper-proxy.js`
  - `_ai-core.cjs`

### Remaining before go-live

- CEO visual pass in the browser.
- Dependency/security audit triage.
- Performance cleanup for large bundles and large phone `/messages` payload.

## 2026-05-10 Final Pre-Live Pass

### Netlify local runtime

- `npx netlify dev --offline --no-open --dir dist --functions backend/functions --port 4310 --functions-port 4311` started successfully.
- `http://127.0.0.1:4310/?suite=nervecenter` returned HTTP 200.
- `http://127.0.0.1:4310/.netlify/functions/app-config` returned HTTP 200 and valid AI/config JSON.

### Phone payload optimization

- Changed the Pro 4 phone host `/messages` endpoint to default to `limit=1200`.
- Added `includeAttachmentData=1` as an explicit opt-in for embedded MMS image data.
- Updated DeskPhone Web to request `/messages?limit=1200`.
- Rebuilt the phone host successfully.
- Measured payloads after relaunch:
  - `GET /messages`: about 0.69 MB.
  - `GET /messages?limit=1200`: about 0.69 MB.
  - `GET /messages?limit=1200&includeAttachmentData=1`: about 10.1 MB.
  - Previous default was about 18.9 MB.

### Final local test URLs

- Netlify-style local preview: `http://127.0.0.1:4310/?suite=nervecenter`
- Static production preview: `http://127.0.0.1:4305/?suite=nervecenter`
- Shailos route: `http://127.0.0.1:4305/shailos/`
- Phone host: `http://127.0.0.1:8765/status`

### Remaining before public live preview

- Visual approval in the local browser.
- Decide whether to create a Netlify draft deploy for a public test URL.
- Do not deprecate old folders until the public test URL passes and rollback has been confirmed.

## 2026-05-10 Draft Deploy

- Created Netlify draft deploy only, not production.
- Preview URL: `https://6a0107f21f09b1f505a3e7da--onetaskfocuser.netlify.app`
- Build logs: `https://app.netlify.com/projects/onetaskfocuser/deploys/6a0107f21f09b1f505a3e7da`
- Function logs: `https://app.netlify.com/projects/onetaskfocuser/logs/functions?scope=deploy:6a0107f21f09b1f505a3e7da`
- Public root route returned HTTP 200.
- Public `/shailos/` route returned HTTP 200.
- Public `/.netlify/functions/app-config` route returned HTTP 200.
- Production URL remains unchanged.

## 2026-05-10 Draft Preview Hotfix

### Issue Found In Preview

- AI functions were reachable locally but blocked from Netlify branch deploy URLs by the function CORS allowlist.
- Conversation recording buttons could open a blank screen because the capture component referenced recording helpers that were not imported.
- Gemini default model `gemini-2.5-flash` is currently returning quota/rate-limit errors on the configured key.

### Fixes Applied

- Allowed Netlify branch deploy origins ending in `--onetaskfocuser.netlify.app` for AI and Serper functions.
- Added the missing conversation recording imports in `ConvCapture.jsx`.
- Added a controlled Gemini quota fallback from `gemini-2.5-flash` to `gemini-2.5-flash-lite`.

### Latest Draft Preview

- Preview URL: `https://6a010ab82d99e0fff8c159c9--onetaskfocuser.netlify.app`
- Public root route returned HTTP 200.
- Public `/shailos/` route returned HTTP 200.
- Public `/.netlify/functions/app-config` route returned HTTP 200.
- Public `/.netlify/functions/ai-proxy` returned HTTP 200 from the preview origin with model `gemini-2.5-flash-lite` and response `OK`.
- `npm run build` passed after the hotfix.
- Production URL remains unchanged.

## 2026-05-10 Production Promotion

- Promoted Shamash Pro 4 to production with Netlify deploy `6a01194dc5d71bfed30a76ea`.
- Live URL: `https://onetaskfocuser.netlify.app`
- Build command passed during production deploy.
- Functions bundled from `apps/web/backend/functions`.
- Production root route returned HTTP 200.
- Production `/shailos/` route returned HTTP 200.
- Production `/.netlify/functions/app-config` route returned HTTP 200.
- Production `/.netlify/functions/ai-proxy` returned HTTP 200 from the production origin with model `gemini-2.5-flash-lite` and response `OK`.
- Legacy web, Shailos, and DeskPhone folders were preserved and marked as rollback sources, not deleted.

## 2026-05-10 Legacy Mothball Pass

- Moved old web source from `taskmanager app\sandbox` to `taskmanager app\_MOTHBALLED_ROLLBACK_ONLY_sandbox_2026-05-10`.
- Moved old Shailos source from `backup\sto-src\Shaila-Trancriber-Organizer-main` to `backup\sto-src\_MOTHBALLED_ROLLBACK_ONLY_Shaila-Trancriber-Organizer-main_2026-05-10`.
- Moved old DeskPhone source into `PC as Bluetooth call - text interface\_MOTHBALLED_ROLLBACK_ONLY_DeskPhone_2026-05-10`.
- The old DeskPhone path residue was renamed to `PC as Bluetooth call - text interface\_TOMBSTONE_DO_NOT_USE_DeskPhone_old_path_residue_2026-05-10` because Windows/OneDrive protected `.git` and scratch metadata during the move.
- Updated `BRIEF.txt` so cold-start routing points only to Shamash Pro 4 live source paths, with mothballed folders listed as rollback-only.

## 2026-05-10 DeskPhone Shortcut Cutover

- Found the desktop `DeskPhone.lnk` still pointed to the old mothballed DeskPhone launcher path.
- Released Pro 4 native DeskPhone build `b262`.
- Current live desktop shortcut:
  - `C:\Users\ydanz\OneDrive\Desktop\DeskPhone.lnk`
  - Target: `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 4 App\apps\phone-host-windows\deployed-builds\launcher\DeskPhoneLauncher.exe`
- Running host after cutover:
  - `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 4 App\apps\phone-host-windows\deployed-builds\b262\DeskPhone.exe`
- Verified `http://127.0.0.1:8765/status` returned HTTP 200 with `connected:true`.
- Verified `http://127.0.0.1:8765/messages?limit=5` returned HTTP 200.
- Verified CORS/PNA headers allow `https://onetaskfocuser.netlify.app` to call the localhost host.

## 2026-05-10 WebPhone Contact/MMS/History Fix

- Native host released as DeskPhone `b263`.
- Host API changes:
  - `/contacts` no longer truncates at 250 rows.
  - `/calls` exports up to 1000 rows instead of 100.
- WebPhone changes:
  - Message conversations are enriched from the contacts payload, so thread names can resolve even when message rows only contain numbers.
  - Call-history name matching now uses the same tolerant phone-key comparison as message/contact matching.
  - Contacts view has a search field and no longer displays only the first 80 rows.
  - Message history request increased to 5000 rows.
  - Recent MMS media request fetches attachment image data for the latest 1200 rows and caches that media payload for 60 seconds, avoiding repeated large image downloads every refresh.
- Production web deploy: `6a014b570c09106d30c7802d`.
- Verified production root, `/shailos/`, and `/.netlify/functions/app-config` returned HTTP 200.
- Verified localhost host after b263 returned HTTP 200 with `connected:true`.
- Measured localhost payloads after b263:
  - Contacts: 1731.
  - Calls: 148.
  - Messages with `limit=5000`: 5000.
  - Recent media rows with image data: 21.

## 2026-05-10 Shamash Pro 3 Tombstone Visibility Pass

- Changed `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control` from active-looking control-folder wording to explicit tombstone wording.
- Renamed `00 START HERE` to `00 TOMBSTONED - DO NOT START HERE` so Explorer no longer presents Pro 3 as the normal startup path.
- Renamed `01 ACTIVE APPS - WORK HERE` to `01 TOMBSTONED APP SHORTCUTS - DO NOT WORK HERE` so old app shortcuts no longer look like the active work area.
- Replaced Pro 3 `README.md`, `PSOT.md`, `AGENTS.md`, `BRIEF.txt`, and the CEO start note with Pro 4 pointers and rollback/archive-only warnings.
- Updated Pro 4 root `README.md` and `AGENTS.md` to match the production promotion already recorded in this log and `PROMOTION_CHECKLIST.md`.
- Full physical relocation of the Pro 3 folder remains a separate decision because it still contains mobile bridge/reference material and old path references; the visible startup surface is now tombstoned.

## 2026-05-10 Shamash Pro 3 Hard Scramble

- Converted `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control` from signage-only tombstone to structurally unusable tombstone.
- Moved 19 old top-level items into:
  `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control\_TOMBSTONED_PAYLOAD_SCRAMBLED_UNUSABLE_UNTIL_RESTORE_2026-05-10_2338`
- Scrambled each original item name inside that payload, so old direct paths like `Shamash Pro 3\android-webphone-bridge` and `Shamash Pro 3\00 TOMBSTONED - DO NOT START HERE` now fail.
- Left only the root tombstone shell:
  - `README.md`
  - `SCRAMBLE_MANIFEST.json`
  - `EMERGENCY_DESCRAMBLE_RESTORE.ps1`
  - the scrambled payload folder
- Emergency restore path is documented by `SCRAMBLE_MANIFEST.json` and executable through `EMERGENCY_DESCRAMBLE_RESTORE.ps1`; use only for explicit rollback/archive recovery.

## 2026-05-10 Central Legacy Folder Hard Scramble

- Hard-scrambled the remaining source-bearing old folders into central Pro 3 vaults so stale legacy paths fail instead of relying on filename warnings.
- Central manifest:
  `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control\CENTRAL_DESCRAMBLE_MANIFEST.json`
- Central restore script:
  `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control\EMERGENCY_DESCRAMBLE_ALL_LEGACY.ps1`
- Central readme:
  `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control\CENTRAL_DESCRAMBLE_README.md`
- Scrambled legacy roots:
  - `taskmanager app\_MOTHBALLED_ROLLBACK_ONLY_sandbox_2026-05-10`
  - `taskmanager app\backup\sto-src\_MOTHBALLED_ROLLBACK_ONLY_Shaila-Trancriber-Organizer-main_2026-05-10`
  - `PC as Bluetooth call - text interface\_MOTHBALLED_ROLLBACK_ONLY_DeskPhone_2026-05-10`
  - `PC as Bluetooth call - text interface\_TOMBSTONE_DO_NOT_USE_DeskPhone_old_path_residue_2026-05-10`
  - `taskmanager app\sandbox-cleanroom`
  - `Shamash source clones\deskphone`
  - `Shamash source clones\onetask-sandbox`
- Verification: central restore script parses, each manifest source exists, and each original destination path is absent.
- Note: the first DeskPhone move attempt created a partial duplicate in the long vault and hit Windows path-length/locked-exe limits. The authoritative DeskPhone restore source is `_V\L003_deskphone_legacy`; the partial is recorded in the central manifest as `ignore`.

## 2026-05-11 Rabbi Dashboard Retirement

- Classified `C:\Users\ydanz\OneDrive\Documents\Rabbi Dashboard` as retired/reference-only source, not active product code.
- Stopped the old Rabbi Dashboard Vite dev server that was still running from that folder.
- Archived source-grade material to:
  `C:\Users\ydanz\OneDrive\Documents\Retired Source Archives\2026-05-11-rabbi-dashboard-retirement\rabbi-dashboard-reference-source-2026-05-11.tar.gz`
- Archive manifest:
  `C:\Users\ydanz\OneDrive\Documents\Retired Source Archives\2026-05-11-rabbi-dashboard-retirement\ARCHIVE_MANIFEST.json`
- Archive SHA256:
  `A4BB453E2F0197A290633850C22B82DDC5924DE1E55828BCB825A47C687C9B3E`
- Excluded generated/local-only material from the archive: `.git`, `node_modules`, `dist`, `.launcher`, and `dev-server.log`.
- Replaced the old `Rabbi Dashboard` folder with a one-file tombstone README pointing to Pro 4 and the archive.
- Verification: archive lists expected source/docs/package/config/script files, and `Rabbi Dashboard` now contains only `README.md`.

## 2026-05-11 Retired Head Folder Move

- Moved retired Shamash-family head folders out of the top-level Documents view so they no longer look like active projects:
  - `C:\Users\ydanz\OneDrive\Documents\taskmanager app`
  - `C:\Users\ydanz\OneDrive\Documents\Rabbi Dashboard`
  - `C:\Users\ydanz\OneDrive\Documents\PC as Bluetooth call - text interface`
  - `C:\Users\ydanz\OneDrive\Documents\Shamash source clones`
- New location:
  `C:\Users\ydanz\OneDrive\Documents\Retired Source Archives\2026-05-11-retired-head-folders`
- Move manifest:
  `C:\Users\ydanz\OneDrive\Documents\Retired Source Archives\2026-05-11-retired-head-folders\HEAD_FOLDER_MOVE_MANIFEST.json`
- Verification: top-level Documents now shows `Shamash Pro 4 App`, `Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control`, and `Retired Source Archives` for Shamash-family work; the old head folder names are no longer top-level project folders.
- Note: `Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control` remains top-level only because it currently holds the central emergency descramble controls requested by the user.

## 2026-05-11 Unscramble Control Rename

- Created the clearer control-folder name requested by the user:
  `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control`
- Copied the emergency control payload, manifests, vaults, and restore scripts into that renamed control folder.
- Updated `CENTRAL_DESCRAMBLE_MANIFEST.json` and `SCRAMBLE_MANIFEST.json` so their root paths point to the renamed control folder.
- Added `LEGACY_LOCATION_RECORD.md` and `LEGACY_LOCATION_RECORD.json`.
- The legacy location record lists where the retired head folders, scrambled vaults, and compressed Rabbi Dashboard archive now live.
- The old `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 3` folder could not be renamed directly because Windows reported an open handle. It was cleared to a redirect README and marked Hidden/System; the renamed control folder is now authoritative.

## 2026-05-11 NerveCenter WebPhone Compact Pass

- Restored a root `BRIEF.txt` in the Pro 4 workspace because no local brief file was present.
- Updated WebPhone/NerveCenter phone matching to use richer contact phone fields, message peer-number selection, 10/7-digit comparison keys, `/messages?limit=5000`, and the full `/calls` endpoint.
- Compressed the NerveCenter task input into a single compact row with colored priority add buttons plus a Mrs W add button.
- Added a task `See more` reveal for the dashboard queue instead of forcing the full queue into the first glance.
- Tightened NerveCenter pane-resizer handles and reduced header/status chrome.
- Changed compact phone rows so messages and recent calls show side-by-side glance slices, with row actions hidden behind three-dot menus.
- Changed DeskPhone Web call-history rows so text/call/block/delete are available behind a three-dot overflow instead of always visible.
- Google Calendar/Gmail now refresh every 5 minutes while connected and also refresh on browser focus/visibility return; manual refresh buttons now refresh data instead of re-opening OAuth.
- `npm run build` passed in `apps/web`.
- Verified local phone host `http://127.0.0.1:8765/status` returned HTTP 200 with `connected:true`.
- Visual smoke captured via Edge/CDP from `http://127.0.0.1:4305/?suite=nervecenter`; local screenshot was reviewed but not kept as source.
- Remaining note: true Google push/webhook delivery would require a backend notification channel and explicit deploy/config approval; this pass implemented the safe client-side near-live refresh path.
- Live deploy completed with `npx netlify deploy --prod --build` from `apps/web`; production URL `https://onetaskfocuser.netlify.app`, deploy ID `6a015f2aafd56281e9c2b4f4`.

## 2026-05-11 Lean Startup Docs And Git Remote Record

- Rewrote `BRIEF.txt` as the single low-token startup file for the phrase `read brief`.
- Trimmed `README.md` to repo orientation only and moved active-session startup guidance to `BRIEF.txt`.
- Trimmed `AGENTS.md` to operating law: research-before-change, production source rules, verification gates, push policy, Netlify approval policy.
- Restored Git origin to `https://github.com/addedlife/onetaskfocuser.git`.
- Recorded that Pro 4 local `master` is clean-history and not yet reconciled with GitHub `main`; Pro 4 work should push to `codex/...` branches until `main` reconciliation is explicitly approved.

## 2026-05-11 Token-Minimal Context Map

- Reduced `BRIEF.txt` from a fuller session summary to a tiny context kernel.
- Added `docs/ops/CONTEXT_INDEX.md` as the task-area file map for accurate low-token changes.
- Updated `README.md` and `AGENTS.md` so future sessions use `BRIEF.txt` plus only the matching context-index row instead of broad doc/code rereads.

## 2026-05-11 Phone Panel Glanceability Correction

- Removed the cramped compact-mode side-by-side Messages/Recent calls subpanes from NerveCenter WebPhone.
- Replaced them with one unified `Activity` feed that interleaves recent messages and calls by timestamp.
- Moved idle connection status out of the Phone card body and into the Phone header as a tiny status dot; active call, incoming call, and voicemail still surface as compact alerts.
- Reduced Phone card body padding to reclaim vertical space for actual content.
- `npm run build` passed in `apps/web`.
- Verified the local phone host `http://127.0.0.1:8765/status` returned HTTP 200 with `connected:true`.

## 2026-05-15 NerveCenter Historical Shailos Status Correction

- Researched React state/list practice before editing: current React docs recommend deriving display data from source state, avoiding redundant/duplicated status state, and using stable data IDs for list keys.
- Updated `apps/web/src/08-app-split/utils/shailosQueue.js` so linked task groups merge the matching Firestore Shaila record before calculating the NerveCenter pane status.
- Expanded status inference for older records: `answer`, `shailaAnswer`, `answerSummary`, `answeredBy`, `answererName`, `gotBackToAsker`, `gotBack`, and `got_back` are now honored in addition to the explicit `status` field.
- Sample helper check passed: linked `got_back` records are excluded from the open pane, answered records show as get-back, and only unanswered pending records show as research.
- `npm run build` passed in `apps/web`; existing large-bundle warning remains.
- `git diff --check` passed; line-ending normalization warnings only.
- Pushed commit `af2e94d` to `origin/main`; Netlify Git-triggered production published `assets/index-nxNoMWeG.js`, which contains the broader historical status fields including `gotBackToAsker` and `answererName`.

## 2026-05-15 NerveCenter Shailos Pane Grouping Correction

- Researched React list/state practice before editing: derive display rows from source state, keep array updates immutable, avoid duplicated/contradictory state, and use stable item keys for lists that can reorder.
- Added a shared Shailos queue derivation helper so NerveCenter shows one row per open Shaila thread, including pending research and get-back cases, keyed by Shaila ID when available.
- Changed the NerveCenter Shailos pane to consume the derived rows directly instead of filtering out research/get-back rows and slicing the list down again.
- Kept the Tasks pane classification on the same helper so Shailos work is separated consistently from ordinary task work.
- `node --input-type=module` sample check passed for regular task exclusion, pending research, get-back, and raw Firestore Shailos fallback rows.
- `npm run build` passed in `apps/web`; existing large-bundle warning remains.
- `git diff --check` passed; line-ending normalization warnings only.
- `npm run lint` remains blocked by the existing ESLint glob configuration, which reports that `src/*.jsx` matches ignored files.
- Local Vite smoke returned HTTP 200 at `http://127.0.0.1:4305/?suite=nervecenter`, and the rebased built asset `index-BKxtnjDy.js` contains the new Shailos pane labels.
- Codex in-app browser visual smoke was attempted, but the browser helper crashed during setup under the local Node ESM configuration before opening the page.
- Pushed commit `820dcc9` to `origin/main`; Netlify Git-triggered production published on poll attempt 2. Production root returned HTTP 200 and served `assets/index-BKxtnjDy.js`, which contains `pending research`, `waiting to reply`, and `get_back`.

## 2026-05-11 Always-Live Release Rule And Task Add Collapse

- Updated startup and agent docs so verified web changes should be committed, pushed, and deployed unless the current thread says not to.
- Kept Netlify relinking as approval-only, because relinking changes site identity rather than shipping the current app.
- Changed NerveCenter task entry so the default state is four small square plus buttons; clicking a plus opens the task text box with save/cancel.
- Reduced the task `See more` affordance to a small icon-only button.
- `npm run build` passed in `apps/web`.
- Live deploy completed with `npx netlify deploy --prod` from `apps/web`; production URL `https://onetaskfocuser.netlify.app`, deploy ID `6a0164d6afd56290d7c2b438`.

## 2026-05-11 GitHub Main Reconciliation

- Preserved the previous GitHub `main` commit `27e256cf1e0f3dda6e3addbfd743ac7d0bdd31c9` as branch `archive/pre-pro4-main-20260511-011424`.
- Preserved the same old main commit as tag `archive-pre-pro4-main-20260511-011424`.
- Reconciled GitHub `main` to Pro 4 commit `00d839f81d730e96ec623bd60443c72b974b1cf9` using `git push --force-with-lease`.
- Renamed local branch `master` to `main` and set it to track `origin/main`.
- Going forward, normal source pushes can use `origin/main`; old main remains recoverable from the archive branch/tag.

## 2026-05-11 Netlify Git Trigger Recovery

- After GitHub `main` moved to Pro 4, Netlify's Git-trigger path served a 404 because the Pro 4 repo is a monorepo and the web app is under `apps/web`.
- Restored production immediately with manual deploy `6a01667f88b9f9afe8df0a04` from `apps/web`.
- Added root `netlify.toml` with `[build].base = "apps/web"` so future Git-triggered builds start from the web app directory and use the existing `apps/web/netlify.toml`.

## 2026-05-11 NerveCenter Tasks Blank-Bottom Correction

- Corrected the collapsed Tasks pane so it shrink-wraps the visible rows plus the more button instead of filling the dashboard column with a blank bordered scroll area.
- Added contained overscroll behavior to the NerveCenter shell and inner task/shaila scroll panes to prevent drag momentum from chaining into empty dashboard space.
- `npm run build` passed in `apps/web`.
- Visual smoke captured locally at `http://127.0.0.1:4305/?suite=nervecenter` with Playwright screenshot; local Firebase was offline, so the layout was verified against local empty-state data and the same collapsed-card path.

## 2026-05-11 NerveCenter Tasks Auto-Fill After Pane Resize

- Researched the standard resize-aware component pattern before editing: `ResizeObserver` is the browser-native tool for responding to an element's own size changes, which matches a dragged dashboard pane better than a fixed row cap or window-only resize listener.
- Changed the collapsed NerveCenter Tasks list to calculate how many task rows fit in the available dashboard grid height, keeping five as the minimum glance count while automatically revealing more tasks when space opens.
- Updated the `more` affordance so its count reflects only the tasks still hidden after the auto-filled visible rows.
- `npm run build` passed in `apps/web`.
- Local smoke at `http://127.0.0.1:4305/?suite=nervecenter` with 18 seeded tasks: at 1440x760 the Tasks pane rendered 6 rows; after increasing available height to 1440x1040 it rendered 10 rows without clicking `See more`.
- Pushed commit `eb9eeba` to `origin/main` and deployed production from `apps/web`; production URL `https://onetaskfocuser.netlify.app`, deploy ID `6a01e5772a30436805044422`.

## 2026-05-11 NerveCenter Dense Alignment Correction

- Researched spacing conventions before editing: app layouts should use consistent 4/8px increments, with tighter gutters for related working panels and larger whitespace reserved for unrelated sections.
- Reduced the inflated NerveCenter vertical stack spacing so the horizontal drag bar has `4px` above, `8px` handle height, and `4px` below instead of being separated by large flex gaps.
- Reduced desktop vertical pane gutters to the visible `6px` drag columns, and reduced the Calendar/Mail lower-pane gutter to `8px`.
- Kept the Tasks pane aligned to the top grid height when more than five tasks exist, so the three upper panes share the same top and bottom edges while the auto-fill row calculation still reveals more tasks.
- `npm run build` passed in `apps/web`.
- Local browser geometry smoke at `http://127.0.0.1:4305/?suite=nervecenter` with 18 seeded tasks at 1440x900: upper pane bottom spread was `0px`, vertical gutters were `6px`, top-grid-to-horizontal-handle gap was `4px`, handle height was `8px`, and handle-to-lower-pane gap was `4px`.
- Pushed commit `5081943` to `origin/main` and deployed production from `apps/web`; production URL `https://onetaskfocuser.netlify.app`, deploy ID `6a01e83c9d4b00081b36567c`.

## 2026-05-11 NerveCenter Mobile Chrome And Call Direction Correction

- Researched the UI/data standards before editing: promoted add actions should be compact circular affordances with few related choices, mobile list content should stay in vertical scroll containers, and Android call logs distinguish incoming, outgoing, and missed calls as separate `CallLog.Calls.TYPE` values.
- Changed the NerveCenter task add buttons from saturated square fills to softer circular add dots.
- Bounded the mobile Calendar/Mail strip to a fixed viewport budget, tightened the card headers, and gave each card its own internal vertical scroll so long Google result lists do not push the rest of the dashboard down.
- Changed DeskPhone host `/status.recentCalls` and `/calls` to export the full newest-first call history instead of inheriting the native desktop call-history filter.
- `npm run build` passed in `apps/web`; existing large bundle warning remains.
- `dotnet build` and `dotnet build .\DeskPhone.csproj -c Release` passed in `apps/phone-host-windows`; existing NuGet/nullable/async warnings remain.
- Released native DeskPhone `b264`; the running host reported `build: b264` and `/status.recentCalls` included Missed, Incoming, and Outgoing rows.
- Local headless Chrome smoke at `http://127.0.0.1:4305/?suite=nervecenter` reached the served app but stopped at the unauthenticated `Loading...` shell, matching the existing limitation noted for headless visual capture.
- Native release commit `91f03dc` and web/UI commit `1bff672` were pushed to `origin/main`.
- Production web deploy was triggered from `apps/web`; Netlify CLI hung after upload, but production `https://onetaskfocuser.netlify.app/` returned HTTP 200 and served the new built asset `assets/index-CSwH8QSK.js`.

## 2026-05-11 Shailos Manual Draft Sync Correction

- Researched form-save convention before editing: keep work-in-progress as a draft state and run cross-system side effects only after explicit submit.
- Changed Shailos `Add Manually` so it opens a local draft instead of immediately writing a blank pending Firestore shaila.
- Changed `Submit Shaila` to create the Firestore record only after details are entered and submitted.
- Added a defensive task-sync guard so the task app does not create Shaila tasks from empty placeholder text such as `New Shaila`.
- Refreshed the generated `apps/web/shailos` deploy bundle from `apps/shailos/dist`.
- `npm run lint` passed in `apps/shailos`.
- `npm run build` passed in `apps/shailos`; existing large-bundle warning remains.
- `npm run build` passed in `apps/web`; existing large-bundle warning remains.
- `node scripts/copy-shailos-to-dist.cjs` passed in `apps/web`.
- Local preview checks returned HTTP 200 for `http://127.0.0.1:4305/shailos/` and `http://127.0.0.1:4305/?suite=nervecenter`.
- `git diff --check` passed.
- Pushed commit `65f0855` to `origin/main`.
- Verified production `https://onetaskfocuser.netlify.app/shailos/` returned HTTP 200 and served Shailos asset `assets/index-DLMDgD5x.js`.
- Verified production Shailos asset contained the `manual-draft` and `Submit Shaila` code paths.
- Verified production root `https://onetaskfocuser.netlify.app/` returned HTTP 200.

## 2026-05-11 Gemini Free-Tier Rate-Limit Guard

- Researched current Gemini API limits before editing. Google AI docs last updated 2026-05-07 list rate limits as per project, not per API key, with independent RPM/TPM/RPD enforcement; current free-tier Gemini 2.5 Flash is 10 RPM, 250k TPM, 250 RPD, while Gemini 2.5 Pro is 5 RPM, 250k TPM, 100 RPD.
- Researched retry behavior before editing. Google troubleshooting maps HTTP 429 to `RESOURCE_EXHAUSTED`, advises verifying model rate limits and retrying after waiting; Google retry guidance warns against retry storms and recommends exponential/backoff-style pacing.
- Added a central Gemini gateway limiter in `apps/web/backend/functions/_ai-core.cjs`: default safe cap is 4 RPM, 200k estimated TPM, and 90% of model RPD. The limiter uses Firestore transactions when Firebase service-account env vars are available, with in-memory warm-instance fallback for local/dev.
- Changed 429 fallback behavior so quota fallback to Flash-Lite waits before retrying instead of immediately doubling the burst.
- Added `Retry-After` propagation to `ai-proxy`, `gemini-proxy`, and `claude-proxy` error responses.
- `node -e "const core=require('./apps/web/backend/functions/_ai-core.cjs'); console.log(JSON.stringify(core.publicAiConfig().ai.rateLimit));"` returned `{"strategy":"server-side queue","safeRpm":4,"safeTpm":200000,"safeRpd":225}` for the default Gemini 2.5 Flash model.
- `npm run build` passed in `apps/web`; existing large-bundle warning remains.
- `git diff --check` passed; line-ending normalization warnings only.

## 2026-05-11 Cross-Provider AI Model Picker

- Researched current official model guidance before editing:
  - OpenAI docs list `gpt-5.5` as the current flagship, with `gpt-5.4-mini` and `gpt-5.4-nano` as lower-latency/lower-cost options.
  - Anthropic docs list Claude Opus 4.7, Claude Sonnet 4.6, and Claude Haiku 4.5.
  - Google AI docs list Gemini 3.1 Pro Preview, Gemini 3 Flash Preview, and Gemini 3.1 Flash-Lite among current Gemini text-out models.
- Added a central model catalog in `apps/web/backend/functions/_ai-core.cjs` covering Gemini, OpenAI, and Claude frontier/fast/budget lanes.
- Added OpenAI Responses API and Anthropic Messages API routing to the central AI gateway while keeping audio transcription on Gemini.
- Changed Settings > Account from a Gemini-only selector to one model dropdown that saves `aiProvider` plus `aiModel` and marks providers without configured keys.
- Updated the live split app shell so all text AI calls use the selected provider/model through `/.netlify/functions/ai-proxy`.
- Updated the legacy `claude-proxy` wrapper to route through Claude via the central gateway.
- `node -e "const core=require('./apps/web/backend/functions/_ai-core.cjs'); const ai=core.publicAiConfig().ai; console.log(JSON.stringify({provider:ai.provider,model:ai.model,audioModel:ai.audioModel,catalog:ai.catalog.map(x=>x.provider+':'+x.model)}, null, 2));"` returned the expected nine-entry cross-provider catalog.
- `npm run build` passed in `apps/web`; existing large-bundle warning remains.
- `git diff --check` passed; line-ending normalization warnings only.
- Browser smoke was attempted through the Codex in-app browser, but the local browser helper crashed before opening the tab; code-side verification above passed.
- Pushed commit `6e5114b` to `origin/main`; production `https://onetaskfocuser.netlify.app/.netlify/functions/app-config` returned HTTP 200 with the new catalog entries `gemini-3.1-pro-preview`, `gpt-5.5`, and `claude-sonnet-4-6`.

## 2026-05-11 Gemini Overflow Key Lane

- Researched current Google guidance before editing: Gemini rate limits are per Google Cloud project, not per API key, so overflow cycling only expands RPD when the overflow key belongs to a different project. The user confirmed `Gemini_Overflow_01` is from a different project.
- Added a server-side Gemini credential catalog with `primary` from `GEMINI_API_KEY` and `overflow-01` from Netlify env var `Gemini_Overflow_01` (with `GEMINI_OVERFLOW_01` fallback).
- Added Settings > Account > Gemini key lane with `Auto failover`, `Gemini Primary`, and `Gemini Overflow 01`; the UI receives only lane labels/availability, not key values.
- Updated app AI calls to pass `geminiCredential` through the central gateway.
- Updated the Gemini limiter to track RPM/TPM/RPD by credential lane plus model, so separate-project keys do not block each other in the local safety queue.
- Updated Gemini calls to try the preferred/auto lane first and rotate to the next available Gemini lane on daily quota/RPD exhaustion signals.
- Fixed app load cleanup so `aiProvider` persists instead of being stripped on every load.
- Local probe with `$env:Gemini_Overflow_01='fake-overflow-key'` returned `overflow-01` as available in `publicAiConfig().ai.credentialLanes.gemini`.
- `npm run build` passed in `apps/web`; existing large-bundle warning remains.
- `git diff --check` passed; line-ending normalization warnings only.

## 2026-05-15 NerveCenter Shailos Status Refresh And PWA Launch Identity

- Researched current web-app launch practice before editing: installed web apps should carry a stable manifest `id`, explicit `start_url`/`scope`, and a `launch_handler` when the app wants launches to prefer an existing app window.
- Changed NerveCenter to keep the live Shailos listener payload in React state, so answer/got-back updates from the Shailos collection trigger a pane repaint even when the task list itself does not change.
- Changed the NerveCenter Shailos pane source task scan from the active task list to all app task lists, so completed research/get-back evidence outside the current list can still affect status.
- Added manifest `id: "/"` and `launch_handler.client_mode: ["focus-existing", "navigate-existing"]` for installed Chrome/Edge PWA taskbar launches.
- `npm run build` passed in `apps/web`; existing large-bundle warning remains.
- `npm run build` passed in `apps/shailos`; existing large-bundle warning remains.
- Local Vite smoke returned HTTP 200 at `http://127.0.0.1:4320/?suite=nervecenter`; `/manifest.webmanifest` returned HTTP 200 and contained both `id` and `launch_handler`.
- `git diff --check` passed; line-ending normalization warnings only.
- Pushed commit `212107c` to `origin/main`; Netlify Git-triggered production served `assets/index-DTX7sLyJ.js` on poll attempt 2, and production `/manifest.webmanifest` returned HTTP 200 with both `id` and `launch_handler`.

## 2026-05-18 NerveCenter Message Detail Click

- Researched list/detail UI practice before editing: selected list items should reveal the full item in a related detail area, with compact list rows remaining as summaries.
- Changed NerveCenter Gmail rows so clicking a mail item selects it, fetches the full Gmail body on demand with the existing readonly Google token, and renders the readable message body in the Mail card. The Gmail external-open control remains available as a separate row action.
- Changed the NerveCenter DeskPhone activity feed so clicking a text message expands the full SMS body in place, while Call/Text actions stay in the action menu.
- `npm run build` passed in `apps/web`; existing large-bundle warning remains.
- `git diff --check` passed; existing line-ending normalization warnings only.
- Local Vite returned HTTP 200 at `http://127.0.0.1:4305/?suite=nervecenter`.
- In-app Browser verification was attempted, but the browser helper failed before opening the tab due a local Node runtime boot issue. Headless Edge screenshot reached the app and stopped at the existing unauthenticated `Loading...` shell, matching the prior headless limitation for this surface.
- Pushed commit `19ee669` to `origin/main`; Netlify Git-triggered production served `assets/index-VmtlB680.js` on poll attempt 3.

## 2026-05-18 iPad Phone Bridge Probe

- Researched current iPadOS 26 Bluetooth direction before editing: Apple now documents Core Bluetooth as covering LE and BR/EDR classic devices, while Apple Support lists HFP, PBAP, and MAP as supported iOS/iPadOS profiles; the unresolved product risk is whether public app APIs expose enough MAP/PBAP/HFP client access for this exact Android-source-phone flow.
- Promoted the retired Pro 3 iPad bridge source into `apps/ipad-phone-bridge`.
- Replaced the old static iPad bridge boundary with a SwiftUI probe app and `BluetoothProbeService.swift`.
- Added target profile probes for PBAP/PSE `112F`, MAP/MAS `1132`, MAP/MNS `1133`, HFP AG `111F`, and HFP HF `111E`.
- Updated the iPad local API server/controller so `/health`, `/status`, `/devices`, `/events`, `/probe/start`, `/probe/stop`, and `/probe/connect` expose probe state on `http://127.0.0.1:8765`; `/contacts`, `/messages`, and `/calls` deliberately return reserved `501` responses until the iPad proves the Bluetooth profile channels.
- Updated `docs/ops/CONTEXT_INDEX.md` and `docs/ops/MIGRATION_MANIFEST.md` for the new `apps/ipad-phone-bridge` lane.
- `git diff --check` passed; line-ending normalization warnings only.
- Confirmed `xcodebuild` and `swift` are not installed in this Windows workspace.
- Verification on this Windows machine is source/static only: `xcodebuild`, code signing, and physical iPad Bluetooth validation require a Mac with Xcode and the target iPad.

## 2026-05-18 NerveCenter Shailos Pending Answer Filter

- Researched dashboard/workflow practice before editing: operational queues should stay source-of-truth driven and surface only items with a concrete next action.
- Changed NerveCenter Shailos queue normalization so answer and got-back state can be read from both Shailos app records and legacy task overlay fields.
- Changed Shailos task sync so an existing answer completes the research step and got-back completion wins over stale linked tasks.
- Changed the NerveCenter Shailos row wording from "pending research" to "pending answer" so optional Lab AI research does not appear required.
- Focused Node state test passed for optional research, answered/get-back, and got-back-hidden cases.
- `npm run build` passed in `apps/web`; existing large-bundle warning remains.
- `git diff --check` passed; existing line-ending normalization warnings only.
- Vite preview returned HTTP 200 at `http://127.0.0.1:4310/?suite=nervecenter`; dev server smoke was blocked by the existing unresolved `@emotion/is-prop-valid` import under `apps/web/shailos/assets`.
- Pushed commit `73f1796` to `origin/main`; Netlify Git-triggered production served `assets/index-MjB3wvi_.js` on poll attempt 3.

## 2026-05-18 NerveCenter Shailos Strict Queue Cleanup

- Tightened NerveCenter Shailos task classification so bare Shaila-priority tasks no longer create Shailos-pane rows.
- Kept legacy Shaila-priority task records as supporting evidence only when they match a real Shailos record by text.
- Added fallback matching for old task text prefixes such as "Research" and "Get back" so prior answer/got-back fields can still resolve matching Shailos.
- Changed recently resolved Shailos filtering to use the strict Shaila workflow classifier.
- Focused Node state test passed for non-Shaila priority noise, legacy answer matching, got-back hiding, and linked pending Shailos.
- `npm run build` passed in `apps/web`; existing large-bundle warning remains.
- `git diff --check` passed; existing line-ending normalization warnings only.
- Vite preview returned HTTP 200 at `http://127.0.0.1:4311/?suite=nervecenter`.

## 2026-05-18 NerveCenter Phone Text Threads

- Researched conversation-list practice before editing: compact lists should group messages into contact/thread rows and expand manually to show the message history.
- Changed NerveCenter phone messages from latest-message rows into contact threads sorted by latest activity.
- Expanded text rows now render the fetched conversation history chronologically with incoming/outgoing bubble alignment and direct call/reply icons.
- Kept the collapsed row compact with the latest text preview, latest time, unread styling, and message count.
- `npm run build` passed in `apps/web`; existing large-bundle warning remains.
- `git diff --check` passed; existing line-ending normalization warnings only.
- Vite preview returned HTTP 200 at `http://127.0.0.1:4312/?suite=nervecenter`.

## 2026-05-18 AI Job Registry Consolidation

- Researched current AI API best practice before editing: keep prompts centralized, use structured outputs where available, keep stable prompt prefixes cache-friendly, and validate/repair model JSON before writing to app state.
- Added a backend AI job registry in `apps/web/backend/functions/_ai-core.cjs` with 25 named jobs spanning Yeshivish transcription, NerveCenter analysis, tasks, email summaries, schedule parsing, and Shailos parsing/research/summaries.
- Moved active web and Shailos callers onto `runAIJob(...)` so prompts now live in the backend registry instead of being scattered across UI modules.
- Preserved existing provider/model settings flow through `/.netlify/functions/ai-proxy`; production `/.netlify/functions/app-config` returned HTTP 200 with 25 jobs, including `transcribe.yeshivish.v1` and `shaila.research_summarize_sources.v1`.
- `node --check` passed for `_ai-core.cjs`, `ai-proxy.js`, `app-config.js`, and `01-core.js`.
- `npm run lint` and `npm run build` passed in `apps/shailos`.
- `node scripts/copy-shailos-to-dist.cjs` passed in `apps/web`.
- `npm run build` passed in `apps/web`; existing large-bundle warning remains.
- Local Vite preview returned HTTP 200 for `/` and `/shailos/`.
- `npm run lint` in `apps/web` is still blocked by the existing ESLint glob issue where `src/*.jsx` is ignored by repo lint config.
- Pushed commit `b349b40` to `origin/main`; production root returned HTTP 200 and production `app-config` served the new AI job registry.

## 2026-05-19 NerveCenter Phone Thread Merge

- Researched SMS/threading practice before editing: conversation threads should be keyed by canonical participants, not by whether a row is incoming or outgoing.
- Changed NerveCenter phone thread grouping to key message rows by canonical phone digits, using DeskPhone's normalized fields when available and falling back to local normalization.
- Confirmed the localhost DeskPhone payload can emit incoming rows as `from:+1...` and sent rows as `to`/`number` 10-digit values for the same contact, matching the observed split.
- Added a clear close icon to the expanded conversation header beside Call and Reply.
- `npm run build` passed in `apps/web`; existing large-bundle warning remains.
- Local preview returned HTTP 200 at `http://127.0.0.1:4313/?suite=nervecenter`.
- `git diff --check -- apps/web/src/08-app-split/components/NerveCenterPhoneSurface.jsx` passed; full `git diff --check` remains blocked by pre-existing `docs/ops/VERIFICATION_LOG.md` CRLF/trailing-whitespace churn already present in the dirty worktree.
- In-app browser/Node REPL visual smoke was attempted, but the local helper failed on the existing `require is not defined in ES module scope` boot issue.

## 2026-05-19 DeskPhone Web Freeze And Reconnect Fix

- Researched current frontend/realtime practice before editing: long browser lists should render in bounded batches, request loops should avoid overlapping fetches and use timeouts, and live connection status should come from active health checks rather than stale text flags.
- Changed DeskPhone Web conversation building to avoid duplicate per-thread sorts and render conversation rows in incremental batches while still keeping the selected thread's message batching.
- Added host fetch timeouts and refresh coalescing to DeskPhone Web so slow `/messages` or attachment requests do not stack overlapping refreshes.
- Changed both DeskPhone Web and the NerveCenter phone surface so incoming call copy is clean and ringing calls expose both Answer and Decline controls.
- Released native DeskPhone `b265`: fixed the host parser that treated `Not connected` as connected, marks MAP disconnected when both live folder probes fail, and queues a paced reconnect to the default saved phone when message sync stops responding.
- `npm run build` passed in `apps/web`; existing large-bundle warning remains.
- `dotnet build` passed in `apps/phone-host-windows`; existing NuGet/nullable/async warnings remain.
- `dotnet build .\DeskPhone.csproj -c Release` passed and deployed `b265`.
- Local host verification after b265 settled returned `build:"b265  05/19/26 1:14 am"`, `connected:true`, `hfp:"HFP connected"`, `map:"MAP connected"`, and `callState:"Idle"`.
- Local Vite returned HTTP 200 at `http://127.0.0.1:4314/?suite=deskphone`. In-app Browser verification hit the existing local Node helper `require is not defined in ES module scope` crash; headless Chrome reached the existing unauthenticated `Loading...` shell.
- `git diff --check -- apps/web/src/10-deskphone-web.jsx apps/web/src/08-app-split/components/NerveCenterPhoneSurface.jsx apps/phone-host-windows/ViewModels/MainViewModel.cs apps/phone-host-windows/Services/MapService.cs` passed; line-ending normalization warnings only.
- Pushed commits `1336a7f` and `286672a` to `origin/main`; Netlify Git-triggered production served `assets/index-gFNvDYvH.js` on poll attempt 2.

## 2026-05-19 NerveCenter Expanded Thread Bottom Anchor

- Researched current chat/thread scrolling practice before editing: messages stay in chronological DOM order and the expanded view anchors to the latest appended message using a rendered end marker.
- Changed `NerveCenterPhoneSurface.jsx` so an expanded contact thread scrolls to the rendered conversation end when opened and when the latest message signature changes.
- `npm run build` passed in `apps/web`; existing large-bundle warning remains.
- `git diff --check -- apps/web/src/08-app-split/components/NerveCenterPhoneSurface.jsx` passed; line-ending normalization warning only.
- Local Vite preview returned HTTP 200 at `http://127.0.0.1:4315/?suite=nervecenter`.
- Local DeskPhone host returned HTTP 200 at `/status` and `/messages?limit=50` with connected message data available for smoke context.
- In-app Browser verification was attempted, but the existing local helper failed on `require is not defined in ES module scope`; headless Chrome reached the existing unauthenticated `Loading...` shell.
- Pushed commit `d7da807` to `origin/main`; Netlify Git-triggered production served `assets/index-BhHooHv2.js` on poll attempt 3.
- Production asset `https://onetaskfocuser.netlify.app/assets/index-BhHooHv2.js` returned HTTP 200.

## 2026-05-19 Phone Date Labels And Expanded Thread Exit

- Researched current date/time display practice before editing: recent activity can use relative or weekday labels, but older history should include a date; user-locale formatters should be preferred over hand-coded numeric dates.
- Changed NerveCenter phone timestamps so today keeps minute/hour labels, current-week rows can use weekday, and older rows show month/day with year when needed.
- Added a sticky floating close button inside expanded NerveCenter text threads so the bottom-anchored conversation can be closed without scrolling back to the header.
- Changed DeskPhone Web conversation list labels to use weekday only for the current week and real dates for older threads.
- Changed DeskPhone Web call-history rows to format from call timestamps first, showing today as time, current-week calls as weekday plus time, and older calls as date plus time.
- `npm run build` passed in `apps/web`; existing large-bundle warning remains.
- `git diff --check -- apps/web/src/08-app-split/components/NerveCenterPhoneSurface.jsx apps/web/src/10-deskphone-web.jsx` passed; line-ending normalization warnings only.
- Local Vite preview returned HTTP 200 at `http://127.0.0.1:4316/?suite=nervecenter`; local DeskPhone host `/status` returned HTTP 200.
- In-app Browser verification was attempted, but the existing local helper failed on `require is not defined in ES module scope`; headless Chrome reached the existing unauthenticated `Loading...` shell.
- Pushed commit `0ec64e7` to `origin/main`; Netlify Git-triggered production served `assets/index-DGMB_5bb.js` on poll attempt 3.

## 2026-05-19 NerveCenter Collapsed Thread Count Cleanup

- Researched badge/count usage before editing: count badges should call attention to unread/new/actionable information, not total history length on every conversation row.
- Removed the collapsed-row total message count from NerveCenter phone text threads.
- Kept the expanded conversation count in the opened thread header.
- `npm run build` passed in `apps/web`; existing large-bundle warning remains.
- `git diff --check -- apps/web/src/08-app-split/components/NerveCenterPhoneSurface.jsx` passed; line-ending normalization warning only.
- Local Vite preview returned HTTP 200 at `http://127.0.0.1:4317/?suite=nervecenter`.
- Pushed commit `4193857` to `origin/main`; Netlify Git-triggered production served `assets/index-DsQIkbDO.js` on poll attempt 4.

## 2026-05-20 Google Workspace Persistence And Theme Contrast

- Researched current Google Workspace auth practice before editing: durable Gmail/Calendar access should use authorization-code flow with server-side refresh-token storage; browser access tokens remain short-lived by design.
- Researched WCAG contrast practice before editing: normal UI text should meet at least 4.5:1 contrast.
- Added `apps/web/backend/functions/google-workspace.js` for Firebase-authenticated Google Workspace actions: status, code exchange, refresh-backed Calendar/Gmail summary fetches, full Gmail message fetch, Calendar event creation, and disconnect/revoke.
- Added public app-config flags for `googleAuthMode` / `googleServerAuthAvailable`; local fake-env probe returned `{"googleClientId":"fake-client.apps.googleusercontent.com","googleAvailable":true,"googleAuthMode":"server","googleServerAuthAvailable":true}`.
- Checked current Netlify env: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are not present yet, so production will stay on browser-token fallback until those Google OAuth server credentials are added.
- Updated the split web app to use the server Google auth path when available and keep the existing browser token path as fallback.
- Corrected built-in color scheme tokens and added `ensureSchemeContrast` so built-in/generated/custom schemes are normalized before use.
- Focused scheme audit across text, muted, faint, primary, tonal, success, danger, and warning tokens returned `contrast_failures=0`.
- `node --check` passed for `apps/web/backend/functions/google-workspace.js` and `apps/web/backend/functions/_ai-core.cjs`.
- `git diff --check -- apps/web/backend/functions/google-workspace.js apps/web/backend/functions/_ai-core.cjs apps/web/netlify.toml apps/web/src/08-app-split/App.jsx apps/web/src/08-app-split/components/NerveCenterPanel.jsx apps/web/src/01-core.js apps/web/src/07-settings.jsx` passed; line-ending normalization warnings only.
- `npm run build` passed in `apps/web`; existing large-bundle warning remains.
- Local Vite returned HTTP 200 at `http://127.0.0.1:4318/?suite=nervecenter`; headless Edge screenshot still reached the known unauthenticated/fresh-profile `Loading...` shell.
- Pushed commit `9f4912a` to `origin/main`; Netlify Git-triggered production served `assets/index-C30KzPHN.js` on poll attempt 3, the asset returned HTTP 200, production `app-config` exposed `googleAuthMode:"token"` and `googleServerAuthAvailable:false`, and `google-workspace` returned HTTP 401 without an app sign-in token as expected.

## 2026-05-19 Backup Folder And Auto-Export Cleanup

- Researched current browser backup/export practice before editing: browser file writes should be user-controlled through File System Access folder/file pickers where supported, automatic exports should use a selected folder rather than unsolicited Downloads files, retention should be bounded, and sensitive tokens should stay out of client-side backup JSON.
- Changed `Store.autoFileBackup` so automatic weekly backups write only to the user-selected backup folder; if no folder is selected or permission has lapsed, the app uses Firebase/localStorage recovery and does not create Downloads files.
- Removed reload/close-triggered forced file backups from the app close lifecycle while keeping the localStorage close flush.
- Changed manual full backup to save into the chosen backup folder when available, otherwise ask for a save location through the browser file picker before falling back to a user-initiated download.
- Added backup metadata to exported JSON documenting included app state, Shailos, counts, and excluded sensitive/local-only data.
- Changed Settings > Account backup copy to show the selected folder state and clarify the no-Downloads automatic behavior.
- `npm run build` passed in `apps/web`; existing large-bundle warning remains.
- `git diff --check -- apps/web/src/01-core.js apps/web/src/07-settings.jsx apps/web/src/08-app-split/App.jsx apps/web/src/08-app.jsx` passed; line-ending normalization warnings only.
- Local Vite dev server returned HTTP 200 at `http://127.0.0.1:4318/?suite=nervecenter`.
- In-app Browser verification was attempted, but the local Node helper failed on the existing `require is not defined in ES module scope` boot issue; headless Edge/CDP verified Settings > Account rendered the new backup copy and `Choose backup folder...` control.
- Pushed commit `71da44c` to `origin/main`; Netlify Git-triggered production served `assets/index-B7pva3ri.js` on poll attempt 1 and the asset returned HTTP 200.

## 2026-05-20 NerveCenter Floating Conversation Actions

- Researched current floating/contextual-action practice before editing: promoted actions should stay available near the active content, grouped controls should have clear labels, targets need sufficient size/spacing, and floating controls should leave content reachable.
- Changed `NerveCenterPhoneSurface.jsx` so expanded text threads keep sticky bottom actions for Call, Reply, and Close instead of only a floating close button.
- `npm run build` passed in `apps/web`; existing large-bundle warning remains.
- `git diff --check -- apps/web/src/08-app-split/components/NerveCenterPhoneSurface.jsx` passed; line-ending normalization warning only.
- Local Vite preview returned HTTP 200 at `http://127.0.0.1:4317/?suite=nervecenter`; production bundle asset `assets/index-COtoe0KV.js` returned HTTP 200 from the same preview.
- Local DeskPhone host `/status` returned HTTP 200.
- In-app Browser verification was attempted, but the existing local helper failed on `require is not defined in ES module scope`; Vite dev mode also hit the existing embedded Shailos asset scanner issue, so preview served the built bundle for local smoke verification.
- Pushed commit `48a53ab` to `origin/main`; Netlify Git-triggered production served `assets/index-COtoe0KV.js` on poll attempt 3.

## 2026-05-20 DeskPhone Web Contrast Repair

- Researched WCAG 2.2 AA contrast expectations: normal text should reach 4.5:1, with UI/non-text controls at least 3:1.
- Repaired DeskPhone Web's component-level theme bridge so message bubbles, menus, compose input, action buttons, call banners, and dialer controls use per-surface readable CSS variables instead of hardcoded white/light assumptions.
- DeskPhone theme matrix audit passed: 18 built-in schemes plus 4 adversarial custom schemes, 24 critical text/background pairs each, 0 failures below 4.5:1.
- `npm run build` in `apps/web` passed and generated `assets/index-Byx5ijvj.js`; existing bundle-size warning remains.
- Local preview `http://127.0.0.1:4320/?suite=deskphone` returned HTTP 200. A fresh-profile headless screenshot stayed on the existing `Loading...` gate, so the local render proof is the matrix audit plus production build.
- Pushed commit `2195385` to `origin/main`; Netlify Git-triggered production served `assets/index-Byx5ijvj.js` on poll attempt 3, and the deployed asset returned HTTP 200.

## 2026-05-20 Full Queue Layout Containment

- Researched current CSS layout guidance before editing: fixed-width work lanes should stay bounded by the available viewport, flex children that contain long text need `min-width: 0`, and long tokens should be allowed to wrap or ellipsize inside their own box instead of expanding the page.
- Changed the full queue command page in `apps/web/src/08-app-split/App.jsx` so the non-focus header, tab bar, and queue tab share a bounded `760px` page width with `minWidth: 0`.
- Changed queue rows so task text and edit fields can shrink inside the row, long unbroken task strings use safe overflow containment, and dense action controls wrap under the row on compact widths.
- `git diff --check -- apps/web/src/08-app-split/App.jsx` passed; line-ending normalization warning only.
- `npm run build` passed in `apps/web`; existing large-bundle warning remains.
- Local preview returned HTTP 200 at `http://127.0.0.1:4322/`.
- In-app Browser verification was attempted first, but the existing local helper failed on `require is not defined in ES module scope`.
- Headless Edge/CDP seeded 12 queue tasks including one long unbroken token and verified desktop `1365x850` plus mobile `390x820`: document/root scroll width matched viewport width, the queue page stayed bounded (`760px` desktop, available mobile width), and measured queue row overflow count was `0` in both viewports. Screenshots were written under `apps/web/artifacts/queue-layout-*-seeded.png`.
- Pushed commit `28cfa09` to `origin/main`; Netlify Git-triggered production served `assets/index-BySJo-zy.js` on poll attempt 2, and the deployed asset contained the queue containment marker.

## 2026-05-20 Calendar Routing From Brain Dump And Record Anything

- Researched calendar event handling before editing: Google Calendar expects IANA time-zone identifiers or explicit RFC3339 offsets for timed events; RFC 5545 treats no-zone local date-times as floating times.
- Changed the shared AI job registry so Brain Dump parsing can return separate `scheduleItems` while keeping ordinary actions in `tasks`.
- Added a shared calendar-event parser/defaulting helper that applies `America/New_York` to timed events when the user does not specify another zone.
- Changed NerveCenter Add Event, Brain Dump Review, and Record Anything/Call Capture so parsed schedule items create Calendar events through the existing Google Calendar path instead of being filed as `today` tasks.
- Targeted helper smoke confirmed a no-zone timed event gets `start.timeZone` / `end.timeZone` of `America/New_York`, while an explicit `-07:00` offset is preserved.
- `git diff --check -- apps/web/backend/functions/_ai-core.cjs apps/web/src/01-core.js apps/web/src/08-app-split/App.jsx apps/web/src/08-app-split/components/ConvCapture.jsx apps/web/src/08-app-split/components/NerveCenterPanel.jsx apps/web/src/04-components.jsx` passed; line-ending normalization warnings only.
- `npm run build` passed in `apps/web` and generated `assets/index-DqbwuWbq.js`; existing large-bundle warning remains.
- Local Vite dev server returned HTTP 200 at `http://127.0.0.1:4305/?suite=nervecenter`; in-app Browser verification hit the existing Node ESM helper boot issue, and fresh-profile headless Edge reached the known `Loading...` shell.
- Pushed commit `0978da5` to `origin/main`; Netlify production served `assets/index-BseNaqHz.js`, and the deployed asset contained the `scheduleItems`, `America/New_York`, and calendar-add success markers.

## 2026-05-20 Auth Session Persistence And Google Prompt Throttle

- Researched Firebase Auth web persistence and Google Identity Services auth models: durable app sessions should use explicit local persistence with a remember-device choice, while durable Gmail/Calendar access should use server auth-code refresh-token storage.
- Production `app-config` still reports `googleAuthMode:"token"` and `googleServerAuthAvailable:false`, so Gmail/Calendar remain on the browser-token fallback until the Google OAuth client/secret are configured in Netlify.
- Changed `AuthGate` and `LoginScreen` to set Firebase auth persistence before auth-state listening and before password/Google sign-in, with a default-on `Stay signed in on this device` option.
- Changed the browser-token Google fallback to treat near-expired tokens as expired, clear stale tokens consistently, and throttle silent reconnect attempts with a 10-minute cooldown.
- `git diff --check -- apps/web/src/00-auth.jsx apps/web/src/08-app-split/App.jsx` passed; line-ending normalization warnings only.
- `npm run build` passed in `apps/web` and generated `assets/index-ZTkUASIM.js`; existing large-bundle warning remains.
- Built asset marker check found `Stay signed in on this device`, `ot_auth_stay_signed_in`, `ot_google_silent_reauth_last`, and `Reconnect Google to refresh Calendar and Gmail`.
- Pushed commit `b0b56db` to `origin/main`; Netlify Git-triggered production served `assets/index-AlH-x7EB.js` on poll attempt 1, and the deployed asset contained the app-session persistence and Google reconnect markers.

## 2026-05-20 NerveCenter Chief Of Staff, Clock, And Calendar Focus

- Researched current dashboard, human-AI, and accessibility practice before editing: keep dashboards scannable and action-oriented, surface contextually relevant AI suggestions with user control/follow-up, use spacing/hierarchy to prioritize the important item, and avoid horizontal overflow/reflow regressions. The local plan aligned with the research, so no product-direction confirmation was needed.
- Added shared AI jobs `dashboard.chief_of_staff.v1` and `dashboard.chief_dialogue.v1` to the central gateway registry. The Chief scan consumes current time, calendar, Gmail summaries, tasks, shailos, and DeskPhone call/text snapshots, returns a short grounded recommendation, and keeps a local fallback when AI is unavailable.
- Added a center `Chief of Staff` card in the lower NerveCenter strip with automatic scan output, source pills, refresh, and a follow-up prompt.
- Added a prominent NerveCenter time/date header and a persistent compact clock in the suite rail.
- Changed the lower NerveCenter strip to Calendar / Chief / Mail and changed calendar rendering so routine daily items remain visible while special non-routine items get the spotlight and heavier row treatment.
- Added a DeskPhone activity snapshot callback so NerveCenter can include unread texts, missed calls, recent texts, and recent calls in the Chief context without changing the phone host API.
- `node --check apps/web/backend/functions/_ai-core.cjs` passed.
- `git diff --check -- apps/web/backend/functions/_ai-core.cjs apps/web/src/08-app-split/App.jsx apps/web/src/08-app-split/components/AppSuiteChrome.jsx apps/web/src/08-app-split/components/NerveCenterPanel.jsx apps/web/src/08-app-split/components/NerveCenterPhoneSurface.jsx` passed; line-ending normalization warnings only.
- `npm run build` passed in `apps/web` and generated `assets/index-BseNaqHz.js`; existing large-bundle warning remains.
- Local preview returned HTTP 200 at `http://127.0.0.1:4324/?suite=nervecenter`.
- In-app Browser verification was attempted but hit the existing local helper boot issue (`require is not defined in ES module scope`), so headless Edge/CDP was used for visual proof.
- Headless Edge/CDP seeded calendar, Gmail, task, shaila, and phone data and verified NerveCenter, Chief, AI recommendation, clock zone, special calendar item, routine calendar items, mail, tasks, phone activity, and no horizontal overflow (`scrollW=1365`, `clientW=1365`). Screenshot: `apps/web/artifacts/nervecenter-chief-staff-smoke.png`.
- Pushed commit `ac21937` to `origin/main`; Netlify Git-triggered production served `assets/index-BseNaqHz.js` on poll attempt 3, and the deployed asset returned HTTP 200.

## 2026-05-20 Chief Tweaks, Schedule Approval, And Text Links

- Researched current standards before editing: calendar widgets should expose a current-time marker and initial scroll position, task/action suggestions should stay user-approved and editable, Google Calendar events should use event start/end fields, Netlify secrets should live in site environment variables, and external text-message links should open with `noopener`/`noreferrer` protections.
- Changed Chief missed-call context so only unresolved missed calls count as return-call work; later outbound calls, outbound texts, or non-missed inbound calls for the same number mark older missed calls as already handled.
- Added email/calendar task suggestions in the Chief card as editable `Create new task?` approval rows with auto-selected priority and a dismiss path.
- Added the current-time line and auto-scroll behavior to the NerveCenter schedule card.
- Changed the Chief discussion box to show a visible pending assistant response while the AI is thinking.
- Changed NerveCenter phone replies so the composer opens at the clicked row/action and focuses the message field for immediate typing and Enter-to-send.
- Changed Record Anything schedule parsing so event-like items stay as schedule items with editable date, time, duration, and notes; incomplete schedule approvals explain which details are missing before Calendar creation.
- Made URLs inside NerveCenter expanded text messages clickable and applied the same safe link rendering to DeskPhone Web message bubbles.
- `node --check apps/web/backend/functions/_ai-core.cjs` passed.
- `git diff --check -- apps/web/backend/functions/_ai-core.cjs apps/web/src/08-app-split/components/ConvCapture.jsx apps/web/src/08-app-split/components/NerveCenterPanel.jsx apps/web/src/08-app-split/components/NerveCenterPhoneSurface.jsx apps/web/src/10-deskphone-web.jsx` passed; line-ending normalization warnings only.
- `npm run build` passed in `apps/web` and generated `assets/index-o2Hb_rOw.js`; existing large-bundle warning remains.
- Local preview returned HTTP 200 at `http://127.0.0.1:4326/?suite=nervecenter`.
- In-app Browser verification was attempted but hit the existing Node ESM helper boot issue (`require is not defined in ES module scope`), so headless Edge/CDP verified the built NerveCenter route hydrated with zero runtime exceptions. Screenshot: `apps/web/artifacts/chief-tweaks-nervecenter-hydrated.png`.
- Pushed commit `761962b` to `origin/main`; Netlify Git-triggered production served `assets/index-o2Hb_rOw.js` on poll attempt 3, and the deployed asset contained the new Chief suggestion, resolved-missed-call, dialogue pending-response, and secure-link markers.

## 2026-05-20 Chief Learning, Suggestion Suppression, And Timeline Fix

- Researched current recommendation-feedback and human-AI interaction practice before editing: explicit dismiss/accept actions should feed future suggestion display, negative feedback should reduce repeated suggestions quickly, and dynamic assistant replies should remain visible as status updates. Calendar current-time indicators should share the same visual layer as event blocks when an event is active. The local plan aligned with that research, so no confirmation gate was needed.
- Added local Chief learning storage keyed as `ot_chief_learning_v1`; it records accepted/rejected suggestion decisions as compact hashes plus action type/source/priority metadata, avoiding full email body or task-text storage.
- Changed Chief task suggestions so accepted and dismissed suggestions are suppressed for the same source freshness; a changed/new Gmail or Calendar source can surface a related suggestion again.
- Passed the learning profile into `dashboard.task_suggestions.v1` so the AI can favor accepted action types and learned priority patterns while avoiding repeatedly rejected action types.
- Changed Chief discussion replies to read `job.output` as well as `job.text`, and reserved a visible `role="status"` dialogue area so the assistant response is not hidden behind the card layout.
- Changed the schedule current-time rule so active events draw the horizontal line through the event row; standalone Now rows remain for gaps between events.
- `node --check apps/web/backend/functions/_ai-core.cjs` passed.
- `git diff --check -- apps/web/src/08-app-split/components/NerveCenterPanel.jsx apps/web/backend/functions/_ai-core.cjs` passed; line-ending normalization warnings only.
- `npm run build` passed in `apps/web` and generated `assets/index-BdNe6hP6.js`; existing large-bundle warning remains.
- Local preview returned HTTP 200 at `http://127.0.0.1:4328/?suite=nervecenter`.
- In-app Browser verification was attempted but hit the existing Node ESM helper boot issue (`require is not defined in ES module scope`), so verification used the successful production build and built-asset marker checks for the Chief learning/suppression code path.
- Pushed commit `b415d03` to `origin/main`; Netlify Git-triggered production served `assets/index-BdNe6hP6.js` on poll attempt 4, and the deployed asset contained the Chief learning, source freshness, and dialogue pending-response markers.

## 2026-05-20 Chief Suggestion Hard Suppression And Resizable Chat

- Researched current recommendation-feedback practice before editing: negative feedback should quickly reduce similar suggestions, dismissed AI services should stay easy to shut down, and user control should be learned over time.
- Strengthened Chief suggestion suppression so accepted/dismissed rows record `suppressionKey`, normalized `textKey`, `sourceTitleKey`, `sourceBucket`, source key, action type, and the older issue key.
- Changed future suggestion filtering to suppress on any matching stable issue, matching normalized task text, matching source/action, or strong source-title overlap. This covers AI paraphrases instead of only exact repeated rows.
- Changed source matching so unknown/paraphrased suggestions no longer fall back blindly to the first Gmail/Calendar row; they need direct or strong token overlap before borrowing a source identity.
- Made the Chief response history vertically resizable with a persisted `ot_chief_chat_height_v1` height and reset-on-double-click handle.
- Changed the Chief prompt field from a fixed one-line input to a vertically resizable textarea; Enter submits and Shift+Enter inserts a new line.
- `node --check apps/web/backend/functions/_ai-core.cjs` passed.
- `git diff --check -- apps/web/src/08-app-split/components/NerveCenterPanel.jsx apps/web/backend/functions/_ai-core.cjs` passed; line-ending normalization warning only.
- `npm run build` passed in `apps/web` and generated `assets/index-BqnHW-B-.js`; existing large-bundle warning remains.
- Local preview returned HTTP 200 at `http://127.0.0.1:4329/?suite=nervecenter`.
- Built-asset marker check found `ot_chief_chat_height_v1`, `suppressionKey`, `sourceTitleKey`, `row-resize`, and `Discuss next move`.

## 2026-05-20 Chief Cloud Profile And AI Bandwidth Guard

- Researched current AI memory/user-control and AI rate-limit practice before editing: durable assistant memory should be visible, editable, deletable, and scoped to user preferences; background AI work should use caching/throttling and avoid repeated automatic calls. The local plan aligned with the research, so no confirmation gate was needed.
- Added `/.netlify/functions/chief-profile`, backed by Netlify Blobs store `chief-profile`, to persist Chief preferences and learning outside the local browser/PC.
- Added a Chief `Profile` editor in NerveCenter. The app reads/writes the profile after Firebase sign-in and stores the generated Markdown profile in the cloud blob key `chief-profile/<user>.md`.
- Changed Chief dialogue so preference statements such as "don't remind me about those" save a profile note; when a matching Calendar item is visible, Chief asks for explicit confirmation before deleting it.
- Added a Google Workspace `deleteCalendarEvent` action and carried `calendarId` through calendar rows so confirmed deletes can target the right Google calendar.
- Added client-side cache/throttle guards for automatic Chief scans and task suggestions: Chief scan cache lasts 30 minutes with a 20-minute minimum auto-AI gap, and task suggestions cache lasts 45 minutes with a 25-minute minimum auto-AI gap. Manual Chief refresh still bypasses the scan cache.
- `node --check backend/functions/chief-profile.js`, `node --check backend/functions/google-workspace.js`, and `node --check backend/functions/_ai-core.cjs` passed.
- `npm run build` passed in `apps/web` and generated `assets/index-B4WBSyWK.js`; existing large-bundle warning remains.
- `node -e "require('@netlify/blobs')"` passed in `apps/web`.
- `git diff --check` passed; line-ending normalization warnings only.
- Pushed commit `9a47bf1` to `origin/main`; Netlify Git-triggered production served `assets/index-B4WBSyWK.js` on poll attempt 4.
- Production asset marker check found `ot_chief_scan_cache_v1`, `ot_chief_task_suggestions_cache_v1`, `Chief profile`, and `deleteCalendarEvent`.
- Production `/.netlify/functions/chief-profile` returned HTTP 401 without an app sign-in token, confirming the profile endpoint is not publicly writable/readable.

## 2026-05-20 Chief Smart Response Pills

- Researched current smart-reply/action-chip practice before editing: compact contextual chips should expose clear actions, stay low-friction, give immediate feedback, and write preference/feedback signals into durable user-controlled memory. The local plan aligned with the research, so no confirmation gate was needed.
- Added Chief smart response chips: `Done`, `Not now`, `Next`, and `Other`.
- `Done`, `Not now`, and `Next` now record compact Chief learning events and append a `smart_response_*` note through the cloud Chief profile, which writes the updated profile Markdown blob.
- `Other` records the different-direction signal, adds an immediate Chief reply, and focuses the discussion textarea for the user's custom instruction.
- `node --check apps/web/backend/functions/chief-profile.js` passed.
- `git diff --check -- apps/web/src/08-app-split/components/NerveCenterPanel.jsx` passed; line-ending normalization warning only.
- `npm run build` passed in `apps/web` and generated `assets/index-xM_h8vkM.js`; existing large-bundle warning remains.
- Local Vite returned HTTP 200 at `http://127.0.0.1:4330/?suite=nervecenter`; Vite stderr still reports the existing embedded Shailos `@emotion/is-prop-valid` dependency warning.
- In-app Browser verification was attempted first but hit the existing Node ESM helper boot issue (`require is not defined in ES module scope`), so direct Chrome/CDP verified the NerveCenter Chief card rendered with all four smart-response buttons enabled and no horizontal overflow (`scrollW=1349`, `clientW=1349`).
- Direct Chrome/CDP click-smoke verified `Other` leaves all four chips present, adds `Tell me the direction you want instead.`, and focuses the `Discuss next move` textarea.
- Pushed commit `abf59c0` to `origin/main`; Netlify Git-triggered production served `assets/index-xM_h8vkM.js`, the asset returned HTTP 200, and the deployed bundle contained the Chief smart-response/profile-learning markers.

## 2026-05-20 Chief Page And Feedback Rescan

- Researched current human-AI feedback and dashboard practice before editing: AI recommendations should accept granular correction during normal use, preserve user control, and update future recommendations; mobile dashboards should prioritize the critical action and keep supporting details secondary. The local plan aligned with that research, so no confirmation gate was needed.
- Added a dedicated Chief suite page at `?suite=chief`, surfaced as `Chief` in the left suite rail and reachable from the NerveCenter Chief card via `Open`.
- Changed Chief feedback handling so `Not now`, `Next`, `Done`, and typed corrections such as `skip this` or `I do not want sleep tasks now` record local Chief learning, clear stale Chief/task-suggestion caches, and force a rescan path instead of leaving the stale recommendation in place.
- Passed Chief learning into the AI context and prompt so rejected/skipped recommendations are treated as feedback signals in future scans and dialogue.
- Changed smart-response persistence so local learning and the visible reply still succeed when cloud profile sync is unavailable; cloud profile failure is now a secondary status, not a blocker.
- `node --check apps/web/backend/functions/_ai-core.cjs` passed.
- `git diff --check -- apps/web/backend/functions/_ai-core.cjs apps/web/src/08-app-split/App.jsx apps/web/src/08-app-split/components/AppSuiteChrome.jsx apps/web/src/08-app-split/components/NerveCenterPanel.jsx apps/web/src/08-app-split/ui-tokens.jsx` passed; line-ending normalization warnings only.
- `npm run build` passed in `apps/web` and generated `assets/index-DOs95XYV.js`; existing large-bundle warning remains.
- Local preview returned HTTP 200 at `http://127.0.0.1:4334/?suite=chief`.
- In-app Browser verification was attempted first, but the existing local helper failed on `require is not defined in ES module scope`; direct Edge/CDP verified mobile `390x820` Chief page render with Chief, Next best move, Not now, Discuss, Chief profile, and no horizontal overflow (`scrollW=390`, `clientW=390`).
- Direct Edge/CDP click-smoke verified `Not now` records a rejected Chief learning event, preserves no horizontal overflow, and shows a useful local-save response when cloud profile sync is unavailable.
- Direct Edge/CDP chat-smoke verified typing `skip this, I do not want sleep tasks now` records a rejected Chief learning event and shows `Got it. I am dropping... rescanning for a better next move.`
- Pushed commit `177a60f` to `origin/main`; Netlify Git-triggered production served `assets/index-DOs95XYV.js` on poll attempt 4, and the deployed asset returned HTTP 200.

## 2026-05-20 Before Shavuos Priority And Chief Re-entry

- Researched current task-priority/category and contrast practice before editing: durable priority identities should remain stable while labels are user-editable, urgent lane ordering should be deterministic across surfaces, and normal text should meet WCAG AA 4.5:1 contrast with UI components at 3:1. The local plan aligned with that research, so no confirmation gate was needed.
- Added the `before_shavuos` priority with editable label `Before Shavuos`, strong blue `#0B57D0`, and a migration helper that adds/repairs it for existing saved accounts without replacing the user's edited title.
- Changed task ordering so active `before_shavuos` tasks sort above pinned tasks in manual, AI-assisted, and pin-override ordering paths.
- Surfaced the category in the Task Manager main priority row, Settings priority editor, priority change picker, and NerveCenter compact add controls.
- Reintroduced a smaller Chief page route at `?suite=chief`, added `Chief` to the suite rail, and added an `Open` action from the NerveCenter Chief card.
- Changed Chief smart-response and typed-rejection handling so `Not now`, `Next`, `Done`, `skip`, and `stop showing sleep tasks` record local learning first, clear stale Chief caches, and force a rescan even when cloud profile sync is unavailable.
- `npm run build` passed in `apps/web` and generated `assets/index-DU9qD_Lz.js`; existing large-bundle warning remains.
- `git diff --check -- apps/web/src/01-core.js apps/web/src/07-settings.jsx apps/web/src/08-app-split/App.jsx apps/web/src/08-app-split/components/AppSuiteChrome.jsx apps/web/src/08-app-split/components/NerveCenterPanel.jsx apps/web/src/08-app-split/ui-tokens.jsx` passed; line-ending normalization warnings only.
- Local Vite returned HTTP 200 at `http://127.0.0.1:4336/?suite=chief`.
- Direct ordering smoke verified `before_shavuos` sorts before a pinned `now` task and keeps color `#0B57D0`; white-on-blue contrast measured 6.39:1.
- Built-asset marker check found `Before Shavuos`, `before_shavuos`, `Chief of Staff`, `Rescanning without that recommendation`, `stop showing sleep tasks`, and `Open Chief page`.

## 2026-05-20 Relay Firestore Migration And LAN IP Auto-Discovery (b272)

- Replaced Netlify Blobs storage in `apps/web/backend/functions/phone-relay.js` with Firestore (`phone-relay/singleton` doc); removes the `external_node_modules` hack and works on any Netlify plan.
- Dropped the now-unneeded `external_node_modules` line from `apps/web/netlify.toml`.
- Added `GetLanUrl` callback to `RelayService.cs`; every state push blob now includes `lanUrl` (the PC's LAN IP from `ControlApiService.LanUrl`).
- Wired `GetLanUrl` to `_api.LanUrl` in `MainViewModel.cs`.
- Updated `NerveCenterPhoneSurface.jsx` to extract `lanUrl` from the relay state blob and surface a `Use direct` button in the relay panel — one click saves the LAN URL as the remote DeskPhone URL, dropping the relay entirely for zero-latency LAN access.
- `npm run build` passed in `apps/web`; generated `assets/index-DbCzpLMA.js`; existing large-bundle warning remains.
- DeskPhone `b272` built and deployed; running host reported `build: b272`.
- `git diff --check` passed (line-ending normalization warnings only).
- Pushed commits `428bfed` and `6a02678` to `origin/main`; production root returned HTTP 200.

## 2026-05-24 DeskPhone Native Material 3 UI Refresh

- Researched current Material 3 practice before editing: use a consistent Roboto type scale, semantic color roles, medium/regular font weights, state-layer button feedback, and Material Symbols for iconography. The local WPF theme approach aligned with that guidance, so no confirmation gate was needed.
- Bundled Roboto Regular, Medium, and Bold font files under `apps/phone-host-windows/Assets/Fonts/` and wired them as WPF resources.
- Changed the native DeskPhone app font resources to use bundled Roboto for text/display and the existing Material Symbols Rounded font for icon glyphs.
- Normalized the active WPF style dictionaries and `MainWindow.xaml` typography toward Material 3 sizing/weight rules, including label/button weights and off-scale small text.
- Left backend, Bluetooth, MAP, PBAP, relay, and ViewModel logic untouched.
- `git diff --check -- apps/phone-host-windows/DeskPhone.csproj apps/phone-host-windows/App.xaml apps/phone-host-windows/MainWindow.xaml apps/phone-host-windows/Themes/Styles.xaml apps/phone-host-windows/Themes/Skins/Material.xaml` passed; line-ending normalization warnings only.
- `dotnet build .\DeskPhone.csproj` passed in `apps/phone-host-windows`; existing warnings remain for `InTheHand.Net.Bluetooth` approximate package resolution and pre-existing nullable/async warnings in Bluetooth/MAP/control services.
- Pushed source commit `96c1cc1` to `origin/main`.
- Added detailed `b274` changelog entry, ran `dotnet build .\DeskPhone.csproj -c Release`, and the release pipeline archived `apps/phone-host-windows/deployed-builds/b274`, built the UI auditor and stable launcher, advanced `build.num` to `275`, and created release commit `c182e42`.
- Release deploy detected an existing DeskPhone process and did not auto-launch `b274`; the new build is available through the refreshed Desktop latest shortcut and `deployed-builds/b274/DeskPhone.exe`.

## 2026-05-25 iPad Cloud Relay Fix

- Root cause: `fsGet` in `phone-relay.mjs` omitted `?key={FB_API_KEY}` from the Firestore URL when an ID token was provided. The Firebase REST API requires the API key for project routing even on authenticated calls; without it Firestore returned 401/403, which the web app collapsed into the generic "Cloud relay unreachable" message.
- Fixed `fsGet` to always include `?key=${FB_API_KEY}`; ID token still included in `Authorization: Bearer` header for Firestore security rule evaluation (`request.auth != null`).
- Added distinct 401 (`auth:token_invalid`) and 403 (`auth:firestore_denied`) error codes from `fsGet` so the state handler returns properly typed HTTP responses instead of a generic 500.
- Fixed `NerveCenterPhoneSurface.jsx` relay error mapping to distinguish `relay:denied` (Firestore rules) from `relay:no_auth` (token missing/invalid) and the generic `relay:fail` bucket — user now sees "Relay blocked by Firestore rules — set allow read, write: if true for phone-relay collection." instead of "Cloud relay unreachable."
- `npm run build` passed in `apps/web`; generated `assets/index-BvT-S33N.js`; existing large-bundle warning remains.
- Built asset marker check confirmed `relay:denied` and `Firestore rules` present in bundle.
- Pushed commit `58a0ed5` to `origin/main`; production deploy `6a1468a3f6c2480c19680d96` live at `https://onetaskfocuser.netlify.app`.
- Firestore security rules required for relay: `match /phone-relay/{doc} { allow read: if request.auth != null; allow write: if true; }` — commands doc also needs `allow read: if true` for DeskPhone drain.

## 2026-05-25 React Hooks-Order White Screen Fix

- Root cause: the Google Health OAuth callback `React.useEffect` was placed after the `if (!AS) return` guard at line 2391 of `apps/web/src/08-app-split/App.jsx`. React's rules of hooks require every hook to run unconditionally on every render; a hook after an early return produces a different hook count on the first render (before Firebase data loads) vs. subsequent renders, triggering the white screen / "hooks changed order" crash.
- Fix: moved the Health OAuth `useEffect` to immediately above the `!AS` guard (after the DeskPhone poll effect). Removed the now-duplicate copy from below the guard. Added an inline comment explaining the constraint to prevent regression.
- `npm run build` passed in `apps/web`; generated `assets/index-CK2_Vva9.js`; existing large-bundle warning remains.
- Pushed commit `d8cbbb1` to `origin/main`; Netlify Git-triggered production served `assets/index-CK2_Vva9.js` (HTTP 200) — hash matches local build exactly.


## 2026-06-08 NerveCenter AI Summaries And Dense Type

- Researched dense enterprise UI typography/list icon practice before editing: use a productive type scale, tighter line-height for short operational rows, and fixed leading icon slots so icons do not drive row height. The local plan aligned.
- Restored NerveCenter AI-only SuperCrunch/category summaries across boxes, accordion, and full-panel layouts; waiting state now reads `Waiting on summary` instead of local fallback text.
- Tightened the NerveCenter summary prompt for source-only facts, urgency/consequence ordering, and terse item-name output.
- Standardized NerveCenter type tokens around 14px body, 12px metadata, and 1.28 row line height.
- Tightened NerveCenter task/Shailos/phone rows and made phone call/text direction icons use fixed 20px leading slots so iconography cannot make rows taller.
- `git diff --check -- apps/web/src/08-app-split/components/NerveCenterPanel.jsx apps/web/src/08-app-split/components/NerveCenterPhoneSurface.jsx apps/web/src/08-app-split/ui-tokens.jsx apps/web/backend/functions/_ai-core.cjs` passed; line-ending normalization warnings only.
- `npm run build` passed in `apps/web` and generated `assets/index-5ougcfRK.js`; existing large-bundle warning remains.

## 2026-06-11 DeskPhone Call Audio Bridge (b297)

- Goal: stream live phone-call audio to the DeskPhone PC app (then the webapp) from a Bluetooth-connected phone, carkit-style, with no app on the phone.
- Proved the inbox path is closed: built scratch/PhoneLineProbe as a *packaged* app with package identity + the phoneLineTransportManagement restricted capability. RequestAccessAsync returned Allowed, RegisterApp returned OK, but IsRegistered() stayed False and PhoneLineTransportDevice.ConnectAsync returned False on every attempt (with the phone freshly connected and DeskPhone stopped). PhoneCallManager.RequestStoreAsync threw 0x8007139F. No phone audio endpoint was ever created. This is the documented Win 22H2+ lockout of PhoneLineTransportDevice to third parties (Phone Link only). The BthHFEnum "FIG-NEWTON Hands-Free HF" node is bound (problem code 0) but has zero children and produces no WASAPI endpoint; AirPods DO get Hands-Free endpoints, confirming the radio/SCO work and only the PC-as-HF-to-phone audio role is fenced. Raw SCO is never exposed to user mode either.
- Decision: capture call audio from a carkit-class device that lands it on a normal Windows input (USB/Bluetooth speakerphone, or a 3.5mm headset-loopback cable), and stream that input to the browser.
- Built Services/CallAudioBridgeService.cs (NAudio WasapiCapture on a selectable MMDevice -> mono -> 16kHz 16-bit LE PCM -> bounded per-subscriber Channels, auto start/stop on subscriber count, peak-level meter). ControlApiService.cs adds GET /audio-inputs, GET /call-audio.pcm?device=ID (indefinite chunked PCM), POST /call-audio/start|stop, and a self-contained GET /audio-bridge Web Audio listener page.
- `dotnet build DeskPhone.csproj -c Debug -p:Platform=ARM64` passed (pre-existing warnings only). Release build + deploy.ps1 archived deployed-builds/b297, verified the changelog entry, and created git commit 017be0e; pushed to origin/main (69d3966..017be0e).
- Verified on deployed b297 (HFP connected): /audio-inputs lists capture endpoints; /call-audio.pcm streamed 45,440 bytes in ~2s at the correct 16kHz mono 16-bit rate with real non-silent samples (range -1141..4832); /audio-bridge serves HTTP 200. Internal mic used as the stand-in input; selecting a carkit/cable input streams live call audio.
- Next: wire a player + device picker into the webapp (apps/web NerveCenterPhoneSurface), add the uplink direction (PC/web mic -> phone) once the speakerphone/cable is in hand, and auto-select+auto-start the bridge when callState goes active.

## 2026-06-11 Call Audio: Windows HFP-HF Lockout Proven, Duplex Bridge + Desk Mode Shipped (b298)

- Diagnosed why Bluetooth call audio never reaches Windows: built a packaged probe (`apps/phone-host-windows/scratch/PhoneLineProbe`) with package identity + the `phoneLineTransportManagement` restricted capability (Developer Mode loose registration). Results on Win 11 build 26200: `RequestAccessAsync=Allowed`, `RegisterApp()` returns OK but `IsRegistered()` stays False, `ConnectAsync()=False` in all conditions (DeskPhone running or stopped, ACL up via SDP wake), `PhoneCallManager.RequestStoreAsync` throws 0x8007139F. The `FIG-NEWTON Hands-Free HF` BthHFEnum node exists healthy but never spawns audio children. Conclusion: the inbox PC-as-carkit (HFP HF role) path is Phone-Link-only since Win 22H2; third-party access is fenced at RegisterApp. Matches BestOwl/MyPhone issue #26.
- Shipped DeskPhone b298: CallAudioBridgeService rebuilt as a duplex engine (downlink fan-out; uplink 16k mono PCM -> WDL-resampled WasapiOut on the carkit output; Desk Mode dual lanes carkitIn->deskOut and deskMic->carkitOut with per-lane meters/fault flags; config persisted to %APPDATA%\DeskPhone\call-audio.json). ControlApiService gains a hand-rolled RFC6455 WebSocket `/call-audio.ws` (binary downlink out / uplink in, ping/pong, clean close that stops the downlink pump before the close reply), endpoints `/audio-outputs`, `/call-audio/state`, POST `/call-audio/config`, `/desk-mode/start|stop`, `/call-audio/uplink-start|stop`, and a rebuilt `/audio-bridge` duplex console. MainViewModel feeds call-active transitions to desk-mode auto-engage off-dispatcher.
- Verified live: WS downlink delivered non-silent PCM frames; uplink 32,000/32,000 sine bytes auto-started and played on the configured output; clean close released uplink+capture+subscribers (all idle after); Desk Mode lanes ran faultless across real endpoints (Mic Array -> AirPods Pro 3, AirPods mic -> Speakers) with live levels, then released; config survived restart into the released b298 (`build: b298`, `hfp: HFP connected`).
- `dotnet build` Debug and Release ARM64 passed (0 errors, pre-existing warnings only); deploy archived `deployed-builds/b298`, advanced build.num to 299, created release commit, launched b298 via stable launcher.

## 2026-06-11 Native Shell For The Web UI (b299)

- DeskPhone now hosts the Shamash web phone surface natively: new WebShellWindow embeds Edge WebView2 pointed at the app's own loopback-served webapp (`/?suite=deskphone`), with an explicit LOCALAPPDATA user-data folder, mic permission auto-granted for the loopback origin only (so the audio console's Talk works promptless), external links opened in the default browser, document-title sync, and a fallback panel when the WebView2 runtime is missing.
- Settings -> Audio gains "Call Audio Console" and "Open Shamash Web UI" buttons; ControlApiService gains POST `/open-web-ui` and `/open-audio-console` (same callback pattern as `/open-live-log`).
- Verified live: POST `/open-web-ui` spawned the embedded browser process set (+6 `msedgewebview2`) with the host healthy (`hfp: HFP connected`); `GET /?suite=deskphone` serves the SPA (HTTP 200, hashed bundle). Debug + Release ARM64 builds passed with 0 errors; deploy archived `deployed-builds/b299`, advanced build.num to 300, created the release commit, and launched b299.

## 2026-06-11 Seamless Phone Transport (web 4.16.44) + Signed-In Web UI Entry (b300)

- Root cause of the "dizzying connection settings": `NerveCenterPhoneSurface` picked its path by DEVICE TYPE once (mobile -> relay, desktop -> localhost forever), so a desktop browser away from the PC showed offline with no relay fallback, and connection state was scattered across indicators.
- Rebuilt as a reachability-based transport resolver: auto (default) probes DeskPhone direct (1.5 s, loopback is mixed-content-exempt) and falls back to the cloud relay; an established direct link is trusted until a fetch fails, then fails over to the relay within the same poll cycle; on relay it re-probes every 25 s and on tab focus/visibility, so returning to the PC flips back to direct with zero clicks. One transport pill (control bar) shows Direct-this-PC / Live-cloud / staleness and opens the only control: Auto / This PC only / Cloud relay only (persisted in `nc_phone_transport`). Relay liveness banner + staleness logic now apply to any relay browser, not just phones. `post()` resets the resolved transport on direct failure.
- Verified in Vite dev against live host b299/b300: auto resolved DIRECT and rendered real conversations (Tehilla SB, Lerman Rivky, missed-call rows); pinning Cloud-relay-only honored the pin and surfaced "Cloud relay unreachable" (no Netlify function in dev) without crashing; resetting to Auto recovered direct data. No console errors from the surface (pre-existing `[Health] loadHealth` error in App.jsx is unrelated working-tree code). `npm run build` passed (`assets/index-asS7A0vs.js`); version bumped 4.15.44 -> 4.16.44 (feat). Pushed `0e92f71`.
- Host b300: `Open Shamash Web UI` button and POST `/open-web-ui` now open the production app (`https://onetaskfocuser.netlify.app/?suite=phone`) in the DEFAULT BROWSER — the user's signed-in session lives there, fixing the logged-out embedded copy from b299. The WebView2 shell remains only for the Call Audio Console (loopback, no auth). Release ARM64 build passed; deploy archived `deployed-builds/b300`, launched it (`build: b300`, `hfp: HFP connected`); release commit `98880e8` pushed.

## 2026-06-11 One Phone Screen Everywhere (web 4.17.46 + host b301)

- Goal (owner-stated): the webapp Phone screen IS the DeskPhone when on the PC, and the native DeskPhone app shows the same clean web interface, indistinguishable when switching.
- Web (`f3add21`, 4.17.46): `main.jsx` gains a standalone entry — `/?standalone=deskphone` renders `DeskPhoneWebPanel` full-window with no AuthGate and no Shamash shell. All data comes from the loopback host API, so no sign-in wall by design. Verified in Vite dev: title `DeskPhone`, no auth UI, live conversations rendered from the running host.
- Host b301: `OpenModernUiOnLaunch` setting (default true) auto-opens `WebShellWindow` maximized at `http://127.0.0.1:8765/?standalone=deskphone` 1.5 s after the control API starts; `WebShellWindow` retries its first navigation (12x / 900 ms) to cover the listener-startup race and no longer doubles "DeskPhone" in the title. New `OpenModernUiCommand` + "Open Modern Phone UI" button (audio card); "Open Shamash Web UI" renamed "Shamash in Browser" (still default-browser, signed-in). 
- Verified live: debug AND released b301 auto-opened the modern window (+6 `msedgewebview2` processes), host served the standalone SPA with the new bundle (`index-DTngauvZ.js`), `hfp: HFP connected` throughout; release pipeline archived `deployed-builds/b301`, advanced build.num to 302, pushed `f68a676`.

## 2026-06-11 Half-Dead Engine Regression Fixed (b302)

- Symptom (owner-reported): webapp stuck on "waiting for your PC", DeskPhone buttons unresponsive, while DeskPhone appeared to be running.
- Live diagnosis: DeskPhone PID alive (started 17:19) but NOTHING listening on 127.0.0.1:8765 — netstat showed only SYN_SENT clients; every /status attempt refused. Webapp transport resolver therefore correctly fell back to the relay, whose state was stale → "Waiting for your PC".
- Root cause: `MainWindow.OnClosed` → `vm.Shutdown()` → `_api.Stop()` kills the control listener. Pre-b301 the process then exited (WPF default ShutdownMode=OnLastWindowClose; MainWindow was the only window). b301's auto-opened `WebShellWindow` kept the process alive past Shutdown — closing the classic window now produced a zombie: engine dead, windows open.
- Fix (b302): `App.xaml` `ShutdownMode="OnMainWindowClose"` — closing the classic main window exits the whole app (shell windows included), restoring pre-b301 semantics; closing only the modern window touches nothing.
- Immediate remediation during the incident: restarted DeskPhone (b301) — listener and webapp recovered within one poll cycle. Then released b302; verified `build: b302`, `hfp: HFP connected`, port 8765 LISTENING, modern UI auto-open intact. Release commit pushed (`3c0faef`).
- Also captured in the zombie's log: `[RELAY MEDIA] HTTP 401` hot retry loop (~5.5 s) for three media ids — pre-existing relay-media auth bug, flagged as a separate task.
