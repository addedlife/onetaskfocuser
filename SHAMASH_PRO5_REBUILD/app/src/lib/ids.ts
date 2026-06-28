/** Short unique id (Pro 4 `uid`): base-36 timestamp + random suffix. */
export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * Canonical storage key from the email prefix (Pro 4 `canonicalUid`) — unifies email/password and
 * Google auth onto the same data folder. `rabbidanziger@…` → `rabbidanziger`.
 */
export function canonicalUid(user: { email?: string | null; uid?: string } | null): string | null {
  if (!user) return null;
  const prefix = (user.email || '').split('@')[0].toLowerCase().trim();
  return prefix || user.uid || null;
}
