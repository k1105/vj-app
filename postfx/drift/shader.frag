// Drift — slow virtual camera move on the live frame. The UV is rotated /
// scaled / translated by an amount that grows linearly with uTime, so the
// image appears to drift forever. No feedback or trails — just a moving
// camera over the current source.
//   zoomRate   : per-second zoom-in factor (linear, around centre)
//   panRateX/Y : per-second translation in normalised UV
//   rotateRate : per-second rotation in radians (around centre)
// Out-of-bounds UVs wrap with fract() so the image keeps tiling instead
// of clamping to an edge colour.
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uTime;
uniform float u_zoomRate;
uniform float u_panRateX;
uniform float u_panRateY;
uniform float u_rotateRate;

void main() {
  float t = uTime;
  float scale = max(0.05, 1.0 + u_zoomRate * t);
  float angle = u_rotateRate * t;
  vec2 pan   = vec2(u_panRateX, u_panRateY) * t;

  // Aspect-correct so rotation looks circular regardless of canvas shape.
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 d = vUv - 0.5;
  d.x *= aspect;
  float c = cos(-angle), s = sin(-angle);
  d = mat2(c, -s, s, c) * d;
  d /= scale;
  d.x /= aspect;

  vec2 uv = fract(d + 0.5 - pan);
  gl_FragColor = texture2D(uTex, uv);
}
