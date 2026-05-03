# DeskPhone Host Control Architecture

## Product Decision

DeskPhone Web is the shared interface. It can be deployed like the rest of Switchboard and opened from any modern browser.

The phone control layer is not browser-only. Each device family needs a small local host control app that is allowed by that operating system to pair with the phone and use the needed Bluetooth phone profiles.

No companion app is required on the phone.

## Operating Model

1. The user carries the phone.
2. The current computer, tablet, or other device pairs with that phone over Bluetooth.
3. A local host control app on that device talks to the phone.
4. DeskPhone Web talks to the local host control app through one stable HTTP contract.

The web app should not know whether the host is Windows, Android, or a future platform. It should only know the host control contract.

## Host Control Contract v1

Default local address:

```text
http://127.0.0.1:8765
```

Required read endpoints:

```text
GET /status
GET /messages
GET /calls
GET /contacts
```

Required command endpoints:

```text
POST /connect
POST /refresh
POST /answer
POST /hangup
POST /dial?n=NUMBER
POST /send?to=NUMBER&body=TEXT
```

Required `/status` fields:

```json
{
  "hostConnector": "DeskPhone Windows Host",
  "hostPlatform": "windows",
  "hostControlContract": "deskphone-host-control/v1",
  "hostScope": "loopback",
  "connected": true,
  "hfp": "connected",
  "map": "connected",
  "callState": "Idle",
  "conversationCount": 0,
  "messageCount": 0
}
```

Recommended `/status` fields:

```json
{
  "phoneTransport": {
    "calls": "HFP",
    "messages": "MAP",
    "contacts": "PBAP"
  },
  "recentCalls": [],
  "build": "b240"
}
```

## Platform Plan

Windows host:

- Current first supported host.
- Uses existing DeskPhone Bluetooth plumbing.
- Exposes the local host control contract on loopback.
- Responsible for HFP call control, MAP message sync/send, and PBAP contacts/call history.

Android host:

- Next feasibility lane.
- Must be a native Android app or service, not only a web page.
- Must prove the device can act as the phone-control side for calls, messages, and contacts under current Android permissions and OEM behavior.
- Should expose the same host control contract to DeskPhone Web.

iOS/iPadOS host:

- Treat full parity as blocked until proven otherwise.
- A browser cannot expose the required phone Bluetooth profiles.
- A normal App Store app is unlikely to get full HFP/MAP/PBAP control without Apple-approved accessory capabilities.
- It may still run the web UI, but not necessarily the local host connector.

## Security Rules

- Keep the host connector loopback-only by default.
- Do not expose phone calls, messages, contacts, or call history to the LAN or internet without explicit authentication.
- Any future non-loopback host must require a pairing token and an owner-controlled allowlist.
- The web app may be public, but the host connector is private device control.

## Build Order

1. Stabilize the web UI against the host control contract.
2. Ship the Windows host connector metadata and missing read endpoints.
3. Add host detection and clear unavailable-host states in the web UI.
4. Research and prototype the Android host connector against the same contract.
5. Reassess iOS only after confirming whether Apple exposes a legitimate route for the needed profiles.
