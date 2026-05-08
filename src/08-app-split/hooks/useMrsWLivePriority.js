import { useEffect, useState } from 'react';
import { getMrsWPriority } from '../../01-core.js';

export function useMrsWLivePriority({ pris, windows }) {
  const [mrsWPriLive, setMrsWPriLive] = useState(null);

  useEffect(() => {
    const refresh = () => setMrsWPriLive(getMrsWPriority(pris, windows));
    refresh();
    const timer = setInterval(refresh, 60000);
    return () => clearInterval(timer);
  }, [pris, windows]);

  return mrsWPriLive;
}
