/**
 * Visual layout definition for the Novation Launch Control XL 3.
 *
 * Confirmed defaults (factory template 1):
 *   Knob row 1 (Send A):   CC 13–20
 *   Knob row 2 (Send B):   CC 29–36
 *   Knob row 3 (Pan/Dev):  CC 49–56
 *   Faders 1–8:            CC 5–12
 *
 * Buttons (16 fader buttons + side controls) — Novation does not publish
 * a complete CC table for these on the XL 3, so they are left as `null`
 * and the panel surfaces an inline "press to bind" calibration. Once
 * pressed, the captured (channel,type,number) is persisted and reused.
 *
 * MIDI_CHANNEL: 0-indexed (so 0 == ch1). Adjust if your factory template
 * routes on a different channel.
 */

export const LCXL3_MIDI_CHANNEL = 0;

export type ControlKind = "knob" | "fader" | "button" | "side";

export interface ControlDef {
  /** Stable layout-local id used for pulse + persisted calibration overrides */
  id: string;
  kind: ControlKind;
  /** Position in the visual grid, 1-indexed for clarity */
  row: number;
  col: number;
  /** Optional column span — used for the wider GO-style buttons */
  colSpan?: number;
  /** Display label on the slot when unassigned */
  shortLabel: string;
  /** Default MIDI address. null = needs in-panel calibration */
  defaultAddress: { channel: number; type: "cc" | "note"; number: number } | null;
}

const ch = LCXL3_MIDI_CHANNEL;

/* ── Knobs: 3 rows × 8 cols ─────────────────────────────────── */
const knobRow1: ControlDef[] = Array.from({ length: 8 }, (_, i) => ({
  id: `knob-r1-c${i + 1}`,
  kind: "knob",
  row: 1,
  col: i + 1,
  shortLabel: `SA${i + 1}`,
  defaultAddress: { channel: ch, type: "cc", number: 13 + i },
}));

const knobRow2: ControlDef[] = Array.from({ length: 8 }, (_, i) => ({
  id: `knob-r2-c${i + 1}`,
  kind: "knob",
  row: 2,
  col: i + 1,
  shortLabel: `SB${i + 1}`,
  defaultAddress: { channel: ch, type: "cc", number: 29 + i },
}));

const knobRow3: ControlDef[] = Array.from({ length: 8 }, (_, i) => ({
  id: `knob-r3-c${i + 1}`,
  kind: "knob",
  row: 3,
  col: i + 1,
  shortLabel: `PD${i + 1}`,
  defaultAddress: { channel: ch, type: "cc", number: 49 + i },
}));

/* ── Fader-row buttons: 2 rows × 8 cols (CCs unconfirmed) ───── */
const buttonRow1: ControlDef[] = Array.from({ length: 8 }, (_, i) => ({
  id: `btn-r1-c${i + 1}`,
  kind: "button",
  row: 4,
  col: i + 1,
  shortLabel: `B${i + 1}A`,
  defaultAddress: null,
}));

const buttonRow2: ControlDef[] = Array.from({ length: 8 }, (_, i) => ({
  id: `btn-r2-c${i + 1}`,
  kind: "button",
  row: 5,
  col: i + 1,
  shortLabel: `B${i + 1}B`,
  defaultAddress: null,
}));

/* ── Faders ─────────────────────────────────────────────────── */
const faders: ControlDef[] = Array.from({ length: 8 }, (_, i) => ({
  id: `fader-c${i + 1}`,
  kind: "fader",
  row: 6,
  col: i + 1,
  shortLabel: `F${i + 1}`,
  defaultAddress: { channel: ch, type: "cc", number: 5 + i },
}));

/* ── Side column (Device, Mute, Solo, Record + transport) ─── */
const side: ControlDef[] = [
  { id: "side-device",  kind: "side", row: 1, col: 9, shortLabel: "DEV",  defaultAddress: null },
  { id: "side-mute",    kind: "side", row: 2, col: 9, shortLabel: "MUTE", defaultAddress: null },
  { id: "side-solo",    kind: "side", row: 3, col: 9, shortLabel: "SOLO", defaultAddress: null },
  { id: "side-rec",     kind: "side", row: 4, col: 9, shortLabel: "REC",  defaultAddress: null },
  { id: "side-up",      kind: "side", row: 5, col: 9, shortLabel: "▲",    defaultAddress: null },
  { id: "side-down",    kind: "side", row: 6, col: 9, shortLabel: "▼",    defaultAddress: null },
];

export const LCXL3_LAYOUT: ControlDef[] = [
  ...knobRow1,
  ...knobRow2,
  ...knobRow3,
  ...buttonRow1,
  ...buttonRow2,
  ...faders,
  ...side,
];

export const LCXL3_GRID = { cols: 9, rows: 6 };

/** Lookup by (channel, type, number). Returns null when no match. */
export function findControlByAddress(
  layout: ControlDef[],
  channel: number,
  type: "cc" | "note",
  number: number,
): ControlDef | null {
  for (const c of layout) {
    const a = c.defaultAddress;
    if (a && a.channel === channel && a.type === type && a.number === number) return c;
  }
  return null;
}
