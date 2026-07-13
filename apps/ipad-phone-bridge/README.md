# iPad Phone Bridge (probe + LAN host proxy + cloud lane)

Native iPadOS app for the Shamash WebPhone bridge contract. Lanes:

0. **Cloud lane (2026-07).** `RelayPresenceService.swift` makes the iPad a
   third link on the SAME Firestore relay as the Android/PC hosts: it beacons
   `hosts.ios` presence into `phone-relay/owner` every ~20 s (the auto-finder's
   input), and while the web rail toggle prefers the iPad it pushes the full
   LAN-proxied state blob (`status/messages/calls/contacts`) to
   `phone-relay/state`, so every remote browser reads the phone feed through
   the iPad. The iPad still cannot hold the phone's Bluetooth itself (see the
   verdict below) — this lane FEEDS the cloud from whichever BT-capable host
   holds the link.

1. **LAN host proxy (the working lane).** The app discovers the active Shamash
   phone host on the local network via Bonjour (`_shamash-phonehost._tcp`,
   advertised by `apps/phone-host-android`; the Windows host is reachable via
   manual `POST /lan-host {"host":"192.168.x.x"}`) and transparently proxies
   the whole host contract (`/status /messages /calls /contacts /send /dial
   /answer /hangup …`) on `http://127.0.0.1:8765`. The web app on the iPad
   works unchanged, data stays on the LAN, and the cloud relay is not used.
   Native URLSession does the LAN hop, which sidesteps the https
   mixed-content rule that blocks the web app from calling a LAN IP directly.

2. **Direct Bluetooth probe (gated).** Tests whether iPadOS can act as the
   Bluetooth client for the locked Android source phone, using the same
   car-kit profile family that already works in the Windows and Android lanes:

   - PBAP/PSE `0x112F` for contacts and call history.
   - MAP/MAS `0x1132` for message listings and message bodies.
   - MAP/MNS `0x1133` for live message notifications.
   - HFP `0x111F` / `0x111E` for phone call state and possible audio-gateway signaling.

**Direct-Bluetooth verdict (2026-07): not possible with public APIs.**
MAP/PBAP/HFP are Bluetooth *Classic* RFCOMM/SDP profiles, not GATT services —
CoreBluetooth's service discovery can never surface them, and iPadOS has no
public RFCOMM socket API (ExternalAccessory requires MFi hardware). The probe
stays in the app as the decision gate: if a future iPadOS release surfaces
these profiles, the gate reopens; until then the iPad's local lane is the LAN
proxy above, and the only true iPad-standalone option is MFi/hardware-bridge
work — not webapp code.

The app serves the existing Shamash local API shape on:

`http://127.0.0.1:8765`

## Current Status

- SwiftUI iPad app.
- Local Network-framework HTTP API server.
- **LAN host discovery (Bonjour) + raw HTTP proxy of the full host contract** —
  new; makes the iPad a no-relay surface whenever a PC or Android host is on
  the same network and holds the phone's Bluetooth link.
- CoreBluetooth discovery scan + target profile probing (the decision gate).
- Explicit reserved responses for `/contacts`, `/messages`, and `/calls` when
  no LAN host is reachable and the probe is unproven.

## Install On iPad

iPadOS apps must be signed by Apple tooling before installation; building
requires a Mac with Xcode.

1. Open `WebPhoneBridge.xcodeproj` on a Mac with current Xcode.
2. Select the `WebPhoneBridge` target.
3. Set `Signing & Capabilities` to your Apple team.
4. Connect the iPad by USB or Wi-Fi pairing.
5. Choose the iPad as the run destination.
6. Press Run.
7. Allow the Local Network permission prompt (needed for Bonjour discovery
   of the phone host). The status panel shows the discovered LAN host.

## API Contract

- `GET /health`
- `GET /status` (includes a `lanHost` block: discovered/manual host + errors)
- `GET /devices`
- `GET /events`
- `GET /lan-host` / `POST /lan-host` with `{ "host": "192.168.1.20" }`
  (manual host for networks that filter mDNS; port defaults to 8765)
- `POST /probe/start`
- `POST /probe/stop`
- `POST /probe/connect` with body `{ "id": "<device UUID from /devices>" }`
- **Any other host-contract path** (`/messages`, `/calls`, `/contacts`,
  `/send`, `/dial`, `/answer`, `/hangup`, …) is proxied raw to the active LAN
  host when one is reachable.
- Without a LAN host: `GET /contacts` / `/calls` / `/messages` return `501`
  until the direct-Bluetooth probe is proven (see verdict above).

## Decision Gate

The direct-Bluetooth lane succeeds only if the iPad can surface and connect to
the Android phone's MAP/PBAP/HFP services through public iPadOS APIs. Per the
verdict above this is expected to fail on-device; if it ever passes, the
reserved endpoints get real Bluetooth implementations (port the Kotlin stack
from `apps/phone-host-android`). Otherwise the LAN proxy is the iPad lane, and
standalone-iPad requires MFi/accessory or hardware-bridge research — not
webapp code.
