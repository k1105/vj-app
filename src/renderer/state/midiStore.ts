import { create } from "zustand";

export interface MidiAddress {
  channel: number; // 0-15
  type: "cc" | "note";
  number: number;
}

interface MidiStoreShape {
  /** key = targetId, value = MIDI address */
  mappings: Record<string, MidiAddress>;
  /** targetId that is currently waiting for a MIDI message (learn mode) */
  learningTarget: string | null;
  startLearn: (targetId: string) => void;
  cancelLearn: () => void;
  /** Called by midiManager when a MIDI message arrives during learn mode */
  applyLearn: (address: MidiAddress) => void;
  removeMapping: (targetId: string) => void;
  setMappings: (mappings: Record<string, MidiAddress>) => void;
}

export const useMidiStore = create<MidiStoreShape>((set, get) => ({
  mappings: {},
  learningTarget: null,

  startLearn: (targetId) => {
    set({ learningTarget: targetId });
  },

  cancelLearn: () => {
    set({ learningTarget: null });
  },

  applyLearn: (address) => {
    const { learningTarget, mappings } = get();
    if (!learningTarget) return;
    // Remove any existing mapping that uses the same address so one physical
    // control always maps to exactly one target.
    const next: Record<string, MidiAddress> = {};
    for (const [id, m] of Object.entries(mappings)) {
      if (m.channel === address.channel && m.type === address.type && m.number === address.number) continue;
      next[id] = m;
    }
    next[learningTarget] = address;
    set({ mappings: next, learningTarget: null });
    window.vj.setSetting("midiMappings", next);
  },

  removeMapping: (targetId) => {
    const next = { ...get().mappings };
    delete next[targetId];
    set({ mappings: next });
    window.vj.setSetting("midiMappings", next);
  },

  setMappings: (mappings) => set({ mappings }),
}));

export function formatAddress(a: MidiAddress): string {
  return `CH${a.channel + 1} ${a.type.toUpperCase()}#${a.number}`;
}
