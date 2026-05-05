import { useEffect, useRef, useCallback } from "react";
import { useVJStore } from "../state/vjStore";
import { useGamepadFocusStore, type FocusTarget } from "./gamepadFocusStore";
import {
  addGamepadListener,
  isButtonHeld,
  isGamepadConnected,
  type ButtonName,
} from "./gamepadManager";
import { GamepadFocusOverlay, gpidFor } from "./GamepadFocusOverlay";
import { GamepadParamPanel }   from "./GamepadParamPanel";
import { GamepadOptionsModal } from "./GamepadOptionsModal";
import { GamepadAssetPicker }  from "./GamepadAssetPicker";

// ─── Navigation grid ────────────────────────────────────────────────────────

/** Build the D-pad navigation grid from current state. */
function buildGrid(
  layers: ReturnType<typeof useVJStore.getState>["state"]["layers"],
): FocusTarget[][] {
  const grid: FocusTarget[][] = [];
  layers.forEach((layer, li) => {
    const row: FocusTarget[] = layer.clips.map((_, ci) => ({
      kind: "clip", layerIdx: li, clipIdx: ci,
    }));
    row.push({ kind: "add", layerIdx: li });
    grid.push(row);
  });
  // PostFX row
  const pfxRow: FocusTarget[] = Array.from({ length: 8 }, (_, i) => ({
    kind: "postfx", slotIdx: i,
  }));
  grid.push(pfxRow);
  return grid;
}

// ─── D-pad repeat helper ─────────────────────────────────────────────────────

const REPEAT_DELAY = 380;
const REPEAT_RATE  = 80;

function useRepeat(_key: ButtonName, onFire: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(() => {
    onFire();
    timerRef.current = setTimeout(() => {
      intervalRef.current = setInterval(onFire, REPEAT_RATE);
    }, REPEAT_DELAY);
  }, [onFire]);

  const stop = useCallback(() => {
    if (timerRef.current)   { clearTimeout(timerRef.current);   timerRef.current   = null; }
    if (intervalRef.current){ clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);

  return { start, stop };
}

// ─── GamepadRoot ─────────────────────────────────────────────────────────────

export function GamepadRoot() {
  const gridRef  = useRef<FocusTarget[][]>([]);
  const rowRef   = useRef(0);
  const colRef   = useRef(0);

  // Keep grid in sync with layers
  useEffect(() => {
    const unsub = useVJStore.subscribe((s) => {
      gridRef.current = buildGrid(s.state.layers);
      // Clamp current position
      const grid = gridRef.current;
      rowRef.current = Math.min(rowRef.current, grid.length - 1);
      if (grid[rowRef.current]) {
        colRef.current = Math.min(colRef.current, grid[rowRef.current].length - 1);
      }
    });
    // Init
    gridRef.current = buildGrid(useVJStore.getState().state.layers);
    return unsub;
  }, []);

  // Check for gamepad connection periodically
  useEffect(() => {
    const iv = setInterval(() => {
      const connected = isGamepadConnected();
      useGamepadFocusStore.getState().setActive(connected);
      document.body.classList.toggle("gamepad-active", connected);
    }, 1000);
    return () => clearInterval(iv);
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
      if (button === "triangle") fs.closeDeleteConfirm();
      if (button === "cross") {
        const t = fs.deleteTarget;
        if (t.kind === "clip") {
          vjs.removeClip(t.layerIdx, t.clipIdx);
          // Clamp col after removal
          const newMax = (gridRef.current[t.layerIdx]?.length ?? 1) - 1;
          colRef.current = Math.min(colRef.current, newMax);
          applyTarget();
        }
        fs.closeDeleteConfirm();
      }
      return;
    }
    if (fs.paramPanelOpen) {
      if (button === "triangle")  { fs.closeParamPanel(); return; }
      if (button === "circle")    { handleCircle(); return; }
      // D-pad and R3 handled by GamepadParamPanel via events below
      // 横並びレイアウト: ←→ で列移動、↑↓ で step/enum 操作
      if (button === "left")  { paramNavEvent("up");    return; }
      if (button === "right") { paramNavEvent("down");  return; }
      if (button === "up")    { paramStepEvent("left"); return; }
      if (button === "down")  { paramStepEvent("right");return; }
      if (button === "r3")    { paramR3Event();          return; }
      return;
    }

    // ── Global navigation ──
    if (button === "up")    { upRepeat.start();    return; }
    if (button === "down")  { downRepeat.start();  return; }
    if (button === "left")  { leftRepeat.start();  return; }
    if (button === "right") { rightRepeat.start(); return; }

    if (button === "options") { fs.openOptions();  return; }
    if (button === "triangle") {
      const t = fs.target;
      if (t && (t.kind === "clip" || t.kind === "postfx")) fs.openParamPanel();
      return;
    }
    if (button === "circle")  { handleCircle();  return; }
    if (button === "cross")   { handleCross();   return; }
    if (button === "square")  { handleSquare();  return; }
    if (button === "l1") {
      if (isButtonHeld("r1")) { vjs.setBurst(true); return; }
      vjs.tap(); return;
    }
    if (button === "r1") {
      if (isButtonHeld("l1")) { vjs.setBurst(true); return; }
      vjs.triggerFlash(); return;
    }
    if (button === "r2") {
      // ステージ中なら release、それ以外は何もしない
      if (vjs.stageMode) { vjs.releaseStage?.(); return; }
    }
  }, [applyTarget, upRepeat, downRepeat, leftRepeat, rightRepeat]);

  const onRelease = useCallback((button: ButtonName) => {
    if (button === "up")    upRepeat.stop();
    if (button === "down")  downRepeat.stop();
    if (button === "left")  leftRepeat.stop();
    if (button === "right") rightRepeat.stop();
    // Burst ends when either L1 or R1 is released
    if (button === "l1" || button === "r1") useVJStore.getState().setBurst(false);
  }, [upRepeat, downRepeat, leftRepeat, rightRepeat]);

  // Param panel D-pad/R3 events (dispatched as custom DOM events so
  // GamepadParamPanel can respond without prop drilling).
  const paramNavEvent  = (dir: "up"|"down") => window.dispatchEvent(new CustomEvent("gp:param-nav",  { detail: dir }));
  const paramStepEvent = (dir: "left"|"right") => window.dispatchEvent(new CustomEvent("gp:param-step", { detail: dir }));
  const paramR3Event   = () => window.dispatchEvent(new CustomEvent("gp:param-r3"));

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
  const layers       = useVJStore((s) => s.state.layers);
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

  return (
    <>
      <GamepadFocusOverlay />
      <GamepadParamPanel
        onClose={() => useGamepadFocusStore.getState().closeParamPanel()}
      />
      <GamepadOptionsModal />
      <GamepadAssetPicker />

      {/* Delete confirm */}
      {deleteTarget && (
        <div className="gp-modal-overlay open" onClick={closeDelete}>
          <div className="gp-delete-card" onClick={e => e.stopPropagation()}>
            <div className="gp-delete-icon">⚠️</div>
            <div className="gp-delete-title">削除しますか？</div>
            <div className="gp-delete-body">「{deleteClipName}」をレイヤーから削除します。</div>
            <div className="gp-delete-actions">
              <button className="gp-delete-btn" onClick={closeDelete}>
                <span className="gp-btn-badge gp-tri">△</span> キャンセル
              </button>
              <button className="gp-delete-btn danger" onClick={confirmDelete}>
                <span className="gp-btn-badge gp-cross">✕</span> 削除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
