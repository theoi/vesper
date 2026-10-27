/** The scrim: backlit linen with drapes, creases, weave, a lamp hot-spot and an apron. */
export const SCRIM_FRAG = /* glsl */ `
uniform float uLamp;
uniform vec3 uHot;
uniform float uCold;
uniform float uDawn;
uniform float uEmber;
uniform float uFlicker;
uniform vec3 uGlow;
uniform float uFloor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float a = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * a, uv.y);
  float t = uTime;
  float fl = 1.0 + uFlicker * ((vnoise(vec2(t * 6.0, 1.3)) - 0.5) * 0.55 + (vnoise(vec2(t * 21.0, 5.1)) - 0.5) * 0.3);

  // Cloth coordinate: 0 where it meets the floor, 1 at the batten it hangs from.
  float cy = clamp((uv.y - uFloor) / (1.0 - uFloor), 0.0, 1.0);
  float n1 = fbm(vec2(p.x * 1.6, cy * 0.7 + 3.0));
  float drape = sin(p.x * 7.0 + n1 * 4.0) * 0.6 + sin(p.x * 17.0 + n1 * 6.0 + cy * 2.0) * 0.4;
  float drapeAmt = mix(0.03, 0.12, smoothstep(0.3, 1.0, cy));
  float wr = fbm(p * vec2(4.0, 6.0) + 7.0) - 0.5;
  float crease = pow(1.0 - abs(sin((p.x * 0.7 - p.y * 1.3) * 5.0 + fbm(p * 2.3) * 5.0)), 24.0);
  float crease2 = pow(1.0 - abs(sin((p.x * 1.1 + p.y * 0.9) * 4.0 + fbm(p * 1.7 + 4.0) * 5.0)), 30.0);

  vec2 px = gl_FragCoord.xy;
  float warp = 0.5 + 0.5 * sin(px.x * 1.75 + vnoise(vec2(px.x * 0.02, px.y * 0.004)) * 3.0);
  float weft = 0.5 + 0.5 * sin(px.y * 1.75 + vnoise(vec2(px.x * 0.004, px.y * 0.02)) * 3.0);
  float slub = vnoise(vec2(px.x * 0.004, px.y * 0.4)) * vnoise(vec2(px.x * 0.4, px.y * 0.004));
  float weave = warp * weft - 0.25 + (slub - 0.25) * 0.5;

  vec2 hp = vec2(uHot.x * a, uHot.y);
  vec2 dv = (p - hp) * vec2(1.0, 1.25);
  float d2 = dot(dv, dv);
  float r2 = uHot.z * uHot.z;
  float hot = exp(-d2 / r2);
  float wide = exp(-d2 / (r2 * 7.0));
  float light = uLamp * fl * (0.09 + 0.52 * wide + 0.85 * hot);

  vec3 base = mix(vec3(0.86, 0.58, 0.3), vec3(0.25, 0.37, 0.58), uCold);
  base = mix(base, vec3(0.8, 0.76, 0.7), uDawn);
  base = mix(base, vec3(0.78, 0.27, 0.08), uEmber);
  vec3 core = mix(vec3(1.0, 0.9, 0.66), vec3(0.72, 0.84, 1.0), uCold);
  core = mix(core, vec3(1.0, 0.97, 0.92), uDawn);
  core = mix(core, vec3(1.0, 0.72, 0.4), uEmber);

  vec3 col = base * light + core * hot * hot * uLamp * fl * 0.5;
  col *= 1.0 + drape * drapeAmt + wr * 0.1 - crease * 0.07 - crease2 * 0.05;
  col *= 1.0 + weave * mix(0.09, 0.22, hot);

  vec2 gp = vec2(uGlow.x * a, uGlow.y);
  float g2 = dot(p - gp, p - gp);
  col += vec3(1.0, 0.6, 0.2) * uGlow.z * fl * (exp(-g2 / 0.0009) * 0.95 + exp(-g2 / 0.018) * 0.4) * (1.0 + weave * 0.2);

  col *= mix(0.3, 1.0, smoothstep(1.0, 0.87, uv.y));
  vec2 vv = (uv - vec2(0.5, 0.56)) * vec2(1.0, 1.1);
  col *= mix(0.1, 1.0, smoothstep(0.98, 0.22, length(vv)));

  if (uv.y < uFloor) {
    float fy = uv.y / uFloor;
    vec3 boards = vec3(0.04, 0.03, 0.024) * (0.55 + 0.45 * fy);
    boards *= 0.85 + 0.15 * smoothstep(0.0, 0.1, abs(fract(fy * 3.0 + 0.2) - 0.5));
    boards *= 0.9 + 0.2 * vnoise(vec2(px.x * 0.01, fy * 40.0));
    boards += base * uLamp * fl * 0.07 * pow(fy, 5.0);
    col = boards;
  }
  float seam = (uv.y - uFloor) * uRes.y / 3.0;
  col *= 1.0 - 0.55 * exp(-seam * seam);
  col += (hash(px + fract(t * 7.0) * 91.0) - 0.5) * 0.02;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;
