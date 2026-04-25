import { useEffect } from "react";
import { useMidiStore, formatAddress, shortAddress } from "../state/midiStore";

interface Props {
  targetId: string;
  /** Human-readable label shown in the MIDI Map panel. */
  label: string;
  /** Optional grouping in the picker (e.g. "Layers", "PostFX:bloom"). */
  group?: string;
}

export function MidiLearnButton({ targetId, label, group }: Props) {
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

  const title = isLearning
    ? "Listening for MIDI… click to cancel"
    : mapped
    ? `${formatAddress(mapped)} · click to remap · right-click to clear`
    : "MIDI learn";

  const buttonLabel = isLearning ? "●" : mapped ? shortAddress(mapped) : "M";

  const className =
    "midi-learn-btn" +
    (isLearning ? " learning" : "") +
    (mapped && !isLearning ? " mapped" : "") +
    (isPulsing ? " pulse" : "");

  return (
    <button
      className={className}
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
      {buttonLabel}
    </button>
  );
}
