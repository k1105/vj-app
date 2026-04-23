import { useEffect, useState } from "react";
import { useVJStore } from "../state/vjStore";
import type { LayerState } from "../../shared/types";
import { PostFXRack } from "./PostFXBar";
import { AudioMeters } from "./AudioMeters";

// CSS mix-blend-mode doesn't have a native `add`, but `plus-lighter` /
// `lighten` approximate the additive look well enough for a small preview.
const CSS_BLEND: Record<LayerState["blend"], string> = {
  normal: "normal",
  add: "lighten",
  multiply: "multiply",
  screen: "screen",
};

export function TopBar() {
  const layers = useVJStore((s) => s.state.layers);
  const plugins = useVJStore((s) => s.plugins);

  const [liveSrc, setLiveSrc] = useState<string>("");

  useEffect(() => {
    const off = window.vj.onPreviewLive((dataUrl) => setLiveSrc(dataUrl));
    return off;
  }, []);

  const thumbFor = (pluginId: string): string | undefined =>
    plugins.find((p) => p.id === pluginId)?.thumbnailUrl;

  // Same render rules as Composer: respect solo/mute. Draw bottom-up so L1
  // (layers[0]) ends up on top, matching the Output composition order.
  const anySolo = layers.some((l) => l.solo);
  const renderedLayers = (useNext: boolean) =>
    layers
      .map((layer, i) => {
        if (layer.mute) return null;
        if (anySolo && !layer.solo) return null;
        const idx = useNext ? layer.nextClipIdx : layer.activeClipIdx;
        if (idx < 0) return null;
        const clip = layer.clips[idx];
        if (!clip) return null;
        const thumb = thumbFor(clip.pluginId);
        if (!thumb) return null;
        return (
          <div
            key={`${i}-${useNext}`}
            className="preview-layer"
            style={{
              backgroundImage: `url("${thumb}")`,
              opacity: layer.opacity,
              mixBlendMode: CSS_BLEND[layer.blend] as React.CSSProperties["mixBlendMode"],
            }}
          />
        );
      })
      .filter(Boolean)
      .reverse();

  return (
    <div className="top-bar">
      <button
        className="btn-library"
        onClick={() => window.vj.openManager()}
        title="Open asset library"
      >
        LIB
      </button>
      <div className="preview-box live">
        <div className="preview-label">LIVE OUT</div>
        <div className="preview-badge">LIVE</div>
        {liveSrc ? (
          <img className="preview-img" src={liveSrc} alt="live" />
        ) : (
          <div className="preview-placeholder">waiting for output…</div>
        )}
      </div>
      <div className="preview-box next">
        <div className="preview-label">NEXT OUT</div>
        <div className="preview-badge">NEXT</div>
        <div className="preview-stack">{renderedLayers(true)}</div>
      </div>
      <div className="master-panel">
        <PostFXRack />
        <AudioMeters />
      </div>
    </div>
  );
}
