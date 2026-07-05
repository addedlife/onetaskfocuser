# Shamash Phone Host — Android

The Android twin of `apps/phone-host-windows`: a native app that pairs this
Android device (tablet) with the locked Android source phone over **Bluetooth
Classic** and serves the same Shamash local host API on port **8765** — so the
web surfaces work against it unchanged and no cloud relay is involved.

```
source phone ──BT classic──▶ this tablet ──HTTP :8765──▶ web app (this tablet)
   (locked)    HFP/MAP/PBAP        │
                                   └──HTTP :8765 over LAN──▶ iPad bridge app / other devices
```

## What it implements

| Lane | Profile | Port of |
|---|---|---|
| Calls (state, answer, hang up, dial) | HFP 0x111F (AT commands over RFCOMM) | `HfpService.cs` |
| Messages (sync, send, read/delete pushback) | MAP MAS 0x1132 (OBEX over RFCOMM) | `MapService.cs` + `ObexClient.cs` |
| Live message push | MAP MNS 0x1133 (we run the RFCOMM server) | `MapNotificationService.cs` |
| Call history + contacts | PBAP PSE 0x112F (`ich/och/mch/pb.vcf`) | `PbapService.cs` (+ pb.vcf contacts, new) |
| Host control API | raw-socket HTTP on 0.0.0.0:8765 | `ControlApiService.cs` (core contract) |
| LAN discovery | mDNS `_shamash-phonehost._tcp` | (new — feeds the iPad bridge lane) |

The delta-sync strategy, OBEX quirk handling (OBEX 1.0 CONNECT, Fig 52 /
MediaTek header offsets, no-empty-EndBody PUTs, bMessage VCARD-inside-BENV),
and the JSON payload shapes are direct ports of the Windows implementation —
the phone cannot tell the difference between hosts.

## Known limitation — call audio

Same architectural line the Windows host draws, but harder on Android: we
advertise `BRSF=4` (no codec negotiation) so the phone never routes SCO audio
to this app — Android exposes no app-level API to accept an HFP SCO stream
(Windows has the BthHFEnum kernel driver; Android has nothing equivalent for
apps). v1 gives full call **control** and live call **state** on every
surface; the voice path stays on the phone's own mic/speaker (or a headset
paired to the phone).

## Seamless switching between hosts

The phone accepts one MAP/HFP client at a time, so hosts pass the link:

1. `POST /handoff-release` on the current host → it drops HFP + MAP + MNS
   cleanly and parks (no auto-reconnect).
2. `POST /connect` on the new host → it takes the link, seeds MAP delta-sync
   from its local store, and its mDNS advert marks it the live host.
3. Every host keeps its message/call/contact stores, so switching back is
   instant — delta sync only fetches what arrived in between.

## Build

```
cd apps/phone-host-android
# local.properties must point at an Android SDK (compileSdk 34)
gradle :app:assembleDebug     # → app/build/outputs/apk/debug/app-debug.apk
```

No external dependencies — Kotlin + framework APIs only (AGP 8.7.3,
Kotlin 2.0.21, minSdk 26).

## Install / run

1. Install the APK, open it once, grant Bluetooth + notification permission.
2. Pair the tablet with the source phone in Android Bluetooth settings
   (standard pairing; the phone treats the tablet like a car kit).
3. In the app, tap the phone in the paired list — it becomes the default and
   the host connects. The foreground service reconnects automatically
   (30 s watchdog) and restarts on boot.
4. Web app on this tablet talks to `http://127.0.0.1:8765` — same as the PC.

## Verification status

- `gradle :app:assembleDebug` compiles clean in CI-like conditions
  (2026-07-05, source-only environment).
- NOT yet runtime-verified against the real phone — the protocol logic is a
  faithful port of the field-proven Windows implementation, but first
  on-device smoke (pair, connect, sync, send, call state) is still owed.
