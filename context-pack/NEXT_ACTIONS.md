# Next Actions

Last updated: 2026-05-06

Immediate / blocking:

- `[YOU]` Add `GOOGLE_CLIENT_ID` to Netlify production environment variables (Netlify dashboard → onetaskfocuser → Environment variables). Without this, the Google connector is invisible in production.
- `[YOU]` After adding Client ID: verify in production — connect Google, confirm Calendar loads all subscribed calendars, Gmail shows 20 most recent personal+important promos/updates, Add Event modal creates an event, hover tooltip works, auth survives page reload.

Known rough edges to watch for next session:

- AI email summary batch call adds ~2-3 seconds to Gmail load time. If too slow in practice, consider caching summaries in sessionStorage keyed by message ID.
- `calendarRefreshKey` increment after Add Event causes a full re-fetch including a new AI summary batch call — acceptable for now but could be optimized to only refresh calendar events.
- The `reconnectTimedOut` state resets correctly when token arrives, but test the edge case: user has `ot_google_connected=1` in localStorage but has revoked app access in Google — in that case silent re-auth will silently fail and the button will appear after 6s, which is correct.
- Gmail query `(category:primary) OR (category:promotions is:important) OR (category:updates is:important)` — if inbox has no primary emails, the card may show only promotions/updates. Verify this looks correct in practice.

Active product queue:

- Continue DeskPhone Web parity from the existing DeskPhone native inventory.
- Split `src/08-app.jsx` (5,500+ lines) into feature modules — proposed order: shell chrome, NerveCenter panels, phone mini surface, Shailos/iframe shell, Google connector hook, conversation capture, then App-state helpers. Do one slice per session with a build verification after each.
- Mobile localhost lane: document iOS localhost test path first, then Android.
- Shailos as first-class NerveCenter work items (not just separate route).

Verification default:

- Run `npm run build` after changes.
- For DeskPhone Web changes, run the existing DeskPhone web smoke test where practical.
- Verify production asset after Netlify deploy when a deploy is requested.
