// Thermal (heat-map) filter. Remaps luminance to a cold→hot gradient
// (black → blue → magenta → red → yellow → white). `contrast` steepens
// the gradient around mid, `shift` cyclically rotates the palette
// (slides along the color ramp without changing overall brightness),
// `levels` posterizes the gradient (low = fewer bands, high = smooth),
// `grain` adds gritty hash noise + brushed-metal streaks,
// `sheen` adds a specular highlight on bright regions for a metallic look,
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
uniform float u_grain;
uniform float u_sheen;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

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

  // grain: animated hash + static grain + brushed-metal streaks
  vec2 px = vUv * uResolution;
  float gAnim   = hash21(px + fract(uTime * 60.0)) - 0.5;
  float gStatic = hash21(floor(px)) - 0.5;
  float streak  = hash21(vec2(floor(px.x * 0.35), px.y)) - 0.5;
  float grain   = (mix(gStatic, gAnim, 0.6) * 0.18 + streak * 0.10) * u_grain;

  // perturb luminance so noise affects palette mapping (textured feel)
  float lumN = clamp(lum + grain, 0.0, 1.0);

  float k = mix(0.5, 6.0, u_contrast);
  float t = 1.0 / (1.0 + exp(-k * (lumN - 0.5)));

  // Posterize: levels=0 -> 3 bands, levels=1 -> smooth (32+)
  float steps = floor(mix(3.0, 32.0, clamp(u_levels, 0.0, 1.0)));
  t = floor(t * steps) / max(steps - 1.0, 1.0);

  // Cyclic palette shift: slide along the color ramp, wrap at the ends.
  t = fract(t + u_shift + 1.0);

  vec3 thermal = thermalRamp(t);

  // Specular sheen: tight highlight on bright regions for metallic look
  float spec = pow(smoothstep(0.55, 1.0, lumN), 5.0) * u_sheen;
  thermal += vec3(spec * 0.7);

  // Final grain pass on the color itself (gritty surface)
  thermal += grain * 0.25;

  vec3 outCol = mix(base.rgb, thermal, clamp(u_intensity, 0.0, 1.0));
  gl_FragColor = vec4(outCol, base.a);
}
