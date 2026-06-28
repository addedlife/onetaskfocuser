import type { Task, Priority } from './types';
import { DEFAULT_AGE_THRESHOLDS } from './constants';
import { gP } from './priorities';

/** Hours since the task was created (Pro 4 `getTaskAgeHours`). */
export function getTaskAgeHours(task: Task): number {
  return (Date.now() - task.createdAt) / 3_600_000;
}

/** Whether a task has exceeded its tier's age threshold (Pro 4 `isTaskAged`). */
export function isTaskAged(
  task: Task,
  priorities: Priority[],
  thresholds: Record<string, number> = DEFAULT_AGE_THRESHOLDS,
): boolean {
  const pri = gP(priorities, task.priority);
  const hours = getTaskAgeHours(task);
  const limit = thresholds[task.priority] ?? thresholds[pri.id] ?? 72;
  return hours > limit;
}

/**
 * Auto-aging (Pro 4 `applyTaskAging`): promote stale tasks up one tier. Eventually promotes after 14d,
 * other non-top tiers after 21d. Only the priority field changes (so AI reordering can't undo it).
 * Skips completed / pinned / snoozed / subtasks. Returns the new list + whether anything changed.
 */
export function applyTaskAging(
  tasks: Task[],
  priorities: Priority[],
): { tasks: Task[]; anyChanged: boolean } {
  const sorted = [...priorities].filter((p) => !p.deleted).sort((a, b) => b.weight - a.weight);
  if (sorted.length < 2) return { tasks, anyChanged: false };
  const now = Date.now();
  let anyChanged = false;
  const updated = tasks.map((t) => {
    if (t.completed || t.pinned || t.snoozedUntil || t.parentTask) return t;
    const priIdx = sorted.findIndex((p) => p.id === t.priority);
    if (priIdx <= 0) return t; // already at the highest tier
    const isLowest = priIdx === sorted.length - 1;
    const thresholdMs = (isLowest ? 14 : 21) * 24 * 60 * 60 * 1000;
    const enteredAt = t.prioritySetAt || t.createdAt || now;
    if (now - enteredAt >= thresholdMs) {
      anyChanged = true;
      const newPri = sorted[priIdx - 1];
      return {
        ...t,
        priority: newPri.id,
        prioritySetAt: now,
        autoAged: true,
        agedFromPriId: t.agedFromPriId || t.priority,
        agedFromLabel: t.agedFromLabel || sorted[priIdx].label,
      };
    }
    return t;
  });
  return { tasks: updated, anyChanged };
}
