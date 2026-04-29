/**
 * Text asset template — renders one text (chosen by `idx` from the `texts`
 * array) into a grid of repeated cells with BPM-synced vibration.
 *
 * Shared implementation; every `plugins/text-*` manifest points its `entry`
 * here via a relative `..` path. See templates/text-asset/manifest.params.json
 * for the canonical param schema used by the main-process generator.
 */

function easeExpOut(t) {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export default class TextAsset {
  /** @param {import("../../src/output/PluginHost").PluginSetupContext} ctx */
  setup(ctx) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = ctx.width;
    this.canvas.height = ctx.height;
    return this.canvas;
  }

  /** @param {import("../../src/output/PluginHost").PluginUpdateContext} ctx */
  update({ global, params }) {
    const canvas = this.canvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    const texts = Array.isArray(params?.texts) ? params.texts : [];
    const idxRaw = Math.max(0, Math.round(Number(params?.idx) || 0));
    const text = texts.length > 0 ? String(texts[idxRaw % texts.length] ?? "") : "";

    const cols = Math.max(1, Math.min(16, Math.round(params?.grid ?? 4)));
    const rows = Math.max(1, Math.ceil((h / w) * cols));
    const scale = Math.max(0.1, Math.min(3, params?.scale ?? 1));
    const vibrateOn = params?.vibrate == null ? true : Boolean(params.vibrate);
    const bgColor = typeof params?.bgColor === "string" && /^#[0-9a-fA-F]{6}$/.test(params.bgColor)
      ? params.bgColor
      : "#000000";
    const bgOpacity = Math.max(0, Math.min(1, Number(params?.bgOpacity ?? 1)));

    const beat = global?.beat ?? 0;

    const centerCol = (cols - 1) / 2;
    const centerRow = (rows - 1) / 2;
    const maxDist = Math.sqrt(centerCol * centerCol + centerRow * centerRow) || 1;

    const cellW = w / cols;
    const cellH = h / rows;

    const baseFontSize = Math.min(cellH * 0.45, cellW * 0.22) * scale;

    ctx.clearRect(0, 0, w, h);
    if (bgOpacity > 0) {
      const r = parseInt(bgColor.slice(1, 3), 16);
      const g = parseInt(bgColor.slice(3, 5), 16);
      const b = parseInt(bgColor.slice(5, 7), 16);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${bgOpacity})`;
      ctx.fillRect(0, 0, w, h);
    }

    if (!text) return;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col;

        const dc = col - centerCol;
        const dr = row - centerRow;
        const dist = Math.sqrt(dc * dc + dr * dr) / maxDist;
        const delayedBeat = (beat + dist * 0.4) % 1;
        const wave = vibrateOn ? 1 - easeExpOut(delayedBeat) : 0;

        const vibX = wave * 6 * Math.sin(idx * 1.7);
        const vibY = wave * 6 * Math.cos(idx * 2.3);
        const vibRot = (wave * 4.5 * Math.sin(idx * 0.9) * Math.PI) / 180;
        const vibScale = 1 + wave * 0.2;

        const cx = cellW * col + cellW / 2 + vibX;
        const cy = cellH * row + cellH / 2 + vibY;
        const fontSize = baseFontSize * vibScale;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(vibRot);
        ctx.font = `900 ${fontSize}px "Inter", "Helvetica Neue", Arial, sans-serif`;
        ctx.fillText(text, 0, 0);
        ctx.restore();
      }
    }
  }

  dispose() {
    this.canvas = null;
  }
}
