import { app } from "electron";
import { promises as fs, watch } from "fs";
import { join, relative, resolve } from "path";
import { IPC, type PluginKind, type PluginMeta } from "../shared/types";
import { getVideoDuration } from "./thumbnail";

// Plugin directories live next to the app, not inside src/.
// In dev: cwd of electron-vite. In prod: resource path.
export function appRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "app-plugins")
    : resolve(process.cwd());
}

function pluginRoot(kind: PluginKind): string {
  return join(appRoot(), kindToDir(kind));
}

function kindToDir(kind: PluginKind): string {
  switch (kind) {
    case "material":
      return "plugins";
    case "postfx":
      return "postfx";
    case "transition":
      return "transitions";
  }
}

async function scanKind(kind: PluginKind): Promise<PluginMeta[]> {
  const dir = pluginRoot(kind);
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const plugins: PluginMeta[] = [];
  for (const entry of entries) {
    const pluginDir = join(dir, entry);
    try {
      const stat = await fs.stat(pluginDir);
      if (!stat.isDirectory()) continue;
      const manifestPath = join(pluginDir, "manifest.json");
      const manifestRaw = await fs.readFile(manifestPath, "utf-8");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manifest = JSON.parse(manifestRaw) as any;

      // ── Migrate old video manifests ──────────────────────────────────────────
      //  v1: loopStart/loopEnd were 0-1 normalised → now seconds (max 3600)
      //  v2: if manifest has a `duration` field, tighten max/default to real length
      if (manifest.outputType === "video" && Array.isArray(manifest.params)) {
        let dirty = false;

        // v1: normalised → seconds
        const hasOld = manifest.params.some(
          (p: { key: string; max?: number }) =>
            (p.key === "loopStart" || p.key === "loopEnd") && (p.max ?? 1) <= 1,
        );
        if (hasOld) {
          manifest.params = manifest.params.map((p: Record<string, unknown>) => {
            if (p.key === "loopStart") return { ...p, default: 0, min: 0, max: 3600, step: 1 };
            if (p.key === "loopEnd")   return { ...p, default: 3600, min: 0, max: 3600, step: 1 };
            return p;
          });
          dirty = true;
          console.log(`[pluginLoader] migrated loopStart/loopEnd to seconds: ${entry}`);
        }

        // v2: measure real duration if missing, then tighten loop param range
        if (typeof manifest.duration !== "number" && typeof manifest.videoFile === "string") {
          const videoAbs = resolve(pluginDir, manifest.videoFile);
          const measured = await getVideoDuration(videoAbs);
          if (measured != null && measured > 0) {
            manifest.duration = measured;
            dirty = true;
            console.log(`[pluginLoader] measured duration ${measured.toFixed(1)}s for: ${entry}`);
          }
        }
        const dur = typeof manifest.duration === "number" ? manifest.duration : null;
        if (dur != null && dur > 0) {
          const dMax = Math.ceil(dur);
          const needsTighten = manifest.params.some(
            (p: { key: string; max?: number }) =>
              (p.key === "loopStart" || p.key === "loopEnd") && (p.max ?? 3600) > dMax + 1,
          );
          if (needsTighten) {
            manifest.params = manifest.params.map((p: Record<string, unknown>) => {
              if (p.key === "loopStart") return { ...p, min: 0, max: dMax, step: 1 };
              if (p.key === "loopEnd")   return { ...p, default: dMax, min: 0, max: dMax, step: 1 };
              return p;
            });
            dirty = true;
            console.log(`[pluginLoader] tightened loop range to ${dMax}s for: ${entry}`);
          }
        }

        if (dirty) {
          await fs.writeFile(
            manifestPath,
            JSON.stringify(manifest, null, 2) + "\n",
            "utf-8",
          );
        }
      }

      // Resolve a video asset to a vj-asset:// URL the Output window can load.
      let videoUrl: string | undefined;
      if (manifest.outputType === "video" && typeof manifest.videoFile === "string") {
        const abs = resolve(pluginDir, manifest.videoFile);
        const root = resolve(appRoot());
        if (abs.startsWith(root + "/")) {
          const rel = relative(root, abs).split(/[\\/]/).map(encodeURIComponent).join("/");
          videoUrl = `vj-asset://local/${rel}`;
        } else {
          console.warn(
            `[pluginLoader] ${entry}: videoFile "${manifest.videoFile}" is outside app root`,
          );
        }
      }

      // Resolve an optional thumbnail image. Prefer manifest.thumbnail but
      // fall back to thumbnail.jpg then thumbnail.png so both extensions work.
      let thumbnailUrl: string | undefined;
      const thumbCandidates: string[] =
        typeof manifest.thumbnail === "string"
          ? [manifest.thumbnail]
          : ["thumbnail.jpg", "thumbnail.png"];
      {
        const root = resolve(appRoot());
        for (const candidate of thumbCandidates) {
          const abs = resolve(pluginDir, candidate);
          try {
            const st = await fs.stat(abs);
            if (abs.startsWith(root + "/")) {
              const rel = relative(root, abs).split(/[\\/]/).map(encodeURIComponent).join("/");
              // cache-bust via mtime so regenerated thumbnails refresh in the UI
              thumbnailUrl = `vj-asset://local/${rel}?t=${st.mtimeMs.toFixed(0)}`;
            }
            break; // found — stop searching
          } catch {
            /* file missing — try next candidate */
          }
        }
      }

      plugins.push({
        id: entry,
        kind,
        name: manifest.name ?? entry,
        author: manifest.author,
        version: manifest.version,
        outputType: manifest.outputType,
        params: manifest.params ?? [],
        inputs: manifest.inputs,
        entry: manifest.entry,
        manifestPath,
        videoUrl,
        thumbnailUrl,
      });
    } catch (err) {
      console.warn(`[pluginLoader] skip ${entry}:`, err);
    }
  }
  return plugins;
}

/**
 * Read the source of a plugin entry file. Used by the Output window
 * (PluginHost) to dynamically import plugin code via a Blob URL.
 * The caller specifies kind+id; the entry path is resolved from the manifest,
 * so arbitrary file reads are not possible.
 */
export async function readPluginSource(
  kind: PluginKind,
  id: string,
): Promise<string | null> {
  const dir = pluginRoot(kind);
  const pluginDir = join(dir, id);
  try {
    const manifestRaw = await fs.readFile(join(pluginDir, "manifest.json"), "utf-8");
    const manifest = JSON.parse(manifestRaw);
    const entry: string = manifest.entry ?? "index.js";
    const entryPath = join(pluginDir, entry);
    return await fs.readFile(entryPath, "utf-8");
  } catch (err) {
    console.warn(`[pluginLoader] readPluginSource failed ${kind}/${id}:`, err);
    return null;
  }
}

export async function listPlugins(): Promise<PluginMeta[]> {
  const [materials, postfx, transitions] = await Promise.all([
    scanKind("material"),
    scanKind("postfx"),
    scanKind("transition"),
  ]);
  return [...materials, ...postfx, ...transitions];
}

export function startPluginWatcher(
  emit: (event: { channel: string; payload: unknown }) => void,
): void {
  const kinds: PluginKind[] = ["material", "postfx", "transition"];
  for (const kind of kinds) {
    const dir = pluginRoot(kind);
    try {
      watch(dir, { recursive: true }, () => {
        listPlugins().then((plugins) => {
          emit({ channel: IPC.PluginsChanged, payload: plugins });
        });
      });
    } catch {
      // Directory may not exist yet — fail silently.
    }
  }
}
