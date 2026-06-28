/**
 * Mock seed data — dev-only, real Pro 4 shapes (verified against 01-core.js). Lets surfaces render
 * real-shaped content with zero risk to live Firestore. Phase 2's Store reads/writes these same shapes.
 */

import type { Task, Shaila, TaskList, AppSettings } from '@/lib/types';
import { DEFAULT_PRIORITIES } from '@/lib/constants';

const now = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const MOCK_LISTS: TaskList[] = [{ id: 'default', name: 'My Tasks', order: 0 }];

/** Re-export the real default tiers as the mock priority set. */
export const MOCK_PRIORITIES = DEFAULT_PRIORITIES;

export const MOCK_TASKS: Task[] = [
  {
    id: 't1',
    text: 'Call the plumber about the kitchen leak',
    listId: 'default',
    priority: 'now',
    createdAt: now - 2 * HOUR,
    energy: 'low',
    contextTags: ['@phone'],
  },
  {
    id: 't2',
    text: 'Draft the shul newsletter',
    listId: 'default',
    priority: 'today',
    createdAt: now - 3 * DAY,
    energy: 'high',
  },
  {
    id: 't3',
    text: 'Fix the broken porch light',
    listId: 'default',
    priority: 'eventually',
    createdAt: now - 9 * DAY,
    blocked: true,
    blockedUntil: now + DAY,
  },
  {
    id: 't4',
    text: 'Review the budget spreadsheet',
    listId: 'default',
    priority: 'today',
    createdAt: now - 5 * HOUR,
    completed: true,
    completedAt: now - 4 * HOUR,
  },
  {
    id: 't5',
    text: 'Email the contractor back',
    listId: 'default',
    priority: 'today',
    createdAt: now - 2 * DAY,
    completed: true,
    completedAt: now - 1 * DAY,
  },
  {
    id: 't6',
    text: 'Pick up the dry cleaning',
    listId: 'default',
    priority: 'eventually',
    createdAt: now - 3 * DAY,
    completed: true,
    completedAt: now - 2 * DAY,
  },
  {
    id: 't7',
    text: 'Confirm the minyan times',
    listId: 'default',
    priority: 'now',
    createdAt: now - 4 * DAY,
    completed: true,
    completedAt: now - 3 * DAY,
  },
];

export const MOCK_SHAILOS: Shaila[] = [
  {
    id: 's1',
    synopsis: 'Borer when sorting silverware on Shabbos',
    content: 'Is it permitted to sort a mixed pile of clean silverware on Shabbos for immediate use?',
    askerName: 'Mrs. Klein',
    answererName: 'Rabbi Stern',
    answer: '',
    status: 'pending',
    createdAt: now - 6 * HOUR,
  },
  {
    id: 's2',
    synopsis: 'Bracha on a blended fruit smoothie',
    content: 'What bracha is recited on a smoothie of blended fruit, where the fruit is no longer recognizable?',
    askerName: 'Dovid',
    answererName: 'Rabbi Stern',
    answer: 'Shehakol — once the fruit is fully blended and unrecognizable, it is no longer ha-etz.',
    status: 'got_back',
    createdAt: now - 2 * DAY,
  },
];

export const MOCK_SETTINGS: AppSettings = {
  schemeId: 'claude',
  aiProvider: 'claude',
  activeListId: 'default',
  lists: MOCK_LISTS,
  priorities: DEFAULT_PRIORITIES,
};
