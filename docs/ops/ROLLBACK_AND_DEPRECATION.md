# Rollback And Deprecation

Date: 2026-05-10

## Current Production

- Live URL: `https://onetaskonly-app.firebaseapp.com` (the `.web.app` twin auto-redirects here)
- Production deploy: Firebase Hosting via `.github/workflows/deploy.yml` (push to `main`)
- Source: `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 4 App`
- Native DeskPhone shortcut: `C:\Users\ydanz\OneDrive\Desktop\DeskPhone.lnk`
- Native DeskPhone launcher target: `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 4 App\apps\phone-host-windows\deployed-builds\launcher\DeskPhoneLauncher.exe`

## Deprecated Rollback Sources

- Legacy web app: hard-scrambled; restore via central Pro 3 manifest.
- Legacy Shailos app: hard-scrambled; restore via central Pro 3 manifest.
- Legacy native DeskPhone: hard-scrambled; restore via central Pro 3 manifest.
- Legacy Pro 3 control folder: `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control`

Each legacy folder now has `DEPRECATED_ROLLBACK_SOURCE_DO_NOT_USE_FOR_LIVE_WORK.md` at its root. The old DeskPhone path residue was renamed to `C:\Users\ydanz\OneDrive\Documents\PC as Bluetooth call - text interface\_TOMBSTONE_DO_NOT_USE_DeskPhone_old_path_residue_2026-05-10` because Windows/OneDrive left protected `.git` and scratch metadata behind during quarantine.

The Pro 3 control folder remains in place only as a hard-tombstoned rollback/archive container. Its old top-level contents were moved into a scrambled payload folder:

`C:\Users\ydanz\OneDrive\Documents\Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control\_TOMBSTONED_PAYLOAD_SCRAMBLED_UNUSABLE_UNTIL_RESTORE_2026-05-10_2338`

The original top-level paths are intentionally broken. Emergency recovery requires `SCRAMBLE_MANIFEST.json` plus `EMERGENCY_DESCRAMBLE_RESTORE.ps1` from the Pro 3 root.

All remaining source-bearing old folders are also hard-scrambled. Use the central manifest and restore command:

- Manifest: `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control\CENTRAL_DESCRAMBLE_MANIFEST.json`
- Restore script: `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control\EMERGENCY_DESCRAMBLE_ALL_LEGACY.ps1`
- Readme: `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control\CENTRAL_DESCRAMBLE_README.md`
- Legacy location record: `C:\Users\ydanz\OneDrive\Documents\Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control\LEGACY_LOCATION_RECORD.md`

Restore command:

`powershell -ExecutionPolicy Bypass -File "C:\Users\ydanz\OneDrive\Documents\Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control\EMERGENCY_DESCRAMBLE_ALL_LEGACY.ps1"`

The former Rabbi Dashboard / Shamash greenfield repo was retired using the standard compressed-archive pattern:

- Tombstone path: `C:\Users\ydanz\OneDrive\Documents\Rabbi Dashboard`
- Archive: `C:\Users\ydanz\OneDrive\Documents\Retired Source Archives\2026-05-11-rabbi-dashboard-retirement\rabbi-dashboard-reference-source-2026-05-11.tar.gz`
- Manifest: `C:\Users\ydanz\OneDrive\Documents\Retired Source Archives\2026-05-11-rabbi-dashboard-retirement\ARCHIVE_MANIFEST.json`
- Restore rule: extract only into a temporary restore folder for historical reference; do not restart work at the old path.

The retired head folders were also moved out of the top-level Documents view:

`C:\Users\ydanz\OneDrive\Documents\Retired Source Archives\2026-05-11-retired-head-folders`

This includes the former `taskmanager app`, `Rabbi Dashboard`, `PC as Bluetooth call - text interface`, and `Shamash source clones` containers. `Shamash Pro 3 (Deprecated and scrambled or archived) unscramble control` remains top-level only as the central emergency descramble control folder. The old `Shamash Pro 3` path is a hidden redirect shell because Windows would not release the folder handle for direct rename.

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
