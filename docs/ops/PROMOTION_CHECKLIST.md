# Promotion Checklist

This workspace becomes live only after every gate below passes.

## Build Gates

- `apps/web`: install dependencies and run `npm run build`. First pass: passed on 2026-05-10.
- `apps/shailos`: install dependencies and run `npm run build`. First pass: passed on 2026-05-10.
- `apps/phone-host-windows`: run `dotnet build`. First pass: passed on 2026-05-10 with existing warnings.

## Runtime Gates

- Web app opens locally.
- NerveCenter renders Tasks, Shailos, and Phone sections. CEO browser review pending.
- `/shailos/` route opens from the web build. First HTTP check passed on 2026-05-10.
- Netlify functions route from `apps/web/backend/functions`. Syntax check and local Netlify runtime test passed on 2026-05-10.
- DeskPhone host starts and exposes the local phone API. First pass passed on 2026-05-10.
- DeskPhone Web can read host status/messages/calls/contacts. Raw host endpoints passed on 2026-05-10; browser UI review pending.

## Cutover Gates

- Create a real Git repo for `Shamash Pro 4 App`.
- Commit the clean baseline.
- Link/deploy only after local gates pass.
- Rename old folders with a clear deprecated marker only after production is verified.
- Keep rollback notes pointing to the old live folders until at least one stable production cycle has passed.

## Current Status

Ready for CEO public draft-preview test at `https://6a010ab82d99e0fff8c159c9--onetaskfocuser.netlify.app`.

Latest preview hotfix passed external HTTP checks for the main app, Shailos, app config, and AI proxy. AI currently falls back to `gemini-2.5-flash-lite` when `gemini-2.5-flash` is quota-limited.

Not ready for old-folder deprecation.
