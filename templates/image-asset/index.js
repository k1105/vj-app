/**
 * Image asset template — renders one image (chosen by `idx` from the `images`
 * URL array) into a grid of repeated cells with BPM-synced vibration.
 * Same parameter layout as the text-asset template.
 */

function easeExpOut(t) {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export default class ImageAsset {
  /** @param {import("../../src/output/PluginHost").PluginSetupContext} ctx */
  setup(ctx) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = ctx.width;
    this.canvas.height = ctx.height;
    // url → HTMLImageElement (loaded) | null (loading / error)
    this._cache = new Map();
    return this.canvas;
  }

  _getImage(url) {
    if (!url) return null;
    if (this._cache.has(url)) return this._cache.get(url) ?? null;
    // Mark as pending so we only kick off one load per URL.
    this._cache.set(url, null);
    const img = new Image();
    img.onload = () => { this._cache.set(url, img); };
    img.onerror = () => { /* leave null — won't retry */ };
    img.src = url;
    return null;
  }

  /** @param {import("../../src/output/PluginHost").PluginUpdateContext} ctx */
  update({ global, params }) {
    const canvas = this.canvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    const images = Array.isArray(params?.images) ? params.images : [];
    const idxRaw = Math.max(0, Math.round(Number(params?.idx) || 0));
    const url = images.length > 0 ? String(images[idxRaw % images.length] ?? "") : "";
    const img = this._getImage(url);

    const cols = Math.max(1, Math.min(16, Math.round(params?.grid ?? 4)));
    const rows = Math.max(1, Math.ceil((h / w) * cols));
    const scale = Math.max(0.1, Math.min(3, params?.scale ?? 1));
    const vibrateOn = params?.vibrate == null ? true : Boolean(params.vibrate);
    const bgColor = typeof params?.bgColor === "string" && /^#[0-9a-fA-F]{6}$/.test(params.bgColor)
      ? params.bgColor
      : "#000000";
    const bgOpacity = Math.max(0, Math.min(1, Number(params?.bgOpacity ?? 0)));

    const beat = global?.beat ?? 0;

    const centerCol = (cols - 1) / 2;
    const centerRow = (rows - 1) / 2;
    const maxDist = Math.sqrt(centerCol * centerCol + centerRow * centerRow) || 1;

    const cellW = w / cols;
    const cellH = h / rows;

    ctx.clearRect(0, 0, w, h);
    if (bgOpacity > 0) {
      const r = parseInt(bgColor.slice(1, 3), 16);
      const g = parseInt(bgColor.slice(3, 5), 16);
      const b = parseInt(bgColor.slice(5, 7), 16);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${bgOpacity})`;
      ctx.fillRect(0, 0, w, h);
    }

    if (!img) return; // still loading or no URL

    // Contain fit: scale image to show entirely within each cell.
    // `scale` param multiplies on top of the fitted size so the user can zoom in/out.
    const baseScale = Math.min(cellW / img.naturalWidth, cellH / img.naturalHeight);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cellIdx = row * cols + col;

        const dc = col - centerCol;
        const dr = row - centerRow;
        const dist = Math.sqrt(dc * dc + dr * dr) / maxDist;
        const delayedBeat = (beat + dist * 0.4) % 1;
        const wave = vibrateOn ? 1 - easeExpOut(delayedBeat) : 0;

        const vibX   = wave * 6 * Math.sin(cellIdx * 1.7);
        const vibY   = wave * 6 * Math.cos(cellIdx * 2.3);
        const vibRot = (wave * 4.5 * Math.sin(cellIdx * 0.9) * Math.PI) / 180;
        const vibScale = 1 + wave * 0.2;

        const cx = cellW * col + cellW / 2 + vibX;
        const cy = cellH * row + cellH / 2 + vibY;
        const drawW = img.naturalWidth  * baseScale * scale * vibScale;
        const drawH = img.naturalHeight * baseScale * scale * vibScale;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(vibRot);
        ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
        ctx.restore();
      }
    }
  }

  dispose() {
    this._cache = null;
    this.canvas = null;
  }
}
