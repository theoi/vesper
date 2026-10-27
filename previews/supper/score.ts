import {
  type Bed,
  type Ctx,
  impulse,
  mtof,
  reverb,
  rng,
  type Score,
  type ScoreInstance,
  steps,
  voice,
} from '../shared/audio-kit.ts';
import { byName, pick, SampleBank } from '../shared/samples.ts';

const ALL = byName(
  import.meta.glob('../shared/samples/*.mp3', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>,
);

/** Sampled instruments: sample name → MIDI note it sounds at. */
const PIANO: Record<string, number> = {};
['C', 'Ds', 'Fs', 'A'].forEach((n, k) => {
  for (let oct = 2; oct <= 7; oct++) {
    const midi = 12 * (oct + 1) + k * 3;
    if (midi <= 96) PIANO[`piano-${n}${oct}`] = midi;
  }
});
const CELLO = {
  'cello-sus-C2': 36,
  'cello-sus-G2': 43,
  'cello-sus-D3': 50,
  'cello-sus-A3': 57,
  'cello-sus-E4': 64,
  'cello-sus-B4': 71,
  'cello-sus-F5': 77,
};
const VIOLIN = {
  'violin-sus-G3': 55,
  'violin-sus-C4': 60,
  'violin-sus-E4': 64,
  'violin-sus-A4': 69,
  'violin-sus-C5': 72,
  'violin-sus-E5': 76,
  'violin-sus-A5': 81,
  'violin-sus-C6': 84,
};
const CELLO_PIZZ = {
  'cello-pizz-C2': 36,
  'cello-pizz-G2': 43,
  'cello-pizz-D3': 50,
  'cello-pizz-A3': 57,
  'cello-pizz-E4': 64,
  'cello-pizz-B4': 71,
};
const VIOLIN_PIZZ = {
  'violin-pizz-G3': 55,
  'violin-pizz-C4': 60,
  'violin-pizz-E4': 64,
  'violin-pizz-A4': 69,
  'violin-pizz-C5': 72,
  'violin-pizz-E5': 76,
};

const ROOM = [
  'murmur-loop-01',
  'murmur-loop-02',
  'murmur-trial-01',
  'whisper-crowd-loop-01',
  'fire-crackle-loop-01',
  'candle-flame-loop-01',
  'clock-tick-loop-01',
  'heartbeat-01',
  'hum-group-01',
  'dawn-birds-loop-01',
];
const FOLEY = [
  'match-strike-01',
  'match-strike-02',
  'match-strike-03',
  'candle-blow-01',
  'candle-blow-02',
  'letter-unfold-01',
  'wax-seal-01',
  'paper-rustle-02',
  'cutlery-01',
  'cutlery-02',
  'cutlery-03',
  'glass-clink-02',
  'glass-clink-03',
  'chair-creak-01',
  'knock-01',
  'knock-03',
  'church-bell-01',
  'glass-rub-A5',
  'glass-rub-Fs5',
];
const VOICES = [
  'whisper-01',
  'whisper-02',
  'whisper-03',
  'whisper-06',
  'breath-01',
  'breath-03',
  'breath-07',
  'gasp-02',
  'gasp-crowd-01',
  'sigh-01',
  'sigh-02',
];

const bank = new SampleBank(
  pick(ALL, [
    ...Object.keys(PIANO),
    ...Object.keys(CELLO),
    ...Object.keys(VIOLIN),
    ...Object.keys(CELLO_PIZZ),
    ...Object.keys(VIOLIN_PIZZ),
    ...ROOM,
    ...FOLEY,
    ...VOICES,
  ]),
);

const nearest = (table: Record<string, number>, midi: number): [string, number] => {
  let best: [string, number] = ['', 0];
  let d = Infinity;
  for (const [name, m] of Object.entries(table)) {
    const dd = Math.abs(m - midi) + (m > midi ? 0.1 : 0);
    if (dd < d) {
      d = dd;
      best = [name, m];
    }
  }
  return best;
};

const irCache = new WeakMap<Ctx, AudioBuffer>();
const hall = (ctx: Ctx) => {
  let ir = irCache.get(ctx);
  if (!ir) irCache.set(ctx, (ir = impulse(ctx, 2.8, 2.6, { darkness: 0.55, seed: 11 })));
  return ir;
};

/** D minor. Bars of chords (MIDI roots and chord tones). */
const D = 50;
const CH = {
  Dm: [38, 50, 53, 57],
  Bb: [34, 50, 53, 58],
  Gm: [43, 50, 55, 58],
  A: [33, 49, 52, 57],
  F: [41, 48, 53, 57],
  C: [36, 48, 52, 55],
  A7: [33, 49, 52, 55],
};
type Chord = keyof typeof CH;

class Kit {
  readonly wet: GainNode;
  constructor(
    readonly ctx: Ctx,
    readonly out: AudioNode,
    wet = 0.5,
  ) {
    this.wet = reverb(ctx, hall(ctx), out, wet);
  }

  private pitched(
    table: Record<string, number>,
    t: number,
    midi: number,
    gain: number,
    o: { dur?: number; pan?: number; send?: number; attack?: number; release?: number } = {},
  ) {
    const [name, base] = nearest(table, midi);
    return bank.play(this.ctx, this.out, name, t, {
      rate: 2 ** ((midi - base) / 12),
      gain,
      pan: o.pan ?? 0,
      dur: o.dur,
      attack: o.attack ?? 0.004,
      release: o.release ?? 0.4,
      send: this.wet,
      sendGain: o.send ?? 0.45,
    });
  }

  piano(t: number, midi: number, gain = 0.35, pan = 0, dur?: number) {
    return this.pitched(PIANO, t, midi, gain, { pan, dur, release: 0.8 });
  }

  /** A bowed note; long notes are re-bowed with overlapping strokes. */
  bow(kind: 'cello' | 'violin', t: number, midi: number, dur: number, gain = 0.3, pan = 0) {
    const table = kind === 'cello' ? CELLO : VIOLIN;
    const stroke = 2.6;
    for (let s = 0; s < dur; s += stroke - 0.5) {
      const len = Math.min(stroke, dur - s + 0.4);
      this.pitched(table, t + s, midi, gain, {
        dur: len,
        pan,
        attack: s === 0 ? 0.12 : 0.45,
        release: 0.6,
        send: 0.6,
      });
    }
  }

  pizz(kind: 'cello' | 'violin', t: number, midi: number, gain = 0.4, pan = 0) {
    return this.pitched(kind === 'cello' ? CELLO_PIZZ : VIOLIN_PIZZ, t, midi, gain, {
      pan,
      send: 0.35,
    });
  }

  play(name: string, t: number, gain = 0.5, o: Parameters<SampleBank['play']>[4] = {}) {
    return bank.play(this.ctx, this.out, name, t, {
      send: this.wet,
      sendGain: 0.3,
      ...o,
      gain,
    });
  }

  loop(name: string, t: number, gain: number, fade = 1.5) {
    const v = bank.play(this.ctx, this.out, name, t, {
      loop: true,
      gain,
      attack: fade,
      offset: (t * 1.7) % Math.max(0.1, bank.duration(name) - 0.5),
    });
    return (at: number) => v?.stop(at, 0.6);
  }
}

const pickOne = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;

function titleBed(k: Kit): Bed {
  const r = rng(3);
  const prog: Chord[] = ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'F', 'Gm', 'A7'];
  const melody = [69, 65, 67, 62, 70, 69, 67, 64, 69, 72, 70, 65, 67, 70, 69, 61];
  const stops: ((t: number) => void)[] = [];
  let origin = 0;
  return {
    start(t) {
      origin = t + 0.2;
      stops.push(k.loop('murmur-loop-02', t, 0.11, 3), k.loop('candle-flame-loop-01', t, 0.12));
    },
    schedule(from, to) {
      steps(origin, 62, 1, from, to, (i, t) => {
        const bar = Math.floor(i / 3);
        const beat = i % 3;
        const c = CH[prog[bar % prog.length] ?? 'Dm'];
        if (beat === 0) {
          k.piano(t, c[0] ?? D, 0.36, -0.2);
          k.piano(t + 0.02, (c[0] ?? D) + 12, 0.18, -0.2);
          if (bar % 2 === 0) k.bow('cello', t, (c[0] ?? D) + 12, 5.6, 0.12, -0.3);
          const m = melody[(bar * 2) % melody.length] ?? 69;
          k.piano(t + 0.03, m + 12, 0.24, 0.25);
        } else {
          k.piano(t, c[beat] ?? 53, 0.15, 0.05);
          k.piano(t + 0.04, c[beat + 1] ?? 57, 0.13, 0.1);
          if (beat === 2 && bar % 2 === 1) {
            const m = melody[(bar * 2 + 1) % melody.length] ?? 69;
            k.piano(t + 0.02, m + 12, 0.2, 0.25);
          }
        }
      });
      steps(origin + 1.3, 60, 0.2, from, to, (_i, t) => {
        if (r() < 0.7)
          k.play(pickOne(r, ['cutlery-01', 'cutlery-02', 'glass-clink-03']), t, 0.06 + r() * 0.05, {
            pan: r() * 1.4 - 0.7,
          });
      });
    },
    stop(t) {
      stops.forEach((s) => s(t));
    },
  };
}

function nightBed(k: Kit): Bed {
  const r = rng(7);
  const stops: ((t: number) => void)[] = [];
  let origin = 0;
  return {
    start(t) {
      origin = t + 0.1;
      stops.push(k.loop('fire-crackle-loop-01', t, 0.16, 2), k.loop('hum-group-01', t, 0.09, 3));
    },
    schedule(from, to) {
      steps(origin, 60, 0.4, from, to, (i, t) => {
        k.bow('cello', t, i % 4 === 3 ? 39 : 38, 2.7, 0.2, -0.2);
        if (i % 2 === 0) k.bow('cello', t + 0.4, 45, 2.4, 0.1, 0.2);
      });
      steps(origin + 1.7, 60, 1 / 3, from, to, (i, t) => {
        const notes = [86, 81, 77, 74, 82, 81];
        k.piano(t, notes[i % notes.length] ?? 81, 0.13, r() * 1.2 - 0.6);
      });
      steps(origin + 2.4, 60, 1 / 4.5, from, to, (_i, t) => {
        const w = pickOne(r, ['whisper-01', 'whisper-02', 'whisper-03']);
        k.play(w, t, 0.1 + r() * 0.05, {
          offset: r() * 2,
          dur: 1.4 + r(),
          attack: 0.3,
          release: 0.6,
          pan: r() < 0.5 ? -0.75 : 0.75,
          sendGain: 0.6,
        });
      });
      steps(origin + 5.2, 60, 1 / 7, from, to, (i, t) => {
        k.play(i % 2 ? 'glass-rub-A5' : 'glass-rub-Fs5', t, 0.07, {
          attack: 1,
          dur: 2.6,
          release: 1.2,
          rate: 2 ** (-7 / 12),
          pan: r() - 0.5,
          sendGain: 0.7,
        });
      });
    },
    stop(t) {
      stops.forEach((s) => s(t));
    },
  };
}

function dayBed(k: Kit): Bed {
  const r = rng(5);
  const prog: Chord[] = ['Dm', 'Gm', 'C', 'F', 'Bb', 'Gm', 'A', 'A7'];
  const stops: ((t: number) => void)[] = [];
  let origin = 0;
  return {
    start(t) {
      origin = t + 0.1;
      stops.push(k.loop('murmur-loop-01', t, 0.2, 2));
    },
    schedule(from, to) {
      steps(origin, 96, 2, from, to, (i, t) => {
        const bar = Math.floor(i / 8);
        const s = i % 8;
        const c = CH[prog[bar % prog.length] ?? 'Dm'];
        if (s === 0 || s === 4) k.pizz('cello', t, (c[0] ?? 38) + (s === 4 ? 7 : 0), 0.38, -0.3);
        if (s % 2 === 1) {
          const tone = (c[1 + ((s >> 1) % 3)] ?? 57) + 12;
          k.pizz('violin', t, tone, 0.2, 0.35);
        }
        if (s === 0) {
          k.piano(t + 0.01, (c[1] ?? 50) + 12, 0.1, 0.1);
          k.piano(t + 0.03, (c[2] ?? 53) + 12, 0.1, 0.1);
          k.piano(t + 0.05, (c[3] ?? 57) + 12, 0.1, 0.1);
        }
        if (s === 6 && bar % 2 === 1) k.bow('violin', t, (c[3] ?? 57) + 12, 1.6, 0.08, 0.4);
      });
      steps(origin + 0.7, 60, 0.45, from, to, (_i, t) => {
        if (r() < 0.6)
          k.play(
            pickOne(r, ['cutlery-01', 'cutlery-02', 'cutlery-03', 'glass-clink-02']),
            t,
            0.06 + r() * 0.06,
            { pan: r() * 1.6 - 0.8 },
          );
      });
    },
    stop(t) {
      stops.forEach((s) => s(t));
    },
  };
}

function trialBed(k: Kit): Bed {
  const stops: ((t: number) => void)[] = [];
  let origin = 0;
  return {
    start(t) {
      origin = t + 0.05;
      stops.push(
        k.loop('heartbeat-01', t, 0.32, 0.5),
        k.loop('whisper-crowd-loop-01', t, 0.07, 2),
        k.loop('clock-tick-loop-01', t, 0.1, 1),
      );
    },
    schedule(from, to) {
      steps(origin, 66, 0.25, from, to, (i, t) => {
        k.bow('cello', t, i % 2 ? 39 : 38, 3.8, 0.2, -0.2);
        k.bow('violin', t + 0.3, i % 2 ? 82 : 81, 3.4, 0.07, 0.35);
        if (i % 2 === 0) {
          k.piano(t, 26, 0.3, -0.1);
          k.piano(t + 0.01, 27, 0.22, -0.1);
        }
      });
      steps(origin + 0.45, 66, 1, from, to, (i, t) => {
        if (i % 4 === 2) k.pizz('cello', t, 38, 0.32, -0.2);
      });
    },
    stop(t) {
      stops.forEach((s) => s(t));
    },
  };
}

function lamentBed(k: Kit): Bed {
  const prog: Chord[] = ['Dm', 'Bb', 'Gm', 'A'];
  const line = [62, 65, 64, 62, 61, 62, 58, 57];
  const stops: ((t: number) => void)[] = [];
  let origin = 0;
  return {
    start(t) {
      origin = t + 0.3;
      stops.push(k.loop('candle-flame-loop-01', t, 0.1, 2), k.loop('hum-group-01', t, 0.08, 4));
    },
    schedule(from, to) {
      steps(origin, 54, 0.5, from, to, (i, t) => {
        const c = CH[prog[Math.floor(i / 2) % prog.length] ?? 'Dm'];
        if (i % 2 === 0) {
          k.piano(t, c[0] ?? 38, 0.26, -0.2);
          k.piano(t + 0.6, c[2] ?? 53, 0.12, 0.1);
          k.piano(t + 1.2, c[3] ?? 57, 0.12, 0.15);
        }
        k.bow('cello', t + 0.1, line[i % line.length] ?? 62, 2.1, 0.2, 0.15);
      });
    },
    stop(t) {
      stops.forEach((s) => s(t));
    },
  };
}

const BEDS = ['title', 'night', 'day', 'trial', 'lament'] as const;
const STINGS = [
  'match',
  'paper',
  'reveal',
  'snuff',
  'whisper',
  'whisper2',
  'dawn',
  'toll',
  'gasp',
  'vote',
  'voteSoft',
  'verdict',
  'death',
] as const;

export const supperScore: Score = {
  beds: BEDS,
  stings: STINGS,
  prepare: (ctx, onProgress) => bank.load(ctx, onProgress),
  create(ctx: Ctx, out: AudioNode): ScoreInstance {
    const k = new Kit(ctx, out, 0.45);
    let n = 0;
    return {
      bed(name, bout) {
        const bk = new Kit(ctx, bout, 0.5);
        if (name === 'night') return nightBed(bk);
        if (name === 'day') return dayBed(bk);
        if (name === 'trial') return trialBed(bk);
        if (name === 'lament') return lamentBed(bk);
        return titleBed(bk);
      },
      sting(name, t) {
        n++;
        switch (name) {
          case 'match':
            k.play(`match-strike-0${(n % 3) + 1}`, t, 1, { pan: (n % 5) * 0.3 - 0.6 });
            break;
          case 'paper':
            k.play('letter-unfold-01', t, 0.5);
            break;
          case 'reveal':
            k.play('wax-seal-01', t, 0.55);
            [50, 62, 66, 69, 74].forEach((m, i) =>
              k.piano(t + 0.08 + i * 0.07, m, 0.3 - i * 0.03, i * 0.1 - 0.2),
            );
            k.bow('violin', t + 0.2, 81, 3, 0.12, 0.3);
            k.bow('cello', t + 0.1, 50, 3, 0.14, -0.3);
            break;
          case 'snuff':
            k.play(n % 2 ? 'candle-blow-01' : 'candle-blow-02', t, 0.45, {
              pan: (n % 3) * 0.5 - 0.5,
            });
            break;
          case 'whisper':
            k.play('whisper-06', t, 0.6, { pan: 0.45, sendGain: 0.5 });
            k.play('breath-07', t + 0.9, 0.22, { pan: 0.45 });
            break;
          case 'whisper2':
            k.play('whisper-03', t, 0.55, { dur: 1.9, release: 0.5, pan: -0.45, sendGain: 0.5 });
            break;
          case 'dawn':
            k.play('dawn-birds-loop-01', t, 0.22, { attack: 1.5, dur: 5, release: 2.5 });
            k.bow('violin', t + 0.3, 76, 4.5, 0.12, 0.3);
            k.bow('violin', t + 1.1, 81, 3.6, 0.1, -0.2);
            [86, 89, 93].forEach((m, i) => k.piano(t + 0.5 + i * 0.5, m, 0.14, 0.3));
            break;
          case 'toll':
            k.play('church-bell-01', t, 0.55, { dur: 8, release: 3, sendGain: 0.4 });
            break;
          case 'gasp':
            k.play('gasp-crowd-01', t, 0.5);
            k.play('murmur-trial-01', t + 0.3, 0.3, {
              offset: 2,
              dur: 2.6,
              attack: 0.3,
              release: 1,
            });
            break;
          case 'vote':
            k.play(n % 2 ? 'knock-01' : 'knock-03', t, 0.55, { sendGain: 0.25 });
            k.pizz('cello', t, 38, 0.3);
            break;
          case 'voteSoft':
            k.play('knock-01', t, 0.25, { rate: 1.2 });
            k.pizz('violin', t, 74, 0.25, 0.3);
            break;
          case 'verdict':
            k.piano(t, 26, 0.5);
            k.piano(t, 33, 0.4);
            k.bow('cello', t, 38, 3.5, 0.32, -0.3);
            k.bow('cello', t, 50, 3.5, 0.24, -0.1);
            k.bow('violin', t, 74, 3.2, 0.2, 0.2);
            k.bow('violin', t, 77, 3.2, 0.18, 0.35);
            k.play('gasp-crowd-01', t + 0.05, 0.45);
            k.play('gasp-02', t + 0.25, 0.3, { pan: 0.4 });
            break;
          case 'death': {
            [26, 27, 33, 38].forEach((m, i) => k.piano(t + i * 0.02, m, 0.3));
            const v = k.play('cello-sus-D3', t + 0.3, 0.3, { attack: 0.3, dur: 3, release: 1.2 });
            v?.src.playbackRate.setValueAtTime(1, t + 0.8);
            v?.src.playbackRate.linearRampToValueAtTime(0.94, t + 3.2);
            k.play('breath-03', t + 1.4, 0.35, { sendGain: 0.5 });
            k.play('sigh-02', t + 3.2, 0.2, { pan: -0.3 });
            break;
          }
          default:
            voice(ctx, out, { t, freq: mtof(74), dur: 0.4, gain: 0.1 });
        }
      },
    };
  },
};
