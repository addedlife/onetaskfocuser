import { useEffect, useRef, useState } from 'react';

export function useBlockedResumeNudge(actT) {
  const [blockedResume, setBlockedResume] = useState(null);
  const blockedTimers = useRef({});

  useEffect(() => {
    actT.filter(t => t.blocked && t.blockedUntil).forEach(t => {
      if (blockedTimers.current[t.id]) return;
      const remaining = Math.max(0, t.blockedUntil - Date.now());
      blockedTimers.current[t.id] = setTimeout(() => {
        setBlockedResume(t.id);
        delete blockedTimers.current[t.id];
      }, remaining);
    });

    Object.keys(blockedTimers.current).forEach(id => {
      if (!actT.find(t => t.id === id && t.blocked)) {
        clearTimeout(blockedTimers.current[id]);
        delete blockedTimers.current[id];
      }
    });
  }, [actT]);

  const clearBlockedTimer = (id) => {
    if (!blockedTimers.current[id]) return;
    clearTimeout(blockedTimers.current[id]);
    delete blockedTimers.current[id];
  };

  return { blockedResume, clearBlockedTimer, setBlockedResume };
}
