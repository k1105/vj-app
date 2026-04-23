/**
 * VJApi — window.vj の型定義。
 *
 * preload (src/preload/index.ts) が contextBridge でこの形の API を公開し、
 * renderer / output は `window.vj` 経由でこれを使う。
 * preload/ は web tsconfig の include 外なので、型を shared に置くことで
 * controller / output 側からも参照できるようにしている。
 */
import type {
  DownloadProgress,
  DownloadResult,
  PluginKind,
  PluginMeta,
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
}

declare global {
  interface Window {
    vj: VJApi;
  }
}

export {};
