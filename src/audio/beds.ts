import type { AudioScene, EndVariant } from '../ui/contracts.ts';
import { at, BAR, BEAT, clamp, hash, ramp, st, steps, type Ctx } from './dsp.ts';
import { Band, type Holder, type Outs, type Voices } from './instruments.ts';

export interface Bed {
  /** Start continuous parts at `t`. */
  start(t: number): void;
  /** Schedule every discrete event in [from, to). Called repeatedly, in order. */
  schedule(from: number, to: number): void;
  /** Stop continuous parts at `t` (the output has already been faded). */
  stop(t: number): void;
}

export interface BedEnv {
  /** Start of the shared 92 BPM grid; every bed counts bars from here so stems line up. */
  origin: number;
  /** Smoothed tension, 0..1. */
  tension(): number;
  end: EndVariant;
  won: boolean;
  seed: number;
}

/** Crossfade length into each scene, seconds. */
export const FADES: Record<AudioScene, number> = {
  silence: 2,
  lobby: 2,
  day: 2,
  voting: 1.5,
  trial: 1.5,
  night: 3,
  nightSyndicate: 2.5,
  nightDead: 3,
  dawn: 2.5,
  end: 1.5,
};

/** Output level of each bed, so the intimate night layers sit below the day groove. */
export const BED_LEVEL: Record<AudioScene, number> = {
  silence: 0,
  lobby: 0.6,
  day: 1,
  voting: 1,
  trial: 0.9,
  night: 0.55,
  nightSyndicate: 0.5,
  nightDead: 0.5,
  dawn: 0.9,
  end: 0.8,
};

/** D minor and its neighbours, voiced for four singers. */
const CH = {
  Dm: [50, 57, 62, 65],
  Bb: [46, 58, 62, 65],
  Gm: [43, 58, 62, 67],
  A: [45, 57, 61, 64],
  F: [53, 57, 60, 65],
  C: [48, 55, 64, 67],
  Dmaj: [50, 57, 62, 66],
  Dsus: [50, 57, 62, 67],
  Fifth: [50, 57, 62, 69],
} as const;
export type ChordName = keyof typeof CH;
export const chordNotes = (c: ChordName) => CH[c];

const DAY_PROG: readonly ChordName[] = ['Dm', 'Bb', 'Gm', 'A'];
/** hum-01 sings this note over each chord of the day progression. */
const DAY_HUM = [65, 65, 67, 64];
const WHISPERS = ['whisper-01', 'whisper-02', 'whisper-03', 'whisper-05'];
const FOOTSTEPS = ['footstep-01', 'footstep-03', 'footstep-02', 'footstep-04'];

type Stopper = { stop(t: number): void };

interface Spec {
  start?: (t: number) => Stopper[];
  loops?: Holder[];
  /** `first` is true on the first call, so beds that join mid-phrase can catch up. */
  tick(from: number, to: number, first: boolean): void;
}

function bed(spec: Spec): Bed {
  const stops: Stopper[] = [];
  let first = true;
  return {
    start(t) {
      stops.push(...(spec.start?.(t) ?? []));
      spec.loops?.forEach((l) => l.ensure(t));
    },
    schedule(from, to) {
      spec.loops?.forEach((l) => l.ensure(from));
      spec.tick(from, to, first);
      first = false;
    },
    stop(t) {
      stops.forEach((s) => s.stop(t));
      spec.loops?.forEach((l) => l.stop(t));
    },
  };
}

/** Index, start and time left of the phrase of `len` seconds that contains `t`. */
function phraseAt(origin: number, len: number, t: number) {
  const k = Math.floor((t - origin) / len + 1e-9);
  const start = origin + k * len;
  return { k, start, left: start + len - t, inside: t - start > 0.05 };
}

/** The body-percussion groove: stomp, clap, thigh slap, snap and chest slap on 16ths. */
function groove(b: Band, i: number, t: number, level: number): void {
  const s = i % 16;
  const bar = Math.floor(i / 16);
  const k = { room: 0.35 };
  if (s === 0 || s === 8) {
    b.play(bar % 2 ? 'stomp-04' : 'stomp-01', t, 0.5 * level, k);
    b.thump(t, 0.3 * level);
  }
  if (s === 6 && bar % 2 === 1) b.play('stomp-01', t, 0.28 * level, k);
  if (s === 4 || s === 12)
    b.play(s === 4 ? 'clap-03' : 'clap-04', t, 0.4 * level, { ...k, pan: 0.15 });
  if (s === 3 || s === 10 || s === 14)
    b.play(s === 10 ? 'slap-01' : 'slap-02', t, 0.28 * level, { ...k, pan: -0.35 });
  if (s === 7 || s === 15)
    b.play(s === 7 ? 'snap-01' : 'snap-02', t, 0.2 * level, { ...k, pan: 0.5 });
  if (s === 11) b.play('chest-slap-02', t, 0.3 * level, k);
}

/** Heartbeat in body percussion: a stomp on the beat, a chest slap a sixteenth later. */
function heartbeat(b: Band, s: number, t: number, level: number, lp = 900): void {
  if (s % 4 === 0) {
    b.play('stomp-03', t, 0.45 * level, { lp, room: 0.3 });
    b.thump(t, 0.32 * level, 50);
  } else if (s % 4 === 1) {
    b.play('chest-slap-01', t, 0.3 * level, { room: 0.3 });
    b.thump(t, 0.16 * level, 44);
  }
}

function dayBed(b: Band, env: BedEnv, voting: boolean): Bed {
  const phrase = BAR * 2;
  const pad = (c: ChordName, t: number, dur: number) =>
    b.chord(CH[c], t, dur + 0.4, 0.06, { hall: 0.6 });
  return bed({
    start: (t) => [b.room(t, 0.03)],
    loops: [b.hold('murmur-loop-01', 0.09, { lp: 2400, room: 0.4 })],
    tick(from, to, first) {
      const T = env.tension();
      const heart = Math.max(voting ? 0.8 : 0, ramp(T, 0.3, 0.5));
      const keys = ramp(T, 0.6, 0.75);
      const strings = ramp(T, 0.8, 0.95);
      if (first) {
        const p = phraseAt(env.origin, phrase, from);
        if (p.inside && p.left > 1) pad(at(DAY_PROG, p.k), from, p.left);
      }
      steps(env.origin, 4, from, to, (i, t) => {
        groove(b, i, t, 1);
        const s = i % 16;
        const bar = Math.floor(i / 16);
        const c = at(DAY_PROG, bar / 2);
        const n = CH[c];
        if (s === 0 && bar % 2 === 0) {
          pad(c, t, phrase);
          b.play('hum-01', t + 0.05, 0.2, {
            rate: st(at(DAY_HUM, bar / 2) - 65.4),
            hall: 0.5,
            pan: -0.15,
          });
        }
        if (heart > 0) heartbeat(b, s, t, heart);
        if (keys > 0 && s % 2 === 0) {
          const pattern = [n[2], n[3], n[1] + 12, n[3]];
          b.piano(at(pattern, s / 2), t, (s % 8 === 0 ? 0.3 : 0.22) * keys, 0.7, { pan: 0.25 });
        }
        if (strings > 0 && s === 0 && bar % 2 === 0) {
          b.bow('cello', (n[0] % 12) + 36, t, phrase + 0.3, 0.22 * strings, { pan: -0.3 });
          b.bow('violin', n[3] + 12, t + BEAT, phrase - BEAT + 0.3, 0.09 * strings, {
            pan: 0.35,
          });
        }
      });
    },
  });
}

function trialBed(b: Band, env: BedEnv): Bed {
  const phrase = BAR * 2;
  let startBar = 0;
  const strings = (bar: number, t: number, dur: number) => {
    b.bow('cello', bar % 4 === 2 ? 39 : 38, t, dur, 0.22, { pan: -0.25 });
    b.bow('violin', bar % 4 === 2 ? 82 : 81, t + 0.3, dur - 0.3, 0.07, { pan: 0.35 });
  };
  return bed({
    start: (t) => {
      startBar = Math.floor((t - env.origin) / BAR);
      return [b.room(t, 0.035), b.drone(t, 73.42, 0.03)];
    },
    loops: [
      b.hold('murmur-loop-01', 0.06, { lp: 1500, hall: 0.4 }),
      b.hold('whisper-crowd-loop-01', 0.05, { lp: 2200, pan: 0.2 }),
    ],
    tick(from, to, first) {
      const T = env.tension();
      const snaps = ramp(T, 0.3, 0.5);
      const low = ramp(T, 0.6, 0.75);
      const high = ramp(T, 0.8, 0.95);
      if (first) {
        const p = phraseAt(env.origin, phrase, from);
        if (p.inside && p.left > 1) strings(p.k * 2, from, p.left + 0.3);
      }
      steps(env.origin, 4, from, to, (i, t) => {
        const s = i % 16;
        const bar = Math.floor(i / 16);
        const stage = clamp(Math.floor((bar - startBar) / 4), 0, 3);
        heartbeat(b, s, t, 1.1 + stage * 0.08, 1400);
        if (snaps > 0 && s % 4 === 2) b.play('snap-02', t, 0.16 * snaps, { pan: 0.55, room: 0.3 });
        if (snaps > 0 && s % 8 === 6) b.play('snap-01', t, 0.13 * snaps, { pan: -0.5, room: 0.3 });
        if (s === 0 && bar % 2 === 0) {
          // A close cluster (a semitone apart) that rises every four bars.
          b.sing(50 + stage, t, phrase + 0.3, 0.1, { pan: -0.3, hall: 0.6 });
          b.sing(51 + stage, t, phrase + 0.3, 0.08, { pan: 0.3, hall: 0.6 });
          if (stage >= 1) b.sing(62 + stage, t, phrase + 0.3, 0.05, { pan: 0.1, hall: 0.6 });
          strings(bar, t, phrase + 0.3);
          if (low > 0) {
            b.piano(26, t, 0.32 * low, 3.5, { lp: 900 });
            b.piano(27, t + 0.01, 0.24 * low, 3.5, { lp: 900 });
          }
          if (high > 0) b.bow('violin', 87, t + BEAT, phrase, 0.06 * high, { pan: -0.35 });
        }
      });
    },
  });
}

type NightKind = 'town' | 'syndicate' | 'dead';

function nightBed(b: Band, env: BedEnv, kind: NightKind): Bed {
  const line = [62, 69, 65, 64, 62, 57, 58, 57];
  const darkLine = [50, 45, 46, 45];
  const glassNotes = kind === 'dead' ? [81, 77, 86, 81, 82, 77] : [81, 77];
  const loops: Holder[] = [];
  if (kind !== 'syndicate') loops.push(b.hold('candle-flame-loop-01', 0.05, { lp: 4000 }));
  if (kind === 'syndicate')
    loops.push(b.hold('whisper-crowd-loop-01', 0.06, { lp: 900, pan: -0.2 }));
  if (kind === 'dead') loops.push(b.hold('breath-04', 0.08, { lp: 2400, hall: 0.4, pan: 0.2 }));
  const drones = (t: number, dur: number) => {
    if (kind === 'town') {
      b.hum(50, t, dur, 0.3, { hall: 0.4 });
      b.hum(57, t, dur, 0.14, { hall: 0.5, pan: 0.2 });
    } else if (kind === 'syndicate') {
      b.hum(45, t, dur, 0.3, { lp: 1600, room: 0.3 });
      b.hum(38, t, dur, 0.26, { kind: 'low', lp: 1200 });
    } else {
      b.hum(50, t, dur, 0.24, { kind: 'low', hall: 0.6 });
      b.hum(62, t, dur, 0.1, { kind: 'high', hall: 0.7, pan: -0.2 });
    }
  };
  return bed({
    start: (t) => [b.room(t, 0.04), b.drone(t, 73.42, kind === 'syndicate' ? 0.04 : 0.025)],
    loops,
    tick(from, to, first) {
      if (first) {
        const p = phraseAt(env.origin, BAR, from);
        if (p.inside && p.left > 0.6) drones(from, p.left + 0.4);
      }
      steps(env.origin, 1, from, to, (i, t) => {
        const q = i % 4;
        const bar = Math.floor(i / 4);
        if (q === 0) drones(t, BAR + 0.5);
        if (kind === 'town') {
          if (q === 0) b.piano(at(line, bar), t + 0.02, 0.26, 3.5, { pan: hash(bar) - 0.5 });
          if (q === 2 && bar % 2 === 1) b.piano(at(line, bar + 3) + 12, t, 0.13, 2.5, { pan: 0.4 });
          if (q === 0 && bar % 4 === 0) b.piano(38, t, 0.24, 4, { lp: 900, pan: -0.2 });
          if (i % 6 === 1)
            b.circling(at(WHISPERS, i / 6), t, 3.6, 0.32, i + env.seed, { lp: 4500 });
          if (q === 0 && bar % 4 === 2)
            b.glass(at(glassNotes, bar / 4), t, 0.13, 4.2, { pan: hash(bar + 9) - 0.5 });
          if (q === 2 && bar % 4 === 3)
            b.play(bar % 8 === 3 ? 'breath-03' : 'breath-06', t, 0.12, { lp: 3800, pan: -0.2 });
        } else if (kind === 'syndicate') {
          if (q === 0 && bar % 2 === 0)
            b.bow('cello', bar % 8 === 6 ? 39 : 38, t, BAR * 2 + 0.3, 0.16, { lp: 1400 });
          if (q === 0 && bar % 2 === 1)
            b.piano(at(darkLine, bar / 2), t, 0.24, 3.5, { lp: 900, pan: -0.15 });
          if (i % 4 === 2)
            b.circling(at(WHISPERS, i / 4), t, 3.2, 0.36, i + env.seed, {
              lp: 2000,
              width: 0.6,
              hall: 0.1,
            });
          if (q === 3 && bar % 4 === 1) b.play('breath-03', t, 0.16, { lp: 2400, pan: 0.15 });
        } else {
          if (q === 0 && bar % 2 === 0)
            b.glass(at(glassNotes, bar / 2), t, 0.16, 5, { pan: hash(bar) * 1.2 - 0.6 });
          if (q === 1 && bar % 3 === 1) {
            // Knocks far away, in ones, twos and threes.
            const n = 1 + Math.floor(hash(bar + 2) * 3);
            const pan = hash(bar + 5) * 1.6 - 0.8;
            for (let k = 0; k < n; k++)
              b.knock(t + k * BEAT * 0.5, 0.32, {
                name: at(['knock-01', 'knock-03', 'knock-04'], bar + k),
                pan,
                far: true,
              });
          }
          if (i % 8 === 3)
            b.circling(at(WHISPERS, i / 8), t, 3.6, 0.18, i + env.seed, { lp: 3000, hall: 0.8 });
          if (q === 2 && bar % 2 === 1)
            b.play(bar % 4 === 1 ? 'breath-06' : 'breath-03', t, 0.14, { lp: 3000, hall: 0.5 });
        }
      });
    },
  });
}

function dawnBed(b: Band, env: BedEnv): Bed {
  const phrase = BAR * 2;
  const violin = [69, 74, 76, 77, 76, 74, 72, 69];
  const pad = (t: number, dur: number) => {
    b.sing(50, t, dur, 0.09, { pan: -0.3, hall: 0.6 });
    b.sing(57, t, dur, 0.08, { pan: 0.3, hall: 0.6 });
    b.sing(62, t, dur, 0.06, { pan: 0, hall: 0.6 });
  };
  return bed({
    start: (t) => [b.room(t, 0.02)],
    loops: [b.hold('dawn-birds-loop-01', 0.16, { lp: 5000, attack: 2.5 })],
    tick(from, to, first) {
      if (first) {
        const p = phraseAt(env.origin, phrase, from);
        if (p.inside && p.left > 1) pad(from, p.left + 0.4);
      }
      steps(env.origin, 1, from, to, (i, t) => {
        const bar = Math.floor(i / 4);
        if (i % 8 === 0) {
          pad(t, phrase + 0.4);
          b.bow('violin', at(violin, bar / 2), t + BEAT, phrase - 0.2, 0.08, {
            pan: 0.3,
            hall: 0.7,
          });
        }
        if (i % 16 === 4) b.play('hum-01', t, 0.14, { rate: st(62 - 65.4), hall: 0.6, pan: -0.2 });
      });
    },
  });
}

function lobbyBed(b: Band, env: BedEnv): Bed {
  return bed({
    start: (t) => [b.room(t, 0.05)],
    loops: [b.hold('candle-flame-loop-01', 0.07, { lp: 3500 })],
    tick(from, to, first) {
      if (first) {
        const p = phraseAt(env.origin, BAR, from);
        if (p.inside && p.left > 0.6) b.hum(50, from, p.left + 0.5, 0.26, { hall: 0.5 });
      }
      steps(env.origin, 1, from, to, (i, t) => {
        const q = i % 4;
        const bar = Math.floor(i / 4);
        if (q === 0) b.hum(50, t, BAR + 0.5, 0.26, { hall: 0.5 });
        if (q === 0 && bar % 4 === 2)
          b.play('hum-01', t + 0.1, 0.16, { rate: st(62 - 65.4), hall: 0.6, pan: 0.2 });
        // Someone crossing the boards somewhere offstage.
        if (bar % 4 === 1) {
          const dir = Math.floor(bar / 4) % 2 ? 1 : -1;
          const pan = dir * (-0.7 + (q / 3) * 1.4);
          b.play(at(FOOTSTEPS, i), t + BEAT * 0.04 * hash(i), 0.2, { lp: 1600, hall: 0.6, pan });
        }
        if (q === 2 && bar % 8 === 6)
          b.play('chair-creak-03', t, 0.08, { lp: 2500, hall: 0.4, pan: -0.5 });
      });
    },
  });
}

/** End: a short finale phrase per faction on the first beat, then a quiet tail. */
function endBed(b: Band, env: BedEnv): Bed {
  let phraseT = -1;
  let played = false;
  const won = env.won;
  const lp = won ? undefined : 2400;
  const finale = (t: number) => {
    switch (env.end) {
      case 'town': {
        b.play('stomp-02', t, 0.6, { room: 0.5, dur: 0.6 });
        b.thump(t, 0.45, 46);
        b.chord(CH.Bb, t, BEAT * 2 + 0.3, 0.09, { hall: 0.6, lp });
        b.play('stomp-01', t + BEAT * 2, 0.55, { room: 0.5 });
        b.play('clap-04', t + BEAT * 2, 0.4, { room: 0.5 });
        b.chord(CH.C, t + BEAT * 2, BEAT * 2 + 0.3, 0.09, { hall: 0.6, lp });
        b.play('stomp-02', t + BEAT * 4, 0.65, { room: 0.5, dur: 0.8 });
        b.thump(t + BEAT * 4, 0.5, 44);
        b.chord(won ? CH.Dmaj : CH.Dm, t + BEAT * 4, BAR * 2, 0.1, { hall: 0.7, lp });
        b.bow('violin', won ? 78 : 77, t + BEAT * 4, BAR * 2, 0.1, { pan: 0.3, lp });
        if (won) b.play('choir-phrase-06', t + BEAT * 4.5, 0.25, { hall: 0.7, pan: -0.2 });
        else b.play('sigh-03', t + BEAT * 8, 0.2, { offset: 2.4, hall: 0.4 });
        break;
      }
      case 'mafia': {
        for (let k = 0; k < 4; k++) {
          b.play('stomp-03', t + k * BEAT, 0.5 + k * 0.05, { lp: 1200, room: 0.4 });
          b.thump(t + k * BEAT, 0.4, 40);
        }
        b.hum(38, t, BAR * 3, 0.2, { kind: 'low', lp: 1400 });
        b.hum(45, t, BAR * 3, 0.16, { lp: 1600 });
        b.bow('cello', 38, t, BAR * 2.5, 0.22, { pan: -0.2 });
        b.bow('cello', 45, t + BEAT * 2, BAR * 2, 0.15, { pan: 0.2 });
        b.piano(26, t, 0.3, 4, { lp: 800 });
        b.piano(33, t + 0.01, 0.22, 4, { lp: 800 });
        b.chord(CH.Gm, t, BAR, 0.06, { hall: 0.5, lp: 1800 });
        b.chord(CH.Dm, t + BAR, BAR * 1.5, 0.07, { hall: 0.6, lp: 1800 });
        // The winners' low chant; the losers only sigh.
        if (won) b.play('choir-phrase-06', t + BAR, 0.2, { rate: st(-5), lp: 2000, hall: 0.7 });
        else b.play('sigh-02', t + BAR * 2, 0.2, { hall: 0.4 });
        break;
      }
      case 'cutthroat': {
        b.play('gasp-01', t - 0.2, 0.45, { room: 0.3 });
        b.play('slap-03', t, 0.75, { room: 0.6 });
        b.play('clap-03', t, 0.5, { hall: 0.6 });
        b.thump(t, 0.5, 70);
        b.sing(69, t + BEAT * 2, BAR * 2, 0.11, { hall: 0.8, pan: 0.15 });
        b.glass(81, t + BEAT * 3, 0.16, 4.5, { pan: -0.3 });
        b.play('breath-06', t + BAR * 2, 0.2, { lp: 3000, hall: 0.4 });
        break;
      }
      case 'draw': {
        b.play('candle-blow-02', t, 0.5, { room: 0.4 });
        b.play('candle-flame-loop-01', t, 0.35, {
          rate: 0.6,
          offset: 9,
          dur: 2.5,
          release: 1.5,
          lp: 1500,
        });
        b.chord(CH.Dsus, t + BEAT, BAR * 2, 0.08, { hall: 0.7, lp: 2600 });
        b.bow('cello', 38, t + BEAT, BAR * 2, 0.18, { pan: -0.2 });
        b.play('sigh-01', t + BAR * 2, 0.25, { hall: 0.4 });
        break;
      }
    }
  };
  const tail = (i: number, t: number) => {
    const q = i % 4;
    const bar = Math.floor(i / 4);
    if (q !== 0 || bar % 2 !== 0) return;
    const d = BAR * 2 + 0.5;
    switch (env.end) {
      case 'town':
        b.sing(50, t, d, 0.06, { hall: 0.6, pan: -0.3, lp });
        b.sing(57, t, d, 0.05, { hall: 0.6, pan: 0.3, lp });
        b.sing(won ? 66 : 65, t, d, 0.035, { hall: 0.7, lp });
        break;
      case 'mafia':
        b.hum(38, t, d, 0.22, { kind: 'low', lp: 1200 });
        b.bow('cello', 38, t, d, 0.13, { lp: 1400 });
        break;
      case 'cutthroat':
        b.hum(62, t, d, 0.1, { kind: 'high', hall: 0.7 });
        if (bar % 4 === 2) b.glass(86, t, 0.08, 4, { pan: 0.3 });
        break;
      case 'draw':
        b.hum(50, t, d, 0.16, { hall: 0.6 });
        break;
    }
  };
  return bed({
    start: (t) => {
      phraseT = t + 0.02;
      return [b.room(t, 0.04)];
    },
    loops: [b.hold('candle-flame-loop-01', 0.05, { lp: 3000 })],
    tick(from, to) {
      if (!played && phraseT < to) {
        played = true;
        // The finale lands on the next beat of the shared grid.
        const k = Math.ceil((Math.max(phraseT, from) - env.origin) / BEAT - 1e-6);
        finale(env.origin + k * BEAT);
      }
      steps(env.origin, 1, Math.max(from, phraseT + BAR * 1.5), to, tail);
    },
  });
}

export function makeBed(scene: AudioScene, ctx: Ctx, outs: Outs, voices: Voices, env: BedEnv): Bed {
  const b = new Band(ctx, outs, voices, env.seed);
  switch (scene) {
    case 'lobby':
      return lobbyBed(b, env);
    case 'day':
      return dayBed(b, env, false);
    case 'voting':
      return dayBed(b, env, true);
    case 'trial':
      return trialBed(b, env);
    case 'night':
      return nightBed(b, env, 'town');
    case 'nightSyndicate':
      return nightBed(b, env, 'syndicate');
    case 'nightDead':
      return nightBed(b, env, 'dead');
    case 'dawn':
      return dawnBed(b, env);
    case 'end':
      return endBed(b, env);
    case 'silence':
      return bed({ tick() {} });
  }
}
