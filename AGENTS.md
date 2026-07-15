# Shamash Pro 4 Agent Instructions

Start with `BRIEF.txt`. Keep both cached and uncached token use low: read the brief, then the matching row in `docs/ops/CONTEXT_INDEX.md`, then only the specific ops log and source files needed for the task.

## Production Source

- Active workspace: `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 4 App`
- `apps/web/` - Tasks, NerveCenter, Switchboard, DeskPhone Web, Firebase Functions (`apps/web/functions/`, the live backend).
- `apps/shailos/` - editable Shailos source.
- `apps/phone-host-windows/` - native DeskPhone host.
- Old Shamash/OneTask/DeskPhone folders are rollback/archive only unless the user explicitly requests recovery.

## Operating Law

- Before a coding fix, project, upgrade, or change, research the relevant industry-standard practice. If it conflicts with the local plan, tell the user and get confirmation before proceeding.
- Verify current state from `docs/ops/VERIFICATION_LOG.md` before changing code.
- Use `docs/ops/CONTEXT_INDEX.md` to target source reads; expand with `rg` only when the listed context is insufficient.
- **Always push live after a verified good fix** (standing owner authorization — see `CLAUDE.md`). After verified web changes, commit and push straight to `origin/main` — do not leave a verified fix on a feature branch and do not ask "should I push this live?" for a normal fix. Then verify `.github/workflows/deploy.yml` deployed the pushed commit to Firebase Hosting — **Firebase is the only live target; Netlify is fully decommissioned**, not a fallback or secondary host. (Exceptions needing a heads-up first: storage/sync refactors per `HANDOFF.md` §9, schema migrations, secret/permission changes.)
- Bump `apps/web/src/version.js` (`APP_VERSION` + `APP_VERSION_DATE`, shown in the left rail) on every release — minor for `feat:`, patch for `fix:`/`style:`.
- Do not relink Netlify without explicit approval.
- Record verification results in `docs/ops/VERIFICATION_LOG.md`.
- Record migration decisions in `docs/ops/MIGRATION_MANIFEST.md`.

## Git And Release

- Git origin is `https://github.com/addedlife/onetaskfocuser.git`.
- GitHub `main` is reconciled to Pro 4 as of 2026-05-11.
- Normal push target is `origin/main`.
- Old GitHub main is preserved at branch `archive/pre-pro4-main-20260511-011424` and tag `archive-pre-pro4-main-20260511-011424`.
- **Netlify is fully decommissioned — it does not build, deploy, or serve anything.** Normal web release is push-to-GitHub, then `.github/workflows/deploy.yml` deploys to Firebase Hosting (`firebase deploy --only hosting,functions --project onetaskonly-app`). The root `netlify.toml` and `apps/web/netlify.toml` still exist only as a labeled rollback path (see their own header comments) — never treat them as live or describe Netlify as auto-publishing.

## Verification Gates

- `apps/web`: `npm run build`
- `apps/shailos`: `npm run build`
- `apps/phone-host-windows`: `dotnet build`
- Smoke-test affected app surfaces locally before claiming completion.
