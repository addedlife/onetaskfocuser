# CLAUDE.md — standing instructions for every session

Claude Code loads this file automatically at the start of every session in this repo.
It is the durable home for owner preferences, so they survive across sessions instead of
being promised in chat and forgotten. Read `BRIEF.txt` and `AGENTS.md` too.

## How work is delivered (STANDING — no phases, no gates)

**The owner does not work in phases.** Never structure a body of work as "Phase 1 / Phase 2 /
Phase 3, approve each before the next." Do not ask permission to continue partway through.

- Produce **one ordered worklist**, hardest-blocking item first. Then work it top to bottom,
  steadily, without stopping to check in between items.
- **Push after every logical package point** — a coherent unit of work that builds and is
  verified, per the Release policy below. Not after every file, not once at the very end.
  A worklist of 12 items might be 4 or 5 pushes.
- The only legitimate stop is a genuine decision only the owner can make (a product tradeoff, a
  destructive/irreversible action, a blocked credential). Ask that question ONCE, up front,
  before starting — not as a mid-stream gate.
- Ordering rule: anything that **prevents regression** (lint, tests, enforcement tooling) goes
  near the FRONT of the list, not the end. Otherwise later items silently undo earlier ones.

### "Done" means done — no flag-gated completions

A fix hidden behind an opt-in flag, a URL parameter, or a `localStorage` key that defaults to
off is **not shipped**, and a commit message must never describe it as if it were. This has
actually happened: `4.96.0` was titled "48dp targets, 16sp rows" while the entire block sat
inside `if (NC_PROTO && …)` — an `?ncproto=1` opt-in, off by default — so production kept the
34px rows and 13.5px type the commit claimed to have fixed, for three more releases.

- Fix at the **source**, not the call site. If a shared token/helper (`m3.jsx` `denseListVars`,
  `ui-tokens.jsx` `gvIconButton`) is the thing that's wrong, change it there. Patching one
  surface while the shared definition still emits the bad value fixes nothing app-wide.
- If a change genuinely must ship dark, say so plainly in the commit body and in chat, and say
  what flips it on. Never let the subject line imply it's live.
- Verification claims must match what was actually verified. "So no control is left minuscule"
  is false when it's scoped to one flag on one surface.

## Release policy (STANDING — do not skip)

**Always push live after a verified good fix.** The owner has standing authorization for this.

- After a fix or change is made AND verified (at minimum `npm run build` passes in `apps/web`;
  smoke-test the affected surface when feasible), commit it and **push straight to `origin/main`**.
  **Firebase Hosting is the only live deploy target.** A push to `main` triggers
  `.github/workflows/deploy.yml`, which builds `apps/web` and runs
  `firebase deploy --only hosting,functions,firestore,database --project onetaskonly-app`
  (firestore/database rules deploy alongside hosting+functions as of 2026-07-15 — before that,
  rules-file edits were silently never reaching production through the normal push flow).
  Netlify is fully
  decommissioned — `netlify.toml` (root) and `apps/web/netlify.toml` are kept only as a labeled
  rollback path and do not build or serve anything; never describe Netlify as live, auto-building,
  or in any way part of the current deploy path. Then confirm the pushed commit shows up on the
  live Firebase-hosted site.
- Do NOT leave a verified web fix sitting on a feature branch waiting for separate approval, and
  do NOT ask "should I push this live?" for a normal fix — the answer is yes. Push it.
- This applies even when the session harness assigned you a `claude/...` working branch: develop
  there if required, but a verified fix ends with the commits ALSO on `origin/main` (merge or
  cherry-pick, then push). The owner has explicitly authorized this (2026-07-19) — the feature
  branch is a workspace, not the destination.
- The ONE hold: if the concurrent-session check below finds another ACTIVE coding session
  (live `coding-sessions` entry with a fresh `lastPing`, or uncommitted changes on disk that
  aren't yours) whose work overlaps, don't push over it — flag it to the owner and ask first.
  No Firebase tools in the session to run the check (some environments genuinely lack them)?
  The on-disk `git status` check still applies; if that's clean, push.
- Exceptions that still require an explicit heads-up first: storage/sync refactors (see
  `HANDOFF.md` §9 — these can wipe live data), schema migrations, secret/permission changes, or
  anything that could be destructive or hard to reverse.

## DeskPhone build gate (STANDING — do not skip, do not ask first)

**Any change under `apps/phone-host-windows/**` is not done until the build has actually run.**
This is fully scriptable on the owner's machine — there is no "ask the owner to build it later"
step, and no need to check first before running it.

- Before building: add/update a `changelog.json` entry for the upcoming build number (check
  `build.num` for the current value — deploy.ps1 reads that number, so the entry's `version`
  must be `b<that number>`). `notes` (user-facing, 24+ chars) and `devNotes` (technical, 48+
  chars, real root cause not a placeholder) are both hard-enforced by deploy.ps1 — it fails the
  build outright without them.
- Then run: `dotnet build -c Release -p:Platform=ARM64` from `apps/phone-host-windows`. The
  `DeployDesktop` MSBuild target fires automatically after a successful Release build and runs
  `deploy.ps1`, which: archives the build under `deployed-builds/b<N>`, publishes the launcher +
  UI auditor, updates the Desktop "DeskPhone"/"DeskPhone Previous Build" shortcuts, creates its
  own `release(b<N>): ...` git commit scoped to the native-app paths, and — only if a DeskPhone
  instance is currently running — POSTs a non-destructive update *offer* to it (the running
  instance decides whether to accept; nothing is force-killed or silently swapped).
- Push that release commit to `origin/main` same as any other verified fix (see Release policy
  above) — it's a normal commit, not a special case.
- The one thing still outside this automation: the produced `DeskPhone.exe` is unsigned
  (no Authenticode step exists yet in `deploy.ps1`) and the Android host's release build has no
  signing keystore configured either — both are flagged as open findings, not part of this gate.

## Concurrent coding session protocol (STANDING)

More than one Claude Code session sometimes works this repo at the same time (different
windows/devices, or the owner running one session while another is mid-task). They share one
working directory and one `origin/main` — a session can silently start editing a file another
session already has open, mid-edit, uncommitted (this has actually happened: one session found
`google-search.js`/`brave-search.js` changing on disk, seconds old and not its own, while doing
unrelated work). Firebase project `onetaskonly-app` already has a `coding-sessions` top-level
Firestore collection for this — reachable with the Firebase MCP tools you already have
(`firestore_query_collection` / `firestore_update_document` / `firestore_delete_document`), no
extra script or credential needed.

**Before starting substantial work** (more than a quick one-file fix):
1. Query `coding-sessions` for docs with `status: "active"`. Ignore any whose `lastPing` is
   more than ~2 hours old (an abandoned/crashed session, safe to ignore or overwrite).
2. If a live entry's `task`/`filesTouched` clearly overlaps what you're about to do, don't
   silently proceed — tell the user you found a concurrent session on related work and ask
   how to proceed.
3. Register your own entry: doc id = `<YYYY-MM-DD>-<short-kebab-task-slug>`, fields
   `{startedAt, lastPing, task: "one-line description", filesTouched: [...], status: "active"}`
   (all as plain ints/strings — `firestore_update_document` needs a `fields`/`updateMask` shape,
   same as writing a Bug Log note).
4. Update `lastPing`/`filesTouched` if the session runs long or the file set changes.

**Before every push:** run `git status`/`git diff` first. Uncommitted changes to files you
didn't touch this session are a live signal of a concurrent session — never stage, commit, or
overwrite them; leave them alone and flag it to the user rather than guessing.

**When you finish:** set your entry's `status` to `"done"` (or delete the doc) so it stops
reading as active for the next session.

This is intentionally lightweight — a presence/advisory system, not a hard lock. It only helps
once a session actually reads this file and follows it; it can't retroactively coordinate with
a session that started before this section existed.

## Open tickets — cheap read path (STANDING)

To find open bugs/ideas, do NOT dump the whole `users/rabbidanziger/bugs` collection.
Read the condensed mirror first — one small document:
`firestore_get_document` on `users/rabbidanziger/meta/openTickets`
(`items`: non-resolved tickets, newest first, each `{id, type, status, summary, createdAtMs}`).
Only fetch an individual `bugs/{id}` doc when you need the full text/history of a specific
ticket. The mirror is rebuilt by the web app on every bug add/status-change/delete
(`Store._syncOpenTickets` in `apps/web/src/01-core.js`).

## Buglog re-check before ending (STANDING)

The owner adds bugs WHILE sessions run. The buglog is a live queue, not a snapshot:
- **Before ending any session that did buglog work** (a sweep, a ticket fix, or anything the
  owner might file follow-up bugs about), re-read `users/rabbidanziger/meta/openTickets` and
  handle or at least triage any entry newer than your session start. Don't declare a sweep
  complete off the copy you pulled an hour ago.
- On **long sessions**, re-check at natural pauses (e.g. while a build runs) too.
- The mirror rebuilds only on app-side changes, so it can be stale in BOTH directions:
  it may list tickets you already resolved by direct Firestore write (rebuilds on the
  owner's next add/change), and a fresh owner add rebuilds it from live data mid-session.
  Compare `createdAtMs` against your session start to spot genuinely new entries.

## Versioning (STANDING)

The app version is the single constant in `apps/web/src/version.js`, shown in the left rail.
**Bump it on every release** and update `APP_VERSION_DATE` to the release date.

Real SemVer (`major.minor.patch`) — each level resets everything below it:
- **major** = product generation, set manually — "Shamash **Pro 4**" → `4`. Only changes when
  the owner explicitly declares a new generation. Resets minor and patch to 0 when it changes.
- **minor** = feature releases since the last major bump. A `feat:` release increments minor
  and **resets patch to 0**.
- **patch** = fix/polish releases since the last minor bump. A `fix:`/`style:` release
  increments patch only.

Do not recompute from a full `git log` grep — that was the old (broken) scheme and it drifts,
because it counts every matching commit ever instead of resetting. Just look at the current
`APP_VERSION` and bump from there: `feat:` → `(major).(minor+1).0`; `fix:`/`style:` →
`(major).(minor).(patch+1)`. Then push live per the release policy above.

Full reconstructed version history (back through the pre-Pro-4 era) lives in
[`CHANGELOG.md`](CHANGELOG.md).

## GM3 conformance — the ratchet (STANDING)

The M3 component rule below covers COMPONENTS ONLY. It passed for months while the
app failed Material 3 on layout, type scale, touch targets, motion and state layers —
the 2026-07-21 audit scored the web app **48% (275/600)** across all eight dimensions,
with accessibility at 1.3/5 and layout at 1.6/5. The full standard is now GM3, not
"use the right component."

**Enforcement is automated. Do not hand-audit this again.**

- `npm run gm3` counts every GM3 lint violation and compares it to
  `apps/web/.gm3-baseline.json`. The count may go DOWN freely; if it goes UP the
  command exits non-zero. It runs in `.github/workflows/deploy.yml` before the
  build, so a regression fails the deploy.
- `npm run gm3:update` re-snapshots the baseline. **Every worklist item that
  removes violations must end with a `gm3:update` in the same commit** — otherwise
  the gain isn't locked in and the number can silently climb back.
- The rules live in `apps/web/.eslintrc.cjs` as `no-restricted-syntax` selectors:
  literal font sizes, hardcoded font stacks, literal corner radii, `transition:
  all`, hex colour literals, and raw `<button>`/`<input>`/`<select>`/`<textarea>`.
  They are **warnings**, not errors — 1386 pre-existing violations would break the
  build on day one. The ratchet is what gives them teeth.
- `ui-tokens.jsx` and `01-core.js` are exempt from the hex-colour rule only. They
  are the palette source of truth; everything else must reference them.
- Runtime counterpart: open the app with `?uiaudit=1` and call `uiAudit.report()`
  (or `uiAudit.score()`). It measures what is ACTUALLY drawn and flags anything
  below the M3 floor — 48dp touch targets, 12px minimum type.

**Two environment traps that made the old tooling silently report clean:**

1. ESLint 8 walks UP from the working directory for an `eslint.config.js` and flips
   the whole run to flat-config mode if it finds one **anywhere, including outside
   the repo**. A stray Vite starter config at `C:\Users\<user>\eslint.config.js`
   did exactly that — `.eslintrc` was discarded and every source file reported "no
   matching configuration", i.e. zero problems. Always go through `npm run lint` /
   `npm run gm3`, which pin `ESLINT_USE_FLAT_CONFIG=false`. Never invoke `npx
   eslint` bare and trust the result.
2. The old lint script was `eslint src/*.js src/*.jsx` — top level only. Nothing
   under `src/08-app-split/`, which is most of the app, was ever linted.

## M3 component rule (STANDING — hard constraint, no exceptions)

**Every UI element in `apps/web/src/` must use the real `@material/web` npm component when one
exists. Never hand-code a lookalike. Never improvise styling for a covered element.**

### How to use them (established pattern — follow `AppSuiteChrome.jsx` exactly)
```js
import { createComponent } from '@lit/react';
import { MdFilledButton } from '@material/web/button/filled-button.js';
const FilledButton = createComponent({ react: React, tagName: 'md-filled-button', elementClass: MdFilledButton });
// then: <FilledButton onClick={...}>Label</FilledButton>
```

### Component map — what to reach for first

| UI element | `@material/web` import path | React tag |
|---|---|---|
| Primary action button | `button/filled-button.js` → `MdFilledButton` | `md-filled-button` |
| Secondary / tonal button | `button/filled-tonal-button.js` → `MdFilledTonalButton` | `md-filled-tonal-button` |
| Outlined button | `button/outlined-button.js` → `MdOutlinedButton` | `md-outlined-button` |
| Text / ghost button | `button/text-button.js` → `MdTextButton` | `md-text-button` |
| Elevated button | `button/elevated-button.js` → `MdElevatedButton` | `md-elevated-button` |
| Icon-only button (standard) | `iconbutton/icon-button.js` → `MdIconButton` | `md-icon-button` |
| Icon-only button (filled) | `iconbutton/filled-icon-button.js` → `MdFilledIconButton` | `md-filled-icon-button` |
| Icon-only button (outlined) | `iconbutton/outlined-icon-button.js` → `MdOutlinedIconButton` | `md-outlined-icon-button` |
| Icon-only button (tonal) | `iconbutton/filled-tonal-icon-button.js` → `MdFilledTonalIconButton` | `md-filled-tonal-icon-button` |
| Filter chip (All/Unread/Missed…) | `chips/filter-chip.js` + `chips/chip-set.js` | `md-filter-chip`, `md-chip-set` |
| Assist chip | `chips/assist-chip.js` | `md-assist-chip` |
| Input chip | `chips/input-chip.js` | `md-input-chip` |
| Suggestion chip | `chips/suggestion-chip.js` | `md-suggestion-chip` |
| Text input / search | `textfield/outlined-text-field.js` or `textfield/filled-text-field.js` | `md-outlined-text-field`, `md-filled-text-field` |
| Select / dropdown | `select/outlined-select.js` or `select/filled-select.js` | `md-outlined-select`, `md-filled-select` |
| Checkbox | `checkbox/checkbox.js` → `MdCheckbox` | `md-checkbox` |
| Radio | `radio/radio.js` → `MdRadio` | `md-radio` |
| Switch / toggle | `switch/switch.js` → `MdSwitch` | `md-switch` |
| List + rows | `list/list.js` + `list/list-item.js` | `md-list`, `md-list-item` |
| Dialog / modal | `dialog/dialog.js` → `MdDialog` | `md-dialog` |
| Menu + items | `menu/menu.js` + `menu/menu-item.js` | `md-menu`, `md-menu-item` |
| FAB | `fab/fab.js` → `MdFab` | `md-fab` |
| Progress (circular) | `progress/circular-progress.js` | `md-circular-progress` |
| Progress (linear) | `progress/linear-progress.js` | `md-linear-progress` |
| Slider | `slider/slider.js` → `MdSlider` | `md-slider` |
| Divider | `divider/divider.js` → `MdDivider` | `md-divider` |
| Ripple effect | `ripple/ripple.js` → `MdRipple` | `md-ripple` |
| Tabs | `tabs/tabs.js` + `tabs/primary-tab.js` | `md-tabs`, `md-primary-tab` |
| Badge (labs) | `labs/badge/badge.js` | `md-badge` |
| Navigation bar (labs) | `labs/navigationbar/...` | `md-navigation-bar` |
| Card (labs) | `labs/card/...` | `md-card` |

### M3 bridge tokens — MANDATORY, already wired, never remove (STANDING)

`@material/web` components render in **shadow DOM**. The app's `.nc-suite-root` CSS rules cannot
reach inside shadow DOM. Without explicit bridge tokens, every M3 component ships with Times New
Roman and M3-default purple — visually broken.

**The bridge is already live** in `src/08-app-split/ui-tokens.jsx` `:root`:
```
--md-ref-typeface-plain / --md-ref-typeface-brand  → Segoe UI (app font)
--md-sys-color-primary / --md-sys-color-on-primary  → teal accent / white
--md-sys-color-outline                              → app divider gray
--md-sys-color-on-surface / --md-sys-color-surface  → app text / bg
--md-sys-color-surface-variant / -on-surface-variant → bg-soft / muted
```

**Rules:**
- **Never remove** any `--md-*` token from `ui-tokens.jsx`. They are load-bearing.
- **Before shipping** any new `@material/web` component type, verify its visual tokens
  (font, color, outline) resolve correctly in the browser — not just that the build passes.
- **When a component looks wrong** (wrong font, wrong color), the fix is always a bridge token
  in `ui-tokens.jsx` `:root`, never an inline `style` hack on every usage site.
- **Text node children** in M3 buttons/list items must be wrapped in `<span>` for reliable
  shadow DOM slot pickup: `<FilledButton><span>Save</span></FilledButton>`.

### When NO component exists — fallback rule
If the element type has **no `@material/web` equivalent** (e.g. priority circles, clock display,
task card hero, navigation rail, toast/snackbar, PostIt stack), hand-code it using
`src/08-app-split/ui-tokens.jsx` tokens only:
`RADIUS` · `NC_TYPE` · `NC_FONT_STACK` · `SP` · `ELEV` · `TRANSITION`
Zero improvisation: no magic numbers, no inline font strings, no raw `system-ui`.

### What this rule catches (things I must never do again)
- Writing a `<button style={{borderRadius: RADIUS.pill}}>` when `MdFilledButton` exists.
- Writing a `<span style={{...}}>` badge when `MdFilterChip` or `MdBadge` exists.
- Writing a custom dropdown/select when `MdOutlinedSelect` exists.
- Shipping M3 components without verifying fonts/colors in the browser (bridge tokens required).
- Putting text node children directly in M3 buttons without a `<span>` wrapper.

### Quick check before writing any UI
1. Is the element type in the component map above? → use the `@material/web` component.
2. Not in the map? → hand-code with `ui-tokens.jsx` values only, no improvising.
3. New `createComponent` wrapper? → check existing wrappers in the same file first; don't
   re-import the same component twice (see `AppSuiteChrome.jsx` for the pattern).
4. After adding any M3 component: open the browser and confirm font is Segoe UI and colors
   match the theme. If not, add/fix the bridge token in `ui-tokens.jsx` — not inline styles.
