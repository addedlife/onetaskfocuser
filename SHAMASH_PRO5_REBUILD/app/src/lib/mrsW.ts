import type { Priority } from './types';
import { MRSW_WINDOWS } from './constants';

interface TimeWindow {
  start: string;
  end: string;
}

/**
 * Mrs. W priority (Pro 4 `getMrsWPriority`): during the recurring windows (Mon–Thu 08:30–13:00,
 * Fri 08:30–10:00) return the highest non-shaila tier; otherwise the lowest tier.
 */
export function getMrsWPriority(
  priorities: Priority[],
  windows: { monThu: TimeWindow; fri: TimeWindow } = MRSW_WINDOWS,
): string {
  const now = new Date();
  const day = now.getDay();
  const timeVal = now.getHours() * 60 + now.getMinutes();
  const parse = (s: string): number => {
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m;
  };

  let isHighTime = false;
  if (day >= 1 && day <= 4) {
    isHighTime = timeVal >= parse(windows.monThu.start) && timeVal < parse(windows.monThu.end);
  } else if (day === 5) {
    isHighTime = timeVal >= parse(windows.fri.start) && timeVal < parse(windows.fri.end);
  }

  if (isHighTime) {
    const ap = priorities.filter((p) => !p.deleted && !p.isShaila).sort((a, b) => b.weight - a.weight);
    return ap[0]?.id || 'now';
  }
  const ap = priorities.filter((p) => !p.deleted).sort((a, b) => a.weight - b.weight);
  return ap[0]?.id || 'eventually';
}
