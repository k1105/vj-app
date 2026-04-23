import { BrowserWindow, dialog, ipcMain } from "electron";
import { IPC, type PluginKind, type VJState } from "../shared/types";
import { downloadVideo } from "./videoDownloader";
import { importLocalVideo } from "./videoImporter";
import { listPlugins, readPluginSource } from "./pluginLoader";
import { getSetting, setSetting } from "./store";

interface Ctx {
  getController: () => BrowserWindow | null;
  getOutput: () => BrowserWindow | null;
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

  // Controller → Main → Output broadcast
  ipcMain.on(IPC.StateUpdate, (_event, state: VJState) => {
    const output = ctx.getOutput();
    output?.webContents.send(IPC.StateBroadcast, state);
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
