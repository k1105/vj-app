import type { BrowserWindow } from "electron";
import { IPC } from "../shared/types";

const FPS = 10;
const PREVIEW_WIDTH = 480;
const JPEG_QUALITY = 60;

/**
 * Samples the Output window at ~10fps and pushes a low-resolution JPEG
 * data URL to the Controller window so it can show it in the LIVE OUT
 * preview. Implemented with `webContents.capturePage()` on a setInterval.
 *
 * Returns a cleanup function that stops the sampler.
 */
export function startLivePreview(
  outputWindow: BrowserWindow,
  controllerWindow: BrowserWindow,
): () => void {
  let stopped = false;
  let inFlight = false;

  const tick = async () => {
    if (stopped || inFlight) return;
    if (outputWindow.isDestroyed() || controllerWindow.isDestroyed()) return;
    inFlight = true;
    try {
      const image = await outputWindow.webContents.capturePage();
      if (stopped || image.isEmpty()) return;
      const resized = image.resize({ width: PREVIEW_WIDTH, quality: "good" });
      const jpeg = resized.toJPEG(JPEG_QUALITY);
      const dataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
      if (!stopped && !controllerWindow.isDestroyed()) {
        controllerWindow.webContents.send(IPC.PreviewLive, dataUrl);
      }
    } catch (err) {
      // capture may fail briefly during load/resize — ignore.
      if (!stopped) console.warn("[livePreview] capture failed:", err);
    } finally {
      inFlight = false;
    }
  };

  const interval = setInterval(tick, Math.round(1000 / FPS));

  // Kick off after the output window has content to capture.
  if (outputWindow.webContents.isLoading()) {
    outputWindow.webContents.once("did-finish-load", () => void tick());
  } else {
    void tick();
  }

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}
