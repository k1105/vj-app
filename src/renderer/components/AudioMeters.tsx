/**
 * Audio meter — placeholder. Lives inside the Master panel. When Web Audio
 * analysis lands, this will read VJState.audio.{volume,bass,mid,high} and
 * show live levels.
 */
export function AudioMeters() {
  const bands: { key: string; label: string; level: number }[] = [
    { key: "volume", label: "VOL", level: 0 },
    { key: "bass", label: "BASS", level: 0 },
    { key: "mid", label: "MID", level: 0 },
    { key: "high", label: "HIGH", level: 0 },
  ];
  return (
    <div className="audio-meters">
      <div className="audio-meters-header">
        <span>Audio</span>
        <span className="audio-meters-status">offline</span>
      </div>
      <div className="audio-meters-grid">
        {bands.map((b) => (
          <div key={b.key} className="audio-meter">
            <div className="audio-meter-label">{b.label}</div>
            <div className="audio-meter-bar">
              <div
                className="audio-meter-fill"
                style={{ width: `${b.level * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
