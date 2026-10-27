/** The cloth: a WebGL backlit scrim whose lighting eases between named looks. */

const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

/** Backlit linen with drapes, creases, weave, a lamp hot-spot, fog, a glow, and the floor. */
const FRAG = /* glsl */ `
uniform float uLamp;
uniform vec3 uHot;
uniform float uCold;
uniform float uDawn;
uniform float uEmber;
uniform float uFlicker;
uniform vec3 uGlow;
uniform float uFloor;
uniform float uFog;
uniform float uFlash;

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
  base = mix(base, vec3(0.62, 0.5, 0.5), uDawn);
  base = mix(base, vec3(0.78, 0.27, 0.08), uEmber);
  vec3 core = mix(vec3(1.0, 0.9, 0.66), vec3(0.72, 0.84, 1.0), uCold);
  core = mix(core, vec3(0.96, 0.82, 0.74), uDawn);
  core = mix(core, vec3(1.0, 0.72, 0.4), uEmber);

  vec3 col = base * light + core * hot * hot * uLamp * fl * 0.5;
  col *= 1.0 + drape * drapeAmt + wr * 0.1 - crease * 0.07 - crease2 * 0.05;
  col *= 1.0 + weave * mix(0.09, 0.22, hot);

  vec2 gp = vec2(uGlow.x * a, uGlow.y);
  float g2 = dot(p - gp, p - gp);
  col += vec3(1.0, 0.6, 0.2) * uGlow.z * fl * (exp(-g2 / 0.0009) * 0.95 + exp(-g2 / 0.018) * 0.4) * (1.0 + weave * 0.2);

  if (uFog > 0.0) {
    float f = fbm(vec2(p.x * 1.4 - t * 0.06, p.y * 2.2 + t * 0.02)) * fbm(vec2(p.x * 0.7 + t * 0.03, p.y * 1.1 + 4.0));
    col = mix(col, base * (0.18 + 0.4 * uLamp) + vec3(0.04), clamp(f * 2.2 * uFog, 0.0, 0.85));
  }

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
  col += vec3(1.0, 0.95, 0.85) * uFlash;
  col += (hash(px + fract(t * 7.0) * 91.0) - 0.5) * 0.02;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

export interface Light {
  lamp: number;
  /** Hot spot centre (0..1, y from the bottom) and radius. */
  hx: number;
  hy: number;
  hr: number;
  cold: number;
  dawn: number;
  ember: number;
  flicker: number;
  /** A small warm glow (a lantern or a candle carried across the stage). */
  gx: number;
  gy: number;
  gz: number;
  fog: number;
  flash: number;
}

export type LightKey = keyof Light;

export const LOOKS = {
  dark: {
    lamp: 0.05,
    hx: 0.5,
    hy: 0.6,
    hr: 0.5,
    cold: 0,
    dawn: 0,
    ember: 0,
    flicker: 0.6,
    gz: 0,
    fog: 0,
  },
  lobby: {
    lamp: 0.82,
    hx: 0.5,
    hy: 0.62,
    hr: 0.5,
    cold: 0,
    dawn: 0,
    ember: 0,
    flicker: 0.5,
    gz: 0,
    fog: 0,
  },
  reveal: {
    lamp: 0.6,
    hx: 0.5,
    hy: 0.58,
    hr: 0.34,
    cold: 0,
    dawn: 0,
    ember: 0,
    flicker: 0.5,
    gz: 0,
    fog: 0,
  },
  day: {
    lamp: 1,
    hx: 0.5,
    hy: 0.62,
    hr: 0.55,
    cold: 0,
    dawn: 0,
    ember: 0,
    flicker: 0.45,
    gz: 0,
    fog: 0,
  },
  voting: {
    lamp: 1.02,
    hx: 0.5,
    hy: 0.6,
    hr: 0.46,
    cold: 0,
    dawn: 0,
    ember: 0.06,
    flicker: 0.6,
    gz: 0,
    fog: 0,
  },
  trial: {
    lamp: 0.92,
    hx: 0.5,
    hy: 0.55,
    hr: 0.3,
    cold: 0.05,
    dawn: 0,
    ember: 0.1,
    flicker: 0.4,
    gz: 0,
    fog: 0,
  },
  lastWords: {
    lamp: 0.75,
    hx: 0.5,
    hy: 0.55,
    hr: 0.25,
    cold: 0,
    dawn: 0,
    ember: 0.38,
    flicker: 0.7,
    gz: 0,
    fog: 0,
  },
  night: {
    lamp: 0.42,
    hx: 0.5,
    hy: 0.62,
    hr: 0.6,
    cold: 1,
    dawn: 0,
    ember: 0,
    flicker: 0.25,
    gz: 0,
    fog: 0.25,
  },
  nightDead: {
    lamp: 0.36,
    hx: 0.5,
    hy: 0.55,
    hr: 0.4,
    cold: 0.75,
    dawn: 0.25,
    ember: 0,
    flicker: 0.8,
    gz: 0,
    fog: 0.5,
  },
  nightSyndicate: {
    lamp: 0.4,
    hx: 0.5,
    hy: 0.6,
    hr: 0.5,
    cold: 0.7,
    dawn: 0,
    ember: 0.3,
    flicker: 0.3,
    gz: 0,
    fog: 0.2,
  },
  dawn: {
    lamp: 0.66,
    hx: 0.5,
    hy: 0.74,
    hr: 0.5,
    cold: 0.18,
    dawn: 1,
    ember: 0,
    flicker: 0.1,
    gz: 0,
    fog: 0.1,
  },
  town: {
    lamp: 0.9,
    hx: 0.5,
    hy: 0.72,
    hr: 0.62,
    cold: 0,
    dawn: 1,
    ember: 0,
    flicker: 0.05,
    gz: 0,
    fog: 0,
  },
  mafia: {
    lamp: 0.9,
    hx: 0.5,
    hy: 0.55,
    hr: 0.5,
    cold: 0,
    dawn: 0,
    ember: 1,
    flicker: 0.9,
    gz: 0,
    fog: 0.15,
  },
  cutthroat: {
    lamp: 0.32,
    hx: 0.5,
    hy: 0.55,
    hr: 0.22,
    cold: 0.6,
    dawn: 0,
    ember: 0.3,
    flicker: 0.6,
    gz: 0,
    fog: 0.3,
  },
  draw: {
    lamp: 0.22,
    hx: 0.5,
    hy: 0.6,
    hr: 0.4,
    cold: 0.2,
    dawn: 0,
    ember: 0.2,
    flicker: 1,
    gz: 0,
    fog: 0,
  },
} satisfies Record<string, Partial<Light>>;

export type Look = keyof typeof LOOKS;

interface Tween {
  from: number;
  to: number;
  t0: number;
  ms: number;
}

/**
 * The cloth canvas. `to()` eases any lighting value; `render()` draws a frame. When WebGL is
 * missing, the cloth falls back to a CSS gradient (the stage class `no-gl`).
 */
export class Cloth {
  readonly ok: boolean;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private locs = new Map<string, WebGLUniformLocation | null>();
  readonly value: Light = {
    ...LOOKS.dark,
    gx: 0.5,
    gy: 0.5,
    flash: 0,
  };
  private tweens = new Map<LightKey, Tween>();
  /** Reduced motion: the lamp holds steady and flashes are softened. */
  calm = false;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly floor: number,
  ) {
    this.ok = this.init();
  }

  private init(): boolean {
    const gl = this.canvas.getContext('webgl', {
      antialias: false,
      alpha: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
    if (!gl) return false;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(s) ?? 'shader compile failed');
        return null;
      }
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(
      gl.FRAGMENT_SHADER,
      'precision highp float;\nuniform vec2 uRes;\nuniform float uTime;\n' + FRAG,
    );
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) return false;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(prog) ?? 'shader link failed');
      return false;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.gl = gl;
    this.program = prog;
    return true;
  }

  private uni(name: string): WebGLUniformLocation | null {
    if (!this.locs.has(name)) {
      const loc = this.gl && this.program ? this.gl.getUniformLocation(this.program, name) : null;
      this.locs.set(name, loc);
    }
    return this.locs.get(name) ?? null;
  }

  /** Ease lighting values to new targets over `ms`. */
  to(target: Partial<Light>, ms: number): void {
    const now = performance.now();
    for (const [k, v] of Object.entries(target) as [LightKey, number][]) {
      if (ms <= 0) {
        this.value[k] = v;
        this.tweens.delete(k);
      } else this.tweens.set(k, { from: this.value[k], to: v, t0: now, ms });
    }
  }

  look(name: Look, ms: number, extra: Partial<Light> = {}): void {
    this.to({ ...LOOKS[name], ...extra }, ms);
  }

  /** A sudden flash that decays (a shot, a cut). */
  flash(amount: number, ms = 420): void {
    this.value.flash = amount;
    this.tweens.set('flash', { from: amount, to: 0, t0: performance.now(), ms });
  }

  private step(now: number): void {
    for (const [k, tw] of this.tweens) {
      const u = Math.min(1, (now - tw.t0) / tw.ms);
      const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      this.value[k] = tw.from + (tw.to - tw.from) * e;
      if (u >= 1) this.tweens.delete(k);
    }
  }

  render(now: number, scale: number): void {
    this.step(now);
    const gl = this.gl;
    if (!gl) return;
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25) * scale;
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const v = this.value;
    gl.viewport(0, 0, w, h);
    gl.uniform2f(this.uni('uRes'), w, h);
    gl.uniform1f(this.uni('uTime'), now / 1000);
    gl.uniform1f(this.uni('uLamp'), v.lamp);
    gl.uniform3f(this.uni('uHot'), v.hx, v.hy, v.hr);
    gl.uniform1f(this.uni('uCold'), v.cold);
    gl.uniform1f(this.uni('uDawn'), v.dawn);
    gl.uniform1f(this.uni('uEmber'), v.ember);
    gl.uniform1f(this.uni('uFlicker'), this.calm ? 0 : v.flicker);
    gl.uniform3f(this.uni('uGlow'), v.gx, v.gy, v.gz);
    gl.uniform1f(this.uni('uFloor'), this.floor);
    gl.uniform1f(this.uni('uFog'), v.fog);
    gl.uniform1f(this.uni('uFlash'), this.calm ? v.flash * 0.25 : v.flash);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.gl = null;
  }
}
