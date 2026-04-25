import { create } from "zustand";
import type { MidiAddress } from "./midiStore";

interface MidiMapPanelShape {
  open: boolean;
  /** Target chip the user clicked first; next physical click will be assigned to it. */
  selectedTargetId: string | null;
  /** Physical control id currently in calibration mode — next MIDI message overrides its address. */
  calibratingControlId: string | null;
  /**
   * Per-control address overrides for layout entries whose factory address is
   * unknown (or differs from the user's template). Persisted to electron-store.
   */
  overrides: Record<string, MidiAddress>;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  selectTarget: (id: string | null) => void;
  startCalibrate: (controlId: string | null) => void;
  setOverrides: (o: Record<string, MidiAddress>) => void;
  applyOverride: (controlId: string, address: MidiAddress) => void;
  clearOverride: (controlId: string) => void;
}

export const useMidiMapPanelStore = create<MidiMapPanelShape>((set, get) => ({
  open: false,
  selectedTargetId: null,
  calibratingControlId: null,
  overrides: {},

  setOpen: (v) => set({ open: v, selectedTargetId: null, calibratingControlId: null }),
  toggle: () =>
    set((s) => ({
      open: !s.open,
      selectedTargetId: null,
      calibratingControlId: null,
    })),

  selectTarget: (id) => set({ selectedTargetId: id, calibratingControlId: null }),

  startCalibrate: (controlId) =>
    set({ calibratingControlId: controlId, selectedTargetId: null }),

  setOverrides: (o) => set({ overrides: o }),

  applyOverride: (controlId, address) => {
    const next = { ...get().overrides, [controlId]: address };
    set({ overrides: next, calibratingControlId: null });
    window.vj.setSetting("lcxl3Overrides", next);
  },

  clearOverride: (controlId) => {
    const next = { ...get().overrides };
    delete next[controlId];
    set({ overrides: next });
    window.vj.setSetting("lcxl3Overrides", next);
  },
}));
