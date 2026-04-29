import type { MidiAddress } from "../state/midiStore";

/**
 * Reserved MIDI addresses that always drive a fixed target. These cannot be
 * remapped via Learn or the MIDI Map panel — attempting to do so surfaces a
 * red conflict feedback at the rejected destination.
 *
 * Convention (LCXL3 channel 1, 0-indexed):
 *   CC 5–8   → layers 1–4 opacity (faders 1–4)
 *   CC 37–44 → PostFX slots 1–8 bypass
 */
const ch = 0;

export const LOCKED_MIDI_MAPPINGS: Record<string, MidiAddress> = {
  "layer-opacity-0": { channel: ch, type: "cc", number: 5 },
  "layer-opacity-1": { channel: ch, type: "cc", number: 6 },
  "layer-opacity-2": { channel: ch, type: "cc", number: 7 },
  "layer-opacity-3": { channel: ch, type: "cc", number: 8 },
  "postfx-slot:0:bypass": { channel: ch, type: "cc", number: 37 },
  "postfx-slot:1:bypass": { channel: ch, type: "cc", number: 38 },
  "postfx-slot:2:bypass": { channel: ch, type: "cc", number: 39 },
  "postfx-slot:3:bypass": { channel: ch, type: "cc", number: 40 },
  "postfx-slot:4:bypass": { channel: ch, type: "cc", number: 41 },
  "postfx-slot:5:bypass": { channel: ch, type: "cc", number: 42 },
  "postfx-slot:6:bypass": { channel: ch, type: "cc", number: 43 },
  "postfx-slot:7:bypass": { channel: ch, type: "cc", number: 44 },
};

export function isLockedTarget(targetId: string): boolean {
  return targetId in LOCKED_MIDI_MAPPINGS;
}

export function findLockedTargetForAddress(addr: MidiAddress): string | null {
  for (const [id, m] of Object.entries(LOCKED_MIDI_MAPPINGS)) {
    if (m.channel === addr.channel && m.type === addr.type && m.number === addr.number) {
      return id;
    }
  }
  return null;
}
