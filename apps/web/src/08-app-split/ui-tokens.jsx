import React, { useEffect, useState } from 'react';

// ─── ShamashPro Design Token System ──────────────────────────────────────────
// All layout, motion, and typographic tokens live as CSS custom properties on
// :root (defined in NC_GLOBAL_CSS below). JS exports are var() reference strings,
// never raw values. To change a token: edit the CSS var — every consumer updates
// automatically. DevTools overrides a single var and every surface repaints.
//
// Prefix: --shp- (ShamashPro) — namespace for future app-wide expansion.
//
// COLOR EXCEPTION: GV_CLEAN and category colors stay as JS hex strings because
// hexToRgba() needs the real hex value for dynamic tinting. Colors are mirrored
// as --shp-color-* vars for documentation and future CSS-class use, but the
// JS hex objects remain the runtime source of truth.
//
// Z-INDEX EXCEPTION: Z stays as JS numbers. Fixed overlays can be outside the
// .nc-suite-root DOM subtree and CSS var inheritance may not reach them.

export const suiteIcon = (name, size = 20) => (
  <span className="material-symbols-rounded" style={{ fontSize: size }}>{name}</span>
);

// ─── Color Palette ────────────────────────────────────────────────────────────
// JS hex strings — needed by hexToRgba for dynamic tinting throughout the panel.
// Mirrored as --shp-color-* CSS vars in :root below.
export const GV_CLEAN = {
  bg:         "#FFFFFF",
  bgSoft:     "#F8F9FA",
  hover:      "#F1F3F4",
  divider:    "#DADCE0",
  text:       "#202124",
  muted:      "#5F6368",
  faint:      "#9AA0A6",
  accent:     "#00796B",
  accentDark: "#00695C",
  success:    "#1E8E3E",
  danger:     "#D93025",
  warning:    "#F9AB00",
};

export const NC_FONT_STACK = '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';

// Monospace stack for numerals — times, counts, metadata. Tabular, "engineered"
// feel. Falls back through OS mono faces if JetBrains Mono hasn't loaded yet.
export const NC_MONO_STACK = '"JetBrains Mono", ui-monospace, "SF Mono", "Cascadia Code", "Segoe UI Mono", Menlo, Consolas, monospace';

// ─── Typography ───────────────────────────────────────────────────────────────
// Each value is a CSS var reference. Change --shp-type-* in :root to retheme.
// `label` and `control` are kept as aliases for back-compat; prefer meta/body.
// `line` is a line-height alias — kept for legacy callers; prefer LINE.* directly.
export const NC_TYPE = {
  title:   "var(--shp-type-title)",  // 16px
  body:    "var(--shp-type-body)",   // 14px
  meta:    "var(--shp-type-meta)",   // 12px
  label:   "var(--shp-type-meta)",   // alias — same as meta
  small:   "var(--shp-type-small)",  // 11px
  control: "var(--shp-type-body)",   // alias — same as body
  line:    "var(--shp-line-base)",   // line-height alias (1.3)
};

// ─── M3 type scale ────────────────────────────────────────────────────────────
// The fifteen Material 3 roles, as ready-to-spread style objects. Prefer these
// over NC_TYPE for anything new: NC_TYPE is four sizes standing in for fifteen
// roles, and it carries no line-height or weight, so callers kept inventing both.
//
//   <span style={M3_TYPE.bodyLarge}>…</span>
//
// M3's floor is labelSmall at 11px; bodySmall at 12px is the smallest role
// intended for reading. Anything under 12px in this app is off the scale and is
// what the GM3 sweep is removing.
// Line height and size both come from the CSS vars, so a role only needs its
// token name plus the weight and tracking the M3 spec assigns it.
const role = (token, weight, tracking = '0') => ({
  fontSize: `var(--md-sys-typescale-${token}-size)`,
  lineHeight: `var(--md-sys-typescale-${token}-line-height)`,
  fontWeight: weight,
  letterSpacing: tracking,
  fontFamily: NC_FONT_STACK,
});

export const M3_TYPE = {
  displayLarge:   role('display-large', 400, '-0.25px'),
  displayMedium:  role('display-medium', 400),
  displaySmall:   role('display-small', 400),
  headlineLarge:  role('headline-large', 400),
  headlineMedium: role('headline-medium', 400),
  headlineSmall:  role('headline-small', 400),
  titleLarge:     role('title-large', 400),
  titleMedium:    role('title-medium', 500, '0.15px'),
  titleSmall:     role('title-small', 500, '0.1px'),
  bodyLarge:      role('body-large', 400, '0.5px'),
  bodyMedium:     role('body-medium', 400, '0.25px'),
  bodySmall:      role('body-small', 400, '0.4px'),
  labelLarge:     role('label-large', 500, '0.1px'),
  labelMedium:    role('label-medium', 500, '0.5px'),
  labelSmall:     role('label-small', 500, '0.5px'),
};

// ─── M3 motion ────────────────────────────────────────────────────────────────
// Durations and easings as var() references, mirroring the --md-sys-motion-*
// tokens in :root. DUR/EASE below are kept as the app's older shorthand.
export const M3_DUR = {
  short1: 'var(--md-sys-motion-duration-short1)',
  short2: 'var(--md-sys-motion-duration-short2)',
  short3: 'var(--md-sys-motion-duration-short3)',
  short4: 'var(--md-sys-motion-duration-short4)',
  medium1: 'var(--md-sys-motion-duration-medium1)',
  medium2: 'var(--md-sys-motion-duration-medium2)',
  medium3: 'var(--md-sys-motion-duration-medium3)',
  medium4: 'var(--md-sys-motion-duration-medium4)',
  long1: 'var(--md-sys-motion-duration-long1)',
  long2: 'var(--md-sys-motion-duration-long2)',
};
export const M3_EASE = {
  linear:              'var(--md-sys-motion-easing-linear)',
  standard:            'var(--md-sys-motion-easing-standard)',
  standardDecelerate:  'var(--md-sys-motion-easing-standard-decelerate)',
  standardAccelerate:  'var(--md-sys-motion-easing-standard-accelerate)',
  emphasized:          'var(--md-sys-motion-easing-emphasized)',
  emphasizedDecelerate:'var(--md-sys-motion-easing-emphasized-decelerate)',
  emphasizedAccelerate:'var(--md-sys-motion-easing-emphasized-accelerate)',
  springFast:          'var(--md-sys-motion-spring-fast)',
  spring:              'var(--md-sys-motion-spring-default)',
  springSlow:          'var(--md-sys-motion-spring-slow)',
};

// ─── Z-index layering ─────────────────────────────────────────────────────────
// Kept as JS numbers: fixed overlays are often outside the app root and must
// resolve without CSS custom property inheritance.
export const Z = {
  panel:         7600,
  overlay:       9000,
  docked:        9200,
  nudgeCard:     9400,
  nudge:         9490,
  modal:         9500,
  toast:         9800,
  modalCritical: 9900,
  celebration:   9990,
  systemBar:     10000,
  systemBarTop:  10001,
};

// ─── Motion ───────────────────────────────────────────────────────────────────
export const DUR = {
  fast: "var(--shp-dur-fast)",
  base: "var(--shp-dur-base)",
  slow: "var(--shp-dur-slow)",
};
export const EASE = {
  standard:   "var(--shp-ease-standard)",
  decelerate: "var(--shp-ease-decelerate)",
};
// Standard transition — never use `transition: all`.
// DUR/EASE resolve to CSS vars; the browser substitutes their values at paint time.
export const TRANSITION = `background-color ${DUR.fast} ${EASE.standard}, border-color ${DUR.fast} ${EASE.standard}, color ${DUR.fast} ${EASE.standard}, box-shadow ${DUR.base} ${EASE.standard}, transform ${DUR.fast} ${EASE.standard}, opacity ${DUR.base} ${EASE.standard}`;

// ─── Elevation ────────────────────────────────────────────────────────────────
// CSS var strings. Assign directly: `boxShadow: ELEV[3]`.
export const ELEV = {
  1:      "var(--shp-elev-1)",
  2:      "var(--shp-elev-2)",
  3:      "var(--shp-elev-3)",
  4:      "var(--shp-elev-4)",
  drawer: "var(--shp-elev-drawer)",
};

// ─── Spacing (4-pt grid) ──────────────────────────────────────────────────────
export const SP = {
  xs:  "var(--shp-space-xs)",
  sm:  "var(--shp-space-sm)",
  md:  "var(--shp-space-md)",
  lg:  "var(--shp-space-lg)",
  xl:  "var(--shp-space-xl)",
  xxl: "var(--shp-space-xxl)",
};

// ─── Shape Scale ──────────────────────────────────────────────────────────────
// Maps 1:1 onto the M3 shape scale (see --md-sys-shape-corner-* in :root below):
//   xs=4 chips/badges · sm=8 buttons/inputs/rows · md=12 cards/panels
//   lg=16 hero cards · xl=28 sheets/dialogs · pill=full-round
// lg and xl were defined as CSS vars but NOT exported here, so JS callers had no
// way to reach them and hardcoded instead — kit.jsx invented 24/16/14px and
// NerveCenter used bare 20px card corners, none of them on the M3 scale.
export const RADIUS = {
  xs:   "var(--shp-radius-xs)",
  sm:   "var(--shp-radius-sm)",
  md:   "var(--shp-radius-md)",
  lg:   "var(--shp-radius-lg)",
  xl:   "var(--shp-radius-xl)",
  pill: "var(--shp-radius-pill)",
};

// ─── Icon Scale ───────────────────────────────────────────────────────────────
// Pass to suiteIcon(name, ICON.sm) or use as fontSize in style objects.
export const ICON = {
  xs: "var(--shp-icon-xs)",
  sm: "var(--shp-icon-sm)",
  md: "var(--shp-icon-md)",
  lg: "var(--shp-icon-lg)",
  xl: "var(--shp-icon-xl)",
};

// ─── Line Heights ─────────────────────────────────────────────────────────────
export const LINE = {
  tight: "var(--shp-line-tight)",
  base:  "var(--shp-line-base)",
  body:  "var(--shp-line-body)",
  loose: "var(--shp-line-loose)",
};

// One consistent modal backdrop tint.
export const SCRIM = "rgba(0, 0, 0, 0.38)";

// ─── Category Identity Colors ─────────────────────────────────────────────────
// Hex strings — used with hexToRgba for dynamic tinting. Also mirrored as
// --shp-color-gold etc. in :root for any CSS-class-based overrides.
export const GOLD      = "#C9923C";
export const GOLD_BG   = "rgba(201,146,60,0.055)";
export const GOLD_BRD  = "rgba(201,146,60,0.16)";
export const CAT_MAIL  = "#3D6CB5";
export const CAT_PHONE = "#8A63B5";

export function useViewportWidth() {
  const [width, setWidth] = useState(() => (
    typeof window === "undefined" ? 1440 : window.innerWidth
  ));
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

// ─── M3 window size classes ───────────────────────────────────────────────────
// Material 3 classifies a window on BOTH axes, and an app always has two classes
// at once — one for width, one for height. The app previously had width-ish
// breakpoints only, at invented values (760 / 980 / 1120 / 1500), and no height
// awareness at all beyond one hand-rolled scale factor in the nav rail.
//
// That gap is the whole reason the dashboard is hard to get right: the standing
// "one screen, no page scroll" constraint is a HEIGHT constraint, and it was
// being solved with width tooling. A small landscape screen is medium/expanded
// WIDTH but COMPACT height — Google's own guidance says two-pane layouts are
// impractical there — while a large portrait display is the mirror image, with
// vertical room the app never used.
//
// Breakpoints are the M3 values, not approximations:
//   width   compact <600 · medium 600–839 · expanded 840–1199 · large 1200–1599 · xlarge >=1600
//   height  compact <480 · medium 480–899 · expanded >=900
//
// `available` lets a caller pass the width it actually owns (viewport minus the
// nav rail, say) rather than the raw window — M3 classifies the WINDOW the app
// is laid out in, which for a pane inside chrome is not window.innerWidth.
export const WIDTH_CLASS = { COMPACT: 'compact', MEDIUM: 'medium', EXPANDED: 'expanded', LARGE: 'large', XLARGE: 'xlarge' };
export const HEIGHT_CLASS = { COMPACT: 'compact', MEDIUM: 'medium', EXPANDED: 'expanded' };

export function widthClassOf(w) {
  if (w < 600) return WIDTH_CLASS.COMPACT;
  if (w < 840) return WIDTH_CLASS.MEDIUM;
  if (w < 1200) return WIDTH_CLASS.EXPANDED;
  if (w < 1600) return WIDTH_CLASS.LARGE;
  return WIDTH_CLASS.XLARGE;
}
export function heightClassOf(h) {
  if (h < 480) return HEIGHT_CLASS.COMPACT;
  if (h < 900) return HEIGHT_CLASS.MEDIUM;
  return HEIGHT_CLASS.EXPANDED;
}

export function useWindowSizeClass(available = null) {
  const [size, setSize] = useState(() => (
    typeof window === "undefined"
      ? { w: 1440, h: 900 }
      : { w: window.innerWidth, h: window.innerHeight }
  ));
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    // Orientation changes on a tablet cross a size class without ever firing a
    // plain resize on some Android WebViews, which is exactly the small-landscape
    // <-> tall-portrait swap this hook exists to catch.
    window.addEventListener("orientationchange", on);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("orientationchange", on);
    };
  }, []);

  const w = available != null ? available : size.w;
  const width = widthClassOf(w);
  const height = heightClassOf(size.h);
  return {
    width,
    height,
    w,
    h: size.h,
    // Convenience predicates for the cases the app actually branches on.
    isCompactWidth: width === WIDTH_CLASS.COMPACT,
    isCompactHeight: height === HEIGHT_CLASS.COMPACT,
    isExpandedHeight: height === HEIGHT_CLASS.EXPANDED,
    // M3: at compact height there is not enough vertical room for a two-pane
    // layout regardless of how wide the window is.
    allowsTwoPane: width !== WIDTH_CLASS.COMPACT && height !== HEIGHT_CLASS.COMPACT,
  };
}

export const NC_GLOBAL_CSS = `
:root {
  /* ── ShamashPro Design Tokens ─────────────────────────────────────────────
     Single source of truth for every layout, motion, and typographic value.
     Override any token here (or per-theme) and every surface updates at once.
     JS exports in ui-tokens.jsx are var() reference strings pointing here.   */

  /* Shape */
  --shp-radius-xs:   4px;
  --shp-radius-sm:   8px;
  --shp-radius-md:   12px;
  --shp-radius-lg:   16px;
  --shp-radius-xl:   28px;
  --shp-radius-pill: 999px;

  /* Elevation / shadow */
  --shp-elev-1:      0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);
  --shp-elev-2:      0 2px 8px rgba(0,0,0,0.10);
  --shp-elev-3:      0 6px 20px rgba(0,0,0,0.14);
  --shp-elev-4:      0 12px 40px rgba(0,0,0,0.20);
  --shp-elev-drawer: -8px 0 24px rgba(0,0,0,0.14);

  /* Spacing (4-pt grid) */
  --shp-space-xs:  4px;
  --shp-space-sm:  8px;
  --shp-space-md:  12px;
  --shp-space-lg:  16px;
  --shp-space-xl:  24px;
  --shp-space-xxl: 32px;

  /* Icon sizes */
  --shp-icon-xs: 12px;
  --shp-icon-sm: 14px;
  --shp-icon-md: 16px;
  --shp-icon-lg: 18px;
  --shp-icon-xl: 20px;

  /* Typography */
  --shp-type-title: 16px;
  --shp-type-body:  14px;
  --shp-type-meta:  12px;
  --shp-type-small: 11px;

  /* Line heights (unitless) */
  --shp-line-tight: 1.2;
  --shp-line-base:  1.3;
  --shp-line-body:  1.4;
  --shp-line-loose: 1.5;

  /* Motion */
  --shp-dur-fast:        0.12s;
  --shp-dur-base:        0.2s;
  --shp-dur-slow:        0.32s;
  --shp-ease-standard:   cubic-bezier(.2, 0, 0, 1);
  --shp-ease-decelerate: cubic-bezier(0, 0, 0, 1);

  /* Semantic colors — mirrored from GV_CLEAN for CSS-class use and DevTools
     inspection. JS side stays hex so hexToRgba() can parse it directly. */
  --shp-color-bg:           #FFFFFF;
  --shp-color-bg-soft:      #F8F9FA;
  --shp-color-card:         #FFFFFF;
  --shp-color-hover:        #F1F3F4;
  --shp-color-divider:      #DADCE0;
  --shp-color-divider-soft: #E8EAED;
  --shp-color-text:         #202124;
  --shp-color-muted:        #5F6368;
  --shp-color-faint:        #9AA0A6;
  --shp-color-accent:       #00796B;
  --shp-color-on-accent:    #FFFFFF;
  --shp-color-accent-dark:  #00695C;
  --shp-color-success:      #1E8E3E;
  --shp-color-danger:       #D93025;
  --shp-color-warning:      #F9AB00;

  /* Category identity */
  --shp-color-gold:      #C9923C;
  --shp-color-cat-mail:  #3D6CB5;
  --shp-color-cat-phone: #8A63B5;

  /* ── Material 3 system tokens — the full @material/web bridge ──────────────
     @material/web components render in shadow DOM and read --md-sys-*. The app's
     .nc-suite-root CSS cannot reach inside; these tokens are how every component
     gets the app's font, color, and shape. BASE roles point at the reactive
     --shp-color-* layer (rewritten per active theme by themeVarsCss() below, via
     a <style> tag in App.jsx). DERIVED roles use color-mix() over those base
     roles — every surface here is Chromium/WebView2, so color-mix is safe — and
     mix toward --shp-color-text (= on-surface), which flips dark/light, so
     container/variant tones auto-adapt to every theme. NEVER remove these. */

  /* Typeface */
  --md-ref-typeface-plain: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif;
  --md-ref-typeface-brand: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif;

  /* Primary */
  --md-sys-color-primary:                  var(--shp-color-accent, #00796B);
  --md-sys-color-on-primary:               var(--shp-color-on-accent, #FFFFFF);
  --md-sys-color-primary-container:        var(--shp-color-tonal, color-mix(in srgb, var(--shp-color-accent, #00796B) 16%, var(--shp-color-card, #FFFFFF)));
  --md-sys-color-on-primary-container:     var(--shp-color-on-tonal, var(--shp-color-accent-dark, #00695C));

  /* Secondary — derived muted companion of primary (deriveAccents → themeVarsCss);
     falls back to primary only on first paint before the writer runs. */
  --md-sys-color-secondary:                var(--shp-color-secondary, var(--shp-color-accent, #00796B));
  --md-sys-color-on-secondary:             var(--shp-color-on-secondary, var(--shp-color-on-accent, #FFFFFF));
  --md-sys-color-secondary-container:      color-mix(in srgb, var(--shp-color-secondary, var(--shp-color-accent, #00796B)) 16%, var(--shp-color-card, #FFFFFF));
  --md-sys-color-on-secondary-container:   color-mix(in srgb, var(--shp-color-secondary, var(--shp-color-accent, #00796B)) 70%, var(--shp-color-text, #202124));

  /* Tertiary — derived hue-rotated accent (deriveAccents → themeVarsCss) */
  --md-sys-color-tertiary:                 var(--shp-color-tertiary, var(--shp-color-accent, #00796B));
  --md-sys-color-on-tertiary:              var(--shp-color-on-tertiary, var(--shp-color-on-accent, #FFFFFF));
  --md-sys-color-tertiary-container:       color-mix(in srgb, var(--shp-color-tertiary, var(--shp-color-accent, #00796B)) 16%, var(--shp-color-card, #FFFFFF));
  --md-sys-color-on-tertiary-container:    color-mix(in srgb, var(--shp-color-tertiary, var(--shp-color-accent, #00796B)) 70%, var(--shp-color-text, #202124));

  /* Error */
  --md-sys-color-error:                    var(--shp-color-danger, #D93025);
  --md-sys-color-on-error:                 #FFFFFF;
  --md-sys-color-error-container:          color-mix(in srgb, var(--shp-color-danger, #D93025) 14%, var(--shp-color-card, #FFFFFF));
  --md-sys-color-on-error-container:       color-mix(in srgb, var(--shp-color-danger, #D93025) 70%, var(--shp-color-text, #202124));

  /* Surface & background */
  --md-sys-color-background:               var(--shp-color-bg, #FFFFFF);
  --md-sys-color-on-background:            var(--shp-color-text, #202124);
  --md-sys-color-surface:                  var(--shp-color-card, #FFFFFF);
  --md-sys-color-on-surface:               var(--shp-color-text, #202124);
  --md-sys-color-surface-variant:          var(--shp-color-bg-soft, #F8F9FA);
  --md-sys-color-on-surface-variant:       var(--shp-color-muted, #5F6368);
  --md-sys-color-surface-dim:              var(--shp-color-bg, #FFFFFF);
  --md-sys-color-surface-bright:           var(--shp-color-card, #FFFFFF);
  --md-sys-color-surface-container-lowest:  var(--shp-color-card, #FFFFFF);
  --md-sys-color-surface-container-low:     color-mix(in srgb, var(--shp-color-card, #FFFFFF) 96%, var(--shp-color-text, #202124));
  --md-sys-color-surface-container:         color-mix(in srgb, var(--shp-color-card, #FFFFFF) 94%, var(--shp-color-text, #202124));
  --md-sys-color-surface-container-high:    color-mix(in srgb, var(--shp-color-card, #FFFFFF) 91%, var(--shp-color-text, #202124));
  --md-sys-color-surface-container-highest: color-mix(in srgb, var(--shp-color-card, #FFFFFF) 88%, var(--shp-color-text, #202124));

  /* Outline */
  --md-sys-color-outline:                  var(--shp-color-divider, #DADCE0);
  --md-sys-color-outline-variant:          var(--shp-color-divider-soft, color-mix(in srgb, var(--shp-color-divider, #DADCE0) 55%, var(--shp-color-card, #FFFFFF)));

  /* Inverse */
  --md-sys-color-inverse-surface:          var(--shp-color-text, #202124);
  --md-sys-color-inverse-on-surface:       var(--shp-color-card, #FFFFFF);
  --md-sys-color-inverse-primary:          color-mix(in srgb, var(--shp-color-accent, #00796B) 60%, var(--shp-color-card, #FFFFFF));

  /* Fixed / misc */
  --md-sys-color-shadow:                   #000000;
  --md-sys-color-scrim:                    #000000;
  --md-sys-color-surface-tint:             var(--shp-color-accent, #00796B);

  /* ── M3 type scale ─────────────────────────────────────────────────────────
     The fifteen Material 3 typescale roles. @material/web components read these
     from --md-sys-typescale-*; until now only the TYPEFACE was bridged, so every
     component ran M3's stock Roboto metrics next to app text on a different
     scale. The app's own four sizes (--shp-type-*) are kept as aliases below and
     map onto the matching roles, so existing callers are unaffected.

     Sizes are in px rather than rem deliberately: the app's :root font-size is
     untouched by the user and index.html applies a global reset, so px here is
     predictable and matches what the M3 spec quotes in sp/dp. */
  --md-sys-typescale-display-large-size:     57px;
  --md-sys-typescale-display-large-line-height: 64px;
  --md-sys-typescale-display-large-weight:   400;
  --md-sys-typescale-display-medium-size:    45px;
  --md-sys-typescale-display-medium-line-height: 52px;
  --md-sys-typescale-display-medium-weight:  400;
  --md-sys-typescale-display-small-size:     36px;
  --md-sys-typescale-display-small-line-height: 44px;
  --md-sys-typescale-display-small-weight:   400;

  --md-sys-typescale-headline-large-size:    32px;
  --md-sys-typescale-headline-large-line-height: 40px;
  --md-sys-typescale-headline-large-weight:  400;
  --md-sys-typescale-headline-medium-size:   28px;
  --md-sys-typescale-headline-medium-line-height: 36px;
  --md-sys-typescale-headline-medium-weight: 400;
  --md-sys-typescale-headline-small-size:    24px;
  --md-sys-typescale-headline-small-line-height: 32px;
  --md-sys-typescale-headline-small-weight:  400;

  --md-sys-typescale-title-large-size:       22px;
  --md-sys-typescale-title-large-line-height: 28px;
  --md-sys-typescale-title-large-weight:     400;
  --md-sys-typescale-title-medium-size:      16px;
  --md-sys-typescale-title-medium-line-height: 24px;
  --md-sys-typescale-title-medium-weight:    500;
  --md-sys-typescale-title-small-size:       14px;
  --md-sys-typescale-title-small-line-height: 20px;
  --md-sys-typescale-title-small-weight:     500;

  --md-sys-typescale-body-large-size:        16px;
  --md-sys-typescale-body-large-line-height: 24px;
  --md-sys-typescale-body-large-weight:      400;
  --md-sys-typescale-body-medium-size:       14px;
  --md-sys-typescale-body-medium-line-height: 20px;
  --md-sys-typescale-body-medium-weight:     400;
  --md-sys-typescale-body-small-size:        12px;
  --md-sys-typescale-body-small-line-height: 16px;
  --md-sys-typescale-body-small-weight:      400;

  --md-sys-typescale-label-large-size:       14px;
  --md-sys-typescale-label-large-line-height: 20px;
  --md-sys-typescale-label-large-weight:     500;
  --md-sys-typescale-label-medium-size:      12px;
  --md-sys-typescale-label-medium-line-height: 16px;
  --md-sys-typescale-label-medium-weight:    500;
  --md-sys-typescale-label-small-size:       11px;
  --md-sys-typescale-label-small-line-height: 16px;
  --md-sys-typescale-label-small-weight:     500;

  /* ── M3 motion ─────────────────────────────────────────────────────────────
     Durations and easing curves as Material 3 defines them. The app previously
     had three ad-hoc durations and two easings; ~58 call sites ignored even
     those and inlined their own. These are what @material/web reads, and what
     the TRANSITION token below is built from.

     The emphasized curves are the M3 signature — they are NOT the 2014-era
     cubic-bezier(0.4, 0, 0.2, 1) that several call sites still use. */
  --md-sys-motion-duration-short1:      50ms;
  --md-sys-motion-duration-short2:     100ms;
  --md-sys-motion-duration-short3:     150ms;
  --md-sys-motion-duration-short4:     200ms;
  --md-sys-motion-duration-medium1:    250ms;
  --md-sys-motion-duration-medium2:    300ms;
  --md-sys-motion-duration-medium3:    350ms;
  --md-sys-motion-duration-medium4:    400ms;
  --md-sys-motion-duration-long1:      450ms;
  --md-sys-motion-duration-long2:      500ms;
  --md-sys-motion-duration-long3:      550ms;
  --md-sys-motion-duration-long4:      600ms;

  --md-sys-motion-easing-linear:                 cubic-bezier(0, 0, 1, 1);
  --md-sys-motion-easing-standard:               cubic-bezier(0.2, 0, 0, 1);
  --md-sys-motion-easing-standard-decelerate:    cubic-bezier(0, 0, 0, 1);
  --md-sys-motion-easing-standard-accelerate:    cubic-bezier(0.3, 0, 1, 1);
  --md-sys-motion-easing-emphasized:             cubic-bezier(0.2, 0, 0, 1);
  --md-sys-motion-easing-emphasized-decelerate:  cubic-bezier(0.05, 0.7, 0.1, 1);
  --md-sys-motion-easing-emphasized-accelerate:  cubic-bezier(0.3, 0, 0.8, 0.15);

  /* M3 Expressive spatial springs, as CSS linear() approximations. A real spring
     has no fixed duration, so these are sampled curves — close enough for the
     transform/opacity work the app does, and they read as springy rather than
     as an ease. Pair with the matching duration. */
  --md-sys-motion-spring-fast:    linear(0, 0.26 9%, 0.74 21%, 1.00 31%, 1.06 41%, 1.03 55%, 0.99 72%, 1);
  --md-sys-motion-spring-default: linear(0, 0.18 8%, 0.63 20%, 0.94 31%, 1.06 42%, 1.04 56%, 0.99 75%, 1);
  --md-sys-motion-spring-slow:    linear(0, 0.12 10%, 0.45 24%, 0.83 38%, 1.02 50%, 1.05 64%, 0.99 84%, 1);

  /* M3 shape scale → ShamashPro radius scale */
  --md-sys-shape-corner-none:        0;
  --md-sys-shape-corner-extra-small: var(--shp-radius-xs, 4px);
  --md-sys-shape-corner-small:       var(--shp-radius-sm, 8px);
  --md-sys-shape-corner-medium:      var(--shp-radius-md, 12px);
  --md-sys-shape-corner-large:       var(--shp-radius-lg, 16px);
  --md-sys-shape-corner-extra-large: var(--shp-radius-xl, 28px);
  --md-sys-shape-corner-full:        var(--shp-radius-pill, 999px);
}
.nc-suite-root,
.nc-suite-root :where(button, input, textarea, select, p, span, div, a, label, h1, h2, h3, h4, h5, h6, li, summary) {
  font-family: ${NC_FONT_STACK} !important;
  letter-spacing: 0 !important;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
.nc-suite-root .material-symbols-rounded {
  font-family: "Material Symbols Rounded" !important;
  font-weight: normal !important;
  font-style: normal !important;
  line-height: 1 !important;
}
.nc-suite-root :where(button, input, textarea, select) {
  line-height: 1.25;
}
.nc-suite-root :where(button, input, textarea, select, p, div, a, label, li, summary) {
  font-weight: var(--nc-font-weight-normal, 400) !important;
}
.nc-suite-root :where(h1, h2, h3, h4, h5, h6, strong, b) {
  font-weight: var(--nc-font-weight-strong, 500) !important;
}
/* M3 buttons carry their label padding on :host([has-icon]) etc. The global
   *{padding:0} reset (index.html) clobbers that host padding, so the icon hugs
   the left edge and the label the right → squished "oval blob" buttons. Restore
   the real M3 leading/trailing space here (chips & list-items pad inner shadow
   nodes, so the reset never reaches them — only buttons need this). */
md-filled-button, md-filled-tonal-button, md-outlined-button, md-elevated-button { padding-inline: 24px; }
md-filled-button[has-icon]:not([trailing-icon]), md-filled-tonal-button[has-icon]:not([trailing-icon]), md-outlined-button[has-icon]:not([trailing-icon]), md-elevated-button[has-icon]:not([trailing-icon]) { padding-inline: 16px 24px; }
md-filled-button[trailing-icon], md-filled-tonal-button[trailing-icon], md-outlined-button[trailing-icon], md-elevated-button[trailing-icon] { padding-inline: 24px 16px; }
md-text-button { padding-inline: 12px; }
md-text-button[has-icon]:not([trailing-icon]) { padding-inline: 12px 16px; }
md-text-button[trailing-icon] { padding-inline: 16px 12px; }
.nc-suite-root * {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
.nc-suite-root *::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
.nc-suite-root *::-webkit-scrollbar-track {
  background: transparent;
}
.nc-suite-root *::-webkit-scrollbar-thumb {
  background-color: transparent;
  background-clip: content-box;
  border: 3px solid transparent;
  border-radius: 999px;
}
.nc-suite-root *:hover,
.nc-suite-root *:focus-within,
.nc-suite-root *:active {
  scrollbar-color: rgba(95, 99, 104, 0.34) transparent;
}
.nc-suite-root *:hover::-webkit-scrollbar-thumb,
.nc-suite-root *:focus-within::-webkit-scrollbar-thumb,
.nc-suite-root *:active::-webkit-scrollbar-thumb {
  background-color: rgba(95, 99, 104, 0.38);
}
.nc-suite-root *:hover::-webkit-scrollbar-thumb:hover {
  background-color: rgba(95, 99, 104, 0.58);
}
.nc-suite-root button {
  touch-action: manipulation;
}
/* Hover / press feedback for the left navigation rail */
.nc-rail button:hover:not(:disabled) {
  background: rgba(127, 127, 127, 0.10) !important;
}
.nc-rail button:active:not(:disabled) {
  background: rgba(127, 127, 127, 0.16) !important;
}
.nc-suite-root :where(button, a, input, textarea, select):focus-visible {
  outline: 2px solid rgba(0, 121, 107, 0.38);
  outline-offset: 2px;
}
.nc-action-row {
  position: relative;
}
.nc-hover-actions {
  opacity: 0;
  pointer-events: none;
  transform: translateX(4px);
  transition: opacity 0.14s ease, transform 0.14s ease;
}
.nc-action-row:hover .nc-hover-actions,
.nc-action-row:focus-within .nc-hover-actions,
.nc-hover-actions[data-open="true"] {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(0);
}
@media (hover: none) {
  .nc-hover-actions {
    opacity: 1;
    pointer-events: auto;
    transform: none;
  }
}
/* Card-group: card wrapper is the hover context; nc-card-action elements
   fade in on hover instead of cluttering the header at rest.          */
.nc-card-group {
  position: relative;
}
.nc-card-action {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.14s ease;
}
.nc-card-group:hover .nc-card-action,
.nc-card-group:focus-within .nc-card-action {
  opacity: 1;
  pointer-events: auto;
}
@media (hover: none) {
  .nc-card-action {
    opacity: 1;
    pointer-events: auto;
  }
}
/* Use dynamic viewport height so the app doesn't overflow on mobile when
   browser chrome (address bar, nav bar) changes the visible area */
.nc-suite-root {
  height: 100vh;
  height: 100dvh;
  max-width: 100vw;
  overflow-x: hidden;
}
/* Hide the scroll-snap carousel scrollbar on WebKit */
[data-nc-task-grid="true"]::-webkit-scrollbar {
  display: none;
}
/* Smooth sweep animation — transform-based so the bar grows left→right at 60fps.
   Set animation-delay to a negative value (e.g. -30s) to start mid-cycle.
   Fade-out near the end replaces the jarring width-rewind. */
@keyframes nc-sec-sweep {
  0%   { transform: scaleX(0);   opacity: 0.36; }
  82%  { opacity: 0.36; }
  100% { transform: scaleX(1.0); opacity: 0; }
}
/* Mount fade for the phone surface ⇄ embedded DeskPhone swap (DUR.base). */
@keyframes nc-phone-surface-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
/* Pending host-switch blink — the REQUESTED phone host pulses while the current
   holder stays solid, until the new host's heartbeat confirms the handover. */
@keyframes nc-host-blink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.3; }
}
`;

// ─── Accent derivation (M3 secondary + tertiary) ────────────────────────────
// The 8 themes define a single `primary` accent. Material 3 wants three accent
// families. Rather than hand-author 8×8 colors (or mirror primary), we derive:
//   secondary = same hue, ~half saturation  → a muted companion (M3's intent)
//   tertiary  = hue + 60°, slightly muted    → a distinct complementary accent
// from the one primary, so every theme gets harmonious, distinct accents for
// free. Container tones are then derived in CSS via color-mix (see :root).
function _hexToHsl(hex) {
  let h = (hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let hue = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: hue = (g - b) / d + (g < b ? 6 : 0); break;
      case g: hue = (b - r) / d + 2; break;
      default: hue = (r - g) / d + 4;
    }
    hue /= 6;
  }
  return { h: hue * 360, s, l };
}
function _hslToHex(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else { const q = l < 0.5 ? l * (1 + s) : l + s - l * s; const p = 2 * l - q; r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3); }
  const to = v => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}
// White or near-black for text on a given fill, by perceived luminance.
function _onColor(hex) {
  const h = (hex || '').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 140 ? '#FFFFFF' : '#1A1A1A';
}
export function deriveAccents(primaryHex) {
  const clean = (primaryHex || '').replace('#', '');
  const safe = /^[0-9a-f]{6}$/i.test(clean) ? `#${clean}` : GV_CLEAN.accent;
  const { h, s, l } = _hexToHsl(safe);
  const secondary = _hslToHex(h, Math.max(0, s * 0.45), l);
  const tertiary = _hslToHex(h + 60, Math.max(0.18, Math.min(s * 0.85, 0.7)), l);
  return { secondary, onSecondary: _onColor(secondary), tertiary, onTertiary: _onColor(tertiary) };
}

// ─── Theme → CSS-var writer ─────────────────────────────────────────────────
// Returns a `:root{…}` rule that pins the reactive --shp-color-* layer to the
// active theme (T). Rendered as a <style> right AFTER NC_GLOBAL_CSS in App.jsx,
// so it wins the cascade and every M3 role (which references --shp-color-*)
// repaints the instant the theme changes. This is the single runtime bridge
// between the JS theme object and the CSS custom-property layer — change a value
// here and every @material/web component and token consumer follows.
// Optional roles (tonal/on-tonal) are emitted ONLY when the theme defines them;
// when absent, the M3 *-container roles fall back to their color-mix derivation.
export function themeVarsCss(T = {}) {
  const accent = T.primary || T.accent || GV_CLEAN.accent;
  const { secondary, onSecondary, tertiary, onTertiary } = deriveAccents(accent);
  const decl = [
    `--shp-color-secondary:${secondary}`,
    `--shp-color-on-secondary:${onSecondary}`,
    `--shp-color-tertiary:${tertiary}`,
    `--shp-color-on-tertiary:${onTertiary}`,
    `--shp-color-bg:${T.bg || GV_CLEAN.bg}`,
    `--shp-color-bg-soft:${T.bgW || GV_CLEAN.bgSoft}`,
    `--shp-color-card:${T.card || T.bg || GV_CLEAN.bg}`,
    `--shp-color-hover:${T.tonal || T.bgW || GV_CLEAN.hover}`,
    `--shp-color-divider:${T.brd || GV_CLEAN.divider}`,
    `--shp-color-divider-soft:${T.brdS || T.brd || GV_CLEAN.divider}`,
    `--shp-color-text:${T.text || GV_CLEAN.text}`,
    `--shp-color-muted:${T.tSoft || GV_CLEAN.muted}`,
    `--shp-color-faint:${T.tFaint || GV_CLEAN.faint}`,
    `--shp-color-accent:${accent}`,
    `--shp-color-on-accent:${T.onPrimary || '#FFFFFF'}`,
    `--shp-color-accent-dark:${T.onTonal || T.primary || GV_CLEAN.accentDark}`,
    `--shp-color-success:${T.success || GV_CLEAN.success}`,
    `--shp-color-danger:${T.danger || GV_CLEAN.danger}`,
    `--shp-color-warning:${T.warning || GV_CLEAN.warning}`,
  ];
  if (T.tonal) decl.push(`--shp-color-tonal:${T.tonal}`);
  if (T.onTonal) decl.push(`--shp-color-on-tonal:${T.onTonal}`);
  return `:root{${decl.join(';')};}`;
}

export const cleanTheme = (theme = {}) => ({
  bg:        theme.card  || GV_CLEAN.bg,
  bgSoft:    theme.bgW   || GV_CLEAN.bgSoft,
  hover:     theme.tonal || theme.bgW || GV_CLEAN.hover,
  divider:   theme.brdS  || theme.brd || GV_CLEAN.divider,
  text:      theme.text  || GV_CLEAN.text,
  muted:     theme.tSoft || GV_CLEAN.muted,
  faint:     theme.tFaint || GV_CLEAN.faint,
  accent:    theme.primary || GV_CLEAN.accent,
  accentDark: theme.onTonal || theme.primary || GV_CLEAN.accentDark,
  success:   theme.success || GV_CLEAN.success,
  danger:    theme.danger  || GV_CLEAN.danger,
  warning:   theme.warning || GV_CLEAN.warning,
});

export const gvIconButton = (overrides = {}, C = GV_CLEAN) => ({
  width: 40,
  height: 40,
  borderRadius: RADIUS.pill,
  border: "none",
  background: "transparent",
  color: C.muted,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  ...overrides,
  // index.html sets button{min-height:36px} globally; min-height beats height, so
  // without an inline minHeight any icon button shorter than 36px silently renders
  // at 36px and props row heights open.
  minHeight: overrides.minHeight ?? overrides.height ?? 40,
});

// gvTextButton + cleanToolbarButton were removed in M3 Phase A — every call site
// now renders a real @material/web button via <ActionBtn> in m3.jsx. gvIconButton
// remains until the icon-button slice converts its call sites.

export function buildDeskPhoneThemeQuery(palette, theme = {}) {
  const qs = new URLSearchParams({ palette });
  const keys = ["bg", "bgW", "card", "text", "tSoft", "tFaint", "brd", "brdS", "primary", "onPrimary", "tonal", "onTonal"];
  keys.forEach(key => {
    const value = theme?.[key];
    if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim())) {
      qs.set(key, value.trim());
    }
  });
  return qs.toString();
}

export function getInitialSuiteView() {
  try {
    const params = new URLSearchParams(window.location.search);
    const view = (params.get("suite") || params.get("view") || "").toLowerCase();
    if (view === "switchboard" || view === "nervecenter") return "nervecenter";
    if (view === "focus" || view === "chief" || view === "shailos" || view === "deskphone" || view === "phone") return view === "phone" ? "deskphone" : view;
    return "nervecenter";
  } catch {
    return "nervecenter";
  }
}

// ─── NerveCenter Section Header Styles ───────────────────────────────────────
// Shared style functions for the three primary panel headers (Tasks/Shailos/Phone).
// Logic lives here so all three headers are guaranteed identical and design
// decisions — divider, padding, icon size — have a single source of truth.
export const ncSectionHeaderStyle = (C, overrides = {}) => ({
  minHeight: 30,
  padding: "3px 10px",
  borderBottom: `1px solid ${C.divider}`,
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: SP.sm,
  ...overrides,
});

export const ncSectionTitleStyle = (C) => ({
  fontSize: NC_TYPE.title,
  fontWeight: "var(--nc-font-weight-strong, 500)",
  color: C.text,
  fontFamily: NC_FONT_STACK,
  lineHeight: LINE.tight,
});

export const ncSectionIconStyle = (accent, C) => ({
  width: 26,
  height: 26,
  borderRadius: RADIUS.md,
  background: "transparent",
  color: accent || C.accent,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
});

export const ncSmallIconBtnStyle = (active = false, accent, C) => gvIconButton({
  width: 26,
  height: 26,
  background: active ? C.hover : "transparent",
  color: active ? (accent || C.muted) : C.muted,
  minHeight: 26,
}, C);
