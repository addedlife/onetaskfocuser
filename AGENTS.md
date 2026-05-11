# Shamash Pro 4 Agent Instructions

Start with `BRIEF.txt`. Keep both cached and uncached token use low: read the brief, then the matching row in `docs/ops/CONTEXT_INDEX.md`, then only the specific ops log and source files needed for the task.

## Production Source

- Active workspace: `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 4 App`
- `apps/web/` - Tasks, NerveCenter, Switchboard, DeskPhone Web, Netlify functions.
- `apps/shailos/` - editable Shailos source.
- `apps/phone-host-windows/` - native DeskPhone host.
- Old Shamash/OneTask/DeskPhone folders are rollback/archive only unless the user explicitly requests recovery.

## Operating Law

- Before a coding fix, project, upgrade, or change, research the relevant industry-standard practice. If it conflicts with the local plan, tell the user and get confirmation before proceeding.
- Verify current state from `docs/ops/VERIFICATION_LOG.md` before changing code.
- Use `docs/ops/CONTEXT_INDEX.md` to target source reads; expand with `rg` only when the listed context is insufficient.
- Commit, push, and deploy verified web changes unless the current thread specifically says not to.
- Do not relink Netlify without explicit approval.
- Record verification results in `docs/ops/VERIFICATION_LOG.md`.
- Record migration decisions in `docs/ops/MIGRATION_MANIFEST.md`.

## Git And Release

- Git origin is `https://github.com/addedlife/onetaskfocuser.git`.
- GitHub `main` is reconciled to Pro 4 as of 2026-05-11.
- Normal push target is `origin/main`.
- Old GitHub main is preserved at branch `archive/pre-pro4-main-20260511-011424` and tag `archive-pre-pro4-main-20260511-011424`.
- Netlify production should be deployed from `apps/web` with `npx netlify deploy --prod` after verified web changes unless the current thread says not to.

## Verification Gates

- `apps/web`: `npm run build`
- `apps/shailos`: `npm run build`
- `apps/phone-host-windows`: `dotnet build`
- Smoke-test affected app surfaces locally before claiming completion.
