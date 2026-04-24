import { useEffect, useState } from "react";
import { useVJStore } from "../state/vjStore";
import type { LayerClip, LayerState, PluginMeta } from "../../shared/types";
import { PostFXRack } from "./PostFXBar";
import { AudioMeters } from "./AudioMeters";
import { AssetPreview } from "./AssetPreview";

// CSS mix-blend-mode doesn't have a native `add`, but `plus-lighter` /
// `lighten` approximate the additive look well enough for a small preview.
const CSS_BLEND: Record<LayerState["blend"], string> = {
  normal: "normal",
  add: "lighten",
  multiply: "multiply",
  screen: "screen",
};

/**
 * Pick a human label for a clip that has no thumbnail. Text assets expose a
 * `strings` param + `idx`; use the currently-selected string. Other plugins
 * fall back to the plugin name so the user still sees *something*.
 */
function textLabelForClip(plugin: PluginMeta, clip: LayerClip): string {
  const stringsDef = plugin.params.find((p) => p.type === "strings");
  if (stringsDef) {
    const raw = clip.params[stringsDef.key] ?? stringsDef.default;
    const texts = Array.isArray(raw)
      ? (raw as unknown[]).map((t) => String(t))
      : [];
    if (texts.length > 0) {
      const idxDef = plugin.params.find((p) => p.key === "idx");
      const idxRaw = idxDef
        ? clip.params[idxDef.key] ?? idxDef.default
        : 0;
      const idx = Math.max(0, Math.round(Number(idxRaw) || 0));
      const label = texts[idx % texts.length];
      if (label) return label;
    }
  }
  return plugin.name;
}

export function TopBar() {
  const layers = useVJStore((s) => s.state.layers);
  const plugins = useVJStore((s) => s.plugins);

  const [liveSrc, setLiveSrc] = useState<string>("");

  useEffect(() => {
    const off = window.vj.onPreviewLive((dataUrl) => setLiveSrc(dataUrl));
    return off;
  }, []);

  const pluginById = (pluginId: string): PluginMeta | undefined =>
    plugins.find((p) => p.id === pluginId);

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
        const plugin = pluginById(clip.pluginId);
        if (!plugin) return null;
        const style: React.CSSProperties = {
          opacity: layer.opacity,
          mixBlendMode: CSS_BLEND[layer.blend] as React.CSSProperties["mixBlendMode"],
        };
        // Canvas plugins have no useful thumbnail and their look depends on
        // live param values — render them for real in the NEXT preview so
        // grid / scale / idx edits are reflected before the user hits GO.
        if (plugin.outputType === "canvas") {
          return (
            <div
              key={`${i}-${useNext}`}
              className="preview-layer preview-layer-live"
              style={style}
            >
              <AssetPreview plugin={plugin} params={clip.params} />
            </div>
          );
        }
        if (plugin.thumbnailUrl) {
          return (
            <div
              key={`${i}-${useNext}`}
              className="preview-layer"
              style={{ ...style, backgroundImage: `url("${plugin.thumbnailUrl}")` }}
            />
          );
        }
        // Fallback for non-canvas plugins missing a thumbnail — a text label
        // so the slot isn't blank.
        const label = textLabelForClip(plugin, clip);
        return (
          <div
            key={`${i}-${useNext}`}
            className="preview-layer preview-layer-text"
            style={style}
          >
            <span>{label}</span>
          </div>
        );
      })
      .filter(Boolean)
      .reverse();

  return (
    <div className="top-bar">
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
