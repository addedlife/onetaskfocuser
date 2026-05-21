import React, { useEffect, useState } from 'react';

export const suiteIcon = (name, size = 20) => (
  <span className="material-symbols-rounded" style={{ fontSize: size }}>{name}</span>
);

export const GV_CLEAN = {
  bg: "#FFFFFF",
  bgSoft: "#F8F9FA",
  hover: "#F1F3F4",
  divider: "#DADCE0",
  text: "#202124",
  muted: "#5F6368",
  faint: "#9AA0A6",
  accent: "#00796B",
  accentDark: "#00695C",
  success: "#1E8E3E",
  danger: "#D93025",
  warning: "#F9AB00",
};

export const NC_FONT_STACK = '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';

export const NC_TYPE = {
  title: 18,
  body: 15,
  meta: 13,
  label: 13,
  small: 12,
  control: 14,
  line: 1.5,
};

// ─── Z-index layering system ──────────────────────────────────────────────
// One ordered scale for every fixed/absolute overlay. Higher = closer to the
// user. Always reference these names instead of hand-picking magic numbers.
export const Z = {
  panel:         7600,   // full-screen surface panels (sit beside the sidebar)
  overlay:       9000,   // standard modal backdrops, zen mode, full-screen overlays
  docked:        9200,   // minimized / docked pills
  nudgeCard:     9400,   // docked nudge cards (corner)
  nudge:         9490,   // centered nudge cards
  modal:         9500,   // standard modals
  toast:         9800,   // toasts & undo bars
  modalCritical: 9900,   // critical confirmation modals (must sit above toasts)
  celebration:   9990,   // streak / celebration animations
  systemBar:     10000,  // offline notice bar
  systemBarTop:  10001,  // update / connection notice bar (topmost)
};

// ─── Motion ───────────────────────────────────────────────────────────────
// Three durations, two easings — every transition/animation draws from these.
export const DUR = { fast: "0.12s", base: "0.2s", slow: "0.32s" };
export const EASE = {
  standard: "cubic-bezier(.2, 0, 0, 1)",   // most UI motion
  decelerate: "cubic-bezier(0, 0, 0, 1)",  // elements entering the screen
};
// Standard transition for interactive surfaces — never use `transition: all`.
export const TRANSITION = `background-color ${DUR.fast} ${EASE.standard}, border-color ${DUR.fast} ${EASE.standard}, color ${DUR.fast} ${EASE.standard}, box-shadow ${DUR.base} ${EASE.standard}, transform ${DUR.fast} ${EASE.standard}, opacity ${DUR.base} ${EASE.standard}`;

// ─── Elevation ────────────────────────────────────────────────────────────
// Named shadow tiers — higher = more lifted. Replaces ad-hoc box shadows.
export const ELEV = {
  1: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
  2: "0 2px 8px rgba(0,0,0,0.10)",
  3: "0 6px 20px rgba(0,0,0,0.14)",
  4: "0 12px 40px rgba(0,0,0,0.20)",
};

// ─── Spacing (4-pt grid) ──────────────────────────────────────────────────
export const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

// One consistent modal backdrop tint.
export const SCRIM = "rgba(0, 0, 0, 0.38)";

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
  line-height: 1.45;
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
`;

export const cleanTheme = (theme = {}) => ({
  bg: theme.card || GV_CLEAN.bg,
  bgSoft: theme.bgW || GV_CLEAN.bgSoft,
  hover: theme.tonal || theme.bgW || GV_CLEAN.hover,
  divider: theme.brdS || theme.brd || GV_CLEAN.divider,
  text: theme.text || GV_CLEAN.text,
  muted: theme.tSoft || GV_CLEAN.muted,
  faint: theme.tFaint || GV_CLEAN.faint,
  accent: theme.primary || GV_CLEAN.accent,
  accentDark: theme.onTonal || theme.primary || GV_CLEAN.accentDark,
  success: theme.success || GV_CLEAN.success,
  danger: theme.danger || GV_CLEAN.danger,
  warning: theme.warning || GV_CLEAN.warning,
});

export const gvIconButton = (overrides = {}, C = GV_CLEAN) => ({
  width: 40,
  height: 40,
  borderRadius: 20,
  border: "none",
  background: "transparent",
  color: C.muted,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  ...overrides,
});

export const gvTextButton = (overrides = {}, C = GV_CLEAN) => ({
  minHeight: 40,
  padding: "0 16px",
  borderRadius: 4,
  border: `1px solid ${C.divider}`,
  background: "transparent",
  color: C.muted,
  cursor: "pointer",
  fontSize: 14,
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
  borderRadius: 4,
  border: "1px solid transparent",
  background: active ? C.hover : "transparent",
  color: active ? C.text : C.muted,
  cursor: "pointer",
  fontSize: 14,
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
