# iPad Phone Bridge Probe

Native iPadOS probe for the Shamash WebPhone bridge contract.

Goal: test whether an iPad on iOS/iPadOS 26 can act as the Bluetooth client for a locked Android source phone, using the same car-kit profile family that already works in the Windows and Android bridge lanes:

- PBAP/PSE `0x112F` for contacts and call history.
- MAP/MAS `0x1132` for message listings and message bodies.
- MAP/MNS `0x1133` for live message notifications.
- HFP `0x111F` / `0x111E` for phone call state and possible audio-gateway signaling.

The app also serves the existing Shamash local API shape on:

`http://127.0.0.1:8765`

## Current Status

This is a probe, not a claimed production bridge.

Implemented:

- SwiftUI iPad app.
- Local Network-framework HTTP API server.
- CoreBluetooth discovery scan.
- Target profile probing for MAP/PBAP/HFP service UUIDs.
- API endpoints that expose probe state to Shamash.
- Explicit reserved responses for `/contacts`, `/messages`, and `/calls` until the probe proves the iPad can open the phone profile channels.

## Install On iPad

iPadOS apps must be signed by Apple tooling before installation. This Windows machine does not have Xcode, `xcodebuild`, `codesign`, or an Apple provisioning profile, so it cannot produce a directly installable signed `.ipa` locally.

To run the probe:

1. Open `WebPhoneBridge.xcodeproj` on a Mac with current Xcode.
2. Select the `WebPhoneBridge` target.
3. Set `Signing & Capabilities` to your Apple team.
4. Connect the iPad by USB or Wi-Fi pairing.
5. Choose the iPad as the run destination.
6. Press Run.
7. Tap `Scan`, select the Android source phone if it appears, then tap `Probe`.

## API Contract

- `GET /health`
- `GET /status`
- `GET /devices`
- `GET /events`
- `POST /probe/start`
- `POST /probe/stop`
- `POST /probe/connect` with body `{ "id": "<device UUID from /devices>" }`
- `GET /contacts` returns `501` until PBAP is proven.
- `GET /calls` returns `501` until PBAP is proven.
- `GET /messages` returns `501` until MAP is proven.

## Decision Gate

The probe succeeds only if the iPad can surface and connect to the Android phone's MAP/PBAP/HFP services through public iPadOS APIs. If CoreBluetooth does not surface those services, the next lane is private entitlement, MFi/accessory research, or hardware bridge work rather than webapp code.
