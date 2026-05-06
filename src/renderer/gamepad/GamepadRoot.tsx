import { useEffect, useRef, useCallback, useMemo } from "react";
import { useVJStore } from "../state/vjStore";
import { useGamepadFocusStore, type FocusTarget } from "./gamepadFocusStore";
import {
  addGamepadListener,
  isButtonHeld,
  isGamepadConnected,
  readRStickY,
  type ButtonName,
} from "./gamepadManager";
import { gpidFor } from "./GamepadFocusOverlay";

// ─── Navigation grid ────────────────────────────────────────────────────────

/** Build the D-pad navigation grid from current state.
 *  視覚順に合わせる: PostFX が最上段、その下にレイヤー。 */
function buildGrid(
  layers: ReturnType<typeof useVJStore.getState>["state"]["layers"],
): FocusTarget[][] {
  const grid: FocusTarget[][] = [];
  // PostFX row (first row, matches visual position above layers)
  const pfxRow: FocusTarget[] = Array.from({ length: 8 }, (_, i) => ({
    kind: "postfx", slotIdx: i,
  }));
  grid.push(pfxRow);
  // Layer rows
  layers.forEach((layer, li) => {
    const row: FocusTarget[] = layer.clips.map((_, ci) => ({
      kind: "clip", layerIdx: li, clipIdx: ci,
    }));
    row.push({ kind: "add", layerIdx: li });
    grid.push(row);
  });
  return grid;
}

// ─── D-pad repeat helper ─────────────────────────────────────────────────────

const REPEAT_DELAY = 380;
const REPEAT_RATE  = 80;

function useRepeat(_key: ButtonName, onFire: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 最新の onFire を ref に保持し、関数自体は安定参照にする
  const fireRef = useRef(onFire);
  fireRef.current = onFire;

  // useMemo で同一参照を保証。レンダー毎に新しい {start, stop} を返さない
  return useMemo(() => ({
    start: () => {
      fireRef.current();
      timerRef.current = setTimeout(() => {
        intervalRef.current = setInterval(() => fireRef.current(), REPEAT_RATE);
      }, REPEAT_DELAY);
    },
    stop: () => {
      if (timerRef.current)   { clearTimeout(timerRef.current);   timerRef.current   = null; }
      if (intervalRef.current){ clearInterval(intervalRef.current); intervalRef.current = null; }
    },
  }), []);
}

// ─── GamepadRoot ─────────────────────────────────────────────────────────────

export function GamepadRoot() {
  const gridRef  = useRef<FocusTarget[][]>([]);
  const rowRef   = useRef(0);
  const colRef   = useRef(0);
  const r2Held   = useRef(false); // R2 押下を自前追跡

  // Keep grid in sync with layers (layers の参照変化のみで反応)
  const layers = useVJStore((s) => s.state.layers);
  useEffect(() => {
    gridRef.current = buildGrid(layers);
    const grid = gridRef.current;
    rowRef.current = Math.min(rowRef.current, grid.length - 1);
    if (grid[rowRef.current]) {
      colRef.current = Math.min(colRef.current, grid[rowRef.current].length - 1);
    }
  }, [layers]);

  // Check for gamepad connection periodically
  useEffect(() => {
    const iv = setInterval(() => {
      const connected = isGamepadConnected();
      useGamepadFocusStore.getState().setActive(connected);
      document.body.classList.toggle("gamepad-active", connected);
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // ─── R stick → opacity（パネル非表示時）────────────────────────────────────
  useEffect(() => {
    const SPEED = 0.01;
    let raf: number;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const fs = useGamepadFocusStore.getState();
      if (fs.paramPanelOpen || fs.layerParamOpen || fs.optionsOpen ||
          fs.assetPickerLayer !== null || fs.deleteTarget !== null) return;
      const ry = readRStickY();
      if (Math.abs(ry) < 0.01) return;
      const t = fs.target;
      if (!t || (t.kind !== "clip" && t.kind !== "add")) return;
      const li = t.layerIdx;
      const cur = useVJStore.getState().state.layers[li]?.opacity ?? 1;
      const next = Math.max(0, Math.min(1, cur - ry * SPEED));
      useVJStore.getState().setLayerOpacity(li, next);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ─── Navigation helpers ───────────────────────────────────────────────────

  const applyTarget = useCallback(() => {
    const grid = gridRef.current;
    const r    = rowRef.current;
    const c    = colRef.current;
    const t    = grid[r]?.[c] ?? null;
    useGamepadFocusStore.getState().setTarget(t);
    // Scroll the focused element into view
    const sel = gpidFor(t);
    if (sel) {
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(sel)
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    }
  }, []);

  const moveUp    = useCallback(() => {
    const grid = gridRef.current;
    rowRef.current = Math.max(0, rowRef.current - 1);
    colRef.current = Math.min(colRef.current, (grid[rowRef.current]?.length ?? 1) - 1);
    applyTarget();
  }, [applyTarget]);

  const moveDown  = useCallback(() => {
    const grid = gridRef.current;
    rowRef.current = Math.min(grid.length - 1, rowRef.current + 1);
    colRef.current = Math.min(colRef.current, (grid[rowRef.current]?.length ?? 1) - 1);
    applyTarget();
  }, [applyTarget]);

  const moveLeft  = useCallback(() => {
    colRef.current = Math.max(0, colRef.current - 1);
    applyTarget();
  }, [applyTarget]);

  const moveRight = useCallback(() => {
    const grid = gridRef.current;
    const maxCol = (grid[rowRef.current]?.length ?? 1) - 1;
    colRef.current = Math.min(maxCol, colRef.current + 1);
    applyTarget();
  }, [applyTarget]);

  // D-pad repeats
  const upRepeat    = useRepeat("up",    moveUp);
  const downRepeat  = useRepeat("down",  moveDown);
  const leftRepeat  = useRepeat("left",  moveLeft);
  const rightRepeat = useRepeat("right", moveRight);

  const stopAllRepeats = useCallback(() => {
    upRepeat.stop(); downRepeat.stop(); leftRepeat.stop(); rightRepeat.stop();
  }, [upRepeat, downRepeat, leftRepeat, rightRepeat]);

  // ─── Button actions ───────────────────────────────────────────────────────

  const onPress = useCallback((button: ButtonName) => {
    const fs  = useGamepadFocusStore.getState();
    const vjs = useVJStore.getState();

    // Modals take priority
    if (fs.optionsOpen) {
      if (button === "options" || button === "cross" || button === "triangle") fs.closeOptions();
      return;
    }
    if (fs.assetPickerLayer !== null) {
      if (button === "triangle" || button === "cross") fs.closeAssetPicker();
      // ○ to confirm: handled by GamepadAssetPicker internally
      return;
    }
    if (fs.deleteTarget) {
      // 確定は ○、キャンセルは ✕ または △
      if (button === "triangle" || button === "cross") {
        fs.closeDeleteConfirm();
        return;
      }
      if (button === "circle") {
        const t = fs.deleteTarget;
        if (t.kind === "clip") {
          vjs.removeClip(t.layerIdx, t.clipIdx);
          const newMax = (gridRef.current[t.layerIdx]?.length ?? 1) - 1;
          colRef.current = Math.min(colRef.current, newMax);
          applyTarget();
        }
        fs.closeDeleteConfirm();
      }
      return;
    }
    if (fs.layerParamOpen) {
      if (button === "triangle") { fs.closeLayerParam(); return; }
      if (button === "left")     { paramNavEvent("up");    return; }
      if (button === "right")    { paramNavEvent("down");  return; }
      if (button === "up")       { paramAdjustEvent("inc"); return; }
      if (button === "down")     { paramAdjustEvent("dec"); return; }
      if (button === "r3")       { paramR3Event(); return; }
      if (button === "circle")   { paramToggleEvent(); return; }
      return;
    }
    if (fs.paramPanelOpen) {
      if (button === "triangle") { fs.closeParamPanel(); return; }
      if (button === "options")  { paramSetEvent(); return; }
      if (button === "left")     { paramNavEvent("up");    return; }
      if (button === "right")    { paramNavEvent("down");  return; }
      if (button === "up")       { paramAdjustEvent("inc"); return; }
      if (button === "down")     { paramAdjustEvent("dec"); return; }
      if (button === "r3")       { paramR3Event(); return; }
      if (button === "circle")   { paramToggleEvent(); return; }
      return;
    }

    // ── Global navigation ──
    // R2 + ↑/↓ : 各レイヤーの LIVE クリップに順送りジャンプ
    if ((button === "up" || button === "down") && r2Held.current) {
      jumpToLiveClip(button === "down" ? 1 : -1);
      return;
    }
    // R2 + ←/→ : 現在フォーカス中のレイヤーの LIVE クリップにスナップ
    if ((button === "left" || button === "right") && r2Held.current) {
      jumpToLiveOfCurrentLayer();
      return;
    }
    if (button === "up")    { upRepeat.start();    return; }
    if (button === "down")  { downRepeat.start();  return; }
    if (button === "left")  { leftRepeat.start();  return; }
    if (button === "right") { rightRepeat.start(); return; }

    if (button === "triangle") {
      const t = fs.target;
      if (r2Held.current && t && (t.kind === "clip" || t.kind === "add")) {
        stopAllRepeats();
        fs.openLayerParam(t.layerIdx);
        return;
      }
      if (t && (t.kind === "clip" || t.kind === "postfx")) {
        stopAllRepeats();
        fs.openParamPanel();
      }
      return;
    }
    if (button === "options") { stopAllRepeats(); fs.openOptions(); return; }
    if (button === "circle")  { handleCircle(); return; }
    if (button === "cross")   { handleCross();  return; }
    if (button === "square")  { handleSquare(); return; }
    if (button === "l1") {
      if (isButtonHeld("r1")) { vjs.setBurst(true); return; }
      vjs.tap(); return;
    }
    if (button === "r1") {
      if (isButtonHeld("l1")) { vjs.setBurst(true); return; }
      vjs.triggerFlash(); return;
    }
    if (button === "r2") {
      r2Held.current = true;
      if (vjs.stageMode) { vjs.releaseStage?.(); return; }
    }
  }, [applyTarget, upRepeat, downRepeat, leftRepeat, rightRepeat]);

  const onRelease = useCallback((button: ButtonName) => {
    if (button === "up")    upRepeat.stop();
    if (button === "down")  downRepeat.stop();
    if (button === "left")  leftRepeat.stop();
    if (button === "right") rightRepeat.stop();
    if (button === "l1" || button === "r1") useVJStore.getState().setBurst(false);
    if (button === "r2") r2Held.current = false;
  }, [upRepeat, downRepeat, leftRepeat, rightRepeat]);

  // Param panel D-pad/R3 events (dispatched as custom DOM events so
  // GamepadParamPanel can respond without prop drilling).
  const paramNavEvent    = (dir: "up"|"down")     => window.dispatchEvent(new CustomEvent("gp:param-nav",    { detail: dir }));
  const paramAdjustEvent = (dir: "inc"|"dec")    => window.dispatchEvent(new CustomEvent("gp:param-adjust", { detail: dir }));
  const paramSetEvent    = ()                    => window.dispatchEvent(new CustomEvent("gp:param-set"));
  const paramToggleEvent = ()                    => window.dispatchEvent(new CustomEvent("gp:param-toggle"));

  const paramR3Event   = () => window.dispatchEvent(new CustomEvent("gp:param-r3"));

  /**
   * R2 + ←/→: 今フォーカス中のレイヤー内で LIVE クリップにスナップ。
   * 既に LIVE クリップ上ならノーオペ。
   */
  const jumpToLiveOfCurrentLayer = () => {
    const fs = useGamepadFocusStore.getState();
    const t = fs.target;
    if (!t || (t.kind !== "clip" && t.kind !== "add")) return;
    const layer = useVJStore.getState().state.layers[t.layerIdx];
    if (!layer || layer.activeClipIdx < 0) return;
    if (t.kind === "clip" && t.clipIdx === layer.activeClipIdx) return; // 既に上
    rowRef.current = 1 + t.layerIdx;
    colRef.current = layer.activeClipIdx;
    applyTarget();
  };

  /**
   * R2 + ↑/↓ でアクティブ（LIVE）クリップ間を順送りジャンプ。
   * activeClipIdx >= 0 のレイヤーをリスト化し、現在位置から ±1 でループ。
   */
  const jumpToLiveClip = (dir: 1 | -1) => {
    const state = useVJStore.getState().state;
    const liveTargets: { layerIdx: number; clipIdx: number }[] = [];
    state.layers.forEach((layer, li) => {
      if (layer.activeClipIdx >= 0) liveTargets.push({ layerIdx: li, clipIdx: layer.activeClipIdx });
    });
    if (liveTargets.length === 0) {
      window.dispatchEvent(new CustomEvent("gp:flash-status",
        { detail: { msg: "LIVE中のアセットがありません", level: "warn" } }));
      return;
    }
    // 現在のフォーカス位置に最も近い LIVE ターゲットの index を起点にする
    const fs = useGamepadFocusStore.getState();
    const t = fs.target;
    const curLayerIdx = t && (t.kind === "clip" || t.kind === "add") ? t.layerIdx : -1;
    let curIdx = liveTargets.findIndex(x => x.layerIdx === curLayerIdx);
    if (curIdx < 0) curIdx = 0;
    const nextIdx = (curIdx + dir + liveTargets.length) % liveTargets.length;
    const next = liveTargets[nextIdx];
    // grid 上の row/col に変換（PostFX が row 0、レイヤーは row 1+）
    rowRef.current = 1 + next.layerIdx;
    colRef.current = next.clipIdx;
    applyTarget();
  };

  const handleCircle = () => {
    const t   = useGamepadFocusStore.getState().target;
    const vjs = useVJStore.getState();
    if (!t) return;
    if (t.kind === "add")    { useGamepadFocusStore.getState().openAssetPicker(t.layerIdx); return; }
    if (t.kind === "clip")   { vjs.triggerClip(t.layerIdx, t.clipIdx); return; }
    if (t.kind === "postfx") { vjs.togglePostFXSlot(t.slotIdx); return; }
  };

  const handleCross = () => {
    const t = useGamepadFocusStore.getState().target;
    if (!t || t.kind !== "clip") return;
    // online（activeClip）のクリップは削除不可
    const layer = useVJStore.getState().state.layers[t.layerIdx];
    if (layer && layer.activeClipIdx === t.clipIdx) {
      window.dispatchEvent(new CustomEvent("gp:flash-status", {
        detail: { msg: "LIVE中のアセットは削除できません", level: "warn" },
      }));
      return;
    }
    useGamepadFocusStore.getState().openDeleteConfirm(t);
  };

  const handleSquare = () => {
    const vjs = useVJStore.getState();
    if (vjs.stageMode) vjs.cancelStage();
    else vjs.enterStage();
  };

  // Wire up gamepad listener
  useEffect(() => {
    return addGamepadListener((ev) => {
      if (ev.type === "press")   onPress(ev.button);
      if (ev.type === "release") onRelease(ev.button);
    });
  }, [onPress, onRelease]);

  // Wire param-panel events to GamepadParamPanel
  // (GamepadParamPanel listens on window itself)

  // ─── Delete confirm modal (inline, small) ────────────────────────────────
  const deleteTarget = useGamepadFocusStore((s) => s.deleteTarget);
  const closeDelete  = useGamepadFocusStore((s) => s.closeDeleteConfirm);
  const removeClip   = useVJStore((s) => s.removeClip);

  const confirmDelete = () => {
    if (!deleteTarget || deleteTarget.kind !== "clip") return;
    removeClip(deleteTarget.layerIdx, deleteTarget.clipIdx);
    closeDelete();
  };

  const deleteClipName = (() => {
    if (!deleteTarget || deleteTarget.kind !== "clip") return "";
    const clip = layers[deleteTarget.layerIdx]?.clips[deleteTarget.clipIdx];
    const plugins = useVJStore.getState().plugins;
    return plugins.find(p => p.id === clip?.pluginId)?.name ?? "?";
  })();

  // Note: GamepadFocusOverlay/ParamPanel/OptionsModal/AssetPicker は
  // GamepadApp 側で描画する。ここで描画すると二重マウントになり
  // window event listener が二重登録 → 押下イベントが二重発火する。
  return (
    <>
      {/* Delete confirm */}
      {deleteTarget && (
        <div className="gp-modal-overlay open" onClick={closeDelete}>
          <div className="gp-delete-card" onClick={e => e.stopPropagation()}>
            <div className="gp-delete-icon">⚠️</div>
            <div className="gp-delete-title">削除しますか？</div>
            <div className="gp-delete-body">「{deleteClipName}」をレイヤーから削除します。</div>
            <div className="gp-delete-actions">
              <button className="gp-delete-btn" onClick={closeDelete}>
                <span className="gp-btn-badge gp-cross">✕</span> キャンセル
              </button>
              <button className="gp-delete-btn danger" onClick={confirmDelete}>
                <span className="gp-btn-badge gp-circle">○</span> 削除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
