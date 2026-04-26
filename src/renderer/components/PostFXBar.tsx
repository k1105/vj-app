import { useState } from "react";
import { useVJStore } from "../state/vjStore";
import type { ParamDef } from "../../shared/types";
import { POSTFX_SLOT_COUNT } from "../../shared/types";
import { MidiLearnButton } from "./MidiLearnButton";
import { AutoSyncButton } from "./AutoSyncButton";

/**
 * PostFX rack — 8 fixed slots. Each slot can hold a plugin (or be empty).
 * Slot positions are stable; MIDI mappings target slots, not plugins, so
 * swapping the assigned plugin keeps the physical control wired.
 */
export function PostFXRack() {
  const plugins = useVJStore((s) => s.plugins);
  const postfx = useVJStore((s) => s.state.postfx);
  const togglePostFXSlot = useVJStore((s) => s.togglePostFXSlot);
  const setPostFXSlotPlugin = useVJStore((s) => s.setPostFXSlotPlugin);
  const setPostFXSlotParam = useVJStore((s) => s.setPostFXSlotParam);
  const clearPostFXSlot = useVJStore((s) => s.clearPostFXSlot);

  const available = plugins.filter((p) => p.kind === "postfx" && !p.hidden);
  const [selectedSlot, setSelectedSlot] = useState(0);

  const slot = postfx[selectedSlot];
  const slotPlugin = slot?.pluginId
    ? available.find((p) => p.id === slot.pluginId)
    : null;

  const paramValue = (def: ParamDef): number => {
    const current = slot?.params[def.key];
    if (typeof current === "number") return current;
    if (typeof def.default === "number") return def.default;
    return 0;
  };
  const paramBool = (def: ParamDef): boolean => {
    const current = slot?.params[def.key];
    if (typeof current === "boolean") return current;
    if (typeof def.default === "boolean") return def.default;
    return false;
  };

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
              onClick={() => setSelectedSlot(i)}
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

      <div className="postfx-slot-editor">
        <div className="postfx-slot-editor-header">
          <span>SLOT {selectedSlot + 1}</span>
          <select
            className="postfx-slot-select"
            value={slot?.pluginId ?? ""}
            onChange={(e) =>
              setPostFXSlotPlugin(selectedSlot, e.target.value || null)
            }
          >
            <option value="">— empty —</option>
            {available.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {slot?.pluginId && (
            <button
              className="postfx-slot-clear"
              onClick={() => clearPostFXSlot(selectedSlot)}
              title="clear slot"
            >
              ×
            </button>
          )}
        </div>
        <div className="postfx-rack-params">
          {slotPlugin && slotPlugin.params.length > 0 ? (
            slotPlugin.params.map((def) => {
              if (def.type === "bool") {
                const on = paramBool(def);
                return (
                  <div key={def.key} className="postfx-rack-param-row">
                    <span className="postfx-rack-param-label">{def.key}</span>
                    <button
                      className={`param-toggle ${on ? "on" : ""}`}
                      onClick={() => {
                        if (!postfx[selectedSlot]?.enabled)
                          togglePostFXSlot(selectedSlot);
                        setPostFXSlotParam(selectedSlot, def.key, !on);
                      }}
                    >
                      {on ? "ON" : "OFF"}
                    </button>
                  </div>
                );
              }
              const value = paramValue(def);
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
                      const next = isInt ? Math.round(raw) : raw;
                      if (!postfx[selectedSlot]?.enabled)
                        togglePostFXSlot(selectedSlot);
                      setPostFXSlotParam(selectedSlot, def.key, next);
                    }}
                    className="postfx-rack-param-slider"
                  />
                  <span className="postfx-rack-param-val">
                    {isInt ? Math.round(value).toString() : value.toFixed(2)}
                  </span>
                  <MidiLearnButton
                    targetId={`postfx-slot:${selectedSlot}:param:${def.key}`}
                    label={`Slot ${selectedSlot + 1} · ${def.key}`}
                    group="PostFX"
                  />
                  <AutoSyncButton
                    targetId={`postfx-slot:${selectedSlot}:param:${def.key}`}
                  />
                </div>
              );
            })
          ) : (
            <div className="postfx-rack-empty">
              {slot?.pluginId ? "no params" : "assign a plugin to this slot"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
