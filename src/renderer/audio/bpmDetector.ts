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
  /**
   * Fires once per animation frame with band energy from the same mic
   * stream. All values are 0..1. `bass` covers ~0–500 Hz, `mid` ~500 Hz–
   * 2.5 kHz, `high` the rest; `volume` is the broadband average.
   */
  onBands?: (volume: number, bass: number, mid: number, high: number) => void;
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
  let bandsAnalyser: AnalyserNode | null = null;
  let bandsRaf = 0;

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

    // Parallel band analyser on the same source. Independent of the BPM
    // worklet — it just reads frequency magnitudes per frame.
    if (opts.onBands) {
      const bandsNode = audioCtx.createAnalyser();
      bandsNode.fftSize = 256;
      bandsNode.smoothingTimeConstant = 0.6;
      source.connect(bandsNode);
      const buf = new Uint8Array(bandsNode.frequencyBinCount);
      const N = buf.length;
      const bassEnd = Math.max(1, Math.floor(N * 0.05)); // ~ <500 Hz at 24 kHz Nyquist
      const midEnd = Math.max(bassEnd + 1, Math.floor(N * 0.25)); // ~ <2.5 kHz
      let raf = 0;
      const tick = () => {
        bandsNode.getByteFrequencyData(buf);
        let sumAll = 0, sumBass = 0, sumMid = 0, sumHigh = 0;
        for (let i = 0; i < N; i++) {
          const v = buf[i];
          sumAll += v;
          if (i < bassEnd) sumBass += v;
          else if (i < midEnd) sumMid += v;
          else sumHigh += v;
        }
        const inv255 = 1 / 255;
        opts.onBands!(
          (sumAll / N) * inv255,
          (sumBass / bassEnd) * inv255,
          (sumMid / (midEnd - bassEnd)) * inv255,
          (sumHigh / (N - midEnd)) * inv255,
        );
        raf = requestAnimationFrame(tick);
      };
      tick();
      bandsRaf = raf;
      bandsAnalyser = bandsNode;
    }
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
    if (bandsRaf) cancelAnimationFrame(bandsRaf);
    try { bandsAnalyser?.disconnect(); } catch { /* */ }
    try { source?.disconnect(); } catch { /* */ }
    try { analyzer?.disconnect(); } catch { /* */ }
    if (stream) for (const t of stream.getTracks()) t.stop();
    if (audioCtx) await audioCtx.close().catch(() => undefined);
    opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }

  const stop = async () => {
    if (bandsRaf) cancelAnimationFrame(bandsRaf);
    try { bandsAnalyser?.disconnect(); } catch { /* */ }
    try { source?.disconnect(); } catch { /* */ }
    try { analyzer?.disconnect(); } catch { /* */ }
    if (stream) for (const t of stream.getTracks()) t.stop();
    if (audioCtx) await audioCtx.close().catch(() => undefined);
    source = null;
    analyzer = null;
    bandsAnalyser = null;
    stream = null;
    audioCtx = null;
  };

  return { stop };
}
