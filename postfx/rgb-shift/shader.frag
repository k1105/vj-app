// RGB chromatic aberration. Offsets R and B in opposite directions along
// a unit vector derived from `angle` (0..1 → 0..2π). `amount` (0..1)
// controls the total displacement in UV space.
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uTime;
uniform float u_amount;
uniform float u_angle;

void main() {
  float a = u_angle * 6.2831853;
  vec2 dir = vec2(cos(a), sin(a));
  vec2 offset = dir * u_amount * 0.03;
  float r = texture2D(uTex, vUv + offset).r;
  float g = texture2D(uTex, vUv).g;
  float b = texture2D(uTex, vUv - offset).b;
  float alpha = texture2D(uTex, vUv).a;
  gl_FragColor = vec4(r, g, b, alpha);
}
