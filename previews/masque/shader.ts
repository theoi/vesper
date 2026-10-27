/** The dream piazza: sky, arcade, tower, floor, velvet proscenium, spotlight, grain. */
export const PIAZZA_FRAG = /* glsl */ `
uniform float uDay;
uniform float uGround;
uniform float uDawn;
uniform float uCurtain;
uniform float uDim;
uniform vec3 uSpot;
uniform float uRed;
uniform float uFlash;
uniform float uLevel;
uniform vec2 uSun;
uniform vec2 uMouse;
uniform float uShadow;

const float H = 0.43;
const float VX = 0.12;
const float PI = 3.14159265;

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

vec3 velvet(vec2 uv, float q, float edgeDist, float side) {
  float wob = vnoise(vec2(q * 3.0, uv.y * 2.0 + side * 7.0)) * 0.9;
  float ph = q * 9.0 * 2.0 * PI + wob + uv.y * 0.6;
  float f = 0.5 + 0.5 * sin(ph);
  vec3 dark = vec3(0.12, 0.012, 0.03);
  vec3 mid = vec3(0.42, 0.05, 0.09);
  vec3 c = mix(dark, mid, pow(f, 1.4));
  c += vec3(0.55, 0.16, 0.2) * pow(f, 14.0) * 0.5;
  c *= 0.75 + 0.25 * smoothstep(0.0, 0.35, uv.y);
  float trim = smoothstep(0.012, 0.004, edgeDist) * smoothstep(0.0, 0.002, edgeDist) * (1.0 - 0.85 * smoothstep(0.7, 1.0, uCurtain));
  c = mix(c, vec3(0.86, 0.68, 0.33) * (0.7 + 0.3 * f), trim);
  return c;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float a = uRes.x / uRes.y;
  vec2 m = (uMouse - 0.5) * vec2(0.012, 0.006);
  vec2 p = vec2((uv.x - 0.5) * a, uv.y) + m;
  float day = uDay;
  float t = uTime;

  // --- sky -------------------------------------------------------------------
  float sy = clamp((p.y - H) / (1.0 - H), 0.0, 1.0);
  vec3 zen = mix(vec3(0.015, 0.025, 0.075), vec3(0.15, 0.34, 0.34), day);
  vec3 hor = mix(vec3(0.09, 0.11, 0.24), vec3(0.88, 0.86, 0.64), day);
  zen = mix(zen, vec3(0.27, 0.2, 0.36), uDawn * 0.85);
  hor = mix(hor, vec3(0.99, 0.6, 0.47), uDawn);
  vec3 col = mix(hor, zen, pow(sy, 0.55));

  vec2 sp = p - uSun;
  float sd = length(sp);
  vec3 sunCol = mix(vec3(0.96, 0.93, 0.82), vec3(1.0, 0.97, 0.86), day);
  float glow = exp(-sd * mix(9.0, 5.0, day));
  col += sunCol * glow * mix(0.18, 0.28, day);
  float disc = smoothstep(0.052, 0.048, sd);
  float crescent = mix(smoothstep(0.05, 0.046, length(sp - vec2(0.022, 0.012))), 0.0, day);
  col = mix(col, sunCol, disc * (1.0 - crescent * 0.92));

  float stars = 0.0;
  vec2 g = floor(p * 170.0);
  float hs = hash(g);
  if (hs > 0.993) {
    vec2 c = (g + 0.5 + (vec2(hash(g + 3.1), hash(g + 7.7)) - 0.5) * 0.6) / 170.0;
    stars = smoothstep(0.0035, 0.0, length(p - c)) * (0.55 + 0.45 * sin(t * (1.0 + hs * 3.0) + hs * 50.0));
  }
  col += vec3(0.95, 0.92, 1.0) * stars * (1.0 - day) * smoothstep(0.05, 0.3, sy) * (1.0 + uLevel * 4.0);

  vec2 cp = vec2(p.x * 1.4 + t * 0.008, sy * 3.2);
  float cn = fbm(cp + vec2(0.0, fbm(cp * 0.7 + t * 0.004)));
  float band = smoothstep(0.08, 0.35, sy) * smoothstep(1.0, 0.55, sy);
  float cloud = smoothstep(0.52, 0.72, cn) * band;
  float under = smoothstep(0.52, 0.85, fbm(cp + vec2(0.0, 0.08)));
  vec3 cloudCol = mix(vec3(0.14, 0.16, 0.3), vec3(1.0, 0.985, 0.95), day);
  cloudCol = mix(cloudCol, vec3(1.0, 0.75, 0.68), uDawn * 0.7);
  cloudCol *= 0.82 + 0.18 * under;
  col = mix(col, cloudCol, cloud * 0.9 * (1.0 - disc));

  // --- distant wall and tower ----------------------------------------------
  float wallTop = H + 0.035 + 0.006 * step(0.5, fract(p.x * 9.0));
  float inWall = step(H - 0.001, p.y) * step(p.y, wallTop) * step(0.05, p.x);
  vec3 wallCol = mix(vec3(0.05, 0.06, 0.08), vec3(0.42, 0.45, 0.36), uGround);
  col = mix(col, wallCol, inWall);

  float tx = 0.62 * a * 0.5 + 0.12;
  float tw = 0.045;
  float towerTop = H + 0.33;
  float crown = step(towerTop, p.y) * step(p.y, towerTop + 0.03) * step(0.5, fract((p.x - tx) * 70.0));
  float inTower = step(abs(p.x - tx), tw) * step(H, p.y) * (step(p.y, towerTop) + crown);
  float cyl = clamp((p.x - tx) / tw, -1.0, 1.0);
  vec3 towerCol = mix(vec3(0.62, 0.27, 0.18), vec3(0.85, 0.48, 0.3), 0.5 - 0.5 * cyl);
  towerCol = mix(vec3(0.04, 0.035, 0.05), towerCol, uGround);
  float ring = smoothstep(0.004, 0.0, abs(p.y - towerTop + 0.06)) * 0.5;
  col = mix(col, towerCol * (1.0 - ring), clamp(inTower, 0.0, 1.0));
  float flag = step(abs(p.x - tx), 0.002) * step(towerTop + 0.03, p.y) * step(p.y, towerTop + 0.09);
  float pennant = step(tx, p.x) * step(p.x, tx + 0.04 + 0.006 * sin(t * 3.0 + p.x * 80.0)) * step(abs(p.y - (towerTop + 0.08) - 0.004 * sin(t * 3.0 + p.x * 90.0)), 0.007 * (1.0 - (p.x - tx) / 0.05));
  col = mix(col, mix(vec3(0.05), vec3(0.15, 0.1, 0.08), uGround), flag);
  col = mix(col, mix(vec3(0.15, 0.02, 0.04), vec3(0.75, 0.12, 0.12), uGround), pennant);

  // --- floor ----------------------------------------------------------------
  float lx = -a * 0.5;
  if (p.y < H) {
    float d = 0.22 / max(H - p.y, 0.001);
    float fx = (p.x - VX) * d;
    vec3 near = vec3(0.56, 0.34, 0.19);
    vec3 far = vec3(0.86, 0.66, 0.42);
    vec3 fc = mix(near, far, smoothstep(0.0, H, p.y));
    fc = mix(fc, vec3(0.97, 0.66, 0.5), uDawn * 0.35);
    float tile = smoothstep(0.02, 0.0, abs(fract(fx * 0.8) - 0.5) - 0.48) + smoothstep(0.03, 0.0, abs(fract(d * 0.9) - 0.5) - 0.47);
    fc *= 1.0 - tile * 0.05 * smoothstep(0.0, 0.2, p.y);
    fc *= 0.94 + 0.12 * fbm(vec2(fx * 0.6, d * 0.8));

    // The arcade's shadow, with light falling through the arches.
    float sl = uShadow;
    float wallFx = (lx - VX) * (0.22 / 0.42);
    float rel = (fx - wallFx) / sl;
    float shadow = smoothstep(1.02, 0.98, rel);
    float bay = fract(d * 1.6 + 0.35);
    float hole = smoothstep(0.24, 0.3, bay) * smoothstep(0.76, 0.7, bay) * smoothstep(0.1, 0.18, rel) * smoothstep(0.86, 0.78, rel);
    shadow *= 1.0 - hole;
    // A long figure's shadow from somewhere outside the frame.
    vec2 s0 = vec2(0.95, -0.05), s1 = vec2(0.18, H - 0.07);
    vec2 pa = p - s0, ba = s1 - s0;
    float hh = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    float w = mix(0.035, 0.006, hh);
    float fig = smoothstep(w, w * 0.6, length(pa - ba * hh));
    fig = max(fig, smoothstep(0.012, 0.008, length(p - (s1 + ba * 0.03))));
    float sh = max(shadow, fig * 0.8);
    vec3 shadeCol = fc * vec3(0.32, 0.27, 0.36);
    fc = mix(fc, shadeCol, sh * uGround);

    vec3 nightFloor = vec3(0.025, 0.03, 0.06) + vec3(0.04, 0.035, 0.05) * smoothstep(0.0, H, p.y);
    float pools = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      vec2 lp = vec2(-0.55 + fi * 0.22, 0.24 + fi * 0.05);
      pools += exp(-length((p - lp) * vec2(1.0, 3.2)) * 9.0);
    }
    nightFloor += vec3(1.0, 0.72, 0.38) * pools * 0.35;
    col = mix(nightFloor, fc, uGround);
  }

  // --- arcade facade ----------------------------------------------------------
  float s = (VX - p.x) / (VX - lx);
  if (s > 0.5 && s < 1.2) {
    float base = H - s * 0.42;
    float top = H + s * 0.46;
    if (p.y > base && p.y < top) {
      float hy = (p.y - base) / s;
      float z = 1.0 / s;
      float u = fract(z * 1.6 + 0.35);
      float wx = (u - 0.5) * 0.625;
      float arch = step(abs(wx), 0.17) * (step(hy, 0.38) + step(length(vec2(wx, hy - 0.38)), 0.17));
      arch = clamp(arch, 0.0, 1.0);
      float win = step(abs(wx), 0.05) * step(0.66, hy) * step(hy, 0.8);
      float cornice = smoothstep(0.005, 0.0, abs(hy - 0.6)) + step(0.84, hy);
      vec3 wall = mix(vec3(0.82, 0.52, 0.36), vec3(0.93, 0.68, 0.5), smoothstep(0.0, 0.9, hy));
      wall *= 0.92 + 0.1 * fbm(vec2(z * 2.0, hy * 3.0));
      wall = mix(wall, vec3(0.98, 0.7, 0.58), uDawn * 0.3);
      vec3 nightWall = vec3(0.035, 0.03, 0.05);
      vec3 fc2 = mix(nightWall, wall, uGround);
      fc2 *= 1.0 - cornice * 0.25;
      vec3 inside = mix(vec3(0.03, 0.02, 0.035), vec3(0.3, 0.16, 0.13), smoothstep(0.42, 0.0, hy) * uGround);
      inside += vec3(1.0, 0.7, 0.35) * (1.0 - uGround) * 0.25 * smoothstep(0.35, 0.0, hy);
      fc2 = mix(fc2, inside, arch);
      vec3 lit = mix(vec3(0.05, 0.05, 0.07), vec3(1.0, 0.78, 0.42), 1.0 - uGround);
      fc2 = mix(fc2, lit, win * (0.4 + 0.6 * step(0.35, hash(vec2(floor(z * 1.6 + 0.35), 3.0)))));
      col = fc2;
    }
  }

  // --- spotlight and dimming -------------------------------------------------
  vec2 sc = vec2((uSpot.x - 0.5) * a, uSpot.y);
  float spot = smoothstep(uSpot.z, uSpot.z * 0.35, length((p - sc) * vec2(1.0, 1.25)));
  float beam = smoothstep(uSpot.z * 0.9, uSpot.z * 0.2, abs(p.x - sc.x) - (1.0 - p.y) * 0.05) * step(sc.y - 0.1, p.y) * 0.35;
  float lit = max(spot, beam);
  vec3 spotTint = mix(vec3(1.0, 0.95, 0.85), vec3(1.0, 0.25, 0.22), uRed);
  col = mix(col, col * 0.13, uDim * (1.0 - lit));
  col *= mix(vec3(1.0), spotTint, lit * uDim);

  // --- velvet proscenium --------------------------------------------------------
  float yN = uv.y;
  float eOpen = 0.085 + 0.07 * smoothstep(0.36, 1.0, yN) + 0.035 * smoothstep(0.36, 0.0, yN);
  float e = mix(eOpen, 0.505, uCurtain);
  float ex = min(uv.x, 1.0 - uv.x);
  if (ex < e) {
    float q = ex / e;
    col = velvet(uv, q, e - ex, step(0.5, uv.x));
    col *= 1.0 - 0.5 * smoothstep(0.3, 0.0, q) * (1.0 - uCurtain);
  } else {
    col *= 1.0 - 0.35 * smoothstep(0.05, 0.0, ex - e);
  }
  float scallop = 0.03 * abs(sin(uv.x * PI * 6.0));
  float valance = 0.915 + scallop * 0.0 - scallop;
  if (uv.y > valance + 0.03) {
    float q = fract(uv.x * 14.0);
    col = velvet(vec2(uv.x, uv.y), q * 0.4, uv.y - valance - 0.03, 2.0) * 0.9;
    col = mix(col, vec3(0.86, 0.68, 0.33), smoothstep(0.006, 0.0, abs(uv.y - valance - 0.036)));
  }
  col += vec3(1.0, 0.65, 0.35) * 0.11 * exp(-uv.y * 9.0) * (1.0 - uCurtain * 0.3);

  // --- gold dust, flash, grain, vignette --------------------------------------
  vec2 gp = p * 16.0 + vec2(sin(t * 0.1) * 0.5, -t * 0.25);
  vec2 gc = floor(gp);
  float gh = hash(gc);
  if (gh > 0.94) {
    vec2 o = vec2(hash(gc + 1.3), hash(gc + 4.1)) * 0.6 + 0.2;
    float tw2 = 0.5 + 0.5 * sin(t * 2.0 + gh * 40.0);
    col += vec3(1.0, 0.8, 0.45) * smoothstep(0.06, 0.0, length(fract(gp) - o)) * tw2 * 0.5 * (0.4 + uDim * 0.4 + uCurtain * 0.5);
  }
  col += vec3(1.0, 0.86, 0.6) * uFlash;
  float vig = length((uv - 0.5) * vec2(1.0, 1.15));
  col *= 1.0 - 0.45 * pow(vig * 1.25, 2.6);
  col += (hash(gl_FragCoord.xy + fract(t * 7.0) * 91.0) - 0.5) * 0.04;
  gl_FragColor = vec4(col, 1.0);
}
`;
