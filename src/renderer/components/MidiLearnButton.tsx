import { useMidiStore, formatAddress, shortAddress } from "../state/midiStore";

interface Props {
  targetId: string;
}

export function MidiLearnButton({ targetId }: Props) {
  const learningTarget = useMidiStore((s) => s.learningTarget);
  const mapped = useMidiStore((s) => s.mappings[targetId]);
  const isPulsing = useMidiStore((s) => s.pulseTargets[targetId] != null);
  const startLearn = useMidiStore((s) => s.startLearn);
  const cancelLearn = useMidiStore((s) => s.cancelLearn);
  const removeMapping = useMidiStore((s) => s.removeMapping);

  const isLearning = learningTarget === targetId;

  const title = isLearning
    ? "Listening for MIDI… click to cancel"
    : mapped
    ? `${formatAddress(mapped)} · click to remap · right-click to clear`
    : "MIDI learn";

  const label = isLearning ? "●" : mapped ? shortAddress(mapped) : "M";

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
      {label}
    </button>
  );
}
