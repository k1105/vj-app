import { useEffect, useRef } from "react";
import { useVJStore } from "../state/vjStore";
import type { TransitionType } from "../../shared/types";
import { MidiLearnButton } from "./MidiLearnButton";

const TRANSITIONS: Array<{ type: TransitionType; label: string }> = [
  { type: "cut", label: "CUT" },
  { type: "crossfade", label: "FADE" },
  { type: "dissolve", label: "DSLV" },
  { type: "wipe", label: "WIPE" },
];

export function TransportBar() {
  const bpm = useVJStore((s) => s.state.bpm);
  const transitionType = useVJStore((s) => s.state.transition.type);
  const setTransitionType = useVJStore((s) => s.setTransitionType);
  const commitGo = useVJStore((s) => s.commitGo);
  const tap = useVJStore((s) => s.tap);
  const triggerFlash = useVJStore((s) => s.triggerFlash);

  return (
    <div className="transport">
      <div className="transport-transition">
        {TRANSITIONS.map((t) => (
          <button
            key={t.type}
            className={`btn-trans ${transitionType === t.type ? "active" : ""}`}
            onClick={() => setTransitionType(t.type)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="go-section">
        <button className="btn-go" onClick={() => commitGo()}>
          G O
        </button>
        <MidiLearnButton targetId="go" label="GO" group="Transport" />
      </div>
      <div className="tap-section">
        <button className="btn-tap" onClick={() => tap()}>
          TAP
        </button>
        <MidiLearnButton targetId="tap" label="TAP" group="Transport" />
        <span className="bpm">{bpm.toFixed(1)}</span>
        <span className="bpm-label">BPM</span>
        <BeatPulse />
      </div>
      <div className="transport-spacer" />
      <div className="flash-section">
        <button className="btn-flash" onClick={() => triggerFlash()}>
          FLASH
        </button>
        <MidiLearnButton targetId="flash" label="FLASH" group="Transport" />
      </div>
      <button
        className="btn-blackout"
        onClick={() => window.vj.toggleOutputFullscreen()}
      >
        FULLSCREEN
      </button>
    </div>
  );
}

/**
 * Visual beat pulse driven by a local rAF loop. Reads bpm/beatAnchor from
 * the store each frame; intentionally not a subscribed store value so we
 * don't re-render React on every tick — only the inline element updates.
 */
function BeatPulse() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const { bpm, beatAnchor } = useVJStore.getState().state;
      const el = ref.current;
      if (el && bpm > 0) {
        const beats = ((Date.now() - beatAnchor) * bpm) / 60000;
        const phase = beats - Math.floor(beats);
        // Sharp exponential decay from 1 at beat 0 to near 0 mid-beat.
        const intensity = Math.pow(1 - phase, 3);
        el.style.opacity = String(0.15 + intensity * 0.85);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <span ref={ref} className="bpm-pulse" />;
}
