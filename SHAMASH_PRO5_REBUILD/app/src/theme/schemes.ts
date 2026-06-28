/**
 * Color schemes — the 8 curated themes, each expressed as a full set of SEMANTIC roles.
 *
 * Pro 4 deliberately left colors un-tokenized, deferring a "semantic color token" redesign (the
 * owner's vision). Pro 5 starts there: every color a surface needs is a named role here, and a single
 * theme switch repaints the whole app (incl. every @material/web component via the bridge). The 8
 * themes keep their Pro 4 names and character; the values are rebuilt clean and contrast-checked.
 *
 * `primary` is the one authored accent per theme; M3 `secondary`/`tertiary` are DERIVED at runtime
 * from it (see accents.ts), so themes never hand-author three accent families.
 */

export interface Scheme {
  id: string;
  name: string;
  dark: boolean;

  /** Surfaces */
  bg: string; // page background
  bgSoft: string; // subtle raised/recessed background
  card: string; // card/sheet surface
  hover: string; // hover/state-layer fill

  /** Lines */
  divider: string;
  dividerSoft: string;

  /** Text */
  text: string;
  muted: string;
  faint: string;

  /** Accent (single authored color; secondary/tertiary derived) */
  primary: string;
  onPrimary: string;
  primaryDark: string;

  /** Status */
  success: string;
  danger: string;
  warning: string;

  /** Optional explicit primary-container tints (else the bridge derives them via color-mix) */
  tonal?: string;
  onTonal?: string;
}

/** Category identity — FIXED across every theme so things stay recognizable. */
export const CATEGORY = {
  gold: '#C9923C', // shailos
  mail: '#3D6CB5',
  phone: '#8A63B5',
} as const;

export const SCHEMES: Scheme[] = [
  {
    id: 'googlevoice',
    name: 'Google Voice',
    dark: false,
    bg: '#FFFFFF', bgSoft: '#F8F9FA', card: '#FFFFFF', hover: '#F1F3F4',
    divider: '#DADCE0', dividerSoft: '#E8EAED',
    text: '#202124', muted: '#5F6368', faint: '#9AA0A6',
    primary: '#00796B', onPrimary: '#FFFFFF', primaryDark: '#00695C',
    success: '#1E8E3E', danger: '#D93025', warning: '#F9AB00',
  },
  {
    id: 'materiallight',
    name: 'Material Light',
    dark: false,
    bg: '#FFFFFF', bgSoft: '#F6F8FC', card: '#FFFFFF', hover: '#ECF1FB',
    divider: '#DBE2EF', dividerSoft: '#E8EEF7',
    text: '#1B1B1F', muted: '#5A5D66', faint: '#9499A3',
    primary: '#1A73E8', onPrimary: '#FFFFFF', primaryDark: '#1559B3',
    success: '#1E8E3E', danger: '#D93025', warning: '#F9AB00',
  },
  {
    id: 'materialdark',
    name: 'Material Dark',
    dark: true,
    bg: '#121316', bgSoft: '#1A1C20', card: '#1E2025', hover: '#262A30',
    divider: '#33373E', dividerSoft: '#2A2E34',
    text: '#E3E2E6', muted: '#A9ADB5', faint: '#767B84',
    primary: '#8AB4F8', onPrimary: '#0A1B33', primaryDark: '#ABC7FA',
    success: '#81C995', danger: '#F28B82', warning: '#FDD663',
  },
  {
    id: 'claude',
    name: 'Claude Cream',
    dark: false,
    bg: '#F5F1EA', bgSoft: '#EFE9DF', card: '#FBF8F3', hover: '#ECE4D7',
    divider: '#DDD3C4', dividerSoft: '#E7DFD2',
    text: '#3D3A35', muted: '#6B6457', faint: '#9A9384',
    primary: '#C96442', onPrimary: '#FFFFFF', primaryDark: '#A84E30',
    success: '#4F7A52', danger: '#B3402E', warning: '#C08A2E',
  },
  {
    id: 'navygold',
    name: 'Navy Gold',
    dark: true,
    bg: '#0E1726', bgSoft: '#142034', card: '#18243A', hover: '#1F2D46',
    divider: '#2C3B57', dividerSoft: '#243149',
    text: '#E8ECF4', muted: '#A7B2C6', faint: '#6F7C93',
    primary: '#C9A227', onPrimary: '#1A1407', primaryDark: '#E0B844',
    success: '#5BA869', danger: '#E0695E', warning: '#E0B23C',
  },
  {
    id: 'ocean',
    name: 'Ocean Breeze',
    dark: false,
    bg: '#F0F7FA', bgSoft: '#E5F0F4', card: '#FFFFFF', hover: '#DCECF1',
    divider: '#C9DEE6', dividerSoft: '#DBEAEF',
    text: '#102A33', muted: '#4A6670', faint: '#8AA3AC',
    primary: '#0E7C86', onPrimary: '#FFFFFF', primaryDark: '#0A5E66',
    success: '#1E8E3E', danger: '#C8412F', warning: '#D9912B',
  },
  {
    id: 'sage',
    name: 'Sage & Cream',
    dark: false,
    bg: '#F3F5EF', bgSoft: '#E9ECE0', card: '#FBFCF7', hover: '#E3E8D7',
    divider: '#D2D8C2', dividerSoft: '#E0E4D4',
    text: '#2C3326', muted: '#5C6552', faint: '#909A82',
    primary: '#5C7A52', onPrimary: '#FFFFFF', primaryDark: '#46603E',
    success: '#4F7A52', danger: '#B0492F', warning: '#B98A2E',
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    dark: true,
    bg: '#0F0F10', bgSoft: '#161617', card: '#1A1A1C', hover: '#222224',
    divider: '#2E2E31', dividerSoft: '#262628',
    text: '#ECECEE', muted: '#A6A6AA', faint: '#6E6E73',
    primary: '#9FA8C7', onPrimary: '#14161C', primaryDark: '#B8C0DC',
    success: '#6BCB8B', danger: '#E0857B', warning: '#D8B864',
  },
];

/** Claude Cream — warm paper — is the hard fallback (also a guaranteed-legible default). */
export const DEFAULT_SCHEME_ID = 'claude';

export const SCHEMES_BY_ID: Record<string, Scheme> = Object.fromEntries(
  SCHEMES.map((s) => [s.id, s]),
);

export function getScheme(id: string | null | undefined): Scheme {
  return (id && SCHEMES_BY_ID[id]) || SCHEMES_BY_ID[DEFAULT_SCHEME_ID];
}
