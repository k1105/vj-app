// Drift — slow oscillating camera move that always stays inside the
// asset frame. Zoom only ever zooms IN (scale ≥ 1), so the image never
// shrinks and the edges never come into view. Pan / rotation each
// require some zoom headroom; we compute the minimum scale they imply
// and use it as the floor on top of which `zoomDepth` adds a breathing
// pulse. Net result: with any combination of params the sampled UV
// stays in [0,1] and you don't see beyond the asset edges.
//   speed         : 0 = frozen, 1 = ~0.65 Hz overall
//   zoomDepth     : 0 = static (at the floor scale), 1 = +60% breathing
//   panX / panY   : signed amplitude of horizontal / vertical drift
//   rotateAmount  : 0 = no rotation, 1 = ±45° rocking
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uTime;
uniform float u_speed;
uniform float u_zoomDepth;
uniform float u_panX;
uniform float u_panY;
uniform float u_rotateAmount;

void main() {
  float t = uTime * (u_speed * 0.6 + 0.05);

  // Worst-case (peak) rotation amount and pan amplitude. We use these
  // to derive the minimum scale that keeps the sampled rotated/panned
  // window inside [0,1] at all times.
  float maxAngle = u_rotateAmount * 0.785;            // ±45°
  float rotMin   = cos(maxAngle) + abs(sin(maxAngle)); // 1.0 → ~1.414
  float panAmp   = max(abs(u_panX), abs(u_panY)) * 0.25;
  // scale ≥ rotMin / (1 − 2·panAmp) keeps the rotated AABB inside the
  // [0,1] frame even at peak pan offset. panAmp is capped at 0.25 by the
  // 0.25 envelope above (panX,panY ∈ [−1,1]) so the divisor stays > 0.
  float minScale = rotMin / max(0.001, 1.0 - 2.0 * panAmp);

  // Zoom oscillates UPWARD from the floor. zoomDepth=0 → static at the
  // floor; zoomDepth=1 → adds a 0..0.6 sine pulse on top.
  float zoomCycle = u_zoomDepth * (0.5 + 0.5 * sin(t * 0.6)) * 0.6;
  float scale     = minScale + zoomCycle;

  // Current rotation / pan (sine-driven, per-axis offset frequencies so
  // the motion doesn't collapse to a single repeating loop).
  float angle = u_rotateAmount * sin(t * 0.4) * 0.785;
  vec2  pan   = vec2(u_panX * sin(t * 0.5), u_panY * cos(t * 0.45)) * 0.25;

  // Aspect-correct rotation so circles stay circular.
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 d = vUv - 0.5;
  d.x *= aspect;
  float c = cos(-angle), s = sin(-angle);
  d = mat2(c, -s, s, c) * d;
  d /= scale;
  d.x /= aspect;

  vec2 uv = d + 0.5 - pan;
  gl_FragColor = texture2D(uTex, uv);
}
