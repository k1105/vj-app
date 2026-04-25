import { useMemo } from "react";
import {
  useMidiStore,
  formatAddress,
  type MidiAddress,
  type TargetInfo,
} from "../../state/midiStore";
import { useMidiMapPanelStore } from "../../state/midiMapPanelStore";
import {
  LCXL3_LAYOUT,
  type ControlDef,
} from "./lcxl3Layout";

/** Resolve a control's effective address: override wins over default. */
function effectiveAddress(
  control: ControlDef,
  overrides: Record<string, MidiAddress>,
): MidiAddress | null {
  return overrides[control.id] ?? control.defaultAddress;
}

/** Stable address key for use as a Map key / dedup. */
function addrKey(a: MidiAddress): string {
  return `${a.channel}:${a.type}:${a.number}`;
}

export function MidiMapPanel() {
  const open = useMidiMapPanelStore((s) => s.open);
  const setOpen = useMidiMapPanelStore((s) => s.setOpen);
  const selectedTargetId = useMidiMapPanelStore((s) => s.selectedTargetId);
  const calibratingControlId = useMidiMapPanelStore((s) => s.calibratingControlId);
  const selectTarget = useMidiMapPanelStore((s) => s.selectTarget);
  const startCalibrate = useMidiMapPanelStore((s) => s.startCalibrate);
  const overrides = useMidiMapPanelStore((s) => s.overrides);
  const clearOverride = useMidiMapPanelStore((s) => s.clearOverride);

  const targets = useMidiStore((s) => s.targets);
  const mappings = useMidiStore((s) => s.mappings);
  const physicalPulses = useMidiStore((s) => s.physicalPulses);
  const assignMapping = useMidiStore((s) => s.assignMapping);
  const removeMapping = useMidiStore((s) => s.removeMapping);

  // Build address → targetId index so each physical slot can show what it controls.
  const addressToTarget = useMemo(() => {
    const m = new Map<string, string>();
    for (const [id, addr] of Object.entries(mappings)) {
      m.set(addrKey(addr), id);
    }
    return m;
  }, [mappings]);

  if (!open) return null;

  const groupedTargets = groupTargets(targets);

  const handleControlClick = (control: ControlDef) => {
    const addr = effectiveAddress(control, overrides);

    // No address yet → calibration flow regardless of any picker selection.
    if (!addr) {
      startCalibrate(control.id);
      return;
    }

    // If user pre-selected a target chip, assign it to this control.
    if (selectedTargetId) {
      assignMapping(selectedTargetId, addr);
      selectTarget(null);
      return;
    }

    // Otherwise toggle calibration on this control (lets user override an
    // assumed default if it's wrong).
    if (calibratingControlId === control.id) startCalibrate(null);
    else startCalibrate(control.id);
  };

  const handleControlContext = (e: React.MouseEvent, control: ControlDef) => {
    e.preventDefault();
    e.stopPropagation();
    const addr = effectiveAddress(control, overrides);
    if (addr) {
      const targetId = addressToTarget.get(addrKey(addr));
      if (targetId) removeMapping(targetId);
    }
    if (overrides[control.id]) clearOverride(control.id);
  };

  return (
    <div className="midi-map-overlay" onClick={() => setOpen(false)}>
      <div className="midi-map-panel" onClick={(e) => e.stopPropagation()}>
        <div className="midi-map-header">
          <span className="midi-map-title">MIDI MAP — Launch Control XL 3</span>
          <span className="midi-map-hint">
            click a target → click a knob · right-click slot to clear · M to close
          </span>
          <button className="midi-map-close" onClick={() => setOpen(false)}>
            ×
          </button>
        </div>

        <div className="midi-map-targets">
          {Object.entries(groupedTargets).map(([groupName, ids]) => (
            <div key={groupName} className="midi-map-target-group">
              <div className="midi-map-target-group-name">{groupName}</div>
              <div className="midi-map-target-chips">
                {ids.map((id) => {
                  const info = targets[id];
                  const mapped = mappings[id];
                  const isSelected = selectedTargetId === id;
                  return (
                    <button
                      key={id}
                      className={
                        "midi-map-chip" +
                        (isSelected ? " selected" : "") +
                        (mapped ? " mapped" : "")
                      }
                      onClick={() =>
                        selectTarget(isSelected ? null : id)
                      }
                      title={mapped ? formatAddress(mapped) : "unmapped"}
                    >
                      <span className="midi-map-chip-label">{info.label}</span>
                      {mapped && (
                        <span className="midi-map-chip-addr">
                          {formatAddress(mapped)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {Object.keys(targets).length === 0 && (
            <div className="midi-map-target-empty">
              no MIDI targets registered (mount controls to populate)
            </div>
          )}
        </div>

        <div className="midi-map-device">
          <Slot
            controls={LCXL3_LAYOUT.filter((c) => c.row >= 1 && c.row <= 3)}
            overrides={overrides}
            mappings={mappings}
            targets={targets}
            addressToTarget={addressToTarget}
            calibratingControlId={calibratingControlId}
            selectedTargetId={selectedTargetId}
            physicalPulses={physicalPulses}
            onClick={handleControlClick}
            onContext={handleControlContext}
            sectionClass="midi-map-knobs"
          />
          <Slot
            controls={LCXL3_LAYOUT.filter((c) => c.row === 4 || c.row === 5)}
            overrides={overrides}
            mappings={mappings}
            targets={targets}
            addressToTarget={addressToTarget}
            calibratingControlId={calibratingControlId}
            selectedTargetId={selectedTargetId}
            physicalPulses={physicalPulses}
            onClick={handleControlClick}
            onContext={handleControlContext}
            sectionClass="midi-map-buttons"
          />
          <Slot
            controls={LCXL3_LAYOUT.filter((c) => c.row === 6 && c.kind === "fader")}
            overrides={overrides}
            mappings={mappings}
            targets={targets}
            addressToTarget={addressToTarget}
            calibratingControlId={calibratingControlId}
            selectedTargetId={selectedTargetId}
            physicalPulses={physicalPulses}
            onClick={handleControlClick}
            onContext={handleControlContext}
            sectionClass="midi-map-faders"
          />
        </div>

        {calibratingControlId && (
          <div className="midi-map-calibrate-bar">
            calibrating <b>{calibratingControlId}</b> — touch the physical control on your device…
            <button onClick={() => startCalibrate(null)}>cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

function groupTargets(
  targets: Record<string, TargetInfo>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [id, info] of Object.entries(targets)) {
    const g = info.group ?? "Other";
    (out[g] ??= []).push(id);
  }
  // Stable order within groups by label.
  for (const g of Object.keys(out)) {
    out[g].sort((a, b) =>
      (targets[a].label || a).localeCompare(targets[b].label || b),
    );
  }
  return out;
}

interface SlotProps {
  controls: ControlDef[];
  overrides: Record<string, MidiAddress>;
  mappings: Record<string, MidiAddress>;
  targets: Record<string, TargetInfo>;
  addressToTarget: Map<string, string>;
  calibratingControlId: string | null;
  selectedTargetId: string | null;
  physicalPulses: Record<string, number>;
  onClick: (c: ControlDef) => void;
  onContext: (e: React.MouseEvent, c: ControlDef) => void;
  sectionClass: string;
}

function Slot({
  controls,
  overrides,
  mappings,
  targets,
  addressToTarget,
  calibratingControlId,
  selectedTargetId,
  physicalPulses,
  onClick,
  onContext,
  sectionClass,
}: SlotProps) {
  return (
    <div className={`midi-map-section ${sectionClass}`}>
      {controls.map((c) => {
        const addr = effectiveAddress(c, overrides);
        const targetId = addr ? addressToTarget.get(addrKey(addr)) : null;
        const targetLabel = targetId ? targets[targetId]?.label : null;
        const isCalibrating = calibratingControlId === c.id;
        const isPulsing = physicalPulses[c.id] != null;
        const isOrphan = !addr;

        const className =
          `midi-map-slot midi-map-slot-${c.kind}` +
          (targetLabel ? " assigned" : "") +
          (isCalibrating ? " calibrating" : "") +
          (isPulsing ? " pulse" : "") +
          (isOrphan ? " orphan" : "") +
          (selectedTargetId && addr ? " can-receive" : "");

        const style: React.CSSProperties = {
          gridColumn: `${c.col} / span ${c.colSpan ?? 1}`,
        };

        const title = targetLabel
          ? `${targetLabel} — ${addr ? formatAddress(addr) : ""}`
          : addr
          ? `unassigned · ${formatAddress(addr)}`
          : "needs calibration — click to bind";

        // Suppress mappings count noise:
        void mappings;

        return (
          <div
            key={c.id}
            className={className}
            style={style}
            title={title}
            onClick={() => onClick(c)}
            onContextMenu={(e) => onContext(e, c)}
          >
            <div className="midi-map-slot-shape" />
            <div className="midi-map-slot-text">
              {targetLabel ? (
                <span className="midi-map-slot-target">{targetLabel}</span>
              ) : (
                <span className="midi-map-slot-empty">{c.shortLabel}</span>
              )}
              <span className="midi-map-slot-addr">
                {addr ? formatAddress(addr) : "—"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
