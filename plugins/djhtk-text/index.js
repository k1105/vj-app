/**
 * djhtk-text — "DJ HTK" text grid with BPM-synced vibration.
 *
 * Beat 0 = sharp pulse, then exponential decay. Each cell gets a phase offset
 * based on its distance from the grid center, so the beat ripples outward.
 *
 * Ported from hatakanata-vj-nxpc/vj-interface/src/components/TextOverlay.tsx
 */

/** d3-ease easeExpOut: sharp attack, exponential tail */
function easeExpOut(t) {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export default class DJHTKText {
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

    const cols = Math.max(1, Math.min(16, Math.round(params?.grid ?? 4)));
    const rows = Math.max(1, Math.ceil((h / w) * cols));

    const beat = global?.beat ?? 0;

    const centerCol = (cols - 1) / 2;
    const centerRow = (rows - 1) / 2;
    const maxDist = Math.sqrt(centerCol * centerCol + centerRow * centerRow) || 1;

    const cellW = w / cols;
    const cellH = h / rows;

    // Fit "DJ HTK" inside the cell. measureText is accurate but needs a ctx
    // font set first — use a heuristic cap then refine per-draw.
    const baseFontSize = Math.min(cellH * 0.45, cellW * 0.22);

    // Clear to black (transparent layers will show through)
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, w, h);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col;

        // Distance from grid center → phase offset so beat ripples outward
        const dc = col - centerCol;
        const dr = row - centerRow;
        const dist = Math.sqrt(dc * dc + dr * dr) / maxDist;
        const delayedBeat = (beat + dist * 0.4) % 1;
        const wave = 1 - easeExpOut(delayedBeat);

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
        ctx.fillText("DJ HTK", 0, 0);
        ctx.restore();
      }
    }
  }

  dispose() {
    this.canvas = null;
  }
}
