import type { Priority } from './types';
import { DEFAULT_PRIORITIES } from './constants';

/**
 * Resolve a priority by id (Pro 4 `gP`): the matching tier, else the last non-deleted tier, else the
 * lowest default. Always returns a Priority so callers never null-check.
 */
export function gP(priorities: Priority[], id: string | undefined): Priority {
  return (
    priorities.find((x) => x.id === id) ||
    priorities.filter((x) => !x.deleted).slice(-1)[0] ||
    DEFAULT_PRIORITIES[DEFAULT_PRIORITIES.length - 1]
  );
}

/** Non-deleted tiers, highest weight first. */
export function activePriorities(priorities: Priority[]): Priority[] {
  return priorities.filter((x) => !x.deleted).sort((a, b) => b.weight - a.weight);
}
