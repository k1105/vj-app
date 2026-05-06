import { useEffect, useRef, useCallback, useMemo } from "react";
import { useVJStore } from "../state/vjStore";
import { useGamepadFocusStore, type FocusTarget } from "./gamepadFocusStore";
import {
  addGamepadListener,
  isGamepadConnected,
  readRStickY,
  type ButtonName,
} from "./gamepadManager";
import { gpidFor } from "./GamepadFocusOverlay";
import {
  ACTIONS,
  BINDINGS,
  comboFor,
  currentContext,
  type ActionCtx,
  type DpadDir,
} from "./gamepadBindings";

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

function useRepeat(onFire: () => void) {
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
  const upRepeat    = useRepeat(moveUp);
  const downRepeat  = useRepeat(moveDown);
  const leftRepeat  = useRepeat(moveLeft);
  const rightRepeat = useRepeat(moveRight);

  const stopAllRepeats = useCallback(() => {
    upRepeat.stop(); downRepeat.stop(); leftRepeat.stop(); rightRepeat.stop();
  }, [upRepeat, downRepeat, leftRepeat, rightRepeat]);

  const startRepeat = useCallback((d: DpadDir) => {
    if (d === "up")    return upRepeat.start();
    if (d === "down")  return downRepeat.start();
    if (d === "left")  return leftRepeat.start();
    if (d === "right") return rightRepeat.start();
  }, [upRepeat, downRepeat, leftRepeat, rightRepeat]);

  // ─── Dispatcher ───────────────────────────────────────────────────────────

  const onPress = useCallback((button: ButtonName) => {
    const ctx: ActionCtx = {
      gridRef, rowRef, colRef,
      applyTarget, stopAllRepeats, startRepeat,
    };
    const cid = currentContext();
    const combo = comboFor(button);
    const id = BINDINGS[cid]?.[combo];
    if (id) ACTIONS[id](ctx);
  }, [applyTarget, stopAllRepeats, startRepeat]);

  const onRelease = useCallback((button: ButtonName) => {
    if (button === "up")    upRepeat.stop();
    if (button === "down")  downRepeat.stop();
    if (button === "left")  leftRepeat.stop();
    if (button === "right") rightRepeat.stop();
    if (button === "l1" || button === "r1") useVJStore.getState().setBurst(false);
  }, [upRepeat, downRepeat, leftRepeat, rightRepeat]);

  // Wire up gamepad listener
  useEffect(() => {
    return addGamepadListener((ev) => {
      if (ev.type === "press")   onPress(ev.button);
      if (ev.type === "release") onRelease(ev.button);
    });
  }, [onPress, onRelease]);

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
