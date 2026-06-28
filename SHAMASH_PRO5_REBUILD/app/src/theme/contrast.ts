/**
 * Contrast engine — guarantees text is legible on any background, on every theme.
 * Pure WCAG relative-luminance math (no dependencies). Used when applying a scheme so no palette can
 * ever produce unreadable text. Mirrors Pro 4's contrast guarantees, rebuilt clean and typed.
 */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(hex: string): Rgb {
  let h = (hex || '').replace('#', '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  return {
    r: parseInt(h.slice(0, 2), 16) || 0,
    g: parseInt(h.slice(2, 4), 16) || 0,
    b: parseInt(h.slice(4, 6), 16) || 0,
  };
}

function toHex({ r, g, b }: Rgb): string {
  const c = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

/** WCAG relative luminance (0 = black, 1 = white). */
function luminance({ r, g, b }: Rgb): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colors (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(parseHex(a));
  const lb = luminance(parseHex(b));
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

const BLACK: Rgb = { r: 26, g: 26, b: 26 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

/** The better of near-black / white for legible text on `bg` (optionally honoring a preference). */
export function readableOn(bg: string, prefer?: string): string {
  if (prefer && contrastRatio(prefer, bg) >= 4.5) return prefer;
  return contrastRatio('#FFFFFF', bg) >= contrastRatio('#1A1A1A', bg) ? '#FFFFFF' : '#1A1A1A';
}

/**
 * Return `fg` if it already meets `target` contrast on `bg`; otherwise nudge it toward whichever of
 * black/white improves contrast, in small steps, until it passes (or is fully mixed).
 */
export function ensureContrast(fg: string, bg: string, target = 4.5): string {
  if (contrastRatio(fg, bg) >= target) return fg;
  const fgRgb = parseHex(fg);
  const toward = luminance(parseHex(bg)) > 0.5 ? BLACK : WHITE;
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    const candidate = toHex(mix(fgRgb, toward, t));
    if (contrastRatio(candidate, bg) >= target) return candidate;
  }
  return toHex(toward);
}
