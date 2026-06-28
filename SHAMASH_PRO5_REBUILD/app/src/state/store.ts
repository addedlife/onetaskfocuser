import { create } from 'zustand';
import { DEFAULT_SCHEME_ID } from '@/theme';

/** The major surfaces (the "Switchboard" model). */
export type SuiteView =
  | 'focus'
  | 'nervecenter'
  | 'taskriver'
  | 'deskphone'
  | 'shailos'
  | 'health';

/** Sub-tabs inside the Focus surface. */
export type FocusTab = 'focus' | 'queue' | 'insights';

const LS = { scheme: 'shp5.scheme', suite: 'shp5.suiteView' };

function lsGet(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — non-fatal */
  }
}

interface UiState {
  suiteView: SuiteView;
  tab: FocusTab;
  sidebarOpen: boolean;
  schemeId: string;
  setSuiteView: (v: SuiteView) => void;
  setTab: (t: FocusTab) => void;
  toggleSidebar: () => void;
  setScheme: (id: string) => void;
}

/**
 * UI store — the small slice that replaces Pro 4's tangle of navigation/theme `useState`s.
 * Domain stores (tasks, shailos, google, phone, health) will be added as those features land.
 */
export const useUi = create<UiState>((set) => ({
  suiteView: lsGet(LS.suite, 'focus') as SuiteView,
  tab: 'focus',
  sidebarOpen: true,
  schemeId: lsGet(LS.scheme, DEFAULT_SCHEME_ID),
  setSuiteView: (suiteView) => {
    lsSet(LS.suite, suiteView);
    set({ suiteView });
  },
  setTab: (tab) => set({ tab }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setScheme: (schemeId) => {
    lsSet(LS.scheme, schemeId);
    set({ schemeId });
  },
}));
