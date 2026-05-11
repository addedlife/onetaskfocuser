# Shamash Pro 4 Agent Instructions

This folder is the active Shamash production workspace for Tasks, Shailos, and Phone.

## Operating Rule

Treat this folder as production source. Verify current state from `docs/ops/VERIFICATION_LOG.md` before changing code.

## Layout

- `apps/web/` - Tasks, NerveCenter, Switchboard, DeskPhone Web, Netlify functions.
- `apps/shailos/` - editable Shailos source.
- `apps/phone-host-windows/` - native DeskPhone host source.

## Safety

- Do not resume normal feature work in old folders; they are rollback-only unless the user explicitly requests rollback.
- Always commit and push verified source changes unless the user specifically instructs otherwise in the current thread.
- Do not deploy or relink Netlify from this folder without explicit approval.
- Keep verification results in `docs/ops/VERIFICATION_LOG.md`.
- Keep migration decisions in `docs/ops/MIGRATION_MANIFEST.md`.

## Verification

Before claiming this workspace is operational:

- Run `npm run build` in `apps/web`.
- Run `npm run build` in `apps/shailos`.
- Run `dotnet build` in `apps/phone-host-windows`.
- Smoke-test the app surfaces locally.
