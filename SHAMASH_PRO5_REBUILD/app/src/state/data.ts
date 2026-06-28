import { create } from 'zustand';
import type { Task, Shaila, ShailaStatus, Priority, EnergyLevel } from '@/lib/types';
import { createStorage } from '@/services/storage';
import { DEFAULT_PRIORITIES } from '@/lib/constants';
import { uid } from '@/lib/ids';

const storage = createStorage();

/**
 * Domain data store — tasks + shailos + priorities, hydrated from and persisted through the storage
 * backend (mock in dev, Firestore later). Mutations write through to storage so changes survive a reload.
 */
interface DataState {
  tasks: Task[];
  shailos: Shaila[];
  priorities: Priority[];
  loaded: boolean;
  hydrate: () => Promise<void>;
  addTask: (text: string, priority: string, energy?: EnergyLevel) => void;
  completeTask: (id: string) => void;
  toggleDone: (id: string) => void;
  parkTask: (id: string) => void;
  markGotBack: (id: string, value: boolean) => void;
}

/** Tomorrow at 6am local — when a parked task wakes back up. */
function tomorrowMorning(): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(6, 0, 0, 0);
  return d.getTime();
}

export const useData = create<DataState>((set, get) => ({
  tasks: [],
  shailos: [],
  priorities: DEFAULT_PRIORITIES,
  loaded: false,

  hydrate: async () => {
    const s = await storage.load();
    set({
      tasks: s.tasks,
      shailos: s.shailos,
      priorities: s.settings.priorities ?? DEFAULT_PRIORITIES,
      loaded: true,
    });
  },

  addTask: (text, priority, energy) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const task: Task = {
      id: uid(),
      text: trimmed,
      priority,
      createdAt: Date.now(),
      prioritySetAt: Date.now(),
      listId: 'default',
      ...(energy ? { energy } : {}),
    };
    const tasks = [task, ...get().tasks];
    set({ tasks });
    void storage.saveTasks(tasks);
  },

  completeTask: (id) => {
    const tasks = get().tasks.map((t) =>
      t.id === id ? { ...t, completed: true, completedAt: Date.now() } : t,
    );
    set({ tasks });
    void storage.saveTasks(tasks);
  },

  toggleDone: (id) => {
    const tasks = get().tasks.map((t) =>
      t.id === id
        ? { ...t, completed: !t.completed, completedAt: !t.completed ? Date.now() : undefined }
        : t,
    );
    set({ tasks });
    void storage.saveTasks(tasks);
  },

  parkTask: (id) => {
    const until = tomorrowMorning();
    const tasks = get().tasks.map((t) => (t.id === id ? { ...t, snoozedUntil: until } : t));
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
