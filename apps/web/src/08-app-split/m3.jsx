import React from 'react';
import { createComponent } from '@lit/react';
import { MdFilledButton } from '@material/web/button/filled-button.js';
import { MdFilledTonalButton } from '@material/web/button/filled-tonal-button.js';
import { MdOutlinedButton } from '@material/web/button/outlined-button.js';
import { MdTextButton } from '@material/web/button/text-button.js';
import { MdIconButton } from '@material/web/iconbutton/icon-button.js';
import { MdFilledIconButton } from '@material/web/iconbutton/filled-icon-button.js';
import { MdFilledTonalIconButton } from '@material/web/iconbutton/filled-tonal-icon-button.js';
import { MdOutlinedIconButton } from '@material/web/iconbutton/outlined-icon-button.js';
import { MdList } from '@material/web/list/list.js';
import { MdListItem } from '@material/web/list/list-item.js';
import { MdAssistChip } from '@material/web/chips/assist-chip.js';
import { MdFilterChip } from '@material/web/chips/filter-chip.js';
import { MdSuggestionChip } from '@material/web/chips/suggestion-chip.js';
import { MdChipSet } from '@material/web/chips/chip-set.js';
import { MdDivider } from '@material/web/divider/divider.js';
import { MdCircularProgress } from '@material/web/progress/circular-progress.js';

// ─── Shared @material/web button layer ───────────────────────────────────────
// Single home for the real Google Material 3 button + icon-button components,
// wrapped once via @lit/react createComponent so every surface imports the same
// React-friendly element (no per-file re-wrapping; see CLAUDE.md M3 rule).
//
// Components render in shadow DOM and read --md-* tokens; the app-wide bridge in
// ui-tokens.jsx :root already maps those to the active theme. Per-instance traits
// (a green Answer button, a dense 32px row button, a priority-tinted icon) are set
// through component-level --md-* CSS vars — the sanctioned pattern, identical to
// AppSuiteChrome's `mdVars`, NOT inline style hacks on structure.

export const FilledButton      = createComponent({ react: React, tagName: 'md-filled-button',           elementClass: MdFilledButton });
export const TonalButton       = createComponent({ react: React, tagName: 'md-filled-tonal-button',     elementClass: MdFilledTonalButton });
export const OutlinedButton    = createComponent({ react: React, tagName: 'md-outlined-button',         elementClass: MdOutlinedButton });
export const TextButton        = createComponent({ react: React, tagName: 'md-text-button',             elementClass: MdTextButton });
export const IconButton        = createComponent({ react: React, tagName: 'md-icon-button',             elementClass: MdIconButton });
export const FilledIconButton  = createComponent({ react: React, tagName: 'md-filled-icon-button',      elementClass: MdFilledIconButton });
export const TonalIconButton   = createComponent({ react: React, tagName: 'md-filled-tonal-icon-button', elementClass: MdFilledTonalIconButton });
export const OutlinedIconButton = createComponent({ react: React, tagName: 'md-outlined-icon-button',   elementClass: MdOutlinedIconButton });

// ─── List, chips, divider, progress ───────────────────────────────────────────
// Same single-home pattern: the real M3 list/chip/divider/progress elements,
// wrapped once. List rows (md-list-item) read --md-list-item-* density tokens —
// see DENSE_LIST_VARS below for the app's tuned dense-but-airy NerveCenter rhythm.
export const List            = createComponent({ react: React, tagName: 'md-list',              elementClass: MdList });
export const ListItem        = createComponent({ react: React, tagName: 'md-list-item',         elementClass: MdListItem });
export const AssistChip      = createComponent({ react: React, tagName: 'md-assist-chip',       elementClass: MdAssistChip });
export const FilterChip      = createComponent({ react: React, tagName: 'md-filter-chip',       elementClass: MdFilterChip });
export const SuggestionChip  = createComponent({ react: React, tagName: 'md-suggestion-chip',   elementClass: MdSuggestionChip });
export const ChipSet         = createComponent({ react: React, tagName: 'md-chip-set',          elementClass: MdChipSet });
export const Divider         = createComponent({ react: React, tagName: 'md-divider',           elementClass: MdDivider });
export const CircularProgress = createComponent({ react: React, tagName: 'md-circular-progress', elementClass: MdCircularProgress });

// DENSE_LIST_VARS — NerveCenter's tuned md-list-item density. M3's stock two-line
// row is 72px; that's far too tall for a dashboard. These tokens crush it to a
// dense-but-breathing ~52px (comfortable) / ~40px (compact) while keeping real M3
// ripple, focus ring, and slot layout. Pass via `style` on <List> (tokens inherit
// into each <ListItem>). Colours come in from the caller (theme C.*).
export function denseListVars({ dense = false, primary, secondary, trailing, hover } = {}) {
  return {
    '--md-list-item-two-line-container-height': dense ? '40px' : '52px',
    '--md-list-item-one-line-container-height': dense ? '34px' : '44px',
    '--md-list-item-top-space': dense ? '3px' : '6px',
    '--md-list-item-bottom-space': dense ? '3px' : '6px',
    '--md-list-item-leading-space': '12px',
    '--md-list-item-trailing-space': '12px',
    '--md-list-item-label-text-size': dense ? '12px' : '13.5px',
    '--md-list-item-label-text-line-height': dense ? '15px' : '17px',
    '--md-list-item-label-text-weight': '500',
    '--md-list-item-supporting-text-size': dense ? '11px' : '12px',
    '--md-list-item-supporting-text-line-height': dense ? '13px' : '15px',
    '--md-list-item-trailing-supporting-text-size': dense ? '10.5px' : '11.5px',
    ...(primary ? { '--md-list-item-label-text-color': primary } : {}),
    ...(secondary ? { '--md-list-item-supporting-text-color': secondary, '--md-list-item-trailing-supporting-text-color': secondary, '--md-list-item-leading-icon-color': secondary, '--md-list-item-trailing-icon-color': secondary } : {}),
    ...(trailing ? { '--md-list-item-trailing-supporting-text-color': trailing } : {}),
    ...(hover ? { '--md-list-item-hover-state-layer-color': hover } : {}),
  };
}

// Variant → [component, token-prefix]. The prefix matches each component's
// --md-<prefix>-* custom-property namespace (verified against @material/web v2.4).
const ICON_VARIANTS = {
  standard: [IconButton, '--md-icon-button'],
  filled:   [FilledIconButton, '--md-filled-icon-button'],
  tonal:    [TonalIconButton, '--md-filled-tonal-icon-button'],
  outlined: [OutlinedIconButton, '--md-outlined-icon-button'],
};
const ACTION_VARIANTS = {
  filled:   [FilledButton, '--md-filled-button'],
  tonal:    [TonalButton, '--md-filled-tonal-button'],
  outlined: [OutlinedButton, '--md-outlined-button'],
  text:     [TextButton, '--md-text-button'],
};

// ─── IconBtn — real M3 icon button with the old gvIconButton ergonomics ───────
// Drop-in replacement for `<button style={gvIconButton({...}, C)}>{suiteIcon(...)}`.
//   icon        Material Symbols glyph name (rendered into the default slot)
//   iconSize    glyph px (was the suiteIcon size arg)
//   size        clickable square px — maps to state-layer (standard) / container
//   color       icon color (pass the theme value, e.g. C.muted / C.accent)
//   variant     standard | filled | tonal | outlined
//   active+activeBg  persistent selected tint (standard buttons have no container
//                    color token, so the active state paints the host directly)
export function IconBtn({
  icon, iconSize = 18, size = 40, color, variant = 'standard',
  active = false, activeBg, containerColor,
  title, 'aria-label': ariaLabel, style, children, ...rest
}) {
  const [Comp, prefix] = ICON_VARIANTS[variant] || ICON_VARIANTS.standard;
  // iconSize may be a number (px) or a token string like var(--shp-icon-md).
  const iconCss = typeof iconSize === 'number' ? `${iconSize}px` : iconSize;
  const sizeCss = typeof size === 'number' ? `${size}px` : size;
  const vars = { '--md-icon-button-icon-size': iconCss };
  if (variant === 'standard') {
    vars['--md-icon-button-state-layer-width'] = sizeCss;
    vars['--md-icon-button-state-layer-height'] = sizeCss;
  } else {
    vars[`${prefix}-container-width`] = sizeCss;
    vars[`${prefix}-container-height`] = sizeCss;
  }
  if (color) vars[`${prefix}-icon-color`] = color;
  if (containerColor && variant !== 'standard') vars[`${prefix}-container-color`] = containerColor;
  const activeHost = active && activeBg ? { background: activeBg, borderRadius: '50%' } : null;
  return (
    <Comp title={title} aria-label={ariaLabel || title} style={{ ...vars, ...activeHost, ...style }} {...rest}>
      {icon ? <span className="material-symbols-rounded" style={{ fontSize: iconCss }}>{icon}</span> : children}
    </Comp>
  );
}

// ─── ActionBtn — real M3 text/tonal/outlined/filled button ────────────────────
// Drop-in replacement for `<button style={gvTextButton/cleanToolbarButton(...)}>`.
//   variant         text | tonal | outlined | filled
//   icon            optional leading Material Symbols glyph (M3 `slot="icon"`)
//   children        label text (wrapped in <span> for reliable shadow-DOM slot)
//   containerColor  fill for filled/tonal (e.g. C.success, C.danger, GOLD)
//   labelColor      label + icon color (also colors text/tonal variants)
//   outlineColor    border color for outlined
//   height          container height px (preserves the app's dense rows)
export function ActionBtn({
  variant = 'text', icon, iconSize = 14, children,
  containerColor, labelColor, outlineColor, height, labelSize,
  title, 'aria-label': ariaLabel, style, ...rest
}) {
  const [Comp, p] = ACTION_VARIANTS[variant] || ACTION_VARIANTS.text;
  const vars = {};
  if (height != null) vars[`${p}-container-height`] = `${height}px`;
  if (labelSize != null) vars[`${p}-label-text-size`] = typeof labelSize === 'number' ? `${labelSize}px` : labelSize;
  if (containerColor && (variant === 'filled' || variant === 'tonal')) vars[`${p}-container-color`] = containerColor;
  if (labelColor) {
    vars[`${p}-label-text-color`] = labelColor;
    vars[`${p}-icon-color`] = labelColor;
  }
  if (outlineColor && variant === 'outlined') vars[`${p}-outline-color`] = outlineColor;
  return (
    <Comp title={title} aria-label={ariaLabel} style={{ ...vars, ...style }} {...rest}>
      {icon ? <span slot="icon" className="material-symbols-rounded" style={{ fontSize: iconSize }}>{icon}</span> : null}
      {children != null ? <span>{children}</span> : null}
    </Comp>
  );
}
