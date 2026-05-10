# Shamash Pro 4 App

Unified clean workspace for Tasks, Shailos, and Phone.

This folder is not live yet. It is the consolidation candidate that will replace the old scattered folders only after build and runtime checks pass.

## Layout

- `apps/web/` - OneTask / NerveCenter / Switchboard / DeskPhone Web.
- `apps/shailos/` - editable Shailos React/TypeScript source.
- `apps/phone-host-windows/` - native Windows DeskPhone host for local phone control.
- `docs/ops/` - migration, promotion, and deprecation notes.
- `services/` - reserved for shared service code once duplicated app logic is extracted.
- `tooling/` - reserved for shared build/test/verification scripts.

## Current Safety Rule

Production still ships from the old live folders. Do not deploy, rename, or retire old folders until this workspace passes the promotion checklist in `docs/ops/PROMOTION_CHECKLIST.md`.

## Source Truth Brought In

- Tasks/OneTask source came from `C:\Users\ydanz\OneDrive\Documents\taskmanager app\sandbox`.
- Shailos source came from `C:\Users\ydanz\OneDrive\Documents\taskmanager app\backup\sto-src\Shaila-Trancriber-Organizer-main`.
- Phone host source came from `C:\Users\ydanz\OneDrive\Documents\PC as Bluetooth call - text interface\DeskPhone`.

Generated build outputs, dependency folders, local screenshots, logs, scratch probes, old backups, and machine-specific state were intentionally excluded.
