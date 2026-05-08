import { useEffect, useState } from 'react';

export function useClockTicks() {
  const [clockTime, setClockTime] = useState(() => new Date());
  const [minTick, setMinTick] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => setClockTime(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => setMinTick(t => t + 1), 60000);
    return () => clearInterval(iv);
  }, []);

  return { clockTime, minTick };
}
