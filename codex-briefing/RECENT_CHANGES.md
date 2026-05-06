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

- 2026-05-06: DeskPhone Web now has a full Calls / Make Call browser surface. Calls navigation shows all native `/calls` records across numbers, row actions still hand off/dial the selected call number, and Make Call opens the browser dialer directly. Smoke coverage verifies all-number call history, Out filtering across numbers, full Calls row actions, and Make Call dialer reopen. Ledger moved to 157 implemented-web, 36 host-api-needed, 6 native-only, 0 not-yet-reviewed.
- 2026-05-06: DeskPhone Web Contacts now uses native /contacts data for a browser list/detail surface with New Contact, Text, Call, and Edit Details actions. Smoke coverage verifies selected contact phone handoffs and /dial. Ledger moved to 155 implemented-web, 38 host-api-needed, 6 native-only, 0 not-yet-reviewed.
- 2026-05-06: DeskPhone Web Settings now exposes real toggles for Sync theme with Shamash app, History Background Fetching, and Dark mode. Native b254 adds status fields plus /set-theme-sync, /set-history-paused, and /set-dark-mode support. Ledger moved to 150 implemented-web, 43 host-api-needed, 6 native-only, 0 not-yet-reviewed.
- 2026-05-06: DeskPhone Web Settings now exposes host-backed Appearance Reset, Refresh Sync, Import VCF, Import Synced, and Ignore Pending controls. Native b253 adds /reset-ui-scale, /refresh-theme-sync, /import-starter-vcf, /import-pending-contacts, and /skip-pending-contacts support. Ledger moved to 147 implemented-web, 46 host-api-needed, 6 native-only, 0 not-yet-reviewed.
- 2026-05-06: DeskPhone Web Settings now has native-mapped Appearance, Contact Sync, and Audio section selectors, plus host-backed Sync Folder and Save Backup controls. Native b252 adds /open-contact-sync-folder and /export-messages-backup support. Ledger moved to 142 implemented-web, 51 host-api-needed, 6 native-only, 0 not-yet-reviewed.
- 2026-05-06: Top/header New Message rows and the remaining duplicate call-record Delete row were mapped to verified browser handoffs; the top New Message button now actually opens the native compose handoff. Ledger moved to 137 implemented-web, 56 host-api-needed, 6 native-only, 0 not-yet-reviewed.
- 2026-05-06: DeskPhone Web Developer Tools now exposes host-backed Live Log, Clear Log, Open Auditor, and Run UI Auditor controls. Native b251 adds /open-live-log, /clear-log, and /run-ui-auditor support. Ledger moved to 134 implemented-web, 59 host-api-needed, 6 native-only, 0 not-yet-reviewed.
- 2026-05-06: Call-history Delete all and call-row Block/Delete rows were mapped to verified browser handoffs. Ledger moved to 129 implemented-web, 64 host-api-needed, 6 native-only, 0 not-yet-reviewed.
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
