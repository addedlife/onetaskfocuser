# DeskPhone Agent Handbook

Read this file before making product changes in this repo.

## Operating Rule

- Build and ship one approved work item at a time unless the user explicitly asks for a bundled pass.
- Standing user approval for DeskPhone Web clone/parity work: when a slice is verified and ready, ship it through the normal release/deploy path instead of stopping at a local checkpoint.
- Every shipped change must go through the existing Release flow: detailed changelog entry, Release build, deploy script, rewindable git commit.
- Never bypass the durable latest/previous build shortcut workflow.
- Never auto-replace a running build. Use the existing handoff prompt flow.
- Leave the previous deployed build runnable at all times.

## Source Of Truth

- Start every session with `context-pack/README.md`, then check live git status and only open deeper files needed for the specific task.
- Product and UI rules: `docs/DeskPhone-Standards.md`
- Messaging and calling parity audit: `docs/Messaging-Calling-Feature-Gap-Audit-2026-04-23.md`
- Release and packaging rules: `docs/Release-Checklist.md`
- Before inventing or omitting basic communication-app behavior, benchmark against strong open-source desktop references whose visible interaction patterns are easy to inspect:
  - `signalapp/Signal-Desktop`
  - `element-hq/element-web` and desktop wrapper
  - `telegramdesktop/tdesktop`
  - `BelledonneCommunications/linphone-desktop`
  - `Jami`
- Use those products plus their public code, docs, and issue trackers to build the default expectation for obvious row actions, message actions, search behavior, callback flows, and list/detail interaction density.
- For messaging and calling surface work, use the parity audit above to turn those benchmarks into a concrete checklist before assuming a missing basic is optional.

## Non-Negotiable Product Rules

- The app must never overflow the active screen in normal windowed use.
- Layouts must reflow when width is constrained; do not rely on hard wide-window assumptions.
- Core information must stay visible without unnecessary toggling.
- Avoid noisy notifications. Do not notify the user about actions they directly initiated unless there is a clear failure or a background-only event.
- Bluetooth responsibilities stay separated by profile:
  - `HFP` for call control and call audio/session state
  - `MAP` for text/message sync and send
  - `PBAP` for contacts and phone call-history sync
- If behavior is meant to match “how cars do it,” check whether the requested feature belongs to `HFP`, `MAP`, or `PBAP` before implementing.

## Before Shipping

- Read the current approved item and keep scope tight.
- Update `changelog.json` with detailed `notes` and `devNotes`.
- Run a local build before Release if the change is non-trivial.
- Run `dotnet build .\\DeskPhone.csproj -c Release`.
- Confirm the deploy pipeline archived the new build, preserved the previous one, and created the release commit.
