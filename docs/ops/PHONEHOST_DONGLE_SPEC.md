# Shamash Phone Host Dongle — spec (v1, 2026-07-05)

**v1 pivot (this revision):** the dongle carries **no onboard content
storage**. It is a pure Bluetooth-to-Firebase bridge — it never runs its own
local `/messages /calls /contacts` API and never caches message bodies, call
history, or contacts in flash. Storage is Firestore, exactly as it already
is for the Windows host's cloud relay path. This replaces the v0 design
(LittleFS store + local `:8765` HTTP API + mDNS discovery), which is kept
below only as a rejected alternative for context.

```
source phone ──BT classic──▶ DONGLE ──HTTPS──▶ Firestore (phone-relay/state, phone-media/*)
   (locked)    HFP/MAP/PBAP                            │
                                                        └──▶ any device (PC, iPad, tablet, browser)
                                                             reads the SAME doc they already read
                                                             today when using the cloud relay
```

## Why this is simpler, not a compromise

Your Windows host already runs exactly this pattern today —
`Services/RelayService.cs`. It does not wait to be asked: it pushes a JSON
blob straight into the Firestore document `phone-relay/state` on a 5-minute
backup heartbeat plus immediately on any change (new text, call state
change), and every consuming device (browser, iPad, tablet) reads that same
document back. Picture attachments go to a separate `phone-media/{id}`
collection so the main doc stays under Firestore's 1 MiB cap. Commands
(answer/hangup/dial/send) already flow the other way over a live Firebase
Realtime Database stream (`phone-relay/commands`, see `RelayService.cs`
`StreamRtdbCommandsAsync`).

The dongle's job is to be a second implementation of `RelayService.cs` —
same Firestore documents, same field shapes, same command channel — running
on an $8 chip instead of a full PC. **No new client-side work is needed on
any consuming device**: they already know how to read `phone-relay/state`
because that's how "away from the PC" mode has worked all along. The
iPad's Bonjour/LAN-proxy lane (`apps/ipad-phone-bridge` `LanHostClient`)
becomes optional rather than required — a LAN-first optimization, not the
only path — since every device already has a cloud-read fallback.

## What moved off the dongle

| v0 (rejected) | v1 (this spec) |
|---|---|
| LittleFS store: ~500 cached messages + contacts + call log | none — no message/call/contact content stored on-device, ever |
| Local `esp_http_server` serving `/messages /calls /contacts` | none — the dongle does not serve phone data locally at all |
| mDNS `_shamash-phonehost._tcp` advertising, consumer discovery required | not required (still fine as an optional LAN fast-path later) |
| Per-device pairing token for the local API | not needed — auth is the existing Firebase Firestore rules + relay secret model already governing `phone-relay.mjs` |

## What still lives in on-device flash (bookkeeping, not content)

This is the distinction worth being precise about: **operational state**
stays local; **your data** does not.

- Wi-Fi credentials (station mode) + a SoftAP fallback for provisioning
- The Bluetooth pairing/bond with the phone (so replugging doesn't require
  re-pairing)
- A relay auth secret, provisioned once, equivalent to `PHONE_RELAY_SECRET`
  used by `RelayService.cs`/`phone-relay.mjs` today
- A small "already-forwarded" handle-tracking set for MAP delta sync (the
  same bookkeeping `MapClient`/`MapService` already do), so a reboot doesn't
  force a full re-download from the phone. This is disposable housekeeping —
  losing it just costs one resync, never data loss, since the phone remains
  the source of truth for its own message/call/contact history.

## Hardware (unchanged from v0)

**CRITICAL CHIP TRAP:** MAP/PBAP/HFP require Bluetooth *Classic* (BR/EDR).
ESP32-S3 / C3 / C6 / H2 are BLE-only — unusable. Only the **original ESP32**
(Xtensa dual-core, e.g. ESP32-PICO-D4) has BR/EDR.

| Option | Role | Notes |
|---|---|---|
| **M5Stack Atom Lite** (ESP32-PICO, ~$8, 24×24 mm, USB-C, cased) | production target | v1 needs far less flash now (no content cache), so the stock 4 MB module is plenty |
| **Raspberry Pi Zero 2 W** (~$18) | prototype | Linux + BlueZ `obexd` (MAP/PBAP) + oFono/bluez-alsa (HFP); fastest path to end-to-end proof |

Plan: **prototype on Pi Zero 2 W (days), productize on ESP32.**

Power reality unchanged: BT+Wi-Fi active ≈ 80–150 mA → effectively
USB-powered (car port, desk, power bank), not battery-freestanding for days.

## Firmware architecture (ESP32 / ESP-IDF)

| Layer | Source | Status |
|---|---|---|
| HFP client (call state, answer/hangup/dial, +CLIP) | `esp_hf_client` component | ships in ESP-IDF; AT machine handled by the stack |
| RFCOMM streams | `esp_spp` + `esp_sdp` (UUID → SCN lookup) | ships in ESP-IDF |
| OBEX + MAP + PBAP client | port of `apps/phone-host-android` `ObexClient.kt` / `MapClient.kt` / `PbapClient.kt` → C++ | mechanical port; handset quirks already encoded (OBEX 1.0 CONNECT, Fig-52/MediaTek offsets, no-empty-EndBody, VCARD-inside-BENV, 0xC6 type ladder) |
| MNS server (live push) | `esp_spp_start_srv` + custom SDP record for 0x1133 | **bench-validate**; fallback = 15–30 s delta poll |
| **Firestore push** | HTTPS REST PATCH to `phone-relay/state`, matching `RelayService.PushStateAsync()` exactly: `{status, messages, calls, contacts, commandResults, lanUrl, pushedAt, relayReceivedAt}` | direct C++ port of the existing, already-proven Windows logic — same doc, same shape, same 150-message cap |
| **Media upload** | HTTPS PATCH to `phone-media/{id}` for MMS picture previews | mirrors `UploadPendingMediaAsync` / `fsSetMedia`; see image caveat below |
| **Command intake** | RTDB SSE stream on `phone-relay/commands`, same as `StreamRtdbCommandsAsync`; poll fallback if the stream drops | direct port — this channel is already push-based and known cheap in production |
| Wi-Fi | station mode on known SSIDs; SoftAP fallback ("Shamash-Host-Setup") for provisioning when no known network is in range | needed for internet reachability, not just LAN — Firestore/RTDB require actual internet |
| BT pairing with phone | SSP; pairing mode via the device button, confirmed on the SoftAP setup page | one-time, standard pairing — phone sees a car kit |

Local `:8765` HTTP is now optional/minimal — at most a tiny setup/diagnostic
page during provisioning, not a phone-data API.

## Known hard constraint: MMS image size on-device

Your PC resizes MMS photos before uploading (Firestore's 1 MiB doc cap
forces this). An ESP32 has very little working RAM, so on-device JPEG
decode/resize is nontrivial. v1 options, in order of preference:
1. Forward the image largely as-is but cap it to a size ceiling — reject or
   skip attachment upload above that ceiling, deliver the text body only.
2. If the phone/MMS gateway already serves a lower-resolution preview
   variant, prefer that over the full asset.
3. True on-device resize (real image codec on ESP32) is a stretch goal, not
   a v1 requirement.
Text messages are unaffected — they forward fully and immediately regardless.

## Security model

Reuses the existing relay security posture rather than inventing a new one:
- Firestore writes: Firestore rules already require the writer to present
  the same relay secret pattern `RelayService.cs`/`phone-relay.mjs` use
  today (dongle provisioned with its own secret at setup, analogous to
  `PHONE_RELAY_SECRET`).
- No new local network attack surface is introduced, because the dongle
  does not serve phone data locally at all in v1.
- SoftAP provisioning mode is WPA2-protected and only active during setup.

## Bench validations before committing (order matters)

1. ESP32 pairs with the source phone; SDP query resolves MAS 0x1132 → SCN;
   RFCOMM connects; **OBEX CONNECT accepted**. (Single riskiest step — the
   Windows/Android lanes prove the phone side, not the ESP32 stack.)
2. MNS SDP record advertisable from ESP32 and the phone connects back to it.
   If not → poll-only sync (acceptable; the delta probe is 2 tiny OBEX GETs).
3. `esp_hf_client` SLC with this specific phone (BRSF quirks) — call state
   events + ATA/CHUP/ATD verified.
4. **Firestore PATCH from the ESP32 HTTPS stack succeeds reliably** — TLS on
   a microcontroller has its own footguns (cert store size, handshake RAM);
   this needs its own bench check independent of the Bluetooth validations.
5. Wi-Fi/BT coexistence throughput acceptable while MAP transfers run
   (shared radio on ESP32; texts are small, MMS images the stress case
   given the image-size constraint above).

## Build plan

1. **Week-1 proof (Pi Zero 2 W):** BlueZ `obexd` MAP+PBAP client + a small
   service that pushes the same `phone-relay/state` shape to Firestore.
   Validates the whole product with the real phone before any embedded work,
   and proves the "no local storage, cloud-only" model end-to-end.
2. ESP-IDF skeleton: pairing, SDP, SPP, OBEX CONNECT (validation 1), HTTPS
   Firestore PATCH (validation 4).
3. Port MAP/PBAP from the Kotlin reference; delta sync bookkeeping only
   (no content cache) → feeds the Firestore push.
4. `esp_hf_client` wiring (validation 3) + RTDB command stream intake.
5. Wi-Fi provisioning/SoftAP, relay secret provisioning, `/handoff-release`
   equivalent (dongle can also drop off the link so the PC/tablet can take
   over, same as those hosts do for each other).
6. Enclosure: Atom Lite as-is (already a cased keychain-able cube).

## Relationship to existing lanes

- The dongle is a peer implementation of `RelayService.cs`'s protocol, not a
  new protocol. Any device that already works in "away from the PC" relay
  mode works with the dongle with zero changes.
- PC host, Android tablet host, and dongle can all pair with the phone; only
  one holds the Bluetooth link at a time. Whichever one is connected is the
  one pushing to `phone-relay/state` — consuming devices don't need to know
  or care which.
- The Android tablet host (`apps/phone-host-android`) and Windows host keep
  their local-store, local-API design — that's still the right call for
  devices with real storage and power that are also, themselves, a
  destination surface (they run the web app locally too). The dongle is
  purpose-built to be the opposite: minimal, storage-free, cloud-fed.
