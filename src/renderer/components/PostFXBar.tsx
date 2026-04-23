import { useState } from "react";
import { useVJStore } from "../state/vjStore";
import type { ParamDef } from "../../shared/types";
import { MidiLearnButton } from "./MidiLearnButton";

/**
 * PostFX rack — lives inside the Master panel. Reads the available postfx
 * plugins from the store (kind === "postfx") and reflects VJState.postfx.
 * Clicking a slot toggles it; the selected slot drives the param editor.
 */
export function PostFXRack() {
  const plugins = useVJStore((s) => s.plugins);
  const postfx = useVJStore((s) => s.state.postfx);
  const togglePostFX = useVJStore((s) => s.togglePostFX);
  const setPostFXParam = useVJStore((s) => s.setPostFXParam);

  const available = plugins.filter((p) => p.kind === "postfx");
  const [selected, setSelected] = useState<string | null>(null);

  const isEnabled = (id: string) =>
    postfx.find((p) => p.pluginId === id)?.enabled === true;
  const slotState = (id: string) => postfx.find((p) => p.pluginId === id);

  const effectiveSelected = selected ?? available[0]?.id ?? null;
  const selectedPlugin = available.find((p) => p.id === effectiveSelected);
  const selectedSlot = selectedPlugin ? slotState(selectedPlugin.id) : null;

  const paramValue = (def: ParamDef): number => {
    const current = selectedSlot?.params[def.key];
    if (typeof current === "number") return current;
    if (typeof def.default === "number") return def.default;
    return 0;
  };

  return (
    <div className="postfx-rack">
      <div className="postfx-rack-header">
        <span>PostFX</span>
        <span className="postfx-rack-hint">
          {available.length === 0 ? "no plugins" : "click ⇢ toggle"}
        </span>
      </div>
      <div className="postfx-rack-slots">
        {available.map((plugin) => {
          const on = isEnabled(plugin.id);
          const isSelected = effectiveSelected === plugin.id;
          return (
            <div
              key={plugin.id}
              className={`postfx-rack-slot ${isSelected ? "selected" : ""}`}
              onClick={() => setSelected(plugin.id)}
              title="click to select"
            >
              <button
                className={`postfx-power-btn ${on ? "on" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  togglePostFX(plugin.id);
                }}
                title={on ? "on — click to disable" : "off — click to enable"}
              />
              <span className="postfx-rack-label">{plugin.name}</span>
            </div>
          );
        })}
      </div>
      <div className="postfx-rack-params">
        {selectedPlugin && selectedPlugin.params.length > 0 ? (
          selectedPlugin.params.map((def) => {
            const value = paramValue(def);
            const min = def.min ?? 0;
            const max = def.max ?? 1;
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
                    const next = min + ratio * (max - min);
                    // toggle on if editing a disabled effect, so feedback is immediate
                    if (!isEnabled(selectedPlugin.id)) togglePostFX(selectedPlugin.id);
                    setPostFXParam(selectedPlugin.id, def.key, next);
                  }}
                  className="postfx-rack-param-slider"
                />
                <span className="postfx-rack-param-val">{value.toFixed(2)}</span>
                <MidiLearnButton targetId={`postfx:${selectedPlugin.id}:${def.key}`} />
              </div>
            );
          })
        ) : (
          <div className="postfx-rack-empty">--</div>
        )}
      </div>
    </div>
  );
}
