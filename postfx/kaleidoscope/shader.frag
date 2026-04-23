// Kaleidoscope: folds the UV plane into N symmetric sectors around center.
// `segments` (0..1 → 2..16), `rotate` (0..1 → 0..2π).
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uTime;
uniform float u_segments;
uniform float u_rotate;

void main() {
  float segs = floor(mix(2.0, 16.0, u_segments));
  float rot = u_rotate * 6.2831853;

  vec2 p = vUv - 0.5;
  float r = length(p);
  float a = atan(p.y, p.x) + rot;

  float sector = 6.2831853 / segs;
  a = mod(a, sector);
  a = abs(a - sector * 0.5);

  vec2 uv = vec2(cos(a), sin(a)) * r + 0.5;
  gl_FragColor = texture2D(uTex, uv);
}
