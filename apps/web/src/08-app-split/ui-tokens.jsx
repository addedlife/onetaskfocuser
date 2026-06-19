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
// xs=chips/badges  sm=buttons/inputs/rows  md=cards/panels  pill=full-round
export const RADIUS = {
  xs:   "var(--shp-radius-xs)",
  sm:   "var(--shp-radius-sm)",
  md:   "var(--shp-radius-md)",
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
  --shp-color-bg:        #FFFFFF;
  --shp-color-bg-soft:   #F8F9FA;
  --shp-color-hover:     #F1F3F4;
  --shp-color-divider:   #DADCE0;
  --shp-color-text:      #202124;
  --shp-color-muted:     #5F6368;
  --shp-color-faint:     #9AA0A6;
  --shp-color-accent:    #00796B;
  --shp-color-success:   #1E8E3E;
  --shp-color-danger:    #D93025;
  --shp-color-warning:   #F9AB00;

  /* Category identity */
  --shp-color-gold:      #C9923C;
  --shp-color-cat-mail:  #3D6CB5;
  --shp-color-cat-phone: #8A63B5;
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
`;

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

export const gvTextButton = (overrides = {}, C = GV_CLEAN) => ({
  minHeight: 40,
  padding: "0 16px",
  borderRadius: RADIUS.xs,
  border: `1px solid ${C.divider}`,
  background: "transparent",
  color: C.muted,
  cursor: "pointer",
  fontSize: NC_TYPE.body,
  fontWeight: 500,
  fontFamily: NC_FONT_STACK,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  ...overrides,
});

export const cleanToolbarButton = (active = false, C = GV_CLEAN, overrides = {}) => ({
  minHeight: 40,
  padding: "0 14px",
  borderRadius: RADIUS.xs,
  border: "1px solid transparent",
  background: active ? C.hover : "transparent",
  color: active ? C.text : C.muted,
  cursor: "pointer",
  fontSize: NC_TYPE.body,
  fontWeight: 500,
  fontFamily: NC_FONT_STACK,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  ...overrides,
});

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
