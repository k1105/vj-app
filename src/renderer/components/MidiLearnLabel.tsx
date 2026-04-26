import { useEffect } from "react";
import { useMidiStore, formatAddress, shortAddress } from "../state/midiStore";

interface Props {
  targetId: string;
  /** Human-readable label shown in the MIDI Map panel. */
  label: string;
  /** Visible text — typically the param key. */
  text: string;
  group?: string;
  className?: string;
}

/**
 * A param label that doubles as a MIDI-learn trigger. Click → enter REC
 * mode; the next physical control touched binds to this target. Right
 * click → clear the binding. The same physical control can only bind to
 * one target at a time, so clicking another label and moving the same
 * knob silently re-routes — which is the whole point of this control:
 * fast, transient assignments without leaving stale mappings around.
 */
export function MidiLearnLabel({ targetId, label, text, group, className }: Props) {
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
    "midi-learn-label" +
    (className ? ` ${className}` : "") +
    (isLearning ? " learning" : "") +
    (mapped && !isLearning ? " mapped" : "") +
    (isPulsing ? " pulse" : "");

  const title = isLearning
    ? "REC — move a knob to bind · click to cancel"
    : mapped
    ? `${formatAddress(mapped)} · click to remap · right-click to clear`
    : "click to MIDI learn — move a knob to bind";

  return (
    <span
      className={cls}
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
      title={title}
    >
      {isLearning && <span className="midi-learn-rec">●</span>}
      <span className="midi-learn-text">{text}</span>
      {!isLearning && mapped && (
        <span className="midi-learn-addr">{shortAddress(mapped)}</span>
      )}
    </span>
  );
}
