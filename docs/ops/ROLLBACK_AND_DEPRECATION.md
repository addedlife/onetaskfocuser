# Rollback And Deprecation

Date: 2026-05-10

## Current Production

- Live URL: `https://onetaskfocuser.netlify.app`
- Production deploy: `6a01194dc5d71bfed30a76ea`
- Source: `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 4 App`
- Native DeskPhone shortcut: `C:\Users\ydanz\OneDrive\Desktop\DeskPhone.lnk`
- Native DeskPhone launcher target: `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 4 App\apps\phone-host-windows\deployed-builds\launcher\DeskPhoneLauncher.exe`

## Deprecated Rollback Sources

- Legacy web app: `C:\Users\ydanz\OneDrive\Documents\taskmanager app\_MOTHBALLED_ROLLBACK_ONLY_sandbox_2026-05-10`
- Legacy Shailos app: `C:\Users\ydanz\OneDrive\Documents\taskmanager app\backup\sto-src\_MOTHBALLED_ROLLBACK_ONLY_Shaila-Trancriber-Organizer-main_2026-05-10`
- Legacy native DeskPhone: `C:\Users\ydanz\OneDrive\Documents\PC as Bluetooth call - text interface\_MOTHBALLED_ROLLBACK_ONLY_DeskPhone_2026-05-10`

Each legacy folder now has `DEPRECATED_ROLLBACK_SOURCE_DO_NOT_USE_FOR_LIVE_WORK.md` at its root. The old DeskPhone path residue was renamed to `C:\Users\ydanz\OneDrive\Documents\PC as Bluetooth call - text interface\_TOMBSTONE_DO_NOT_USE_DeskPhone_old_path_residue_2026-05-10` because Windows/OneDrive left protected `.git` and scratch metadata behind during quarantine.

## Rollback Rule

Rollback should be explicit and reversible:

1. Confirm the production issue.
2. Prefer Netlify dashboard rollback to the last known-good production deploy before `6a01194dc5d71bfed30a76ea`.
3. If dashboard rollback is not enough, redeploy from the preserved legacy source folder.
4. If a source redeploy is required, copy the needed mothballed rollback source into a temporary restore folder first; do not resume normal work inside the mothballed folder.
5. Do not delete mothballed folders until Pro 4 has survived at least one stable production cycle.

## What Not To Do

- Do not continue feature work in the deprecated folders.
- Do not delete the mothballed folders yet.
- Do not silently redeploy from legacy sources without recording it here.
