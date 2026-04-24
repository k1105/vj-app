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
} as const;

export type PluginKind = "material" | "postfx" | "transition";

/** A parameter value may be a number, boolean, single string (enum), or string array. */
export type ParamValue = number | boolean | string | string[];

export interface ParamDef {
  key: string;
  type: "float" | "int" | "bool" | "enum" | "strings";
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

export interface PluginMeta {
  id: string; // directory name
  kind: PluginKind;
  name: string;
  author?: string;
  version?: string;
  outputType?: "three" | "canvas" | "video";
  params: ParamDef[];
  inputs?: string[]; // for scene-composer style plugins
  entry?: string; // implementation entry file
  manifestPath: string; // absolute path
  // For outputType === "video": custom-scheme URL (vj-asset://local/...)
  // that the Output window can load directly. Resolved from manifest.videoFile.
  videoUrl?: string;
  // Optional preview image URL (vj-asset://local/...). Resolved from
  // manifest.thumbnail when the file exists in the plugin directory.
  thumbnailUrl?: string;
  /** Clip length in seconds. For video plugins, read from manifest.duration. */
  duration?: number;
  /** Size on disk. For video plugins, size of the videoFile; undefined otherwise. */
  sizeBytes?: number;
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

export type TransitionType = "cut" | "crossfade" | "dissolve" | "wipe";

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
  postfx: Array<{ pluginId: string; enabled: boolean; params: Record<string, ParamValue> }>;
  /** Epoch ms of the last flash trigger. null when never triggered. */
  flashAt: number | null;
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
