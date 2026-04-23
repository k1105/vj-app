import { createHash } from "crypto";
import { promises as fs } from "fs";
import { basename, extname, join, relative } from "path";
import { appRoot, broadcastPluginsNow } from "./pluginLoader";
import { generateVideoThumbnail, getVideoDuration } from "./thumbnail";
import type { DownloadProgress, DownloadResult } from "../shared/types";

const ACCEPTED_EXTENSIONS = new Set([".mp4"]);

function videosDir(): string {
  return join(appRoot(), "materials", "videos");
}

function videoPluginsRoot(): string {
  return join(appRoot(), "plugins");
}

/**
 * Write the material-plugin manifest for a video file and (best-effort)
 * generate its thumbnail. The plugin directory is `plugins/video-<id>/`.
 * fs.watch picks up the new directory and broadcasts PluginsChanged.
 *
 * Shared by yt-dlp downloads and local-file imports.
 */
export async function writeVideoPluginManifest(
  filePath: string,
  title: string,
): Promise<string> {
  const videoId = basename(filePath).replace(/\.[^.]+$/, "");
  const pluginDir = join(videoPluginsRoot(), `video-${videoId}`);
  await fs.mkdir(pluginDir, { recursive: true });

  // videoFile is written as a path relative to the plugin directory so the
  // manifest is portable if the whole tree is moved.
  const videoFileRel = relative(pluginDir, filePath);

  const duration = await getVideoDuration(filePath);
  const durationMax = duration != null ? Math.ceil(duration) : 3600;

  const manifest = {
    name: title,
    author: "yt-dlp",
    outputType: "video" as const,
    videoFile: videoFileRel,
    thumbnail: "thumbnail.jpg",
    duration: duration ?? undefined,
    params: [
      { key: "playing",   type: "bool",  default: true },
      { key: "speed",     type: "float", default: 1,           min: 0.25,       max: 2,           step: 0.05 },
      { key: "loopStart", type: "float", default: 0,           min: 0,          max: durationMax, step: 1 },
      { key: "loopEnd",   type: "float", default: durationMax, min: 0,          max: durationMax, step: 1 },
    ],
  };

  await fs.writeFile(
    join(pluginDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf-8",
  );

  // Best-effort thumbnail. Fails silently; the Controller falls back to text.
  await generateVideoThumbnail(filePath, join(pluginDir, "thumbnail.jpg"));

  // Explicit broadcast: don't rely on fs.watch timing. By the time the
  // triggering IPC call resolves, every window has the new meta.
  await broadcastPluginsNow();

  return pluginDir;
}

/**
 * Import a user-picked local mp4 into the materials library. The file is
 * copied into `materials/videos/` (never referenced in place) so the
 * manifest stays portable and playback paths match yt-dlp's.
 *
 * IDs are derived from the source filename stem. On collision we append a
 * short hash of the source path so the same filename from a different folder
 * doesn't clobber an existing asset.
 */
export async function importLocalVideo(
  srcPath: string,
  onProgress: (p: DownloadProgress) => void,
): Promise<DownloadResult> {
  const ext = extname(srcPath).toLowerCase();
  if (!ACCEPTED_EXTENSIONS.has(ext)) {
    const message = `unsupported format: ${ext || "(none)"} — only .mp4 is accepted`;
    onProgress({ percent: 0, stage: "error", message });
    throw new Error(message);
  }

  // Verify source file exists and is readable.
  try {
    await fs.access(srcPath);
  } catch {
    const message = `source file not found: ${srcPath}`;
    onProgress({ percent: 0, stage: "error", message });
    throw new Error(message);
  }

  const dir = videosDir();
  await fs.mkdir(dir, { recursive: true });

  const stem = basename(srcPath, ext).replace(/[^a-zA-Z0-9._-]/g, "_");
  let id = stem;
  let destFilename = `${id}${ext}`;
  let destPath = join(dir, destFilename);

  // Collision: if a file with this id already exists, append a short hash.
  try {
    await fs.access(destPath);
    const hash = createHash("sha256").update(srcPath).digest("hex").slice(0, 8);
    id = `${stem}-${hash}`;
    destFilename = `${id}${ext}`;
    destPath = join(dir, destFilename);
  } catch {
    /* no collision */
  }

  onProgress({ percent: 0, stage: "downloading" });
  try {
    await fs.copyFile(srcPath, destPath);
  } catch (err) {
    const message = `copy failed: ${(err as Error).message}`;
    onProgress({ percent: 0, stage: "error", message });
    throw new Error(message);
  }

  onProgress({ percent: 50, stage: "downloading" });

  const title = stem;
  try {
    await writeVideoPluginManifest(destPath, title);
  } catch (err) {
    const message = `failed to write plugin manifest: ${(err as Error).message}`;
    onProgress({ percent: 0, stage: "error", message });
    throw new Error(message);
  }

  onProgress({ percent: 100, stage: "done" });
  return { filePath: destPath, title };
}
