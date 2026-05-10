# Rollback And Deprecation

Date: 2026-05-10

## Current Production

- Live URL: `https://onetaskfocuser.netlify.app`
- Production deploy: `6a01194dc5d71bfed30a76ea`
- Source: `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 4 App`

## Deprecated Rollback Sources

- Legacy web app: `C:\Users\ydanz\OneDrive\Documents\taskmanager app\sandbox`
- Legacy Shailos app: `C:\Users\ydanz\OneDrive\Documents\taskmanager app\backup\sto-src\Shaila-Trancriber-Organizer-main`
- Legacy native DeskPhone: `C:\Users\ydanz\OneDrive\Documents\PC as Bluetooth call - text interface\DeskPhone`

Each legacy folder now has `DEPRECATED_ROLLBACK_SOURCE_DO_NOT_USE_FOR_LIVE_WORK.md` at its root.

## Rollback Rule

Rollback should be explicit and reversible:

1. Confirm the production issue.
2. Prefer Netlify dashboard rollback to the last known-good production deploy before `6a01194dc5d71bfed30a76ea`.
3. If dashboard rollback is not enough, redeploy from the preserved legacy source folder.
4. Do not delete or rename old folders until Pro 4 has survived at least one stable production cycle.

## What Not To Do

- Do not continue feature work in the deprecated folders.
- Do not delete the deprecated folders yet.
- Do not silently redeploy from legacy sources without recording it here.
