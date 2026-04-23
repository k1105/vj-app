// Mirror / tile fold.
// horizontal=1: fold left half onto right (symmetric left↔right).
// vertical=1:   fold top half onto bottom.
// tiles (0..1 → 1..4): repeat the folded image N times per axis.
// All three can be combined.
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBeat;
uniform float u_horizontal;
uniform float u_vertical;
uniform float u_tiles;

void main() {
  float n = 1.0 + floor(u_tiles * 3.0); // 1, 2, 3, or 4 tiles
  vec2 uv = fract(vUv * n); // tile first

  // horizontal mirror: fold right half back onto left
  if (u_horizontal > 0.5) {
    uv.x = uv.x < 0.5 ? uv.x * 2.0 : (1.0 - uv.x) * 2.0;
  }

  // vertical mirror: fold bottom half back onto top
  if (u_vertical > 0.5) {
    uv.y = uv.y < 0.5 ? uv.y * 2.0 : (1.0 - uv.y) * 2.0;
  }

  gl_FragColor = texture2D(uTex, uv);
}
