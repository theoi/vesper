import type { CueName } from '../ui/contracts.ts';
import { chordNotes, type ChordName } from './beds.ts';
import { at, BAR, BEAT, hash, st } from './dsp.ts';
import type { Band } from './instruments.ts';

/** How many takes each cue has; `variant` is taken modulo this. */
export const CUE_TAKES: Record<CueName, number> = {
  ui: 3,
  chat: 3,
  whisper: 3,
  knock: 3,
  unknock: 2,
  stomp: 3,
  cut: 3,
  claim: 3,
  roleTown: 2,
  roleMafia: 2,
  roleNeutral: 2,
  dayBreak: 2,
  nightfall: 3,
  creep: 3,
  dawnQuiet: 2,
  dawnDeath: 2,
  candleOut: 2,
  candleLight: 3,
  deathMafia: 2,
  deathCutthroat: 2,
  deathReckoner: 2,
  deathGuard: 2,
  deathExecuted: 2,
  trial: 2,
  guilty: 2,
  innocent: 2,
  reveal: 2,
  will: 2,
  win: 2,
  lose: 2,
};

export const CUE_NAMES = Object.keys(CUE_TAKES) as CueName[];

const INSTANT: ReadonlySet<CueName> = new Set<CueName>([
  'ui',
  'chat',
  'whisper',
  'knock',
  'unknock',
  'stomp',
  'cut',
  'candleOut',
  'candleLight',
  'creep',
]);

/** Musical cues wait for the next eighth note of the running bed. */
export const isMusical = (name: CueName) => !INSTANT.has(name);

/** How far to lower the beds under a cue, and for how long (seconds). */
export const DUCK: Partial<Record<CueName, readonly [to: number, hold: number]>> = {
  roleTown: [0.45, 3],
  roleMafia: [0.4, 3],
  roleNeutral: [0.45, 3],
  dayBreak: [0.6, 2],
  nightfall: [0.5, 2.5],
  dawnQuiet: [0.55, 2.5],
  dawnDeath: [0.4, 3],
  deathMafia: [0.35, 2.5],
  deathCutthroat: [0.04, 2.2],
  deathReckoner: [0.25, 2],
  deathGuard: [0.4, 2],
  deathExecuted: [0.35, 3],
  trial: [0.5, 2],
  guilty: [0.35, 3],
  innocent: [0.5, 2.5],
  reveal: [0.45, 2.5],
  will: [0.6, 2.5],
  win: [0.35, 3.5],
  lose: [0.35, 3.5],
  claim: [0.7, 1],
};

/** Output level of each cue relative to the others. */
export const CUE_LEVEL: Partial<Record<CueName, number>> = {
  roleMafia: 0.55,
  roleNeutral: 0.55,
  deathMafia: 0.6,
  dawnDeath: 0.65,
  trial: 0.7,
  guilty: 0.7,
  reveal: 0.75,
  will: 0.7,
  lose: 0.7,
  deathGuard: 0.75,
  deathExecuted: 0.75,
  win: 0.8,
};

const KNOCKS = ['knock-01', 'knock-03', 'knock-04'];
const STOMPS = ['stomp-02', 'stomp-01', 'stomp-04'];
const chord = (c: ChordName) => chordNotes(c);

/** Play take `v` of cue `name` at `t` (already quantized for musical cues). */
export function playCue(name: CueName, b: Band, t: number, v: number): void {
  switch (name) {
    case 'ui':
      b.play(at(['snap-01', 'knock-03', 'snap-01'], v), t, 0.4, {
        rate: [1.15, 1.6, 0.85][v] ?? 1,
        lp: 5000,
        hp: 400,
        room: 0.5,
      });
      break;

    case 'chat':
      if (v === 2)
        b.play('paper-rustle-02', t, 0.26, { offset: 0.15, dur: 0.3, release: 0.12, room: 0.5 });
      else
        b.play(v ? 'knock-01' : 'knock-03', t, v ? 0.16 : 0.26, {
          rate: 1.3 + v * 0.15,
          lp: 2500,
          room: 0.5,
        });
      break;

    case 'whisper':
      if (v === 0) {
        b.play('whisper-06', t, 0.5, { hall: 0.3 });
        b.circling('whisper-05', t + 0.25, 2.2, 0.22, 3, { lp: 4000 });
      } else if (v === 1) {
        b.play('whisper-04', t, 0.45, { dur: 1.6, release: 0.4, hall: 0.3, offset: 0.2 });
      } else {
        b.play('shh-01', t, 0.4, { room: 0.3 });
        b.play('breath-01', t + 0.35, 0.25, { lp: 4000, room: 0.3 });
      }
      break;

    case 'knock':
      b.knock(t, 0.9, { name: at(KNOCKS, v) });
      break;

    case 'unknock': {
      // A knock played backwards, as if the sound were taken back.
      const n = v ? 'knock-02' : 'knock-04';
      b.play(n, t, 0.5, {
        reverse: true,
        offset: Math.max(0, b.duration(n) - 0.4),
        lp: 3000,
        room: 0.4,
      });
      break;
    }

    case 'stomp':
      b.play(at(STOMPS, v), t, 0.7, { room: 0.5, dur: 0.6, release: 0.3 });
      b.play(at(STOMPS, v + 1), t + 0.015, 0.35, { pan: -0.3 });
      b.thump(t, 0.5, 46);
      break;

    case 'cut':
      if (v === 0) {
        b.play('breath-02', t, 0.4, { room: 0.3 });
        b.play('clap-03', t + 0.01, 0.35, { room: 0.5 });
        b.thump(t, 0.14, 70);
      } else if (v === 1) {
        b.play('slap-03', t, 0.45, { room: 0.5 });
        b.play('breath-01', t, 0.3, { lp: 5000 });
        b.thump(t, 0.16, 64);
      } else {
        b.play('clap-04', t, 0.38, { room: 0.5 });
        b.play('gasp-02', t, 0.3, { dur: 0.35 });
        b.thump(t, 0.12, 72);
      }
      break;

    case 'candleOut':
      b.play(v ? 'candle-blow-02' : 'candle-blow-01', t, 0.6, { room: 0.35 });
      b.play('candle-flame-loop-01', t, 0.25, { offset: 5 + v * 3, dur: 0.35, release: 0.2 });
      break;

    case 'candleLight':
      b.play(at(['match-strike-01', 'match-strike-02', 'match-strike-03'], v), t, 0.65, {
        room: 0.35,
      });
      b.play('candle-flame-loop-01', t + 0.25, 0.3, {
        offset: 3 + v * 2,
        dur: 1.6,
        attack: 0.3,
        release: 0.8,
      });
      break;

    case 'creep': {
      const steps =
        v === 1 ? ['footstep-03', 'footstep-04'] : ['footstep-02', 'footstep-03', 'footstep-04'];
      steps.forEach((s, k) =>
        b.play(s, t + k * 0.42 + hash(k + v) * 0.05, 0.32, {
          lp: 1800,
          room: 0.4,
          pan: (k - 1) * 0.2,
        }),
      );
      if (v === 1) b.play('chair-creak-01', t + 0.2, 0.2, { lp: 2500, room: 0.4 });
      if (v === 2)
        b.play('door-creak-02', t + 0.6, 0.18, { lp: 2200, room: 0.4, dur: 1.2, release: 0.4 });
      break;
    }

    case 'claim':
      b.play('breath-02', t - 0.14, 0.3, { room: 0.3 });
      b.play('stomp-01', t, 0.55, { room: 0.5 });
      b.play('clap-03', t, 0.4, { room: 0.5 });
      b.thump(t, 0.35, 50);
      b.chord(chord(at<ChordName>(['Dm', 'Bb', 'A'], v)), t, 1.3, 0.09, { hall: 0.6 });
      break;

    case 'roleTown':
      b.play('match-strike-01', t - 0.3, 0.35, { room: 0.3 });
      b.play('stomp-03', t, 0.3, { lp: 1200, room: 0.4 });
      b.thump(t, 0.25, 50);
      if (v === 0) {
        b.chord(chord('F'), t, 3.6, 0.1, { hall: 0.7 });
      } else {
        b.chord(chord('Bb'), t, BEAT * 2 + 0.4, 0.1, { hall: 0.7 });
        b.chord(chord('F'), t + BEAT * 2, 3, 0.1, { hall: 0.7 });
      }
      b.play('hum-01', t + 0.05, 0.25, { rate: st(65 - 65.4), hall: 0.6, pan: -0.2 });
      b.sing(69, t + BEAT * 2, 2.4, 0.07, { hall: 0.7, pan: 0.25 });
      break;

    case 'roleMafia':
      b.play('stomp-02', t, 0.5, { lp: 700, room: 0.4, dur: 0.8 });
      b.thump(t, 0.45, 40);
      b.piano(26, t, 0.4, 4, { lp: 700 });
      b.piano(33, t + 0.01, 0.3, 4, { lp: 700 });
      b.hum(38, t, 3.6, 0.38, { kind: 'low', lp: 1400 });
      b.hum(45, t + 0.1, 3.5, 0.28, { lp: 1500 });
      if (v === 0) {
        b.bow('cello', 38, t, 3.6, 0.32, { pan: -0.2 });
        b.bow('cello', 45, t + BEAT, 3, 0.2, { pan: 0.2 });
      } else {
        b.bow('cello', 50, t, BEAT * 2, 0.3, { pan: -0.2 });
        b.bow('cello', 46, t + BEAT * 2, BEAT * 2, 0.3, { pan: -0.2 });
        b.bow('cello', 45, t + BEAT * 4, 2, 0.3, { pan: -0.2 });
        b.sing(51, t + BEAT, 2.6, 0.06, { lp: 1500, pan: 0.3 });
      }
      break;

    case 'roleNeutral':
      if (v === 0) {
        b.glass(81, t, 0.28, 3.6, { pan: -0.2 });
        b.glass(82, t + BEAT * 2, 0.14, 3, { pan: 0.35 });
        b.play('hum-02', t + BEAT, 0.32, { rate: st(74 - 77.1), hall: 0.6, pan: 0.1 });
      } else {
        b.glass(86, t, 0.26, 3.6, { pan: 0.25 });
        b.glass(81, t + BEAT * 2, 0.12, 3, { pan: -0.35 });
        b.play('hum-01', t + BEAT, 0.3, { rate: st(69 - 65.4), hall: 0.6 });
      }
      b.play('breath-03', t - 0.4, 0.2, { lp: 3500, room: 0.3 });
      break;

    case 'dayBreak':
      b.swell(t - 0.3, 1.6, 0.12, 500, 1600);
      if (v === 0) {
        b.play('match-strike-01', t - 0.15, 0.5, { room: 0.4 });
        b.play('breath-02', t - 0.12, 0.3, { room: 0.3 });
        b.chord(chord('Dmaj'), t, 2.4, 0.11, { hall: 0.7 });
        b.sing(74, t + 0.1, 2, 0.08, { hall: 0.8 });
      } else {
        b.play('stomp-01', t, 0.5, { room: 0.5 });
        b.play('clap-04', t, 0.35, { room: 0.5 });
        b.thump(t, 0.35, 50);
        b.chord(chord('F'), t, 2.6, 0.1, { hall: 0.7 });
        b.play('hum-01', t + 0.1, 0.25, { rate: st(69 - 65.4), hall: 0.6 });
      }
      break;

    case 'nightfall':
      if (v === 0) {
        // Lamps out, one candle at a time, each with a falling sung note.
        [69, 65, 62].forEach((m, k) => {
          b.play(k % 2 ? 'candle-blow-02' : 'candle-blow-01', t + k * BEAT, 0.45 - k * 0.08, {
            room: 0.4,
            pan: (k - 1) * 0.5,
          });
          b.sing(m, t + k * BEAT, 1.6, 0.08, { hall: 0.7, pan: (k - 1) * 0.3, attack: 0.08 });
        });
        b.hum(50, t + BEAT * 2, 3, 0.3, { hall: 0.6 });
        b.thump(t + BEAT * 2, 0.25, 44);
      } else if (v === 1) {
        // Fog: the shadows scatter.
        b.swell(t - 0.2, 2.6, 0.1, 300, 1200, 0.8);
        b.play('shh-group-01', t, 0.32, { hall: 0.5 });
        for (let k = 0; k < 6; k++)
          b.play(
            at(['footstep-01', 'footstep-02', 'footstep-03', 'footstep-04'], k),
            t + 0.1 + hash(k) * 1.2,
            0.22,
            {
              lp: 2000,
              room: 0.4,
              pan: hash(k + 7) * 1.8 - 0.9,
            },
          );
        b.sing(50, t, 3, 0.09, { hall: 0.7, pan: -0.2 });
        b.sing(57, t + BEAT, 2.5, 0.07, { hall: 0.7, pan: 0.2 });
        b.play('breath-03', t + 1.6, 0.25, { lp: 3500 });
      } else {
        // The watchman's lantern crosses and the town follows it.
        b.cross('footsteps-walk-01', t, 4, 0.3, -0.8, 0.8, 2400);
        b.play('chair-creak-01', t + BEAT, 0.18, { lp: 3000, pan: -0.4, room: 0.3 });
        b.bow('cello', 38, t, 3.6, 0.24, { pan: -0.1 });
        b.hum(50, t + BEAT, 3, 0.28, { hall: 0.6 });
        b.sing(57, t + BEAT * 2, 2, 0.06, { hall: 0.7, pan: 0.3 });
      }
      break;

    case 'dawnQuiet':
      if (v === 0) {
        b.play('dawn-birds-loop-01', t, 0.3, { offset: 6, attack: 0.8, dur: 3.2, release: 1.2 });
        b.play('breath-06', t, 0.25, { offset: 0.7, dur: 1.2, room: 0.3 });
      } else {
        b.play('church-bell-01', t, 0.35, { lp: 2500, dur: 3.5, release: 1.5, hall: 0.4 });
        b.play('dawn-birds-loop-01', t + 0.4, 0.22, { offset: 14, attack: 1, dur: 3, release: 1 });
      }
      b.sing(50, t, 3.4, 0.08, { hall: 0.6, pan: -0.3 });
      b.sing(57, t, 3.4, 0.07, { hall: 0.6, pan: 0.3 });
      b.sing(62, t + BEAT, 3, 0.06, { hall: 0.6 });
      b.bow('violin', 81, t + BEAT * 2, 2.6, 0.09, { pan: 0.3, hall: 0.7 });
      break;

    case 'dawnDeath':
      if (v === 0) {
        b.play('church-bell-02', t, 0.55, { lp: 1500, hall: 0.4 });
        b.play('gasp-01', t + 0.1, 0.4, { room: 0.3 });
      } else {
        b.play('church-bell-01', t, 0.5, {
          rate: st(-2),
          lp: 1800,
          dur: 3.6,
          release: 1.5,
          hall: 0.4,
        });
        b.play('gasp-crowd-01', t + 0.1, 0.35, { room: 0.3 });
        b.play('sigh-02', t + BEAT * 4, 0.25, { hall: 0.4 });
      }
      b.sing(50, t + 0.1, 3.4, 0.1, { hall: 0.6, pan: -0.25 });
      b.sing(53, t + 0.1, 3.4, 0.08, { hall: 0.6, pan: 0.25 });
      b.bow('cello', 38, t, 3.4, 0.26, { pan: -0.1 });
      break;

    case 'deathMafia': {
      // Stomps closing in from both sides, then a low cluster.
      const beats = v ? [0, 0.75, 1.25, 1.5, 1.75] : [0, 0.5, 1, 1.5, 1.75];
      beats.forEach((d, k) => {
        const side = k % 2 ? 1 : -1;
        b.play(at(STOMPS, k + 1), t + d * BEAT, 0.3 + k * 0.1, {
          room: 0.4,
          pan: side * (0.9 - k * 0.2),
          lp: 1600 + k * 600,
        });
        b.thump(t + d * BEAT, 0.2 + k * 0.07, 46);
      });
      const hit = t + BEAT * 2;
      b.play('gasp-02', hit - 0.12, 0.35, { room: 0.3 });
      b.play('stomp-02', hit, 0.75, { room: 0.5, dur: 1 });
      b.thump(hit, 0.6, 40);
      [26, 27, 33].forEach((m) => b.piano(m, hit, 0.35, 3.5, { lp: 800 }));
      b.bow('cello', 38, hit, 2.6, 0.3, { pan: -0.1 });
      b.hum(38, hit, 2.6, 0.3, { kind: 'low', lp: 1300 });
      break;
    }

    case 'deathCutthroat':
      b.play(v ? 'breath-02' : 'gasp-01', t - 0.18, 0.55, { room: 0.3 });
      b.play(v ? 'chest-slap-02' : 'slap-03', t, 0.8, { room: 0.5, hall: 0.6 });
      b.play(v ? 'slap-01' : 'clap-03', t + 0.005, 0.5, { hall: 0.7 });
      b.thump(t, 0.5, 70);
      b.swell(t + 0.05, 1.5, 0.05, 2400, 300, 0.9);
      break;

    case 'deathReckoner':
      b.play(v ? 'clap-04' : 'clap-03', t, 0.75, { hall: 0.8 });
      b.play('snap-01', t, 0.45, { hall: 0.5 });
      b.crack(t, 0.5);
      b.thump(t, 0.45, 80);
      if (v === 0) {
        b.play('handbell-01', t + 0.01, 0.42, { rate: st(86 - 88.3), hall: 0.6 });
        b.play('glass-clink-01', t + 0.02, 0.22, { hall: 0.5 });
      } else {
        b.play('handbell-03', t + 0.01, 0.4, { dur: 3.5, release: 1, hall: 0.6 });
      }
      b.glass(81, t + 0.1, 0.12, 3, { pan: 0.2 });
      break;

    case 'deathGuard': {
      // Two shadows struggle: slaps, grunts, a scuffle, then the fall.
      const hits = v
        ? ['chest-slap-01', 'slap-02', 'slap-01', 'chest-slap-02', 'slap-03']
        : ['slap-01', 'chest-slap-02', 'slap-03', 'slap-02', 'chest-slap-01'];
      const when = v ? [0, 1, 1.75, 2.5, 3] : [0, 0.75, 1.5, 2, 3];
      hits.forEach((h, k) =>
        b.play(h, t + at(when, k) * BEAT * 0.5, 0.5 + hash(k) * 0.2, {
          room: 0.5,
          pan: k % 2 ? 0.3 : -0.3,
        }),
      );
      b.play(v ? 'gasp-03' : 'gasp-02', t + BEAT * 0.4, 0.4, { room: 0.3, pan: -0.2 });
      b.play('breath-01', t + BEAT * 1.1, 0.35, { room: 0.3, pan: 0.2 });
      b.play('footstep-05', t + BEAT * 0.8, 0.35, { room: 0.4 });
      const fall = t + BEAT * 2;
      b.play('stomp-02', fall, 0.7, { room: 0.5, dur: 0.9 });
      b.thump(fall, 0.55, 40);
      b.play('sigh-01', fall + 0.5, 0.3, { hall: 0.4 });
      b.bow('cello', 38, fall, 2.2, 0.2);
      break;
    }

    case 'deathExecuted': {
      // The lamp is lowered: a descending cello line and a long breath out.
      const line = v ? [50, 45, 43, 38] : [57, 53, 52, 50];
      line.forEach((m, k) =>
        b.bow('cello', m, t + k * BEAT, k === 3 ? 2.4 : BEAT + 0.15, 0.3, {
          pan: -0.1,
          attack: 0.08,
        }),
      );
      b.swell(t, BEAT * 4, 0.08, 1600, 200, 0.6);
      b.play(v ? 'breath-06' : 'sigh-03', t + BEAT * 3, 0.35, { offset: v ? 0.5 : 2.4, hall: 0.4 });
      b.hum(50, t + BEAT * 3, 2, 0.16, { hall: 0.6 });
      break;
    }

    case 'trial':
      b.play('stomp-02', t, 0.7, { room: 0.5, dur: 0.8 });
      b.play(v ? 'chest-slap-01' : 'clap-04', t, 0.45, { room: 0.5 });
      b.thump(t, 0.55, 44);
      b.play('gasp-crowd-01', t + 0.05, 0.35, { room: 0.3 });
      if (v === 0) {
        b.sing(50, t, 2.6, 0.11, { hall: 0.6, pan: -0.3, attack: 0.1 });
        b.sing(51, t, 2.6, 0.09, { hall: 0.6, pan: 0.3, attack: 0.1 });
        b.bow('cello', 38, t, 2.6, 0.32, { attack: 0.04 });
      } else {
        b.sing(62, t, 2.6, 0.09, { hall: 0.6, pan: -0.3, attack: 0.1 });
        b.sing(63, t, 2.6, 0.08, { hall: 0.6, pan: 0.3, attack: 0.1 });
        b.bow('violin', 82, t, 2.6, 0.12, { attack: 0.04, pan: 0.2 });
        b.bow('cello', 39, t, 2.6, 0.26, { attack: 0.04 });
      }
      break;

    case 'guilty':
      for (let k = 0; k < 6; k++)
        b.play(at(STOMPS, k), t + hash(k + v * 7) * 0.035, 0.42, {
          pan: (k / 5) * 1.4 - 0.7,
          room: 0.5,
          dur: 0.8,
        });
      b.play('clap-04', t + 0.02, 0.5, { hall: 0.4 });
      b.thump(t, 0.7, 40);
      b.play('gasp-crowd-01', t + 0.18, 0.45, { hall: 0.5 });
      if (v === 0) {
        b.chord(chord('Dm'), t + 0.2, 3.4, 0.13, { hall: 0.7 });
        b.sing(51, t + 0.2, 3.4, 0.09, { pan: 0.3, hall: 0.7 });
      } else {
        b.piano(26, t, 0.45, 4, { lp: 900 });
        b.piano(33, t, 0.35, 4, { lp: 900 });
        b.bow('cello', 38, t, 3.4, 0.3, { pan: -0.3, attack: 0.05 });
        b.bow('violin', 74, t, 3.2, 0.12, { pan: 0.2, attack: 0.05 });
        b.bow('violin', 75, t, 3.2, 0.1, { pan: 0.35, attack: 0.05 });
      }
      break;

    case 'innocent':
      b.play(v ? 'sigh-02' : 'breath-06', t - 0.3, 0.35, {
        offset: v ? 0 : 0.6,
        dur: 1.6,
        room: 0.3,
      });
      if (v === 0) b.play('applause-slow-01', t, 0.35, { room: 0.4 });
      else
        for (let k = 0; k < 4; k++)
          b.play('clap-02', t + k * BEAT, 0.35 - k * 0.04, { room: 0.5, pan: 0.2 });
      b.chord(chord('F'), t, 3, 0.08, { hall: 0.7 });
      b.play('hum-01', t + BEAT, 0.2, { rate: st(65 - 65.4), hall: 0.6 });
      break;

    case 'reveal':
      if (v === 0) {
        b.play('gasp-crowd-01', t, 0.4, { hall: 0.4 });
        b.play('stomp-02', t + 0.03, 0.6, { room: 0.5, dur: 0.8 });
        b.thump(t + 0.03, 0.5, 44);
        b.chord(chord('Bb'), t + 0.05, 3.2, 0.13, { hall: 0.7 });
        b.sing(77, t + 0.2, 2.8, 0.08, { hall: 0.7 });
      } else {
        [50, 57, 62, 65, 69].forEach((m, k) =>
          b.piano(m, t + k * BEAT * 0.25, 0.32 - k * 0.03, 3.5, {
            pan: k * 0.12 - 0.25,
            hall: 0.5,
          }),
        );
        b.glass(81, t + 0.2, 0.2, 3.4, { pan: 0.3 });
        b.play('stomp-03', t, 0.4, { lp: 1200, room: 0.4 });
      }
      b.play('handbell-01', t + 0.02, 0.18, { rate: st(86 - 88.3), hall: 0.6, pan: 0.3 });
      break;

    case 'will':
      if (v === 0) b.play('letter-unfold-01', t, 0.5, { room: 0.3 });
      else {
        b.play('paper-rustle-02', t, 0.4, { room: 0.3 });
        b.play('letter-unfold-01', t + 0.3, 0.35, { offset: 0.8, room: 0.3 });
      }
      b.play(v ? 'hum-03' : 'hum-01', t + 0.4, 0.25, {
        rate: v ? st(50 - 50.8) : st(62 - 65.4),
        hall: 0.5,
        dur: 3.2,
        release: 0.8,
      });
      break;

    case 'win':
      b.play('stomp-01', t, 0.55, { room: 0.5 });
      b.play('clap-04', t, 0.4, { room: 0.5 });
      b.thump(t, 0.4, 50);
      if (v === 0) {
        b.chord(chord('Bb'), t, BEAT + 0.3, 0.1, { hall: 0.6 });
        b.play('stomp-04', t + BEAT, 0.5, { room: 0.5 });
        b.chord(chord('C'), t + BEAT, BEAT + 0.3, 0.1, { hall: 0.6 });
        b.play('stomp-02', t + BEAT * 2, 0.6, { room: 0.5, dur: 0.8 });
        b.thump(t + BEAT * 2, 0.45, 46);
        b.chord(chord('Dmaj'), t + BEAT * 2, BAR, 0.11, { hall: 0.7 });
        b.play('choir-phrase-06', t + BEAT * 2.5, 0.2, { hall: 0.7 });
      } else {
        b.chord(chord('Dmaj'), t, BAR + 0.5, 0.11, { hall: 0.7 });
        b.sing(74, t + BEAT, BAR - BEAT, 0.07, { hall: 0.8, pan: 0.2 });
        b.play('applause-slow-01', t + BEAT * 2, 0.25, { room: 0.4 });
      }
      break;

    case 'lose':
      if (v === 0) {
        [69, 65, 62].forEach((m, k) =>
          b.sing(m, t + k * BEAT, k === 2 ? 2.6 : BEAT + 0.3, 0.09, { hall: 0.7, attack: 0.08 }),
        );
        b.play('sigh-03', t + BEAT * 3, 0.3, { offset: 2.4, hall: 0.4 });
      } else {
        b.hum(38, t, 3.4, 0.32, { kind: 'low', lp: 1400 });
        b.piano(38, t, 0.35, 3.5, { lp: 900 });
        b.piano(45, t + 0.02, 0.25, 3.5, { lp: 900 });
        b.play('breath-06', t + BEAT * 2, 0.3, { offset: 0.6, room: 0.3 });
      }
      b.bow('cello', 38, t, 3.4, 0.24, { pan: -0.2 });
      break;
  }
}
