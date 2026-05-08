import { useEffect, useMemo, useState } from 'react';
import { dayKey, tipOfDay, TIPS } from '../../01-core.js';

export function useTipCarousel() {
  const [tipCat, setTipCat] = useState("All");
  const [tipViewIdx, setTipViewIdx] = useState(() => tipOfDay(dayKey()));

  const TIP_CATS = useMemo(() => ["All", ...new Set(TIPS.map(t => t.cat))], []);
  const tipCarouselList = useMemo(
    () => tipCat === "All" ? TIPS : TIPS.filter(t => t.cat === tipCat),
    [tipCat]
  );
  const tipCarouselIdx = Math.min(tipViewIdx, tipCarouselList.length - 1);
  const tipCarouselItem = tipCarouselList[tipCarouselIdx] || TIPS[0];

  useEffect(() => { setTipViewIdx(0); }, [tipCat]);

  return {
    setTipCat,
    setTipViewIdx,
    TIP_CATS,
    tipCarouselIdx,
    tipCarouselItem,
    tipCarouselList,
    tipCat,
  };
}
