/** Beat / bar helpers driven by the shared global state. */

export interface RhythmInput {
  bpm: number;
  /** ms since performance origin */
  time: number;
}

export function beatPosition({ bpm, time }: RhythmInput): number {
  if (bpm <= 0) return 0;
  const beatMs = 60000 / bpm;
  return (time % beatMs) / beatMs;
}

export function barPosition({ bpm, time }: RhythmInput, beatsPerBar = 4): number {
  if (bpm <= 0) return 0;
  const barMs = (60000 / bpm) * beatsPerBar;
  return (time % barMs) / barMs;
}

/** Triangle wave 0..1..0 driven by beat. */
export function beatSync(input: RhythmInput): number {
  const b = beatPosition(input);
  return b < 0.5 ? b * 2 : (1 - b) * 2;
}

/** Sharp decay 1→0 at each beat start. */
export function beatPulse(input: RhythmInput): number {
  const b = beatPosition(input);
  return Math.pow(1 - b, 3);
}

export function easeByBeat(input: RhythmInput, ease: (t: number) => number): number {
  return ease(beatPosition(input));
}
