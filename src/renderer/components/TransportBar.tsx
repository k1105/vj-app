import { useEffect, useRef, useState } from "react";
import { useVJStore } from "../state/vjStore";
import type { TransitionType } from "../../shared/types";
import { MidiLearnButton } from "./MidiLearnButton";

const TRANSITIONS: Array<{ type: TransitionType; label: string }> = [
  { type: "cut", label: "CUT" },
  { type: "crossfade", label: "FADE" },
  { type: "dissolve", label: "DSLV" },
  { type: "wipe", label: "WIPE" },
  { type: "blackout", label: "BLK" },
  { type: "whiteout", label: "WHT" },
];

export function TransportBar() {
  const bpm = useVJStore((s) => s.state.bpm);
  const transitionType = useVJStore((s) => s.state.transition.type);
  const setTransitionType = useVJStore((s) => s.setTransitionType);
  const tap = useVJStore((s) => s.tap);
  const triggerFlash = useVJStore((s) => s.triggerFlash);
  const setBurst = useVJStore((s) => s.setBurst);
  const stageMode = useVJStore((s) => s.stageMode);
  const enterStage = useVJStore((s) => s.enterStage);
  const releaseStage = useVJStore((s) => s.releaseStage);
  const cancelStage = useVJStore((s) => s.cancelStage);

  return (
    <div className="transport">
      <TransitionDropdown
        value={transitionType}
        onChange={setTransitionType}
      />
      <div className="stage-section">
        <button
          className={`btn-stage ${stageMode ? "active" : ""}`}
          onClick={() => (stageMode ? cancelStage() : enterStage())}
          title={stageMode ? "click to cancel staging" : "freeze output, edit, then release"}
        >
          {stageMode ? "STAGED" : "STAGE"}
        </button>
        <MidiLearnButton targetId="stage" label="STAGE" group="Transport" />
      </div>
      {stageMode && (
        <div className="go-section">
          <button className="btn-go release" onClick={releaseStage}>
            RELEASE
          </button>
          <MidiLearnButton targetId="release" label="RELEASE" group="Transport" />
        </div>
      )}
      <div className="tap-section">
        <button className="btn-tap" onClick={() => tap()}>
          TAP
        </button>
        <MidiLearnButton targetId="tap" label="TAP" group="Transport" />
        <span className="bpm">{bpm.toFixed(1)}</span>
        <span className="bpm-label">BPM</span>
        <BpmModeToggle />
        <BeatPulse />
      </div>
      <div className="transport-spacer" />
      <div className="flash-section">
        <button className="btn-flash" onClick={() => triggerFlash()}>
          FLASH
        </button>
        <MidiLearnButton targetId="flash" label="FLASH" group="Transport" />
      </div>
      <div className="flash-section">
        <button
          className="btn-burst"
          onMouseDown={() => setBurst(true)}
          onMouseUp={() => setBurst(false)}
          onMouseLeave={() => setBurst(false)}
          onTouchStart={(e) => {
            e.preventDefault();
            setBurst(true);
          }}
          onTouchEnd={() => setBurst(false)}
          title="hold for intense strobe"
        >
          BURST
        </button>
        <MidiLearnButton targetId="burst" label="BURST" group="Transport" />
      </div>
    </div>
  );
}

/**
 * Custom dropdown that opens UPWARD — we live at the bottom of the window,
 * so a regular <select> would either get clipped or cover GO/TAP. Items
 * stack upward from the selected value with the current pick highlighted.
 */
function TransitionDropdown({
  value,
  onChange,
}: {
  value: TransitionType;
  onChange: (next: TransitionType) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const current = TRANSITIONS.find((t) => t.type === value) ?? TRANSITIONS[0];
  return (
    <div className="transition-dropdown" ref={wrapRef}>
      <button
        className={`btn-trans active ${open ? "open" : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        {current.label}
        <span className="trans-caret">▲</span>
      </button>
      {open && (
        <div className="transition-dropdown-menu">
          {TRANSITIONS.map((t) => (
            <button
              key={t.type}
              className={`transition-dropdown-item ${t.type === value ? "active" : ""}`}
              onClick={() => {
                onChange(t.type);
                setOpen(false);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * MANUAL ↔ AUTO toggle. AUTO turns on the mic-driven BPM detector; the
 * detected tempo writes into state.bpm. In AUTO, TAP only nudges phase
 * (beat alignment), not tempo. Confidence-ish display from analyzer count.
 */
function BpmModeToggle() {
  const auto = useVJStore((s) => s.bpmAutoMode);
  const setAuto = useVJStore((s) => s.setBpmAutoMode);
  const detected = useVJStore((s) => s.bpmDetected);
  const stable = useVJStore((s) => s.bpmStable);
  return (
    <div className="bpm-mode">
      <button
        className={`btn-bpm-mode ${auto ? "auto" : "manual"}`}
        onClick={() => setAuto(!auto)}
        title={auto ? "click → MANUAL (TAP for tempo)" : "click → AUTO (mic-driven detection)"}
      >
        {auto ? "AUTO" : "MANUAL"}
      </button>
      {auto && (
        <span
          className={`bpm-auto-status ${stable ? "stable" : "listening"}`}
          title={detected != null ? `detector: ${detected.toFixed(1)} BPM` : "listening…"}
        >
          {detected != null ? (stable ? "●" : "◌") : "◌"}
        </span>
      )}
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
