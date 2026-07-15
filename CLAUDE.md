# CLAUDE.md — standing instructions for every session

Claude Code loads this file automatically at the start of every session in this repo.
It is the durable home for owner preferences, so they survive across sessions instead of
being promised in chat and forgotten. Read `BRIEF.txt` and `AGENTS.md` too.

## Release policy (STANDING — do not skip)

**Always push live after a verified good fix.** The owner has standing authorization for this.

- After a fix or change is made AND verified (at minimum `npm run build` passes in `apps/web`;
  smoke-test the affected surface when feasible), commit it and **push straight to `origin/main`**.
  **Firebase Hosting is the only live deploy target.** A push to `main` triggers
  `.github/workflows/deploy.yml`, which builds `apps/web` and runs
  `firebase deploy --only hosting,functions --project onetaskonly-app`. Netlify is fully
  decommissioned — `netlify.toml` (root) and `apps/web/netlify.toml` are kept only as a labeled
  rollback path and do not build or serve anything; never describe Netlify as live, auto-building,
  or in any way part of the current deploy path. Then confirm the pushed commit shows up on the
  live Firebase-hosted site.
- Do NOT leave a verified web fix sitting on a feature branch waiting for separate approval, and
  do NOT ask "should I push this live?" for a normal fix — the answer is yes. Push it.
- Exceptions that still require an explicit heads-up first: storage/sync refactors (see
  `HANDOFF.md` §9 — these can wipe live data), schema migrations, secret/permission changes, or
  anything that could be destructive or hard to reverse.

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
