# Shamash Pro 4 App

Unified production workspace for Tasks, Shailos, and Phone.

This folder is the active production source for Shamash as of the 2026-05-10 Netlify production promotion. The old scattered folders are deprecated rollback sources only.

## Layout

- `apps/web/` - OneTask / NerveCenter / Switchboard / DeskPhone Web.
- `apps/shailos/` - editable Shailos React/TypeScript source.
- `apps/phone-host-windows/` - native Windows DeskPhone host for local phone control.
- `docs/ops/` - migration, promotion, and deprecation notes.
- `services/` - reserved for shared service code once duplicated app logic is extracted.
- `tooling/` - reserved for shared build/test/verification scripts.

## Current Safety Rule

Production now ships from this workspace. Do not resume normal feature work in the old folders. Keep old sources as rollback-only until the rollback window is intentionally closed.

Operational truth lives in:

- `docs/ops/VERIFICATION_LOG.md`
- `docs/ops/PROMOTION_CHECKLIST.md`
- `docs/ops/ROLLBACK_AND_DEPRECATION.md`

## Source Truth Brought In

- Tasks/OneTask source came from `C:\Users\ydanz\OneDrive\Documents\taskmanager app\sandbox`.
- Shailos source came from `C:\Users\ydanz\OneDrive\Documents\taskmanager app\backup\sto-src\Shaila-Trancriber-Organizer-main`.
- Phone host source came from `C:\Users\ydanz\OneDrive\Documents\PC as Bluetooth call - text interface\DeskPhone`.

Generated build outputs, dependency folders, local screenshots, logs, scratch probes, old backups, and machine-specific state were intentionally excluded.
