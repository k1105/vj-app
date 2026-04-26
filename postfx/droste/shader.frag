// Droste — feedback-based rectangular recursion around (centerX, centerY).
// Outside the inner rectangle, show the live source (uTex). Inside the
// inner rectangle, sample the previous frame's output (uPrev) of this pass
// scaled outward — because uPrev already contains the previous nested view,
// each frame the recursion grows by one level, converging to "infinite".
//   centerX, centerY : recursion centre in normalised UVs (0..1)
//   zoom             : how much each loop shrinks the inner copy (>1)
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uPrev;
uniform vec2 uResolution;
uniform float u_centerX;
uniform float u_centerY;
uniform float u_zoom;

void main() {
  vec2 center = vec2(u_centerX, u_centerY);
  vec2 d = vUv - center;

  // Per-axis half-extent so off-centre placements still hit the screen edge
  // at |dN| = 1 along the L∞ axis.
  float halfX = d.x > 0.0 ? max(1.0 - center.x, 1e-4) : max(center.x, 1e-4);
  float halfY = d.y > 0.0 ? max(1.0 - center.y, 1e-4) : max(center.y, 1e-4);
  float scale = max(abs(d.x) / halfX, abs(d.y) / halfY);
  float zoom = max(0.05, u_zoom);

  if (scale < 1.0 / zoom) {
    // Inside the inner rectangle: sample feedback, scaled outward.
    vec2 uv = clamp(center + d * zoom, 0.0, 1.0);
    gl_FragColor = texture2D(uPrev, uv);
  } else {
    gl_FragColor = texture2D(uTex, vUv);
  }
}
