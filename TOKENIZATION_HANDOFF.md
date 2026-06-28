# Tokenization Handoff — Design System Sweep (Phase 2)

**Last updated:** 2026-06-19  
**Current live version:** 4.20.90  
**Branch:** main (Netlify auto-deploys on push)

---

## What this task is

Replace all hardcoded `borderRadius`, `fontSize`, `boxShadow`, `gap`, `padding`, and raw `T.xxx` theme values with `--shp-*` CSS variable token references — exported from `apps/web/src/08-app-split/ui-tokens.jsx` — across the five remaining un-tokenized files.

**Goal:** Every surface in the app should feel like one cohesive product, not three separate apps stitched together.

---

## Phase 1 complete (do NOT re-touch)

These files are fully tokenized. Skip them.

```
apps/web/src/08-app-split/App.jsx
apps/web/src/08-app-split/components/NerveCenterPanel.jsx
apps/web/src/08-app-split/components/NerveCenterPhoneSurface.jsx
apps/web/src/08-app-split/components/DeskPhoneMiniDock.jsx
apps/web/src/08-app-split/components/HealthPage.jsx
apps/web/src/08-app-split/components/HealthCard.jsx
apps/web/src/08-app-split/components/SuitePanels.jsx
apps/web/src/08-app-split/components/ConvCapture.jsx
apps/web/src/08-app-split/components/TaskRiverPanel.jsx
apps/web/src/08-app-split/components/AppSuiteChrome.jsx
```

---

## Phase 2 — files to tokenize now

Work in this order (largest to smallest impact):

| # | File | Violations | Key components inside |
|---|------|-----------|----------------------|
| 1 | `apps/web/src/04-components.jsx` | **170** | ShailaManager, ZenMode, PostItStack, AgeBadge, EnergyBadge, BrainDump, BodyDoubleTimer, JustStartTimer, BlockReflectModal, TabBtn, PriEditor |
| 2 | `apps/web/src/05-modals.jsx` | **53** | BulkAdd, TaskBD, BlockedModal, ContextTagPicker, ListManager |
| 3 | `apps/web/src/06-shelf.jsx` | **26** | ShelfView, SubtaskGroup |
| 4 | `apps/web/src/07-settings.jsx` | **30** | full Settings panel |
| 5 | `apps/web/src/10-deskphone-web.jsx` | **5** | DeskPhone web panel |

---

## Token reference (memorize this)

```javascript
// RADIUS
RADIUS.xs   = "var(--shp-radius-xs)"    // 4px  — chips, badges, tiny buttons
RADIUS.sm   = "var(--shp-radius-sm)"    // 8px  — inputs, rows, small cards
RADIUS.md   = "var(--shp-radius-md)"    // 12px — cards, panels, modals
RADIUS.pill = "var(--shp-radius-pill)"  // 999px — full-round pills/badges/toggles

// NC_TYPE (fontSizes)
NC_TYPE.title = "var(--shp-type-title)" // 16px — section headers
NC_TYPE.body  = "var(--shp-type-body)"  // 14px — default body text
NC_TYPE.meta  = "var(--shp-type-meta)"  // 12px — secondary labels
NC_TYPE.small = "var(--shp-type-small)" // 11px — micro-labels, captions

// ELEV (boxShadow)
ELEV[1]        — subtle card shadow
ELEV[3]        — elevated cards, toasts, dropdowns
ELEV[4]        — modals
ELEV.drawer    — side panels / mini-dock FAB

// SP (spacing, 4pt grid)
SP.xs = "var(--shp-sp-xs)"  // 4px
SP.sm = "var(--shp-sp-sm)"  // 8px
SP.md = "var(--shp-sp-md)"  // 12px
SP.lg = "var(--shp-sp-lg)"  // 16px
SP.xl = "var(--shp-sp-xl)"  // 24px

// C.* — semantic colors (from cleanTheme(T), all hex strings)
C.bg       = theme.card   — card/surface background
C.bgSoft   = theme.bgW    — slightly muted surface (inputs, rows)
C.divider  = theme.brdS || theme.brd  — borders, separators
C.text     = theme.text   — primary text
C.muted    = theme.tSoft  — secondary text
C.faint    = theme.tFaint — tertiary/placeholder text
C.accent   = theme.primary — brand accent (blue)
C.success  = theme.success — green
C.danger   = theme.danger  — red
C.warning  = theme.warning — amber
```

---

## Import lines to add at top of each file

### For 04-components.jsx, 05-modals.jsx, 06-shelf.jsx

These files currently have NO ui-tokens import. Add this line after existing imports:

```javascript
import { cleanTheme, ELEV, NC_FONT_STACK, NC_TYPE, RADIUS, SP, suiteIcon, ICON } from './08-app-split/ui-tokens.jsx';
```

**07-settings.jsx** also has a local `const NC_FONT_STACK = "..."` definition — remove it after adding the import above.

### For 10-deskphone-web.jsx

Already imports `GV_CLEAN` from ui-tokens. Expand that import:

```javascript
// FROM:
import { GV_CLEAN } from './08-app-split/ui-tokens.jsx';
// TO:
import { cleanTheme, ELEV, GV_CLEAN, NC_FONT_STACK, NC_TYPE, RADIUS, SP, suiteIcon, ICON } from './08-app-split/ui-tokens.jsx';
```

---

## The C = cleanTheme(T) pattern

Every component function in 04-components.jsx that receives `T` as a prop needs this added as the **first line of its function body**:

```javascript
const C = cleanTheme(T);
```

Components in 04-components.jsx that take T: `AgeBadge`, `EnergyBadge`, `ContextBadges`, `MrsWBadge`, `BlockedBadge`, `ZenMode`, `ZenDumpReview`, `TabBtn`, `PriEditor`, `JustStartTimer`, `BodyDoubleTimer`, `BrainDump`, `OverwhelmBanner`, `PostItStack`, `BlockReflectModal`, `ShailaManager`.

Do the same in 05-modals.jsx and 06-shelf.jsx for any function receiving T.

---

## Strategy: find-and-replace order (minimizes reads, zero breakage)

### Step 1 — Safe replace_all passes (run WITHOUT reading the file first)

These patterns have exactly one correct substitute in every context in this codebase. Run as `replace_all: true` directly.

**BorderRadius** (run each as a separate replace_all on the target file):
```
borderRadius: 4,     →  borderRadius: RADIUS.xs,
borderRadius: 4 }    →  borderRadius: RADIUS.xs }
borderRadius: 8,     →  borderRadius: RADIUS.sm,
borderRadius: 8 }    →  borderRadius: RADIUS.sm }
borderRadius: 12,    →  borderRadius: RADIUS.md,
borderRadius: 12 }   →  borderRadius: RADIUS.md }
borderRadius: 99,    →  borderRadius: RADIUS.pill,
borderRadius: 999,   →  borderRadius: RADIUS.pill,
```

**FontSizes** (note: fontSize: 13 maps to NC_TYPE.meta — 1px difference, acceptable):
```
fontSize: 11,   →  fontSize: NC_TYPE.small,
fontSize: 12,   →  fontSize: NC_TYPE.meta,
fontSize: 13,   →  fontSize: NC_TYPE.meta,
fontSize: 14,   →  fontSize: NC_TYPE.body,
fontSize: 16,   →  fontSize: NC_TYPE.title,
```

**T.xxx semantic replacements** (ALL safe — C.* values are identical hex strings):
```
T.tFaint        →  C.faint        (replace_all — all contexts)
T.tSoft         →  C.muted        (replace_all — all contexts)
T.bgW           →  C.bgSoft       (replace_all — all contexts)
T.card          →  C.bg           (replace_all — verify T.bg separately)
`${T.brd}`      →  `${C.divider}` (replace_all in template literals)
`${T.brdS}`     →  `${C.divider}` (replace_all in template literals)
T.shadowLg      →  ELEV[3]        (replace_all — most are elevated cards)
```

**Hover handlers** (imperative style updates in onMouseEnter/Leave):
```
e.currentTarget.style.borderColor=T.brdS  →  e.currentTarget.style.borderColor=C.divider
e.currentTarget.style.borderColor=T.brd   →  e.currentTarget.style.borderColor=C.divider
e.currentTarget.style.color=T.tFaint      →  e.currentTarget.style.color=C.faint
e.currentTarget.style.color=T.tSoft       →  e.currentTarget.style.color=C.muted
e.currentTarget.style.color=T.text        →  e.currentTarget.style.color=C.text
e.currentTarget.style.background=T.bgW    →  e.currentTarget.style.background=C.bgSoft
```

---

### Step 2 — Targeted reads for ambiguous patterns

After Step 1 passes, do one grep scan per file for remaining violations and read only the specific lines flagged. Common ambiguous patterns:

| Pattern | Action |
|---------|--------|
| `borderRadius: 16,` | Read context: pill-shaped button/badge → `RADIUS.pill`; card → `RADIUS.md` |
| `borderRadius: 20,` | Read context: usually `RADIUS.md`; pill buttons → `RADIUS.pill` |
| `borderRadius: 7,` | `RADIUS.sm` (7 ≈ 8) |
| `borderRadius: 10,` | `RADIUS.sm` (10 ≈ 8, or check: 10 on small inputs) |
| `borderRadius: 14,` | `RADIUS.md` |
| `borderRadius: 18,` | `RADIUS.md` |
| `fontSize: 10,` | Leave as-is (sub-token, intentional micro-label) |
| `fontSize: 9,` | Leave as-is |
| `fontSize: 18,` | Leave as-is (display) |
| `fontSize: 22+` | Leave as-is (display/hero) |
| `T.bg` | Read context: page-level overlay → keep `T.bg`; inside a card panel → `C.bg` |
| `"${T.xxx}"` (double-quoted) | **CRITICAL:** These are literal string bugs — the `${}` never interpolates. Fix each manually: strip quotes, use token/C.* directly |

---

### Step 3 — After all passes, run grep to verify zero remaining raw values

```
Grep: borderRadius:\s*[0-9]  →  should return only intentional pixel values (1, 2, 3 for sub-pixel separators; 50% for circles; display sizes)
Grep: fontSize:\s*(9|10|18|22|24|28|30|34|36|38|40)  →  expected display/sub-token sizes
Grep: T\.(tFaint|tSoft|bgW|brdS|card|shadowLg)  →  should return zero
Grep: "\$\{T\.  →  should return zero (literal string bug scan)
```

---

## Critical exceptions — DO NOT tokenize these

| Pattern | Why |
|---------|-----|
| `GV_CLEAN`, `GOLD`, `GOLD_BG`, `GOLD_BRD`, `CAT_MAIL`, `CAT_PHONE` | `hexToRgba()` needs real hex values; stays as JS hex strings |
| `Z.*` (z-index values) | JS numbers for fixed overlays outside DOM inheritance |
| `borderRadius: "50%"` | True circles — always percentage, never a token |
| `borderRadius: 1` or `borderRadius: 2` | Sub-pixel progress bars / thin separators |
| `fontSize: 9`, `fontSize: 9.5` | Tiny axis labels in charts, below token scale |
| Clock face fontSizes in NerveCenterPanel | Display typography, intentional (already preserved) |
| `T.bg` in full-screen overlays (`showShailos`, `showZen`) | Page-level background, not card surface |
| `T.glow` | Boolean flag, not a color value |
| `T.success`, `T.danger`, `T.accent`, `T.warning` used as explicit hex in `textOnColor()` / `pBg()` calls | These functions need real hex — but `C.success` etc. are also hex (cleanTheme just copies them), so replacement IS safe |

---

## Commit and release policy

After all 5 files are done and `npm run build` passes in `apps/web`:

1. Bump patch in `apps/web/src/version.js`:  
   `APP_VERSION = "4.20.91"` and `APP_VERSION_DATE = "YYYY-MM-DD"`

2. Commit with prefix `style:`:
   ```
   style: tokenize 04-components ShailaManager ZenMode PostItStack + modals shelf settings DeskPhone web panel
   ```

3. Push to `origin/main` — Netlify auto-deploys.

---

## What "gorgeous" looks like when done

- Opening ZenMode, ShailaManager, PostItStack, BrainDump, BodyDoubleTimer: all use same border-radius and font scale as the rest of the app
- Settings panel: same card/input/button style as everything else
- DeskPhone web panel: consistent with DeskPhoneMiniDock (already tokenized)
- Modals (BulkAdd, TaskBD, BlockedModal): same RADIUS.md + ELEV[4] as the modals in App.jsx
- Tab buttons everywhere: `RADIUS.sm`, `NC_TYPE.meta`, `C.divider`/`C.bgSoft` — unified

---

## Build command

```bash
cd apps/web && npm run build
```

Passes = ✓ built in ~3s, no errors (chunk size warning is pre-existing, ignore it).
