import type { Task, Priority } from './types';
import { gP } from './priorities';

/**
 * The non-AI smart sort (Pro 4 `optTasks`). Returns active (scored) tasks, then blocked (always bottom),
 * then completed. Scoring blends tier weight, age (scaled by how high the tier is), keyword urgency,
 * a stale bonus past 48h, an `isShaila` boost, and a Mrs. W nudge. Subtask groups (`parentTask`) are
 * scored by their parent's weight only (no age drift) and stay contiguous; any pinned subtask pins the group.
 */
export function optTasks(tasks: Task[], priorities: Priority[]): Task[] {
  const now = Date.now();
  const comp = tasks.filter((t) => t.completed);
  const blocked = tasks.filter((t) => !t.completed && t.blocked);
  const pin = tasks.filter((t) => !t.completed && !t.blocked && t.pinned && !t.parentTask);
  const unp = tasks.filter((t) => !t.completed && !t.blocked && !t.pinned && !t.parentTask);

  const mW = Math.max(...priorities.filter((p) => !p.deleted).map((p) => p.weight), 1);
  const scoreTask = (t: Task): number => {
    const p = gP(priorities, t.priority);
    const age = (now - t.createdAt) / 36e5;
    const n = p.weight / mW;
    const sr = n > 0.8 ? 0.3 : n > 0.5 ? 0.8 : 1.5;
    const tu = /\b(urgent|asap|deadline|critical|shaila|shailos|psak)\b/i.test(t.text)
      ? 5
      : /\b(soon|important|meeting|call)\b/i.test(t.text)
        ? 2
        : /\b(maybe|someday|eventually)\b/i.test(t.text)
          ? -2
          : 0;
    const ageBonus = Math.min(age * sr, 30);
    const sb = age > 48 ? Math.min(Math.log2(age / 48) * 3, 10) : 0;
    const sh = p.isShaila ? 50 : 0;
    const mw = t.mrsW ? 3 : 0;
    return p.weight * 100 + ageBonus + tu + sb + sh + mw;
  };

  // Group subtasks by their parent's text, ordered by stepIndex.
  const groupMap: Record<string, Task[]> = {};
  tasks
    .filter((t) => !t.completed && !t.blocked && t.parentTask)
    .forEach((t) => {
      (groupMap[t.parentTask as string] ||= []).push(t);
    });
  Object.values(groupMap).forEach((subs) =>
    subs.sort((a, b) => (a.stepIndex || 0) - (b.stepIndex || 0)),
  );

  const pinnedGroupNames = new Set(
    Object.entries(groupMap)
      .filter(([, subs]) => subs.some((s) => s.pinned))
      .map(([gn]) => gn),
  );

  const scoreGroup = (gn: string, subs: Task[]): number => {
    const parent = unp.find((t) => t.text === gn);
    if (parent) return gP(priorities, parent.priority).weight * 100;
    return gP(priorities, subs[0]?.priority).weight * 100;
  };

  const groupParentNames = new Set(Object.keys(groupMap));

  type Scored =
    | { type: 'task'; task: Task; s: number }
    | { type: 'group'; subs: Task[]; s: number };

  const scored: Scored[] = [
    ...unp
      .filter((t) => !groupParentNames.has(t.text))
      .map((t): Scored => ({ type: 'task', task: t, s: scoreTask(t) })),
    ...Object.entries(groupMap)
      .filter(([gn]) => !pinnedGroupNames.has(gn))
      .map(([gn, subs]): Scored => ({ type: 'group', subs, s: scoreGroup(gn, subs) })),
  ];
  scored.sort((a, b) => b.s - a.s);

  const final: Task[] = [...pin];
  [...pinnedGroupNames].forEach((gn) => final.push(...(groupMap[gn] || [])));
  scored.forEach((item) => {
    if (item.type === 'task') final.push(item.task);
    else final.push(...item.subs);
  });

  // Dedup by id (safety net), then blocked + completed at the bottom.
  const seen = new Set<string>();
  const deduped = final.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });

  return [...deduped, ...blocked, ...comp];
}
