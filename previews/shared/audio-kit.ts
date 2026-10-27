/**
 * Small procedural-audio toolkit shared by the previews.
 *
 * A Score is pure scheduling code: every sound is placed at an explicit time on the
 * context clock, never at `ctx.currentTime`, so the same code runs live (driven by the
 * lookahead scheduler in AudioDirector) and offline (OfflineAudioContext renders used to
 * verify the score is not silent).
 */

export type Ctx = BaseAudioContext;

export interface Bed {
  /** Start continuous parts (drones, noise beds) at time `t`. */
  start(t: number): void;
  /** Schedule every discrete event whose time falls in [from, to). Called repeatedly, in order. */
  schedule(from: number, to: number): void;
  /** Stop continuous parts at `t`. The director has already faded the bed's output by then. */
  stop(t: number): void;
}

export interface ScoreInstance {
  /** Create a bed that writes only into `out`, including its reverb. */
  bed(name: string, out: AudioNode): Bed;
  /** Play a one-shot cue at time `t` into the instance output. */
  sting(name: string, t: number): void;
}

export interface Score {
  beds: readonly string[];
  stings: readonly string[];
  create(ctx: Ctx, out: AudioNode): ScoreInstance;
}

export const mtof = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

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

export type NoiseColor = 'white' | 'pink' | 'brown';
const noiseCache = new WeakMap<Ctx, Map<NoiseColor, AudioBuffer>>();

/** A cached 4-second looping noise buffer. */
export function noise(ctx: Ctx, color: NoiseColor = 'white'): AudioBuffer {
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

export interface ImpulseOptions {
  seed?: number;
  /** 0 = bright, 1 = very dark tail. */
  darkness?: number;
  predelay?: number;
}

/** A synthetic stereo reverb impulse response: decaying noise that darkens over time. */
export function impulse(ctx: Ctx, seconds: number, decay = 3, o: ImpulseOptions = {}): AudioBuffer {
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

/** Route `input → convolver(ir) → out` and return the input node to send into. */
export function reverb(ctx: Ctx, ir: AudioBuffer, out: AudioNode, wet = 1): GainNode {
  const input = ctx.createGain();
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  const g = ctx.createGain();
  g.gain.value = wet;
  input.connect(conv).connect(g).connect(out);
  return input;
}

export interface Env {
  a?: number;
  d?: number;
  s?: number;
  r?: number;
  peak?: number;
}

/** Attack/decay/sustain, then release at `t + dur`. Returns the time the sound is inaudible. */
export function adsr(p: AudioParam, t: number, dur: number, e: Env = {}): number {
  const a = e.a ?? 0.005,
    d = e.d ?? 0.1,
    s = e.s ?? 0.6,
    r = e.r ?? 0.2,
    peak = e.peak ?? 1;
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setTargetAtTime(peak * s, t + a, d / 3);
  const rel = t + Math.max(dur, a);
  p.setTargetAtTime(0, rel, r / 4);
  return rel + r * 1.5;
}

export interface VoiceOptions {
  t: number;
  freq: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  env?: Env;
  detune?: number;
  /** Exponential pitch glide to this frequency over `glideTime` (default: dur). */
  glideTo?: number;
  glideTime?: number;
  filter?: { type?: BiquadFilterType; freq: number; q?: number; envTo?: number; envTime?: number };
  pan?: number;
  vibrato?: { rate: number; cents: number };
}

/** One oscillator note with envelope, optional filter, glide, vibrato and pan. */
export function voice(ctx: Ctx, out: AudioNode, o: VoiceOptions): void {
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, o.t);
  if (o.glideTo)
    osc.frequency.exponentialRampToValueAtTime(o.glideTo, o.t + (o.glideTime ?? o.dur));
  if (o.detune) osc.detune.value = o.detune;
  let node: AudioNode = osc;
  if (o.vibrato) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = o.vibrato.rate;
    depth.gain.value = o.vibrato.cents;
    lfo.connect(depth).connect(osc.detune);
    lfo.start(o.t);
    lfo.stop(o.t + o.dur + (o.env?.r ?? 0.2) * 2 + 0.1);
  }
  if (o.filter) {
    const f = ctx.createBiquadFilter();
    f.type = o.filter.type ?? 'lowpass';
    f.frequency.setValueAtTime(o.filter.freq, o.t);
    if (o.filter.envTo)
      f.frequency.exponentialRampToValueAtTime(o.filter.envTo, o.t + (o.filter.envTime ?? o.dur));
    f.Q.value = o.filter.q ?? 0.7;
    node.connect(f);
    node = f;
  }
  const g = ctx.createGain();
  const end = adsr(g.gain, o.t, o.dur, { ...o.env, peak: (o.env?.peak ?? 1) * (o.gain ?? 0.2) });
  node.connect(g);
  if (o.pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = o.pan;
    g.connect(p).connect(out);
  } else g.connect(out);
  osc.start(o.t);
  osc.stop(end + 0.05);
}

export interface NoiseOptions {
  t: number;
  dur: number;
  gain?: number;
  color?: NoiseColor;
  type?: BiquadFilterType;
  freq?: number;
  q?: number;
  sweepTo?: number;
  env?: Env;
  pan?: number;
}

/** A filtered noise burst. */
export function noiseHit(ctx: Ctx, out: AudioNode, o: NoiseOptions): void {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx, o.color ?? 'white');
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.frequency.setValueAtTime(o.freq ?? 2000, o.t);
  if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, o.t + o.dur);
  f.Q.value = o.q ?? 1;
  const g = ctx.createGain();
  const end = adsr(g.gain, o.t, o.dur, {
    a: 0.002,
    d: o.dur,
    s: 0,
    r: 0.05,
    ...o.env,
    peak: (o.env?.peak ?? 1) * (o.gain ?? 0.3),
  });
  src.connect(f).connect(g);
  if (o.pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = o.pan;
    g.connect(p).connect(out);
  } else g.connect(out);
  src.start(o.t, (o.t * 1.37) % 3);
  src.stop(end + 0.05);
}

/** A looping noise source through a filter, for continuous beds. Call the returned stop(t). */
export function noiseBed(
  ctx: Ctx,
  out: AudioNode,
  t: number,
  o: { color?: NoiseColor; type?: BiquadFilterType; freq?: number; q?: number; gain?: number },
): { filter: BiquadFilterNode; gain: GainNode; stop(t: number): void } {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx, o.color ?? 'pink');
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = o.type ?? 'lowpass';
  filter.frequency.value = o.freq ?? 800;
  filter.Q.value = o.q ?? 0.7;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(o.gain ?? 0.1, t + 0.5);
  src.connect(filter).connect(gain).connect(out);
  src.start(t);
  return {
    filter,
    gain,
    stop(at) {
      src.stop(at);
    },
  };
}

/** Call `cb(i, time)` for each grid step (at `bpm`, `perBeat` steps per beat from `origin`) in [from, to). */
export function steps(
  origin: number,
  bpm: number,
  perBeat: number,
  from: number,
  to: number,
  cb: (i: number, t: number) => void,
): void {
  const dt = 60 / bpm / perBeat;
  let i = Math.max(0, Math.ceil((from - origin) / dt - 1e-9));
  for (;;) {
    const t = origin + i * dt;
    if (t >= to) break;
    if (t >= from - 1e-9) cb(i, t);
    i++;
  }
}

/** A WaveShaper from a transfer function over [-1, 1]. */
export function shaper(ctx: Ctx, fn: (x: number) => number, n = 4096): WaveShaperNode {
  const ws = ctx.createWaveShaper();
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = fn((i / (n - 1)) * 2 - 1);
  ws.curve = curve;
  ws.oversample = '2x';
  return ws;
}

export const softClip = (ctx: Ctx, drive = 2) =>
  shaper(ctx, (x) => Math.tanh(x * drive) / Math.tanh(drive));

/** Amplitude bit-crusher (staircase transfer). */
export const crush = (ctx: Ctx, levels = 16) =>
  shaper(ctx, (x) => Math.round(x * levels) / levels, 8192);

/** Bus → glue compressor → brickwall-ish limiter. Shared by live and offline rendering. */
function masterChain(ctx: Ctx): { input: GainNode; output: AudioNode } {
  const input = ctx.createGain();
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -16;
  glue.knee.value = 12;
  glue.ratio.value = 3;
  glue.attack.value = 0.01;
  glue.release.value = 0.3;
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -3;
  limit.knee.value = 0;
  limit.ratio.value = 20;
  limit.attack.value = 0.002;
  limit.release.value = 0.1;
  input.connect(glue).connect(limit);
  return { input, output: limit };
}

interface ActiveBed {
  name: string;
  bed: Bed;
  gain: GainNode;
  origin: number;
  scheduledTo: number;
  endAt: number | null;
}

const VOLUME_KEY = 'vesper.preview.volume';
const MUTE_KEY = 'vesper.preview.muted';

/** Live playback: owns the AudioContext, master chain, bed crossfades, ducking, volume. */
export class AudioDirector {
  ctx: AudioContext | null = null;
  private bus!: GainNode;
  private bedBus!: GainNode;
  private vol!: GainNode;
  private analyser!: AnalyserNode;
  private buf = new Float32Array(1024);
  private inst!: ScoreInstance;
  private active: ActiveBed[] = [];
  volume: number;
  muted: boolean;

  constructor(readonly score: Score) {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    this.volume = Number.isFinite(v) && localStorage.getItem(VOLUME_KEY) !== null ? v : 0.8;
    this.muted = localStorage.getItem(MUTE_KEY) === '1';
  }

  async begin(): Promise<void> {
    if (this.ctx) {
      await this.ctx.resume();
      return;
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const chain = masterChain(ctx);
    this.bus = chain.input;
    this.bedBus = ctx.createGain();
    this.bedBus.connect(this.bus);
    this.vol = ctx.createGain();
    chain.output.connect(this.vol).connect(ctx.destination);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    chain.output.connect(this.analyser);
    this.applyVolume(true);
    this.inst = this.score.create(ctx, this.bus);
    window.setInterval(() => this.tick(), 25);
    await ctx.resume();
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    // Background tabs throttle timers to ~1 Hz, so schedule further ahead there.
    const ahead = now + (document.hidden ? 1.5 : 0.25);
    this.active = this.active.filter((a) => {
      if (a.endAt !== null && now > a.endAt + 0.2) {
        a.gain.disconnect();
        return false;
      }
      return true;
    });
    for (const a of this.active) {
      const limit = a.endAt === null ? ahead : Math.min(ahead, a.endAt);
      if (limit > a.scheduledTo) {
        a.bed.schedule(a.scheduledTo, limit);
        a.scheduledTo = limit;
      }
    }
  }

  /** Crossfade to bed `name` (or to silence with null). */
  setBed(name: string | null, fade = 1.5, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const t = now + 0.03 + delay;
    const current = this.active.find((a) => a.endAt === null);
    if (current && current.name === name) return;
    for (const a of this.active) {
      if (a.endAt !== null) continue;
      const p = a.gain.gain;
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      p.setValueAtTime(p.value, t);
      p.linearRampToValueAtTime(0, t + fade);
      a.endAt = t + fade;
      a.bed.stop(t + fade + 0.05);
    }
    if (!name) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + Math.max(0.02, fade));
    g.connect(this.bedBus);
    const bed = this.inst.bed(name, g);
    bed.start(t);
    this.active.push({ name, bed, gain: g, origin: t, scheduledTo: t, endAt: null });
    this.tick();
  }

  sting(name: string, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.inst.sting(name, ctx.currentTime + 0.02 + delay);
  }

  /** Temporarily lower the beds (not the stings). */
  duck(to = 0.25, attack = 0.05, hold = 1.5, release = 2, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const p = this.bedBus.gain;
    const t = ctx.currentTime + delay;
    p.cancelScheduledValues(ctx.currentTime);
    p.setValueAtTime(p.value, ctx.currentTime);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(to, t + attack);
    p.setValueAtTime(to, t + attack + hold);
    p.linearRampToValueAtTime(1, t + attack + hold + release);
  }

  /** Name and seconds elapsed of the active bed, for syncing visuals to the music grid. */
  bedClock(): { name: string; t: number } | null {
    const ctx = this.ctx;
    const a = this.active.find((x) => x.endAt === null);
    if (!ctx || !a) return null;
    return { name: a.name, t: ctx.currentTime - a.origin };
  }

  /** Current output RMS (pre-volume, so visuals still react when muted). */
  level(): number {
    if (!this.ctx) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let s = 0;
    for (const x of this.buf) s += x * x;
    return Math.sqrt(s / this.buf.length);
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    localStorage.setItem(VOLUME_KEY, String(this.volume));
    this.applyVolume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    this.applyVolume();
  }

  private applyVolume(instant = false): void {
    if (!this.ctx) return;
    const target = this.muted ? 0 : this.volume * this.volume;
    if (instant) this.vol.gain.value = target;
    else this.vol.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
  }
}

export interface RenderJob {
  bed?: string;
  sting?: string;
  seconds: number;
  sampleRate?: number;
}

/** Render a bed and/or sting through the same master chain with an OfflineAudioContext. */
export async function renderOffline(score: Score, job: RenderJob): Promise<AudioBuffer> {
  const sr = job.sampleRate ?? 44100;
  const octx = new OfflineAudioContext(2, Math.ceil(job.seconds * sr), sr);
  const chain = masterChain(octx);
  chain.output.connect(octx.destination);
  const inst = score.create(octx, chain.input);
  if (job.bed) {
    const g = octx.createGain();
    g.connect(chain.input);
    const b = inst.bed(job.bed, g);
    b.start(0);
    for (let t = 0; t < job.seconds; t += 0.25) b.schedule(t, Math.min(job.seconds, t + 0.25));
    b.stop(job.seconds);
  }
  if (job.sting) inst.sting(job.sting, 0.05);
  return octx.startRendering();
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

/** 16-bit PCM WAV, base64-encoded. */
export function wavBase64(buf: AudioBuffer): string {
  const ch = buf.numberOfChannels,
    len = buf.length,
    sr = buf.sampleRate;
  const bytes = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o: number, s: string) =>
    [...s].forEach((c, i) => bytes.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  bytes.setUint32(4, 36 + len * ch * 2, true);
  str(8, 'WAVEfmt ');
  bytes.setUint32(16, 16, true);
  bytes.setUint16(20, 1, true);
  bytes.setUint16(22, ch, true);
  bytes.setUint32(24, sr, true);
  bytes.setUint32(28, sr * ch * 2, true);
  bytes.setUint16(32, ch * 2, true);
  bytes.setUint16(34, 16, true);
  str(36, 'data');
  bytes.setUint32(40, len * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (const d of data) {
      const x = Math.max(-1, Math.min(1, d[i] ?? 0));
      bytes.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
      o += 2;
    }
  }
  const u8 = new Uint8Array(bytes.buffer);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000)
    bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}
