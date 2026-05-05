import { create } from "zustand";

export type FocusTarget =
  | { kind: "clip";   layerIdx: number; clipIdx: number }
  | { kind: "add";    layerIdx: number }
  | { kind: "postfx"; slotIdx: number };

interface GamepadFocusState {
  /** Gamepad detected and gamepad-mode is active */
  active: boolean;
  target: FocusTarget | null;
  paramPanelOpen: boolean;
  /** Layer-level param panel (opacity/blend/mute/solo) */
  layerParamOpen: boolean;
  layerParamIdx: number | null;
  optionsOpen: boolean;
  /** Non-null when waiting for delete confirmation */
  deleteTarget: FocusTarget | null;
  /** Non-null when the asset picker is open for a layer */
  assetPickerLayer: number | null;

  setActive:          (v: boolean) => void;
  setTarget:          (t: FocusTarget | null) => void;
  openParamPanel:     () => void;
  closeParamPanel:    () => void;
  openLayerParam:     (layerIdx: number) => void;
  closeLayerParam:    () => void;
  openOptions:        () => void;
  closeOptions:       () => void;
  openDeleteConfirm:  (t: FocusTarget) => void;
  closeDeleteConfirm: () => void;
  openAssetPicker:    (layerIdx: number) => void;
  closeAssetPicker:   () => void;
}

export const useGamepadFocusStore = create<GamepadFocusState>((set) => ({
  active: false,
  target: null,
  paramPanelOpen: false,
  layerParamOpen: false,
  layerParamIdx: null,
  optionsOpen: false,
  deleteTarget: null,
  assetPickerLayer: null,

  setActive:          (v) => set({ active: v }),
  setTarget:          (t) => set({ target: t }),
  openParamPanel:     () => set({ paramPanelOpen: true, layerParamOpen: false }),
  closeParamPanel:    () => set({ paramPanelOpen: false }),
  openLayerParam:     (idx) => set({ layerParamOpen: true, layerParamIdx: idx, paramPanelOpen: false }),
  closeLayerParam:    () => set({ layerParamOpen: false, layerParamIdx: null }),
  openOptions:        () => set({ optionsOpen: true }),
  closeOptions:       () => set({ optionsOpen: false }),
  openDeleteConfirm:  (t) => set({ deleteTarget: t }),
  closeDeleteConfirm: () => set({ deleteTarget: null }),
  openAssetPicker:    (l) => set({ assetPickerLayer: l }),
  closeAssetPicker:   () => set({ assetPickerLayer: null }),
}));
