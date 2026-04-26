import { createRealtimeBpmAnalyzer, type BpmAnalyzer } from "realtime-bpm-analyzer";

export interface BpmDetectorHandle {
  /** Tear down the analyzer + media stream and release the mic. */
  stop: () => Promise<void>;
}

interface DetectorOpts {
  /** Fired on every analysis tick — the running estimate. */
  onBpm: (tempo: number, confidence: number) => void;
  /** Fired when the analyzer reports a stable tempo. */
  onStable?: (tempo: number, confidence: number) => void;
  /** Fired on permission / device errors. */
  onError?: (err: Error) => void;
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

    analyzer = await createRealtimeBpmAnalyzer(audioCtx);
    source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyzer.node);
    // Note: do NOT connect to audioCtx.destination — that would pipe the mic
    // straight to the speakers and feedback through the room.

    analyzer.on("bpm", (data) => {
      const top = data.bpm?.[0];
      if (top) opts.onBpm(top.tempo, top.count ?? 0);
    });
    if (opts.onStable) {
      analyzer.on("bpmStable", (data) => {
        const top = data.bpm?.[0];
        if (top) opts.onStable!(top.tempo, top.count ?? 0);
      });
    }
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
