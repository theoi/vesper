/** Small DSP helpers shared by the live engine and the offline renders used to verify levels. */

export type Ctx = BaseAudioContext;

/** One key and tempo for every bed and stinger: D minor at 92 BPM. */
export const BPM = 92;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
/** 0 below `a`, 1 above `b`, linear in between. */
export const ramp = (x: number, a: number, b: number) => clamp((x - a) / (b - a), 0, 1);
/** Playback rate for a shift of `n` semitones. */
export const st = (n: number) => 2 ** (n / 12);
/** Cyclic index into a non-empty list. */
export const at = <T>(xs: readonly T[], i: number): T =>
  xs[((Math.floor(i) % xs.length) + xs.length) % xs.length] as T;

/** Deterministic PRNG (mulberry32). */
export function rng(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable pseudo-random value in [0, 1) for an integer, so parallel beds make the same choices. */
export const hash = (i: number) => {
  const x = Math.sin(i * 91.7 + 17.3) * 43758.5453;
  return x - Math.floor(x);
};

const noiseCache = new WeakMap<Ctx, Map<string, AudioBuffer>>();

/** A cached 4-second looping noise buffer. */
export function noise(ctx: Ctx, color: 'white' | 'pink' | 'brown' = 'white'): AudioBuffer {
  let byColor = noiseCache.get(ctx);
  if (!byColor) noiseCache.set(ctx, (byColor = new Map()));
  const hit = byColor.get(color);
  if (hit) return hit;
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const r = rng(color.length * 7919);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0,
    last = 0;
  for (let i = 0; i < len; i++) {
    const w = r() * 2 - 1;
    if (color === 'white') d[i] = w * 0.5;
    else if (color === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }
  byColor.set(color, buf);
  return buf;
}

/** A synthetic stereo reverb impulse response: decaying noise that darkens over time. */
export function impulse(
  ctx: Ctx,
  seconds: number,
  decay: number,
  o: { seed?: number; darkness?: number; predelay?: number } = {},
): AudioBuffer {
  const sr = ctx.sampleRate;
  const pre = Math.floor((o.predelay ?? 0.01) * sr);
  const len = Math.floor(seconds * sr) + pre;
  const buf = ctx.createBuffer(2, len, sr);
  const dark = o.darkness ?? 0.5;
  for (let ch = 0; ch < 2; ch++) {
    const r = rng((o.seed ?? 3) + ch * 101);
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const x = (i - pre) / (len - pre);
      const coeff = 0.98 - dark * 0.9 * x;
      lp = lp * (1 - coeff) + (r() * 2 - 1) * coeff;
      d[i] = lp * (1 - x) ** decay;
    }
  }
  return buf;
}

/** `input → convolver(ir) → wet gain → out`; returns the input to send into. */
export function reverb(ctx: Ctx, ir: AudioBuffer, out: AudioNode, wet = 1): GainNode {
  const input = ctx.createGain();
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  const g = ctx.createGain();
  g.gain.value = wet;
  input.connect(conv).connect(g).connect(out);
  return input;
}

/** Call `cb(i, time)` for each grid step (`perBeat` steps per beat from `origin`) in [from, to). */
export function steps(
  origin: number,
  perBeat: number,
  from: number,
  to: number,
  cb: (i: number, t: number) => void,
): void {
  const dt = BEAT / perBeat;
  let i = Math.max(0, Math.ceil((from - origin) / dt - 1e-9));
  for (;;) {
    const t = origin + i * dt;
    if (t >= to) break;
    if (t >= from - 1e-9) cb(i, t);
    i++;
  }
}

/**
 * Bus → glue compressor → limiter → soft ceiling. The compressors are not brickwall, so the
 * final waveshaper (linear below 0.6, knee up to 0.86) guarantees no sample passes about -1.3 dBFS.
 */
export function masterChain(ctx: Ctx): { input: GainNode; output: AudioNode } {
  const input = ctx.createGain();
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -18;
  glue.knee.value = 12;
  glue.ratio.value = 3;
  glue.attack.value = 0.01;
  glue.release.value = 0.3;
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -4;
  limit.knee.value = 0;
  limit.ratio.value = 20;
  limit.attack.value = 0.002;
  limit.release.value = 0.1;
  const ceiling = ctx.createWaveShaper();
  const n = 4096;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    curve[i] = Math.sign(x) * (a < 0.6 ? a : 0.6 + 0.3 * Math.tanh((a - 0.6) / 0.3));
  }
  ceiling.curve = curve;
  ceiling.oversample = 'none';
  input.connect(glue).connect(limit).connect(ceiling);
  return { input, output: ceiling };
}

export interface Loudness {
  rmsDb: number;
  peakDb: number;
  /** Fraction of 50 ms windows quieter than -60 dBFS. */
  silentFrac: number;
}

export function measure(buf: AudioBuffer): Loudness {
  const win = Math.floor(buf.sampleRate * 0.05);
  let sum = 0,
    peak = 0,
    silent = 0,
    windows = 0;
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  for (let start = 0; start + win <= buf.length; start += win) {
    let ws = 0;
    for (const d of chans) {
      for (let i = start; i < start + win; i++) {
        const x = d[i] ?? 0;
        ws += x * x;
        if (Math.abs(x) > peak) peak = Math.abs(x);
      }
    }
    sum += ws;
    windows++;
    if (Math.sqrt(ws / (win * chans.length)) < 0.001) silent++;
  }
  const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  const n = windows * win * chans.length;
  return {
    rmsDb: db(Math.sqrt(sum / Math.max(1, n))),
    peakDb: db(peak),
    silentFrac: silent / Math.max(1, windows),
  };
}
