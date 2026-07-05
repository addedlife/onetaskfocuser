# Shamash Phone Host Dongle — spec (v0, 2026-07-05)

A keychain-sized hardware host that replaces every per-platform host app.
It speaks Bluetooth Classic car-kit profiles to the locked source phone
(nothing installed on the phone, same as today) and serves the standard
Shamash host API over Wi-Fi, so every consumer device — iPad, Android
tablet, PC, anything with a browser — reads the phone through it.

```
source phone ──BT classic──▶ DONGLE ──Wi-Fi HTTP :8765──▶ iPad bridge / tablets / browsers
   (locked)    HFP/MAP/PBAP     │
                                └── mDNS _shamash-phonehost._tcp  (+ SoftAP fallback away from home)
```

## Why this is the universal host

- The host job is only two things: (a) BT Classic MAP/PBAP/HFP client to the
  phone, (b) the `:8765` HTTP contract. Platform host apps are that same
  machine re-implemented per OS. The dongle is one implementation for all.
- **Consumers need zero new work.** `apps/ipad-phone-bridge` already
  Bonjour-discovers `_shamash-phonehost._tcp` and proxies it on the iPad's
  localhost — it cannot distinguish the dongle from the Android tablet host.
- If the dongle also serves the DeskPhone web surface (`/` static files, the
  way the Windows host serves `./web`), any browser can use
  `http://shamash.local:8765` directly — no installed software on ANY device.
  (Same-origin http, so no https mixed-content issue; no service worker, but
  the phone surface doesn't need one.)

## Hardware

**CRITICAL CHIP TRAP:** MAP/PBAP/HFP require Bluetooth *Classic* (BR/EDR).
ESP32-S3 / C3 / C6 / H2 are BLE-only — unusable. Only the **original ESP32**
(Xtensa dual-core, e.g. ESP32-PICO-D4) has BR/EDR.

| Option | Role | Notes |
|---|---|---|
| **M5Stack Atom Lite** (ESP32-PICO, ~$8, 24×24 mm, USB-C) | production target | keychain-sized; 4 MB flash (prefer an ESP32 module with 8–16 MB if bundling the web surface) |
| **Raspberry Pi Zero 2 W** (~$18) | prototype | Linux + BlueZ: `obexd` ships working MAP & PBAP clients; oFono/bluez-alsa for HFP. Fastest path to end-to-end proof |

Plan: **prototype on Pi Zero 2 W (days), productize on ESP32.**

Power reality: BT+Wi-Fi active ≈ 80–150 mA → a 500 mAh LiPo ≈ 4 h. The
dongle is keychain-*sized* but effectively USB-powered (car port, desk,
pocket power bank). This is the main product limitation; do not oversell
battery-freestanding use.

## Firmware architecture (ESP32 / ESP-IDF)

| Layer | Source | Status |
|---|---|---|
| HFP client (call state, answer/hangup/dial, +CLIP) | `esp_hf_client` component | ships in ESP-IDF (hands-free-unit role); AT machine handled by the stack, callbacks exposed |
| RFCOMM streams | `esp_spp` (connect by SCN) + `esp_sdp` (UUID → SCN lookup) | ships in ESP-IDF |
| OBEX + MAP + PBAP client | port of `apps/phone-host-android` `ObexClient.kt` / `MapClient.kt` / `PbapClient.kt` → C++ | mechanical port; all handset quirks already encoded (OBEX 1.0 CONNECT, Fig-52/MediaTek offsets, no-empty-EndBody, VCARD-inside-BENV, 0xC6 type ladder) |
| MNS server (live push) | `esp_spp_start_srv` + custom SDP record for 0x1133 | **bench-validate**; fallback = 15–30 s delta poll (the delta probe is 2 tiny OBEX GETs — cheap) |
| HTTP API :8765 | `esp_http_server` + cJSON | same contract as `ControlApiService`/`HostService` incl. CORS/PNA headers, `/handoff-release` |
| mDNS | `mdns` component | advertise `_shamash-phonehost._tcp` |
| Store | LittleFS: last ~500 message bodies + contacts + call log; older bodies & MMS images fetched from phone on demand | flash-friendly variant of the tablet store |
| Wi-Fi | station mode on known SSIDs; **SoftAP fallback** ("Shamash-Host") when none found (car/street) | provisioning via SoftAP captive portal |
| BT pairing with phone | SSP; pairing mode button + passkey shown on the dongle's web page | one-time, standard pairing — phone sees a car kit |

## Security (new requirement vs. loopback hosts)

The API moves from loopback/LAN-of-trusted-devices to a radio anyone could
approach. v1 adds:
- Bearer pairing token (generated on first boot, shown as QR/text on the
  dongle's setup page; consumers store it; `Authorization` header or `?token=`).
- SoftAP mode always WPA2 with the same token as PSK.
- The iPad bridge gets a one-line addition to attach the token when proxying.

## Call audio — the dongle's unique upside

App hosts can never take HFP SCO audio (Android offers no API; Windows defers
to its kernel driver). The ESP32 HFP client CAN own SCO (CVSD). v1 is call
control/state only (parity with the tablet host). v2 option unavailable to
any app host: bridge SCO audio ↔ Wi-Fi (WebSocket PCM, like the Windows
`CallAudioBridgeService` shape) so the iPad can be the speakerphone.

## Bench validations before committing (order matters)

1. ESP32 pairs with the source phone; SDP query resolves MAS 0x1132 → SCN;
   RFCOMM connects; **OBEX CONNECT accepted**. (Single riskiest step; the
   Windows/Android lanes prove the phone side, not the ESP32 stack.)
2. MNS SDP record advertisable from ESP32 and the phone connects back to it.
   If not → poll-only sync (acceptable).
3. `esp_hf_client` SLC with this specific phone (BRSF quirks) — call state
   events + ATA/CHUP/ATD verified.
4. Wi-Fi/BT coexistence throughput acceptable while MAP transfers run
   (shared radio on ESP32; texts are small, MMS images the stress case).

## Build plan

1. **Week-1 proof (Pi Zero 2 W):** BlueZ `obexd` MAP+PBAP client + small
   service exposing the `:8765` contract + mDNS. Validates the whole product
   with the real phone before any embedded work.
2. ESP-IDF skeleton: pairing, SDP, SPP, OBEX CONNECT (validation 1).
3. Port MAP/PBAP from the Kotlin reference; delta sync + on-demand bodies.
4. `esp_hf_client` wiring (validation 3) + HTTP API + mDNS + token auth.
5. Store, Wi-Fi provisioning/SoftAP, static web surface, `/handoff-release`
   parity so it hands the phone link to/from the PC & tablet hosts cleanly.
6. Enclosure: Atom Lite as-is (it's already a cased keychain-able cube).

## Relationship to existing lanes

- PC host, Android tablet host, dongle are peer hosts; one holds the BT link
  at a time; `/handoff-release` + mDNS presence pick the active one.
- The dongle does not obsolete the tablet host immediately — the tablet has
  unlimited storage/power and today it's the only always-on home host.
  Long-term the dongle can replace both platform hosts.
