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

function effectiveAddress(
  control: ControlDef,
  overrides: Record<string, MidiAddress>,
): MidiAddress | null {
  return overrides[control.id] ?? control.defaultAddress;
}

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
    if (control.kind === "display") return;
    const addr = effectiveAddress(control, overrides);

    if (!addr) {
      startCalibrate(control.id);
      return;
    }

    if (selectedTargetId) {
      assignMapping(selectedTargetId, addr);
      selectTarget(null);
      return;
    }

    if (calibratingControlId === control.id) startCalibrate(null);
    else startCalibrate(control.id);
  };

  const handleControlContext = (e: React.MouseEvent, control: ControlDef) => {
    e.preventDefault();
    e.stopPropagation();
    if (control.kind === "display") return;
    const addr = effectiveAddress(control, overrides);
    if (addr) {
      const targetId = addressToTarget.get(addrKey(addr));
      if (targetId) removeMapping(targetId);
    }
    if (overrides[control.id]) clearOverride(control.id);
  };

  const mainControls = LCXL3_LAYOUT.filter((c) => c.section === "main");
  const sideControls = LCXL3_LAYOUT.filter((c) => c.section === "side");

  return (
    <div className="midi-map-overlay" onClick={() => setOpen(false)}>
      <div className="midi-map-panel" onClick={(e) => e.stopPropagation()}>
        <div className="midi-map-header">
          <span className="midi-map-title">MIDI MAP — Launch Control XL 3</span>
          <span className="midi-map-hint">
            click target → click control · right-click slot to clear · M to close
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
              no MIDI targets registered
            </div>
          )}
        </div>

        <div className="midi-map-device">
          {/* Left side column — Display, Page, Track, Rec/Play, Shift/Mode */}
          <div className="midi-map-side">
            {sideControls.map((c) => (
              <Slot
                key={c.id}
                control={c}
                overrides={overrides}
                targets={targets}
                addressToTarget={addressToTarget}
                calibratingControlId={calibratingControlId}
                selectedTargetId={selectedTargetId}
                physicalPulses={physicalPulses}
                onClick={handleControlClick}
                onContext={handleControlContext}
              />
            ))}
          </div>

          {/* Main 6×8 grid: knobs (3) → faders → buttons (2) */}
          <div className="midi-map-main">
            {mainControls.map((c) => (
              <Slot
                key={c.id}
                control={c}
                overrides={overrides}
                targets={targets}
                addressToTarget={addressToTarget}
                calibratingControlId={calibratingControlId}
                selectedTargetId={selectedTargetId}
                physicalPulses={physicalPulses}
                onClick={handleControlClick}
                onContext={handleControlContext}
              />
            ))}
          </div>
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
  for (const g of Object.keys(out)) {
    out[g].sort((a, b) =>
      (targets[a].label || a).localeCompare(targets[b].label || b),
    );
  }
  return out;
}

interface SlotProps {
  control: ControlDef;
  overrides: Record<string, MidiAddress>;
  targets: Record<string, TargetInfo>;
  addressToTarget: Map<string, string>;
  calibratingControlId: string | null;
  selectedTargetId: string | null;
  physicalPulses: Record<string, number>;
  onClick: (c: ControlDef) => void;
  onContext: (e: React.MouseEvent, c: ControlDef) => void;
}

function Slot({
  control,
  overrides,
  targets,
  addressToTarget,
  calibratingControlId,
  selectedTargetId,
  physicalPulses,
  onClick,
  onContext,
}: SlotProps) {
  const addr = effectiveAddress(control, overrides);
  const targetId = addr ? addressToTarget.get(addrKey(addr)) : null;
  const targetLabel = targetId ? targets[targetId]?.label : null;
  const isCalibrating = calibratingControlId === control.id;
  const isPulsing = physicalPulses[control.id] != null;
  const isOrphan = !addr;
  const isDisplay = control.kind === "display";

  const className =
    `midi-map-slot midi-map-slot-${control.kind}` +
    (targetLabel ? " assigned" : "") +
    (isCalibrating ? " calibrating" : "") +
    (isPulsing ? " pulse" : "") +
    (isOrphan && !isDisplay ? " orphan" : "") +
    (isDisplay ? " display" : "") +
    (selectedTargetId && addr ? " can-receive" : "");

  const style: React.CSSProperties =
    control.section === "main"
      ? { gridColumn: control.col, gridRow: control.row }
      : {};

  const title = isDisplay
    ? "Mode Select / Peak (non-MIDI display)"
    : targetLabel
    ? `${targetLabel} — ${addr ? formatAddress(addr) : ""}`
    : addr
    ? `unassigned · ${formatAddress(addr)}`
    : "needs calibration — click to bind";

  return (
    <div
      className={className}
      style={style}
      title={title}
      onClick={() => onClick(control)}
      onContextMenu={(e) => onContext(e, control)}
    >
      <div className="midi-map-slot-shape" />
      <div className="midi-map-slot-text">
        {targetLabel ? (
          <span className="midi-map-slot-target">{targetLabel}</span>
        ) : (
          <span className="midi-map-slot-empty">{control.shortLabel}</span>
        )}
        {addr && !isDisplay && (
          <span className="midi-map-slot-addr">{formatAddress(addr)}</span>
        )}
      </div>
    </div>
  );
}
