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
  /** Controller subscribes to LIVE preview JPEG frames sampled from Output. */
  onPreviewLive(cb: (dataUrl: string) => void): () => void;
  getSetting(key: string): Promise<unknown>;
  setSetting(key: string, value: unknown): Promise<void>;
  toggleOutputFullscreen(): void;
  /** Open (or focus) the Library / asset manager window. */
  openManager(): void;
}

declare global {
  interface Window {
    vj: VJApi;
  }
}

export {};
