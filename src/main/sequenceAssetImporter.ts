import { promises as fs } from "fs";
import { join, relative, resolve } from "path";
import { appRoot, broadcastPluginsNow } from "./pluginLoader";

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Create a new sequence asset at plugins/sequence-<slug>/.
 * `videoPluginIds` are existing material plugin ids with outputType="video".
 * The sequence manifest stores relative paths from the new plugin dir to each
 * video file, resolved at scan time to vj-asset:// URLs by pluginLoader.
 * Returns the new plugin id.
 */
export async function createSequenceAsset(
  name: string,
  videoPluginIds: string[],
): Promise<string> {
  if (videoPluginIds.length === 0) {
    throw new Error("sequence requires at least one video");
  }

  const pluginsDir = join(appRoot(), "plugins");
  const baseSlug = slugify(name) || "sequence";
  let id = `sequence-${baseSlug}`;
  let suffix = 1;
  while (true) {
    try {
      await fs.access(join(pluginsDir, id));
      suffix++;
      id = `sequence-${baseSlug}-${suffix}`;
    } catch {
      break;
    }
  }

  const sequenceDir = join(pluginsDir, id);
  await fs.mkdir(sequenceDir, { recursive: true });

  // Resolve each video plugin's file path and compute a relative path
  // from the sequence plugin directory.
  const videos: string[] = [];
  for (const videoId of videoPluginIds) {
    const videoPluginDir = join(pluginsDir, videoId);
    try {
      const raw = await fs.readFile(join(videoPluginDir, "manifest.json"), "utf-8");
      const manifest = JSON.parse(raw);
      if (typeof manifest.videoFile !== "string") continue;
      const absVideoPath = resolve(videoPluginDir, manifest.videoFile);
      videos.push(relative(sequenceDir, absVideoPath));
    } catch (err) {
      console.warn(`[sequenceAssetImporter] skipping ${videoId}:`, err);
    }
  }

  if (videos.length === 0) {
    await fs.rm(sequenceDir, { recursive: true, force: true });
    throw new Error("none of the specified video plugins could be resolved");
  }

  const manifest = {
    name: name.trim() || "Untitled Sequence",
    author: "user",
    version: "0.1.0",
    outputType: "sequence" as const,
    category: "sequence",
    videos,
    params: [
      { key: "idx", type: "int", default: 0, min: 0, max: videos.length - 1, step: 1 },
      { key: "loop", type: "bool", default: true },
    ],
  };

  await fs.writeFile(
    join(sequenceDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf-8",
  );

  await broadcastPluginsNow();
  return id;
}
