/**
 * Persistence abstraction. Surfaces/stores talk to a `StorageBackend`, never to Firestore directly, so
 * the real cloud store can be swapped in behind a flag without touching feature code.
 *
 * - `MockStorage` (dev default): localStorage-backed, seeded from mock. No network, zero risk to live data.
 * - `FirestoreStorage` (Phase 2, GATED): the faithful port of 01-core.js `Store` — v5 per-task docs,
 *   catastrophic-delete + transaction-freshness guards, self-healing listeners. Built in its own careful
 *   increment behind an explicit `?live=1` flag (see REBUILD_PLAN §6 / ANALYSIS/10 §1).
 */

import type { Task, Shaila, AppSettings } from '@/lib/types';
import { MOCK_TASKS, MOCK_SHAILOS, MOCK_SETTINGS } from '@/mock/seed';

export interface PersistedState {
  tasks: Task[];
  shailos: Shaila[];
  settings: AppSettings;
}

export interface StorageBackend {
  load(): Promise<PersistedState>;
  saveTasks(tasks: Task[]): Promise<void>;
  saveShailos(shailos: Shaila[]): Promise<void>;
  saveSettings(settings: AppSettings): Promise<void>;
}

const LS_KEY = 'shp5.mockstore';

/**
 * Dev storage backed by localStorage, seeded from mock on first run. Mirrors the real Store's
 * CATASTROPHIC-DELETE GUARD: never overwrites a non-empty task set with an empty one.
 */
export class MockStorage implements StorageBackend {
  private state: PersistedState;

  constructor() {
    this.state =
      this.read() ?? { tasks: MOCK_TASKS, shailos: MOCK_SHAILOS, settings: MOCK_SETTINGS };
  }

  private read(): PersistedState | null {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? (JSON.parse(raw) as PersistedState) : null;
    } catch {
      return null;
    }
  }

  private write(): void {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.state));
    } catch {
      /* storage unavailable — non-fatal */
    }
  }

  async load(): Promise<PersistedState> {
    return this.state;
  }

  async saveTasks(tasks: Task[]): Promise<void> {
    // Catastrophic-delete guard (faithful to Store): refuse to wipe a non-empty set with empty.
    if (tasks.length === 0 && this.state.tasks.length > 0) {
      console.warn('[storage] blocked empty-task overwrite');
      return;
    }
    this.state = { ...this.state, tasks };
    this.write();
  }

  async saveShailos(shailos: Shaila[]): Promise<void> {
    this.state = { ...this.state, shailos };
    this.write();
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    this.state = { ...this.state, settings };
    this.write();
  }
}

/** Factory — MockStorage in dev. The gated FirestoreStorage backend lands in its own increment. */
export function createStorage(): StorageBackend {
  return new MockStorage();
}
