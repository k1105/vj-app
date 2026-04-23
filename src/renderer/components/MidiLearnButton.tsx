import { useMidiStore, formatAddress } from "../state/midiStore";

interface Props {
  targetId: string;
}

export function MidiLearnButton({ targetId }: Props) {
  const learningTarget = useMidiStore((s) => s.learningTarget);
  const mappings = useMidiStore((s) => s.mappings);
  const startLearn = useMidiStore((s) => s.startLearn);
  const cancelLearn = useMidiStore((s) => s.cancelLearn);
  const removeMapping = useMidiStore((s) => s.removeMapping);

  const mapped = mappings[targetId];
  const isLearning = learningTarget === targetId;

  const title = isLearning
    ? "Listening for MIDI… click to cancel"
    : mapped
    ? `${formatAddress(mapped)} · click to remap · right-click to clear`
    : "MIDI learn";

  return (
    <button
      className={`midi-learn-btn${isLearning ? " learning" : ""}${mapped && !isLearning ? " mapped" : ""}`}
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
      {isLearning ? "●" : "M"}
    </button>
  );
}
