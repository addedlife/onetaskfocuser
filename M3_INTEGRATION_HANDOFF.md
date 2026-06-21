# M3 Integration Handoff — completing the full Material 3 adoption

**Status:** Foundation shipped. Component migration **not started**.
**Baseline:** `v4.26.95`, commit `4e3e60d` (2026-06-21).
**Owner audience:** the next coding session. Read this top-to-bottom before touching UI.
**Companion docs:** `CLAUDE.md` (M3 hard rules), `TOKENIZATION_HANDOFF.md` (size/shape tokens), `docs/ops/VERIFICATION_LOG.md`, the `m3-stylebook` + `tokenization-phase2` memories.

---

## 1. TL;DR

The **color/shape token layer is done and live**: every Material 3 design token
(`--md-sys-color-*`, `--md-sys-shape-corner-*`, `--md-ref-typeface-*`) now exists on
all three surfaces (web suite, Shailos, DeskPhone web) and follows the active theme in
real time. Any `@material/web` component you drop in will be themed correctly with no
extra wiring.

**What's left** is the larger, gradual job the `CLAUDE.md` M3 rule actually mandates:
**replace the hand-coded UI lookalikes with the real `@material/web` components**, and
delete the bespoke styling they're standing in for. That's ~932 `C.*` color usages and
many hand-built buttons/chips/lists/dialogs across 11 files. This doc is the plan for
doing that safely, component by component, without breaking the eight curated themes.

**Definition of done:** every element type that has an `@material/web` equivalent (per
the `CLAUDE.md` component map) is that component; only genuinely component-less elements
(priority circles, clock, nav rail, toast, PostIt stack, task-card hero) remain
hand-coded — and those use `ui-tokens.jsx` values, not magic numbers.

---

## 2. What the foundation gives you (already shipped)

| Surface | Reactive base layer | M3 bridge lives in | Theme-switch hook |
|---|---|---|---|
| Web suite (`apps/web`) | `--shp-color-*` | `ui-tokens.jsx` `NC_GLOBAL_CSS :root` | `themeVarsCss(T)` rendered as `<style>` after `NC_GLOBAL_CSS` in `App.jsx` |
| DeskPhone web (`10-deskphone-web.jsx`) | `--dp-*` (contrast-corrected by `buildDeskPhoneWebVars`) | the static `.dp-web-root` rule | `--dp-*` are set inline on `.dp-web-root` from `buildDeskPhoneWebVars(T)` |
| Shailos (`apps/shailos`) | `--ot-*` | `src/index.css :root` | `--ot-*` written at runtime in `App.tsx` from `onetask_theme` |

**The pattern is identical everywhere:** M3 roles point at the surface's own reactive
token layer; container/variant tones derive with `color-mix(in srgb, surface, on-surface N%)`
so they auto-adapt to light **and** dark (the mix target flips with the theme). Every
target runtime is Chromium/WebView2, so `color-mix()` is safe.

**Full role set now available** (use these freely — they all resolve to theme colors):

```
primary / on-primary / primary-container / on-primary-container
secondary / on-secondary / secondary-container / on-secondary-container
tertiary / on-tertiary / tertiary-container / on-tertiary-container
error / on-error / error-container / on-error-container
background / on-background
surface / on-surface / surface-variant / on-surface-variant
surface-dim / surface-bright
surface-container-lowest / -low / (base) / -high / -highest
outline / outline-variant
inverse-surface / inverse-on-surface / inverse-primary
shadow / scrim / surface-tint
shape: --md-sys-shape-corner-{none,extra-small,small,medium,large,extra-large,full}
```

> **Known simplification to revisit:** `secondary` and `tertiary` currently *mirror*
> `primary`, because the eight themes in `SCHEMES` only define one accent. If the owner
> wants distinct secondary/tertiary hues, that's a `SCHEMES` change (add `secondary`/
> `tertiary` keys) plus updating `themeVarsCss` + the three `:root` bridges. Low effort,
> isolated.

---

## 3. The hard rules (from `CLAUDE.md` — non-negotiable)

1. **If an `@material/web` component exists for an element, use it.** Never hand-code a
   lookalike. The component map is in `CLAUDE.md` ("Component map — what to reach for first").
2. **Use the established wrapper pattern** (`@lit/react` `createComponent`). Copy the
   exact style in `AppSuiteChrome.jsx`. Don't re-import the same component twice in a file.
3. **Wrap text-node children in `<span>`** inside M3 buttons/list items for reliable
   shadow-DOM slot pickup: `<FilledButton><span>Save</span></FilledButton>`.
4. **When a component looks wrong, fix the bridge token** in `ui-tokens.jsx` `:root` —
   never an inline `style` hack on the usage site.
5. **Never remove a `--md-*` token.** They are load-bearing.
6. **Verify in the browser, not just the build.** A passing build proves nothing about
   shadow-DOM color/font resolution. See §7.
7. **No component? Hand-code with `ui-tokens.jsx` tokens only** — `RADIUS`, `NC_TYPE`,
   `NC_FONT_STACK`, `SP`, `ELEV`, `TRANSITION`. Zero magic numbers, zero inline font strings.

---

## 4. The one catch that will bite you: math needs real hex

Some colors are fed into JavaScript that does arithmetic on the hex digits and **cannot**
take a `var(--md-sys-color-*)` string:

- `hexToRgba`, `pBg`, `_lum`, `textOnColor`/`priText` (`01-core.js`)
- `dpMixHex`, `dpLum`, `deskPhoneContrastRatio`, the `dpReadable*` family (`10-deskphone-web.jsx`)

These power **per-priority accents, dynamic tints, glows, and contrast auto-correction**.
They must keep receiving raw hex from the theme object (`T`, `pris[].color`, etc.).

**Rule of thumb:** *structural* colors (surface, text, outline, fills, hovers) →
migrate to M3 components / tokens. *Computed* colors (priority dot tints, glow rings,
contrast-picked text) → leave as live hex math. Don't try to tokenize the math inputs.

---

## 5. Where the hand-coded UI is (migration inventory)

`C.*` is `cleanTheme(T)` — the local color object threaded through components. Its
density is a good proxy for "how much bespoke styling lives here":

| File | `C.*` refs | Notes |
|---|---:|---|
| `08-app-split/components/NerveCenterPanel.jsx` | 353 | The big one. Tasks/Shailos/Phone cards, rows, headers, chips. |
| `08-app-split/App.jsx` | 279 | Shell, overlays, modals, queue, settings glue. |
| `08-app-split/components/HealthPage.jsx` | 76 | Standalone-ish page. |
| `08-app-split/components/NerveCenterPhoneSurface.jsx` | 65 | Phone surface. |
| `08-app-split/components/ConvCapture.jsx` | 58 | Recording/transcription review. |
| `08-app-split/components/DeskPhoneMiniDock.jsx` | 22 | |
| `08-app-split/components/AppSuiteChrome.jsx` | 21 | **Reference file** — already uses `createComponent`. |
| `08-app-split/components/SuitePanels.jsx` | 19 | |
| `08-app-split/components/HealthCard.jsx` | 16 | |
| `08-app-split/components/TaskRiverPanel.jsx` | 13 | River lane palette — mostly computed, low priority. |
| `08-app-split/ui-tokens.jsx` | 10 | Helpers (`gvIconButton`, etc.) — migrate the helpers, callers follow. |

Separately, `10-deskphone-web.jsx` styles via **CSS classes + a `styles` object**, not
`C.*` — so static grep undercounts it. Use the runtime drift logger (§7) there.

**Already on `@material/web`** (22 usages across 5 files): `04-components.jsx`,
`App.jsx`, `m3-stylebook.jsx`, `ui-tokens.jsx`, `AppSuiteChrome.jsx`. 14 `md-*` elements
render on the NerveCenter page today. Study these before adding more.

---

## 6. Migration strategy — phased, lowest-risk-first

Migrate **by element type, not by file** — convert one component type everywhere it
appears, verify across all 8 themes, ship, repeat. This keeps each PR small, each diff
reviewable, and each `git revert` clean.

Suggested order (risk/effort ascending, value descending):

**Phase A — buttons & icon buttons.** Highest count, lowest risk, biggest consistency
win. Replace hand-built `<button style={…}>` and `gvIconButton`/`gvTextButton`/
`cleanToolbarButton` helpers with `MdFilledButton` / `MdTextButton` / `MdOutlinedButton`
/ `MdIconButton`. Start by rewriting the *helpers* in `ui-tokens.jsx` to render M3
components (or deprecate them), so call sites convert in bulk.
Acceptance: every clickable affordance is an `md-*` button; focus rings, ripples, and
disabled states come from M3, not custom CSS.

**Phase B — chips.** Filter chips (All/Unread/Missed, priority filters) → `MdFilterChip`
+ `MdChipSet`. Assist/input/suggestion chips per the map. Badges → `md-badge` (labs).

**Phase C — text fields & selects.** Search inputs, compose fields, settings dropdowns →
`MdOutlinedTextField` / `MdOutlinedSelect`. This is where the DeskPhone "two searches,
three corner values" drift (documented in the `m3-stylebook` memory) finally dies.

**Phase D — lists & list items.** Task rows, message rows, call history, queue →
`MdList` + `MdListItem`. Watch row density: M3 list items are tall; you may need M3
density tokens or a hand-tuned wrapper. Verify against the compact/comfortable settings.

**Phase E — dialogs, menus, tabs, switches, checkboxes, sliders, progress.** Modals →
`MdDialog`; overflow menus → `MdMenu`; settings toggles → `MdSwitch`/`MdCheckbox`/
`MdRadio`; the "Updating…" spinners → `md-circular-progress`; section tabs → `md-tabs`.

**Phase F — DeskPhone web internal unification.** Convert `10-deskphone-web.jsx`'s
class-based controls to the same M3 components. The M3 bridge is already present on
`.dp-web-root`, so components will theme correctly. Use `?uistyle=1` (§7) to find the
remaining divergences first.

**Phase G — Shailos.** Shailos is React + Tailwind with **no `@material/web` yet**.
Decide with the owner whether Shailos adopts `@material/web` (add the dep + `@lit/react`,
then migrate its buttons/inputs) or stays Tailwind-with-M3-tokens. The token bridge is
already in place either way. Lower priority — it's a smaller surface.

**Never in scope:** priority circles, the clock display, the navigation rail, toasts/
snackbars, the PostIt stack, the task-card hero. These have no M3 equivalent — keep them
hand-coded on `ui-tokens.jsx` values.

---

## 7. Verification & QA protocol (do this every phase)

**Build gates** (must be 0 errors):
- `npm --prefix apps/web run build`
- `npm --prefix apps/shailos run build`
- `dotnet build` in `apps/phone-host-windows` (only if you touch the native host)

**Runtime — the part the build can't check:**

1. Start the dev server: `preview_start` → config `shamash-web` (port 5178, in
   `.claude/launch.json`).
2. **Drift logger** — open with `?uiaudit=1`, interact, then `uiAudit.report()` in the
   console. Lists every local style that diverges from the `M3_SPEC` master in
   `m3-stylebook.jsx`. Use it to find what still needs converting (especially in
   DeskPhone web, where static grep misses class-based styles).
3. **Runtime enforcer** — open with `?uistyle=1` to force every classified element to the
   master spec at runtime (no source edits, reload to revert). Good for previewing "what
   would it look like if this were consistent" before committing the real change.
4. **Token resolution probe** — confirm no role resolves to invalid/transparent. Paste in
   the console:
   ```js
   (() => { const p=document.createElement('div'); document.body.appendChild(p);
     const t=v=>{p.style.backgroundColor='';p.style.backgroundColor=`var(${v})`;return getComputedStyle(p).backgroundColor;};
     const r=['--md-sys-color-primary','--md-sys-color-surface-container-high','--md-sys-color-error-container','--md-sys-color-outline-variant','--md-sys-color-inverse-primary'];
     const o={}; r.forEach(x=>o[x]=t(x)); p.remove(); return o; })()
   ```
   `rgba(0, 0, 0, 0)` for any role = a broken `color-mix`/`var` chain. A real color = good.
5. **Theme matrix — eyeball all 8 themes.** This is mandatory; color regressions only
   show per-theme. Switch via Settings, or set `localStorage` key `onetaskonly_v4_devtest`
   `.colorScheme` and reload. The eight: `googleVoice`, `material`, `materialDark`,
   `claude`, `navyGold`, `ocean`, `sage`, `obsidian`. Pay special attention to the dark
   ones (`materialDark`, `navyGold`, `obsidian`) and the three that define **no** accent
   (`ocean`, `sage`, `obsidian` — they fall back to googleVoice teal).
6. **Accessibility** — verify text/background contrast ≥ 4.5:1 on the surfaces you
   touched, every theme. DeskPhone already auto-corrects via `dpReadable*`; the web suite
   does not, so check manually.
7. **DeskPhone standalone** — smoke `/?standalone=deskphone`; if the native host
   (`127.0.0.1:8765`) isn't running it falls back to defaults, which is fine for layout/
   token checks.

**Restore any localStorage/theme you changed for testing before you finish.**

---

## 8. Release process (per `CLAUDE.md` + `AGENTS.md`)

1. Bump `apps/web/src/version.js` — `feat:` → minor, `fix:`/`style:` → patch.
   (`minor = git log --pretty=%s | grep -cE '^feat'`; `patch = … grep -cE '^(fix|style)'`.)
2. Record the change in `docs/ops/VERIFICATION_LOG.md` with the gates you ran.
3. Commit; **push straight to `origin/main`** (standing authorization — don't ask for
   normal verified UI changes). The `Deploy to Firebase` GitHub Action builds `apps/web`
   and runs `firebase deploy --only hosting,functions`.
4. Confirm the Action is green (`gh run list --limit 1`) and the change is live at
   `https://onetaskonly-app.firebaseapp.com`.
5. **Exceptions that need an explicit heads-up first** (do NOT auto-push): storage/sync
   refactors (`HANDOFF.md` §9), schema migrations, secret/permission changes. None of the
   M3 component work should touch these — if a phase does, stop and flag it.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| M3 list items / buttons are taller than the current dense rows | Verify against compact/comfortable settings; use M3 density where available or a tuned wrapper; don't ship if it costs visible rows. |
| Converting a color that feeds hex math (§4) | Leave computed colors as live hex; only migrate structural colors. |
| A theme regresses (esp. dark / accent-less themes) | The 8-theme eyeball matrix in §7 is mandatory every phase. |
| Shadow-DOM font/color not resolving | It's always a missing/incorrect bridge token in `ui-tokens.jsx` — fix there, never inline. |
| Big-bang refactor breaks everything | Migrate one element type per PR; keep diffs small and `git revert`-able. |
| DeskPhone class-based drift invisible to grep | Use `?uiaudit=1` / `?uistyle=1` at runtime. |

---

## 10. Quick-start for the next session

1. Read: this file, `CLAUDE.md` (component map + rules), `AppSuiteChrome.jsx` (the
   `createComponent` reference), `m3-stylebook.jsx` (`M3_SPEC` master).
2. `preview_start` → `shamash-web`. Open `?uiaudit=1`, run `uiAudit.report()` to see the
   current divergence list.
3. Pick **Phase A (buttons)**. Rewrite/deprecate the button helpers in `ui-tokens.jsx`
   first, then convert call sites in `NerveCenterPanel.jsx`.
4. Verify with §7 (probe + 8-theme matrix), build both apps, bump version, log, push.
5. Repeat per phase. One element type at a time.

> The whole point of the foundation: you should be able to add a themed `@material/web`
> component now with **zero** color/shape wiring. If a component looks wrong, it's a
> bridge-token gap in `ui-tokens.jsx` — not a reason to hand-roll CSS.
