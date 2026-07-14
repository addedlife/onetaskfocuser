# Car-Kit Simulator — ActiveTab as the phone's car kit (calls + call audio)

Owner ask (7/13 ticket batch): *"build a car kit simulator that connects from
android active tab to phone bt even for call audio, using whatever path an
android car kit uses."*

## What an Android car kit actually uses

A head unit running Android holds the phone with the **platform HFP hands-free
client profile** — `BluetoothHeadsetClient` (BluetoothProfile id **16**) — plus
PBAP/MAP for data. Call audio is an **SCO link owned by the Bluetooth stack**:
when the stack holds HFP-HF, SCO audio flows through the device's normal audio
path (speaker + mic) with zero app code. That is the *only* path to call audio;
app-level RFCOMM (our `HfpClient`) can carry AT signaling but can never open
SCO — which is why the raw lane stays out of the audio path by design.

## What shipped

- **`bt/CarKitClient.kt`** (new): reflection-based `BluetoothHeadsetClient`
  wrapper. Probes profile availability at service start
  (`getProfileProxy(…, 16)`), engages/disengages the profile, routes call audio
  (`connectAudio`/`disconnectAudio` — the "audio to car" button), answers /
  hangs up / dials through the stack, and maps `AG_CALL_CHANGED` parcelables
  onto the shared `CallInfo` model. On this lane an answered call can never be
  misfiled as Missed — the stack reports call state directly, no CIEV ordering
  games.
- **`HostService` wiring**: persisted `carKitMode` flag; mutual exclusion with
  the raw RFCOMM lane (the phone allows one HFP client per device — car-kit ON
  parks `HfpClient`, OFF re-engages it; MAP/PBAP/MNS unaffected either way);
  one shared call-state consumer so history recording and the notification line
  work identically for both lanes.
- **API** (same LAN + cloud-relay contract as every other host command):
  - `GET  /carkit` → `{ supported, engaged, audioConnected, device, error, mode }`
  - `POST /carkit/mode?on=1|0` → switch lanes (parks/reconnects raw HFP)
  - `POST /carkit/audio?on=1|0` → pull call audio to the tablet / push it back
  - `/status` now carries the same block under `carKit`.

## The honest constraint

`BluetoothHeadsetClient` is a `@SystemApi`. Consumer builds usually ship with
the HF-client profile **disabled** (`profile_supported_hfpclient=false`) and
its methods behind `BLUETOOTH_PRIVILEGED` (signature permission — not
grantable via adb). The client therefore *probes* and reports one of:

- `supported: true` → the Galaxy Tab Active build offers the profile; car-kit
  mode should fully work, including SCO audio through the tablet.
- `supported: false` + `error` → the build refused the profile. Nothing an
  unprivileged APK can do will open SCO on that build; the toggle reports the
  reason instead of pretending.

If the tablet's build says no, the working audio alternatives already in the
tree are: the PC host's `CallAudioBridgeService` (carkit-class USB/BT audio
endpoints on the PC, 4.44.132) feeding `call-audio-feed.js` in the web app —
including on the tablet's browser.

## To activate (on-device; this sandbox has no Android SDK)

1. Rebuild the APK (bump `hostBuild` in `app/build.gradle.kts`), install on the
   ActiveTab.
2. `GET http://<tablet>:8765/carkit` → check `supported`.
3. `POST /carkit/mode?on=1` → watch `/log` for `[CARKIT]` lines; phone should
   show the tablet as a hands-free device.
4. Place a test call; `POST /carkit/audio?on=1` → audio through tablet
   speaker/mic.
5. Rebuild also picks up this batch's HFP fixes in the raw lane (missed-call
   reorder grace + AT+CLCC phantom-active-call check).
