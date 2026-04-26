/**
 * Emoji Flow — random emojis spawn across the screen at a controllable rate.
 *
 * Performance: each unique emoji is pre-rendered once into an offscreen
 * canvas (sprite cache) and drawn per particle via drawImage, which is
 * dramatically cheaper than fillText for color-emoji glyphs.
 */

const MAX_EMOJIS = 50000;
const SPRITE_PX = 128; // bake size; particles scale with drawImage

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

export default class EmojiFlow {
  setup(ctx) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = ctx.width;
    this.canvas.height = ctx.height;
    this.particles = [];
    this.spawnAccum = 0;
    this.lastTime = performance.now();
    this.spriteCache = new Map(); // emoji string → HTMLCanvasElement
    return this.canvas;
  }

  getSprite(emoji) {
    let c = this.spriteCache.get(emoji);
    if (c) return c;
    c = document.createElement("canvas");
    c.width = SPRITE_PX;
    c.height = SPRITE_PX;
    const cx = c.getContext("2d");
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    cx.font = `${SPRITE_PX * 0.85}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    cx.fillText(emoji, SPRITE_PX / 2, SPRITE_PX / 2);
    this.spriteCache.set(emoji, c);
    return c;
  }

  update({ params }) {
    const canvas = this.canvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    const emojis =
      Array.isArray(params?.emojis) && params.emojis.length > 0
        ? params.emojis.filter((e) => typeof e === "string" && e.length > 0)
        : ["✨"];
    const flow = Math.max(0, Number(params?.flow ?? 2000));
    const birthRate = Math.max(0, Math.min(1, Number(params?.birthRate ?? 0.3)));
    const lifetime = Math.max(0.05, Number(params?.lifetime ?? 2));
    const sizeRatio = Math.max(0.005, Number(params?.size ?? 0.08));
    const sizeJitter = Math.max(0, Math.min(1, Number(params?.sizeJitter ?? 0.5)));

    this.spawnAccum += flow * dt;
    const trials = Math.floor(this.spawnAccum);
    this.spawnAccum -= trials;

    const minDim = Math.min(w, h);
    const baseSize = minDim * sizeRatio;

    for (let i = 0; i < trials; i++) {
      if (Math.random() >= birthRate) continue;
      if (this.particles.length >= MAX_EMOJIS) break;
      const jitter = 1 + (Math.random() * 2 - 1) * sizeJitter;
      this.particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        emoji: pick(emojis, Math.random),
        size: baseSize * Math.max(0.1, jitter),
        born: now,
        ttl: lifetime * 1000,
      });
    }

    ctx.clearRect(0, 0, w, h);

    const survivors = [];
    for (const p of this.particles) {
      const age = (now - p.born) / p.ttl;
      if (age >= 1) continue;

      const sprite = this.getSprite(p.emoji);
      const s = p.size;
      ctx.drawImage(sprite, p.x - s / 2, p.y - s / 2, s, s);

      survivors.push(p);
    }
    this.particles = survivors;
  }

  dispose() {
    if (this.spriteCache) {
      for (const c of this.spriteCache.values()) {
        c.width = 0;
        c.height = 0;
      }
      this.spriteCache.clear();
    }
    this.spriteCache = null;
    this.particles = null;
    this.canvas = null;
  }
}
