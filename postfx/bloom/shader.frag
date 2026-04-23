// Additive bloom: extracts bright areas above `threshold` and blurs them
// over a `radius` tap-box, then adds back to the base with `strength`.
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBeat;
uniform float u_threshold;
uniform float u_radius;
uniform float u_strength;

vec3 bright(vec2 uv) {
  vec3 c = texture2D(uTex, uv).rgb;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  return c * max(0.0, lum - u_threshold) / (1.0 - u_threshold + 0.001);
}

void main() {
  vec2 texel = 1.0 / uResolution;
  float r = u_radius * 6.0 + 1.0; // 1..7 texels
  vec2 step = texel * r;

  // 13-tap approximate Gaussian over ±2 in each axis
  vec3 bloom = vec3(0.0);
  float total = 0.0;
  for (int x = -2; x <= 2; x++) {
    for (int y = -2; y <= 2; y++) {
      float w = 1.0 / (1.0 + float(x*x + y*y));
      bloom += bright(vUv + vec2(float(x), float(y)) * step) * w;
      total += w;
    }
  }
  bloom /= total;

  vec4 base = texture2D(uTex, vUv);
  gl_FragColor = vec4(base.rgb + bloom * u_strength, base.a);
}
