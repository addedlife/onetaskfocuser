/**
 * The M3 bridge — how genuine @material/web components wear the app's themes.
 *
 * M3 components render in **shadow DOM** and read `--md-sys-*` custom properties; ordinary app CSS
 * can't reach inside them. So we map the FULL `--md-sys-color-*` (and shape) family onto a reactive
 * `--shp-color-*` layer. `globalCss()` is injected once (static mapping + base reset). `themeVarsCss()`
 * rewrites only the `--shp-color-*` base values for the active theme — so flipping a theme repaints
 * every M3 component instantly, with zero per-component work.
 *
 * Container/variant tones are derived in CSS with `color-mix()`, mixing toward `--shp-color-text`
 * (so they auto-flip light/dark). The app runs on Chromium/WebView2, where `color-mix` is safe.
 *
 * This is rebuilt fresh from the Pro 4 pattern (NOT copied) — see ANALYSIS/00-delta-since-atlas.md §A2.
 */

import { RADIUS, FONT_STACK } from './tokens';
import { deriveAccents } from './accents';
import { CATEGORY, type Scheme } from './schemes';

/** Static token layer + base reset + the full M3 system-token mapping. Injected once at boot. */
export function globalCss(): string {
  return `
:root {
  /* Shape scale (mirrors src/theme/tokens.ts RADIUS) */
  --shp-radius-none: 0;
  --shp-radius-xs: ${RADIUS.xs}px;
  --shp-radius-sm: ${RADIUS.sm}px;
  --shp-radius-md: ${RADIUS.md}px;
  --shp-radius-lg: ${RADIUS.lg}px;
  --shp-radius-xl: ${RADIUS.xl}px;
  --shp-radius-pill: ${RADIUS.pill}px;

  /* App typeface → M3 reference typeface roles */
  --md-ref-typeface-plain: ${FONT_STACK};
  --md-ref-typeface-brand: ${FONT_STACK};

  /* Reactive base color layer — first-paint fallback (Claude Cream); themeVarsCss() overwrites it. */
  --shp-color-bg: #F5F1EA;
  --shp-color-bg-soft: #EFE9DF;
  --shp-color-card: #FBF8F3;
  --shp-color-hover: #ECE4D7;
  --shp-color-divider: #DDD3C4;
  --shp-color-divider-soft: #E7DFD2;
  --shp-color-text: #3D3A35;
  --shp-color-muted: #6B6457;
  --shp-color-faint: #9A9384;
  --shp-color-primary: #C96442;
  --shp-color-on-primary: #FFFFFF;
  --shp-color-primary-dark: #A84E30;
  --shp-color-secondary: #C96442;
  --shp-color-on-secondary: #FFFFFF;
  --shp-color-tertiary: #C96442;
  --shp-color-on-tertiary: #FFFFFF;
  --shp-color-success: #4F7A52;
  --shp-color-danger: #B3402E;
  --shp-color-warning: #C08A2E;
  --shp-color-gold: ${CATEGORY.gold};
  --shp-color-mail: ${CATEGORY.mail};
  --shp-color-phone: ${CATEGORY.phone};

  /* ── Material 3 system color tokens → the reactive --shp layer ───────────── */
  --md-sys-color-primary: var(--shp-color-primary);
  --md-sys-color-on-primary: var(--shp-color-on-primary);
  --md-sys-color-primary-container: color-mix(in srgb, var(--shp-color-primary) 16%, var(--shp-color-card));
  --md-sys-color-on-primary-container: var(--shp-color-primary-dark);

  --md-sys-color-secondary: var(--shp-color-secondary);
  --md-sys-color-on-secondary: var(--shp-color-on-secondary);
  --md-sys-color-secondary-container: color-mix(in srgb, var(--shp-color-secondary) 16%, var(--shp-color-card));
  --md-sys-color-on-secondary-container: color-mix(in srgb, var(--shp-color-secondary) 70%, var(--shp-color-text));

  --md-sys-color-tertiary: var(--shp-color-tertiary);
  --md-sys-color-on-tertiary: var(--shp-color-on-tertiary);
  --md-sys-color-tertiary-container: color-mix(in srgb, var(--shp-color-tertiary) 16%, var(--shp-color-card));
  --md-sys-color-on-tertiary-container: color-mix(in srgb, var(--shp-color-tertiary) 70%, var(--shp-color-text));

  --md-sys-color-error: var(--shp-color-danger);
  --md-sys-color-on-error: #FFFFFF;
  --md-sys-color-error-container: color-mix(in srgb, var(--shp-color-danger) 14%, var(--shp-color-card));
  --md-sys-color-on-error-container: color-mix(in srgb, var(--shp-color-danger) 70%, var(--shp-color-text));

  --md-sys-color-background: var(--shp-color-bg);
  --md-sys-color-on-background: var(--shp-color-text);
  --md-sys-color-surface: var(--shp-color-card);
  --md-sys-color-on-surface: var(--shp-color-text);
  --md-sys-color-surface-variant: var(--shp-color-bg-soft);
  --md-sys-color-on-surface-variant: var(--shp-color-muted);
  --md-sys-color-surface-dim: var(--shp-color-bg);
  --md-sys-color-surface-bright: var(--shp-color-card);
  --md-sys-color-surface-container-lowest: var(--shp-color-card);
  --md-sys-color-surface-container-low: color-mix(in srgb, var(--shp-color-card) 96%, var(--shp-color-text));
  --md-sys-color-surface-container: color-mix(in srgb, var(--shp-color-card) 94%, var(--shp-color-text));
  --md-sys-color-surface-container-high: color-mix(in srgb, var(--shp-color-card) 91%, var(--shp-color-text));
  --md-sys-color-surface-container-highest: color-mix(in srgb, var(--shp-color-card) 88%, var(--shp-color-text));

  --md-sys-color-outline: var(--shp-color-divider);
  --md-sys-color-outline-variant: var(--shp-color-divider-soft);

  --md-sys-color-inverse-surface: var(--shp-color-text);
  --md-sys-color-inverse-on-surface: var(--shp-color-card);
  --md-sys-color-inverse-primary: color-mix(in srgb, var(--shp-color-primary) 60%, var(--shp-color-card));

  --md-sys-color-shadow: #000000;
  --md-sys-color-scrim: #000000;
  --md-sys-color-surface-tint: var(--shp-color-primary);

  /* M3 shape scale → app radius scale */
  --md-sys-shape-corner-none: 0;
  --md-sys-shape-corner-extra-small: var(--shp-radius-xs);
  --md-sys-shape-corner-small: var(--shp-radius-sm);
  --md-sys-shape-corner-medium: var(--shp-radius-md);
  --md-sys-shape-corner-large: var(--shp-radius-lg);
  --md-sys-shape-corner-extra-large: var(--shp-radius-xl);
  --md-sys-shape-corner-full: var(--shp-radius-pill);
}

/* ── Base reset — scoped and M3-safe. Note: NO global \`* { padding: 0 }\` (that broke M3 buttons
   in Pro 4). We only normalize box-sizing + margins and set the app font/colors. ─────────────── */
*, *::before, *::after { box-sizing: border-box; }
html, body, #root { height: 100%; }
body {
  margin: 0;
  font-family: var(--md-ref-typeface-plain);
  background: var(--shp-color-bg);
  color: var(--shp-color-text);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
.material-symbols-rounded {
  font-family: 'Material Symbols Rounded';
  font-weight: normal;
  font-style: normal;
  line-height: 1;
  letter-spacing: normal;
  white-space: nowrap;
  direction: ltr;
  user-select: none;
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
}
* { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--shp-color-faint) 50%, transparent) transparent; }
`;
}

/** The per-theme `:root` rule — rewrites the `--shp-color-*` base layer for the active scheme. */
export function themeVarsCss(s: Scheme): string {
  const { secondary, onSecondary, tertiary, onTertiary } = deriveAccents(s.primary);
  const decl: Record<string, string> = {
    '--shp-color-bg': s.bg,
    '--shp-color-bg-soft': s.bgSoft,
    '--shp-color-card': s.card,
    '--shp-color-hover': s.hover,
    '--shp-color-divider': s.divider,
    '--shp-color-divider-soft': s.dividerSoft,
    '--shp-color-text': s.text,
    '--shp-color-muted': s.muted,
    '--shp-color-faint': s.faint,
    '--shp-color-primary': s.primary,
    '--shp-color-on-primary': s.onPrimary,
    '--shp-color-primary-dark': s.primaryDark,
    '--shp-color-secondary': secondary,
    '--shp-color-on-secondary': onSecondary,
    '--shp-color-tertiary': tertiary,
    '--shp-color-on-tertiary': onTertiary,
    '--shp-color-success': s.success,
    '--shp-color-danger': s.danger,
    '--shp-color-warning': s.warning,
    '--shp-color-gold': CATEGORY.gold,
    '--shp-color-mail': CATEGORY.mail,
    '--shp-color-phone': CATEGORY.phone,
  };
  const body = Object.entries(decl)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  return `:root{${body};color-scheme:${s.dark ? 'dark' : 'light'};}`;
}
