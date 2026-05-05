# Next Actions

Last updated: 2026-05-05

Immediate connector action:

- Add a real Google OAuth Client ID to Netlify production as `GOOGLE_CLIENT_ID`, or enter it manually in `Settings > Google`.
- After that, verify Google Calendar/Gmail connect flow from NerveCenter.

Active product queue:

- Continue DeskPhone Web parity from the existing DeskPhone native inventory.
- Preserve every native DeskPhone button, function, layout behavior, and expected phone-app behavior unless intentionally replaced.
- Keep native shortcut handoffs for web buttons until each function is implemented natively in the web version.
- Continue polishing NerveCenter layout so the persistent left panel pushes content instead of covering it.

Verification default:

- Run `npm run build` after changes.
- For DeskPhone Web changes, run the existing DeskPhone web smoke test where practical.
- Verify production asset after Netlify deploy when a deploy is requested.
