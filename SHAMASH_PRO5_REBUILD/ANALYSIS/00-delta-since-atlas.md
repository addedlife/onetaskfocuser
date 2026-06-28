# DELTA SINCE ATLAS — what APP_ATLAS.md & APP_FEATURE_MAP.md miss

> **Why this file exists.** `APP_ATLAS.md` and `APP_FEATURE_MAP.md` were both written in
> a single commit — **`50e5707`** ("style: M3 audit pass — Focus App section 2") — and have
> **never been updated since**. The app is now ~22 commits ahead (version `4.23.92` → `4.29.103`).
> This file records everything that changed in `50e5707..HEAD` so the Pro 5 rebuild is faithful
> to the **current** app, not the stale snapshot. Read this alongside the Atlas, not instead of it.
>
> Re-derive at any time:
> `git log --oneline 50e5707..HEAD` · `git diff --stat 50e5707..HEAD -- apps/`

## Scope of the gap
- **22 commits**, **16 files**, **+1,260 / −690** lines. Two themes dominate:
  **(A)** a genuine-`@material/web` component migration, and
  **(B)** a NerveCenter calendar overhaul. Plus a cross-app accent-derivation system.

---

## A. The M3 component migration (ARCHITECTURALLY decisive for Pro 5)

Pro 4 has **already largely executed** the "use genuine Google M3 components" goal that Pro 5
is meant to embody. **The current Pro 4 code is now the better reference than the Atlas.**
Pro 5 should re-implement this same architecture cleanly (not copy), because it is proven and
matches the M3 mandate exactly.

### A1. NEW FILE — `apps/web/src/08-app-split/m3.jsx` (160 lines, NOT in Atlas)
The single shared home for all `@material/web` React wrappers. Pattern: `@lit/react`'s
`createComponent({ react, tagName, elementClass })`, wrapped **once** per element (no per-file
re-wrapping). Exports:
- **Buttons:** `FilledButton`, `TonalButton`, `OutlinedButton`, `TextButton`
- **Icon buttons:** `IconButton`, `FilledIconButton`, `TonalIconButton`, `OutlinedIconButton`
- **List/chips/misc:** `List`, `ListItem`, `AssistChip`, `FilterChip`, `SuggestionChip`,
  `ChipSet`, `Divider`, `CircularProgress`
- **Ergonomic helpers (the app's real call surface):**
  - `IconBtn({ icon, iconSize, size, color, variant, active, activeBg, containerColor, … })`
    — drop-in for the old `gvIconButton`; sets per-instance `--md-*` vars; renders a
    `material-symbols-rounded` glyph into the default slot.
  - `ActionBtn({ variant, icon, iconSize, children, containerColor, labelColor, outlineColor,
    height, labelSize, … })` — drop-in for old text/tonal/outlined/filled buttons; label wrapped
    in `<span>` for shadow-DOM slot pickup; icon via `slot="icon"`.
  - `denseListVars({ dense, primary, secondary, trailing, hover })` — returns the `--md-list-item-*`
    density tokens that crush M3's stock 72px row to ~52px (comfortable) / ~40px (compact) while
    keeping real ripple/focus/slots. Pass via `style` on `<List>`; tokens inherit to each `<ListItem>`.
- Internal maps `ICON_VARIANTS` / `ACTION_VARIANTS` resolve `variant → [component, token-prefix]`
  (prefixes verified against `@material/web` **v2.4.1**).

### A2. `ui-tokens.jsx` — the full M3 system-token bridge (Atlas Part 9 is now understated)
Inside `NC_GLOBAL_CSS` `:root`, the app now maps the **entire** `--md-sys-color-*` family
(primary/secondary/tertiary/error + their on-/container roles, surface + 5 surface-container
tones, outline, inverse, shape scale) onto a **reactive `--shp-color-*` layer**. Container/variant
tones are derived in CSS with `color-mix()` (every surface is Chromium/WebView2, so `color-mix`
is safe) mixed toward `--shp-color-text` so they auto-flip dark/light.
New JS exports:
- **`deriveAccents(primaryHex)`** → `{ secondary, onSecondary, tertiary, onTertiary }`.
  secondary = same hue @ ~45% saturation (muted companion); tertiary = hue **+60°**, mildly muted.
  This gives every one of the 8 themes three harmonious M3 accent families from its single `primary`.
- **`themeVarsCss(T)`** → returns a `:root{ --shp-color-*: … }` rule pinned to the active theme;
  rendered as `<style>{themeVarsCss(T)}</style>` in `App.jsx` **after** `NC_GLOBAL_CSS`, so every
  M3 component repaints instantly on theme change. This is the single runtime JS→CSS theme bridge.
- New radius tokens `--shp-radius-lg: 16px`, `--shp-radius-xl: 28px`; M3 shape scale mapped to them.
- **Button padding fix:** the global `index.html` `*{padding:0}` reset clobbers M3 buttons'
  `:host` label padding (→ squished oval blobs). `ui-tokens.jsx` restores real M3 leading/trailing
  `padding-inline` for `md-*-button` (chips & list-items pad inner shadow nodes, so unaffected).
- **Removed:** `gvTextButton`, `cleanToolbarButton` (every call site → `<ActionBtn>`).
  `gvIconButton` **remains** (a few icon call sites not yet converted).

### A3. `m3-stylebook.jsx` — GUTTED (Atlas 9.2 / 9.4 are obsolete)
From 169 lines of hand-coded recipes (`searchField`, `filterChip`, `listRow`, `button`, `card`,
`M3_SPEC`, `M3_SCALE`, `M3_EXPECT`) down to an 18-line **doc-pointer**: "use the real
`@material/web` component; if none exists, hand-code with `ui-tokens.jsx` values only." The dev
tools (`dev/ui-audit.js`, `dev/ui-style-override.js`) inlined the few constants they still needed.

### A4. Per-file M3 adoption since Atlas
- **`App.jsx`** — imports `themeVarsCss`; renders the theme `<style>`; uses M3 `List`/`ListItem`
  + outlined/filled icon buttons; calendar `summary` call now sends a `timeMin/timeMax` 2-day window.
- **`04-components.jsx`** — `PostItStack` gained **Stack vs Board view modes** + **sort chips**
  (`FilterChip`/`ChipSet`); buttons → M3. (New behavior not in Map 2.12.)
- **`NerveCenterPhoneSurface.jsx`** — migrated to `ActionBtn`/`IconBtn`/`ListItem` + `denseListVars`;
  call banner Answer/Decline/Hang-up are filled `ActionBtn`s (success/danger containers); message &
  call rows are `md-list-item`; added a **missed-call "resolved" toggle** and a **"More history"** button.
- **`SuitePanels.jsx`** — DeskPhone suite controls (Position / close / refresh) → `ActionBtn`/`IconBtn`.
- **`ConvCapture.jsx`** — close button → `IconBtn`.
- **`10-deskphone-web.jsx`** — adopts `deriveAccents()` for its own secondary/tertiary
  (`DP_ACCENTS`, `dpSecondary`/`dpTertiary`).
- **`apps/shailos/src/App.tsx` + `index.css`** — Shailos **mirrors `deriveAccents()` inline**
  (TS copy) so the embedded mini-app keeps accent parity with the suite.

> **Pro 5 takeaway:** `deriveAccents()` is now a **cross-app contract** (web suite + DeskPhone +
> Shailos). In Pro 5 it should live in **one shared place** all surfaces import, instead of being
> re-derived three times.

---

## B. NerveCenter calendar overhaul (Map item 5.6 is badly understated)

The Map describes the calendar card as just "upcoming events, current highlighted, routine prayers
dimmed, add-event via AI." It is now a full **dual-display** surface:

- **`CalendarTimeline({ calendarRows, nowDate, C, scrollRef, nowLineRef })`** — a Google-Calendar
  **daily timeline**: `TIMELINE_PX_HR = 60` (60 px/hour), absolute-positioned event blocks, a
  **live now-line** that ticks via `requestAnimationFrame`, auto-scrolled to "now."
- **`assignCalendarColumns(rows)`** — overlap layout: sorts timed events and assigns side-by-side
  **columns** so concurrent events don't cover each other (GCal day-view behavior).
- **`GCAL_COLORS`** — the Google Calendar palette keyed by `event.colorId` (1–11), so event blocks
  match their real Google colors.
- **Compact M3 agenda** — alongside the timeline, a `md-list` agenda (`mkItem`/`mkAgendaItem`),
  with all-day events, a **NOW divider**, and a **"Tomorrow" separator** for next-day events
  (rows flagged `.tomorrow`; past events flagged `.past` and dimmed).
- **Multi-account picker** — card headers offer per-account selection and, when >1 Google account
  is connected, a **"Both accounts"** (`all`) option.
- **Full-view split** — the full-view calendar is a vertical split (~2/3 timeline + ~1/3 agenda)
  with an M3 vertical `Divider` and opaque event blocks.
- **Load window** — calendar now loads **from local midnight** across a **2-day** window.

### Backend support — `apps/web/backend/functions/google-workspace.js`
- `fetchCalendarData(accessToken, { timeMin, timeMax })` — now accepts an explicit window
  (was hard-coded to "today 00:00 → 23:59"); `maxResults` raised **25 → 50**.
- `summary(user, body)` threads `{ timeMin, timeMax }` from the client through to the calendar fetch.
- **Note:** the *deployed* twin is `apps/web/functions/` (Firebase). `backend/functions/` is the
  deprecated Netlify copy — but it was the one edited here; confirm parity in the live `functions/`
  copy during Phase 0 (see MEMORY `project_deploy_topology`).

---

## C. Net effect on the rebuild

1. **Adopt, don't reinvent, the M3 layer.** Pro 5's `m3.jsx` + `ui-tokens` bridge +
   `themeVarsCss`/`deriveAccents` should reproduce this (cleaner, typed, one shared accent module).
2. **The calendar spec is bigger than the Map says** — Pro 5's NerveCenter calendar must include
   the timeline + overlap columns + GCal colors + agenda + multi-account + Tomorrow/NOW dividers,
   backed by a windowed `timeMin/timeMax` calendar fetch.
3. **PostItStack has Stack/Board modes**; **phone surface has missed-call resolution + more-history**
   — both must be in the parity checklist.
4. When Phase 0 specs each file, **read the current source**, and treat any Atlas line touching
   Parts 1, 2.2 (PostItStack), 5 (NerveCenter), 6.2 (phone surface), 8–9 (color/UI) as **superseded
   by current code** — verify against `git show HEAD:<file>`, not the Atlas prose.
