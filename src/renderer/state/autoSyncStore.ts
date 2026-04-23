import { create } from "zustand";

export interface AutoSyncConfig {
  /** Loop period in bars (1 bar = 4 beats). Defaults to 1. */
  periodBars: number;
}

interface AutoSyncStoreShape {
  /** key = targetId, value = sync config */
  active: Record<string, AutoSyncConfig>;
  toggle: (targetId: string) => void;
  enable: (targetId: string, config?: Partial<AutoSyncConfig>) => void;
  disable: (targetId: string) => void;
}

const DEFAULT_CONFIG: AutoSyncConfig = { periodBars: 1 };

export const useAutoSyncStore = create<AutoSyncStoreShape>((set, get) => ({
  active: {},

  toggle: (targetId) => {
    if (get().active[targetId]) get().disable(targetId);
    else get().enable(targetId);
  },

  enable: (targetId, config) => {
    set((s) => ({
      active: { ...s.active, [targetId]: { ...DEFAULT_CONFIG, ...config } },
    }));
  },

  disable: (targetId) => {
    if (!get().active[targetId]) return;
    set((s) => {
      const next = { ...s.active };
      delete next[targetId];
      return { active: next };
    });
  },
}));
