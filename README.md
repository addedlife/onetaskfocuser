# Shamash Pro 4 App

Unified production workspace for Tasks, Shailos, and Phone.

For a new Codex session, say: `read brief`. For accurate low-token changes, use `BRIEF.txt` plus the matching row in `docs/ops/CONTEXT_INDEX.md`.

## Folders

- `apps/web/` - OneTask, NerveCenter, Switchboard, DeskPhone Web, Netlify functions.
- `apps/shailos/` - editable Shailos source.
- `apps/phone-host-windows/` - native Windows DeskPhone host.
- `docs/ops/` - verification, migration, promotion, rollback records.

## Source Rules

- Active production source is this folder only.
- Old scattered folders are rollback/archive sources only.
- Current operational state starts in `BRIEF.txt`; task-specific file targeting lives in `docs/ops/CONTEXT_INDEX.md`; detailed release history lives in `docs/ops/VERIFICATION_LOG.md`.
- Verified source changes should be committed and pushed unless the current thread says not to.
- Netlify deploys require explicit approval.

## Git

- Origin: `https://github.com/addedlife/onetaskfocuser.git`
- GitHub `main` is reconciled to Pro 4 as of 2026-05-11.
- The previous GitHub `main` history is preserved at `archive/pre-pro4-main-20260511-011424` and `archive-pre-pro4-main-20260511-011424`.
