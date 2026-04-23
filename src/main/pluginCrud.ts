import { shell } from "electron";
import { promises as fs } from "fs";
import { join, resolve } from "path";
import { appRoot, broadcastPluginsNow } from "./pluginLoader";
import type { PluginKind } from "../shared/types";

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
 * Open a Finder window with the plugin directory selected.
 */
export function revealPlugin(kind: PluginKind, id: string): void {
  const dir = pluginDir(kind, id);
  assertInsideRoot(dir, kind);
  // showItemInFolder selects the item in Finder rather than opening the dir.
  // Pass the manifest path so the user lands on a meaningful file.
  shell.showItemInFolder(join(dir, "manifest.json"));
}
