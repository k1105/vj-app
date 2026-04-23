import { spawn } from "child_process";
import { promises as fs } from "fs";

/**
 * Return the duration of a video file in seconds using ffprobe.
 * Returns null if ffprobe is unavailable or fails.
 */
export async function getVideoDuration(videoPath: string): Promise<number | null> {
  return new Promise((resolvePromise) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ]);
    let stdout = "";
    proc.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    proc.on("error", () => resolvePromise(null));
    proc.on("close", (code) => {
      if (code !== 0) { resolvePromise(null); return; }
      const dur = parseFloat(stdout.trim());
      resolvePromise(Number.isFinite(dur) ? dur : null);
    });
  });
}

/**
 * Extract a single still from a video and write it to `outPath`.
 *
 * Uses ffmpeg with `-ss 1` (seek to 1 second) to skip fade-ins and black
 * intros. Falls back to the very first frame if the video is shorter.
 * Fails silently — thumbnails are best-effort.
 */
export async function generateVideoThumbnail(
  videoPath: string,
  outPath: string,
): Promise<boolean> {
  // Skip if a thumbnail already exists.
  try {
    await fs.access(outPath);
    return true;
  } catch {
    /* not present — create */
  }

  return new Promise((resolvePromise) => {
    const proc = spawn("ffmpeg", [
      "-y",
      "-ss",
      "1",
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-vf",
      "scale=320:-1",
      "-q:v",
      "4",
      outPath,
    ]);
    let stderr = "";
    proc.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    proc.on("error", (err) => {
      console.warn(`[thumbnail] ffmpeg spawn error for ${videoPath}:`, err.message);
      resolvePromise(false);
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        console.warn(
          `[thumbnail] ffmpeg exited ${code} for ${videoPath}:`,
          stderr.trim().split("\n").slice(-3).join(" | "),
        );
        resolvePromise(false);
        return;
      }
      resolvePromise(true);
    });
  });
}
