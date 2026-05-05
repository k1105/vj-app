import { useState } from "react";
import { useVJStore } from "../state/vjStore";
import { useGamepadFocusStore } from "./gamepadFocusStore";

export function GamepadAssetPicker() {
  const layerIdx     = useGamepadFocusStore((s) => s.assetPickerLayer);
  const close        = useGamepadFocusStore((s) => s.closeAssetPicker);
  const plugins      = useVJStore((s) => s.plugins);
  const addClip      = useVJStore((s) => s.addClip);
  const [focusedIdx, setFocusedIdx] = useState(0);

  const available = plugins.filter(p => p.kind === "material" && !p.hidden);
  const open = layerIdx !== null;

  const handleSelect = (pluginId: string) => {
    if (layerIdx === null) return;
    addClip(layerIdx, pluginId);
    close();
  };

  return (
    <div className={`gp-modal-overlay${open ? " open" : ""}`} onClick={close}>
      <div className="gp-picker-panel" onClick={e => e.stopPropagation()}>
        <div className="gp-panel-header">
          <span className="gp-panel-title">アセット追加</span>
          <span className="gp-panel-subtitle">{layerIdx !== null ? `L${layerIdx + 1}` : ""}</span>
          <button className="gp-panel-close" onClick={close}>
            <span className="gp-btn-badge gp-cross">✕</span> 閉じる
          </button>
        </div>
        <div className="gp-picker-grid">
          {available.length === 0 && (
            <div style={{ color: "var(--text-muted)", fontSize: 11, padding: 12 }}>
              プラグインが見つかりません
            </div>
          )}
          {available.map((p, i) => (
            <div
              key={p.id}
              className={`gp-picker-item${i === focusedIdx ? " focused" : ""}`}
              onClick={() => handleSelect(p.id)}
              onMouseEnter={() => setFocusedIdx(i)}
            >
              {p.thumbnailUrl ? (
                <img src={p.thumbnailUrl} className="gp-picker-thumb" alt={p.name} />
              ) : (
                <div className="gp-picker-thumb-placeholder">{p.name[0]}</div>
              )}
              <div className="gp-picker-name">{p.name}</div>
            </div>
          ))}
        </div>
        <div className="gp-param-guide">
          <span className="gp-guide-item"><span className="gp-btn-badge gp-dpad">D-PAD</span> 選択</span>
          <span className="gp-guide-item"><span className="gp-btn-badge gp-circle">○</span> 追加</span>
          <span className="gp-guide-item"><span className="gp-btn-badge gp-tri">△</span> 閉じる</span>
        </div>
      </div>
    </div>
  );
}
