import { useVJStore } from "../state/vjStore";
import type { LayerState, PluginMeta } from "../../shared/types";
import { MidiLearnButton } from "./MidiLearnButton";
import { AutoSyncButton } from "./AutoSyncButton";

const BLEND_MODES: LayerState["blend"][] = ["normal", "add", "multiply", "screen"];

// Drag types. x-plugin-id: a fresh asset from the AssetsPanel (copy).
// x-clip-move: an existing layer clip being moved between layers (move).
const DT_PLUGIN = "application/x-plugin-id";
const DT_CLIP_MOVE = "application/x-clip-move";

export function LayerStack() {
  const layers = useVJStore((s) => s.state.layers);
  const plugins = useVJStore((s) => s.plugins);
  const postfxBoundary = useVJStore((s) => s.state.postfxBoundary);
  const setPostfxBoundary = useVJStore((s) => s.setPostfxBoundary);
  const addClip = useVJStore((s) => s.addClip);
  const triggerClip = useVJStore((s) => s.triggerClip);
  const removeClip = useVJStore((s) => s.removeClip);
  const moveClip = useVJStore((s) => s.moveClip);
  const setLayerOpacity = useVJStore((s) => s.setLayerOpacity);
  const setLayerBlend = useVJStore((s) => s.setLayerBlend);
  const setLayerMute = useVJStore((s) => s.setLayerMute);
  const setLayerSolo = useVJStore((s) => s.setLayerSolo);
  const selectLayer = useVJStore((s) => s.selectLayer);

  const onDrop = (e: React.DragEvent, toLayer: number) => {
    e.preventDefault();
    const moveRaw = e.dataTransfer.getData(DT_CLIP_MOVE);
    if (moveRaw) {
      try {
        const { fromLayer, fromClipIdx } = JSON.parse(moveRaw) as {
          fromLayer: number;
          fromClipIdx: number;
        };
        moveClip(fromLayer, fromClipIdx, toLayer);
      } catch {
        /* malformed payload — ignore */
      }
      return;
    }
    const pluginId = e.dataTransfer.getData(DT_PLUGIN);
    if (!pluginId) return;
    addClip(toLayer, pluginId);
  };

  const onClipContextMenu = async (
    layerIdx: number,
    clipIdx: number,
    e: React.MouseEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const clip = layers[layerIdx]?.clips[clipIdx];
    const meta = clip ? plugins.find((p) => p.id === clip.pluginId) : null;
    const choice = await window.vj.showContextMenu([
      { id: "bake_thumbnail", label: "Bake Thumbnail", enabled: !!meta },
      { id: "remove", label: "Remove" },
    ]);
    if (choice === "remove") {
      removeClip(layerIdx, clipIdx);
    } else if (choice === "bake_thumbnail" && meta) {
      try {
        await window.vj.bakePluginThumbnail(meta.kind, meta.id);
      } catch (err) {
        console.error("[LayerStack] bakePluginThumbnail failed:", err);
      }
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    const types = e.dataTransfer.types;
    const isPlugin = types.includes(DT_PLUGIN);
    const isMove = types.includes(DT_CLIP_MOVE);
    if (!isPlugin && !isMove) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = isMove ? "move" : "copy";
  };

  return (
    <div className="layer-area">
      <div className="layer-area-header">
        <span>Layers</span>
        <span className="live-indicator">● LIVE</span>
      </div>
      <div className="layer-stack">
        {layers.map((layer, idx) => (
          <div key={layer.id} className="layer-row-wrap">
            <PostfxBoundarySlot
              slotIdx={idx}
              currentBoundary={postfxBoundary}
              totalLayers={layers.length}
              onSet={setPostfxBoundary}
            />
            <LayerRow
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
              onClipContextMenu={(clipIdx, e) =>
                onClipContextMenu(idx, clipIdx, e)
              }
            />
          </div>
        ))}
        <PostfxBoundarySlot
          slotIdx={layers.length}
          currentBoundary={postfxBoundary}
          totalLayers={layers.length}
          onSet={setPostfxBoundary}
        />
      </div>
    </div>
  );
}

function PostfxBoundarySlot({
  slotIdx,
  currentBoundary,
  totalLayers,
  onSet,
}: {
  slotIdx: number;
  currentBoundary: number;
  totalLayers: number;
  onSet: (n: number) => void;
}) {
  const active = slotIdx === currentBoundary;
  // Human-readable description of the slot's effect.
  const label =
    slotIdx === 0
      ? "POSTFX · ALL"
      : slotIdx === totalLayers
      ? "POSTFX · OFF"
      : `POSTFX ↓ L${slotIdx + 1}…`;
  const title =
    slotIdx === 0
      ? "PostFX applies to every layer"
      : slotIdx === totalLayers
      ? "PostFX disabled for all layers"
      : `PostFX applies to L${slotIdx + 1} and below; L1..L${slotIdx} render on top unaffected`;
  return (
    <div
      className={`postfx-boundary-slot ${active ? "active" : ""}`}
      onClick={() => onSet(slotIdx)}
      title={title}
    >
      <span className="postfx-boundary-label">{label}</span>
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
  onClipContextMenu: (clipIdx: number, e: React.MouseEvent) => void;
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
    onClipContextMenu,
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
      <input
        type="range"
        className="layer-opacity-vertical"
        min={0}
        max={100}
        value={Math.round(layer.opacity * 100)}
        onChange={(e) => onOpacityChange(parseInt(e.target.value) / 100)}
        onClick={(e) => e.stopPropagation()}
        title={`opacity ${Math.round(layer.opacity * 100)}%`}
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
                draggable
                onDragStart={(e) => {
                  e.stopPropagation();
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData(
                    DT_CLIP_MOVE,
                    JSON.stringify({ fromLayer: idx, fromClipIdx: clipIdx }),
                  );
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onTriggerClip(clipIdx);
                }}
                onContextMenu={(e) => onClipContextMenu(clipIdx, e)}
                title={`${pluginName(clip.pluginId)} (click to trigger · drag to another layer to move · right-click for options)`}
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
        <MidiLearnButton
          targetId={`layer-opacity-${idx}`}
          label={`L${idx + 1} Opacity`}
          group="Layers"
        />
        <AutoSyncButton targetId={`layer-opacity-${idx}`} />
      </div>
    </div>
  );
}
