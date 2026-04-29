import { BrowserWindow, screen } from "electron";
import { join, resolve } from "path";

const preloadPath = join(__dirname, "../preload/index.js");

// Absolute filesystem path to the Output window's HTML. In dev, the Vite
// renderer root is src/renderer, which means src/output/index.html is OUTSIDE
// the served root. Requesting `/output/index.html` on the dev server returns
// the Controller's index.html via Vite's SPA fallback, which is why we have
// to use Vite's `/@fs/` escape to load the output document directly from the
// filesystem. `__dirname` at runtime is `<project>/out/main`.
const outputHtmlAbs = resolve(__dirname, "../../src/output/index.html");

export function createControllerWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 720,
    backgroundColor: "#05070a",
    title: "VideoJockeyJS · Controller",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/index.html`);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}

export function createManagerWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 720,
    minHeight: 540,
    backgroundColor: "#05070a",
    title: "VideoJockeyJS · Library",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/index.html?window=manager`);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"), { search: "window=manager" });
  }

  return win;
}

export function createOutputWindow(): BrowserWindow {
  // Place on a secondary display if one exists.
  const displays = screen.getAllDisplays();
  const secondary = displays.find((d) => d.id !== screen.getPrimaryDisplay().id);
  const bounds = secondary?.bounds;

  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    x: bounds?.x,
    y: bounds?.y,
    backgroundColor: "#000000",
    title: "VideoJockeyJS · Output",
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/@fs${outputHtmlAbs}`);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(join(__dirname, "../renderer/output/index.html"));
  }

  return win;
}
