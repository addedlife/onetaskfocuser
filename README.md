# Shamash Pro 4 App

Unified production workspace for Tasks, Shailos, and Phone.

For a new Codex session, say: `read brief`.

## Folders

- `apps/web/` - OneTask, NerveCenter, Switchboard, DeskPhone Web, Netlify functions.
- `apps/shailos/` - editable Shailos source.
- `apps/phone-host-windows/` - native Windows DeskPhone host.
- `docs/ops/` - verification, migration, promotion, rollback records.

## Source Rules

- Active production source is this folder only.
- Old scattered folders are rollback/archive sources only.
- Current operational state starts in `BRIEF.txt`, then `docs/ops/VERIFICATION_LOG.md` if more detail is needed.
- Verified source changes should be committed and pushed unless the current thread says not to.
- Netlify deploys require explicit approval.

## Git

- Origin: `https://github.com/addedlife/onetaskfocuser.git`
- Pro 4 was initialized as a clean repo, so local `master` and remote `main` do not share history yet.
- Push Pro 4 work to `codex/...` branches until `main` is intentionally reconciled.
