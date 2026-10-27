const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

export type Uniforms = Record<string, number | readonly number[]>;

export interface ShaderLayer {
  ok: boolean;
  canvas: HTMLCanvasElement;
  render(timeSec: number, uniforms?: Uniforms): void;
}

export interface ShaderOptions {
  /** Resolution multiplier on top of the capped device pixel ratio. */
  scale?: number;
  maxDpr?: number;
  alpha?: boolean;
}

/**
 * A fullscreen fragment-shader layer. The fragment source gets `uRes` (pixels) and
 * `uTime` (seconds) declared for it, plus any uniforms passed to `render` (float/vec2-4).
 */
export function shaderLayer(
  canvas: HTMLCanvasElement,
  frag: string,
  opts: ShaderOptions = {},
): ShaderLayer {
  const gl = canvas.getContext('webgl', {
    antialias: false,
    alpha: opts.alpha ?? false,
    premultipliedAlpha: false,
    powerPreference: 'high-performance',
  });
  const dead: ShaderLayer = { ok: false, canvas, render() {} };
  if (!gl) return dead;

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
  const header = 'precision highp float;\nuniform vec2 uRes;\nuniform float uTime;\n';
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, header + frag);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) return dead;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(prog) ?? 'shader link failed');
    return dead;
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const locs = new Map<string, WebGLUniformLocation | null>();
  const uni = (name: string) => {
    if (!locs.has(name)) locs.set(name, gl.getUniformLocation(prog, name));
    return locs.get(name) ?? null;
  };

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr ?? 1.5) * (opts.scale ?? 1);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };

  return {
    ok: true,
    canvas,
    render(timeSec, uniforms = {}) {
      resize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uni('uRes'), canvas.width, canvas.height);
      gl.uniform1f(uni('uTime'), timeSec);
      for (const [name, v] of Object.entries(uniforms)) {
        const l = uni(name);
        if (!l) continue;
        if (typeof v === 'number') gl.uniform1f(l, v);
        else if (v.length === 2) gl.uniform2f(l, v[0] ?? 0, v[1] ?? 0);
        else if (v.length === 3) gl.uniform3f(l, v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
        else if (v.length === 4) gl.uniform4f(l, v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
