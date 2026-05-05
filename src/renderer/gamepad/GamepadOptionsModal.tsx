import { useGamepadFocusStore } from "./gamepadFocusStore";

type BtnClass =
  | "ob-circle" | "ob-cross" | "ob-triangle" | "ob-square"
  | "ob-l1" | "ob-r1" | "ob-l2" | "ob-r2" | "ob-l1r1"
  | "ob-l3" | "ob-r3" | "ob-lstick" | "ob-dpad" | "ob-options";

interface MappingRow {
  btns: { label: string; cls: BtnClass }[];
  action: string;
  context?: string;
}

const GLOBAL_ROWS: MappingRow[] = [
  { btns: [{ label: "D-PAD", cls: "ob-dpad" }], action: "フォーカス移動" },
  { btns: [{ label: "○", cls: "ob-circle" }],   action: "アセット / PostFX on/off" },
  { btns: [{ label: "△", cls: "ob-triangle" }], action: "パラメータパネルを開く" },
  { btns: [{ label: "✕", cls: "ob-cross" }],    action: "アセット削除（確認あり）" },
  { btns: [{ label: "□", cls: "ob-square" }],   action: "Stage toggle (ON/CANCEL)" },
  { btns: [{ label: "R2", cls: "ob-r2" }], action: "Stage release（ステージ中のみ）" },
  { btns: [{ label: "L1", cls: "ob-l1" }],      action: "TAP BPM" },
  { btns: [{ label: "R1", cls: "ob-r1" }],      action: "FLASH" },
  { btns: [{ label: "L1", cls: "ob-l1" }, { label: "R1", cls: "ob-r1" }], action: "BURST" },
  { btns: [{ label: "OPTIONS", cls: "ob-options" }], action: "このマッピング表示" },
];

const PANEL_ROWS: MappingRow[] = [
  { btns: [{ label: "↑↓", cls: "ob-dpad" }],      action: "パラメータ行を選択" },
  { btns: [{ label: "R Stick ↕", cls: "ob-r3" }], action: "float / int 値を変更", context: "連続値" },
  { btns: [{ label: "←→", cls: "ob-dpad" }],      action: "step / enum を切替", context: "離散値" },
  { btns: [{ label: "R3", cls: "ob-r3" }],         action: "bool toggle / trigger 発火" },
  { btns: [{ label: "○", cls: "ob-circle" }],      action: "アセット on/off（パネル内でも）" },
  { btns: [{ label: "△", cls: "ob-triangle" }],    action: "パネルを閉じる" },
];

const PICKER_ROWS: MappingRow[] = [
  { btns: [{ label: "D-PAD", cls: "ob-dpad" }], action: "アセット選択" },
  { btns: [{ label: "○", cls: "ob-circle" }],   action: "選択したアセットを追加" },
  { btns: [{ label: "△", cls: "ob-triangle" }, { label: "✕", cls: "ob-cross" }], action: "閉じる" },
];

function Row({ row }: { row: MappingRow }) {
  return (
    <div className="gp-opts-row">
      <div className="gp-opts-btns">
        {row.btns.map((b, i) => (
          <span key={i} className={`gp-opts-btn ${b.cls}`}>{b.label}</span>
        ))}
      </div>
      <span className="gp-opts-action">{row.action}</span>
      {row.context && <span className="gp-opts-ctx">{row.context}</span>}
    </div>
  );
}

export function GamepadOptionsModal() {
  const open  = useGamepadFocusStore((s) => s.optionsOpen);
  const close = useGamepadFocusStore((s) => s.closeOptions);

  return (
    <div className={`gp-modal-overlay${open ? " open" : ""}`} onClick={close}>
      <div className="gp-opts-card" onClick={e => e.stopPropagation()}>
        <div className="gp-opts-title">OPTIONS — ボタンマッピング</div>
        <div className="gp-opts-grid">
          <div className="gp-opts-col">
            <div className="gp-opts-col-title">グローバル</div>
            {GLOBAL_ROWS.map((r, i) => <Row key={i} row={r} />)}
          </div>
          <div className="gp-opts-col">
            <div className="gp-opts-col-title">パラメータパネル内</div>
            {PANEL_ROWS.map((r, i) => <Row key={i} row={r} />)}
            <div className="gp-opts-col-title" style={{ marginTop: 12 }}>アセットピッカー内</div>
            {PICKER_ROWS.map((r, i) => <Row key={i} row={r} />)}
          </div>
        </div>
        <div className="gp-opts-foot">OPTIONS ボタンまたは背景クリックで閉じる</div>
      </div>
    </div>
  );
}
