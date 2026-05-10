import { useMemo } from 'react';

export function useQueueDerivations({ AS, actT, focusModeActive, minTick, pris, searchQ }) {
  const shailaNumberMap = useMemo(() => {
    const shailaPriIds = new Set(pris.filter(p => p.isShaila || p.id === "shaila").map(p => p.id));
    const allShailaTasks = (AS?.lists || []).flatMap(l =>
      (l.tasks || []).filter(t => shailaPriIds.has(t.priority) && !t.isGetBackStep && !t.completed)
    ).sort((a,b) => (a.createdAt||0) - (b.createdAt||0));
    const m = {};
    allShailaTasks.forEach((t, i) => { if (t.shailaId) m[t.shailaId] = i + 1; });
    return m;
  }, [AS?.lists, pris]);

  const shailaStatusMap = useMemo(() => {
    const shailaPriIds = new Set(pris.filter(p => p.isShaila || p.id === "shaila").map(p => p.id));
    const allT = (AS?.lists || []).flatMap(l => l.tasks || []);
    const m = {};
    allT.filter(t => shailaPriIds.has(t.priority) && !t.isGetBackStep && t.shailaId).forEach(t => {
      const gb = allT.find(x => x.shailaId === t.shailaId && x.isGetBackStep);
      if (t.gotBackToAsker || gb?.completed) { m[t.shailaId] = "got_back"; }
      else if (t.shailaAnswer?.trim()) { m[t.shailaId] = "have_answer"; }
      else { m[t.shailaId] = "researching"; }
    });
    return m;
  }, [AS?.lists, pris]);

  const curEnergy = AS?.currentEnergy;
  const displayedActT = useMemo(() => {
    const now = Date.now();
    const unsnooze = actT.filter(t => !t.snoozedUntil || t.snoozedUntil <= now);
    if (!curEnergy) return unsnooze;
    return unsnooze.filter(t => !t.energy || t.energy === curEnergy);
  }, [actT, curEnergy, minTick]);

  const parentGroups = [...new Set(actT.filter(t=>t.parentTask).map(t=>t.parentTask))];
  const standaloneCount = actT.filter(t => !t.parentTask).length;
  const effectiveCount = standaloneCount + parentGroups.length;
  const overwhelmThreshold = AS?.overwhelmThreshold || 7;
  const isOverwhelmed = focusModeActive;
  const queueT = isOverwhelmed ? displayedActT.slice(0, 3) : displayedActT;

  const snoozedT = useMemo(() => {
    const now = Date.now();
    return actT.filter(t => t.snoozedUntil && t.snoozedUntil > now);
  }, [actT, minTick]);

  const queueTFiltered = useMemo(() => {
    const seenGroupsInQueue = new Set();
    return queueT.filter(t => {
      if (!t.parentTask) {
        if (!searchQ.trim()) return true;
        return t.text.toLowerCase().includes(searchQ.toLowerCase());
      }
      if (seenGroupsInQueue.has(t.parentTask)) return false;
      if (searchQ.trim()) {
        const groupSubs = actT.filter(s => s.parentTask === t.parentTask);
        const matches = t.parentTask.toLowerCase().includes(searchQ.toLowerCase()) ||
                        groupSubs.some(s => s.text.toLowerCase().includes(searchQ.toLowerCase()));
        if (!matches) return false;
      }
      seenGroupsInQueue.add(t.parentTask);
      return true;
    });
  }, [actT, queueT, searchQ]);

  return {
    curT: displayedActT[0] || null,
    displayedActT,
    effectiveCount,
    isOverwhelmed,
    overwhelmThreshold,
    queueT,
    queueTFiltered,
    shailaNumberMap,
    shailaStatusMap,
    snoozedT,
  };
}
