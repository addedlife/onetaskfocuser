/**
 * Domain model — the core data shapes, with field names VERIFIED against the real Pro 4
 * `apps/web/src/01-core.js` (see ANALYSIS/10-data-ai-core.md). Persistence is "v5" = one Firestore
 * document per task, reconstructed into an in-memory `lists[].tasks[]` blob.
 *
 * Still-open fidelity checks (Phase 0.3/0.6 — confirm in App.jsx / 04-components):
 *   `energy`, `contextTags`, `color`, `firstStep` are referenced by the Feature Map but not set in
 *   01-core; verify their exact field names before relying on them.
 */

export type EnergyLevel = 'high' | 'low';

/** A single task. (Pro 4 field names: text/priority/completed — NOT title/priorityId/completedAt.) */
export interface Task {
  id: string;
  text: string;
  priority: string; // priority tier id
  completed?: boolean;
  completedAt?: number; // epoch ms when marked done — powers the Insights completion charts
  createdAt: number; // epoch ms
  listId?: string; // which list (V5 per-task field; in-memory nested under its list)

  // lifecycle
  blocked?: boolean; // truthy → sinks to bottom of the queue
  blockedUntil?: number; // when the block lifts (set by BlockedModal — verify in 05-modals)
  snoozedUntil?: number; // "park til tomorrow"
  pinned?: boolean;

  // grouping ("shattered into crystals") — Pro 4 groups by the PARENT'S TEXT
  parentTask?: string;
  stepIndex?: number;

  // priority aging
  prioritySetAt?: number;
  autoAged?: boolean;
  agedFromPriId?: string;
  agedFromLabel?: string;

  mrsW?: boolean;
  shailaId?: string; // links a shaila-priority task to its shaila doc

  // Feature-Map fields — exact names TBD (see header)
  energy?: EnergyLevel;
  contextTags?: string[];
  color?: string;
  firstStep?: string;

  // persistence internals
  _sortIndex?: number;
  _lastModified?: number;
}

/** A priority tier. Pro 4 orders by `weight` (higher = more important), not `order`. */
export interface Priority {
  id: string;
  label: string;
  color: string;
  weight: number;
  isShaila?: boolean;
  deleted?: boolean; // soft-delete (retired tier, e.g. Before Shavuos)
  superPinned?: boolean;
}

/** A named task list. Tasks are nested under it at runtime; the store normalizes by id. */
export interface TaskList {
  id: string;
  name: string;
  order?: number;
}

export type ShailaStatus = 'pending' | 'answered' | 'got_back';

/** Research output attached to a shaila (web + Sefaria). Exact fields confirmed in Phase 0.9. */
export interface ShailaResearch {
  report: string;
  sources?: { title: string; url?: string; summary?: string }[];
  generatedAt?: number;
}

/** A shaila — the highest-priority surface. (Doc fields verified against 01-core.js.) */
export interface Shaila {
  id: string;
  content?: string; // the full question
  synopsis?: string; // short, AI-generated, editable
  status: ShailaStatus;
  date?: string; // "YYYY-MM-DD HH:MM"
  askerName?: string;
  answer?: string;
  answererName?: string;
  parsedShaila?: string;
  userId?: string;
  _taskAppSource?: boolean; // created from a shaila-priority task
  research?: ShailaResearch | null;
  linkedTaskId?: string;
  createdAt?: number;
  updatedAt?: number;
}

/** AI provider selection (Pro 5 default: Claude). */
export type AiProvider = 'claude' | 'gemini';

/** Persisted settings = the "AS" blob minus `lists`/`_lsModified`. */
export interface AppSettings {
  schemeId: string;
  aiProvider: AiProvider;
  activeListId: string;
  lists: TaskList[];
  priorities: Priority[];
}
