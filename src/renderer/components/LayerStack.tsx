import { useVJStore } from "../state/vjStore";
import type { LayerState, PluginMeta } from "../../shared/types";
import { MidiLearnButton } from "./MidiLearnButton";

const BLEND_MODES: LayerState["blend"][] = ["normal", "add", "multiply", "screen"];

export function LayerStack() {
  const layers = useVJStore((s) => s.state.layers);
  const plugins = useVJStore((s) => s.plugins);
  const addClip = useVJStore((s) => s.addClip);
  const triggerClip = useVJStore((s) => s.triggerClip);
  const removeClip = useVJStore((s) => s.removeClip);
  const setLayerOpacity = useVJStore((s) => s.setLayerOpacity);
  const setLayerBlend = useVJStore((s) => s.setLayerBlend);
  const setLayerMute = useVJStore((s) => s.setLayerMute);
  const setLayerSolo = useVJStore((s) => s.setLayerSolo);
  const selectLayer = useVJStore((s) => s.selectLayer);

  const onDrop = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    const pluginId = e.dataTransfer.getData("application/x-plugin-id");
    if (!pluginId) return;
    addClip(idx, pluginId);
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("application/x-plugin-id")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  return (
    <div className="layer-area">
      <div className="layer-area-header">
        <span>Layers</span>
        <span className="live-indicator">● LIVE</span>
      </div>
      <div className="layer-stack">
        {layers.map((layer, idx) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            idx={idx}
            plugins={plugins}
            onDrop={(e) => onDrop(e, idx)}
            onDragOver={onDragOver}
            onOpacityChange={(v) => setLayerOpacity(idx, v)}
            onBlendChange={(b) => setLayerBlend(idx, b)}
            onMuteToggle={() => setLayerMute(idx, !layer.mute)}
            onSoloToggle={() => setLayerSolo(idx, !layer.solo)}
            onSelect={() => selectLayer(idx)}
            onTriggerClip={(clipIdx) => triggerClip(idx, clipIdx)}
            onRemoveClip={(clipIdx) => removeClip(idx, clipIdx)}
          />
        ))}
      </div>
    </div>
  );
}

function LayerRow(props: {
  layer: LayerState;
  idx: number;
  plugins: PluginMeta[];
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onOpacityChange: (value: number) => void;
  onBlendChange: (blend: LayerState["blend"]) => void;
  onMuteToggle: () => void;
  onSoloToggle: () => void;
  onSelect: () => void;
  onTriggerClip: (clipIdx: number) => void;
  onRemoveClip: (clipIdx: number) => void;
}) {
  const {
    layer,
    idx,
    plugins,
    onDrop,
    onDragOver,
    onOpacityChange,
    onBlendChange,
    onMuteToggle,
    onSoloToggle,
    onSelect,
    onTriggerClip,
    onRemoveClip,
  } = props;

  const pluginById = (pluginId: string) => plugins.find((p) => p.id === pluginId);
  const pluginName = (pluginId: string) => pluginById(pluginId)?.name ?? pluginId;

  return (
    <div
      className="layer-row"
      onDrop={onDrop}
      onDragOver={onDragOver}
      onClick={onSelect}
    >
      <div
        className={`layer-indicator ${
          layer.opacity > 0 && !layer.mute && layer.activeClipIdx >= 0 ? "active" : ""
        }`}
      />
      <div className="layer-label">L{idx + 1}</div>
      <div className="material-grid">
        {layer.clips.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 10 }}>drop here</div>
        ) : (
          layer.clips.map((clip, clipIdx) => {
            const meta = pluginById(clip.pluginId);
            const bgStyle = meta?.thumbnailUrl
              ? {
                  backgroundImage: `url("${meta.thumbnailUrl}")`,
                  backgroundSize: "cover" as const,
                  backgroundPosition: "center" as const,
                }
              : undefined;
            const classes = ["mat-thumb"];
            if (clipIdx === layer.activeClipIdx) classes.push("live-active");
            if (clipIdx === layer.nextClipIdx && clipIdx !== layer.activeClipIdx)
              classes.push("next-active");
            return (
              <div
                key={clipIdx}
                className={classes.join(" ")}
                style={bgStyle}
                onClick={(e) => {
                  e.stopPropagation();
                  onTriggerClip(clipIdx);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onRemoveClip(clipIdx);
                }}
                title={`${pluginName(clip.pluginId)} (click to trigger · right-click to remove)`}
              >
                <div className="mat-name">{pluginName(clip.pluginId)}</div>
              </div>
            );
          })
        )}
      </div>
      <div className="layer-controls">
        <select
          className="layer-blend"
          value={layer.blend}
          onChange={(e) => onBlendChange(e.target.value as LayerState["blend"])}
          onClick={(e) => e.stopPropagation()}
          title="blend mode"
        >
          {BLEND_MODES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <button
          className={`layer-btn ${layer.mute ? "on" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onMuteToggle();
          }}
          title="mute"
        >
          M
        </button>
        <button
          className={`layer-btn ${layer.solo ? "on" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onSoloToggle();
          }}
          title="solo"
        >
          S
        </button>
        <input
          type="range"
          className="opacity-slider"
          min={0}
          max={100}
          value={Math.round(layer.opacity * 100)}
          onChange={(e) => onOpacityChange(parseInt(e.target.value) / 100)}
          onClick={(e) => e.stopPropagation()}
        />
        <span className="opacity-val">{Math.round(layer.opacity * 100)}%</span>
        <MidiLearnButton targetId={`layer-opacity-${idx}`} />
      </div>
    </div>
  );
}
