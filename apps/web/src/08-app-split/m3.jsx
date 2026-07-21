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
import { MdLinearProgress } from '@material/web/progress/linear-progress.js';
import { MdBadge } from '@material/web/labs/badge/badge.js';
import { MdOutlinedTextField } from '@material/web/textfield/outlined-text-field.js';
import { MdSwitch } from '@material/web/switch/switch.js';
import { MdOutlinedSelect } from '@material/web/select/outlined-select.js';
import { MdSelectOption } from '@material/web/select/select-option.js';
import { MdCheckbox } from '@material/web/checkbox/checkbox.js';
import { MdSlider } from '@material/web/slider/slider.js';

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
export const LinearProgress  = createComponent({ react: React, tagName: 'md-linear-progress',   elementClass: MdLinearProgress });
export const Badge           = createComponent({ react: React, tagName: 'md-badge',              elementClass: MdBadge });

// Text field + switch — the two form controls the new UI composers need. Events
// are mapped so React `onInput`/`onChange` fire from the shadow-DOM elements.
export const TextField = createComponent({
  react: React,
  tagName: 'md-outlined-text-field',
  elementClass: MdOutlinedTextField,
  // onBlur maps to focusout (bubbles AND crosses the shadow boundary, unlike
  // blur) so save-on-blur callers fire when the inner <input> loses focus.
  events: { onInput: 'input', onChange: 'change', onKeyDown: 'keydown', onBlur: 'focusout' },
});
// Select — the real M3 dropdown. Pair with SelectOption children:
//   <OutlinedSelect value={v} onChange={e => set(e.target.value)}>
//     <SelectOption value="x"><div slot="headline">X</div></SelectOption>
//   </OutlinedSelect>
export const OutlinedSelect = createComponent({
  react: React,
  tagName: 'md-outlined-select',
  elementClass: MdOutlinedSelect,
  events: { onChange: 'change' },
});
export const SelectOption = createComponent({ react: React, tagName: 'md-select-option', elementClass: MdSelectOption });
export const Switch = createComponent({
  react: React,
  tagName: 'md-switch',
  elementClass: MdSwitch,
  events: { onChange: 'change' },
});
export const Checkbox = createComponent({
  react: React,
  tagName: 'md-checkbox',
  elementClass: MdCheckbox,
  events: { onChange: 'change' },
});
// Slider — the only M3-native control for a numeric range (`<input type="range">`
// is on @material/web's own "invalid text-field type" list, so it can't go
// through TextField). Fires `input` continuously while dragging, `change` on release.
export const Slider = createComponent({
  react: React,
  tagName: 'md-slider',
  elementClass: MdSlider,
  events: { onInput: 'input', onChange: 'change' },
});

// denseListVars — md-list-item density, within the M3 floor.
//
// The previous version crushed rows to 34px with 13.5px labels. That is below
// Material 3 on both counts at once: 48dp is the minimum touch target, and a list
// item's label is body-large at 16sp. A dashboard row is a tap target like any
// other, and 34px is not one.
//
// M3 provides density LEVELS precisely so a data-dense surface can stay compliant
// while staying dense, so that is the mechanism used here rather than an
// exemption. Two levels, and neither goes under the 48dp floor:
//
//   comfortable  56 / 72 px   M3 default. For tall windows (expanded height).
//   compact      48 / 64 px   M3 density -2. The floor, not below it.
//
// Type is IDENTICAL in both — only spacing tightens. That is the owner's standing
// rule (density is not smaller text) and it happens to match M3, which varies
// container height by density level and never the type scale.
//
// `dense: true` is kept as the legacy spelling of `density: 'compact'` so the
// ~20 existing call sites keep working; prefer passing `density` directly, and
// prefer deriving it from the window height class (see useWindowSizeClass) rather
// than hardcoding, so a small landscape screen compacts automatically and a tall
// portrait one breathes.
export function denseListVars({ dense = false, density = null, primary, secondary, trailing, hover } = {}) {
  const compact = density ? density === 'compact' : dense;
  return {
    '--md-list-item-two-line-container-height': compact ? '64px' : '72px',
    '--md-list-item-one-line-container-height': compact ? '48px' : '56px',
    '--md-list-item-top-space': compact ? '6px' : '8px',
    '--md-list-item-bottom-space': compact ? '6px' : '8px',
    '--md-list-item-leading-space': compact ? '14px' : '16px',
    '--md-list-item-trailing-space': compact ? '8px' : '12px',
    // M3 list item type: label = body-large 16sp, supporting = body-medium 14sp.
    '--md-list-item-label-text-size': '16px',
    '--md-list-item-label-text-line-height': '21px',
    '--md-list-item-label-text-weight': '500',
    '--md-list-item-supporting-text-size': '14px',
    '--md-list-item-supporting-text-line-height': compact ? '18px' : '20px',
    // label-medium rather than M3's label-small (11sp) for trailing metadata:
    // 12px is the floor the runtime audit enforces for anything meant to be read.
    '--md-list-item-trailing-supporting-text-size': '12px',
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
// M3 MINIMUM TOUCH TARGET IS 48dp. It is not 40. A comment in AppSuiteChrome
// asserting "M3 minimum touch target: 40dp" is what seeded the app-wide drift —
// this default was 40, gvIconButton was 40x40, and call sites then shrank from
// there to 32, 28, 26, 22. Of 156 icon-button instances at the 2026-07-21 audit,
// three were 44px or larger.
//
// `size` is clamped up to 48 rather than merely defaulting to it, so an existing
// call site passing size={26} still lands on a legal target. Pass `iconSize` to
// keep a glyph visually small inside a full-size target — that is how M3 does a
// "small" icon button: the GLYPH shrinks, the target does not.
const M3_MIN_TARGET = 48;

export function IconBtn({
  icon, iconSize = 20, size = M3_MIN_TARGET, color, variant = 'standard',
  active = false, activeBg, containerColor,
  title, 'aria-label': ariaLabel, style, children, ...rest
}) {
  const [Comp, prefix] = ICON_VARIANTS[variant] || ICON_VARIANTS.standard;
  // iconSize may be a number (px) or a token string like var(--shp-icon-md).
  const iconCss = typeof iconSize === 'number' ? `${iconSize}px` : iconSize;
  const target = typeof size === 'number' ? Math.max(M3_MIN_TARGET, size) : size;
  const sizeCss = typeof target === 'number' ? `${target}px` : target;
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
  // Same 48dp floor as IconBtn. M3's own button container is 40dp and meets the
  // target through an expanded touch area, but @material/web only ships that
  // expansion on some variants, and the injected !important sheet that used to
  // paper over this in NerveCenter matched md-icon-button ONLY — so all 25
  // ActionBtn instances on that surface stayed at 40 regardless. Clamping here
  // is what makes the fix uniform instead of per-surface.
  if (height != null) vars[`${p}-container-height`] = `${Math.max(M3_MIN_TARGET, height)}px`;
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
