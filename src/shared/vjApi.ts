/**
 * VJApi — window.vj の型定義。
 *
 * preload (src/preload/index.ts) が contextBridge でこの形の API を公開し、
 * renderer / output は `window.vj` 経由でこれを使う。
 * preload/ は web tsconfig の include 外なので、型を shared に置くことで
 * controller / output 側からも参照できるようにしている。
 */
import type {
  ContextMenuItem,
  DownloadProgress,
  DownloadResult,
  ParamValue,
  PluginKind,
  PluginMeta,
  SplatProgress,
  SplatResult,
  VJState,
} from "./types";

export interface VJApi {
  listPlugins(): Promise<PluginMeta[]>;
  readPluginSource(kind: PluginKind, id: string): Promise<string | null>;
  downloadVideo(url: string): Promise<DownloadResult>;
  /** Copy a local mp4 into materials/videos and register its plugin manifest. */
  importVideo(srcPath: string): Promise<DownloadResult>;
  /** Open a native file picker; returns selected absolute paths (empty on cancel). */
  pickVideoFile(): Promise<string[]>;
  /** Resolve an absolute filesystem path from a drag-dropped File object. */
  getFilePath(file: File): string;
  onDownloadProgress(cb: (p: DownloadProgress) => void): () => void;
  onPluginsChanged(cb: (plugins: PluginMeta[]) => void): () => void;
  sendStateUpdate(state: VJState): void;
  onStateBroadcast(cb: (state: VJState) => void): () => void;
  /** Ask the Controller to rebroadcast its current state immediately. */
  requestStateRebroadcast(): void;
  /** Controller listens for "please rebroadcast" asks from other windows. */
  onRequestStateRebroadcast(cb: () => void): () => void;
  /** Controller subscribes to LIVE preview JPEG frames sampled from Output. */
  onPreviewLive(cb: (dataUrl: string) => void): () => void;
  getSetting(key: string): Promise<unknown>;
  setSetting(key: string, value: unknown): Promise<void>;
  toggleOutputFullscreen(): void;
  /** Open (or focus) the Library / asset manager window. */
  openManager(): void;
  /** Delete a plugin — its directory and (for video plugins) its mp4. */
  deletePlugin(kind: PluginKind, id: string): Promise<void>;
  /** Update the plugin's display name (manifest.name). */
  renamePlugin(kind: PluginKind, id: string, name: string): Promise<void>;
  /** Open Finder with the plugin directory selected. */
  revealPlugin(kind: PluginKind, id: string): Promise<void>;
  /** Create a new text asset from the shared template. Returns the new plugin id. */
  createTextAsset(name: string, texts: string[]): Promise<string>;
  /** Rewrite every text asset's manifest against the current template schema. Returns count migrated. */
  migrateTextAssets(): Promise<number>;
  /**
   * Soft-hide / show a plugin in the Controller's Assets grid. Non-destructive
   * — only stores the id in settings.hiddenPluginIds and re-broadcasts.
   */
  setPluginHidden(id: string, hidden: boolean): Promise<void>;
  /**
   * Bake a thumbnail by capturing the Output window's current frame.
   * The user is expected to arrange the desired asset on Output first.
   */
  bakePluginThumbnail(kind: PluginKind, id: string): Promise<void>;
  /**
   * Persist the supplied param values as the plugin's manifest defaults so
   * future drops onto a layer use them as the initial preset.
   */
  setPluginDefaults(
    kind: PluginKind,
    id: string,
    values: Record<string, ParamValue>,
  ): Promise<void>;
  /**
   * Set or clear (empty string) the plugin's `category` for grouping in
   * the Assets panel. When unset, the loader falls back to outputType.
   */
  setPluginCategory(kind: PluginKind, id: string, category: string): Promise<void>;
  /**
   * Show a native context menu at the cursor and resolve to the selected
   * item id (or null if dismissed). The id is opaque — the caller decides.
   */
  showContextMenu(items: ContextMenuItem[]): Promise<string | null>;
  /** Open a native image picker; resolves to the chosen path or null. */
  pickImageFile(): Promise<string | null>;
  /**
   * Run the configured `splatGeneratorCommand` against `imagePath`. Writes
   * the resulting .splat plus a manifest into a new plugins/scene-* dir
   * and broadcasts so the asset appears in the Assets panel.
   */
  generateSplat(imagePath: string, name: string): Promise<SplatResult>;
  /** Subscribe to per-line progress emitted while a splat is generating. */
  onSplatProgress(cb: (p: SplatProgress) => void): () => void;
}

declare global {
  interface Window {
    vj: VJApi;
  }
}

export {};
