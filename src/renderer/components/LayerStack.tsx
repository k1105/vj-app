import { useRef, useState } from "react";
import { useVJStore } from "../state/vjStore";
import type { LayerState, PluginMeta } from "../../shared/types";

const BLEND_MODES: LayerState["blend"][] = ["normal", "add", "multiply", "screen"];

const DT_PLUGIN = "application/x-plugin-id";
const DT_CLIP_MOVE = "application/x-clip-move";
const DT_DECK = "application/x-deck-id";

export function LayerStack() {
  const layers = useVJStore((s) => s.state.layers);
  const plugins = useVJStore((s) => s.plugins);
  const postfxBoundary = useVJStore((s) => s.state.postfxBoundary);
  const setPostfxBoundary = useVJStore((s) => s.setPostfxBoundary);
  const addClip = useVJStore((s) => s.addClip);
  const triggerClip = useVJStore((s) => s.triggerClip);
  const removeClip = useVJStore((s) => s.removeClip);
  const moveClip = useVJStore((s) => s.moveClip);
  const reorderClip = useVJStore((s) => s.reorderClip);
  const setLayerOpacity = useVJStore((s) => s.setLayerOpacity);
  const setLayerBlend = useVJStore((s) => s.setLayerBlend);
  const setLayerMute = useVJStore((s) => s.setLayerMute);
  const setLayerSolo = useVJStore((s) => s.setLayerSolo);
  const selectLayer = useVJStore((s) => s.selectLayer);
  const applyDeck = useVJStore((s) => s.applyDeck);

  const onDrop = (e: React.DragEvent, toLayer: number, insertBefore?: number) => {
    e.preventDefault();
    const moveRaw = e.dataTransfer.getData(DT_CLIP_MOVE);
    if (moveRaw) {
      try {
        const { fromLayer, fromClipIdx } = JSON.parse(moveRaw) as {
          fromLayer: number;
          fromClipIdx: number;
        };
        if (fromLayer === toLayer && insertBefore !== undefined) {
          reorderClip(toLayer, fromClipIdx, insertBefore);
        } else {
          moveClip(fromLayer, fromClipIdx, toLayer);
        }
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
    const isDeck = types.includes(DT_DECK);
    if (!isPlugin && !isMove && !isDeck) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = isMove ? "move" : "copy";
  };

  const onLayerAreaDrop = (e: React.DragEvent) => {
    const deckId = e.dataTransfer.getData(DT_DECK);
    if (!deckId) return;
    e.preventDefault();
    applyDeck(deckId);
  };

  const onLayerAreaDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DT_DECK)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  return (
    <div
      className="layer-area"
      onDrop={onLayerAreaDrop}
      onDragOver={onLayerAreaDragOver}
    >
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
              onDrop={(e, insertBefore) => onDrop(e, idx, insertBefore)}
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
  onDrop: (e: React.DragEvent, insertBefore?: number) => void;
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

  // insertIdx: which slot the dragged clip will be inserted before.
  // null = no active intra-layer drag.
  const [insertIdx, setInsertIdx] = useState<number | null>(null);

  const pluginById = (pluginId: string) => plugins.find((p) => p.id === pluginId);
  const pluginName = (pluginId: string) => pluginById(pluginId)?.name ?? pluginId;

  const calcInsert = (e: React.DragEvent, clipIdx: number): number => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientX < rect.left + rect.width / 2 ? clipIdx : clipIdx + 1;
  };

  return (
    <div
      className="layer-row"
      onDrop={(e) => {
        setInsertIdx(null);
        onDrop(e);
      }}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setInsertIdx(null);
      }}
      onClick={onSelect}
    >
      <VerticalOpacityLine
        value={layer.opacity}
        onChange={onOpacityChange}
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
            const isInsertBefore = insertIdx === clipIdx;
            const isInsertAfter =
              insertIdx === layer.clips.length && clipIdx === layer.clips.length - 1;
            return (
              <div
                key={clipIdx}
                className={[
                  ...classes,
                  isInsertBefore ? "insert-before" : "",
                  isInsertAfter ? "insert-after" : "",
                ].filter(Boolean).join(" ")}
                data-gpid={`clip-${idx}-${clipIdx}`}
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
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(DT_CLIP_MOVE)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  setInsertIdx(calcInsert(e, clipIdx));
                }}
                onDrop={(e) => {
                  if (!e.dataTransfer.types.includes(DT_CLIP_MOVE)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const ins = calcInsert(e, clipIdx);
                  setInsertIdx(null);
                  onDrop(e, ins);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onTriggerClip(clipIdx);
                }}
                onContextMenu={(e) => onClipContextMenu(clipIdx, e)}
                title={`${pluginName(clip.pluginId)} (click to trigger · drag to reorder or move · right-click for options)`}
              >
                <div className="mat-name">{pluginName(clip.pluginId)}</div>
              </div>
            );
          })
        )}
        {/* Gamepad-only add slot — hidden by default, shown when .gamepad-active is on body */}
        <div
          className="gp-add-slot"
          data-gpid={`add-${idx}`}
          title="Add asset (gamepad)"
          onClick={(e) => e.stopPropagation()}
        >
          <span>+</span>
          <span className="gp-add-slot-label">ADD</span>
        </div>
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
      </div>
    </div>
  );
}

/**
 * Compact vertical opacity track — a thin line that fills from the bottom
 * up to the current value. Click anywhere on it to jump; press-and-drag
 * up/down to scrub. Designed to take essentially no horizontal space:
 * the GUI is here for readout, the real driver is MIDI.
 */
function VerticalOpacityLine({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const setFromPointer = (clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    onChange(ratio);
  };
  return (
    <div
      ref={ref}
      className="layer-opacity-line"
      title={`opacity ${Math.round(value * 100)}%`}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        setFromPointer(e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 0) return;
        setFromPointer(e.clientY);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="layer-opacity-line-fill"
        style={{ height: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
}
