import { spawn } from "child_process";
import { promises as fs } from "fs";
import { basename, join, relative } from "path";
import { appRoot } from "./pluginLoader";
import { generateVideoThumbnail, getVideoDuration } from "./thumbnail";
import type { DownloadProgress, DownloadResult } from "../shared/types";

function videosDir(): string {
  return join(appRoot(), "materials", "videos");
}

function videoPluginsRoot(): string {
  return join(appRoot(), "plugins");
}

// yt-dlp emits one progress line per chunk; `[download]  42.0% of ...`.
const PROGRESS_RE = /(\d+(?:\.\d+)?)%/;
// We mark the printed filepath/title lines with sentinels so they can't be
// confused with progress output.
const FILEPATH_SENTINEL = "__VJ_FILEPATH__";
const TITLE_SENTINEL = "__VJ_TITLE__";

export async function downloadVideo(
  url: string,
  onProgress: (p: DownloadProgress) => void,
): Promise<DownloadResult> {
  const dir = videosDir();
  await fs.mkdir(dir, { recursive: true });

  return new Promise((resolvePromise, reject) => {
    const proc = spawn("yt-dlp", [
      "-f",
      // Force H.264 (avc1). Electron's Chromium cannot reliably decode AV1
      // or HEVC, so we explicitly select avc1 tracks first, then fall back
      // to any <=1080p mp4 if nothing avc1 is available.
      "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[ext=m4a]/best[height<=1080][vcodec^=avc1]/best[height<=1080][ext=mp4]",
      "--merge-output-format",
      "mp4",
      "-o",
      join(dir, "%(id)s.%(ext)s"),
      "--print",
      `after_move:${FILEPATH_SENTINEL}%(filepath)s`,
      "--print",
      `${TITLE_SENTINEL}%(title)s`,
      "--no-colors",
      "--newline",
      "--progress",
      "--no-overwrites",
      "--cookies-from-browser",
      "chrome",
      url,
    ]);

    let stdout = "";
    let stderr = "";

    // yt-dlp downloads video and audio streams separately when using
    // bestvideo+bestaudio format, so progress resets 0→100% twice.
    // Track how many "Destination:" lines we've seen to compute overall %.
    let passCount = 0;      // number of download passes started so far
    let totalPasses = 2;    // assume 2-pass until proven otherwise (corrected below)

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;

        // New file destination = new download pass starting
        if (line.includes("[download] Destination:")) {
          passCount++;
          // If this is the second destination, we know there are ≥2 passes
          if (passCount >= 2) totalPasses = 2;
          continue;
        }

        // Single-file download (no merge needed) shows 100% once; treat as 1 pass
        if (passCount === 1 && line.includes("[download] 100%")) {
          totalPasses = 1;
        }

        const match = line.match(PROGRESS_RE);
        if (match) {
          const segPct = parseFloat(match[1]);
          // Map per-pass percent to overall: each pass occupies 100/totalPasses %
          const completedPasses = Math.max(0, passCount - 1);
          const overall = (completedPasses * 100 + segPct) / totalPasses;
          const isMerging = line.includes("Merger") || line.includes("Merging");
          onProgress({
            percent: Math.min(99, overall), // reserve 100 for the "done" signal
            stage: isMerging ? "merging" : "downloading",
          });
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      // `ENOENT` from spawn means yt-dlp is not installed.
      const message =
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? "yt-dlp not found. install with `brew install yt-dlp`"
          : err.message;
      onProgress({ percent: 0, stage: "error", message });
      reject(new Error(message));
    });

    proc.on("close", async (code) => {
      if (code !== 0) {
        const message = stderr.trim() || `yt-dlp exited with code ${code}`;
        onProgress({ percent: 0, stage: "error", message });
        reject(new Error(message));
        return;
      }
      const filePath = extract(stdout, FILEPATH_SENTINEL);
      const title = extract(stdout, TITLE_SENTINEL) ?? "Untitled";
      if (!filePath) {
        const message = "yt-dlp did not report a filepath";
        onProgress({ percent: 0, stage: "error", message });
        reject(new Error(message));
        return;
      }
      try {
        await writeVideoPluginManifest(filePath, title);
      } catch (err) {
        const message = `failed to write plugin manifest: ${(err as Error).message}`;
        onProgress({ percent: 0, stage: "error", message });
        reject(new Error(message));
        return;
      }
      onProgress({ percent: 100, stage: "done" });
      resolvePromise({ filePath, title });
    });
  });
}

function extract(output: string, sentinel: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const i = line.indexOf(sentinel);
    if (i !== -1) return line.slice(i + sentinel.length).trim();
  }
  return null;
}

/**
 * Write a minimal material-plugin manifest so the downloaded video shows up
 * as a draggable asset in the Controller. The plugin directory is
 * `plugins/video-<id>/`, where <id> is derived from the yt-dlp output filename.
 * fs.watch picks up the new directory and broadcasts PluginsChanged.
 */
async function writeVideoPluginManifest(filePath: string, title: string): Promise<void> {
  // videoId = filename without extension (yt-dlp uses %(id)s.%(ext)s)
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
      { key: "speed",     type: "float", default: 1,          min: 0.25,       max: 2,          step: 0.05 },
      { key: "loopStart", type: "float", default: 0,          min: 0,          max: durationMax, step: 1 },
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
}
