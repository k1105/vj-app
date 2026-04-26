import { useEffect } from "react";
import { useMidiStore, formatAddress, shortAddress } from "../state/midiStore";

interface Props {
  targetId: string;
  /** Human-readable label shown in the MIDI Map panel. */
  label: string;
  group?: string;
}

/**
 * Dedicated MIDI-learn click area at the left edge of a param row.
 * Click to enter REC mode; the next physical control touched binds.
 * When mapped, displays the bound MIDI number (e.g. "13"). Right-click
 * clears the binding. Designed as a column-spanning vertical strip so
 * the click target is large even when the row is compact.
 */
export function MidiLearnSlot({ targetId, label, group }: Props) {
  const learningTarget = useMidiStore((s) => s.learningTarget);
  const mapped = useMidiStore((s) => s.mappings[targetId]);
  const isPulsing = useMidiStore((s) => s.pulseTargets[targetId] != null);
  const startLearn = useMidiStore((s) => s.startLearn);
  const cancelLearn = useMidiStore((s) => s.cancelLearn);
  const removeMapping = useMidiStore((s) => s.removeMapping);
  const registerTarget = useMidiStore((s) => s.registerTarget);
  const unregisterTarget = useMidiStore((s) => s.unregisterTarget);

  useEffect(() => {
    registerTarget(targetId, { label, group });
    return () => unregisterTarget(targetId);
  }, [targetId, label, group, registerTarget, unregisterTarget]);

  const isLearning = learningTarget === targetId;

  const cls =
    "midi-rec-slot" +
    (isLearning ? " learning" : "") +
    (mapped && !isLearning ? " mapped" : "") +
    (isPulsing ? " pulse" : "");

  const title = isLearning
    ? "REC — move a knob to bind · click to cancel"
    : mapped
    ? `${formatAddress(mapped)} · click to remap · right-click to clear`
    : "click to MIDI learn";

  return (
    <button
      type="button"
      className={cls}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        if (isLearning) cancelLearn();
        else startLearn(targetId);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (mapped) removeMapping(targetId);
      }}
    >
      {isLearning ? "●" : mapped ? shortAddress(mapped) : ""}
    </button>
  );
}
