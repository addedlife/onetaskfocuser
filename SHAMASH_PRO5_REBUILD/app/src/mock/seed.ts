/**
 * Mock seed data — used in dev so surfaces render real-shaped data with zero risk to live Firestore.
 * The real Store (Phase 2) reads/writes the same shapes; flip a flag to use live data when ready.
 */

import type { Task, Shaila, Priority, TaskList, AppSettings } from '@/lib/types';

const now = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const MOCK_LISTS: TaskList[] = [{ id: 'inbox', name: 'Inbox', order: 0 }];

/** Built-in priority tiers. Shaila is first — the highest-priority surface, in category gold. */
export const MOCK_PRIORITIES: Priority[] = [
  { id: 'shaila', label: 'Shaila', color: '#C9923C', order: 0, builtin: true },
  { id: 'now', label: 'Now', color: '#D93025', order: 1, builtin: true },
  { id: 'today', label: 'Today', color: '#1A73E8', order: 2, builtin: true },
  { id: 'eventually', label: 'Eventually', color: '#5F6368', order: 3, builtin: true },
];

export const MOCK_TASKS: Task[] = [
  {
    id: 't1',
    title: 'Call the plumber about the kitchen leak',
    listId: 'inbox',
    priorityId: 'now',
    createdAt: now - 2 * HOUR,
    energy: 'low',
    contextTags: ['@phone'],
  },
  {
    id: 't2',
    title: 'Draft the shul newsletter',
    listId: 'inbox',
    priorityId: 'today',
    createdAt: now - 3 * DAY,
    energy: 'high',
  },
  {
    id: 't3',
    title: 'Fix the broken porch light',
    listId: 'inbox',
    priorityId: 'eventually',
    createdAt: now - 9 * DAY,
    blocked: { until: now + DAY, reason: 'waiting on a replacement part' },
  },
  {
    id: 't4',
    title: 'Review the budget spreadsheet',
    listId: 'inbox',
    priorityId: 'today',
    createdAt: now - 5 * HOUR,
    completedAt: now - HOUR,
  },
];

export const MOCK_SHAILOS: Shaila[] = [
  {
    id: 's1',
    synopsis: 'Borer when sorting silverware on Shabbos',
    question: 'Is it permitted to sort a mixed pile of clean silverware on Shabbos for immediate use?',
    asker: 'Mrs. Klein',
    answerer: 'Rabbi Stern',
    answer: '',
    status: 'pending',
    createdAt: now - 6 * HOUR,
  },
  {
    id: 's2',
    synopsis: 'Bracha on a blended fruit smoothie',
    question: 'What bracha is recited on a smoothie of blended fruit, where the fruit is no longer recognizable?',
    asker: 'Dovid',
    answerer: 'Rabbi Stern',
    answer: 'Shehakol — once the fruit is fully blended and unrecognizable, it is no longer ha-etz.',
    status: 'gotback',
    gotBack: true,
    createdAt: now - 2 * DAY,
  },
];

export const MOCK_SETTINGS: AppSettings = {
  schemeId: 'claude',
  aiProvider: 'claude',
  activeListId: 'inbox',
  lists: MOCK_LISTS,
  priorities: MOCK_PRIORITIES,
};
