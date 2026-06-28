/**
 * deriveAccents — the ONE shared accent-derivation used by every surface (the web suite, the
 * DeskPhone surface, and the embedded Shailos app). Material 3 wants three accent families, but the
 * themes define a single `primary`. Rather than hand-author N×3 colors, we derive the other two:
 *
 *   secondary = same hue, ~45% of the saturation   → a muted companion (M3's intent for "secondary")
 *   tertiary  = hue + 60°, mildly muted/clamped     → a distinct, complementary accent
 *
 * so every theme gets harmonious, distinct accents for free. Pro 4 re-derived this in three places;
 * Pro 5 centralizes it here and every surface imports it.
 */

export interface DerivedAccents {
  secondary: string;
  onSecondary: string;
  tertiary: string;
  onTertiary: string;
}

interface Hsl {
  h: number; // 0–360
  s: number; // 0–1
  l: number; // 0–1
}

function hexToHsl(hex: string): Hsl {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let hue = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        hue = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        hue = (b - r) / d + 2;
        break;
      default:
        hue = (r - g) / d + 4;
    }
    hue /= 6;
  }
  return { h: hue * 360, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const hn = (((h % 360) + 360) % 360) / 360;
  const channel = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = channel(p, q, hn + 1 / 3);
    g = channel(p, q, hn);
    b = channel(p, q, hn - 1 / 3);
  }
  const to = (v: number): string =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

/** White or near-black for legible text on a given fill, by perceived luminance. */
export function onColor(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 140 ? '#FFFFFF' : '#1A1A1A';
}

const FALLBACK_PRIMARY = '#00796B';

export function deriveAccents(primaryHex: string): DerivedAccents {
  const clean = (primaryHex || '').replace('#', '');
  const safe = /^[0-9a-f]{6}$/i.test(clean) ? `#${clean}` : FALLBACK_PRIMARY;
  const { h, s, l } = hexToHsl(safe);
  const secondary = hslToHex(h, Math.max(0, s * 0.45), l);
  const tertiary = hslToHex(h + 60, Math.max(0.18, Math.min(s * 0.85, 0.7)), l);
  return {
    secondary,
    onSecondary: onColor(secondary),
    tertiary,
    onTertiary: onColor(tertiary),
  };
}
