import { create } from "zustand";

export interface MidiAddress {
  channel: number; // 0-15
  type: "cc" | "note";
  number: number;
}

export interface TargetInfo {
  /** Human-readable label shown in the MIDI Map panel */
  label: string;
  /** Optional grouping for the picker (e.g. "Layers", "Transport") */
  group?: string;
}

interface MidiStoreShape {
  /** key = targetId, value = MIDI address */
  mappings: Record<string, MidiAddress>;
  /** Registry populated at runtime by mounted MidiLearnButtons */
  targets: Record<string, TargetInfo>;
  /** targetId that is currently waiting for a MIDI message (learn mode) */
  learningTarget: string | null;
  /** targetIds that are currently being pulsed (recently received MIDI) */
  pulseTargets: Record<string, number>;
  /** physical control IDs (LCXL3 layout) currently pulsed */
  physicalPulses: Record<string, number>;
  startLearn: (targetId: string) => void;
  cancelLearn: () => void;
  /** Called by midiManager when a MIDI message arrives during learn mode */
  applyLearn: (address: MidiAddress) => void;
  /** Manually set a mapping (used when assigning via the MIDI Map panel) */
  assignMapping: (targetId: string, address: MidiAddress) => void;
  removeMapping: (targetId: string) => void;
  setMappings: (mappings: Record<string, MidiAddress>) => void;
  /** Briefly mark a target as active so its button flashes */
  pulse: (targetId: string) => void;
  /** Briefly mark a physical control as active (MIDI Map panel) */
  pulsePhysical: (controlId: string) => void;
  registerTarget: (targetId: string, info: TargetInfo) => void;
  unregisterTarget: (targetId: string) => void;
}

const PULSE_DURATION_MS = 150;

export const useMidiStore = create<MidiStoreShape>((set, get) => ({
  mappings: {},
  targets: {},
  learningTarget: null,
  pulseTargets: {},
  physicalPulses: {},

  startLearn: (targetId) => {
    set({ learningTarget: targetId });
  },

  cancelLearn: () => {
    set({ learningTarget: null });
  },

  applyLearn: (address) => {
    const { learningTarget } = get();
    if (!learningTarget) return;
    get().assignMapping(learningTarget, address);
    set({ learningTarget: null });
  },

  assignMapping: (targetId, address) => {
    const { mappings } = get();
    // Remove any existing mapping that uses the same address so one physical
    // control always maps to exactly one target.
    const next: Record<string, MidiAddress> = {};
    for (const [id, m] of Object.entries(mappings)) {
      if (m.channel === address.channel && m.type === address.type && m.number === address.number) continue;
      next[id] = m;
    }
    next[targetId] = address;
    set({ mappings: next });
    window.vj.setSetting("midiMappings", next);
  },

  removeMapping: (targetId) => {
    const next = { ...get().mappings };
    delete next[targetId];
    set({ mappings: next });
    window.vj.setSetting("midiMappings", next);
  },

  setMappings: (mappings) => set({ mappings }),

  pulse: (targetId) => {
    const prev = get().pulseTargets[targetId];
    if (prev != null) window.clearTimeout(prev);
    const handle = window.setTimeout(() => {
      set((s) => {
        const next = { ...s.pulseTargets };
        delete next[targetId];
        return { pulseTargets: next };
      });
    }, PULSE_DURATION_MS);
    set((s) => ({ pulseTargets: { ...s.pulseTargets, [targetId]: handle } }));
  },

  pulsePhysical: (controlId) => {
    const prev = get().physicalPulses[controlId];
    if (prev != null) window.clearTimeout(prev);
    const handle = window.setTimeout(() => {
      set((s) => {
        const next = { ...s.physicalPulses };
        delete next[controlId];
        return { physicalPulses: next };
      });
    }, PULSE_DURATION_MS);
    set((s) => ({ physicalPulses: { ...s.physicalPulses, [controlId]: handle } }));
  },

  registerTarget: (targetId, info) => {
    set((s) => ({ targets: { ...s.targets, [targetId]: info } }));
  },

  unregisterTarget: (targetId) => {
    set((s) => {
      if (!(targetId in s.targets)) return s;
      const next = { ...s.targets };
      delete next[targetId];
      return { targets: next };
    });
  },
}));

export function formatAddress(a: MidiAddress): string {
  return `CH${a.channel + 1} ${a.type.toUpperCase()}#${a.number}`;
}

/** Short label shown on the MIDI button face. Number only keeps the 16px button compact. */
export function shortAddress(a: MidiAddress): string {
  return String(a.number);
}
