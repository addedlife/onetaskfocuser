# Context Index

Goal: minimize cached and uncached tokens while preserving accuracy. Start from `BRIEF.txt`, then read only the row that matches the requested change. If the row is stale or insufficient, use `rg` to expand from the listed files.

## Read Protocol

1. Read `BRIEF.txt`.
2. Read the matching section below.
3. Read the newest relevant entry in `docs/ops/VERIFICATION_LOG.md`.
4. Read only the listed source files and nearby imports/callees found by `rg`.
5. Verify with the listed gate.

## Change Targets

### NerveCenter / Tasks Dashboard

- Primary files: `apps/web/src/08-app-split/App.jsx`, `apps/web/src/08-app-split/components/NerveCenterPanel.jsx`
- Related files: `apps/web/src/08-app-split/components/NerveCenterPhoneSurface.jsx`
- Search terms: `NerveCenterPanel`, `addMrsWTask`, `priority`, `showAllTasks`, `gridTemplateColumns`
- Gate: `npm run build` in `apps/web`; visual smoke at `/?suite=nervecenter`

### WebPhone In NerveCenter

- Primary file: `apps/web/src/08-app-split/components/NerveCenterPhoneSurface.jsx`
- Related file: `apps/web/src/08-app-split/App.jsx`
- Host endpoints: `/status`, `/contacts`, `/messages`, `/calls`
- Search terms: `phoneKeys`, `contactNameByNumber`, `messagePeerNumber`, `recentCalls`, `callHistory`
- Gate: `npm run build` in `apps/web`; `http://127.0.0.1:8765/status`

### DeskPhone Web Message / Call UI

- Primary file: `apps/web/src/10-deskphone-web.jsx`
- Search terms: `ConversationCallHistory`, `MessageBubble`, `openCallActionKey`, `dp-thread-call`
- Gate: `npm run build` in `apps/web`; browser smoke the DeskPhone surface

### Gmail / Calendar Refresh

- Primary file: `apps/web/src/08-app-split/App.jsx`
- Related files: `apps/web/src/08-app-split/components/NerveCenterPanel.jsx`, `apps/web/backend/functions/google-workspace.js`, `apps/web/backend/functions/_ai-core.cjs`
- Search terms: `refreshGoogleData`, `visibilitychange`, `focus`, `onRefreshCalendar`, `onConnectGoogle`, `googleServerAuthAvailable`, `serverOnlyGoogleWorkspaceTokens`
- Gate: `npm run build` in `apps/web`

### Shailos

- Primary folder: `apps/shailos`
- Related web copy step: `apps/web/scripts/copy-shailos-to-dist.cjs`
- Gate: `npm run build` in `apps/shailos`; if shipped through web, also build `apps/web`

### Netlify / Functions

- Primary files: `apps/web/netlify.toml`, `apps/web/backend/functions/*`
- Related files: `apps/web/package.json`, `apps/web/scripts/*`
- Gate: `npm run build` in `apps/web`; release by pushing `origin/main` and verifying Netlify's Git-triggered deploy unless the current thread says otherwise

### Native DeskPhone Host

- Primary folder: `apps/phone-host-windows`
- Search terms: `/status`, `/messages`, `/calls`, `/contacts`, `build.num`, `deployed-builds`
- Gate: `dotnet build` in `apps/phone-host-windows`; check `http://127.0.0.1:8765/status`

### Android Phone Host (local BT host on tablet)

- Primary folder: `apps/phone-host-android`
- Search terms: `MapClient`, `HfpClient`, `PbapClient`, `MnsServer`, `HostService`, `handoff-release`, `_shamash-phonehost._tcp`
- Contract: same `/status /messages /calls /contacts` shapes as the Windows host (port of `MainViewModel` JSON builders)
- Gate: `gradle :app:assembleDebug` in `apps/phone-host-android` (needs Android SDK 34 in `local.properties`)

### Phone Host Dongle (universal hardware host — spec stage)

- Primary file: `docs/ops/PHONEHOST_DONGLE_SPEC.md`
- v2 (current): dongle is BT-Classic-to-phone + local `:8765` HTTP only — same contract as `apps/phone-host-android`/`apps/phone-host-windows`, discoverable by `apps/ipad-phone-bridge`'s `LanHostClient` via mDNS. Zero Firebase code/credentials on the dongle; whatever device talks to Firebase (PC's `RelayService.cs`, cloud relay reads) keeps doing so completely unchanged. Storage is RAM-only working set, nothing durable, nothing in flash beyond Wi-Fi/BT pairing.
- v1 (superseded): dongle pushed straight to Firestore — rejected for putting a relay secret on losable $8 hardware and requiring embedded TLS/Firestore, the riskiest unproven part of that design.
- Key facts: original ESP32 only (S3/C3/C6 are BLE-only — no BT Classic); prototype lane is Pi Zero 2 W + BlueZ obexd; BT protocol reference to port is `apps/phone-host-android` `bt/*.kt`
- Gate: bench validation 1 (ESP32 OBEX CONNECT accepted by the source phone) before further investment; open question flagged in the spec — RAM-only cache vs. truly zero caching (affects `/messages` responsiveness)

### iPad Phone Bridge (LAN host proxy + BT probe gate)

- Primary folder: `apps/ipad-phone-bridge`
- Search terms: `LanHostClient`, `lan-host`, `BluetoothProbeService`, `localOnlyPrefixes`
- Verdict: direct BT host on iPadOS is blocked by public API (Classic RFCOMM profiles ≠ GATT); live lane is the Bonjour LAN proxy of the active host
- Gate: build in Xcode on a Mac; smoke `http://127.0.0.1:8765/status` on the iPad (check the `lanHost` block)

### Git / Release Docs

- Primary files: `BRIEF.txt`, `AGENTS.md`, `README.md`, `docs/ops/VERIFICATION_LOG.md`, `docs/ops/MIGRATION_MANIFEST.md`, `docs/ops/ROLLBACK_AND_DEPRECATION.md`
- Gate: `git diff --check`
- Push rule: normal push target is `origin/main`; old main is archived at `archive/pre-pro4-main-20260511-011424`
