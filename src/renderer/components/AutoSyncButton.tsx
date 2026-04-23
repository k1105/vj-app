import { useAutoSyncStore } from "../state/autoSyncStore";

interface Props {
  targetId: string;
}

/**
 * Tiny button that toggles BPM-synced LFO on a slider-backed param.
 * Default period is 1 bar, triangle wave between min and max.
 */
export function AutoSyncButton({ targetId }: Props) {
  const active = useAutoSyncStore((s) => s.active[targetId] != null);
  const toggle = useAutoSyncStore((s) => s.toggle);

  return (
    <button
      className={`sync-btn${active ? " active" : ""}`}
      title={active ? "BPM sync ON · click to disable" : "BPM sync (1 bar, min↔max)"}
      onClick={(e) => {
        e.stopPropagation();
        toggle(targetId);
      }}
    >
      ~
    </button>
  );
}
