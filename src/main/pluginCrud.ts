import { shell, type BrowserWindow } from "electron";
import { promises as fs } from "fs";
import { join, resolve } from "path";
import { appRoot, broadcastPluginsNow } from "./pluginLoader";
import type { ParamValue, PluginKind } from "../shared/types";
export type { PluginKind };

const THUMB_WIDTH = 320;

function kindDir(kind: PluginKind): string {
  switch (kind) {
    case "material":   return "plugins";
    case "postfx":     return "postfx";
    case "transition": return "transitions";
  }
}

function pluginDir(kind: PluginKind, id: string): string {
  return join(appRoot(), kindDir(kind), id);
}

/**
 * Safety guard. Every filesystem mutation must prove the target resolves
 * *inside* the kind's plugin root, so a crafted id like "../../etc/passwd"
 * cannot escape. Throws on violation.
 */
function assertInsideRoot(targetAbs: string, kind: PluginKind): void {
  const root = resolve(appRoot(), kindDir(kind));
  const abs = resolve(targetAbs);
  if (!abs.startsWith(root + "/") && abs !== root) {
    throw new Error(`refused: path escapes plugin root (${abs})`);
  }
}

/**
 * Update the display name (manifest.name) without renaming the directory
 * or id. Directory-rename would change the plugin's identity and break any
 * layer/clip that already references it.
 */
export async function renamePlugin(
  kind: PluginKind,
  id: string,
  newName: string,
): Promise<void> {
  const dir = pluginDir(kind, id);
  assertInsideRoot(dir, kind);
  const manifestPath = join(dir, "manifest.json");
  const raw = await fs.readFile(manifestPath, "utf-8");
  const manifest = JSON.parse(raw);
  manifest.name = newName;
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  await broadcastPluginsNow();
}

/**
 * Remove the plugin directory entirely. For video plugins we also remove
 * the backing mp4 in materials/videos — otherwise the file accumulates
 * forever. Non-video plugins get their whole source directory deleted,
 * which is irreversible (the caller's UI is responsible for warning).
 */
export async function deletePlugin(kind: PluginKind, id: string): Promise<void> {
  const dir = pluginDir(kind, id);
  assertInsideRoot(dir, kind);

  // Resolve the video file first (before removing the manifest) so we can
  // delete it too. Best-effort — if the manifest is malformed or the file
  // doesn't exist we still proceed with dir removal.
  let videoAbs: string | null = null;
  try {
    const raw = await fs.readFile(join(dir, "manifest.json"), "utf-8");
    const manifest = JSON.parse(raw);
    if (manifest.outputType === "video" && typeof manifest.videoFile === "string") {
      const abs = resolve(dir, manifest.videoFile);
      const materialsRoot = resolve(appRoot(), "materials");
      // Only delete if it lives inside materials/ — never follow paths
      // that escape out to arbitrary filesystem locations.
      if (abs.startsWith(materialsRoot + "/")) {
        videoAbs = abs;
      }
    }
  } catch {
    /* ignore — dir will still be removed below */
  }

  await fs.rm(dir, { recursive: true, force: true });
  if (videoAbs) {
    await fs.rm(videoAbs, { force: true });
  }
  await broadcastPluginsNow();
}

/**
 * Capture the Output window's current frame and save it as the plugin's
 * thumbnail.png. Captures whatever is currently being rendered — the user
 * is expected to solo / arrange the asset they want pictured before clicking.
 */
export async function bakePluginThumbnail(
  outputWindow: BrowserWindow | null,
  kind: PluginKind,
  id: string,
): Promise<void> {
  if (!outputWindow || outputWindow.isDestroyed()) {
    throw new Error("Output window is not available");
  }
  const dir = pluginDir(kind, id);
  assertInsideRoot(dir, kind);

  const image = await outputWindow.webContents.capturePage();
  if (image.isEmpty()) throw new Error("captured an empty frame");
  const resized = image.resize({ width: THUMB_WIDTH, quality: "good" });
  const png = resized.toPNG();
  await fs.writeFile(join(dir, "thumbnail.png"), png);
  await broadcastPluginsNow();
}

/**
 * Update manifest.category. Pass an empty string to clear the field
 * (the loader will fall back to outputType).
 */
export async function setPluginCategory(
  kind: PluginKind,
  id: string,
  category: string,
): Promise<void> {
  const dir = pluginDir(kind, id);
  assertInsideRoot(dir, kind);
  const manifestPath = join(dir, "manifest.json");
  const raw = await fs.readFile(manifestPath, "utf-8");
  const manifest = JSON.parse(raw);
  const trimmed = category.trim();
  if (trimmed.length === 0) {
    delete manifest.category;
  } else {
    manifest.category = trimmed;
  }
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  await broadcastPluginsNow();
}

/**
 * Update the manifest's param defaults with the supplied values. Only keys
 * that exist in `params` are touched; unknown keys in `values` are ignored
 * so callers can pass a clip's full param map without worrying about extras.
 */
export async function setPluginDefaults(
  kind: PluginKind,
  id: string,
  values: Record<string, ParamValue>,
): Promise<void> {
  const dir = pluginDir(kind, id);
  assertInsideRoot(dir, kind);
  const manifestPath = join(dir, "manifest.json");
  const raw = await fs.readFile(manifestPath, "utf-8");
  const manifest = JSON.parse(raw);
  if (!Array.isArray(manifest.params)) {
    throw new Error("manifest has no params array");
  }
  manifest.params = manifest.params.map((p: { key: string; default?: unknown }) => {
    if (p.key in values) {
      return { ...p, default: values[p.key] };
    }
    return p;
  });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  await broadcastPluginsNow();
}

/**
 * Set or clear the `primary` flag on one or more params in the manifest.
 * Range pairs (loopStart/loopEnd etc.) are always toggled together, so
 * the caller passes both keys in a single call.
 */
export async function setParamPrimary(
  kind: PluginKind,
  id: string,
  paramKeys: string[],
  primary: boolean,
): Promise<void> {
  const dir = pluginDir(kind, id);
  assertInsideRoot(dir, kind);
  const manifestPath = join(dir, "manifest.json");
  const raw = await fs.readFile(manifestPath, "utf-8");
  const manifest = JSON.parse(raw);
  if (!Array.isArray(manifest.params)) {
    throw new Error("manifest has no params array");
  }
  const keySet = new Set(paramKeys);
  manifest.params = manifest.params.map((p: { key: string; primary?: boolean }) => {
    if (!keySet.has(p.key)) return p;
    const next = { ...p };
    if (primary) {
      next.primary = true;
    } else {
      delete next.primary;
    }
    return next;
  });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  await broadcastPluginsNow();
}

/**
 * Open a Finder window with the plugin directory selected.
 */
export function revealPlugin(kind: PluginKind, id: string): void {
  const dir = pluginDir(kind, id);
  assertInsideRoot(dir, kind);
  // showItemInFolder selects the item in Finder rather than opening the dir.
  // Pass the manifest path so the user lands on a meaningful file.
  shell.showItemInFolder(join(dir, "manifest.json"));
}
