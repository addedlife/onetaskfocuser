/** Time-of-day greeting (Pro 4 `gG`). */
export function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** Per-day key for once-a-day dedup (Pro 4 `dayKey`). */
export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Today's Hebrew calendar date, transliterated (e.g. "13 Tammuz 5786"), via the platform Intl Hebrew
 * calendar — no dependency, safe on the Chromium/WebView2 targets.
 * NOTE: Intl rolls the Hebrew day at midnight, but halachically it advances at sunset. The sunset-aware
 * bump is a follow-up that hooks into `lib/shabbos.ts` (which already does the sunset calc + geolocation).
 */
export function hebrewDate(d = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-u-ca-hebrew', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(d);
  } catch {
    return '';
  }
}

/** Human duration from ms (Pro 4 `fmtMs`): `45m` · `2h 5m` · `3d 4h`. */
export function fmtMs(ms: number): string {
  const m = Math.round(ms / 6e4);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
