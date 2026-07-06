# Shamash Phone Host Dongle — spec (v2, 2026-07-05)

**v2 correction (this revision, supersedes v1):** the dongle has **zero
Firebase involvement** — no Firestore writes, no Firebase credentials, no
awareness that a cloud project exists. v1 (dongle pushes straight to
`phone-relay/state`) is rejected: it put a Firebase relay secret on an $8
piece of hardware that's easy to lose, and required doing TLS + Firestore's
HTTPS protocol on a memory-starved microcontroller — the riskiest, least
proven part of that design. Removing it is a genuine simplification, not a
step backward.

```
phone ──BT Classic──▶ DONGLE ──Wi-Fi, local :8765──▶ device (PC / tablet / iPad bridge / browser)
 (locked)  HFP/MAP/PBAP                                        │
                                                                └── device talks to Firebase
                                                                    exactly as it does today —
                                                                    RelayService.cs / phone-relay.mjs
                                                                    UNCHANGED, untouched
```

## What the dongle is

Exactly two jobs, nothing else:
1. Bluetooth Classic client to the phone (HFP call state/control, MAP
   messages, PBAP contacts/call history) — same profiles, same protocol
   quirks already solved in `apps/phone-host-android` / `apps/phone-host-windows`.
2. Serve that data over local Wi-Fi on the same `:8765` HTTP contract those
   hosts already serve (`/status /messages /calls /contacts /send /dial
   /answer /hangup …`).

That's the whole device. No Firestore, no Firebase Auth, no relay secret, no
cloud SDK, no TLS client. It is a peer host on the local network, exactly
like the Android tablet host — `apps/ipad-phone-bridge`'s existing
`LanHostClient` (Bonjour-discovers `_shamash-phonehost._tcp`, proxies the
contract) already knows how to find and use it with zero changes.

## What does NOT change anywhere else

- The PC (`RelayService.cs`) keeps pushing to `phone-relay/state` in
  Firestore and streaming `phone-relay/commands` from RTDB exactly as it
  does today, whenever the PC is the device holding the Bluetooth link and
  wants cloud reachability from anywhere.
- Any device reading the cloud relay (`phone-relay.mjs`) for "away from any
  local host" access keeps working exactly as today.
- None of that code is touched by this spec. The dongle is invisible to it —
  it either exists on the local network as another `:8765` host, or it
  doesn't; Firebase-side behavior is identical either way.

## Storage — owner-confirmed rule (2026-07-05)

The one hard constraint is: **the dongle never communicates with Firebase.**
No Firestore writes, no Firebase credentials, no cloud SDK — whichever
device consumes the dongle keeps talking to Firebase exactly as it does
today, and the dongle stays ignorant of it.

Basic **connection data may persist across power loss** (owner-approved):
- Wi-Fi credentials (station mode) + SoftAP fallback for provisioning
- The Bluetooth pairing/bond with the phone
- The local API access token
- Delta-sync bookkeeping (which message handles were already seen) — so a
  power cycle resumes with a quick delta instead of a full re-walk

Message bodies, call history, and contacts stay a **RAM-only working set**:
cached while powered so `/messages` and `/calls` answer instantly, gone on
power loss, rebuilt from the phone in seconds on reconnect. The phone
remains the source of truth for its own history; losing the dongle never
loses data.

## Hardware (unchanged)

**CRITICAL CHIP TRAP:** MAP/PBAP/HFP require Bluetooth *Classic* (BR/EDR).
ESP32-S3 / C3 / C6 / H2 are BLE-only — unusable. Only the **original ESP32**
(Xtensa dual-core, e.g. ESP32-PICO-D4) has BR/EDR.

| Option | Role | Notes |
|---|---|---|
| **M5Stack Atom Lite** (ESP32-PICO, ~$8, 24×24 mm, USB-C, cased) | production target | no content cache to size flash for; stock 4 MB module is plenty |
| **Raspberry Pi Zero 2 W** (~$18) | prototype | Linux + BlueZ `obexd` (MAP/PBAP) + oFono/bluez-alsa (HFP); fastest path to end-to-end proof |

Plan: **prototype on Pi Zero 2 W (days), productize on ESP32.**

Power reality unchanged: BT+Wi-Fi active ≈ 80–150 mA → effectively
USB-powered (car port, desk, power bank), not battery-freestanding for days.

## Firmware architecture (ESP32 / ESP-IDF)

| Layer | Source | Status |
|---|---|---|
| HFP client (call state, answer/hangup/dial, +CLIP) | `esp_hf_client` component | ships in ESP-IDF |
| RFCOMM streams | `esp_spp` + `esp_sdp` (UUID → SCN lookup) | ships in ESP-IDF |
| OBEX + MAP + PBAP client | port of `apps/phone-host-android` `ObexClient.kt` / `MapClient.kt` / `PbapClient.kt` → C++ | mechanical port; handset quirks already encoded (OBEX 1.0 CONNECT, Fig-52/MediaTek offsets, no-empty-EndBody, VCARD-inside-BENV, 0xC6 type ladder) |
| MNS server (live push) | `esp_spp_start_srv` + custom SDP record for 0x1133 | **bench-validate**; fallback = 15–30 s delta poll |
| Local HTTP API :8765 | `esp_http_server` + cJSON, same routes/JSON shapes as `ControlApiService.cs`/`HostService.kt` | direct port — plain HTTP, no TLS needed for the local contract |
| RAM working set | in-memory recent messages/calls + seen-handle set for delta sync | volatile only; no flash writes for content, ever |
| mDNS | `mdns` component, advertise `_shamash-phonehost._tcp` | ships in ESP-IDF — this is how `LanHostClient` finds it |
| Wi-Fi | station mode on known SSIDs; SoftAP fallback ("Shamash-Host-Setup") for provisioning | LAN-only requirement now — no internet dependency, unlike v1 |
| BT pairing with phone | SSP; pairing mode via the device button, confirmed on the SoftAP setup page | one-time, standard pairing — phone sees a car kit |

No Firebase SDK, no Firestore REST client, no RTDB stream client, no TLS
stack for cloud calls anywhere in this list.

## Security

- Local network only, same trust model as the existing tablet/PC hosts —
  same CORS + Private Network Access headers already used by `ControlApiService.cs`.
- A lightweight local pairing token (shown on the SoftAP setup page at
  provisioning) is still worth keeping for the `:8765` API, same reasoning
  as v0/v1 — the API is reachable to anything on the Wi-Fi network, not just
  loopback. This token has nothing to do with Firebase; it only gates the
  dongle's own local HTTP API.
- SoftAP provisioning mode is WPA2-protected and only active during setup.

## Bench validations before committing (order matters)

1. ESP32 pairs with the source phone; SDP query resolves MAS 0x1132 → SCN;
   RFCOMM connects; **OBEX CONNECT accepted**. (Single riskiest step — the
   Windows/Android lanes prove the phone side, not the ESP32 stack.)
2. MNS SDP record advertisable from ESP32 and the phone connects back to it.
   If not → poll-only sync (acceptable; the delta probe is 2 tiny OBEX GETs).
3. `esp_hf_client` SLC with this specific phone (BRSF quirks) — call state
   events + ATA/CHUP/ATD verified.
4. Wi-Fi/BT coexistence throughput acceptable while MAP transfers run
   (shared radio on ESP32; texts are small, MMS images the stress case).
5. `LanHostClient` on the iPad discovers and proxies the dongle exactly as
   it does the Android tablet host — no code changes expected, but worth
   confirming against real hardware.

(No Firestore/TLS bench validation needed — removed with the Firebase path.)

## Build plan

1. **Week-1 proof (Pi Zero 2 W):** BlueZ `obexd` MAP+PBAP client + a small
   service serving the `:8765` contract + mDNS. Validates the whole product
   with the real phone before any embedded work.
2. ESP-IDF skeleton: pairing, SDP, SPP, OBEX CONNECT (validation 1).
3. Port MAP/PBAP from the Kotlin reference; RAM-only delta sync + recent
   listing cache (no flash content writes).
4. `esp_hf_client` wiring (validation 3) + HTTP API + mDNS + local token.
5. Wi-Fi provisioning/SoftAP, `/handoff-release` parity so it hands the
   phone link to/from the PC & tablet hosts cleanly.
6. Enclosure: Atom Lite as-is (already a cased keychain-able cube).

## Relationship to existing lanes

- The dongle is a peer host, exactly like the Android tablet host and the
  Windows PC host: whichever one holds the Bluetooth link is "the" local
  host at that moment; `/handoff-release` + mDNS presence let them hand off.
- Any device's relationship to Firebase is completely orthogonal to which
  local host is active. The PC's `RelayService.cs` cloud push, when it
  applies, works identically whether the PC is on the Bluetooth link itself
  or reading it locally from the dongle over `:8765` — this spec does not
  touch that code path at all.
- The Android tablet host and Windows host keep their own local-store,
  local-API design (they're also, themselves, a destination surface running
  the web app). The dongle is purpose-built to be the opposite: minimal,
  no durable storage, a pure radio-to-network bridge.
