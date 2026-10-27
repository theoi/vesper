import { shaderLayer } from '../shared/gl.ts';
import { ease, type Ease, type Tweener } from '../shared/tween.ts';

const FRAG = /* glsl */ `
uniform float uInv;
uniform float uInvTo;
uniform float uWipe;
uniform float uWipeMode;
uniform vec3 uSun;
uniform float uSunRed;
uniform float uClip;
uniform float uTone;
uniform float uScreen;
uniform float uKick;

float h21(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}
float vn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x),
             mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vn(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}
float dots(vec2 px, float shade, float ang, float cell) {
  float c = cos(ang);
  float s = sin(ang);
  vec2 g = mat2(c, -s, s, c) * px / cell;
  vec2 f = fract(g) - 0.5;
  float r = sqrt(clamp(shade, 0.0, 1.0)) * 0.74;
  float aa = 1.1 / cell;
  return smoothstep(r + aa, r - aa, length(f));
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  float H = uRes.y;
  vec2 uv = fc / uRes;
  vec2 p = fc / H * 900.0;

  float swept;
  float edge;
  if (uWipeMode < 0.5) {
    vec2 v = fc / H;
    float a = atan(v.y, max(v.x, 1e-4));
    float thr = (1.0 - uWipe) * 1.64 - 0.04;
    swept = step(thr, a);
    edge = step(thr - 0.035, a) * (1.0 - swept);
  } else {
    float thr = uWipe * 1.1 - 0.05;
    swept = 1.0 - step(thr, uv.y);
    edge = step(thr, uv.y) * (1.0 - step(thr + 0.016, uv.y));
  }
  edge *= step(0.001, uWipe) * step(uWipe, 0.999);
  float inv = mix(uInv, uInvTo, swept);

  vec3 cream = vec3(0.937, 0.894, 0.812);
  vec3 red = vec3(0.843, 0.149, 0.118);
  vec3 paper = mix(cream, vec3(0.078, 0.074, 0.07), inv);
  vec3 key = mix(vec3(0.071, 0.067, 0.063), vec3(0.925, 0.88, 0.8), inv);
  vec3 grey = mix(vec3(0.55, 0.52, 0.47), vec3(0.3, 0.285, 0.27), inv);

  float blot = fbm(p * 0.004 + 3.0);
  float fib = vn(vec2(p.x * 0.5, p.y * 0.03) + 9.0) * vn(vec2(p.x * 0.04, p.y * 0.55));
  float grain = h21(floor(p) + floor(uTime * 12.0) * 7.31);
  vec3 col = paper;
  col *= 1.0 - (1.0 - inv) * (0.07 * (blot - 0.45) + 0.07 * smoothstep(0.5, 0.85, fib));
  col += inv * 0.035 * smoothstep(0.55, 0.9, fib);
  col += (grain - 0.5) * mix(0.045, 0.03, inv);

  float cell = H * 0.0105;
  float dens = 0.84 + 0.16 * smoothstep(0.25, 0.7, blot);
  float g = uv.x * 0.55 + (1.0 - uv.y) * 0.45;
  float toneAmt = dots(fc, uTone * smoothstep(0.5, 1.05, g), uScreen + 0.785, cell * 0.85);
  col = mix(col, grey, toneAmt * dens);

  vec2 c = vec2(uSun.x * uRes.x, (1.0 - uSun.y) * H);
  float R = max(uSun.z * H * (1.0 + uKick * 0.012), 1.0);
  vec2 mis = vec2(1.8, -1.2) * H / 900.0;
  float clipM = step((1.0 - uClip) * H, fc.y);
  vec2 q = (fc - c) / R;
  float r = length(q);
  float body = 1.0 - smoothstep(1.0 - 1.2 / R, 1.0 + 1.2 / R, r);
  float shadeIn = mix(1.0, 0.16, smoothstep(-0.25, 1.05, dot(q, vec2(0.62, -0.78))));
  float halo = 0.32 * exp(-max(r - 1.0, 0.0) * 4.5) * step(1.0, r);
  float sh = mix(halo, shadeIn, body);
  vec2 qr = (fc + mis - c) / R;
  float rr = length(qr);
  float bodyR = 1.0 - smoothstep(1.0 - 1.2 / R, 1.0 + 1.2 / R, rr);
  float shR = mix(0.32 * exp(-max(rr - 1.0, 0.0) * 4.5) * step(1.0, rr),
                  mix(1.0, 0.16, smoothstep(-0.25, 1.05, dot(qr, vec2(0.62, -0.78)))), bodyR);
  float redAmt = dots(fc + mis, shR, uScreen, cell) * uSunRed * clipM;
  float keyAmt = dots(fc, sh, uScreen + 0.52, cell) * (1.0 - uSunRed) * clipM;
  col = mix(col, key, keyAmt * dens);
  col = mix(col, red, redAmt * dens);
  col = mix(col, red, edge);

  col *= 1.0 - (1.0 - inv) * 0.1 * pow(length(uv - 0.5) * 1.35, 2.5);
  gl_FragColor = vec4(col, 1.0);
}
`;

export interface Backdrop {
  inv: number;
  invTo: number;
  wipe: number;
  wipeMode: number;
  sx: number;
  sy: number;
  sr: number;
  sred: number;
  clip: number;
  tone: number;
  screen: number;
}

const DEFAULTS: Backdrop = {
  inv: 0,
  invTo: 0,
  wipe: 0,
  wipeMode: 0,
  sx: 0.7,
  sy: 0.45,
  sr: 0.34,
  sred: 1,
  clip: 2,
  tone: 0.5,
  screen: 0.26,
};

const key = (k: keyof Backdrop) => `bg.${k}`;

/** Snap backdrop values (hard cut), the default way a scene establishes its look. */
export function bgSet(tw: Tweener, v: Partial<Backdrop>): void {
  for (const [k, val] of Object.entries(v)) tw.set(key(k as keyof Backdrop), val);
}

export function bgTo(
  tw: Tweener,
  v: Partial<Backdrop>,
  ms: number,
  e: Ease = ease.inOut,
  delay = 0,
): void {
  for (const [k, val] of Object.entries(v)) tw.to(key(k as keyof Backdrop), val, ms, e, delay);
}

export function createBackdrop(canvas: HTMLCanvasElement, tw: Tweener) {
  bgSet(tw, DEFAULTS);
  const layer = shaderLayer(canvas, FRAG, { scale: 0.75, maxDpr: 1.5 });
  const g = (k: keyof Backdrop) => tw.get(key(k), DEFAULTS[k]);
  return (timeSec: number, kick: number) => {
    layer.render(timeSec, {
      uInv: g('inv'),
      uInvTo: g('invTo'),
      uWipe: g('wipe'),
      uWipeMode: g('wipeMode'),
      uSun: [g('sx'), g('sy'), g('sr')],
      uSunRed: g('sred'),
      uClip: g('clip'),
      uTone: g('tone'),
      uScreen: g('screen'),
      uKick: kick,
    });
  };
}
