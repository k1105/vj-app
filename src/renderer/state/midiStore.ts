import { create } from "zustand";
import {
  LOCKED_MIDI_MAPPINGS,
  findLockedTargetForAddress,
  isLockedTarget,
} from "../midi/lockedMidi";

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

export interface LockedConflict {
  /** Target where the user attempted the (rejected) assignment */
  targetId: string;
  /** Locked target that already owns the address */
  lockedTargetId: string;
  /** The locked address involved */
  lockedAddress: MidiAddress;
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
  /** Transient red-feedback state when a reserved address rejected an assign. */
  lockedConflict: LockedConflict | null;
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
const LOCKED_CONFLICT_MS = 1800;

let lockedConflictTimer: number | null = null;

export const useMidiStore = create<MidiStoreShape>((set, get) => {
  const flagLockedConflict = (conflict: LockedConflict): void => {
    if (lockedConflictTimer != null) window.clearTimeout(lockedConflictTimer);
    set({ lockedConflict: conflict });
    lockedConflictTimer = window.setTimeout(() => {
      lockedConflictTimer = null;
      set({ lockedConflict: null });
    }, LOCKED_CONFLICT_MS);
  };

  /** Merge persisted user mappings with the locked mappings; locks win. */
  const mergeWithLocks = (
    user: Record<string, MidiAddress>,
  ): Record<string, MidiAddress> => {
    const out: Record<string, MidiAddress> = {};
    for (const [id, addr] of Object.entries(user)) {
      if (id in LOCKED_MIDI_MAPPINGS) continue; // overwritten by lock below
      if (findLockedTargetForAddress(addr)) continue; // address now reserved
      out[id] = addr;
    }
    for (const [id, addr] of Object.entries(LOCKED_MIDI_MAPPINGS)) {
      out[id] = addr;
    }
    return out;
  };

  return {
    mappings: { ...LOCKED_MIDI_MAPPINGS },
    targets: {},
    learningTarget: null,
    pulseTargets: {},
    physicalPulses: {},
    lockedConflict: null,

    startLearn: (targetId) => {
      // Locked targets can't be remapped — flash a conflict at the slot itself.
      if (isLockedTarget(targetId)) {
        flagLockedConflict({
          targetId,
          lockedTargetId: targetId,
          lockedAddress: LOCKED_MIDI_MAPPINGS[targetId],
        });
        return;
      }
      set({ learningTarget: targetId });
    },

    cancelLearn: () => {
      set({ learningTarget: null });
    },

    applyLearn: (address) => {
      const { learningTarget } = get();
      if (!learningTarget) return;
      const lockedTargetId = findLockedTargetForAddress(address);
      if (lockedTargetId && lockedTargetId !== learningTarget) {
        flagLockedConflict({
          targetId: learningTarget,
          lockedTargetId,
          lockedAddress: address,
        });
        set({ learningTarget: null });
        return;
      }
      get().assignMapping(learningTarget, address);
      set({ learningTarget: null });
    },

    assignMapping: (targetId, address) => {
      // Locked target — its address is fixed; ignore any attempt to change it.
      if (isLockedTarget(targetId)) {
        const fixed = LOCKED_MIDI_MAPPINGS[targetId];
        const sameAddr =
          address.channel === fixed.channel &&
          address.type === fixed.type &&
          address.number === fixed.number;
        if (!sameAddr) {
          flagLockedConflict({
            targetId,
            lockedTargetId: targetId,
            lockedAddress: fixed,
          });
        }
        return;
      }
      // Non-locked target trying to claim a reserved address.
      const lockedTargetId = findLockedTargetForAddress(address);
      if (lockedTargetId) {
        flagLockedConflict({
          targetId,
          lockedTargetId,
          lockedAddress: address,
        });
        return;
      }
      const { mappings } = get();
      // Remove any existing mapping that uses the same address so one physical
      // control always maps to exactly one target.
      const next: Record<string, MidiAddress> = {};
      for (const [id, m] of Object.entries(mappings)) {
        if (id in LOCKED_MIDI_MAPPINGS) {
          next[id] = m; // locked entries are never displaced
          continue;
        }
        if (m.channel === address.channel && m.type === address.type && m.number === address.number) continue;
        next[id] = m;
      }
      next[targetId] = address;
      set({ mappings: next });
      window.vj.setSetting("midiMappings", stripLocks(next));
    },

    removeMapping: (targetId) => {
      // Locked targets stay bound forever.
      if (isLockedTarget(targetId)) {
        flagLockedConflict({
          targetId,
          lockedTargetId: targetId,
          lockedAddress: LOCKED_MIDI_MAPPINGS[targetId],
        });
        return;
      }
      const next = { ...get().mappings };
      delete next[targetId];
      set({ mappings: next });
      window.vj.setSetting("midiMappings", stripLocks(next));
    },

    setMappings: (mappings) => set({ mappings: mergeWithLocks(mappings) }),

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
  };
});

/** Persisted JSON shouldn't carry the locks — they're hard-coded constants. */
function stripLocks(
  mappings: Record<string, MidiAddress>,
): Record<string, MidiAddress> {
  const out: Record<string, MidiAddress> = {};
  for (const [id, addr] of Object.entries(mappings)) {
    if (id in LOCKED_MIDI_MAPPINGS) continue;
    out[id] = addr;
  }
  return out;
}

export function formatAddress(a: MidiAddress): string {
  return `CH${a.channel + 1} ${a.type.toUpperCase()}#${a.number}`;
}

/** Short label shown on the MIDI button face. Number only keeps the 16px button compact. */
export function shortAddress(a: MidiAddress): string {
  return String(a.number);
}
