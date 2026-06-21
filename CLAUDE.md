# CLAUDE.md — standing instructions for every session

Claude Code loads this file automatically at the start of every session in this repo.
It is the durable home for owner preferences, so they survive across sessions instead of
being promised in chat and forgotten. Read `BRIEF.txt` and `AGENTS.md` too.

## Release policy (STANDING — do not skip)

**Always push live after a verified good fix.** The owner has standing authorization for this.

- After a fix or change is made AND verified (at minimum `npm run build` passes in `apps/web`;
  smoke-test the affected surface when feasible), commit it and **push straight to `origin/main`**.
  Netlify auto-builds production from `apps/web` via the root `netlify.toml`. Then confirm the
  pushed commit shows up on the live site.
- Do NOT leave a verified web fix sitting on a feature branch waiting for separate approval, and
  do NOT ask "should I push this live?" for a normal fix — the answer is yes. Push it.
- Exceptions that still require an explicit heads-up first: storage/sync refactors (see
  `HANDOFF.md` §9 — these can wipe live data), schema migrations, secret/permission changes, or
  anything that could be destructive or hard to reverse.

## Versioning (STANDING)

The app version is the single constant in `apps/web/src/version.js`, shown in the left rail.
**Bump it on every release** and update `APP_VERSION_DATE` to the release date.

Scheme (reproducible from git history):
- **major** = product generation — "Shamash **Pro 4**" → `4`.
- **minor** = number of feature releases: `git log --pretty=%s | grep -cE '^feat'`
- **patch** = number of fixes/tweaks: `git log --pretty=%s | grep -cE '^(fix|style)'`

After committing a `feat:`-prefixed change, bump minor; after a `fix:`/`style:` change, bump patch;
then push live per the release policy above.

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

### When NO component exists — fallback rule
If the element type has **no `@material/web` equivalent** (e.g. priority circles, clock display,
task card hero, navigation rail, toast/snackbar, PostIt stack), hand-code it — but **match M3
spec exactly** using the recipes in `src/08-app-split/m3-stylebook.jsx` and tokens from
`src/08-app-split/ui-tokens.jsx`. Zero improvisation: shape from `M3_SHAPE`, sizing from
`M3_SPEC`, spacing from `SP`, type from `NC_TYPE`, motion from `TRANSITION`.

### What this rule catches (things I must never do again)
- Writing a `<button style={{borderRadius: RADIUS.pill}}>` when `MdFilledButton` exists.
- Writing a `<span style={{...}}>` badge when `MdFilterChip` or `MdBadge` exists.
- Writing a custom dropdown/select when `MdOutlinedSelect` exists.
- Writing inline transition strings when `TRANSITION` from `ui-tokens.jsx` is the token.

### Quick check before writing any UI
1. Is the element type in the component map above? → use the `@material/web` component.
2. Not in the map? → use `m3-stylebook.jsx` recipes exactly, no improvising.
3. Writing a new file or editing an existing one? → check existing `createComponent` imports first
   (see `AppSuiteChrome.jsx`) and reuse the wrapper, don't re-import the same component twice.
