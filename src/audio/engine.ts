import type { AudioScene, CueName, CueOptions, EndVariant, GameAudio } from '../ui/contracts.ts';
import { bank, sceneSamples } from './bank.ts';
import { BED_LEVEL, FADES, makeBed, type Bed } from './beds.ts';
import { CUE_LEVEL, CUE_TAKES, DUCK, isMusical, playCue } from './cues.ts';
import { BEAT, clamp, impulse, masterChain, reverb, type Ctx } from './dsp.ts';
import { Band, Voices, type Outs } from './instruments.ts';

/** The mix shared by live playback and offline renders. */
export interface Graph {
  bedBus: GainNode;
  cueBus: GainNode;
  bedHall: AudioNode;
  bedRoom: AudioNode;
  cueHall: AudioNode;
  cueRoom: AudioNode;
  /** After the master chain, before the volume. */
  output: AudioNode;
}

export function buildGraph(ctx: Ctx): Graph {
  const chain = masterChain(ctx);
  const bedBus = ctx.createGain();
  const cueBus = ctx.createGain();
  bedBus.connect(chain.input);
  cueBus.connect(chain.input);
  const hall = impulse(ctx, 2.8, 2.4, { darkness: 0.55, seed: 21, predelay: 0.02 });
  const room = impulse(ctx, 1.1, 3, { darkness: 0.35, seed: 5, predelay: 0.006 });
  return {
    bedBus,
    cueBus,
    // Bed reverbs sit before the bed bus so ducking the beds also ducks their tails.
    bedHall: reverb(ctx, hall, bedBus, 0.9),
    bedRoom: reverb(ctx, room, bedBus, 0.7),
    cueHall: reverb(ctx, hall, cueBus, 0.9),
    cueRoom: reverb(ctx, room, cueBus, 0.7),
    output: chain.output,
  };
}

/** A bed's dry output and reverb sends, each behind a gain the crossfade moves together. */
export function bedOuts(ctx: Ctx, g: Graph): { outs: Outs; gains: GainNode[] } {
  const gains = [g.bedBus, g.bedHall, g.bedRoom].map((dest) => {
    const n = ctx.createGain();
    n.connect(dest);
    return n;
  });
  const [dry, hall, room] = gains as [GainNode, GainNode, GainNode];
  return { outs: { dry, hall, room }, gains };
}

/** Outputs for one cue: its gain and stereo position apply to the dry signal and the sends. */
export function cueOuts(ctx: Ctx, g: Graph, gain: number, pan: number): Outs {
  const dry = ctx.createGain();
  dry.gain.value = gain;
  if (pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    dry.connect(p).connect(g.cueBus);
  } else dry.connect(g.cueBus);
  const send = (dest: AudioNode) => {
    const n = ctx.createGain();
    n.gain.value = gain;
    n.connect(dest);
    return n;
  };
  return { dry, hall: send(g.cueHall), room: send(g.cueRoom) };
}

const BED_VOICES = 120;
const CUE_VOICES = 170;
const MUTED_KEY = 'vesper.muted';
const VOLUME_KEY = 'vesper.volume';

function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode, sandboxed frames); the setting just won't persist.
  }
}

function loadPrefs(): { muted: boolean; volume: number } {
  const v = readStore(VOLUME_KEY);
  const n = v === null ? NaN : Number(v);
  return {
    muted: readStore(MUTED_KEY) === '1',
    volume: Number.isFinite(n) ? clamp(n, 0, 1) : 0.8,
  };
}

interface Want {
  scene: AudioScene;
  end: EndVariant;
  won: boolean;
  key: string;
}

interface ActiveBed {
  bed: Bed;
  gains: GainNode[];
  scheduledTo: number;
  endAt: number | null;
}

type AudioContextCtor = typeof AudioContext;

function contextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export const audioSupported = () => contextCtor() !== null;

const isHidden = () => typeof document !== 'undefined' && document.hidden;

/** Live playback: context, master chain, lookahead scheduler, bed crossfades, cues and ducking. */
export class AudioEngine implements GameAudio {
  private ctx: AudioContext | null = null;
  private graph: Graph | null = null;
  private vol: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private buf = new Float32Array(1024);
  private readonly voices = new Voices();
  private beds: ActiveBed[] = [];
  private want: Want = { scene: 'silence', end: 'draw', won: false, key: 'silence' };
  private currentKey = 'silence';
  private origin = 0;
  private tensionTarget = 0;
  private tensionNow = 0;
  private lastTick = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private loading: Promise<void> = Promise.resolve();
  private lastCueAt = new Map<CueName, number>();
  private takes = new Map<CueName, number>();
  private seed = 0;
  private disposed = false;
  private _muted: boolean;
  private _volume: number;

  constructor() {
    const p = loadPrefs();
    this._muted = p.muted;
    this._volume = p.volume;
  }

  get started(): boolean {
    return this.ctx !== null;
  }
  get muted(): boolean {
    return this._muted;
  }
  get volume(): number {
    return this._volume;
  }

  async begin(): Promise<void> {
    if (this.disposed) return;
    if (!this.ctx) {
      const Ctor = contextCtor();
      if (!Ctor) return;
      let ctx: AudioContext;
      try {
        ctx = new Ctor({ latencyHint: 'interactive' });
      } catch (err) {
        console.warn('audio unavailable', err);
        return;
      }
      this.ctx = ctx;
      const graph = buildGraph(ctx);
      this.graph = graph;
      this.vol = ctx.createGain();
      graph.output.connect(this.vol).connect(ctx.destination);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      graph.output.connect(this.analyser);
      this.applyVolume(true);
      this.origin = ctx.currentTime + 0.1;
      this.lastTick = ctx.currentTime;
      bank.prioritize(sceneSamples(this.want.scene));
      this.loading = bank.load(ctx).catch((err: unknown) => console.warn('samples failed', err));
      this.timer = setInterval(this.tick, 25);
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.tick);
      this.applyScene();
    }
    // Not awaited: without a user gesture the promise stays pending until one arrives.
    this.ctx.resume().catch(() => {});
    await this.loading;
  }

  setScene(scene: AudioScene, opts: { end?: EndVariant; won?: boolean } = {}): void {
    const end = opts.end ?? 'draw';
    const won = !!opts.won;
    const key = scene === 'end' ? `end:${end}:${won ? 1 : 0}` : scene;
    this.want = { scene, end, won, key };
    this.applyScene();
  }

  setTension(x: number): void {
    if (Number.isFinite(x)) this.tensionTarget = clamp(x, 0, 1);
  }

  cue(name: CueName, opts: CueOptions = {}): void {
    const ctx = this.ctx;
    const graph = this.graph;
    const takes = CUE_TAKES[name];
    if (!ctx || !graph || !takes) return;
    const now = ctx.currentTime;
    const delay = Number.isFinite(opts.delay) ? clamp(opts.delay ?? 0, 0, 60) : 0;
    let t = now + 0.02 + delay;
    if (isMusical(name)) t = this.quantize(t);
    // The same cue landing twice in a few milliseconds is one event (and protects against bursts).
    const last = this.lastCueAt.get(name);
    if (last !== undefined && Math.abs(t - last) < 0.06) return;
    this.lastCueAt.set(name, t);
    const n = opts.variant ?? this.takes.get(name) ?? 0;
    this.takes.set(name, (opts.variant ?? n) + 1);
    const v = ((Math.floor(Number.isFinite(n) ? n : 0) % takes) + takes) % takes;
    const gain = Number.isFinite(opts.gain) ? clamp(opts.gain ?? 1, 0, 2) : 1;
    const pan = Number.isFinite(opts.pan) ? clamp(opts.pan ?? 0, -1, 1) : 0;
    this.voices.limit = CUE_VOICES;
    try {
      const outs = cueOuts(ctx, graph, gain * (CUE_LEVEL[name] ?? 1), pan);
      playCue(name, new Band(ctx, outs, this.voices, ++this.seed), t, v);
    } catch (err) {
      console.warn(`cue ${name} failed`, err);
    }
    this.voices.limit = BED_VOICES;
    const duck = DUCK[name];
    if (duck) this.duck(t, duck[0], duck[1]);
  }

  setMuted(muted: boolean): void {
    this._muted = !!muted;
    writeStore(MUTED_KEY, this._muted ? '1' : '0');
    this.applyVolume();
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this._volume = clamp(volume, 0, 1);
    writeStore(VOLUME_KEY, String(this._volume));
    this.applyVolume();
  }

  level(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let s = 0;
    for (const x of this.buf) s += x * x;
    return Math.sqrt(s / this.buf.length);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (typeof document !== 'undefined')
      document.removeEventListener('visibilitychange', this.tick);
    const ctx = this.ctx;
    this.ctx = null;
    this.graph = null;
    this.analyser = null;
    this.beds = [];
    ctx?.close().catch(() => {});
  }

  /** Voices in flight and the most seen at once, for the audio lab. */
  debug(resetPeak = false): {
    voices: number;
    peak: number;
    beds: number;
    scene: string;
    tension: number;
  } {
    if (resetPeak) this.voices.peak = this.voices.active;
    return {
      voices: this.voices.active,
      peak: this.voices.peak,
      beds: this.beds.length,
      scene: this.currentKey,
      tension: this.tensionNow,
    };
  }

  private tick = (): void => {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const dt = Math.max(0, now - this.lastTick);
    this.lastTick = now;
    this.tensionNow += (this.tensionTarget - this.tensionNow) * (1 - Math.exp(-dt / 0.8));
    // Background tabs throttle timers to about 1 Hz, so schedule further ahead there.
    const ahead = now + (isHidden() ? 2.2 : 0.3);
    this.beds = this.beds.filter((a) => {
      if (a.endAt !== null && now > a.endAt + 0.1) {
        a.bed.stop(now);
        a.gains.forEach((g) => g.disconnect());
        return false;
      }
      return true;
    });
    this.voices.limit = BED_VOICES;
    for (const a of this.beds) {
      const limit = a.endAt === null ? ahead : Math.min(ahead, a.endAt);
      if (limit <= a.scheduledTo) continue;
      try {
        a.bed.schedule(Math.max(a.scheduledTo, now), limit);
      } catch (err) {
        console.warn('bed failed', err);
      }
      a.scheduledTo = limit;
    }
  };

  private applyScene(): void {
    const ctx = this.ctx;
    const graph = this.graph;
    if (!ctx || !graph) return;
    const w = this.want;
    if (w.key === this.currentKey) return;
    this.currentKey = w.key;
    bank.prioritize(sceneSamples(w.scene));
    const now = ctx.currentTime;
    const t = now + 0.03;
    const fade = FADES[w.scene];
    for (const a of this.beds) if (a.endAt === null) this.fadeOut(a, now, t + fade);
    // Rapid scene changes: keep at most two beds fading, cut older ones short.
    const fading = this.beds.filter((a) => a.endAt !== null);
    fading.sort((x, y) => (x.endAt ?? 0) - (y.endAt ?? 0));
    for (const a of fading.slice(0, Math.max(0, fading.length - 2)))
      this.fadeOut(a, now, now + 0.06);
    if (w.scene === 'silence') return;
    const { outs, gains } = bedOuts(ctx, graph);
    for (const g of gains) {
      g.gain.setValueAtTime(0, now);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(BED_LEVEL[w.scene], t + fade);
    }
    const bed = makeBed(w.scene, ctx, outs, this.voices, {
      origin: this.origin,
      tension: () => this.tensionNow,
      end: w.end,
      won: w.won,
      seed: ++this.seed,
    });
    this.voices.limit = BED_VOICES;
    bed.start(t);
    this.beds.push({ bed, gains, scheduledTo: t, endAt: null });
    this.tick();
  }

  private fadeOut(a: ActiveBed, now: number, end: number): void {
    if (a.endAt !== null && a.endAt <= end) return;
    for (const g of a.gains) {
      const p = g.gain;
      const v = p.value;
      p.cancelScheduledValues(now);
      p.setValueAtTime(v, now);
      p.linearRampToValueAtTime(0, end);
    }
    a.endAt = end;
  }

  /** Next eighth note of the shared grid when a bed is playing (at most a third of a second). */
  private quantize(t: number): number {
    if (!this.beds.some((a) => a.endAt === null)) return t;
    const q = BEAT / 2;
    return this.origin + Math.ceil((t - this.origin - 1e-4) / q) * q;
  }

  private duck(t: number, to: number, hold: number): void {
    const ctx = this.ctx;
    const graph = this.graph;
    if (!ctx || !graph) return;
    const p = graph.bedBus.gain;
    const now = ctx.currentTime;
    const v = p.value;
    p.cancelScheduledValues(now);
    p.setValueAtTime(v, now);
    p.setValueAtTime(v, Math.max(now, t - 0.02));
    p.linearRampToValueAtTime(to, t + 0.05);
    p.setValueAtTime(to, t + 0.05 + hold);
    p.linearRampToValueAtTime(1, t + 0.05 + hold + 1.8);
  }

  private applyVolume(instant = false): void {
    const ctx = this.ctx;
    const vol = this.vol;
    if (!ctx || !vol) return;
    const target = this._muted ? 0 : this._volume * this._volume;
    if (instant) vol.gain.value = target;
    else vol.gain.setTargetAtTime(target, ctx.currentTime, 0.05);
  }
}

/** Used when Web Audio is missing: no sound, but mute and volume still persist. */
export class SilentAudio implements GameAudio {
  private _muted: boolean;
  private _volume: number;
  private _started = false;
  constructor() {
    const p = loadPrefs();
    this._muted = p.muted;
    this._volume = p.volume;
  }
  get started() {
    return this._started;
  }
  get muted() {
    return this._muted;
  }
  get volume() {
    return this._volume;
  }
  async begin() {
    this._started = true;
  }
  setScene() {}
  setTension() {}
  cue() {}
  setMuted(m: boolean) {
    this._muted = !!m;
    writeStore(MUTED_KEY, this._muted ? '1' : '0');
  }
  setVolume(v: number) {
    if (!Number.isFinite(v)) return;
    this._volume = clamp(v, 0, 1);
    writeStore(VOLUME_KEY, String(this._volume));
  }
  level() {
    return 0;
  }
  dispose() {}
}

export interface RenderJob {
  scene?: AudioScene;
  end?: EndVariant;
  won?: boolean;
  tension?: number;
  cue?: CueName;
  variant?: number;
  seconds: number;
  sampleRate?: number;
}

/** Render a bed and/or cue through the same graph with an OfflineAudioContext. */
export async function renderOffline(job: RenderJob): Promise<AudioBuffer> {
  const sr = job.sampleRate ?? 44100;
  const octx = new OfflineAudioContext(2, Math.ceil(job.seconds * sr), sr);
  await bank.load(octx);
  const graph = buildGraph(octx);
  graph.output.connect(octx.destination);
  const voices = new Voices();
  if (job.scene) {
    const { outs, gains } = bedOuts(octx, graph);
    for (const g of gains) g.gain.value = BED_LEVEL[job.scene];
    const bed = makeBed(job.scene, octx, outs, voices, {
      origin: 0,
      tension: () => job.tension ?? 0,
      end: job.end ?? 'draw',
      won: !!job.won,
      seed: 1,
    });
    bed.start(0);
    for (let t = 0; t < job.seconds; t += 0.25) bed.schedule(t, Math.min(job.seconds, t + 0.25));
    bed.stop(job.seconds);
  }
  if (job.cue) {
    const takes = CUE_TAKES[job.cue];
    const v = (((job.variant ?? 0) % takes) + takes) % takes;
    const outs = cueOuts(octx, graph, CUE_LEVEL[job.cue] ?? 1, 0);
    playCue(job.cue, new Band(octx, outs, voices, 7), 0.25, v);
  }
  return octx.startRendering();
}
