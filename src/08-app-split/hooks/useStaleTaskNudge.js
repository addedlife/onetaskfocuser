import { useEffect, useState } from 'react';

export function useStaleTaskNudge({ actT, loaded, pris }) {
  const [staleNudge, setStaleNudge] = useState(null);

  useEffect(() => {
    if (!loaded || !pris.length) return;
    const now = Date.now();
    const week = 7 * 86400000;
    const resnooze = 3 * 86400000;
    const candidate = actT
      .filter(t =>
        !t.completed && !t.blocked && !t.parentTask &&
        (now - (t.createdAt || 0)) > week &&
        (!t.staleNudgedAt || (now - t.staleNudgedAt) > resnooze)
      )
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0];

    if (candidate) {
      const timer = setTimeout(() => setStaleNudge(candidate), 3000);
      return () => clearTimeout(timer);
    }
  }, [actT, loaded, pris]);

  return { setStaleNudge, staleNudge };
}
