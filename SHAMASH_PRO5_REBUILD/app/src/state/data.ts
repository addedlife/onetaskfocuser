import { create } from 'zustand';
import type { Task, Shaila } from '@/lib/types';
import { MOCK_TASKS, MOCK_SHAILOS } from '@/mock/seed';

/**
 * Domain data store — tasks + shailos. Seeded from mock in dev; Phase 2 swaps the source for the real
 * Firestore-backed Store (same shapes) behind a flag. Actions here are intentionally minimal for the
 * Phase-1 vertical slice; the full handler set arrives with each feature.
 */
interface DataState {
  tasks: Task[];
  shailos: Shaila[];
  toggleDone: (id: string) => void;
  markGotBack: (id: string, value: boolean) => void;
}

export const useData = create<DataState>((set) => ({
  tasks: MOCK_TASKS,
  shailos: MOCK_SHAILOS,
  toggleDone: (id) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id ? { ...t, completedAt: t.completedAt ? null : Date.now() } : t,
      ),
    })),
  markGotBack: (id, value) =>
    set((s) => ({
      shailos: s.shailos.map((q) =>
        q.id === id ? { ...q, gotBack: value, status: value ? 'gotback' : 'answered' } : q,
      ),
    })),
}));
