import { useEffect, useState } from "react";
import { useVJStore } from "../state/vjStore";
import { MidiLearnButton } from "./MidiLearnButton";
import { AutoSyncButton } from "./AutoSyncButton";
import { AssetPreview } from "./AssetPreview";
import type { ParamDef } from "../../shared/types";

type ParamGroup =
  | { type: "range"; start: ParamDef; end: ParamDef }
  | { type: "single"; def: ParamDef };

function groupParams(params: ParamDef[]): ParamGroup[] {
  const groups: ParamGroup[] = [];
  let i = 0;
  while (i < params.length) {
    const d = params[i];
    if (d.key.endsWith("Start") && i + 1 < params.length) {
      const next = params[i + 1];
      const prefix = d.key.slice(0, -5);
      if (next.key === prefix + "End") {
        groups.push({ type: "range", start: d, end: next });
        i += 2;
        continue;
      }
    }
    groups.push({ type: "single", def: d });
    i++;
  }
  return groups;
}

export function AssetParamsPanel() {
  const selectedLayer = useVJStore((s) => s.state.selectedLayer);
  const layer = useVJStore((s) => s.state.layers[selectedLayer]);
  const plugins = useVJStore((s) => s.plugins);
  const setClipParam = useVJStore((s) => s.setClipParam);

  // Edit the most-recently-selected clip on this layer: NEXT if a different
  // clip is queued, otherwise LIVE. Lets the user pre-configure params on a
  // clip before pressing GO — clicking a thumb queues it as NEXT and the
  // panel follows the queue.
  const activeIdx = layer?.activeClipIdx ?? -1;
  const nextIdx = layer?.nextClipIdx ?? -1;
  const editingClipIdx = nextIdx >= 0 ? nextIdx : activeIdx;
  const editingIsNext = nextIdx >= 0 && nextIdx !== activeIdx;
  const editingClip = editingClipIdx >= 0 ? layer?.clips[editingClipIdx] : null;
  const plugin = plugins.find((p) => p.id === editingClip?.pluginId);

  const setValue = (key: string, value: number | boolean | string) => {
    if (editingClipIdx < 0) return;
    setClipParam(selectedLayer, editingClipIdx, key, value);
  };

  const [savingDefaults, setSavingDefaults] = useState(false);
  const onSetAsDefault = async () => {
    if (!plugin || !editingClip) return;
    setSavingDefaults(true);
    try {
      await window.vj.setPluginDefaults(plugin.kind, plugin.id, editingClip.params);
    } catch (err) {
      console.error("[AssetParamsPanel] setPluginDefaults failed:", err);
      alert(`Set as Default failed: ${(err as Error).message}`);
    } finally {
      setSavingDefaults(false);
    }
  };

  // Array-valued params (e.g. "strings") are filtered out before reaching
  // ParamControl, so narrowing here is safe.
  const currentVal = (def: ParamDef): number | boolean | string => {
    const v = editingClip?.params[def.key];
    if (v !== undefined && !Array.isArray(v)) return v;
    return def.default as number | boolean | string;
  };

  const visibleParams = (plugin?.params ?? []).filter((d) => d.type !== "strings");

  return (
    <div className="asset-panel">
      <div className="asset-panel-header">
        <span className="asset-panel-title-text">Asset Parameters</span>
      </div>
      <div className="asset-preview-wrap">
        <div className="asset-preview-frame">
          <AssetPreview
            plugin={plugin ?? null}
            params={editingClip?.params ?? {}}
          />
        </div>
        <div className="asset-name">
          {plugin?.name ?? "--"}
          {editingClip && (
            <span className={`asset-edit-badge ${editingIsNext ? "next" : "live"}`}>
              {editingIsNext ? "NEXT" : "LIVE"}
            </span>
          )}
        </div>
        <div className="asset-layer-info">
          L{selectedLayer + 1}
          {editingClip ? ` · clip ${editingClipIdx + 1}/${layer!.clips.length}` : ""}
        </div>
      </div>

      <div className="asset-params">
        <div className="param-section-title">
          <span>Params</span>
          <button
            className="asset-default-btn"
            onClick={onSetAsDefault}
            disabled={!editingClip || savingDefaults}
            title="Save current params as the plugin's manifest defaults"
          >
            {savingDefaults ? "…" : "SET AS DEFAULT"}
          </button>
        </div>
        {!editingClip && (
          <div className="param-empty">no clip selected</div>
        )}
        {groupParams(visibleParams).map((group) => {
          const labelPrefix = `L${selectedLayer + 1} ${plugin?.name ?? "?"}`;
          if (group.type === "range") {
            const { start, end } = group;
            return (
              <RangeControl
                key={`${start.key}-${end.key}`}
                startDef={start}
                endDef={end}
                startValue={currentVal(start)}
                endValue={currentVal(end)}
                onStartChange={(v) => setValue(start.key, v)}
                onEndChange={(v) => setValue(end.key, v)}
                midiStartId={`clip:${selectedLayer}:${start.key}`}
                midiEndId={`clip:${selectedLayer}:${end.key}`}
                labelPrefix={labelPrefix}
              />
            );
          }
          return (
            <ParamControl
              key={group.def.key}
              def={group.def}
              value={currentVal(group.def)}
              onChange={(v) => setValue(group.def.key, v)}
              midiTargetId={`clip:${selectedLayer}:${group.def.key}`}
              labelPrefix={labelPrefix}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Two-thumb range slider for consecutive *Start / *End param pairs.
 * Enforces start ≤ end on every change.
 */
function RangeControl({
  startDef,
  endDef,
  startValue,
  endValue,
  onStartChange,
  onEndChange,
  midiStartId,
  midiEndId,
  labelPrefix,
}: {
  startDef: ParamDef;
  endDef: ParamDef;
  startValue: number | boolean | string;
  endValue: number | boolean | string;
  onStartChange: (v: number) => void;
  onEndChange: (v: number) => void;
  midiStartId: string;
  midiEndId: string;
  labelPrefix: string;
}) {
  const min = startDef.min ?? 0;
  const max = endDef.max ?? startDef.max ?? 1;
  const step = startDef.step ?? (startDef.type === "int" ? 1 : (max - min) / 100);

  const s = Math.max(min, Math.min(max, typeof startValue === "number" ? startValue : Number(startValue)));
  const e = Math.max(min, Math.min(max, typeof endValue === "number" ? endValue : Number(endValue)));

  // Percentage positions for the fill bar
  const range = max - min;
  const leftPct = ((s - min) / range) * 100;
  const rightPct = ((e - min) / range) * 100;

  const label =
    startDef.key.slice(0, -5) || "range"; // e.g. "loopStart" → "loop"

  // Loop range is a structural marker for the playhead window — controlling it
  // via MIDI / sync would just scrub the loop boundaries, which isn't musical.
  const showAutoControls = label !== "loop";

  const fmt = (v: number) =>
    startDef.type === "int" ? String(Math.round(v)) : v.toFixed(1);

  return (
    <div className="param-row param-range-row">
      <span className="param-label">{label}</span>
      <div className="range2-wrap">
        <div className="range2-track">
          <div
            className="range2-fill"
            style={{ left: `${leftPct}%`, width: `${rightPct - leftPct}%` }}
          />
        </div>
        {/* start thumb — lower z-index so end can pass over it */}
        <input
          type="range"
          className="range2-thumb range2-thumb-start"
          min={min}
          max={max}
          step={step}
          value={s}
          onChange={(ev) => {
            const v = Math.min(parseFloat(ev.target.value), e);
            onStartChange(startDef.type === "int" ? Math.round(v) : v);
          }}
        />
        {/* end thumb */}
        <input
          type="range"
          className="range2-thumb range2-thumb-end"
          min={min}
          max={max}
          step={step}
          value={e}
          onChange={(ev) => {
            const v = Math.max(parseFloat(ev.target.value), s);
            onEndChange(endDef.type === "int" ? Math.round(v) : v);
          }}
        />
      </div>
      <span className="param-val range2-val">
        {fmt(s)}–{fmt(e)}
      </span>
      {showAutoControls && (
        <>
          <MidiLearnButton
            targetId={midiStartId}
            label={`${labelPrefix} · ${startDef.key}`}
            group="Clip Params"
          />
          <AutoSyncButton targetId={midiStartId} />
          <MidiLearnButton
            targetId={midiEndId}
            label={`${labelPrefix} · ${endDef.key}`}
            group="Clip Params"
          />
          <AutoSyncButton targetId={midiEndId} />
        </>
      )}
    </div>
  );
}

/** Returns true when a param has a meaningful discrete step (≤ 12 positions). */
function isStepParam(def: ParamDef): boolean {
  if (def.type === "bool" || def.type === "enum" || !def.step) return false;
  const range = (def.max ?? 1) - (def.min ?? 0);
  const positions = range / def.step;
  return Number.isFinite(positions) && positions <= 12;
}

function ParamControl({
  def,
  value,
  onChange,
  midiTargetId,
  labelPrefix,
}: {
  def: ParamDef;
  value: number | boolean | string;
  onChange: (v: number | boolean | string) => void;
  midiTargetId: string;
  labelPrefix: string;
}) {
  const midiLabel = `${labelPrefix} · ${def.key}`;
  if (isStepParam(def)) {
    const num = typeof value === "number" ? value : Number(value);
    const step = def.step!;
    // Display normalised to [0, 360) — the store value accumulates unboundedly
    const displayAngle = ((num % 360) + 360) % 360;
    const displayVal = String(Math.round(displayAngle));
    return (
      <div className="param-row">
        <span className="param-label">{def.key}</span>
        <div className="param-step-group">
          <button className="param-step-btn" onClick={() => onChange(num - step)}>◀</button>
          <span className="param-step-val">{displayVal}</span>
          <button className="param-step-btn" onClick={() => onChange(num + step)}>▶</button>
        </div>
        <MidiLearnButton targetId={midiTargetId} label={midiLabel} group="Clip Params" />
      </div>
    );
  }

  if (def.type === "bool") {
    const on = value === true || value === 1;
    return (
      <div className="param-row">
        <span className="param-label">{def.key}</span>
        <button
          className={`param-toggle ${on ? "on" : ""}`}
          onClick={() => onChange(!on)}
        >
          {on ? "ON" : "OFF"}
        </button>
        <MidiLearnButton targetId={midiTargetId} label={midiLabel} group="Clip Params" />
      </div>
    );
  }

  if (def.type === "enum" && def.options) {
    return (
      <div className="param-row">
        <span className="param-label">{def.key}</span>
        <select
          className="param-select"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          {def.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <MidiLearnButton targetId={midiTargetId} label={midiLabel} group="Clip Params" />
      </div>
    );
  }

  if (def.type === "color") {
    const hex = typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
      ? value
      : typeof def.default === "string"
        ? def.default
        : "#000000";
    return (
      <div className="param-row">
        <span className="param-label">{def.key}</span>
        <input
          type="color"
          className="param-color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="param-val">{hex}</span>
      </div>
    );
  }

  if (def.type === "camera") {
    return (
      <div className="param-row">
        <span className="param-label">{def.key}</span>
        <CameraDeviceSelect
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
        />
      </div>
    );
  }

  // float / int
  const num = typeof value === "number" ? value : Number(value);
  const min = def.min ?? 0;
  const max = def.max ?? 1;
  const step = def.step ?? (def.type === "int" ? 1 : (max - min) / 100);
  const displayVal =
    def.type === "int" ? String(Math.round(num)) : num.toFixed(2);

  return (
    <div className="param-row">
      <span className="param-label">{def.key}</span>
      <input
        type="range"
        className="param-slider"
        min={min}
        max={max}
        step={step}
        value={num}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          onChange(def.type === "int" ? Math.round(v) : v);
        }}
      />
      <span className="param-val">{displayVal}</span>
      <MidiLearnButton targetId={midiTargetId} label={midiLabel} group="Clip Params" />
      <AutoSyncButton targetId={midiTargetId} />
    </div>
  );
}

/**
 * Dropdown of system-recognized video input devices. Labels are only
 * populated after camera permission is granted, so until the camera
 * plugin successfully opens a stream the entries fall back to a short
 * deviceId hash.
 */
function CameraDeviceSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setDevices(list.filter((d) => d.kind === "videoinput"));
      } catch {
        /* ignore — empty list is a fine default */
      }
    };
    refresh();
    navigator.mediaDevices.addEventListener?.("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.("devicechange", refresh);
    };
  }, []);

  return (
    <select
      className="param-select"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Default camera</option>
      {devices.map((d) => (
        <option key={d.deviceId} value={d.deviceId}>
          {d.label || `camera ${d.deviceId.slice(0, 6)}`}
        </option>
      ))}
    </select>
  );
}
