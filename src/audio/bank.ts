import type { AudioScene } from '../ui/contracts.ts';
import type { Ctx } from './dsp.ts';

/** Pitched sample tables: [file name, MIDI note it sounds at]. */
export const PIANO: readonly (readonly [string, number])[] = [
  ['piano-C2', 36],
  ['piano-Ds2', 39],
  ['piano-Fs2', 42],
  ['piano-A2', 45],
  ['piano-C3', 48],
  ['piano-Ds3', 51],
  ['piano-Fs3', 54],
  ['piano-A3', 57],
  ['piano-C4', 60],
  ['piano-Ds4', 63],
  ['piano-Fs4', 66],
  ['piano-A4', 69],
  ['piano-C5', 72],
  ['piano-Ds5', 75],
  ['piano-Fs5', 78],
  ['piano-A5', 81],
];
export const CELLO: readonly (readonly [string, number])[] = [
  ['cello-sus-C2', 36],
  ['cello-sus-G2', 43],
  ['cello-sus-D3', 50],
  ['cello-sus-A3', 57],
  ['cello-sus-E4', 64],
];
export const VIOLIN: readonly (readonly [string, number])[] = [
  ['violin-sus-E4', 64],
  ['violin-sus-A4', 69],
  ['violin-sus-C5', 72],
  ['violin-sus-E5', 76],
  ['violin-sus-A5', 81],
  ['violin-sus-C6', 84],
];
export const GLASS: readonly (readonly [string, number])[] = [
  ['glass-rub-Fs5', 78],
  ['glass-rub-A5', 81],
  ['glass-rub-As5', 82],
  ['glass-rub-Fs6', 90],
];

/** Sustained sung notes: MIDI pitch and the steady part of each recording (seconds). */
export const SINGERS = [
  { name: 'choir-sus-F3', midi: 53, s0: 0.35, s1: 5.2 },
  { name: 'choir-sus-As3', midi: 58, s0: 0.25, s1: 3.8 },
  { name: 'choir-sus-E4', midi: 64, s0: 0.6, s1: 3.9 },
  { name: 'choir-sus-Fs4', midi: 66, s0: 0.2, s1: 3.1 },
  { name: 'choir-sus-G4', midi: 67, s0: 0.3, s1: 2.85 },
  { name: 'choir-sus-A4', midi: 69, s0: 0.45, s1: 3.35 },
] as const;

/** Hummed voices with their pitch and steady part, for long drones made of grains. */
export const HUMS = {
  group: { name: 'hum-group-01', midi: 53, s0: 0.4, s1: 7 },
  low: { name: 'hum-03', midi: 50.8, s0: 0.3, s1: 3.9 },
  high: { name: 'hum-01', midi: 65.4, s0: 0.3, s1: 3.8 },
} as const;

const names = (t: readonly (readonly [string, number])[]) => t.map((x) => x[0]);

const PERCUSSION = [
  'stomp-01',
  'stomp-02',
  'stomp-03',
  'stomp-04',
  'clap-02',
  'clap-03',
  'clap-04',
  'snap-01',
  'snap-02',
  'slap-01',
  'slap-02',
  'slap-03',
  'chest-slap-01',
  'chest-slap-02',
];
const SMALL = [
  'knock-01',
  'knock-02',
  'knock-03',
  'knock-04',
  'knock-05',
  'whisper-06',
  'whisper-04',
  'shh-01',
  'breath-01',
  'breath-02',
  'paper-rustle-02',
  'candle-blow-01',
  'candle-blow-02',
  'match-strike-01',
  'match-strike-02',
  'match-strike-03',
  'footstep-01',
  'footstep-02',
  'footstep-03',
  'footstep-04',
  'footstep-05',
  'chair-creak-01',
  'chair-creak-03',
  'gasp-01',
  'gasp-02',
  'gasp-03',
];
const SUNG = SINGERS.map((s) => s.name);
const HUMMED = [HUMS.group.name, HUMS.low.name, HUMS.high.name, 'hum-02'];
const NIGHT = [
  'whisper-01',
  'whisper-02',
  'whisper-03',
  'whisper-05',
  'breath-03',
  'breath-04',
  'breath-06',
  'candle-flame-loop-01',
  ...names(GLASS),
];

/** Samples each scene needs, used to move them to the front of the download queue. */
const SCENE_SAMPLES: Record<AudioScene, readonly string[]> = {
  silence: [],
  lobby: [...HUMMED, 'candle-flame-loop-01', 'footstep-01', 'footstep-03', 'chair-creak-03'],
  day: [...PERCUSSION, ...SUNG, 'hum-01', 'murmur-loop-01'],
  voting: [...PERCUSSION, ...SUNG, 'hum-01', 'murmur-loop-01'],
  trial: [...PERCUSSION, ...SUNG, ...names(CELLO), ...names(VIOLIN), 'whisper-crowd-loop-01'],
  night: [...HUMMED, ...NIGHT, ...names(PIANO), ...SUNG],
  nightSyndicate: [...HUMMED, ...NIGHT, ...names(CELLO), 'whisper-crowd-loop-01'],
  nightDead: [...HUMMED, ...NIGHT, 'knock-01', 'knock-03', 'knock-04'],
  dawn: [...SUNG, ...names(VIOLIN), 'dawn-birds-loop-01', 'hum-01'],
  end: [...SUNG, ...HUMMED, ...names(CELLO), ...names(VIOLIN), 'choir-phrase-06'],
};

const REST = [
  ...names(PIANO),
  ...names(CELLO),
  ...names(VIOLIN),
  'choir-phrase-02',
  'choir-phrase-06',
  'church-bell-01',
  'church-bell-02',
  'handbell-01',
  'handbell-03',
  'glass-clink-01',
  'applause-slow-01',
  'letter-unfold-01',
  'sigh-01',
  'sigh-02',
  'sigh-03',
  'gasp-crowd-01',
  'shh-group-01',
  'door-creak-02',
  'footsteps-walk-01',
  'whisper-crowd-loop-01',
  'dawn-birds-loop-01',
];

/** Every sample the score uses, in download order: small cue sounds and the lobby first. */
export const SAMPLE_ORDER: readonly string[] = [
  ...new Set([
    ...SMALL,
    ...SCENE_SAMPLES.lobby,
    ...SCENE_SAMPLES.day,
    ...SCENE_SAMPLES.night,
    ...SCENE_SAMPLES.trial,
    ...SCENE_SAMPLES.nightDead,
    ...SCENE_SAMPLES.dawn,
    ...REST,
  ]),
];

export const sceneSamples = (scene: AudioScene) => SCENE_SAMPLES[scene];

const URLS: Record<string, string> = {};
for (const [path, url] of Object.entries(
  import.meta.glob('./samples/*.mp3', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>,
)) {
  const base = path.split('/').pop() ?? path;
  URLS[base.replace(/\.mp3$/, '')] = url;
}

const PARALLEL = 6;

/**
 * Recorded samples, fetched and decoded once and shared by the live and offline contexts.
 * The library is not normalised, so each sample also gets a gain that brings its peak to 1.
 */
class SampleBank {
  private buffers = new Map<string, AudioBuffer>();
  private norms = new Map<string, number>();
  private reversedBufs = new Map<string, AudioBuffer>();
  private queue: string[];
  private loading: Promise<void> | null = null;

  constructor(order: readonly string[]) {
    this.queue = order.filter((n) => {
      if (URLS[n]) return true;
      console.warn(`sample ${n} is not in the library`);
      return false;
    });
  }

  /** Fetch and decode every sample (once). Resolves when all are done or failed. */
  load(ctx: Ctx): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = new Promise<void>((resolve) => {
      let running = 0;
      const next = () => {
        if (this.queue.length === 0 && running === 0) {
          resolve();
          return;
        }
        while (running < PARALLEL && this.queue.length > 0) {
          const name = this.queue.shift() as string;
          running++;
          void this.fetchOne(ctx, name).finally(() => {
            running--;
            next();
          });
        }
      };
      next();
    });
    return this.loading;
  }

  /** Move these samples to the front of the download queue. */
  prioritize(names: readonly string[]): void {
    const want = new Set(names);
    this.queue = [
      ...this.queue.filter((n) => want.has(n)),
      ...this.queue.filter((n) => !want.has(n)),
    ];
  }

  private async fetchOne(ctx: Ctx, name: string): Promise<void> {
    try {
      const res = await fetch(URLS[name] ?? '');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      let p = 0;
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < d.length; i += 2) p = Math.max(p, Math.abs(d[i] ?? 0));
      }
      this.norms.set(name, p > 0 ? Math.min(12, 1 / p) : 1);
      this.buffers.set(name, buf);
    } catch (err) {
      console.warn(`sample ${name} failed to load`, err);
    }
  }

  get(name: string): AudioBuffer | undefined {
    return this.buffers.get(name);
  }

  /** The sample played backwards (built on first use). */
  reversed(name: string): AudioBuffer | undefined {
    const hit = this.reversedBufs.get(name);
    if (hit) return hit;
    const src = this.buffers.get(name);
    if (!src) return undefined;
    const buf = new AudioBuffer({
      length: src.length,
      numberOfChannels: src.numberOfChannels,
      sampleRate: src.sampleRate,
    });
    for (let c = 0; c < src.numberOfChannels; c++) {
      const d = src.getChannelData(c).slice();
      d.reverse();
      buf.copyToChannel(d, c);
    }
    this.reversedBufs.set(name, buf);
    return buf;
  }

  norm(name: string): number {
    return this.norms.get(name) ?? 1;
  }

  duration(name: string): number {
    return this.buffers.get(name)?.duration ?? 0;
  }

  /** Total and loaded sample counts. */
  progress(): { loaded: number; total: number } {
    return { loaded: this.buffers.size, total: SAMPLE_ORDER.length };
  }
}

export const bank = new SampleBank(SAMPLE_ORDER);

/** Encoded size of the score's sample set, from the files as served. */
export const sampleUrls = (): string[] =>
  SAMPLE_ORDER.map((n) => URLS[n]).filter((u): u is string => !!u);
