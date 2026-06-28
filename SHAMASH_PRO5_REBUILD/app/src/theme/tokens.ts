/**
 * Design tokens — the single source of truth for shape, spacing, rhythm, type, and motion.
 * Colors live in `schemes.ts` (semantic, per-theme); everything dimensional lives here.
 * These map 1:1 onto the M3 shape/spacing scales and are exposed to CSS as `--shp-*` in bridge.ts.
 */

/** Corner radii — M3 shape scale (none · xs · sm · md · lg · xl · full). */
export const RADIUS = { none: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 28, pill: 999 } as const;

/** Spacing — 4-pt grid. Use for padding, gap, and margins. */
export const SP = { none: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Elevation — soft, layered shadows (level 0–3). */
export const ELEV = {
  0: 'none',
  1: '0 1px 2px rgba(0,0,0,.08), 0 1px 3px rgba(0,0,0,.06)',
  2: '0 1px 2px rgba(0,0,0,.10), 0 2px 6px rgba(0,0,0,.08)',
  3: '0 4px 8px rgba(0,0,0,.10), 0 6px 16px rgba(0,0,0,.10)',
} as const;

/** The app typeface (Segoe UI Variable on Windows) and a monospace for numerals/times. */
export const FONT_STACK =
  '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", sans-serif';
export const MONO_STACK =
  '"JetBrains Mono", "Cascadia Code", ui-monospace, "SFMono-Regular", Menlo, monospace';

/** Type scale (px). */
export const TYPE = {
  display: 28,
  headline: 22,
  title: 18,
  body: 14,
  label: 13,
  meta: 12,
  small: 11,
} as const;

/** Motion — durations (ms) and M3 easing curves. */
export const DUR = { fast: 120, base: 200, slow: 320 } as const;
export const EASE = {
  standard: 'cubic-bezier(.2, 0, 0, 1)',
  emphasized: 'cubic-bezier(.3, 0, 0, 1)',
} as const;

/** Stacking order. */
export const Z = { base: 0, rail: 10, dock: 50, sheet: 80, modal: 100, toast: 200 } as const;

/** Icon glyph sizes (px). */
export const ICON = { sm: 16, md: 18, lg: 20, xl: 24 } as const;
