// Digital glitch: horizontal block shifts + RGB split.
// uBeat pulses the strength on every beat when beatReact > 0.
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBeat;
uniform float uBar;
uniform float uBpm;
uniform float u_intensity;
uniform float u_speed;
uniform float u_beatReact;

float rand(float seed) {
  return fract(sin(seed * 127.1 + 311.7) * 43758.5453);
}
float rand2(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  float t = floor(uTime * (1.0 + u_speed * 15.0));

  // Beat-reactive intensity boost: sharp attack, cubic decay within one beat
  float beatPulse = pow(1.0 - uBeat, 3.0) * u_beatReact;
  float strength = u_intensity + beatPulse * (1.0 - u_intensity);

  vec2 uv = vUv;

  // Horizontal block shifts: divide screen into ~20 bands, randomly displace some
  float bands = 20.0;
  float band = floor(vUv.y * bands);
  float shift = (rand(band + t * 0.3) - 0.5) * strength * 0.12;
  // Only shift bands that pass a threshold to keep most pixels clean
  if (rand(band + t * 0.7) < strength * 0.6) {
    uv.x = fract(uv.x + shift);
  }

  // Occasional full-row jump (1-2 thin scanlines)
  float scanY = rand(t * 0.5);
  float scanWidth = 0.005 + rand(t * 0.3) * 0.02;
  if (abs(vUv.y - scanY) < scanWidth * strength) {
    uv.x = fract(uv.x + (rand(t) - 0.5) * strength * 0.3);
  }

  // RGB chromatic split proportional to strength
  float rgbAmt = strength * 0.02;
  float r = texture2D(uTex, uv + vec2( rgbAmt, 0.0)).r;
  float g = texture2D(uTex, uv).g;
  float b = texture2D(uTex, uv + vec2(-rgbAmt, 0.0)).b;
  float a = texture2D(uTex, uv).a;

  gl_FragColor = vec4(r, g, b, a);
}
