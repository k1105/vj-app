import { forwardRef, useEffect, useRef, useState } from "react";
import { useVJStore } from "../state/vjStore";
import { MidiLearnButton } from "./MidiLearnButton";
import { MidiLearnLabel } from "./MidiLearnLabel";
import { AutoSyncButton } from "./AutoSyncButton";
import { AssetPreview } from "./AssetPreview";
import type { LayerState, ParamDef, PluginMeta } from "../../shared/types";

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

/**
 * Asset Parameters — stacks every layer's active clip so all live params
 * are simultaneously editable. Layers without an active clip are skipped.
 * Muted layers render dimmed but stay editable. Selection just
 * highlights + scrolls to the matching section.
 */
export function AssetParamsPanel() {
  const layers = useVJStore((s) => s.state.layers);
  const selectedLayer = useVJStore((s) => s.state.selectedLayer);
  const plugins = useVJStore((s) => s.plugins);
  const sectionRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    const el = sectionRefs.current[selectedLayer];
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedLayer]);

  const visibleLayers = layers
    .map((layer, idx) => ({ layer, idx }))
    .filter(({ layer }) => layer.activeClipIdx >= 0 && layer.clips[layer.activeClipIdx]);

  return (
    <div className="asset-panel">
      <div className="asset-panel-header">
        <span className="asset-panel-title-text">Asset Parameters</span>
      </div>
      <div className="asset-stack">
        {visibleLayers.length === 0 && (
          <div className="param-empty">no active clips on any layer</div>
        )}
        {visibleLayers.map(({ layer, idx }) => (
          <LayerSection
            key={idx}
            ref={(el) => {
              sectionRefs.current[idx] = el;
            }}
            layer={layer}
            layerIdx={idx}
            plugin={plugins.find((p) => p.id === layer.clips[layer.activeClipIdx]?.pluginId) ?? null}
            isSelected={selectedLayer === idx}
          />
        ))}
      </div>
    </div>
  );
}

interface LayerSectionProps {
  layer: LayerState;
  layerIdx: number;
  plugin: PluginMeta | null;
  isSelected: boolean;
}

const LayerSection = forwardRef<HTMLDivElement, LayerSectionProps>(
  function LayerSection({ layer, layerIdx, plugin, isSelected }, ref) {
    const setClipParam = useVJStore((s) => s.setClipParam);
    const selectLayer = useVJStore((s) => s.selectLayer);
    const clipIdx = layer.activeClipIdx;
    const clip = layer.clips[clipIdx];
    const [savingDefaults, setSavingDefaults] = useState(false);

    const setValue = (key: string, value: number | boolean | string) => {
      if (clipIdx < 0) return;
      setClipParam(layerIdx, clipIdx, key, value);
    };

    const onSetAsDefault = async () => {
      if (!plugin || !clip) return;
      setSavingDefaults(true);
      try {
        await window.vj.setPluginDefaults(plugin.kind, plugin.id, clip.params);
      } catch (err) {
        console.error("[AssetParamsPanel] setPluginDefaults failed:", err);
        alert(`Set as Default failed: ${(err as Error).message}`);
      } finally {
        setSavingDefaults(false);
      }
    };

    const currentVal = (def: ParamDef): number | boolean | string => {
      const v = clip?.params[def.key];
      if (v !== undefined && !Array.isArray(v)) return v;
      return def.default as number | boolean | string;
    };

    const visibleParams = (plugin?.params ?? []).filter((d) => d.type !== "strings");
    const labelPrefix = `L${layerIdx + 1} ${plugin?.name ?? "?"}`;
    const allGroups = groupParams(visibleParams);
    // If any param of this plugin opts into primary, only those groups are
    // shown by default; the rest are hidden behind a "MORE" expander.
    // Range pairs count as primary when either end is primary.
    const hasPrimary = visibleParams.some((p) => p.primary);
    const isPrimaryGroup = (g: ParamGroup) =>
      g.type === "range" ? !!(g.start.primary || g.end.primary) : !!g.def.primary;
    const [showAll, setShowAll] = useState(false);
    const groupsToRender = hasPrimary && !showAll ? allGroups.filter(isPrimaryGroup) : allGroups;
    const secondaryCount = allGroups.filter((g) => !isPrimaryGroup(g)).length;

    return (
      <div
        ref={ref}
        className={`asset-section ${isSelected ? "selected" : ""} ${layer.mute ? "muted" : ""}`}
        onClick={() => selectLayer(layerIdx)}
      >
        <div className="asset-section-header">
          <span className="asset-section-layer">L{layerIdx + 1}</span>
          <div className="asset-section-preview">
            <AssetPreview plugin={plugin} params={clip?.params ?? {}} />
          </div>
          <span className="asset-section-name">{plugin?.name ?? "?"}</span>
          {layer.mute && <span className="asset-edit-badge muted">MUTED</span>}
          <button
            className="asset-default-btn"
            onClick={(e) => {
              e.stopPropagation();
              onSetAsDefault();
            }}
            disabled={!clip || savingDefaults}
            title="Save current params as the plugin's manifest defaults"
          >
            {savingDefaults ? "…" : "SAVE"}
          </button>
        </div>
        <div className="asset-params">
          {groupsToRender.map((group) => {
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
                  midiStartId={`clip:${layerIdx}:${start.key}`}
                  midiEndId={`clip:${layerIdx}:${end.key}`}
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
                midiTargetId={`clip:${layerIdx}:${group.def.key}`}
                labelPrefix={labelPrefix}
              />
            );
          })}
          {visibleParams.length === 0 && (
            <div className="param-empty">no params</div>
          )}
          {hasPrimary && secondaryCount > 0 && (
            <button
              className="param-more-btn"
              onClick={(e) => {
                e.stopPropagation();
                setShowAll((v) => !v);
              }}
            >
              {showAll ? "▴ LESS" : `▾ ${secondaryCount} MORE`}
            </button>
          )}
        </div>
      </div>
    );
  },
);

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

  const range = max - min;
  const leftPct = ((s - min) / range) * 100;
  const rightPct = ((e - min) / range) * 100;

  const label = startDef.key.slice(0, -5) || "range";
  const showAutoControls = label !== "loop";

  const fmt = (v: number) =>
    startDef.type === "int" ? String(Math.round(v)) : v.toFixed(1);

  return (
    <div className="param-row param-range-row" onClick={(e) => e.stopPropagation()}>
      <span className="param-label">{label}</span>
      <div className="range2-wrap">
        <div className="range2-track">
          <div
            className="range2-fill"
            style={{ left: `${leftPct}%`, width: `${rightPct - leftPct}%` }}
          />
        </div>
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
    const displayAngle = ((num % 360) + 360) % 360;
    const displayVal = String(Math.round(displayAngle));
    return (
      <div className="param-row" onClick={(e) => e.stopPropagation()}>
        <MidiLearnLabel
          targetId={midiTargetId}
          label={midiLabel}
          text={def.key}
          group="Clip Params"
          className="param-label"
        />
        <div className="param-step-group">
          <button className="param-step-btn" onClick={() => onChange(num - step)}>◀</button>
          <span className="param-step-val">{displayVal}</span>
          <button className="param-step-btn" onClick={() => onChange(num + step)}>▶</button>
        </div>
      </div>
    );
  }

  if (def.type === "bool") {
    const on = value === true || value === 1;
    return (
      <div className="param-row" onClick={(e) => e.stopPropagation()}>
        <MidiLearnLabel
          targetId={midiTargetId}
          label={midiLabel}
          text={def.key}
          group="Clip Params"
          className="param-label"
        />
        <button
          className={`param-toggle ${on ? "on" : ""}`}
          onClick={() => onChange(!on)}
        >
          {on ? "ON" : "OFF"}
        </button>
      </div>
    );
  }

  if (def.type === "enum" && def.options) {
    return (
      <div className="param-row" onClick={(e) => e.stopPropagation()}>
        <MidiLearnLabel
          targetId={midiTargetId}
          label={midiLabel}
          text={def.key}
          group="Clip Params"
          className="param-label"
        />
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
      <div className="param-row" onClick={(e) => e.stopPropagation()}>
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
      <div className="param-row" onClick={(e) => e.stopPropagation()}>
        <span className="param-label">{def.key}</span>
        <CameraDeviceSelect
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
        />
      </div>
    );
  }

  const num = typeof value === "number" ? value : Number(value);
  const min = def.min ?? 0;
  const max = def.max ?? 1;
  const step = def.step ?? (def.type === "int" ? 1 : (max - min) / 100);
  const displayVal =
    def.type === "int" ? String(Math.round(num)) : num.toFixed(2);

  return (
    <div className="param-row" onClick={(e) => e.stopPropagation()}>
      <MidiLearnLabel
        targetId={midiTargetId}
        label={midiLabel}
        text={def.key}
        group="Clip Params"
        className="param-label"
      />
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
      <AutoSyncButton targetId={midiTargetId} />
    </div>
  );
}

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
