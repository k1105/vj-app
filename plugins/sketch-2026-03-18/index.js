/**
 * sketch-2026-03-18 — Trail Paths
 *
 * p5.js スケッチ (ymgsknt-walking-coding/public/sketches/2026-03-18/sketch.js) を
 * Canvas 2D API プラグインとして移植。
 *
 * 3本のベジェ閉曲線が HARD_LIGHT ブレンドで重なりながら巡回する。
 */

const VERTEX_NUM = 3;
const PATH_NUM = 3;

/** d3.easePolyInOut (exponent=3) */
function easePolyInOut(t, e = 3) {
  return ((t *= 2) <= 1 ? Math.pow(t, e) : 2 - Math.pow(2 - t, e)) / 2;
}

/** p5.js bezierPoint() 相当 — 3次ベジェ上の点 */
function bezierPoint(a, b, c, d, t) {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

/** 閉じたベジェパス上の位置を返す (t: 0-1) */
function getPointOnClosePath(closePath, t) {
  t = ((t % 1) + 1) % 1; // 0-1 に正規化
  const scaledT = t * VERTEX_NUM;
  const index = Math.floor(scaledT) % VERTEX_NUM;
  const seg = closePath[index];
  const localT = scaledT - Math.floor(scaledT);
  return {
    x: bezierPoint(seg[0], seg[2], seg[4], seg[6], localT),
    y: bezierPoint(seg[1], seg[3], seg[5], seg[7], localT),
  };
}

/** w×h をもとにランダムなベジェ閉曲線パスを生成 */
function buildPaths(w, h) {
  const paths = [];
  for (let i = 0; i < PATH_NUM; i++) {
    const points = [];
    for (let p = 0; p < VERTEX_NUM; p++) {
      points.push([Math.random() * w, Math.random() * h]);
    }
    const handles = [];
    for (let h_i = 0; h_i < VERTEX_NUM; h_i++) {
      const theta = Math.random() * Math.PI;
      const r = 100 + Math.random() * 100;
      handles.push([
        r * Math.cos(theta), r * Math.sin(theta),
        -r * Math.cos(theta), -r * Math.sin(theta),
      ]);
    }
    const path = [];
    for (let p_i = 0; p_i < VERTEX_NUM; p_i++) {
      const x  = points[p_i][0];
      const y  = points[p_i][1];
      const nx = points[(p_i + 1) % VERTEX_NUM][0];
      const ny = points[(p_i + 1) % VERTEX_NUM][1];
      path.push([
        x,  y,
        x  + handles[p_i][0],       y  + handles[p_i][1],
        nx + handles[(p_i + 1) % VERTEX_NUM][2], ny + handles[(p_i + 1) % VERTEX_NUM][3],
        nx, ny,
      ]);
    }
    paths.push(path);
  }
  return paths;
}

export default class TrailPaths20260318 {
  setup(ctx) {
    this.canvas = document.createElement("canvas");
    this.canvas.width  = ctx.width;
    this.canvas.height = ctx.height;
    this.frameCount = 0;
    this.trailPaths = buildPaths(ctx.width, ctx.height);
    return this.canvas;
  }

  update({ params }) {
    const canvas = this.canvas;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    const speed = params?.speed ?? 1.0;
    this.frameCount += speed;

    ctx2d.clearRect(0, 0, w, h);

    const range      = 0.3;
    const detailness = 50;

    ctx2d.strokeStyle = "rgb(0, 100, 255)";
    ctx2d.lineJoin    = "round";
    ctx2d.lineCap     = "square"; // p5.js PROJECT

    let k = 0;
    for (const closePath of this.trailPaths) {
      k++;
      const phase  = (this.frameCount + k * 20) / 100;
      const startT = easePolyInOut(phase % 1);
      const zigzag = 1 - Math.abs((phase % 2) - 1);
      ctx2d.lineWidth = 50 * (2 * easePolyInOut(zigzag) + 0.1);

      // HARD_LIGHT をパスごとに適用（直前の描画と重ねる）
      ctx2d.globalCompositeOperation = "hard-light";

      ctx2d.beginPath();
      for (let i = 0; i < detailness; i++) {
        const p = getPointOnClosePath(closePath, startT + (range / detailness) * i);
        if (i === 0) ctx2d.moveTo(p.x, p.y);
        else         ctx2d.lineTo(p.x, p.y);
      }
      ctx2d.stroke();
    }

    ctx2d.globalCompositeOperation = "source-over";
  }

  dispose() {
    this.canvas    = null;
    this.trailPaths = null;
  }
}
