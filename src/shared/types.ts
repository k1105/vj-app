/* Shared types between main / preload / renderer / output */

export const IPC = {
  DownloadVideo: "vj:download-video",
  DownloadProgress: "vj:download-progress",
  ImportVideo: "vj:import-video",
  PickVideoFile: "vj:pick-video-file",
  OpenManager: "vj:open-manager",
  DeletePlugin: "vj:delete-plugin",
  RenamePlugin: "vj:rename-plugin",
  RevealPlugin: "vj:reveal-plugin",
  ListPlugins: "vj:list-plugins",
  PluginsChanged: "vj:plugins-changed",
  StateUpdate: "vj:state-update",
  StateBroadcast: "vj:state-broadcast",
  RequestStateRebroadcast: "vj:request-state-rebroadcast",
  SettingsGet: "vj:settings-get",
  SettingsSet: "vj:settings-set",
  OutputToggleFullscreen: "vj:output-toggle-fullscreen",
  ReadPluginSource: "vj:read-plugin-source",
  PreviewLive: "vj:preview-live",
  CreateTextAsset: "vj:create-text-asset",
  MigrateTextAssets: "vj:migrate-text-assets",
  SetPluginHidden: "vj:set-plugin-hidden",
  SavePluginThumbnail: "vj:save-plugin-thumbnail",
  SetPluginDefaults: "vj:set-plugin-defaults",
  SetParamPrimary: "vj:set-param-primary",
  SetPluginCategory: "vj:set-plugin-category",
  ShowContextMenu: "vj:show-context-menu",
  GenerateSplat: "vj:generate-splat",
  PerfStats: "vj:perf-stats",
  SplatProgress: "vj:splat-progress",
  PickImageFile: "vj:pick-image-file",
  PickImagesForAsset: "vj:pick-images-for-asset",
  CreateImageAsset: "vj:create-image-asset",
  CreateSequenceAsset: "vj:create-sequence-asset",
} as const;

export interface ContextMenuItem {
  id: string;
  label: string;
  danger?: boolean;
  enabled?: boolean;
}

export type PluginKind = "material" | "postfx" | "transition";

/** A parameter value may be a number, boolean, single string (enum), or string array. */
export type ParamValue = number | boolean | string | string[] | null;

export interface ParamDef {
  key: string;
  type: "float" | "int" | "bool" | "enum" | "strings" | "camera" | "color" | "trigger";
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  /**
   * When any param of a plugin sets `primary: true`, only those params
   * are shown by default in the controller; the rest are hidden behind
   * a per-section "MORE" expander. If no param is marked primary, all
   * params remain visible (backward compatible).
   */
  primary?: boolean;
  /**
   * Conditionally show this param only when another param equals a specific
   * value. e.g. `{ "key": "mode", "value": "orbit" }` hides the param
   * unless the "mode" param is currently "orbit".
   */
  showWhen?: { key: string; value: ParamValue };
}

export interface PluginMeta {
  id: string; // directory name
  kind: PluginKind;
  name: string;
  author?: string;
  version?: string;
  outputType?: "three" | "canvas" | "video" | "splat" | "sequence";
  params: ParamDef[];
  inputs?: string[]; // for scene-composer style plugins
  entry?: string; // implementation entry file
  manifestPath: string; // absolute path
  // For outputType === "video": custom-scheme URL (vj-asset://local/...)
  // that the Output window can load directly. Resolved from manifest.videoFile.
  videoUrl?: string;
  /**
   * For outputType === "splat": vj-asset:// URL of a Gaussian Splatting
   * file (.splat / .ply / .ksplat). Resolved from manifest.splatFile.
   */
  splatUrl?: string;
  // Optional preview image URL (vj-asset://local/...). Resolved from
  // manifest.thumbnail when the file exists in the plugin directory.
  thumbnailUrl?: string;
  /**
   * For outputType === "sequence": resolved vj-asset:// URLs for each video
   * in the playlist, in playback order.
   */
  sequenceUrls?: string[];
  /** Clip length in seconds. For video plugins, read from manifest.duration. */
  duration?: number;
  /** Size on disk. For video plugins, size of the videoFile; undefined otherwise. */
  sizeBytes?: number;
  /**
   * Soft-hidden from the Controller's Assets grid. Stamped from
   * settings.hiddenPluginIds at scan time. Non-destructive — the plugin
   * directory and manifest are untouched.
   */
  hidden?: boolean;
  /**
   * User-facing grouping bucket in the Assets panel. Read from
   * manifest.category; falls back to `outputType` when unset (so unmigrated
   * plugins still group sensibly under "canvas" / "video" / "three").
   */
  category?: string;
}

/**
 * A clip = (plugin + its own param preset), arranged in a layer's bin.
 * Dropping a material on a layer appends a clip; triggering (clicking) a
 * clip makes it the layer's active output. Only the active clip of each
 * layer is mounted in PluginHost.
 */
export interface LayerClip {
  pluginId: string;
  params: Record<string, ParamValue>;
}

export interface LayerState {
  id: number;
  clips: LayerClip[];
  /** The clip currently visible in the LIVE composition. -1 when none. */
  activeClipIdx: number;
  /** The clip queued to become active after the next GO. -1 when none. */
  nextClipIdx: number;
  opacity: number; // 0-1
  blend: "normal" | "add" | "multiply" | "screen";
  solo: boolean;
  mute: boolean;
}

export interface AudioState {
  volume: number;
  bass: number;
  mid: number;
  high: number;
}

export type TransitionType =
  | "cut"
  | "crossfade"
  | "dissolve"
  | "wipe"
  | "blackout"
  | "whiteout";

export interface TransitionState {
  type: TransitionType;
  /** Epoch ms when the current transition started. null when idle. */
  startedAt: number | null;
  /** Duration of the transition in ms. */
  duration: number;
  /** Per-layer activeClipIdx at the moment GO was pressed (the "from" side). */
  fromActive: number[];
  /** Per-layer target activeClipIdx (the "to" side). */
  toActive: number[];
}

export interface PostFXSlot {
  /** null = empty slot (skipped by Composer). */
  pluginId: string | null;
  enabled: boolean;
  params: Record<string, ParamValue>;
}

export const POSTFX_SLOT_COUNT = 8;

export interface VJState {
  bpm: number;
  /**
   * Epoch ms timestamp at which beat 0 was anchored. Output/Composer computes
   * the current beat/bar phase live from (Date.now() - beatAnchor) * bpm.
   * Updated each TAP so the user can nudge the phase by re-tapping.
   */
  beatAnchor: number;
  /** Legacy: cached beat phase (0-1). Output computes its own per-frame. */
  beat: number;
  /** Legacy: cached bar phase (0-1). */
  bar: number;
  audio: AudioState;
  layers: LayerState[];
  selectedLayer: number;
  transition: TransitionState;
  /**
   * 8 fixed PostFX slots. Each slot may hold a plugin (or be empty), and the
   * slot order defines the chain order. Slot positions are stable so MIDI
   * mappings (per slot) stay valid even if the user swaps the assigned
   * plugin in that slot.
   */
  postfx: PostFXSlot[];
  /**
   * PostFX application boundary. PostFX runs on `layers[postfxBoundary..N-1]`;
   * layers above the boundary composite on top of the postfx'd result without
   * being processed. 0 = everything (default); layers.length = nothing.
   */
  postfxBoundary: number;
  /** Epoch ms of the last flash trigger. null when never triggered. */
  flashAt: number | null;
  /**
   * Epoch ms when BURST was activated. Stays non-null while held; reset
   * to null on release. Composer drives a continuous strobe while
   * non-null (more aggressive than the one-shot flash decay).
   */
  burstAt: number | null;
}

export interface DownloadResult {
  filePath: string;
  title: string;
}

export interface DownloadProgress {
  percent: number;
  stage: "downloading" | "merging" | "done" | "error";
  message?: string;
}

/** Performance snapshot collected once per second from the Output window. */
export interface PerfStats {
  fps: number;
  heapUsedMB: number;
  heapLimitMB: number;
  textures: number;
  geometries: number;
  mountedPlugins: number;
}

export interface SplatProgress {
  percent: number;
  stage: "starting" | "running" | "done" | "error";
  message?: string;
}

export interface SplatResult {
  pluginId: string;
}

/**
 * A deck is a named snapshot of the layer bin layout and PostFX chain.
 * Applying a deck overwrites layers, postfx, and postfxBoundary in one shot.
 */
export interface Deck {
  id: string;
  title: string;
  layers: LayerState[];
  postfx: PostFXSlot[];
  postfxBoundary: number;
  createdAt: number;
}
