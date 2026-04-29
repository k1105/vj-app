import { BrowserWindow, Menu, dialog, ipcMain } from "electron";
import {
  IPC,
  type ContextMenuItem,
  type ParamValue,
  type PluginKind,
  type VJState,
} from "../shared/types";
import { downloadVideo } from "./videoDownloader";
import { importLocalVideo } from "./videoImporter";
import { generateSplat } from "./splatGenerator";
import { createTextAsset, migrateAllTextAssets } from "./textAssetImporter";
import { createImageAsset } from "./imageAssetImporter";
import { createSequenceAsset } from "./sequenceAssetImporter";
import { broadcastPluginsNow, listPlugins, readPluginSource } from "./pluginLoader";
import {
  bakePluginThumbnail,
  deletePlugin,
  renamePlugin,
  revealPlugin,
  setPluginCategory,
  setPluginDefaults,
  setParamPrimary,
} from "./pluginCrud";
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

  ipcMain.handle(IPC.PickImageFile, async () => {
    const result = await dialog.showOpenDialog({
      title: "Pick image for splat generation",
      filters: [
        { name: "Image", extensions: ["jpg", "jpeg", "png", "webp", "heic"] },
      ],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(
    IPC.GenerateSplat,
    async (event, args: { imagePath: string; name: string }) => {
      return generateSplat(args.imagePath, args.name, (p) => {
        event.sender.send(IPC.SplatProgress, p);
      });
    },
  );

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

  // Output → Controller: forward perf stats once per second.
  ipcMain.on(IPC.PerfStats, (_event, stats) => {
    ctx.getController()?.webContents.send(IPC.PerfStats, stats);
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

  ipcMain.handle(
    IPC.CreateTextAsset,
    async (_event, args: { name: string; texts: string[] }) => {
      return createTextAsset(args.name, args.texts);
    },
  );

  ipcMain.handle(IPC.MigrateTextAssets, async () => migrateAllTextAssets());

  ipcMain.handle(IPC.PickImagesForAsset, async () => {
    const result = await dialog.showOpenDialog({
      title: "Select images",
      filters: [{ name: "Image", extensions: ["jpg", "jpeg", "png", "webp", "gif"] }],
      properties: ["openFile", "multiSelections"],
    });
    if (result.canceled) return [];
    return result.filePaths;
  });

  ipcMain.handle(
    IPC.CreateImageAsset,
    async (_event, args: { name: string; imagePaths: string[] }) => {
      return createImageAsset(args.name, args.imagePaths);
    },
  );

  ipcMain.handle(
    IPC.CreateSequenceAsset,
    async (_event, args: { name: string; videoPluginIds: string[] }) => {
      return createSequenceAsset(args.name, args.videoPluginIds);
    },
  );

  // Show a native (OS-level) context menu and resolve to the selected
  // item id, or null if dismissed. Each `id` is opaque — the renderer
  // decides what it means.
  ipcMain.handle(
    IPC.ShowContextMenu,
    async (event, items: ContextMenuItem[]): Promise<string | null> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return null;
      return new Promise<string | null>((resolvePromise) => {
        let picked: string | null = null;
        const template: Electron.MenuItemConstructorOptions[] = items.map(
          (item) => ({
            label: item.label,
            enabled: item.enabled !== false,
            click: () => {
              picked = item.id;
            },
          }),
        );
        const menu = Menu.buildFromTemplate(template);
        menu.popup({
          window: win,
          callback: () => resolvePromise(picked),
        });
      });
    },
  );

  ipcMain.handle(
    IPC.SavePluginThumbnail,
    async (_event, args: { kind: PluginKind; id: string }) => {
      await bakePluginThumbnail(ctx.getOutput(), args.kind, args.id);
    },
  );

  ipcMain.handle(
    IPC.SetPluginDefaults,
    async (
      _event,
      args: { kind: PluginKind; id: string; values: Record<string, ParamValue> },
    ) => {
      await setPluginDefaults(args.kind, args.id, args.values);
    },
  );

  ipcMain.handle(
    IPC.SetParamPrimary,
    async (
      _event,
      args: { kind: PluginKind; id: string; paramKeys: string[]; primary: boolean },
    ) => {
      await setParamPrimary(args.kind, args.id, args.paramKeys, args.primary);
    },
  );

  ipcMain.handle(
    IPC.SetPluginCategory,
    async (_event, args: { kind: PluginKind; id: string; category: string }) => {
      await setPluginCategory(args.kind, args.id, args.category);
    },
  );

  ipcMain.handle(
    IPC.SetPluginHidden,
    async (_event, args: { id: string; hidden: boolean }) => {
      const raw = getSetting("hiddenPluginIds");
      const list: string[] = Array.isArray(raw)
        ? raw.filter((v): v is string => typeof v === "string")
        : [];
      const set = new Set(list);
      if (args.hidden) set.add(args.id);
      else set.delete(args.id);
      setSetting("hiddenPluginIds", Array.from(set));
      await broadcastPluginsNow();
    },
  );
}
