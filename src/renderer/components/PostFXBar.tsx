import { useEffect, useRef, useState } from "react";
import { useVJStore } from "../state/vjStore";
import type { ParamDef, PostFXSlot } from "../../shared/types";
import { POSTFX_SLOT_COUNT } from "../../shared/types";
import { MidiLearnButton } from "./MidiLearnButton";
import { AutoSyncButton } from "./AutoSyncButton";

/**
 * PostFX rack — 8 fixed slots. The slot row at the top drives assignment
 * + bypass + selection. Below it, every assigned slot renders its own
 * editor section so all live (and pre-staged) params are simultaneously
 * visible. Selection just highlights + scrolls to the matching section.
 */
export function PostFXRack() {
  const plugins = useVJStore((s) => s.plugins);
  const postfx = useVJStore((s) => s.state.postfx);
  const togglePostFXSlot = useVJStore((s) => s.togglePostFXSlot);
  const setPostFXSlotPlugin = useVJStore((s) => s.setPostFXSlotPlugin);
  const setPostFXSlotParam = useVJStore((s) => s.setPostFXSlotParam);
  const clearPostFXSlot = useVJStore((s) => s.clearPostFXSlot);
  const selectedSlot = useVJStore((s) => s.selectedPostFXSlot);
  const selectSlot = useVJStore((s) => s.selectPostFXSlot);

  const available = plugins.filter((p) => p.kind === "postfx" && !p.hidden);
  const slotRefs = useRef<Array<HTMLDivElement | null>>([]);

  // Scroll the selected slot's editor into view when selection changes.
  useEffect(() => {
    const el = slotRefs.current[selectedSlot];
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedSlot]);

  return (
    <div className="postfx-rack">
      <div className="postfx-rack-header">
        <span>PostFX — 8 SLOTS</span>
        <span className="postfx-rack-hint">click slot ⇢ select · power ⇢ bypass</span>
      </div>

      <div className="postfx-slots-row">
        {Array.from({ length: POSTFX_SLOT_COUNT }, (_, i) => {
          const s = postfx[i];
          const isSelected = selectedSlot === i;
          const meta = s?.pluginId ? available.find((p) => p.id === s.pluginId) : null;
          const on = !!s?.enabled && !!s?.pluginId;
          return (
            <div
              key={i}
              className={`postfx-slot ${isSelected ? "selected" : ""} ${on ? "on" : ""} ${!s?.pluginId ? "empty" : ""}`}
              onClick={() => selectSlot(i)}
            >
              <div className="postfx-slot-num">{i + 1}</div>
              <button
                className={`postfx-slot-power ${on ? "on" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (s?.pluginId) togglePostFXSlot(i);
                }}
                disabled={!s?.pluginId}
                title={
                  !s?.pluginId
                    ? "empty slot"
                    : on
                    ? "on — click to bypass"
                    : "off — click to enable"
                }
              />
              <div className="postfx-slot-name">
                {meta?.name ?? <span className="dim">empty</span>}
              </div>
              <MidiLearnButton
                targetId={`postfx-slot:${i}:bypass`}
                label={`Slot ${i + 1} bypass`}
                group="PostFX"
              />
            </div>
          );
        })}
      </div>

      <div className="postfx-editor-stack">
        {/* If the selected slot is empty, show an inline assignment row at the top. */}
        {!postfx[selectedSlot]?.pluginId && (
          <EmptySlotAssign
            slotIdx={selectedSlot}
            available={available}
            usedIds={new Set(postfx.map((s) => s.pluginId).filter(Boolean) as string[])}
            onAssign={(id) => setPostFXSlotPlugin(selectedSlot, id)}
          />
        )}
        {postfx.map((slot, i) =>
          slot.pluginId ? (
            <div
              key={i}
              ref={(el) => {
                slotRefs.current[i] = el;
              }}
              className={`postfx-section ${slot.enabled ? "enabled" : "bypassed"} ${
                selectedSlot === i ? "selected" : ""
              }`}
              onClick={() => selectSlot(i)}
            >
              <SlotHeader
                slotIdx={i}
                slot={slot}
                pluginName={
                  available.find((p) => p.id === slot.pluginId)?.name ?? slot.pluginId
                }
                onToggle={() => togglePostFXSlot(i)}
                onClear={() => clearPostFXSlot(i)}
              />
              <SlotParams
                slotIdx={i}
                slot={slot}
                params={
                  available.find((p) => p.id === slot.pluginId)?.params ?? []
                }
                onParamChange={(key, value) => {
                  if (!slot.enabled) togglePostFXSlot(i);
                  setPostFXSlotParam(i, key, value);
                }}
              />
            </div>
          ) : null,
        )}
        {postfx.every((s) => !s.pluginId) && (
          <div className="postfx-rack-empty">no slots assigned</div>
        )}
      </div>
    </div>
  );
}

function EmptySlotAssign({
  slotIdx,
  available,
  usedIds,
  onAssign,
}: {
  slotIdx: number;
  available: ReturnType<typeof useVJStore.getState>["plugins"];
  usedIds: Set<string>;
  onAssign: (pluginId: string | null) => void;
}) {
  return (
    <div className="postfx-empty-assign">
      <span className="postfx-empty-assign-label">SLOT {slotIdx + 1} — assign:</span>
      <select
        className="postfx-slot-select"
        value=""
        onChange={(e) => onAssign(e.target.value || null)}
      >
        <option value="">— pick a plugin —</option>
        {available
          .filter((p) => !usedIds.has(p.id))
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
    </div>
  );
}

function SlotHeader({
  slotIdx,
  slot,
  pluginName,
  onToggle,
  onClear,
}: {
  slotIdx: number;
  slot: PostFXSlot;
  pluginName: string;
  onToggle: () => void;
  onClear: () => void;
}) {
  return (
    <div className="postfx-section-header">
      <span className="postfx-section-num">{slotIdx + 1}</span>
      <button
        className={`postfx-slot-power ${slot.enabled ? "on" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        title={slot.enabled ? "on — click to bypass" : "off — click to enable"}
      />
      <span className="postfx-section-name">{pluginName}</span>
      <span className="postfx-section-status">
        {slot.enabled ? "LIVE" : "BYPASS"}
      </span>
      <button
        className="postfx-slot-clear"
        onClick={(e) => {
          e.stopPropagation();
          onClear();
        }}
        title="clear slot"
      >
        ×
      </button>
    </div>
  );
}

function SlotParams({
  slotIdx,
  slot,
  params,
  onParamChange,
}: {
  slotIdx: number;
  slot: PostFXSlot;
  params: ParamDef[];
  onParamChange: (key: string, value: number | boolean) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (params.length === 0) {
    return <div className="postfx-rack-empty">no params</div>;
  }
  // If the plugin opted into primary/secondary, hide secondaries behind
  // a per-section expander. Otherwise show every param (back-compat).
  const hasPrimary = params.some((p) => p.primary);
  const visible = hasPrimary && !showAll ? params.filter((p) => p.primary) : params;
  const hiddenCount = params.length - visible.length;
  return (
    <div className="postfx-rack-params">
      {visible.map((def) => {
        if (def.type === "bool") {
          const cur = slot.params[def.key];
          const on =
            typeof cur === "boolean"
              ? cur
              : typeof def.default === "boolean"
              ? def.default
              : false;
          return (
            <div key={def.key} className="postfx-rack-param-row">
              <span className="postfx-rack-param-label">{def.key}</span>
              <button
                className={`param-toggle ${on ? "on" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onParamChange(def.key, !on);
                }}
              >
                {on ? "ON" : "OFF"}
              </button>
            </div>
          );
        }
        const cur = slot.params[def.key];
        const value =
          typeof cur === "number"
            ? cur
            : typeof def.default === "number"
            ? def.default
            : 0;
        const min = def.min ?? 0;
        const max = def.max ?? 1;
        const isInt = def.type === "int";
        return (
          <div key={def.key} className="postfx-rack-param-row">
            <span className="postfx-rack-param-label">{def.key}</span>
            <input
              type="range"
              min={0}
              max={1000}
              value={Math.round(((value - min) / (max - min)) * 1000)}
              onChange={(e) => {
                const ratio = parseInt(e.target.value) / 1000;
                const raw = min + ratio * (max - min);
                onParamChange(def.key, isInt ? Math.round(raw) : raw);
              }}
              onClick={(e) => e.stopPropagation()}
              className="postfx-rack-param-slider"
            />
            <span className="postfx-rack-param-val">
              {isInt ? Math.round(value).toString() : value.toFixed(2)}
            </span>
            <MidiLearnButton
              targetId={`postfx-slot:${slotIdx}:param:${def.key}`}
              label={`Slot ${slotIdx + 1} · ${def.key}`}
              group="PostFX"
            />
            <AutoSyncButton
              targetId={`postfx-slot:${slotIdx}:param:${def.key}`}
            />
          </div>
        );
      })}
      {hasPrimary && hiddenCount > 0 && (
        <button
          className="param-more-btn"
          onClick={(e) => {
            e.stopPropagation();
            setShowAll((v) => !v);
          }}
        >
          {showAll ? "▴ LESS" : `▾ ${hiddenCount} MORE`}
        </button>
      )}
    </div>
  );
}
