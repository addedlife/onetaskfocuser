/**
 * The @material/web component layer — the ONE shared home for genuine Google Material 3 components.
 *
 * Per the M3 mandate: every UI element that M3 covers uses the real `@material/web` element, wrapped
 * once here with `@lit/react`'s `createComponent` (no per-file re-wrapping). Components render in
 * shadow DOM and read the `--md-sys-*` tokens that src/theme/bridge.ts maps to the active theme.
 *
 * Per-instance traits (a green Answer button, a 32px dense row button, a priority-tinted icon) are
 * set through component-level `--md-*` CSS vars — the sanctioned pattern, never inline style hacks on
 * structure. `IconBtn` / `ActionBtn` package that ergonomically; `denseListVars` tunes list density.
 */

import * as React from 'react';
import { createComponent } from '@lit/react';

import { MdFilledButton } from '@material/web/button/filled-button.js';
import { MdFilledTonalButton } from '@material/web/button/filled-tonal-button.js';
import { MdOutlinedButton } from '@material/web/button/outlined-button.js';
import { MdTextButton } from '@material/web/button/text-button.js';
import { MdElevatedButton } from '@material/web/button/elevated-button.js';
import { MdIconButton } from '@material/web/iconbutton/icon-button.js';
import { MdFilledIconButton } from '@material/web/iconbutton/filled-icon-button.js';
import { MdFilledTonalIconButton } from '@material/web/iconbutton/filled-tonal-icon-button.js';
import { MdOutlinedIconButton } from '@material/web/iconbutton/outlined-icon-button.js';
import { MdList } from '@material/web/list/list.js';
import { MdListItem } from '@material/web/list/list-item.js';
import { MdAssistChip } from '@material/web/chips/assist-chip.js';
import { MdFilterChip } from '@material/web/chips/filter-chip.js';
import { MdSuggestionChip } from '@material/web/chips/suggestion-chip.js';
import { MdInputChip } from '@material/web/chips/input-chip.js';
import { MdChipSet } from '@material/web/chips/chip-set.js';
import { MdDivider } from '@material/web/divider/divider.js';
import { MdCircularProgress } from '@material/web/progress/circular-progress.js';
import { MdLinearProgress } from '@material/web/progress/linear-progress.js';
import { MdSwitch } from '@material/web/switch/switch.js';
import { MdCheckbox } from '@material/web/checkbox/checkbox.js';
import { MdRadio } from '@material/web/radio/radio.js';
import { MdOutlinedTextField } from '@material/web/textfield/outlined-text-field.js';
import { MdFilledTextField } from '@material/web/textfield/filled-text-field.js';
import { MdTabs } from '@material/web/tabs/tabs.js';
import { MdPrimaryTab } from '@material/web/tabs/primary-tab.js';

// ── Wrapped elements (one createComponent per element) ───────────────────────
export const FilledButton = createComponent({ react: React, tagName: 'md-filled-button', elementClass: MdFilledButton });
export const TonalButton = createComponent({ react: React, tagName: 'md-filled-tonal-button', elementClass: MdFilledTonalButton });
export const OutlinedButton = createComponent({ react: React, tagName: 'md-outlined-button', elementClass: MdOutlinedButton });
export const TextButton = createComponent({ react: React, tagName: 'md-text-button', elementClass: MdTextButton });
export const ElevatedButton = createComponent({ react: React, tagName: 'md-elevated-button', elementClass: MdElevatedButton });

export const IconButton = createComponent({ react: React, tagName: 'md-icon-button', elementClass: MdIconButton });
export const FilledIconButton = createComponent({ react: React, tagName: 'md-filled-icon-button', elementClass: MdFilledIconButton });
export const TonalIconButton = createComponent({ react: React, tagName: 'md-filled-tonal-icon-button', elementClass: MdFilledTonalIconButton });
export const OutlinedIconButton = createComponent({ react: React, tagName: 'md-outlined-icon-button', elementClass: MdOutlinedIconButton });

export const List = createComponent({ react: React, tagName: 'md-list', elementClass: MdList });
export const ListItem = createComponent({ react: React, tagName: 'md-list-item', elementClass: MdListItem });
export const AssistChip = createComponent({ react: React, tagName: 'md-assist-chip', elementClass: MdAssistChip });
export const FilterChip = createComponent({ react: React, tagName: 'md-filter-chip', elementClass: MdFilterChip });
export const SuggestionChip = createComponent({ react: React, tagName: 'md-suggestion-chip', elementClass: MdSuggestionChip });
export const InputChip = createComponent({ react: React, tagName: 'md-input-chip', elementClass: MdInputChip });
export const ChipSet = createComponent({ react: React, tagName: 'md-chip-set', elementClass: MdChipSet });
export const Divider = createComponent({ react: React, tagName: 'md-divider', elementClass: MdDivider });
export const CircularProgress = createComponent({ react: React, tagName: 'md-circular-progress', elementClass: MdCircularProgress });
export const LinearProgress = createComponent({ react: React, tagName: 'md-linear-progress', elementClass: MdLinearProgress });
export const Switch = createComponent({ react: React, tagName: 'md-switch', elementClass: MdSwitch });
export const Checkbox = createComponent({ react: React, tagName: 'md-checkbox', elementClass: MdCheckbox });
export const Radio = createComponent({ react: React, tagName: 'md-radio', elementClass: MdRadio });
export const OutlinedTextField = createComponent({ react: React, tagName: 'md-outlined-text-field', elementClass: MdOutlinedTextField });
export const FilledTextField = createComponent({ react: React, tagName: 'md-filled-text-field', elementClass: MdFilledTextField });

// md-tabs emits a custom `change` event (not React's onChange) when the active tab moves; the events
// map surfaces it as an `onChange` prop. Read `activeTabIndex` off the target in the handler.
export const Tabs = createComponent({ react: React, tagName: 'md-tabs', elementClass: MdTabs, events: { onChange: 'change' } });
export const PrimaryTab = createComponent({ react: React, tagName: 'md-primary-tab', elementClass: MdPrimaryTab });

// CSS-custom-property bag (TS won't allow arbitrary `--x` keys on CSSProperties directly).
type CssVars = Record<string, string | number>;
const asStyle = (v: CssVars): React.CSSProperties => v as React.CSSProperties;

/** A Material Symbols glyph. */
function Glyph({ name, size }: { name: string; size: number | string }) {
  const fontSize = typeof size === 'number' ? `${size}px` : size;
  return (
    <span className="material-symbols-rounded" style={{ fontSize }}>
      {name}
    </span>
  );
}

// ── denseListVars — tuned md-list-item density for dashboards ─────────────────
// M3's stock two-line row is 72px — too tall for a dense surface. These tokens crush it to a
// dense-but-breathing ~52px (comfortable) / ~40px (compact) while keeping real ripple/focus/slots.
export function denseListVars(opts: {
  dense?: boolean;
  primary?: string;
  secondary?: string;
  trailing?: string;
  hover?: string;
} = {}): React.CSSProperties {
  const { dense = false, primary, secondary, trailing, hover } = opts;
  const vars: CssVars = {
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
  };
  if (primary) vars['--md-list-item-label-text-color'] = primary;
  if (secondary) {
    vars['--md-list-item-supporting-text-color'] = secondary;
    vars['--md-list-item-trailing-supporting-text-color'] = secondary;
    vars['--md-list-item-leading-icon-color'] = secondary;
    vars['--md-list-item-trailing-icon-color'] = secondary;
  }
  if (trailing) vars['--md-list-item-trailing-supporting-text-color'] = trailing;
  if (hover) vars['--md-list-item-hover-state-layer-color'] = hover;
  return asStyle(vars);
}

// variant → token-prefix (matches each component's --md-<prefix>-* namespace, @material/web v2.4).
const ICON_VARIANTS = {
  standard: { Comp: IconButton, prefix: '--md-icon-button' },
  filled: { Comp: FilledIconButton, prefix: '--md-filled-icon-button' },
  tonal: { Comp: TonalIconButton, prefix: '--md-filled-tonal-icon-button' },
  outlined: { Comp: OutlinedIconButton, prefix: '--md-outlined-icon-button' },
} as const;

const ACTION_VARIANTS = {
  filled: { Comp: FilledButton, prefix: '--md-filled-button' },
  tonal: { Comp: TonalButton, prefix: '--md-filled-tonal-button' },
  outlined: { Comp: OutlinedButton, prefix: '--md-outlined-button' },
  text: { Comp: TextButton, prefix: '--md-text-button' },
} as const;

export interface IconBtnProps {
  icon?: string;
  iconSize?: number | string;
  size?: number | string;
  color?: string;
  variant?: keyof typeof ICON_VARIANTS;
  active?: boolean;
  activeBg?: string;
  containerColor?: string;
  title?: string;
  'aria-label'?: string;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

/** Real M3 icon button with ergonomic sizing/coloring (drop-in for Pro 4's `gvIconButton`). */
export function IconBtn({
  icon,
  iconSize = 18,
  size = 40,
  color,
  variant = 'standard',
  active = false,
  activeBg,
  containerColor,
  title,
  'aria-label': ariaLabel,
  disabled,
  onClick,
  style,
  children,
}: IconBtnProps) {
  const { Comp, prefix } = ICON_VARIANTS[variant];
  const iconCss = typeof iconSize === 'number' ? `${iconSize}px` : iconSize;
  const sizeCss = typeof size === 'number' ? `${size}px` : size;
  const vars: CssVars = { '--md-icon-button-icon-size': iconCss };
  if (variant === 'standard') {
    vars['--md-icon-button-state-layer-width'] = sizeCss;
    vars['--md-icon-button-state-layer-height'] = sizeCss;
  } else {
    vars[`${prefix}-container-width`] = sizeCss;
    vars[`${prefix}-container-height`] = sizeCss;
  }
  if (color) vars[`${prefix}-icon-color`] = color;
  if (containerColor && variant !== 'standard') vars[`${prefix}-container-color`] = containerColor;
  const activeHost: CssVars =
    active && activeBg ? { background: activeBg, borderRadius: '50%' } : {};
  return (
    <Comp
      title={title}
      aria-label={ariaLabel ?? title}
      disabled={disabled}
      onClick={onClick}
      style={asStyle({ ...vars, ...activeHost, ...(style as CssVars) })}
    >
      {icon ? <Glyph name={icon} size={iconCss} /> : children}
    </Comp>
  );
}

export interface ActionBtnProps {
  variant?: keyof typeof ACTION_VARIANTS;
  icon?: string;
  iconSize?: number | string;
  children?: React.ReactNode;
  containerColor?: string;
  labelColor?: string;
  outlineColor?: string;
  height?: number;
  labelSize?: number | string;
  title?: string;
  'aria-label'?: string;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
}

/** Real M3 text/tonal/outlined/filled button with ergonomic coloring/sizing. */
export function ActionBtn({
  variant = 'text',
  icon,
  iconSize = 14,
  children,
  containerColor,
  labelColor,
  outlineColor,
  height,
  labelSize,
  title,
  'aria-label': ariaLabel,
  disabled,
  onClick,
  style,
}: ActionBtnProps) {
  const { Comp, prefix } = ACTION_VARIANTS[variant];
  const vars: CssVars = {};
  if (height != null) vars[`${prefix}-container-height`] = `${height}px`;
  if (labelSize != null) {
    vars[`${prefix}-label-text-size`] = typeof labelSize === 'number' ? `${labelSize}px` : labelSize;
  }
  if (containerColor && (variant === 'filled' || variant === 'tonal')) {
    vars[`${prefix}-container-color`] = containerColor;
  }
  if (labelColor) {
    vars[`${prefix}-label-text-color`] = labelColor;
    vars[`${prefix}-icon-color`] = labelColor;
  }
  if (outlineColor && variant === 'outlined') vars[`${prefix}-outline-color`] = outlineColor;
  return (
    <Comp
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      style={asStyle({ ...vars, ...(style as CssVars) })}
    >
      {icon ? (
        <span slot="icon" className="material-symbols-rounded" style={{ fontSize: iconSize }}>
          {icon}
        </span>
      ) : null}
      {children != null ? <span>{children}</span> : null}
    </Comp>
  );
}
