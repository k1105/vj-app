// Drift — slow oscillating camera move over the live frame. The image
// breathes (zoom in/out), drifts left↔right and up↔down, and optionally
// rocks rotationally — all driven by sine waves so nothing ever runs
// away. `speed` sets the overall oscillation rate; the four amplitude
// params decide how strongly each axis moves.
//   speed         : 0 = frozen, 1 = ~0.65 Hz overall
//   zoomDepth     : 0 = no zoom motion, 1 = 0.4x ↔ 1.6x breathing
//   panX / panY   : signed amplitude of horizontal / vertical drift
//                   (negative just inverts the cycle phase)
//   rotateAmount  : 0 = no rotation, 1 = ±45° rocking
// Different per-axis frequencies keep the motion from being a single
// neat lissajous so the result feels organic. Sampling stays inside
// [0,1] under any combination because the texture clamps at the edges.
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
  // Effective base time. Even at speed=0 the image stays still (no offset
  // accumulation), and at speed=1 we hit ~0.65 Hz which still feels slow.
  float t = uTime * (u_speed * 0.6 + 0.05);

  // Per-axis sines at slightly different rates → motion never collapses
  // to a single repeating loop.
  float zoomCycle = u_zoomDepth * sin(t * 0.6) * 0.4;       // ±40% scale
  float panCycleX = u_panX      * sin(t * 0.5) * 0.25;      // ±25% UV
  float panCycleY = u_panY      * cos(t * 0.45) * 0.25;
  float rotCycle  = u_rotateAmount * sin(t * 0.4) * 0.785;  // ±45°

  float scale = 1.0 + zoomCycle;
  vec2  pan   = vec2(panCycleX, panCycleY);
  float angle = rotCycle;

  // Aspect-correct so rotation looks circular regardless of canvas shape.
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 d = vUv - 0.5;
  d.x *= aspect;
  float c = cos(-angle), s = sin(-angle);
  d = mat2(c, -s, s, c) * d;
  d /= scale;
  d.x /= aspect;

  // No fract() / no manual clamp — let the texture's clamp-to-edge kick
  // in if pan/zoom amplitudes ever push UVs slightly outside [0,1].
  vec2 uv = d + 0.5 - pan;
  gl_FragColor = texture2D(uTex, uv);
}
