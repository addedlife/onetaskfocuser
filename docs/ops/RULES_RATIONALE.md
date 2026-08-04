# Why the standing rules exist

`CLAUDE.md` states the rules in as few tokens as possible, because it is loaded into
every session whether it is needed or not. This file holds the reasoning, the incidents
behind each rule, and the detail that only matters once you are already working on that
area. **Read only the section you need.**

---

## Why "done" cannot mean flag-gated

`4.96.0` shipped with the subject line "48dp targets, 16sp rows" while the entire block
sat inside `if (NC_PROTO && …)` — an `?ncproto=1` opt-in that defaulted to off. Production
kept the 34px rows and 13.5px type the commit claimed to have fixed, for three more
releases, because the commit message read as if the fix were live.

Consequences encoded as rules:

- Fix at the **source**, not the call site. If a shared token or helper (`m3.jsx`
  `denseListVars`, `ui-tokens.jsx` `gvIconButton`) emits the wrong value, change it there.
  Patching one surface while the shared definition is still wrong fixes nothing app-wide.
- If a change genuinely must ship dark, say so in the commit body and in chat, and say
  what flips it on. Never let the subject line imply it is live.
- Verification claims must match what was actually verified. "So no control is left
  minuscule" is false when the check was scoped to one flag on one surface.

## Why "pushed" is not shipped

The incident, 8/2–8/4/26. A docs commit (`d5290840`) added the full Firestore resource
name to `MAP.md`, including a backticked `` `projects/` `` to mark where the name starts.
`check-map.cjs` treats any backticked token containing a slash as a claim that a file
exists on disk. It already exempted the short `users/...` doc-path form for exactly this
reason; the full form was simply not in the list. So a documentation commit hard-failed
the deploy workflow.

That failure was invisible from the repo. `git push` succeeded, `origin/main` had the
commits, and three sessions reported work as shipped. Two releases — 4.114.11
(NerveCenter pins) and 4.114.12 (Pen launcher) — sat on `main` for two days while the
live site served 4.114.10. The owner found it by reading the version string on reload.

Two rules come out of it:

- **Watch the run.** A push hands the work to CI; only CI makes it live. Not looking is
  the same mistake as shipping behind an off-by-default flag — the commit says done, the
  user gets nothing. `gh run watch` costs ~300 tokens and blocks ~2 minutes.
- **A red run blocks the next session too**, because the queue is serial: every commit
  behind the broken one is also unshipped. Fix it in the same turn.

Related failure worth remembering: the deploy gates (`map:check`, lint, GM3, build) run
in CI but only some of them are habitually run locally. `npm run map:check` is cheap and
belongs in the local gate whenever a commit touches `docs/ops/MAP.md`.

## Why the DeskPhone build gate is not optional

`deploy.ps1` hard-fails without a `changelog.json` entry for the upcoming build number:
`notes` must be user-facing and 24+ chars, `devNotes` technical and 48+ chars naming a
real root cause. Check `build.num` for the current value; the entry's `version` must be
`b<that number>`.

`dotnet build -c Release -p:Platform=ARM64` from `apps/phone-host-windows` triggers the
`DeployDesktop` MSBuild target, which runs `deploy.ps1`. That script archives the build
under `deployed-builds/b<N>`, publishes the launcher and UI auditor, updates the Desktop
"DeskPhone" / "DeskPhone Previous Build" shortcuts, creates its own `release(b<N>): …`
git commit scoped to the native paths, and — only if a DeskPhone instance is currently
running — POSTs a non-destructive update *offer* to it. Nothing is force-killed or
silently swapped. Push that release commit like any other verified fix.

Never run a bare `dotnet build` in that tree; build `DeskPhone.csproj` explicitly (RelayV2
is excluded from its globs). Still outside the automation: `DeskPhone.exe` is unsigned, and
the Android host has no release keystore. Both are open findings.

## Why there is a concurrent-session protocol

More than one session sometimes works this repo at once, sharing one working directory and
one `origin/main`. This has actually bitten: a session found `google-search.js` and
`brave-search.js` changing on disk, seconds old and not its own, during unrelated work.

Before substantial work, query the `coding-sessions` Firestore collection for
`status: "active"` docs; ignore any whose `lastPing` is over ~2 hours old. If a live
entry's `task`/`filesTouched` overlaps yours, say so and ask rather than proceeding.
Register your own: doc id `<YYYY-MM-DD>-<short-kebab-task-slug>`, fields
`{startedAt, lastPing, task, filesTouched, status}`. Set `status: "done"` when finished.

Before every push, run `git status`. Uncommitted changes to files you did not touch are a
live signal of another session — leave them alone and flag them.

This is advisory presence, not a lock. It only works once a session reads it.

## Why the GM3 ratchet is automated

The 2026-07-21 audit scored the web app **48% (275/600)** across eight dimensions, with
accessibility at 1.3/5 and layout at 1.6/5 — while the "use the right M3 component" rule
had been passing for months. Component conformance was never the whole standard.

`npm run gm3` counts violations and compares against `apps/web/.gm3-baseline.json`. The
count may fall freely; if it rises the command exits non-zero, and `deploy.yml` runs it
before the build, so a regression fails the deploy. `npm run gm3:update` re-snapshots.
**Every commit that removes violations must include a `gm3:update`**, or the gain is not
locked in and the number silently climbs back.

The rules are `no-restricted-syntax` selectors in `apps/web/.eslintrc.cjs`: literal font
sizes, hardcoded font stacks, literal corner radii, `transition: all`, hex colour
literals, and raw `<button>`/`<input>`/`<select>`/`<textarea>`. They are **warnings** —
1386 pre-existing violations would have broken the build on day one. The ratchet is what
gives them teeth. `ui-tokens.jsx` and `01-core.js` are exempt from the hex rule only; they
are the palette source of truth.

Runtime counterpart: open the app with `?uiaudit=1` and call `uiAudit.report()` or
`uiAudit.score()`. It measures what is actually drawn and flags anything below the M3
floor — 48dp touch targets, 12px minimum type.

### Two traps that made the old tooling report clean

1. ESLint 8 walks **up** from the working directory for an `eslint.config.js` and flips
   the whole run to flat-config mode if it finds one anywhere, including outside the repo.
   A stray Vite starter config at `C:\Users\<user>\eslint.config.js` did exactly that —
   `.eslintrc` was discarded and every file reported "no matching configuration", i.e.
   zero problems. Always go through `npm run lint` / `npm run gm3`, which pin
   `ESLINT_USE_FLAT_CONFIG=false`. Never trust a bare `npx eslint`.
2. The old lint script was `eslint src/*.js src/*.jsx` — top level only. Nothing under
   `src/08-app-split/`, which is most of the app, was ever linted.

## M3 components — the full component map

Every UI element in `apps/web/src/` must use the real `@material/web` component when one
exists. Pattern (see `AppSuiteChrome.jsx`):

```js
import { createComponent } from '@lit/react';
import { MdFilledButton } from '@material/web/button/filled-button.js';
const FilledButton = createComponent({ react: React, tagName: 'md-filled-button', elementClass: MdFilledButton });
```

| UI element | import path | tag |
|---|---|---|
| Primary action button | `button/filled-button.js` | `md-filled-button` |
| Secondary / tonal | `button/filled-tonal-button.js` | `md-filled-tonal-button` |
| Outlined | `button/outlined-button.js` | `md-outlined-button` |
| Text / ghost | `button/text-button.js` | `md-text-button` |
| Elevated | `button/elevated-button.js` | `md-elevated-button` |
| Icon button (standard/filled/outlined/tonal) | `iconbutton/…` | `md-icon-button`, `md-filled-icon-button`, `md-outlined-icon-button`, `md-filled-tonal-icon-button` |
| Filter chip | `chips/filter-chip.js` + `chips/chip-set.js` | `md-filter-chip`, `md-chip-set` |
| Assist / input / suggestion chip | `chips/…` | `md-assist-chip`, `md-input-chip`, `md-suggestion-chip` |
| Text input / search | `textfield/outlined-text-field.js` | `md-outlined-text-field` |
| Select | `select/outlined-select.js` | `md-outlined-select` |
| Checkbox / radio / switch | `checkbox/`, `radio/`, `switch/` | `md-checkbox`, `md-radio`, `md-switch` |
| List + rows | `list/list.js` + `list/list-item.js` | `md-list`, `md-list-item` |
| Dialog | `dialog/dialog.js` | `md-dialog` |
| Menu | `menu/menu.js` + `menu/menu-item.js` | `md-menu`, `md-menu-item` |
| FAB | `fab/fab.js` | `md-fab` |
| Progress | `progress/circular-progress.js`, `linear-progress.js` | `md-circular-progress`, `md-linear-progress` |
| Slider / divider / ripple | `slider/`, `divider/`, `ripple/` | `md-slider`, `md-divider`, `md-ripple` |
| Tabs | `tabs/tabs.js` + `tabs/primary-tab.js` | `md-tabs`, `md-primary-tab` |
| Badge / nav bar / card (labs) | `labs/…` | `md-badge`, `md-navigation-bar`, `md-card` |

### Bridge tokens — mandatory, already wired, never remove

`@material/web` renders in **shadow DOM**, which `.nc-suite-root` CSS cannot reach. Without
explicit bridge tokens every component ships in Times New Roman and M3-default purple.
The bridge lives in `ui-tokens.jsx` `:root`: `--md-ref-typeface-plain`/`-brand` → Segoe UI;
`--md-sys-color-primary`/`-on-primary` → teal / white; `--md-sys-color-outline` → app
divider grey; `--md-sys-color-on-surface`/`-surface`; `--md-sys-color-surface-variant`/
`-on-surface-variant`.

- Never remove an `--md-*` token from `ui-tokens.jsx`. They are load-bearing.
- When a component looks wrong, the fix is a bridge token, never an inline style on every
  usage site.
- Text-node children in M3 buttons and list items must be wrapped in `<span>` for reliable
  shadow-DOM slot pickup.
- `index.html`'s `* { padding: 0 }` reset zeroes `@material/web` button `:host` padding
  (oval blobs). The restore lives in `ui-tokens.jsx`. Chips and list items are unaffected
  because their padding is inner.
- Each extra `md-item` slot costs its own width **plus a hardcoded 16px gap**. Narrow rows
  are fixed by dropping slots, never by shrinking type.

### When no component exists

Hand-code using `ui-tokens.jsx` values only — `RADIUS`, `NC_TYPE`, `NC_FONT_STACK`, `SP`,
`ELEV`, `TRANSITION`. No magic numbers, no inline font strings, no raw `system-ui`.
Genuine gaps: priority circles, clock display, task-card hero, navigation rail, toast,
PostIt stack.

## Layout constraints that keep getting re-broken

- **NerveCenter** must fit one non-scrolling screen with all five cards visible and every
  list maxed. Counts and content-weighting are therefore useless levers; the problem is
  always *selection*, not allocation.
- **No emphasized first row.** The auto-prioritized hero row was deleted app-wide in
  4.106.0. It had recurred three times because earlier fixes only moved it. Never rebuild it.
- **Columns under 420px carry no per-row trailing control.** Calendar importance is the one
  exception. Two-line rows are 56px / 64px.
- The multi-column NerveCenter threshold is **1500px**. It was tried at 1000px in 4.103.0
  and reverted in 4.105.1 after squishing on Surface Laptop and iPad.

## Versioning detail

`apps/web/src/version.js` holds `APP_VERSION` and `APP_VERSION_DATE`. Real SemVer, each
level resetting everything below it. **major** is the product generation, set manually
("Shamash Pro 4" → `4`). `feat:` → `(major).(minor+1).0`. `fix:`/`style:` →
`(major).(minor).(patch+1)`.

Do not recompute from a `git log` grep — that was the old broken scheme, which drifted
because it counted every matching commit ever instead of resetting. Read the current
`APP_VERSION` and bump from there. Full history is in `CHANGELOG.md`.

## Cloud sessions and Firestore

A cloud session has no Firebase credential (the admin key is PC-only, `firestore.rules`
denies unauthenticated reads, the deployed `/mcp` endpoint needs a bearer token the session
cannot see). Sessions used to work the buglog from pasted text. That is no longer necessary.

`tools/firestore-bridge/` plus `.github/workflows/firestore-bridge.yml` run the MCP call
inside GitHub Actions, where `MCP_READ_TOKEN` exists, and return the answer encrypted to a
one-time key the session generates, so owner data never lands in a world-readable Actions
log. Full read and write: `list_bugs`, `add_bug_note`, `set_bug_status`, plus tasks,
shailos and meta. Three commands, in `tools/firestore-bridge/README.md`.

Dispatching the workflow needs `actions:write`, which a session's GitHub App may not hold
(`actions_run_trigger` → 403). In that case push `.bridge-request.json` to a `bridge/**`
branch, which every session can do; the runner commits the encrypted answer back to that
branch. Delete the branch afterwards.

Two MCP gotchas: `firestore_query_collection` has no project parameter and silently hits
`rabbi-s-metrics` — use `firestore_get_document` with the full
`projects/onetaskonly-app/...` path. And nested buglog note writes **do** work via MCP;
the old "arrayValue-of-mapValue always fails" note was a wrong diagnosis. Pass `document`
and `updateMask` as separate parameters.
