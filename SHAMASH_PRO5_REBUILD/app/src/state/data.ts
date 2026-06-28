import { create } from 'zustand';
import type { Task, Shaila, ShailaStatus } from '@/lib/types';
import { createStorage } from '@/services/storage';

const storage = createStorage();

/**
 * Domain data store — tasks + shailos, hydrated from and persisted through the storage backend (mock in
 * dev, Firestore later). Mutations write through to storage so changes survive a reload. Actions are
 * minimal for the current vertical slice; the full handler set arrives with each feature.
 */
interface DataState {
  tasks: Task[];
  shailos: Shaila[];
  loaded: boolean;
  hydrate: () => Promise<void>;
  toggleDone: (id: string) => void;
  markGotBack: (id: string, value: boolean) => void;
}

export const useData = create<DataState>((set, get) => ({
  tasks: [],
  shailos: [],
  loaded: false,

  hydrate: async () => {
    const s = await storage.load();
    set({ tasks: s.tasks, shailos: s.shailos, loaded: true });
  },

  toggleDone: (id) => {
    const tasks = get().tasks.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t));
    set({ tasks });
    void storage.saveTasks(tasks);
  },

  markGotBack: (id, value) => {
    const status: ShailaStatus = value ? 'got_back' : 'answered';
    const shailos = get().shailos.map((q) => (q.id === id ? { ...q, status } : q));
    set({ shailos });
    void storage.saveShailos(shailos);
  },
}));
