/** Time-of-day greeting (Pro 4 `gG`). */
export function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** Per-day key for once-a-day dedup (Pro 4 `dayKey`). */
export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Human duration from ms (Pro 4 `fmtMs`): `45m` · `2h 5m` · `3d 4h`. */
export function fmtMs(ms: number): string {
  const m = Math.round(ms / 6e4);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
