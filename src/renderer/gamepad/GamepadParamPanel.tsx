import { useEffect, useRef, useState } from "react";
import { useVJStore } from "../state/vjStore";
import { useGamepadFocusStore } from "./gamepadFocusStore";
import { readLStickY } from "./gamepadManager";
import type { ParamDef } from "../../shared/types";

const PARAM_SPEED = 0.012; // value delta per frame at full stick deflection

// ─── Helpers ───────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

type ParamEntry =
  | { type: "single"; def: ParamDef; value: number | boolean | string }
  | { type: "range";  startDef: ParamDef; endDef: ParamDef; startVal: number; endVal: number };

function buildEntries(
  params: ParamDef[],
  getVal: (key: string) => number | boolean | string,
): ParamEntry[] {
  const out: ParamEntry[] = [];
  let i = 0;
  while (i < params.length) {
    const d = params[i];
    if (d.type === "strings") { i++; continue; }
    if (d.key.endsWith("Start") && i + 1 < params.length) {
      const next = params[i + 1];
      if (next.key === d.key.slice(0, -5) + "End") {
        out.push({ type: "range", startDef: d, endDef: next, startVal: Number(getVal(d.key)), endVal: Number(getVal(next.key)) });
        i += 2; continue;
      }
    }
    out.push({ type: "single", def: d, value: getVal(d.key) });
    i++;
  }
  return out;
}

function isStepParam(def: ParamDef): boolean {
  if (def.type === "bool" || def.type === "enum" || !def.step) return false;
  const range = (def.max ?? 1) - (def.min ?? 0);
  const positions = range / def.step;
  return Number.isFinite(positions) && positions <= 12;
}

// ─── Component ─────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

export function GamepadParamPanel({ onClose }: Props) {
  const target      = useGamepadFocusStore((s) => s.target);
  const panelOpen   = useGamepadFocusStore((s) => s.paramPanelOpen);
  const layers      = useVJStore((s) => s.state.layers);
  const postfx      = useVJStore((s) => s.state.postfx);
  const plugins     = useVJStore((s) => s.plugins);
  const setClipParam       = useVJStore((s) => s.setClipParam);
  const setPostFXSlotParam = useVJStore((s) => s.setPostFXSlotParam);
  const setLayerBlend      = useVJStore((s) => s.setLayerBlend);

  const [focusedRow, setFocusedRow] = useState(0);

  // Compute data from the focused target
  const data = (() => {
    if (!target) return null;
    if (target.kind === "clip") {
      const layer = layers[target.layerIdx];
      const clip  = layer?.clips[target.clipIdx];
      if (!clip) return null;
      const plugin = plugins.find(p => p.id === clip.pluginId);
      if (!plugin) return null;
      const getVal = (key: string): number | boolean | string => {
        const v = clip.params[key];
        if (v !== undefined && v !== null && !Array.isArray(v)) return v;
        return (plugin.params.find(p => p.key === key)?.default ?? 0) as number | boolean | string;
      };
      const entries = buildEntries(plugin.params, getVal);
      return {
        title: plugin.name,
        subtitle: `L${target.layerIdx + 1}`,
        entries,
        layer: { idx: target.layerIdx, opacity: layer.opacity, blend: layer.blend },
        setValue: (key: string, val: number | boolean | string) =>
          setClipParam(target.layerIdx, target.clipIdx, key, val),
      };
    }
    if (target.kind === "postfx") {
      const slot   = postfx[target.slotIdx];
      const plugin = slot?.pluginId ? plugins.find(p => p.id === slot.pluginId) : null;
      if (!plugin || !slot) return null;
      const getVal = (key: string): number | boolean | string => {
        const v = slot.params?.[key];
        if (v !== undefined && v !== null && !Array.isArray(v)) return v;
        return (plugin.params.find(p => p.key === key)?.default ?? 0) as number | boolean | string;
      };
      return {
        title: plugin.name,
        subtitle: `PostFX ${target.slotIdx + 1}`,
        entries: buildEntries(plugin.params, getVal),
        layer: null,
        setValue: (key: string, val: number | boolean | string) =>
          setPostFXSlotParam(target.slotIdx, key, val),
      };
    }
    return null;
  })();

  // Reset row focus when target changes
  useEffect(() => { setFocusedRow(0); }, [target]);

  // L stick → continuous float/int delta
  const dataRef = useRef(data);
  const rowRef  = useRef(focusedRow);
  dataRef.current = data;
  rowRef.current  = focusedRow;

  useEffect(() => {
    if (!panelOpen) return;
    let raf: number;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const ly = readLStickY();
      if (Math.abs(ly) < 0.01) return;
      const d = dataRef.current;
      if (!d) return;
      const entry = d.entries[rowRef.current];
      if (!entry) return;
      if (entry.type === "single") {
        const def = entry.def;
        if (def.type !== "float" && def.type !== "int") return;
        const min   = def.min ?? 0;
        const max   = def.max ?? 1;
        const cur   = typeof entry.value === "number" ? entry.value : Number(entry.value);
        const delta = -ly * PARAM_SPEED * (max - min);
        const next  = clamp(cur + delta, min, max);
        const final = def.type === "int" ? Math.round(next) : next;
        d.setValue(def.key, final);
      } else if (entry.type === "range") {
        // L stick moves both handles together (shift)
        const min = entry.startDef.min ?? 0;
        const max = entry.endDef.max ?? entry.startDef.max ?? 1;
        const delta = -ly * PARAM_SPEED * (max - min);
        const newStart = clamp(entry.startVal + delta, min, entry.endVal);
        const newEnd   = clamp(entry.endVal   + delta, entry.startVal, max);
        d.setValue(entry.startDef.key, newStart);
        d.setValue(entry.endDef.key,   newEnd);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [panelOpen]);

  // Listen for gamepad events dispatched by GamepadRoot via window custom events
  useEffect(() => {
    const onNav = (e: Event) => {
      // 横並びなので ←→ で列移動
      const dir = (e as CustomEvent<"up" | "down">).detail;
      setFocusedRow(r => {
        const d2 = dataRef.current;
        if (!d2) return r;
        if (dir === "up") return Math.max(0, r - 1);
        return Math.min(d2.entries.length - 1, r + 1);
      });
    };
    const onStep = (e: Event) => {
      // ↑↓ で step/enum、←→ で float 微調整
      const dir = (e as CustomEvent<"left" | "right">).detail;
      const d2 = dataRef.current;
      if (!d2) return;
      const entry = d2.entries[rowRef.current];
      if (!entry || entry.type !== "single") return;
      const def = entry.def;
      const delta = dir === "right" ? 1 : -1;
      if (def.type === "enum" && def.options) {
        const cur = def.options.indexOf(String(entry.value));
        d2.setValue(def.key, def.options[(cur + delta + def.options.length) % def.options.length]);
      } else if (isStepParam(def)) {
        const cur = typeof entry.value === "number" ? entry.value : Number(entry.value);
        d2.setValue(def.key, clamp(cur + def.step! * delta, def.min ?? 0, def.max ?? 1));
      } else if (def.type === "float" || def.type === "int") {
        const step = def.step ?? ((def.max ?? 1) - (def.min ?? 0)) / 20;
        const cur  = typeof entry.value === "number" ? entry.value : Number(entry.value);
        d2.setValue(def.key, clamp(cur + step * delta, def.min ?? 0, def.max ?? 1));
      }
    };
    const onR3 = () => {
      const d2 = dataRef.current;
      if (!d2) return;
      const entry = d2.entries[rowRef.current];
      if (!entry || entry.type !== "single") return;
      const def = entry.def;
      if (def.type === "bool")    d2.setValue(def.key, !entry.value);
      if (def.type === "trigger") d2.setValue(def.key, Date.now());
    };
    window.addEventListener("gp:param-nav",  onNav);
    window.addEventListener("gp:param-step", onStep);
    window.addEventListener("gp:param-r3",   onR3);
    return () => {
      window.removeEventListener("gp:param-nav",  onNav);
      window.removeEventListener("gp:param-step", onStep);
      window.removeEventListener("gp:param-r3",   onR3);
    };
  }, []);

  return (
    <div className={`gp-param-panel${panelOpen ? " open" : ""}`}>
      {data && (
        <>
          <div className="gp-panel-header">
            <span className="gp-panel-title">{data.title}</span>
            <span className="gp-panel-subtitle">{data.subtitle}</span>
            <button className="gp-panel-close" onClick={onClose}>
              <span className="gp-btn-badge gp-tri">△</span> 閉じる
            </button>
          </div>

          {data.layer && (
            <div className="gp-layer-strip">
              <span className="gp-strip-label">Opacity</span>
              <div className="gp-opacity-track">
                <div className="gp-opacity-fill" style={{ width: `${Math.round(data.layer.opacity * 100)}%` }} />
              </div>
              <span className="gp-opacity-val">{Math.round(data.layer.opacity * 100)}</span>
              <div className="gp-sep" />
              <span className="gp-strip-label">Blend</span>
              {(["normal", "add", "multiply", "screen"] as const).map(b => (
                <button
                  key={b}
                  className={`gp-blend-opt${data.layer!.blend === b ? " active" : ""}`}
                  onClick={() => setLayerBlend(data.layer!.idx, b)}
                >
                  {b === "normal" ? "NRM" : b === "multiply" ? "MUL" : b.toUpperCase()}
                </button>
              ))}
            </div>
          )}

          <div className="gp-param-cols">
            {data.entries.map((entry, i) => (
              <ParamCol
                key={i}
                entry={entry}
                focused={i === focusedRow}
                onClick={() => setFocusedRow(i)}
                onToggle={() => {
                  if (entry.type === "single" && entry.def.type === "bool") {
                    data.setValue(entry.def.key, !entry.value);
                  }
                }}
                onTrigger={() => {
                  if (entry.type === "single" && entry.def.type === "trigger") {
                    data.setValue(entry.def.key, Date.now());
                  }
                }}
                onEnumSelect={(val) => {
                  if (entry.type === "single") data.setValue(entry.def.key, val);
                }}
              />
            ))}
          </div>

          <div className="gp-param-guide">
            <span className="gp-guide-item"><span className="gp-btn-badge gp-dpad">←→</span> 選択</span>
            <span className="gp-guide-item"><span className="gp-btn-badge gp-stick">L ↕</span> 値変更</span>
            <span className="gp-guide-item"><span className="gp-btn-badge gp-dpad">↑↓</span> step/enum</span>
            <span className="gp-guide-item"><span className="gp-btn-badge gp-r3">R3</span> toggle/fire</span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Param column (縦スライダー＋横並び) ────────────────────────────────────

function ParamCol({
  entry, focused, onClick, onToggle, onTrigger, onEnumSelect,
}: {
  entry: ParamEntry;
  focused: boolean;
  onClick: () => void;
  onToggle: () => void;
  onTrigger: () => void;
  onEnumSelect: (val: string) => void;
}) {
  const cls = `gp-param-col${focused ? " focused" : ""}`;

  // range: 縦2本スライダー (start / end)
  if (entry.type === "range") {
    const min   = entry.startDef.min ?? 0;
    const max   = entry.endDef.max ?? entry.startDef.max ?? 1;
    const range = max - min || 1;
    const sPct  = ((entry.startVal - min) / range) * 100;
    const ePct  = ((entry.endVal   - min) / range) * 100;
    const label = entry.startDef.key.slice(0, -5) || "range";
    return (
      <div className={cls} onClick={onClick}>
        <span className="gp-col-label">{label}</span>
        <div className="gp-vslider-pair">
          <div className="gp-vslider-track">
            <div className="gp-vslider-fill" style={{ height: `${clamp(sPct, 0, 100)}%` }} />
          </div>
          <div className="gp-vslider-track">
            <div className="gp-vslider-fill" style={{ height: `${clamp(ePct, 0, 100)}%` }} />
          </div>
        </div>
        <span className="gp-col-val">{entry.startVal.toFixed(1)}–{entry.endVal.toFixed(1)}</span>
        <span className="gp-col-hint gp-stick">L↕</span>
      </div>
    );
  }

  const { def, value } = entry;

  // bool: ON/OFF トグル列
  if (def.type === "bool") {
    const on = value === true || value === 1;
    return (
      <div className={cls} onClick={onClick}>
        <span className="gp-col-label">{def.key}</span>
        <div className="gp-col-center">
          <button
            className={`gp-col-toggle${on ? " on" : ""}`}
            onClick={e => { e.stopPropagation(); onToggle(); }}
          >
            {on ? "ON" : "OFF"}
          </button>
        </div>
        <span className="gp-col-hint gp-r3">R3</span>
      </div>
    );
  }

  // trigger: FIRE ボタン列
  if (def.type === "trigger") {
    return (
      <div className={cls} onClick={onClick}>
        <span className="gp-col-label">{def.key}</span>
        <div className="gp-col-center">
          <button
            className="gp-col-fire"
            onClick={e => { e.stopPropagation(); onTrigger(); }}
          >
            FIRE
          </button>
        </div>
        <span className="gp-col-hint gp-r3">R3</span>
      </div>
    );
  }

  // enum: チップ列
  if (def.type === "enum" && def.options) {
    return (
      <div className={`${cls} gp-param-col-wide`} onClick={onClick}>
        <span className="gp-col-label">{def.key}</span>
        <div className="gp-col-enum-list">
          {def.options.map(o => (
            <button
              key={o}
              className={`gp-col-enum-chip${o === String(value) ? " selected" : ""}`}
              onClick={e => { e.stopPropagation(); onEnumSelect(o); }}
            >
              {o}
            </button>
          ))}
        </div>
        <span className="gp-col-hint gp-dpad">↑↓</span>
      </div>
    );
  }

  // step: ◀ val ▶
  if (isStepParam(def)) {
    const num = typeof value === "number" ? value : Number(value);
    const displayAngle = ((num % 360) + 360) % 360;
    return (
      <div className={cls} onClick={onClick}>
        <span className="gp-col-label">{def.key}</span>
        <div className="gp-col-center">
          <div className="gp-col-step">
            <button className="gp-col-step-btn">▲</button>
            <span className="gp-col-step-val">{Math.round(displayAngle)}</span>
            <button className="gp-col-step-btn">▼</button>
          </div>
        </div>
        <span className="gp-col-hint gp-dpad">↑↓</span>
      </div>
    );
  }

  // float / int: 縦スライダー
  const num = typeof value === "number" ? value : Number(value);
  const min = def.min ?? 0;
  const max = def.max ?? 1;
  const pct = max > min ? ((num - min) / (max - min)) * 100 : 0;
  const displayVal = def.type === "int" ? String(Math.round(num)) : num.toFixed(2);

  return (
    <div className={cls} onClick={onClick}>
      <span className="gp-col-label">{def.key}</span>
      <div className="gp-vslider-track">
        <div className="gp-vslider-fill" style={{ height: `${clamp(pct, 0, 100)}%` }} />
      </div>
      <span className="gp-col-val">{displayVal}</span>
      <span className="gp-col-hint gp-stick">L↕</span>
    </div>
  );
}

// Export imperative handlers so GamepadRoot can call them
export type { Props as GamepadParamPanelProps };
