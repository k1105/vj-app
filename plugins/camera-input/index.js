/**
 * Camera input → polka-dot mosaic.
 *
 * Pulls a MediaStream from a system camera (chosen via the cameraDeviceId
 * param), down-samples each frame to a small offscreen canvas at the
 * grid resolution, then draws each cell as a filled circle whose colour
 * is the sampled pixel.
 *
 * Stream lifecycle: ensureStream() runs at most one acquisition at a time
 * and tears the previous stream down before starting a new one. dispose()
 * stops every track + clears srcObject so the camera light goes off when
 * the clip leaves the layer.
 */

export default class CameraPolkaDot {
  /** @param {{ width: number, height: number }} ctx */
  setup(ctx) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = ctx.width;
    this.canvas.height = ctx.height;

    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.autoplay = true;

    this.offscreen = document.createElement("canvas");

    this.requestedDeviceId = null; // last deviceId we asked for
    this.activeDeviceId = null;    // last deviceId we successfully opened
    this.acquiring = false;
    this.stream = null;

    return this.canvas;
  }

  /** @param {{ params: Record<string, unknown> }} ctx */
  update({ params }) {
    if (!this.canvas) return;
    const desiredDeviceId =
      typeof params?.cameraDeviceId === "string" ? params.cameraDeviceId : "";
    if (desiredDeviceId !== this.requestedDeviceId) {
      this.requestedDeviceId = desiredDeviceId;
      this.ensureStream(desiredDeviceId);
    }

    const ctx2d = this.canvas.getContext("2d");
    const w = this.canvas.width;
    const h = this.canvas.height;

    const cols = clamp(Math.round(Number(params?.gridSize) || 24), 4, 96);
    const dotRatio = clamp(Number(params?.dotSize) || 0.8, 0.05, 1);
    const mirror = params?.mirror !== false;
    const raw = params?.raw === true || params?.raw === 1;

    // Square cells so the aspect ratio of the dot grid matches the canvas.
    const cellSize = w / cols;
    const rows = Math.max(1, Math.ceil(h / cellSize));

    if (this.offscreen.width !== cols || this.offscreen.height !== rows) {
      this.offscreen.width = cols;
      this.offscreen.height = rows;
    }
    const offCtx = this.offscreen.getContext("2d", { willReadFrequently: true });

    ctx2d.fillStyle = "#000";
    ctx2d.fillRect(0, 0, w, h);

    const ready =
      this.video.readyState >= 2 && this.video.videoWidth > 0;
    if (!ready) return;

    // Raw mode: stretch the camera frame directly onto the canvas.
    if (raw) {
      ctx2d.save();
      if (mirror) {
        ctx2d.translate(w, 0);
        ctx2d.scale(-1, 1);
      }
      ctx2d.drawImage(this.video, 0, 0, w, h);
      ctx2d.restore();
      return;
    }

    // Down-sample the camera frame at grid resolution. drawImage uses the
    // browser's native scaler, which is plenty for cols ≤ 96.
    offCtx.save();
    if (mirror) {
      offCtx.translate(cols, 0);
      offCtx.scale(-1, 1);
    }
    offCtx.drawImage(this.video, 0, 0, cols, rows);
    offCtx.restore();

    let data;
    try {
      data = offCtx.getImageData(0, 0, cols, rows).data;
    } catch (err) {
      // Tainted canvas (cross-origin video): bail and leave the frame black.
      // Logged once per occurrence so a black frame in the middle of a session
      // is traceable.
      if (!this._readErrorLogged) {
        console.warn("[camera-input] getImageData failed:", err);
        this._readErrorLogged = true;
      }
      return;
    }
    this._readErrorLogged = false;

    const radius = (cellSize / 2) * dotRatio;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = (r * cols + c) * 4;
        const R = data[i];
        const G = data[i + 1];
        const B = data[i + 2];
        ctx2d.fillStyle = `rgb(${R},${G},${B})`;
        ctx2d.beginPath();
        ctx2d.arc(
          c * cellSize + cellSize / 2,
          r * cellSize + cellSize / 2,
          radius,
          0,
          Math.PI * 2,
        );
        ctx2d.fill();
      }
    }
  }

  async ensureStream(deviceId) {
    if (this.acquiring) return;
    this.acquiring = true;
    try {
      this.stopStream();
      const constraints = deviceId
        ? { video: { deviceId: { exact: deviceId } } }
        : { video: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      // Could have been disposed while awaiting.
      if (!this.video) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      this.stream = stream;
      this.video.srcObject = stream;
      try {
        await this.video.play();
      } catch {
        /* autoplay may reject silently; the next frame will still draw */
      }
      this.activeDeviceId = deviceId;
    } catch (err) {
      console.warn("[camera-input] getUserMedia failed:", err);
      this.activeDeviceId = null;
    } finally {
      this.acquiring = false;
    }
  }

  stopStream() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
      this.stream = null;
    }
    if (this.video) {
      try {
        this.video.pause();
      } catch {
        /* ignore */
      }
      this.video.srcObject = null;
    }
  }

  dispose() {
    this.stopStream();
    this.canvas = null;
    this.video = null;
    this.offscreen = null;
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
