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
  optionsOpen: boolean;
  /** Non-null when waiting for delete confirmation */
  deleteTarget: FocusTarget | null;
  /** Non-null when the asset picker is open for a layer */
  assetPickerLayer: number | null;

  setActive:          (v: boolean) => void;
  setTarget:          (t: FocusTarget | null) => void;
  openParamPanel:     () => void;
  closeParamPanel:    () => void;
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
  optionsOpen: false,
  deleteTarget: null,
  assetPickerLayer: null,

  setActive:          (v) => set({ active: v }),
  setTarget:          (t) => set({ target: t }),
  openParamPanel:     () => set({ paramPanelOpen: true }),
  closeParamPanel:    () => set({ paramPanelOpen: false }),
  openOptions:        () => set({ optionsOpen: true }),
  closeOptions:       () => set({ optionsOpen: false }),
  openDeleteConfirm:  (t) => set({ deleteTarget: t }),
  closeDeleteConfirm: () => set({ deleteTarget: null }),
  openAssetPicker:    (l) => set({ assetPickerLayer: l }),
  closeAssetPicker:   () => set({ assetPickerLayer: null }),
}));
