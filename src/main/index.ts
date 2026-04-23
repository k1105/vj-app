import { app, BrowserWindow, net, protocol } from "electron";
import { pathToFileURL } from "url";
import { resolve } from "path";
import { createControllerWindow, createManagerWindow, createOutputWindow } from "./windows";
import { registerIpcHandlers } from "./ipc";
import { startPluginWatcher, appRoot } from "./pluginLoader";
import { startLivePreview } from "./livePreview";

// Forward renderer console.{log,warn,error} to the main-process stdout
// so `npm run dev` shows them alongside main logs.
if (!app.isPackaged) {
  app.commandLine.appendSwitch("enable-logging");
}

let controllerWindow: BrowserWindow | null = null;
let outputWindow: BrowserWindow | null = null;
let managerWindow: BrowserWindow | null = null;

function openManagerWindow(): void {
  if (managerWindow && !managerWindow.isDestroyed()) {
    managerWindow.focus();
    return;
  }
  managerWindow = createManagerWindow();
  managerWindow.on("closed", () => {
    managerWindow = null;
  });
}

// `vj-asset://local/<relative-path>` serves files from the app root
// (plugins/, materials/, postfx/, transitions/). Must be registered
// BEFORE app.whenReady so the scheme is treated as standard+secure.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "vj-asset",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

app.whenReady().then(async () => {
  // Serve local asset files to the renderer/output windows.
  // Required because the output document is loaded via http://localhost
  // in dev, which blocks plain `file://` media.
  protocol.handle("vj-asset", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "local") {
        return new Response("not found", { status: 404 });
      }
      const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      const root = resolve(appRoot());
      const absPath = resolve(root, rel);
      if (!absPath.startsWith(root + "/") && absPath !== root) {
        return new Response("forbidden", { status: 403 });
      }
      const upstream = await net.fetch(pathToFileURL(absPath).toString());
      // Re-emit with CORS headers so WebGL can sample the video texture
      // without marking it as cross-origin tainted (doc is http://localhost,
      // asset is vj-asset://local, so it's technically cross-origin).
      const headers = new Headers(upstream.headers);
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "*");
      headers.set("Cross-Origin-Resource-Policy", "cross-origin");
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    } catch (err) {
      console.error("[vj-asset] handler error:", err);
      return new Response(String(err), { status: 500 });
    }
  });

  controllerWindow = createControllerWindow();
  outputWindow = createOutputWindow();

  registerIpcHandlers({
    getController: () => controllerWindow,
    getOutput: () => outputWindow,
    openManager: openManagerWindow,
  });

  startPluginWatcher((event) => {
    controllerWindow?.webContents.send(event.channel, event.payload);
    if (managerWindow && !managerWindow.isDestroyed()) {
      managerWindow.webContents.send(event.channel, event.payload);
    }
  });

  if (controllerWindow && outputWindow) {
    const stopPreview = startLivePreview(outputWindow, controllerWindow);
    app.on("before-quit", stopPreview);
    outputWindow.on("closed", stopPreview);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      controllerWindow = createControllerWindow();
      outputWindow = createOutputWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
