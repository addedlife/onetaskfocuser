# DeskPhone Web Exact Parity Rules

## Decision

The polished DeskPhone Web page is a prototype, not the final clone.

No further DeskPhone Web mimic work should proceed from memory, taste, or screenshot-only judgment. The web page must be rebuilt from the native DeskPhone parity inventory.

## Required Source Of Truth

Use these generated files before changing the web phone page:

- `docs/deskphone-parity/deskphone-static-inventory.json`
- `docs/deskphone-parity/deskphone-ui-elements.csv`
- `docs/deskphone-parity/deskphone-web-parity-map.csv`
- `docs/deskphone-parity/DESKPHONE_EXACT_PARITY_INVENTORY.md`

The inventory is generated from:

- Native DeskPhone XAML screens, styles, skins, palettes, and templates.
- Native DeskPhone ViewModel command declarations and command wiring.
- Native DeskPhone C# methods in the non-scratch app source.
- Native DeskPhone loopback host API endpoints.

## Acceptance Gate

Every inventory row that affects user experience must be assigned one of these states before implementation:

- `implemented-web`: present in DeskPhone Web with matching behavior or a documented browser equivalent.
- `host-api-needed`: visible in DeskPhone Web but blocked until the Windows host app exposes the command.
- `native-only`: intentionally kept in native DeskPhone with a written reason.
- `not-yet-reviewed`: not approved for implementation.

The default state is `not-yet-reviewed`.

## What Counts As An Element

Parity includes more than buttons. It includes:

- Frame structure, pane order, vertical vs horizontal layout, widths, heights, minimum widths, margins, padding, borders, corner radius, scroll behavior, and responsive breakpoints.
- Navigation rail states, collapsed rail states, prompts, banners, overlays, empty states, selected states, unread states, pinned/muted/blocked states, disabled states, hover/focus states, and error states.
- Every button, icon button, menu item, text field, search box, filter, toggle, command, tooltip, context menu, list row, message bubble, attachment row, call row, contact editor row, settings section, developer tool, and log surface.
- Plumbing dependencies: MAP messages, HFP calls, PBAP contacts and call logs, per-phone storage, read/unread sync, delete/undo behavior, contact sync, theme sync, audio routing, build handoff, launcher behavior, and host API support.

## Process

1. Regenerate the inventory from native DeskPhone after any native DeskPhone change.
2. Review the generated action map in `deskphone-web-parity-map.csv`.
3. Assign each row a web parity state.
4. Expand the Windows host API only where a web-visible native command needs plumbing.
5. Implement the web page in small reviewed slices.
6. Verify with production build, desktop screenshot, mobile screenshot, and route interaction smoke test.

## Current Status

The current DeskPhone Web page should be treated as a visual prototype. It may remain deployed, but it is not the exact-parity endpoint.

The next engineering stage is inventory review and mapping, not another visual redesign pass.
