/**
 * Visual layout definition for the Novation Launch Control XL 3.
 *
 * Confirmed defaults (factory template 1):
 *   Knob row 1 (Send A — magenta LED):  CC 13–20
 *   Knob row 2 (Send B — blue LED):     CC 29–36
 *   Knob row 3 (Pan/Device — green):    CC 49–56
 *   Faders 1–8:                         CC 5–12
 *
 * The 16 fader-row buttons (Solo/Arm 1–8 + Mute/Select 9–16) and the
 * left side column (Page ▲▼, Track ◀▶, Record, Play, Shift, Mode) have
 * no published CC table for the XL 3, so they're left as `null` and the
 * panel surfaces an inline "press to bind" calibration. Captured
 * addresses are persisted as overrides.
 *
 * MIDI_CHANNEL: 0-indexed (0 == ch1). Adjust if your factory template
 * routes on a different channel.
 */

export const LCXL3_MIDI_CHANNEL = 0;

export type ControlKind =
  | "knob-a"
  | "knob-b"
  | "knob-c"
  | "fader"
  | "button-row1"
  | "button-row2"
  | "side-btn"
  | "display";

export type ControlSection = "main" | "side";

export interface ControlDef {
  /** Stable layout-local id used for pulse + persisted calibration overrides */
  id: string;
  kind: ControlKind;
  section: ControlSection;
  /** Position in the main 8-col grid (1-indexed). Ignored for side controls. */
  row?: number;
  col?: number;
  /** Display label on the slot when unassigned */
  shortLabel: string;
  /** Default MIDI address. null = needs in-panel calibration */
  defaultAddress: { channel: number; type: "cc" | "note"; number: number } | null;
}

const ch = LCXL3_MIDI_CHANNEL;

/* ── Main area: 6 rows × 8 cols ─────────────────────────────── */

const knobRow1: ControlDef[] = Array.from({ length: 8 }, (_, i) => ({
  id: `knob-a-${i + 1}`,
  kind: "knob-a",
  section: "main",
  row: 1,
  col: i + 1,
  shortLabel: `${i + 1}`,
  defaultAddress: { channel: ch, type: "cc", number: 13 + i },
}));

const knobRow2: ControlDef[] = Array.from({ length: 8 }, (_, i) => ({
  id: `knob-b-${i + 1}`,
  kind: "knob-b",
  section: "main",
  row: 2,
  col: i + 1,
  shortLabel: `${i + 1}`,
  defaultAddress: { channel: ch, type: "cc", number: 29 + i },
}));

const knobRow3: ControlDef[] = Array.from({ length: 8 }, (_, i) => ({
  id: `knob-c-${i + 1}`,
  kind: "knob-c",
  section: "main",
  row: 3,
  col: i + 1,
  shortLabel: `${i + 1}`,
  defaultAddress: { channel: ch, type: "cc", number: 49 + i },
}));

const faders: ControlDef[] = Array.from({ length: 8 }, (_, i) => ({
  id: `fader-${i + 1}`,
  kind: "fader",
  section: "main",
  row: 4,
  col: i + 1,
  shortLabel: `F${i + 1}`,
  defaultAddress: { channel: ch, type: "cc", number: 5 + i },
}));

/** Solo / Arm row — labelled 1..8 on the device. */
const buttonRow1: ControlDef[] = Array.from({ length: 8 }, (_, i) => ({
  id: `btn-solo-${i + 1}`,
  kind: "button-row1",
  section: "main",
  row: 5,
  col: i + 1,
  shortLabel: `${i + 1}`,
  defaultAddress: null,
}));

/** Mute / Select row — labelled 9..16 on the device. */
const buttonRow2: ControlDef[] = Array.from({ length: 8 }, (_, i) => ({
  id: `btn-mute-${i + 1}`,
  kind: "button-row2",
  section: "main",
  row: 6,
  col: i + 1,
  shortLabel: `${9 + i}`,
  defaultAddress: null,
}));

/* ── Side column: visual order top → bottom ─────────────────── */
const side: ControlDef[] = [
  { id: "side-display",   kind: "display",  section: "side", shortLabel: "Mode / Peak", defaultAddress: null },
  { id: "side-page-up",   kind: "side-btn", section: "side", shortLabel: "Page ▲",      defaultAddress: null },
  { id: "side-page-down", kind: "side-btn", section: "side", shortLabel: "Page ▼",      defaultAddress: null },
  { id: "side-track-l",   kind: "side-btn", section: "side", shortLabel: "Track ◀",     defaultAddress: null },
  { id: "side-track-r",   kind: "side-btn", section: "side", shortLabel: "Track ▶",     defaultAddress: null },
  { id: "side-record",    kind: "side-btn", section: "side", shortLabel: "● Rec",       defaultAddress: null },
  { id: "side-play",      kind: "side-btn", section: "side", shortLabel: "▶ Play",      defaultAddress: null },
  { id: "side-shift",     kind: "side-btn", section: "side", shortLabel: "Shift",       defaultAddress: null },
  { id: "side-mode",      kind: "side-btn", section: "side", shortLabel: "Mode",        defaultAddress: null },
];

export const LCXL3_LAYOUT: ControlDef[] = [
  ...knobRow1,
  ...knobRow2,
  ...knobRow3,
  ...faders,
  ...buttonRow1,
  ...buttonRow2,
  ...side,
];

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
