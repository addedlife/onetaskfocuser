# Shamash Pro 4 Agent Instructions

This folder is the clean consolidation candidate for Tasks, Shailos, and Phone.

## Operating Rule

Do not treat this folder as production until `docs/ops/PROMOTION_CHECKLIST.md` is complete.

## Layout

- `apps/web/` - Tasks, NerveCenter, Switchboard, DeskPhone Web, Netlify functions.
- `apps/shailos/` - editable Shailos source.
- `apps/phone-host-windows/` - native DeskPhone host source.

## Safety

- Do not delete or rename the old live folders from here.
- Do not push, deploy, or relink Netlify from this folder without explicit approval.
- Keep verification results in `docs/ops/VERIFICATION_LOG.md`.
- Keep migration decisions in `docs/ops/MIGRATION_MANIFEST.md`.

## Verification

Before claiming this workspace is operational:

- Run `npm run build` in `apps/web`.
- Run `npm run build` in `apps/shailos`.
- Run `dotnet build` in `apps/phone-host-windows`.
- Smoke-test the app surfaces locally.
