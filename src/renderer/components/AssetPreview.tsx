import { useEffect, useRef } from "react";
import { useVJStore } from "../state/vjStore";
import type { ParamValue, PluginMeta } from "../../shared/types";

// Low-res on purpose — previews are at most a couple hundred pixels wide
// and we may have several canvas plugins running in parallel (one per
// NEXT layer + one in AssetParamsPanel). CSS stretches the canvas to fit.
const PREVIEW_W = 160;
const PREVIEW_H = 90;

interface Props {
  plugin: PluginMeta | null;
  params: Record<string, ParamValue>;
}

/**
 * Live preview of a single asset rendered with the editing clip's params.
 * Canvas plugins are instantiated locally (separate from the Output's
 * PluginHost); video plugins are played in a plain <video> element with
 * playbackRate honoring the `speed` param.
 *
 * Three-type plugins are out of scope for v1 — they need a WebGL context
 * and a fuller plugin host, so they fall back to the manifest thumbnail.
 */
export function AssetPreview({ plugin, params }: Props) {
  if (!plugin) {
    return <PreviewPlaceholder text="--" />;
  }
  if (plugin.outputType === "canvas") {
    return <CanvasPreview key={plugin.id} plugin={plugin} params={params} />;
  }
  if (plugin.outputType === "video") {
    return <VideoPreview key={plugin.id} plugin={plugin} params={params} />;
  }
  if (plugin.thumbnailUrl) {
    return (
      <img
        className="asset-preview-img"
        src={plugin.thumbnailUrl}
        alt={plugin.name}
      />
    );
  }
  return <PreviewPlaceholder text="preview unavailable" />;
}

function PreviewPlaceholder({ text }: { text: string }) {
  return <div className="asset-preview-placeholder">{text}</div>;
}

interface CanvasInstance {
  setup: (ctx: { width: number; height: number }) => HTMLCanvasElement | unknown;
  update: (ctx: {
    global: {
      bpm: number;
      beat: number;
      bar: number;
      time: number;
      delta: number;
      audio: { volume: number; bass: number; mid: number; high: number };
    };
    params: Record<string, ParamValue>;
  }) => void;
  dispose?: () => void;
}

function CanvasPreview({
  plugin,
  params,
}: {
  plugin: PluginMeta;
  params: Record<string, ParamValue>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  // bpm + beatAnchor drive the global clock. Stored in refs so the rAF loop
  // sees fresh values without re-running the setup effect.
  const bpm = useVJStore((s) => s.state.bpm);
  const beatAnchor = useVJStore((s) => s.state.beatAnchor);
  const bpmRef = useRef(bpm);
  const beatAnchorRef = useRef(beatAnchor);
  bpmRef.current = bpm;
  beatAnchorRef.current = beatAnchor;

  useEffect(() => {
    let disposed = false;
    let raf: number | null = null;
    let mountedCanvas: HTMLCanvasElement | null = null;
    let instance: CanvasInstance | null = null;
    let objectUrl: string | null = null;

    (async () => {
      const source = await window.vj.readPluginSource("material", plugin.id);
      if (!source || disposed) return;
      const blob = new Blob([source], { type: "text/javascript" });
      objectUrl = URL.createObjectURL(blob);
      let mod: { default?: new () => CanvasInstance };
      try {
        mod = (await import(/* @vite-ignore */ objectUrl)) as {
          default?: new () => CanvasInstance;
        };
      } catch (err) {
        console.warn("[AssetPreview] import failed:", err);
        return;
      }
      if (disposed || typeof mod.default !== "function") return;
      const Ctor = mod.default;
      instance = new Ctor();
      let setupResult: unknown;
      try {
        setupResult = instance.setup({ width: PREVIEW_W, height: PREVIEW_H });
      } catch (err) {
        console.warn("[AssetPreview] setup threw:", err);
        return;
      }
      if (!(setupResult instanceof HTMLCanvasElement) || disposed) {
        // Non-canvas plugins (three, video, etc) aren't supported here.
        return;
      }
      mountedCanvas = setupResult;
      mountedCanvas.style.width = "100%";
      mountedCanvas.style.height = "100%";
      mountedCanvas.style.display = "block";
      containerRef.current?.appendChild(mountedCanvas);

      let lastTime = performance.now();
      const tick = () => {
        if (disposed || !instance) return;
        const now = performance.now();
        const delta = (now - lastTime) / 1000;
        lastTime = now;
        const beatMs = bpmRef.current > 0 ? 60000 / bpmRef.current : 0;
        const barMs = beatMs * 4;
        const elapsed = Date.now() - beatAnchorRef.current;
        const beat =
          beatMs > 0 ? (((elapsed % beatMs) + beatMs) % beatMs) / beatMs : 0;
        const bar =
          barMs > 0 ? (((elapsed % barMs) + barMs) % barMs) / barMs : 0;
        try {
          instance.update({
            global: {
              bpm: bpmRef.current,
              beat,
              bar,
              time: now,
              delta,
              audio: { volume: 0, bass: 0, mid: 0, high: 0 },
            },
            params: paramsRef.current,
          });
        } catch (err) {
          console.warn("[AssetPreview] update threw:", err);
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();

    return () => {
      disposed = true;
      if (raf != null) cancelAnimationFrame(raf);
      if (mountedCanvas?.parentNode) {
        mountedCanvas.parentNode.removeChild(mountedCanvas);
      }
      try {
        instance?.dispose?.();
      } catch (err) {
        console.warn("[AssetPreview] dispose threw:", err);
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [plugin.id]);

  return <div className="asset-preview-canvas-wrap" ref={containerRef} />;
}

function VideoPreview({
  plugin,
  params,
}: {
  plugin: PluginMeta;
  params: Record<string, ParamValue>;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const playing = params?.playing !== false;
  const speed = typeof params?.speed === "number" ? params.speed : 1;

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (speed > 0) v.playbackRate = speed;
    if (playing) v.play().catch(() => undefined);
    else v.pause();
  }, [playing, speed]);

  // Best-effort loop boundary enforcement. Reads loopStart/loopEnd each
  // tick; out-of-range currentTime snaps back to loopStart.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let raf: number | null = null;
    const tick = () => {
      const start =
        typeof params?.loopStart === "number" ? params.loopStart : 0;
      const end =
        typeof params?.loopEnd === "number" ? params.loopEnd : Infinity;
      if (end > start && (v.currentTime > end || v.currentTime < start)) {
        try {
          v.currentTime = start;
        } catch {
          /* ignore */
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [params]);

  // Free decoder resources on unmount — the preview is short-lived but the
  // video would otherwise keep buffering until GC.
  useEffect(() => {
    const v = ref.current;
    return () => {
      if (!v) return;
      try {
        v.pause();
        v.removeAttribute("src");
        v.load();
      } catch {
        /* ignore */
      }
    };
  }, []);

  if (!plugin.videoUrl) return <PreviewPlaceholder text="no video" />;
  return (
    <video
      ref={ref}
      className="asset-preview-video"
      src={plugin.videoUrl}
      muted
      autoPlay
      loop
      playsInline
    />
  );
}
