/**
 * Domain constants — ported verbatim from `apps/web/src/01-core.js` so behavior stays faithful.
 */

import type { Priority } from './types';

/** Default priority tiers (Pro 4 `DEF_PRI`). `weight` drives ordering; `shaila` is the special tier. */
export const DEFAULT_PRIORITIES: Priority[] = [
  { id: 'shaila', label: 'Shaila', color: '#C8A84C', weight: 5, isShaila: true },
  { id: 'now', label: 'Now', color: '#E09AB8', weight: 3 },
  { id: 'today', label: 'Today', color: '#E0B472', weight: 2 },
  { id: 'eventually', label: 'Eventually', color: '#7EB0DE', weight: 1 },
];

/** Hours after which a task at each tier counts as "aged" (Pro 4 `DEF_AGE_THRESHOLDS`). */
export const DEFAULT_AGE_THRESHOLDS: Record<string, number> = {
  shaila: 24,
  now: 48,
  today: 120,
  eventually: 336,
};

/** Mrs. W priority windows (local time). In-window → highest non-shaila tier; else lowest. */
export const MRSW_WINDOWS = {
  monThu: { start: '08:30', end: '13:00' },
  fri: { start: '08:30', end: '10:00' },
} as const;

/** 16 calm accent colors assigned at random to brand-new tasks (Pro 4 `PALETTE`). */
export const PALETTE = [
  '#C8A84C', '#E09AB8', '#E0B472', '#7EB0DE', '#9BD4A0', '#D4A0D8', '#E0A090', '#A0D0C8',
  '#C8B8E0', '#E0C890', '#90BCE0', '#D8B090', '#A8C8A0', '#E8A0A0', '#A0A8E0', '#C0D890',
];

/** Rotating add-box placeholder prompts (Pro 4 `PROMPTS`). */
export const PROMPTS = [
  'Just one small thing...',
  'Start anywhere...',
  'Brain dump mode...',
  'Five minutes is enough...',
  'Clear your mind...',
];
