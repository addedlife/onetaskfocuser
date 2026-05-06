# Recent Changes

Last updated: 2026-05-06

- `2026-05-06 session`: Google token persisted to localStorage — survives page refresh/restart. Silent re-auth fires on load if token expired. Disconnect clears stored token.
- `2026-05-06 session`: iPhone Google fix — API errors now set data to `[]` instead of keeping `null`, so Calendar/Gmail cards always render after successful auth.
- `2026-05-06 session`: Calendar card gets "+" (Add Event) and "↗" (Open Calendar) header buttons plus per-event "↗" open links.
- `2026-05-06 session`: Gmail card gets "↗" header button (Open Gmail), per-email "↗" open links, and snippet preview on each row.
- `2026-05-06 session`: NerveCenter phone section vertically split — texts on top, calls on bottom, each box independently scrollable, never pushed off screen.
- `2026-05-06 session`: Top-left menu button and PostItStack now offset by `sidebarW` so sidebar never covers them.
- `2026-05-06 session`: AppSuiteChrome left rail auto-collapses after 10s idle (mouse leave) with persist-to-localStorage toggle at bottom.
- `2026-05-06 session`: DeskPhone Web rail auto-collapses after 10s idle with same toggle at rail bottom.
- `8674b16`: DeskPhone Web now reads native outgoing message send-state fields and shows `Confirming on phone`; the parity smoke harness verifies that state.
- `da44212`: Google connector setup path is visible when no Google Client ID exists.
- `ff7afed`: Google connector config handoff added through Netlify app config.
- `856c162`: local work merged with the other coder's Google connector commits from `origin/main`.
- `fd507df`: DeskPhone Web history and MMS photo chrome fixed.
- `5a9f956`: persistent left pane layout fixed so app content is pushed to the right.

Latest verified deploy:

- Netlify production deploy: automatic deploy from latest pushed `main`
- Served asset `index-BoHqrUDj.js`
- App config reports `googleAvailable: false` because no production `GOOGLE_CLIENT_ID` is configured.

Local parity progress:

- 2026-05-06: Remaining edit/save-contact duplicate rows and dialer Text duplicate rows were mapped to verified browser handoffs. Ledger moved to 124 implemented-web, 69 host-api-needed, 6 native-only, 0 not-yet-reviewed.
- 2026-05-06: Contact create/edit handoff rows were mapped for duplicate thread-header Add contact/Edit contact plus Save as contact. Existing smoke coverage verifies new-contact and edit-contact handoffs carry the conversation number. Ledger moved to 119 implemented-web, 74 host-api-needed, 6 native-only, 0 not-yet-reviewed.
- 2026-05-06: Duplicate native thread-header rows for Block, Pin, Mute, Mark read, and Mark unread were mapped to the same verified browser header controls. Ledger moved to 114 implemented-web, 79 host-api-needed, 6 native-only, 0 not-yet-reviewed.
- 2026-05-06: DeskPhone Web conversation row action menu sources were aligned to the exact native inventory for Mark read, Mark unread, Pin, Mute, and Block. Smoke coverage now opens the row menu and verifies those exact-source controls. Ledger moved to 109 implemented-web, 84 host-api-needed, 6 native-only, 0 not-yet-reviewed.
- 2026-05-06: DeskPhone Web thread header action sources were aligned to the exact native inventory for Block, Pin, Mute, Mark read, and Mark unread. Existing smoke coverage verifies those handoffs carry the selected conversation number. Ledger moved to 104 implemented-web, 89 host-api-needed, 6 native-only, 0 not-yet-reviewed.
- 2026-05-06: DeskPhone Web thread search Previous/Next is now real browser behavior. Search matches are highlighted, the active match scrolls into view, and the smoke test verifies both arrow buttons. Ledger moved to 99 implemented-web, 94 host-api-needed, 6 native-only, 0 not-yet-reviewed.
- 2026-05-06: DeskPhone Web Settings now exposes host-backed Windows tool actions: Bluetooth Settings, Sound Settings, audio refresh, builds folder, and event log. The matching smoke test verifies all five browser buttons call their host endpoints. Ledger moved to 95 implemented-web, 98 host-api-needed, 6 native-only, 0 not-yet-reviewed.
- 2026-05-06: DeskPhone Web parity CSV review completed. All 199 native action rows are classified against current web evidence: 89 implemented-web, 104 host-api-needed, 6 native-only, 0 not-yet-reviewed. Final blockers include full compose/contact editor, settings device/contact-sync/audio/developer commands, and Windows folder/settings launch actions.

Operational lesson from 2026-05-05:

- Always fetch/merge latest `origin/main` before web work because another coder may be active.
- Verify production after deploy; do not assume local build equals live site.
