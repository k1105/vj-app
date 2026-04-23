// Thermal (heat-map) filter. Remaps luminance to a cold→hot gradient
// (black → blue → magenta → red → yellow → white). `contrast` steepens
// the gradient around mid, `shift` cyclically rotates the palette
// (slides along the color ramp without changing overall brightness),
// `levels` posterizes the gradient (low = fewer bands, high = smooth),
// `intensity` blends between the original and the thermal look.
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBeat;
uniform float u_intensity;
uniform float u_contrast;
uniform float u_shift;
uniform float u_levels;

vec3 thermalRamp(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.0, 0.0, 0.0);
  vec3 c1 = vec3(0.0, 0.0, 0.5);
  vec3 c2 = vec3(0.5, 0.0, 0.8);
  vec3 c3 = vec3(1.0, 0.1, 0.2);
  vec3 c4 = vec3(1.0, 0.8, 0.0);
  vec3 c5 = vec3(1.0, 1.0, 1.0);
  if (t < 0.2)      return mix(c0, c1, t / 0.2);
  else if (t < 0.4) return mix(c1, c2, (t - 0.2) / 0.2);
  else if (t < 0.6) return mix(c2, c3, (t - 0.4) / 0.2);
  else if (t < 0.8) return mix(c3, c4, (t - 0.6) / 0.2);
  else              return mix(c4, c5, (t - 0.8) / 0.2);
}

void main() {
  vec4 base = texture2D(uTex, vUv);
  float lum = dot(base.rgb, vec3(0.299, 0.587, 0.114));

  float k = mix(0.5, 6.0, u_contrast);
  float t = 1.0 / (1.0 + exp(-k * (lum - 0.5)));

  // Posterize: levels=0 -> 3 bands, levels=1 -> smooth (32+)
  float steps = floor(mix(3.0, 32.0, clamp(u_levels, 0.0, 1.0)));
  t = floor(t * steps) / max(steps - 1.0, 1.0);

  // Cyclic palette shift: slide along the color ramp, wrap at the ends.
  t = fract(t + u_shift + 1.0);

  vec3 thermal = thermalRamp(t);
  vec3 outCol = mix(base.rgb, thermal, clamp(u_intensity, 0.0, 1.0));
  gl_FragColor = vec4(outCol, base.a);
}
