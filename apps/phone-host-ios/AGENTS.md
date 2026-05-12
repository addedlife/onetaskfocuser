# DeskPhone iOS — phone host for iPad/iPhone

Swift + SwiftUI app that runs an HTTP server on `http://localhost:8765/` so the
DeskPhone web app running in Safari on the same device can connect to it via the
same API contract as the Windows host.

## Requirements

- Xcode 15+
- iOS 16+ deployment target
- Physical device or simulator (iPad or iPhone)

## Open in Xcode

```
open DeskPhoneIOS.xcodeproj
```

Select your device, set your Team in Signing & Capabilities, then Run (⌘R).

## Keep the app active

iOS suspends background apps. Run DeskPhone iOS in **Split View** or **Slide Over**
alongside Safari so the HTTP server stays alive while you use the web app.

## API surface (port 8765)

| Method | Path | iOS behaviour |
|--------|------|---------------|
| GET | /status | Returns `{"host":"iOS","connection":"idle","callState":"Idle",...}` |
| GET | /contacts | Full contact list from CNContactStore (same JSON shape as Windows) |
| GET | /messages | Always `[]` — iOS sandbox blocks SMS history |
| GET | /calls | Always `[]` — iOS sandbox blocks call history |
| GET | /log?n=N | Last N server log lines |
| POST | /connect | No-op (no BT phone pairing on iOS) |
| POST | /dial?n=NUMBER | Opens `tel://NUMBER` in Phone app |
| POST | /send?to=X&body=Y | Opens `sms:X&body=Y` in Messages |
| POST | /send-with-attachments | Opens Messages with body text (attachments dropped) |
| POST | /refresh | Re-reads contacts |
| POST | /show | No-op |
| POST | /theme | Posts `deskPhoneThemeChanged` notification |
| POST | /handoff?target=X | No-op |
| POST | /shutdown | Exits the process |
| POST | *(other known endpoints)* | Returns `{"result":"not applicable on iOS"}` — 200 OK so the web app stays connected |

## Source layout

```
DeskPhoneIOS/
├── DeskPhoneIOSApp.swift      — @main entry point
├── ContentView.swift          — SwiftUI status screen
├── AppViewModel.swift         — ObservableObject tying services to UI
├── Info.plist                 — NSContactsUsageDescription + deskphone:// URL scheme
├── Assets.xcassets/
└── Services/
    ├── ControlAPIService.swift — Raw NWListener HTTP server, endpoint routing
    └── ContactsService.swift   — CNContactStore → JSON bridge
```

## Adding new endpoints

Edit `ControlAPIService.swift`, `handleRequest(method:path:qs:body:)`.
Follow the switch/case pattern already there. Remove the path from
`knownButUnsupportedEndpoints` if it previously lived there.
