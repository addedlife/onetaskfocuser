/**
 * Domain model — the core data shapes the whole app revolves around.
 *
 * ⚠️ FIDELITY TODO (Phase 0.2): these are derived from APP_FEATURE_MAP.md + APP_ATLAS.md. Before the
 * Store/persistence layer is built (Phase 2), verify every field name and shape against the REAL Pro 4
 * data in `apps/web/src/01-core.js` (the `Store` object, `_flattenTasks`/`_saveV5`/`_extractSettings`)
 * and `apps/web/src/08-app-split/App.jsx` task/shaila handlers, then reconcile here. The persistence
 * model is "v5" = one Firestore document per task.
 */

export type EnergyLevel = 'high' | 'low';

/** A blocked task: hidden/deprioritized until `until`, with an optional reflected reason. */
export interface BlockInfo {
  until: number; // epoch ms
  reason?: string;
}

/** A single task. */
export interface Task {
  id: string;
  title: string;
  listId: string;

  /** Priority tier id (see Priority). Color is usually inherited from the tier or a random accent. */
  priorityId: string;
  color?: string;

  /** Energy match (⚡ high / 🌊 low) so the queue can match tasks to the user's current energy. */
  energy?: EnergyLevel;

  createdAt: number; // epoch ms — drives aging ("3 days waiting") + Mrs. W windows
  updatedAt?: number;
  completedAt?: number | null; // null/undefined = open; set = done
  goodEnough?: boolean; // completed via "good enough"

  /** Context tags like @home / @phone. */
  contextTags?: string[];

  blocked?: BlockInfo | null;
  parkedUntil?: number | null; // "park til tomorrow"
  pinned?: boolean; // pinned / moved-to-top

  /** Subtask grouping ("shattered into crystals"). */
  groupId?: string | null;
  parentId?: string | null;
  order?: number; // manual drag order within a list/group

  mrsW?: boolean; // belongs to the recurring "Mrs. W" priority window
  firstStep?: string; // AI-suggested first step
}

/** A user-defined priority tier (Shaila / Now / Today / Eventually / custom…). */
export interface Priority {
  id: string;
  label: string;
  color: string;
  order: number;
  builtin?: boolean;
}

/** A named task list. */
export interface TaskList {
  id: string;
  name: string;
  order?: number;
}

export type ShailaStatus = 'pending' | 'answered' | 'gotback';

/** Research output attached to a shaila (web + Sefaria sources). */
export interface ShailaResearch {
  report: string;
  sources?: { title: string; url?: string; summary?: string }[];
  generatedAt?: number;
}

/**
 * A shaila — a halachic question being tracked (the highest-priority surface).
 * Lifecycle: asked → (answered by someone) → got back to the asker.
 */
export interface Shaila {
  id: string;
  synopsis: string; // AI-generated, editable; regen/dictate supported
  question: string; // the full question
  asker?: string; // who asked you
  answerer?: string; // who you asked / who answered
  answer?: string; // empty until filled ("[waiting for answer]")
  status: ShailaStatus;
  gotBack?: boolean; // you relayed the answer back to the asker
  research?: ShailaResearch | null;
  linkedTaskId?: string | null;
  createdAt: number;
  updatedAt?: number;
}

/** AI provider selection (default: Claude, per owner preference). */
export type AiProvider = 'claude' | 'gemini';

/** Top-level persisted settings (theme, AI, lists, priorities…). */
export interface AppSettings {
  schemeId: string;
  aiProvider: AiProvider;
  activeListId: string;
  lists: TaskList[];
  priorities: Priority[];
}
