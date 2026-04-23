import { BrowserWindow, ipcMain } from "electron";
import { IPC, type PluginKind, type VJState } from "../shared/types";
import { downloadVideo } from "./videoDownloader";
import { listPlugins, readPluginSource } from "./pluginLoader";
import { getSetting, setSetting } from "./store";

interface Ctx {
  getController: () => BrowserWindow | null;
  getOutput: () => BrowserWindow | null;
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
