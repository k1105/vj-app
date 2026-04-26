import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
  IPC,
  type ContextMenuItem,
  type DownloadProgress,
  type DownloadResult,
  type ParamValue,
  type PluginKind,
  type PluginMeta,
  type SplatProgress,
  type SplatResult,
  type VJState,
} from "../shared/types";
import type { VJApi } from "../shared/vjApi";

const api: VJApi = {
  listPlugins: (): Promise<PluginMeta[]> => ipcRenderer.invoke(IPC.ListPlugins),

  readPluginSource: (kind: PluginKind, id: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.ReadPluginSource, { kind, id }),

  downloadVideo: (url: string): Promise<DownloadResult> =>
    ipcRenderer.invoke(IPC.DownloadVideo, url),

  importVideo: (srcPath: string): Promise<DownloadResult> =>
    ipcRenderer.invoke(IPC.ImportVideo, srcPath),

  pickVideoFile: (): Promise<string[]> => ipcRenderer.invoke(IPC.PickVideoFile),

  getFilePath: (file: File): string => webUtils.getPathForFile(file),

  onDownloadProgress: (cb: (p: DownloadProgress) => void) => {
    const listener = (_: unknown, p: DownloadProgress) => cb(p);
    ipcRenderer.on(IPC.DownloadProgress, listener);
    return () => ipcRenderer.removeListener(IPC.DownloadProgress, listener);
  },

  onPluginsChanged: (cb: (plugins: PluginMeta[]) => void) => {
    const listener = (_: unknown, plugins: PluginMeta[]) => cb(plugins);
    ipcRenderer.on(IPC.PluginsChanged, listener);
    return () => ipcRenderer.removeListener(IPC.PluginsChanged, listener);
  },

  sendStateUpdate: (state: VJState) => {
    ipcRenderer.send(IPC.StateUpdate, state);
  },

  onStateBroadcast: (cb: (state: VJState) => void) => {
    const listener = (_: unknown, state: VJState) => cb(state);
    ipcRenderer.on(IPC.StateBroadcast, listener);
    return () => ipcRenderer.removeListener(IPC.StateBroadcast, listener);
  },

  requestStateRebroadcast: () => ipcRenderer.send(IPC.RequestStateRebroadcast),

  onRequestStateRebroadcast: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on(IPC.RequestStateRebroadcast, listener);
    return () => ipcRenderer.removeListener(IPC.RequestStateRebroadcast, listener);
  },

  onPreviewLive: (cb: (dataUrl: string) => void) => {
    const listener = (_: unknown, dataUrl: string) => cb(dataUrl);
    ipcRenderer.on(IPC.PreviewLive, listener);
    return () => ipcRenderer.removeListener(IPC.PreviewLive, listener);
  },

  getSetting: (key: string) => ipcRenderer.invoke(IPC.SettingsGet, key),
  setSetting: (key: string, value: unknown) =>
    ipcRenderer.invoke(IPC.SettingsSet, key, value),

  toggleOutputFullscreen: () => ipcRenderer.send(IPC.OutputToggleFullscreen),

  openManager: () => ipcRenderer.send(IPC.OpenManager),

  deletePlugin: (kind: PluginKind, id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.DeletePlugin, { kind, id }),

  renamePlugin: (kind: PluginKind, id: string, name: string): Promise<void> =>
    ipcRenderer.invoke(IPC.RenamePlugin, { kind, id, name }),

  revealPlugin: (kind: PluginKind, id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.RevealPlugin, { kind, id }),

  createTextAsset: (name: string, texts: string[]): Promise<string> =>
    ipcRenderer.invoke(IPC.CreateTextAsset, { name, texts }),

  migrateTextAssets: (): Promise<number> =>
    ipcRenderer.invoke(IPC.MigrateTextAssets),

  setPluginHidden: (id: string, hidden: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.SetPluginHidden, { id, hidden }),

  bakePluginThumbnail: (kind: PluginKind, id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.SavePluginThumbnail, { kind, id }),

  setPluginDefaults: (
    kind: PluginKind,
    id: string,
    values: Record<string, ParamValue>,
  ): Promise<void> => ipcRenderer.invoke(IPC.SetPluginDefaults, { kind, id, values }),

  setPluginCategory: (
    kind: PluginKind,
    id: string,
    category: string,
  ): Promise<void> => ipcRenderer.invoke(IPC.SetPluginCategory, { kind, id, category }),

  showContextMenu: (items: ContextMenuItem[]): Promise<string | null> =>
    ipcRenderer.invoke(IPC.ShowContextMenu, items),

  pickImageFile: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.PickImageFile),

  generateSplat: (imagePath: string, name: string): Promise<SplatResult> =>
    ipcRenderer.invoke(IPC.GenerateSplat, { imagePath, name }),

  onSplatProgress: (cb: (p: SplatProgress) => void) => {
    const listener = (_: unknown, p: SplatProgress) => cb(p);
    ipcRenderer.on(IPC.SplatProgress, listener);
    return () => ipcRenderer.removeListener(IPC.SplatProgress, listener);
  },
};

contextBridge.exposeInMainWorld("vj", api);

export type { VJApi };
