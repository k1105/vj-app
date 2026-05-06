import { useEffect, useRef, useState } from "react";
import { useVJStore } from "../state/vjStore";
import { useAutoSyncStore } from "../state/autoSyncStore";
import { useGamepadFocusStore } from "./gamepadFocusStore";
import { readRStickY, readRStickX } from "./gamepadManager";
import type { ParamDef } from "../../shared/types";

const PARAM_SPEED = 0.012; // value delta per frame at full stick deflection

// ─── Helpers ───────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

type ParamEntry =
  | { type: "single"; def: ParamDef; value: number | boolean | string }
  | { type: "range";  startDef: ParamDef; endDef: ParamDef; startVal: number; endVal: number }
  | { type: "xy";     xDef: ParamDef; yDef: ParamDef; xVal: number; yVal: number };

function buildEntries(
  params: ParamDef[],
  getVal: (key: string) => number | boolean | string,
): ParamEntry[] {
  const out: ParamEntry[] = [];
  const consumed = new Set<number>();

  // *X/*Y ペアを 2D パッドにまとめる（R スティック同時操作用）
  for (let i = 0; i < params.length; i++) {
    if (consumed.has(i)) continue;
    const d = params[i];
    if (d.type === "strings") { consumed.add(i); continue; }
    if (d.key.endsWith("X") && (d.type === "float" || d.type === "int")) {
      const prefix = d.key.slice(0, -1);
      const yIdx = params.findIndex((p, j) =>
        j !== i && !consumed.has(j) && p.key === `${prefix}Y` && (p.type === "float" || p.type === "int")
      );
      if (yIdx >= 0) {
        const y = params[yIdx];
        out.push({
          type: "xy", xDef: d, yDef: y,
          xVal: Number(getVal(d.key)), yVal: Number(getVal(y.key)),
        });
        consumed.add(i); consumed.add(yIdx);
        continue;
      }
    }
    out.push({ type: "single", def: d, value: getVal(d.key) });
    consumed.add(i);
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
  const target         = useGamepadFocusStore((s) => s.target);
  const panelOpen      = useGamepadFocusStore((s) => s.paramPanelOpen);
  const layerParamOpen = useGamepadFocusStore((s) => s.layerParamOpen);
  const layerParamIdx  = useGamepadFocusStore((s) => s.layerParamIdx);
  const closeLayerParam = useGamepadFocusStore((s) => s.closeLayerParam);
  const layers      = useVJStore((s) => s.state.layers);
  const postfx      = useVJStore((s) => s.state.postfx);
  const plugins     = useVJStore((s) => s.plugins);
  const setClipParam       = useVJStore((s) => s.setClipParam);
  const setPostFXSlotParam = useVJStore((s) => s.setPostFXSlotParam);
  const setLayerBlend      = useVJStore((s) => s.setLayerBlend);
  const setLayerOpacity    = useVJStore((s) => s.setLayerOpacity);
  const setLayerMute       = useVJStore((s) => s.setLayerMute);
  const setLayerSolo       = useVJStore((s) => s.setLayerSolo);

  const autoSyncActive = useAutoSyncStore((s) => s.active);

  const isOpen = panelOpen || layerParamOpen;

  const [focusedRow, setFocusedRow] = useState(0);
  // カメラデバイス一覧（camera型パラメータ用）
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const camerasRef = useRef<MediaDeviceInfo[]>([]);
  camerasRef.current = cameras;
  useEffect(() => {
    if (!isOpen) return;
    if (!navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setCameras(list.filter((d) => d.kind === "videoinput"));
      } catch { /* ignore */ }
    };
    refresh();
    navigator.mediaDevices.addEventListener?.("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.("devicechange", refresh);
    };
  }, [isOpen]);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const flashSaveStatus = (msg: string) => {
    setSaveMsg(msg);
    setTimeout(() => setSaveMsg(null), 2000);
  };

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
        saveDefaults: () => window.vj.setPluginDefaults(plugin.kind, plugin.id, clip.params),
        targetIdFor: (key: string) => `clip:${target.layerIdx}:${key}`,
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
        saveDefaults: () => window.vj.setPluginDefaults("postfx", plugin.id, slot.params ?? {}),
        targetIdFor: (key: string) => `postfx-slot:${target.slotIdx}:param:${key}`,
      };
    }
    return null;
  })();

  // レイヤーパラメータ用 data（layerParamOpen 時に data を上書き）
  const layerData = (() => {
    if (!layerParamOpen || layerParamIdx === null) return null;
    const layer = layers[layerParamIdx];
    if (!layer) return null;
    const BLEND_OPTS = ["normal", "add", "multiply", "screen"];
    const entries: ParamEntry[] = [
      { type: "single", def: { key: "opacity", type: "float", default: 1, min: 0, max: 1 }, value: layer.opacity },
      { type: "single", def: { key: "blend",   type: "enum",  default: "normal", options: BLEND_OPTS }, value: layer.blend },
      { type: "single", def: { key: "mute",    type: "bool",  default: false }, value: layer.mute },
      { type: "single", def: { key: "solo",    type: "bool",  default: false }, value: layer.solo },
    ];
    return {
      title: `L${layerParamIdx + 1} — Layer`,
      subtitle: "",
      entries,
      layer: null,
      setValue: (key: string, val: number | boolean | string) => {
        if (key === "opacity") setLayerOpacity(layerParamIdx, val as number);
        if (key === "blend")   setLayerBlend(layerParamIdx, val as "normal"|"add"|"multiply"|"screen");
        if (key === "mute")    setLayerMute(layerParamIdx, val as boolean);
        if (key === "solo")    setLayerSolo(layerParamIdx, val as boolean);
      },
      targetIdFor: (key: string) => key === "opacity" ? `layer-opacity-${layerParamIdx}` : null,
    };
  })();

  const activeData = layerData ?? data;

  // Reset row focus when target/mode changes
  useEffect(() => { setFocusedRow(0); }, [target, layerParamOpen, layerParamIdx]);

  // R stick → continuous float/int delta
  const dataRef = useRef(activeData);
  const rowRef  = useRef(focusedRow);
  dataRef.current = activeData;
  rowRef.current  = focusedRow;

  useEffect(() => {
    if (!isOpen) return;
    let raf: number;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const ly = readRStickY();
      const lx = readRStickX();
      const d = dataRef.current;
      if (!d) return;
      const entry = d.entries[rowRef.current];
      if (!entry) return;

      // xy エントリは X/Y 両軸を同時に動かす
      if (entry.type === "xy") {
        if (Math.abs(lx) < 0.01 && Math.abs(ly) < 0.01) return;
        const apply = (def: ParamDef, cur: number, axis: number) => {
          const min = def.min ?? 0;
          const max = def.max ?? 1;
          const delta = axis * PARAM_SPEED * (max - min);
          const next = clamp(cur + delta, min, max);
          d.setValue(def.key, def.type === "int" ? Math.round(next) : next);
        };
        // X 軸: 右がプラス、Y 軸: 上方向（-ly）がプラス
        apply(entry.xDef, entry.xVal,  lx);
        apply(entry.yDef, entry.yVal, -ly);
        return;
      }

      if (Math.abs(ly) < 0.01) return;
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
      const dir = (e as CustomEvent<"left" | "right">).detail;
      const d2 = dataRef.current;
      if (!d2) return;
      const entry = d2.entries[rowRef.current];
      if (!entry) return;
      const delta2 = dir === "right" ? 1 : -1;
      if (entry.type === "xy") {
        // ←→ は X 軸のみを step 動かす
        const xMin = entry.xDef.min ?? 0;
        const xMax = entry.xDef.max ?? 1;
        const step = entry.xDef.step ?? ((xMax - xMin) / 20);
        const next = clamp(entry.xVal + step * delta2, xMin, xMax);
        d2.setValue(entry.xDef.key, entry.xDef.type === "int" ? Math.round(next) : next);
        return;
      }
      if (entry.type !== "single") return;
      const def = entry.def;
      if (def.type === "enum" && def.options) {
        const cur = def.options.indexOf(String(entry.value));
        d2.setValue(def.key, def.options[(cur + delta2 + def.options.length) % def.options.length]);
      } else if (isStepParam(def)) {
        const cur = typeof entry.value === "number" ? entry.value : Number(entry.value);
        d2.setValue(def.key, clamp(cur + def.step! * delta2, def.min ?? 0, def.max ?? 1));
      } else if (def.type === "float" || def.type === "int") {
        const step = def.step ?? ((def.max ?? 1) - (def.min ?? 0)) / 20;
        const cur  = typeof entry.value === "number" ? entry.value : Number(entry.value);
        d2.setValue(def.key, clamp(cur + step * delta2, def.min ?? 0, def.max ?? 1));
      }
    };
    const flashStatus = (msg: string, level: "info" | "warn" = "info") =>
      window.dispatchEvent(new CustomEvent("gp:flash-status", { detail: { msg, level } }));
    const toggleAutoSyncFor = (id: string | null | undefined, label: string) => {
      if (!id) { flashStatus(`${label}: autoSync 対象外`, "warn"); return; }
      useAutoSyncStore.getState().toggle(id);
      const isOn = !!useAutoSyncStore.getState().active[id];
      flashStatus(`${label}: autoSync ${isOn ? "ON" : "OFF"}`);
    };
    const onR3 = () => {
      const d2 = dataRef.current as (typeof activeData) | null;
      if (!d2) return;
      const entry = d2.entries[rowRef.current];
      if (!entry) return;
      const tFor = (d2 as { targetIdFor?: (key: string) => string | null }).targetIdFor;
      if (entry.type === "range") {
        const sId = tFor?.(entry.startDef.key);
        const eId = tFor?.(entry.endDef.key);
        toggleAutoSyncFor(sId, entry.startDef.key);
        if (eId) useAutoSyncStore.getState().toggle(eId);
        return;
      }
      if (entry.type === "xy") {
        const xId = tFor?.(entry.xDef.key);
        const yId = tFor?.(entry.yDef.key);
        toggleAutoSyncFor(xId, entry.xDef.key);
        if (yId) useAutoSyncStore.getState().toggle(yId);
        return;
      }
      const def = entry.def;
      if (def.type === "bool")    { d2.setValue(def.key, !entry.value); flashStatus(`${def.key}: ${!entry.value ? "ON" : "OFF"}`); return; }
      if (def.type === "trigger") { d2.setValue(def.key, Date.now()); flashStatus(`${def.key}: fired`); return; }
      if (def.type === "float" || def.type === "int") {
        toggleAutoSyncFor(tFor?.(def.key), def.key);
      } else {
        flashStatus(`${def.key}: 操作不可`, "warn");
      }
    };
    const onAdjust = (e: Event) => {
      const dir = (e as CustomEvent<"inc" | "dec">).detail;
      const d2 = dataRef.current;
      if (!d2) return;
      const entry = d2.entries[rowRef.current];
      if (!entry) return;
      const delta = dir === "inc" ? 1 : -1;
      if (entry.type === "range") {
        const min = entry.startDef.min ?? 0;
        const max = entry.endDef.max ?? entry.startDef.max ?? 1;
        const step = entry.startDef.step ?? ((max - min) / 20);
        d2.setValue(entry.startDef.key, clamp(entry.startVal + step * delta, min, entry.endVal));
        d2.setValue(entry.endDef.key,   clamp(entry.endVal   + step * delta, entry.startVal, max));
        return;
      }
      if (entry.type === "xy") {
        // ↑↓ は Y 軸のみを step 動かす
        const yMin = entry.yDef.min ?? 0;
        const yMax = entry.yDef.max ?? 1;
        const step = entry.yDef.step ?? ((yMax - yMin) / 20);
        const next = clamp(entry.yVal + step * delta, yMin, yMax);
        d2.setValue(entry.yDef.key, entry.yDef.type === "int" ? Math.round(next) : next);
        return;
      }
      const { def, value } = entry;
      if (def.type === "bool") { d2.setValue(def.key, !value); return; }
      if (def.type === "trigger") { d2.setValue(def.key, Date.now()); return; }
      // リスト型: ↓ = 次（index+1）, ↑ = 前（index-1）
      // 現状 ↑ = "inc" / ↓ = "dec" なので、リストでは反転させる
      const listDelta = -delta;
      if (def.type === "enum" && def.options) {
        const cur = def.options.indexOf(String(value));
        d2.setValue(def.key, def.options[(cur + listDelta + def.options.length) % def.options.length]);
        return;
      }
      if (def.type === "camera") {
        const ids = ["", ...camerasRef.current.map(c => c.deviceId)];
        const cur = Math.max(0, ids.indexOf(String(value)));
        d2.setValue(def.key, ids[(cur + listDelta + ids.length) % ids.length]);
        return;
      }
      if (isStepParam(def)) {
        const cur = typeof value === "number" ? value : Number(value);
        d2.setValue(def.key, clamp(cur + def.step! * delta, def.min ?? 0, def.max ?? 1));
        return;
      }
      // float / int — それ以外の型は数値変換しない
      if (def.type !== "float" && def.type !== "int") return;
      const cur = typeof value === "number" ? value : Number(value);
      const step = def.step ?? ((def.max ?? 1) - (def.min ?? 0)) / 20;
      const next = clamp(cur + step * delta, def.min ?? 0, def.max ?? 1);
      d2.setValue(def.key, def.type === "int" ? Math.round(next) : next);
    };
    const onSet = () => {
      const d2 = dataRef.current;
      // saveDefaults はclip / postfxにのみ存在（layerには無い）
      const fn = (d2 as { saveDefaults?: () => Promise<unknown> } | null)?.saveDefaults;
      if (!fn) {
        flashSaveStatus("not available");
        return;
      }
      flashSaveStatus("saving…");
      Promise.resolve(fn()).then(
        () => flashSaveStatus("✓ saved as default"),
        (err: Error) => flashSaveStatus(`✗ ${err.message}`),
      );
    };
    window.addEventListener("gp:param-nav",    onNav);
    window.addEventListener("gp:param-adjust", onAdjust);
    window.addEventListener("gp:param-step",   onStep);
    window.addEventListener("gp:param-r3",     onR3);
    window.addEventListener("gp:param-set",    onSet);
    return () => {
      window.removeEventListener("gp:param-nav",    onNav);
      window.removeEventListener("gp:param-adjust", onAdjust);
      window.removeEventListener("gp:param-step",   onStep);
      window.removeEventListener("gp:param-r3",     onR3);
      window.removeEventListener("gp:param-set",    onSet);
    };
  }, []);

  const handleClose = layerParamOpen ? closeLayerParam : onClose;

  return (
    <div className={`gp-param-panel${isOpen ? " open" : ""}`}>
      {activeData && (
        <>
          <div className="gp-panel-header">
            <span className="gp-panel-title">{activeData.title}</span>
            <span className="gp-panel-subtitle">{activeData.subtitle}</span>
            {saveMsg && <span className="gp-save-toast">{saveMsg}</span>}
            <button className="gp-panel-close" onClick={handleClose}>
              <span className="gp-btn-badge gp-tri">△</span> 閉じる
            </button>
          </div>

          {activeData.layer && (
            <div className="gp-layer-strip">
              <span className="gp-strip-label">Opacity</span>
              <div className="gp-opacity-track">
                <div className="gp-opacity-fill" style={{ width: `${Math.round(activeData.layer.opacity * 100)}%` }} />
              </div>
              <span className="gp-opacity-val">{Math.round(activeData.layer.opacity * 100)}</span>
              <div className="gp-sep" />
              <span className="gp-strip-label">Blend</span>
              {(["normal", "add", "multiply", "screen"] as const).map(b => (
                <button
                  key={b}
                  className={`gp-blend-opt${activeData.layer!.blend === b ? " active" : ""}`}
                  onClick={() => setLayerBlend(activeData.layer!.idx, b)}
                >
                  {b === "normal" ? "NRM" : b === "multiply" ? "MUL" : b.toUpperCase()}
                </button>
              ))}
            </div>
          )}

          <div className="gp-param-cols">
            {activeData.entries.map((entry, i) => {
              const key = entry.type === "single" ? entry.def.key
                        : entry.type === "range"  ? entry.startDef.key
                        : entry.xDef.key;
              const targetId = activeData.targetIdFor?.(key) ?? null;
              const syncActive = targetId ? !!autoSyncActive[targetId] : false;
              return (
              <ParamCol
                key={i}
                entry={entry}
                cameras={cameras}
                focused={i === focusedRow}
                syncActive={syncActive}
                onClick={() => setFocusedRow(i)}
                onToggle={() => {
                  if (entry.type === "single" && entry.def.type === "bool") {
                    activeData.setValue(entry.def.key, !entry.value);
                  }
                }}
                onTrigger={() => {
                  if (entry.type === "single" && entry.def.type === "trigger") {
                    activeData.setValue(entry.def.key, Date.now());
                  }
                }}
                onEnumSelect={(val) => {
                  if (entry.type === "single") activeData.setValue(entry.def.key, val);
                }}
              />
              );
            })}
          </div>

          <div className="gp-param-guide">
            <span className="gp-guide-item"><span className="gp-btn-badge gp-dpad">←→</span> 選択</span>
            <span className="gp-guide-item"><span className="gp-btn-badge gp-stick">R ↕</span> 連続変更</span>
            <span className="gp-guide-item"><span className="gp-btn-badge gp-dpad">↑↓</span> ステップ変更</span>
            <span className="gp-guide-item">
              <span className="gp-btn-badge gp-r3">R3</span>
              <span className="gp-guide-or">or</span>
              <span className="gp-btn-badge gp-l3">L3</span>
              <span className="gp-guide-or">or</span>
              <span className="gp-btn-badge gp-circle">○</span>
              <span style={{ marginLeft: 4 }}>auto-sync / toggle / fire</span>
            </span>
            <span className="gp-guide-item"><span className="gp-btn-badge gp-options">OPTIONS</span> 既定値として保存</span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Param column (縦スライダー＋横並び) ────────────────────────────────────

function ParamCol({
  entry, cameras, focused, syncActive, onClick, onToggle, onTrigger, onEnumSelect,
}: {
  entry: ParamEntry;
  cameras: MediaDeviceInfo[];
  focused: boolean;
  syncActive: boolean;
  onClick: () => void;
  onToggle: () => void;
  onTrigger: () => void;
  onEnumSelect: (val: string) => void;
}) {
  const cls = `gp-param-col${focused ? " focused" : ""}${syncActive ? " sync-active" : ""}`;

  // xy: 2D パッド (R スティック両軸で同時操作)
  if (entry.type === "xy") {
    const xMin = entry.xDef.min ?? 0;
    const xMax = entry.xDef.max ?? 1;
    const yMin = entry.yDef.min ?? 0;
    const yMax = entry.yDef.max ?? 1;
    const xPct = xMax > xMin ? ((entry.xVal - xMin) / (xMax - xMin)) * 100 : 50;
    // Y は上方向が大きい値となるよう下から計算
    const yPct = yMax > yMin ? ((entry.yVal - yMin) / (yMax - yMin)) * 100 : 50;
    const label = entry.xDef.key.slice(0, -1) || "xy"; // 共通プレフィックス
    return (
      <div className={`${cls} gp-param-col-xy`} onClick={onClick}>
        <span className="gp-col-label">{label}</span>
        <div className="gp-xy-pad">
          <div className="gp-xy-grid" />
          <div
            className="gp-xy-dot"
            style={{ left: `${clamp(xPct, 0, 100)}%`, bottom: `${clamp(yPct, 0, 100)}%` }}
          />
        </div>
        <span className="gp-col-val">
          {entry.xVal.toFixed(2)}, {entry.yVal.toFixed(2)}
        </span>
        <span className="gp-col-hint gp-stick">R↕↔</span>
      </div>
    );
  }

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
        <span className="gp-col-hint gp-stick">R↕</span>
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

  if (def.type === "camera") {
    const ids = ["", ...cameras.map(c => c.deviceId)];
    const labels = ["Default camera", ...cameras.map(c => c.label || `camera ${c.deviceId.slice(0, 6)}`)];
    const curIdx = Math.max(0, ids.indexOf(String(value ?? "")));
    return (
      <div className={`${cls} gp-param-col-wide`} onClick={onClick}>
        <span className="gp-col-label">{def.key}</span>
        <div className="gp-col-enum-list">
          {ids.map((id, i) => (
            <button
              key={id || "default"}
              className={`gp-col-enum-chip${i === curIdx ? " selected" : ""}`}
              onClick={e => { e.stopPropagation(); onEnumSelect(id); }}
              title={labels[i]}
            >
              {labels[i]}
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
      <span className="gp-col-hint gp-stick">R↕</span>
    </div>
  );
}

// Export imperative handlers so GamepadRoot can call them
export type { Props as GamepadParamPanelProps };
