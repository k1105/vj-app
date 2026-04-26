import { useEffect, useRef } from "react";
import { useVJStore } from "../state/vjStore";

/**
 * Compact audio band meter strip — VOL / BASS / MID / HIGH side by side
 * along the bottom of the app. Reads the levels from VJState.audio,
 * which is populated by the bpmDetector's parallel AnalyserNode while
 * BPM AUTO is on. Levels are skipped through a per-frame rAF read off
 * the store rather than subscribed via React, so the bars repaint at
 * 60 fps without re-rendering siblings.
 */
export function AudioMeters() {
  const bpmAutoMode = useVJStore((s) => s.bpmAutoMode);
  const refs = {
    volume: useRef<HTMLDivElement>(null),
    bass:   useRef<HTMLDivElement>(null),
    mid:    useRef<HTMLDivElement>(null),
    high:   useRef<HTMLDivElement>(null),
  };

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const a = useVJStore.getState().state.audio;
      if (refs.volume.current) refs.volume.current.style.width = `${Math.round(a.volume * 100)}%`;
      if (refs.bass.current)   refs.bass.current.style.width   = `${Math.round(a.bass   * 100)}%`;
      if (refs.mid.current)    refs.mid.current.style.width    = `${Math.round(a.mid    * 100)}%`;
      if (refs.high.current)   refs.high.current.style.width   = `${Math.round(a.high   * 100)}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="audio-meters-strip">
      <span className="audio-meters-label">AUDIO</span>
      <span className={`audio-meters-status ${bpmAutoMode ? "live" : ""}`}>
        {bpmAutoMode ? "live" : "offline"}
      </span>
      <div className="audio-meter-row"><span>VOL</span>  <div className="audio-meter-bar"><div ref={refs.volume} className="audio-meter-fill" /></div></div>
      <div className="audio-meter-row"><span>BASS</span> <div className="audio-meter-bar"><div ref={refs.bass}   className="audio-meter-fill" /></div></div>
      <div className="audio-meter-row"><span>MID</span>  <div className="audio-meter-bar"><div ref={refs.mid}    className="audio-meter-fill" /></div></div>
      <div className="audio-meter-row"><span>HIGH</span> <div className="audio-meter-bar"><div ref={refs.high}   className="audio-meter-fill" /></div></div>
    </div>
  );
}
