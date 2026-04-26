// Tiles — repeats the input image in an N×N grid.
//   count   : tiles per axis (1..8)
//   mirrorH : when on, mirror each tile horizontally about its centre
//   mirrorV : when on, mirror each tile vertically about its centre
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBeat;
uniform float u_count;
uniform float u_mirrorH;
uniform float u_mirrorV;

void main() {
  float n = max(1.0, floor(u_count + 0.5));
  vec2 uv = fract(vUv * n);

  if (u_mirrorH > 0.5) {
    uv.x = uv.x < 0.5 ? uv.x * 2.0 : (1.0 - uv.x) * 2.0;
  }
  if (u_mirrorV > 0.5) {
    uv.y = uv.y < 0.5 ? uv.y * 2.0 : (1.0 - uv.y) * 2.0;
  }

  gl_FragColor = texture2D(uTex, uv);
}
