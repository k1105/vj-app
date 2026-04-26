import { createRealtimeBpmAnalyzer, type BpmAnalyzer } from "realtime-bpm-analyzer";

export interface BpmDetectorHandle {
  /** Tear down the analyzer + media stream and release the mic. */
  stop: () => Promise<void>;
}

interface DetectorOpts {
  /**
   * Fired on every analysis tick. `tempo` is the smoothed (median) running
   * estimate; `stable` reflects our rolling-window stability check, which
   * latches when recent readings stay within tolerance for long enough and
   * unlatches when they drift out again.
   */
  onUpdate: (tempo: number, confidence: number, stable: boolean) => void;
  /** Fired on permission / device errors. */
  onError?: (err: Error) => void;
}

// Rolling-window smoothing & stability. The library's `bpmStable` requires
// 20 s of identical readings which mic input rarely satisfies — we run our
// own check instead: take the median of the last N readings, consider it
// stable when their spread stays small for at least MIN_SPAN_MS.
const HISTORY_SIZE = 12;
const STABLE_TOLERANCE_BPM = 2.0;
const STABLE_MIN_READINGS = 6;
const STABLE_MIN_SPAN_MS = 3000;

interface Reading { tempo: number; count: number; t: number; }

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Bring up a microphone-driven realtime BPM analyzer.
 *
 * Lifecycle:
 *   - getUserMedia({ audio: true }) — prompts for mic permission on first use
 *   - new AudioContext (+ resume) and createRealtimeBpmAnalyzer
 *   - connect MediaStreamSource → analyzer.node (NOT to destination, no monitor)
 *   - emit `bpm` / `bpmStable` events as the analyzer fires
 *
 * Returns a handle whose `stop()` resolves once the audio graph is torn down
 * and the microphone tracks are released (mic LED off).
 */
export async function startBpmDetector(opts: DetectorOpts): Promise<BpmDetectorHandle> {
  let audioCtx: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyzer: BpmAnalyzer | null = null;

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") await audioCtx.resume();

    // continuousAnalysis: keep refining after the first stable detection.
    // stabilizationTime is dropped to 5 s mostly so the library's internal
    // bookkeeping doesn't lock into an early bad guess; our own rolling
    // median is the actual stability signal we surface.
    analyzer = await createRealtimeBpmAnalyzer(audioCtx, {
      continuousAnalysis: true,
      stabilizationTime: 5000,
    });
    source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyzer.node);
    // Note: do NOT connect to audioCtx.destination — that would pipe the mic
    // straight to the speakers and feedback through the room.

    const history: Reading[] = [];

    analyzer.on("bpm", (data) => {
      const top = data.bpm?.[0];
      if (!top) return;
      const now = performance.now();
      history.push({ tempo: top.tempo, count: top.count ?? 0, t: now });
      if (history.length > HISTORY_SIZE) history.shift();

      // Smoothed running estimate = median of recent readings.
      const med = median(history.map((r) => r.tempo));

      // Stability: enough recent readings AND tight spread AND wide enough time span.
      let stable = false;
      if (history.length >= STABLE_MIN_READINGS) {
        const recent = history.slice(-STABLE_MIN_READINGS);
        const recentTempos = recent.map((r) => r.tempo);
        const spread = Math.max(...recentTempos) - Math.min(...recentTempos);
        const span = recent[recent.length - 1].t - recent[0].t;
        stable = spread <= STABLE_TOLERANCE_BPM && span >= STABLE_MIN_SPAN_MS;
      }
      opts.onUpdate(med, top.count ?? 0, stable);
    });
  } catch (err) {
    // Clean up partial setup before re-throwing / reporting.
    try { source?.disconnect(); } catch { /* */ }
    try { analyzer?.disconnect(); } catch { /* */ }
    if (stream) for (const t of stream.getTracks()) t.stop();
    if (audioCtx) await audioCtx.close().catch(() => undefined);
    opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }

  const stop = async () => {
    try { source?.disconnect(); } catch { /* */ }
    try { analyzer?.disconnect(); } catch { /* */ }
    if (stream) for (const t of stream.getTracks()) t.stop();
    if (audioCtx) await audioCtx.close().catch(() => undefined);
    source = null;
    analyzer = null;
    stream = null;
    audioCtx = null;
  };

  return { stop };
}
