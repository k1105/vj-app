// Cheap film look: grain + scanlines + vignette. All parameters are 0-1.
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uTime;
uniform float u_grain;
uniform float u_scanlines;
uniform float u_vignette;

float rand(vec2 co) {
  return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec4 col = texture2D(uTex, vUv);

  // grain
  float n = rand(vUv + fract(uTime)) - 0.5;
  col.rgb += n * u_grain * 0.4;

  // scanlines: 2px line every 4px
  float s = sin(vUv.y * uResolution.y * 1.5);
  col.rgb *= 1.0 - u_scanlines * 0.4 * (0.5 + 0.5 * s);

  // vignette
  float d = distance(vUv, vec2(0.5));
  float v = smoothstep(0.8, 0.3, d);
  col.rgb *= mix(1.0, v, u_vignette);

  gl_FragColor = col;
}
