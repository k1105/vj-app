import { BrowserWindow, dialog, ipcMain } from "electron";
import { IPC, type PluginKind, type VJState } from "../shared/types";
import { downloadVideo } from "./videoDownloader";
import { importLocalVideo } from "./videoImporter";
import { listPlugins, readPluginSource } from "./pluginLoader";
import { deletePlugin, renamePlugin, revealPlugin } from "./pluginCrud";
import { getSetting, setSetting } from "./store";

interface Ctx {
  getController: () => BrowserWindow | null;
  getOutput: () => BrowserWindow | null;
  getManager: () => BrowserWindow | null;
  openManager: () => void;
}

export function registerIpcHandlers(ctx: Ctx): void {
  ipcMain.handle(IPC.ListPlugins, async () => {
    return listPlugins();
  });

  ipcMain.handle(
    IPC.ReadPluginSource,
    async (_event, args: { kind: PluginKind; id: string }) => {
      return readPluginSource(args.kind, args.id);
    },
  );

  ipcMain.handle(IPC.DownloadVideo, async (event, url: string) => {
    return downloadVideo(url, (progress) => {
      event.sender.send(IPC.DownloadProgress, progress);
    });
  });

  ipcMain.handle(IPC.ImportVideo, async (event, srcPath: string) => {
    return importLocalVideo(srcPath, (progress) => {
      event.sender.send(IPC.DownloadProgress, progress);
    });
  });

  ipcMain.handle(IPC.PickVideoFile, async () => {
    const result = await dialog.showOpenDialog({
      title: "Import video",
      filters: [{ name: "Video (mp4)", extensions: ["mp4"] }],
      properties: ["openFile", "multiSelections"],
    });
    if (result.canceled) return [];
    return result.filePaths;
  });

  ipcMain.on(IPC.OpenManager, () => {
    ctx.openManager();
  });

  ipcMain.handle(
    IPC.DeletePlugin,
    async (_event, args: { kind: PluginKind; id: string }) => {
      await deletePlugin(args.kind, args.id);
    },
  );

  ipcMain.handle(
    IPC.RenamePlugin,
    async (_event, args: { kind: PluginKind; id: string; name: string }) => {
      await renamePlugin(args.kind, args.id, args.name);
    },
  );

  ipcMain.handle(
    IPC.RevealPlugin,
    async (_event, args: { kind: PluginKind; id: string }) => {
      revealPlugin(args.kind, args.id);
    },
  );

  // Controller → Main → Output broadcast. Also forward to the Manager
  // window so the Library tab can mark "in-use" plugins.
  ipcMain.on(IPC.StateUpdate, (_event, state: VJState) => {
    ctx.getOutput()?.webContents.send(IPC.StateBroadcast, state);
    const manager = ctx.getManager();
    if (manager && !manager.isDestroyed()) {
      manager.webContents.send(IPC.StateBroadcast, state);
    }
  });

  // Manager (or anyone else) → Controller: please send your current state
  // now. Used when a window opens mid-session and needs to catch up.
  ipcMain.on(IPC.RequestStateRebroadcast, () => {
    ctx.getController()?.webContents.send(IPC.RequestStateRebroadcast);
  });

  ipcMain.handle(IPC.SettingsGet, (_event, key: string) => getSetting(key));
  ipcMain.handle(IPC.SettingsSet, (_event, key: string, value: unknown) => {
    setSetting(key, value);
  });

  ipcMain.on(IPC.OutputToggleFullscreen, () => {
    const output = ctx.getOutput();
    if (!output) return;
    output.setFullScreen(!output.isFullScreen());
  });
}
