import type { Ctx } from './audio-kit.ts';

export interface PlayOptions {
  gain?: number;
  /** Playback rate (pitch shift); 2 = an octave up. */
  rate?: number;
  pan?: number;
  /** Start this many seconds into the file. */
  offset?: number;
  /** Play at most this long, then fade out over `release`. */
  dur?: number;
  attack?: number;
  release?: number;
  loop?: boolean;
  filter?: { type?: BiquadFilterType; freq: number; q?: number };
  /** Extra send (usually a reverb input) and its level. */
  send?: AudioNode;
  sendGain?: number;
}

export interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  /** Fade out from `t` over `release` seconds and stop. */
  stop(t: number, release?: number): void;
}

/**
 * Recorded samples for a score. Files are fetched and decoded once (after the click, via
 * Score.prepare) and the decoded buffers are shared by the live and offline contexts.
 */
export class SampleBank {
  private buffers = new Map<string, AudioBuffer>();
  private loading: Promise<void> | null = null;

  constructor(readonly urls: Readonly<Record<string, string>>) {}

  load(ctx: Ctx, onProgress?: (fraction: number) => void): Promise<void> {
    if (this.loading) return this.loading;
    const names = Object.keys(this.urls);
    let done = 0;
    this.loading = Promise.all(
      names.map(async (name) => {
        try {
          const res = await fetch(this.urls[name] ?? '');
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          this.buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch (err) {
          console.warn(`sample ${name} failed to load`, err);
        }
        onProgress?.(++done / Math.max(1, names.length));
      }),
    ).then(() => undefined);
    return this.loading;
  }

  get(name: string): AudioBuffer | undefined {
    return this.buffers.get(name);
  }

  duration(name: string): number {
    return this.buffers.get(name)?.duration ?? 0;
  }

  /** Schedule a sample at `t`. Returns null when the sample is missing. */
  play(ctx: Ctx, out: AudioNode, name: string, t: number, o: PlayOptions = {}): Voice | null {
    const buf = this.buffers.get(name);
    if (!buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = o.rate ?? 1;
    src.loop = o.loop ?? false;
    let node: AudioNode = src;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter.type ?? 'lowpass';
      f.frequency.value = o.filter.freq;
      f.Q.value = o.filter.q ?? 0.7;
      node = node.connect(f);
    }
    const gain = ctx.createGain();
    const peak = o.gain ?? 1;
    const attack = o.attack ?? 0.004;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    node.connect(gain);
    let tail: AudioNode = gain;
    if (o.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      tail = gain.connect(p);
    }
    tail.connect(out);
    if (o.send) {
      const s = ctx.createGain();
      s.gain.value = o.sendGain ?? 0.3;
      tail.connect(s).connect(o.send);
    }
    const offset = Math.min(o.offset ?? 0, Math.max(0, buf.duration - 0.01));
    src.start(t, offset);
    let stopped = false;
    const stop = (at: number, release = o.release ?? 0.08) => {
      if (stopped) return;
      stopped = true;
      gain.gain.setValueAtTime(peak, Math.max(t + attack, at));
      gain.gain.linearRampToValueAtTime(0, Math.max(t + attack, at) + release);
      src.stop(Math.max(t + attack, at) + release + 0.02);
    };
    if (o.dur !== undefined) stop(t + o.dur);
    return { src, gain, stop };
  }
}

/** Load images and wait until they are decoded, reporting progress. */
export async function loadImages(
  urls: readonly string[],
  onProgress?: (fraction: number) => void,
): Promise<void> {
  let done = 0;
  await Promise.all(
    urls.map(async (url) => {
      const img = new Image();
      img.src = url;
      try {
        await img.decode();
      } catch (err) {
        console.warn(`image ${url} failed to load`, err);
      }
      onProgress?.(++done / Math.max(1, urls.length));
      keep.push(img);
    }),
  );
}
// Decoded images stay referenced so the browser keeps them warm in its image cache.
const keep: HTMLImageElement[] = [];

/** Map `./dir/name.ext` glob keys to `name`. */
export function byName(glob: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, url] of Object.entries(glob)) {
    const base = path.split('/').pop() ?? path;
    out[base.replace(/\.[^.]+$/, '')] = url;
  }
  return out;
}

/** The subset of `map` named in `names` (missing names are reported, not thrown). */
export function pick(
  map: Record<string, string>,
  names: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) {
    const url = map[n];
    if (url) out[n] = url;
    else console.warn(`sample ${n} is not in the library`);
  }
  return out;
}
