import type { MutableRefObject } from "react";
import { useVJStore } from "../state/vjStore";
import { useGamepadFocusStore, type FocusTarget } from "./gamepadFocusStore";
import { isButtonHeld, type ButtonName } from "./gamepadManager";

// ─── Types ───────────────────────────────────────────────────────────────────

export type DpadDir = "up" | "down" | "left" | "right";

export type ActionCtx = {
  gridRef:        MutableRefObject<FocusTarget[][]>;
  rowRef:         MutableRefObject<number>;
  colRef:         MutableRefObject<number>;
  applyTarget:    () => void;
  stopAllRepeats: () => void;
  startRepeat:    (dir: DpadDir) => void;
};

export type Action = (ctx: ActionCtx) => void;

export type ContextId =
  | "global" | "paramPanel" | "layerParam"
  | "options" | "assetPicker" | "deleteConfirm";

/** Combo string. R2 is the only modifier currently. */
export type Combo = ButtonName | `r2+${ButtonName}`;

// ─── Context detection ───────────────────────────────────────────────────────

export function currentContext(): ContextId {
  const fs = useGamepadFocusStore.getState();
  if (fs.optionsOpen)               return "options";
  if (fs.assetPickerLayer !== null) return "assetPicker";
  if (fs.deleteTarget)              return "deleteConfirm";
  if (fs.layerParamOpen)            return "layerParam";
  if (fs.paramPanelOpen)            return "paramPanel";
  return "global";
}

/** Build combo key from a press event. R2 itself is treated as no-modifier. */
export function comboFor(button: ButtonName): Combo {
  if (button === "r2") return "r2";
  return (isButtonHeld("r2") ? `r2+${button}` : button) as Combo;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

const flashStatus = (msg: string, level?: "warn") =>
  window.dispatchEvent(new CustomEvent("gp:flash-status", { detail: { msg, level } }));

const paramNav    = (dir: "up"|"down") => window.dispatchEvent(new CustomEvent("gp:param-nav",    { detail: dir }));
const paramAdjust = (dir: "inc"|"dec") => window.dispatchEvent(new CustomEvent("gp:param-adjust", { detail: dir }));
const paramSet    = ()                 => window.dispatchEvent(new CustomEvent("gp:param-set"));
const paramToggle = ()                 => window.dispatchEvent(new CustomEvent("gp:param-toggle"));
const paramR3     = ()                 => window.dispatchEvent(new CustomEvent("gp:param-r3"));

function focusedLayerIdx(): number | null {
  const t = useGamepadFocusStore.getState().target;
  if (!t || (t.kind !== "clip" && t.kind !== "add")) return null;
  return t.layerIdx;
}

/** 同一ターゲットかどうかの比較 */
function sameTarget(a: FocusTarget, b: FocusTarget | null): boolean {
  if (!b || a.kind !== b.kind) return false;
  if (a.kind === "postfx" && b.kind === "postfx") return a.slotIdx === b.slotIdx;
  if (a.kind === "clip"   && b.kind === "clip")   return a.layerIdx === b.layerIdx && a.clipIdx === b.clipIdx;
  return false;
}

/**
 * パラメータ調整パネルが開ける対象（= 各レイヤーの LIVE クリップ + プラグインが入った PostFX スロット）。
 * 視覚順: PostFX 上段 → レイヤー上から順。
 */
function listParamTargets(): FocusTarget[] {
  const state = useVJStore.getState().state;
  const out: FocusTarget[] = [];
  state.postfx.forEach((slot, i) => {
    if (slot?.pluginId) out.push({ kind: "postfx", slotIdx: i });
  });
  state.layers.forEach((layer, li) => {
    if (layer.activeClipIdx >= 0 && layer.clips[layer.activeClipIdx]) {
      out.push({ kind: "clip", layerIdx: li, clipIdx: layer.activeClipIdx });
    }
  });
  return out;
}

/** R2 + ←/→ (paramPanel 中): 他の調整可能ターゲットへ循環ジャンプ。 */
function cycleParamTarget(dir: 1 | -1, { rowRef, colRef, applyTarget }: ActionCtx) {
  const targets = listParamTargets();
  if (targets.length <= 1) {
    flashStatus(targets.length === 0 ? "調整可能なターゲットがありません" : "ターゲットは 1 つだけです", "warn");
    return;
  }
  const cur = useGamepadFocusStore.getState().target;
  let curIdx = targets.findIndex(t => sameTarget(t, cur));
  if (curIdx < 0) curIdx = 0;
  const next = targets[(curIdx + dir + targets.length) % targets.length];
  if (next.kind === "postfx") {
    rowRef.current = 0;
    colRef.current = next.slotIdx;
  } else if (next.kind === "clip") {
    rowRef.current = 1 + next.layerIdx;
    colRef.current = next.clipIdx;
  }
  applyTarget();
}

/**
 * R2 + ←/→: 同一レイヤー内のアンカー (先頭 / LIVE / 末尾) を方向付き循環。
 * - 先頭   = clip 0
 * - LIVE   = activeClipIdx (>= 0 のときだけ参加)
 * - 末尾   = "+追加" ボタン（col = clips.length）
 * 重複（LIVE が先頭と一致など）は除き、現在位置から進行方向の次へ移動。
 */
function cycleLayerAnchor(dir: 1 | -1, { rowRef, colRef, applyTarget }: ActionCtx) {
  const t = useGamepadFocusStore.getState().target;
  if (!t || (t.kind !== "clip" && t.kind !== "add")) return;
  const layer = useVJStore.getState().state.layers[t.layerIdx];
  if (!layer) return;

  const set = new Set<number>();
  if (layer.clips.length > 0) set.add(0);
  if (layer.activeClipIdx >= 0) set.add(layer.activeClipIdx);
  set.add(layer.clips.length); // add ボタン
  const anchors = [...set].sort((a, b) => a - b);
  if (anchors.length <= 1) return;

  const cur = t.kind === "clip" ? t.clipIdx : layer.clips.length;
  const next = dir === 1
    ? (anchors.find(a => a > cur) ?? anchors[0])
    : ([...anchors].reverse().find(a => a < cur) ?? anchors[anchors.length - 1]);

  rowRef.current = 1 + t.layerIdx;
  colRef.current = next;
  applyTarget();
}

function jumpToLiveClip(dir: 1 | -1, { rowRef, colRef, applyTarget }: ActionCtx) {
  const state = useVJStore.getState().state;
  const live: { layerIdx: number; clipIdx: number }[] = [];
  state.layers.forEach((layer, li) => {
    if (layer.activeClipIdx >= 0) live.push({ layerIdx: li, clipIdx: layer.activeClipIdx });
  });
  if (live.length === 0) {
    flashStatus("LIVE中のアセットがありません", "warn");
    return;
  }
  const t = useGamepadFocusStore.getState().target;
  const curLayerIdx = t && (t.kind === "clip" || t.kind === "add") ? t.layerIdx : -1;
  let curIdx = live.findIndex(x => x.layerIdx === curLayerIdx);
  if (curIdx < 0) curIdx = 0;
  const next = live[(curIdx + dir + live.length) % live.length];
  rowRef.current = 1 + next.layerIdx;
  colRef.current = next.clipIdx;
  applyTarget();
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export const ACTIONS = {
  // Navigation (global d-pad → repeating)
  "nav.up":              ({ startRepeat }: ActionCtx) => startRepeat("up"),
  "nav.down":            ({ startRepeat }: ActionCtx) => startRepeat("down"),
  "nav.left":            ({ startRepeat }: ActionCtx) => startRepeat("left"),
  "nav.right":           ({ startRepeat }: ActionCtx) => startRepeat("right"),

  // R2 + d-pad: live-clip jumps
  "nav.liveJumpPrev":    (ctx: ActionCtx) => jumpToLiveClip(-1, ctx),
  "nav.liveJumpNext":    (ctx: ActionCtx) => jumpToLiveClip(1, ctx),
  // R2 + ←/→: 同一レイヤー内で 先頭 / LIVE / 末尾 を循環
  "nav.cycleAnchorPrev": (ctx: ActionCtx) => cycleLayerAnchor(-1, ctx),
  "nav.cycleAnchorNext": (ctx: ActionCtx) => cycleLayerAnchor(1, ctx),
  // paramPanel 中の R2 + ←/→: 他のアクティブターゲットへ循環
  "nav.paramTargetPrev": (ctx: ActionCtx) => cycleParamTarget(-1, ctx),
  "nav.paramTargetNext": (ctx: ActionCtx) => cycleParamTarget(1, ctx),

  // Clip / postfx slot
  "clip.activate": () => {
    const t = useGamepadFocusStore.getState().target;
    const vjs = useVJStore.getState();
    if (!t) return;
    if (t.kind === "add")    { useGamepadFocusStore.getState().openAssetPicker(t.layerIdx); return; }
    if (t.kind === "clip")   { vjs.triggerClip(t.layerIdx, t.clipIdx); return; }
    if (t.kind === "postfx") { vjs.togglePostFXSlot(t.slotIdx); return; }
  },
  "clip.deleteAsk": () => {
    const fs = useGamepadFocusStore.getState();
    const t = fs.target;
    if (!t || t.kind !== "clip") return;
    const layer = useVJStore.getState().state.layers[t.layerIdx];
    if (layer && layer.activeClipIdx === t.clipIdx) {
      flashStatus("LIVE中のアセットは削除できません", "warn");
      return;
    }
    fs.openDeleteConfirm(t);
  },

  // Layer mute / solo
  "layer.toggleMute": () => {
    const li = focusedLayerIdx();
    if (li === null) return;
    const vjs = useVJStore.getState();
    const layer = vjs.state.layers[li];
    if (!layer) return;
    vjs.setLayerMute(li, !layer.mute);
    flashStatus(`L${li + 1}: mute ${!layer.mute ? "ON" : "OFF"}`);
  },
  "layer.toggleSolo": () => {
    const li = focusedLayerIdx();
    if (li === null) return;
    const vjs = useVJStore.getState();
    const layer = vjs.state.layers[li];
    if (!layer) return;
    vjs.setLayerSolo(li, !layer.solo);
    flashStatus(`L${li + 1}: solo ${!layer.solo ? "ON" : "OFF"}`);
  },

  // Panels open
  "panel.openParam": ({ stopAllRepeats }: ActionCtx) => {
    const t = useGamepadFocusStore.getState().target;
    if (!t || (t.kind !== "clip" && t.kind !== "postfx")) return;
    stopAllRepeats();
    useGamepadFocusStore.getState().openParamPanel();
  },
  "panel.openLayerParam": ({ stopAllRepeats }: ActionCtx) => {
    const t = useGamepadFocusStore.getState().target;
    if (!t || (t.kind !== "clip" && t.kind !== "add")) return;
    stopAllRepeats();
    useGamepadFocusStore.getState().openLayerParam(t.layerIdx);
  },
  "panel.openOptions": ({ stopAllRepeats }: ActionCtx) => {
    stopAllRepeats();
    useGamepadFocusStore.getState().openOptions();
  },

  // Panels close
  "panel.closeOptions":     () => useGamepadFocusStore.getState().closeOptions(),
  "panel.closeAssetPicker": () => useGamepadFocusStore.getState().closeAssetPicker(),
  "panel.closeParam":       () => useGamepadFocusStore.getState().closeParamPanel(),
  "panel.closeLayerParam":  () => useGamepadFocusStore.getState().closeLayerParam(),

  // Param-panel events (bridged via window CustomEvent → GamepadParamPanel)
  "param.navUp":   () => paramNav("up"),
  "param.navDown": () => paramNav("down"),
  "param.inc":     () => paramAdjust("inc"),
  "param.dec":     () => paramAdjust("dec"),
  "param.set":     () => paramSet(),
  "param.toggle":  () => paramToggle(),
  "param.r3":      () => paramR3(),

  // Delete confirm modal
  "delete.confirm": ({ gridRef, colRef, applyTarget }: ActionCtx) => {
    const fs = useGamepadFocusStore.getState();
    const t = fs.deleteTarget;
    if (t && t.kind === "clip") {
      useVJStore.getState().removeClip(t.layerIdx, t.clipIdx);
      const newMax = (gridRef.current[t.layerIdx]?.length ?? 1) - 1;
      colRef.current = Math.min(colRef.current, newMax);
      applyTarget();
    }
    fs.closeDeleteConfirm();
  },
  "delete.cancel": () => useGamepadFocusStore.getState().closeDeleteConfirm(),

  // Stage / BPM / FX
  "stage.toggle": () => {
    const vjs = useVJStore.getState();
    if (vjs.stageMode) vjs.cancelStage();
    else vjs.enterStage();
  },
  "stage.releaseIfStaged": () => {
    const vjs = useVJStore.getState();
    if (vjs.stageMode) vjs.releaseStage();
  },
  "bpm.tap": () => {
    const vjs = useVJStore.getState();
    if (isButtonHeld("r1")) { vjs.setBurst(true); return; }
    vjs.tap();
  },
  "fx.flash": () => {
    const vjs = useVJStore.getState();
    if (isButtonHeld("l1")) { vjs.setBurst(true); return; }
    vjs.triggerFlash();
  },
} satisfies Record<string, Action>;

export type ActionId = keyof typeof ACTIONS;

// ─── Bindings table ──────────────────────────────────────────────────────────
//
// 文脈 × コンボ → アクション ID。リマップしたいときはここを書き換える。
// 同じボタンに複数のコンテキストで違う意味を割り当てられる。

export const BINDINGS: Record<ContextId, Partial<Record<Combo, ActionId>>> = {
  global: {
    "up":          "nav.up",
    "down":        "nav.down",
    "left":        "nav.left",
    "right":       "nav.right",
    "r2+up":       "nav.liveJumpPrev",
    "r2+down":     "nav.liveJumpNext",
    "r2+left":     "nav.cycleAnchorPrev",
    "r2+right":    "nav.cycleAnchorNext",
    "circle":      "clip.activate",
    "cross":       "clip.deleteAsk",
    "triangle":    "panel.openParam",
    "r2+triangle": "panel.openLayerParam",
    "options":     "panel.openOptions",
    "r2+circle":   "layer.toggleSolo",
    "r2+cross":    "layer.toggleMute",
    "square":      "stage.toggle",
    "l1":          "bpm.tap",
    "r1":          "fx.flash",
    "r2":          "stage.releaseIfStaged",
  },
  paramPanel: {
    "triangle":    "panel.closeParam",
    "options":     "param.set",
    "left":        "param.navUp",
    "right":       "param.navDown",
    "up":          "param.inc",
    "down":        "param.dec",
    "r3":          "param.r3",
    "circle":      "param.toggle",
    "r2+left":     "nav.paramTargetPrev",
    "r2+right":    "nav.paramTargetNext",
  },
  layerParam: {
    "triangle":    "panel.closeLayerParam",
    "left":        "param.navUp",
    "right":       "param.navDown",
    "up":          "param.inc",
    "down":        "param.dec",
    "r3":          "param.r3",
    "circle":      "param.toggle",
  },
  options: {
    "options":     "panel.closeOptions",
    "cross":       "panel.closeOptions",
    "triangle":    "panel.closeOptions",
  },
  assetPicker: {
    "triangle":    "panel.closeAssetPicker",
    "cross":       "panel.closeAssetPicker",
    // ○ 確定は GamepadAssetPicker 内部でハンドル
  },
  deleteConfirm: {
    "triangle":    "delete.cancel",
    "cross":       "delete.cancel",
    "circle":      "delete.confirm",
  },
};
