import { useAutoSyncStore } from "../state/autoSyncStore";
import { useVJStore } from "../state/vjStore";
import { resolveTargetRange } from "./targetRange";

const BEATS_PER_BAR = 4;
/** Skip set if the value moved less than this fraction of the range — keeps broadcast traffic down. */
const EPSILON_RATIO = 0.001;

let rafId: number | null = null;
const lastValue = new Map<string, number>();

function tick() {
  const { active } = useAutoSyncStore.getState();
  const ids = Object.keys(active);

  if (ids.length > 0) {
    const { bpm, beatAnchor } = useVJStore.getState().state;
    const beatMs = bpm > 0 ? 60000 / bpm : 0;
    const barMs = beatMs * BEATS_PER_BAR;
    const now = Date.now();
    const elapsed = now - beatAnchor;

    for (const id of ids) {
      const cfg = active[id];
      const range = resolveTargetRange(id);
      if (!range) continue;

      const periodMs = barMs * cfg.periodBars;
      if (periodMs <= 0) continue;
      const phase = ((elapsed % periodMs) + periodMs) % periodMs / periodMs;
      const tri = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
      const value = range.min + tri * (range.max - range.min);

      const span = range.max - range.min || 1;
      const prev = lastValue.get(id);
      if (prev != null && Math.abs(value - prev) < span * EPSILON_RATIO) continue;
      lastValue.set(id, value);
      range.set(value);
    }
  }

  rafId = requestAnimationFrame(tick);
}

export function startAutoSyncDriver(): () => void {
  if (rafId != null) return stopAutoSyncDriver;
  rafId = requestAnimationFrame(tick);
  return stopAutoSyncDriver;
}

export function stopAutoSyncDriver(): void {
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  lastValue.clear();
}
