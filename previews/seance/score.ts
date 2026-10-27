import {
  impulse,
  noiseBed,
  reverb,
  rng,
  steps,
  voice,
  type Bed,
  type Score,
} from '../shared/audio-kit.ts';
import { byName, pick, SampleBank, type PlayOptions } from '../shared/samples.ts';

/*
 * Séance: close, quiet, human. A parlour room tone under one candle; breath, whispers that
 * circle the listener, humming; a felt piano (pitch-shifted grand piano with its hammers
 * muffled by a lowpass), a bowed cello drone, rubbed wine glasses, and knocks on the oak table.
 * Key of F-sharp minor; the rubbed A-sharp glass is the only major light (dawn).
 */

const ALL = byName(
  import.meta.glob('../../src/audio/samples/*.mp3', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>,
);

const PIANO: [string, number][] = [
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
const CELLO: [string, number][] = [
  ['cello-sus-C2', 36],
  ['cello-sus-G2', 43],
  ['cello-sus-D3', 50],
  ['cello-sus-A3', 57],
];
const GLASS: [string, number][] = [
  ['glass-rub-Fs5', 78],
  ['glass-rub-Gs5', 80],
  ['glass-rub-A5', 81],
  ['glass-rub-As5', 82],
  ['glass-rub-Fs6', 90],
];
const WHISPERS = ['whisper-01', 'whisper-02', 'whisper-03', 'whisper-05'];
const KNOCKS = ['knock-01', 'knock-03', 'knock-04'];
const GASPS = ['gasp-01', 'gasp-02', 'gasp-03'];
const OTHER = [
  ...WHISPERS,
  ...KNOCKS,
  ...GASPS,
  'whisper-06',
  'knock-05',
  'knock-06',
  'breath-01',
  'breath-02',
  'breath-03',
  'breath-04',
  'breath-06',
  'hum-01',
  'hum-03',
  'hum-group-01',
  'candle-blow-01',
  'candle-blow-02',
  'candle-flame-loop-01',
  'match-strike-01',
  'clock-tick-loop-01',
  'night-crickets-loop-01',
  'dawn-birds-loop-01',
  'heartbeat-01',
  'church-bell-01',
  'church-bell-02',
  'gasp-crowd-01',
  'sigh-01',
  'chair-creak-03',
  'glass-clink-02',
];
const SAMPLE_NAMES = [
  ...PIANO.map((p) => p[0]),
  ...CELLO.map((p) => p[0]),
  ...GLASS.map((p) => p[0]),
  ...OTHER,
];
const bank = new SampleBank(pick(ALL, SAMPLE_NAMES));

/** The sample nearest to `midi` and the playback rate that tunes it there. */
const nearest = (set: [string, number][], midi: number): [string, number] => {
  let best = set[0] ?? ['', 0];
  for (const s of set) if (Math.abs(s[1] - midi) < Math.abs(best[1] - midi)) best = s;
  return [best[0], 2 ** ((midi - best[1]) / 12)];
};

const hash = (i: number) => {
  const x = Math.sin(i * 91.7 + 17.3) * 43758.5453;
  return x - Math.floor(x);
};

// F-sharp minor: [bass, chord tones] per bar.
const PROG: [number, number[]][] = [
  [42, [54, 57, 61]],
  [38, [54, 57, 62]],
  [45, [57, 61, 64]],
  [40, [56, 59, 64]],
];
// The table's theme on felt piano: [beat within 16-beat phrase, midi, beats].
const THEME: [number, number, number][] = [
  [0, 66, 1],
  [1, 69, 1],
  [2, 73, 2],
  [4, 71, 1],
  [5, 69, 1],
  [6, 68, 2],
  [8, 66, 1],
  [9, 64, 1],
  [10, 66, 1],
  [11, 61, 1],
  [12, 62, 2],
  [14, 61, 2],
];

export const seanceScore: Score = {
  beds: ['title', 'night', 'day', 'trial'],
  stings: [
    'knock',
    'reveal',
    'dawn',
    'vote',
    'verdict',
    'death',
    'blowout',
    'whisper',
    'match',
    'gutter',
    'gasp',
    'voice',
    'chime',
  ],

  prepare: (ctx, onProgress) => bank.load(ctx, onProgress),

  create(ctx, out) {
    const room = impulse(ctx, 2.4, 2.8, { darkness: 0.62, seed: 21, predelay: 0.012 });
    const stingVerb = reverb(ctx, room, out, 0.8);
    let knockN = 0;
    let voteN = 0;
    let gaspN = 0;
    let voiceN = 0;

    const play = (o: AudioNode, name: string, t: number, opt: PlayOptions = {}) =>
      bank.play(ctx, o, name, t, opt);

    /** Felt piano: a pitch-shifted grand, darkened and doubled a few cents apart. */
    const piano = (
      o: AudioNode,
      t: number,
      midi: number,
      vel = 0.4,
      dur = 3,
      pan = 0,
      send?: AudioNode,
    ) => {
      const [name, rate] = nearest(PIANO, midi);
      const filter = { type: 'lowpass' as BiquadFilterType, freq: 700 + vel * 1500, q: 0.4 };
      play(o, name, t, {
        gain: vel,
        rate,
        dur,
        release: 1.4,
        attack: 0.008,
        filter,
        pan,
        send,
        sendGain: 0.5,
      });
      play(o, name, t + 0.004, {
        gain: vel * 0.35,
        rate: rate * 1.0035,
        dur,
        release: 1.4,
        attack: 0.01,
        filter,
        pan: -pan,
      });
    };

    /** A bowed cello note held by overlapping re-bows of the sustain sample. */
    const cello = (o: AudioNode, t: number, midi: number, gain = 0.3, len = 2.6, pan = 0) => {
      const [name, rate] = nearest(CELLO, midi);
      play(o, name, t, { gain, rate, offset: 0.25, dur: len, attack: 0.7, release: 0.9, pan });
    };

    const glass = (o: AudioNode, t: number, midi: number, gain = 0.2, len = 3.5, pan = 0) => {
      const [name, rate] = nearest(GLASS, midi);
      play(o, name, t, { gain, rate, offset: 0.2, dur: len, attack: 1.1, release: 1.4, pan });
    };

    /** A whisper that travels around the listener's head (pan sweep, darker when behind). */
    const circling = (
      o: AudioNode,
      t: number,
      name: string,
      dur: number,
      gain: number,
      seed: number,
    ) => {
      const p = ctx.createStereoPanner();
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.connect(p).connect(o);
      const n = 32;
      const pans = new Float32Array(n);
      const freqs = new Float32Array(n);
      const start = hash(seed) * Math.PI * 2;
      const dir = seed % 2 ? 1 : -1;
      for (let i = 0; i < n; i++) {
        const ph = start + dir * (i / (n - 1)) * Math.PI * 1.4;
        pans[i] = Math.sin(ph) * 0.95;
        freqs[i] = 2600 + 2400 * Math.cos(ph);
      }
      p.pan.setValueCurveAtTime(pans, t, dur);
      f.frequency.setValueCurveAtTime(freqs, t, dur);
      const off = hash(seed + 3) * Math.max(0, bank.duration(name) - dur);
      play(f, name, t, { gain, offset: off, dur, attack: 0.5, release: 0.6 });
    };

    /** A knock on the oak: the recorded knock plus the table's low body. */
    const knock = (o: AudioNode, t: number, gain = 0.9, name?: string, pan = 0) => {
      const n = name ?? KNOCKS[knockN++ % KNOCKS.length] ?? 'knock-01';
      play(o, n, t, {
        gain,
        rate: 0.92 + hash(knockN) * 0.12,
        pan,
        send: stingVerb,
        sendGain: 0.35,
      });
      voice(ctx, o, {
        t,
        freq: 96,
        glideTo: 70,
        glideTime: 0.12,
        dur: 0.12,
        gain: gain * 0.35,
        env: { a: 0.002, d: 0.12, s: 0, r: 0.08 },
        pan,
      });
    };

    const roomTone = (o: AudioNode, t: number, flame = 0.35) => {
      const v = play(o, 'candle-flame-loop-01', t, { gain: flame, loop: true, attack: 1.2 });
      const n = noiseBed(ctx, o, t, { color: 'brown', type: 'lowpass', freq: 380, gain: 0.05 });
      return {
        stop(at: number) {
          v?.stop(at, 0.3);
          n.stop(at);
        },
      };
    };

    const bed = (name: string, bedOut: AudioNode): Bed => {
      const verb = reverb(ctx, room, bedOut, 1);
      const wet = ctx.createGain();
      wet.gain.value = 0.55;
      wet.connect(verb);
      const mix = ctx.createGain();
      mix.gain.value = name === 'title' || name === 'night' ? 0.62 : 1;
      mix.connect(bedOut);
      mix.connect(wet);
      let origin = 0;
      const stops: { stop(t: number): void }[] = [];

      if (name === 'title') {
        return {
          start(t) {
            origin = t;
            stops.push(roomTone(bedOut, t, 0.32));
          },
          schedule(from, to) {
            // Cello pedal on F-sharp and C-sharp, re-bowed every 2.4 s.
            steps(origin, 60, 1 / 2.4, from, to, (i, t) => {
              cello(mix, t, 42, 0.34, 2.6, -0.2);
              if (i % 2 === 1) cello(mix, t + 0.3, 49, 0.2, 2.4, 0.25);
            });
            // Humming voices, swelling every 8 s.
            steps(origin + 0.5, 60, 1 / 8, from, to, (_i, t) =>
              play(mix, 'hum-group-01', t, {
                gain: 0.42,
                rate: 2 ** (1 / 12),
                attack: 1.6,
                dur: 6.2,
                release: 1.6,
              }),
            );
            steps(origin + 4, 60, 1 / 8, from, to, (i, t) =>
              glass(wet, t, i % 2 ? 81 : 78, 0.16, 3.6, i % 2 ? 0.4 : -0.4),
            );
            // The felt-piano theme (one beat per second), entering after a bar.
            steps(origin + 2, 60, 1, from, to, (i, t) => {
              const beat = i % 16;
              const bar = Math.floor(beat / 4);
              const [bass, chord] = PROG[bar] ?? PROG[0]!;
              if (beat % 4 === 0) {
                piano(mix, t, bass, 0.34, 3.6, -0.25, wet);
                chord.forEach((m, k) => piano(mix, t + 0.05 + k * 0.07, m, 0.12, 3, 0.15, wet));
              }
              if (i >= 4)
                for (const [b, m, len] of THEME)
                  if (b === beat) piano(mix, t, m, 0.3, len + 0.6, 0.1, wet);
            });
          },
          stop(t) {
            for (const s of stops) s.stop(t);
          },
        };
      }

      if (name === 'night') {
        return {
          start(t) {
            origin = t;
            stops.push(roomTone(bedOut, t, 0.24));
            const c = play(bedOut, 'night-crickets-loop-01', t, {
              gain: 0.06,
              loop: true,
              attack: 2,
              filter: { type: 'lowpass', freq: 2600 },
            });
            if (c) stops.push(c);
          },
          schedule(from, to) {
            steps(origin, 60, 1 / 2.4, from, to, (i, t) => {
              cello(mix, t, 42, 0.36, 2.6, 0);
              if (i % 4 === 2) cello(mix, t + 0.6, 43, 0.16, 3, 0.3);
            });
            // Whispers circle the table, never quite in the same place.
            steps(origin + 0.8, 60, 1 / 3.1, from, to, (i, t) =>
              circling(mix, t, WHISPERS[i % WHISPERS.length] ?? 'whisper-01', 3.6, 0.42, i + 7),
            );
            steps(origin + 2.5, 60, 1 / 6.5, from, to, (i, t) =>
              play(bedOut, i % 2 ? 'breath-06' : 'breath-03', t, {
                gain: 0.32,
                filter: { type: 'lowpass', freq: 3800 },
                pan: (hash(i) - 0.5) * 0.4,
              }),
            );
            steps(origin + 4, 60, 1 / 10, from, to, (i, t) =>
              play(wet, 'hum-03', t, {
                gain: 0.32,
                rate: 2 ** (-1.8 / 12),
                attack: 1.2,
                dur: 3.6,
                release: 1.2,
                pan: i % 2 ? 0.3 : -0.3,
              }),
            );
            steps(origin + 6, 60, 1 / 11, from, to, (_i, t) => glass(wet, t, 90, 0.08, 4, 0.5));
            steps(origin + 1, 60, 1 / 4.8, from, to, (i, t) =>
              piano(mix, t, [42, 49, 45, 40][i % 4] ?? 42, 0.24, 4, -0.3, wet),
            );
          },
          stop(t) {
            for (const s of stops) s.stop(t);
          },
        };
      }

      if (name === 'day') {
        return {
          start(t) {
            origin = t;
            stops.push(roomTone(bedOut, t, 0.22));
            const c = play(bedOut, 'clock-tick-loop-01', t, {
              gain: 0.2,
              loop: true,
              attack: 0.6,
              pan: 0.35,
            });
            if (c) stops.push(c);
          },
          schedule(from, to) {
            steps(origin, 72, 1, from, to, (i, t) => {
              const beat = i % 4;
              const bar = Math.floor(i / 4);
              const [bass, chord] = PROG[bar % 4] ?? PROG[0]!;
              if (beat === 0) {
                piano(mix, t, bass, 0.3, 3, -0.3, wet);
                cello(mix, t, bass + 12, 0.18, 3, -0.1);
              }
              const m = chord[(beat + bar) % chord.length] ?? 61;
              piano(
                mix,
                t + 0.02,
                m + (beat === 3 ? 12 : 0),
                0.15 + (beat === 0 ? 0.04 : 0),
                1.8,
                0.25,
                wet,
              );
              if (beat === 2) piano(mix, t + 0.42, chord[2] ?? 61, 0.09, 1.2, 0.35, wet);
            });
            steps(origin + 6.6, 72, 1 / 16, from, to, (_i, t) =>
              play(wet, 'hum-01', t, {
                gain: 0.26,
                rate: 2 ** (0.6 / 12),
                attack: 0.6,
                dur: 3.6,
                release: 0.8,
              }),
            );
            steps(origin + 3, 60, 1 / 9, from, to, (i, t) =>
              play(bedOut, 'chair-creak-03', t, {
                gain: 0.12,
                pan: i % 2 ? -0.6 : 0.6,
                filter: { type: 'lowpass', freq: 3000 },
              }),
            );
          },
          stop(t) {
            for (const s of stops) s.stop(t);
          },
        };
      }

      // trial: a heartbeat and a trembling tritone, the glasses rubbing a semitone apart.
      const trem = ctx.createGain();
      trem.gain.value = 0.6;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 6.2;
      const depth = ctx.createGain();
      depth.gain.value = 0.35;
      lfo.connect(depth).connect(trem.gain);
      trem.connect(mix);
      return {
        start(t) {
          origin = t;
          stops.push(roomTone(bedOut, t, 0.2));
          lfo.start(t);
          stops.push({ stop: (at: number) => lfo.stop(at) });
        },
        schedule(from, to) {
          steps(origin, 60, 1 / 4.05, from, to, (_i, t) =>
            play(bedOut, 'heartbeat-01', t, { gain: 0.6, filter: { type: 'lowpass', freq: 900 } }),
          );
          steps(origin, 60, 1 / 2.4, from, to, (i, t) => {
            cello(trem, t, 42, 0.38, 2.6, -0.3);
            cello(trem, t + 0.15, 48, 0.24, 2.6, 0.3);
            if (i % 3 === 2) cello(trem, t + 0.4, 37, 0.3, 2.8, 0);
          });
          steps(origin + 1, 60, 1 / 6, from, to, (i, t) => {
            glass(wet, t, 80, 0.12, 4, -0.5);
            glass(wet, t + 0.4, 81, 0.1, 4, 0.5);
            if (i % 2) piano(mix, t, 30, 0.42, 4, 0, wet);
          });
          steps(origin + 3.2, 60, 1 / 7.5, from, to, (_i, t) =>
            play(bedOut, 'breath-04', t, { gain: 0.2, filter: { type: 'lowpass', freq: 2500 } }),
          );
        },
        stop(t) {
          for (const s of stops) s.stop(t);
        },
      };
    };

    const sting = (name: string, t: number) => {
      const o = out;
      const v = stingVerb;
      const r = rng(Math.floor(t * 1000));
      switch (name) {
        case 'knock':
          knock(o, t, 0.95, undefined, (r() - 0.5) * 0.5);
          break;
        case 'vote': {
          const n = voteN++;
          knock(o, t, 1, n % 2 ? 'knock-04' : 'knock-01', (r() - 0.5) * 0.6);
          piano(o, t, [42, 44, 45, 47, 49, 50, 52][n % 7] ?? 42, 0.45, 2.4, 0, v);
          break;
        }
        case 'chime':
          play(o, 'glass-clink-02', t, {
            gain: 0.5,
            send: v,
            sendGain: 0.5,
            pan: (r() - 0.5) * 0.6,
          });
          glass(v, t, 90, 0.28, 1.6, 0.2);
          glass(o, t, 90, 0.16, 1.4, 0.2);
          break;
        case 'gasp':
          play(o, GASPS[gaspN++ % GASPS.length] ?? 'gasp-01', t, {
            gain: 0.55,
            send: v,
            sendGain: 0.3,
            pan: (r() - 0.5) * 0.7,
          });
          break;
        case 'voice':
          play(o, voiceN++ % 2 ? 'breath-01' : 'breath-03', t, {
            gain: 0.55,
            filter: { type: 'lowpass', freq: 4500 },
            send: v,
            sendGain: 0.2,
            pan: (r() - 0.5) * 0.5,
          });
          break;
        case 'whisper':
          play(o, 'whisper-06', t, { gain: 0.85, send: v, sendGain: 0.3, pan: -0.15 });
          circling(v, t + 0.3, 'whisper-05', 3.4, 0.5, 3);
          circling(o, t + 0.2, 'whisper-02', 3.6, 0.35, 8);
          break;
        case 'match':
          play(o, 'match-strike-01', t, { gain: 0.9, send: v, sendGain: 0.25 });
          play(o, 'candle-flame-loop-01', t + 0.3, {
            gain: 0.6,
            offset: 3,
            dur: 3.2,
            attack: 0.4,
            release: 1.2,
          });
          glass(v, t + 0.5, 78, 0.22, 3.4, 0);
          break;
        case 'gutter':
          play(o, 'candle-blow-02', t, {
            gain: 0.5,
            rate: 0.55,
            filter: { type: 'lowpass', freq: 1200 },
          });
          play(o, 'candle-flame-loop-01', t, {
            gain: 0.6,
            offset: 9,
            dur: 2.6,
            attack: 0.1,
            release: 1.5,
          });
          cello(v, t + 0.2, 37, 0.35, 3, 0);
          play(v, 'hum-group-01', t + 0.6, {
            gain: 0.35,
            rate: 2 ** (-4 / 12),
            attack: 1,
            dur: 3.4,
            release: 1.4,
          });
          break;
        case 'blowout':
          play(o, 'breath-02', t, { gain: 0.55, rate: 0.85 });
          play(o, 'candle-blow-01', t + 0.45, { gain: 1, send: v, sendGain: 0.25 });
          play(o, 'candle-flame-loop-01', t, { gain: 0.5, offset: 5, dur: 0.6, release: 0.2 });
          glass(v, t + 1.2, 78, 0.2, 3.4, 0);
          break;
        case 'death':
          play(v, 'church-bell-02', t, { gain: 0.75, filter: { type: 'lowpass', freq: 1800 } });
          play(o, 'church-bell-02', t, { gain: 0.35, filter: { type: 'lowpass', freq: 1200 } });
          cello(o, t + 0.1, 30, 0.6, 3.4, 0);
          play(v, 'hum-group-01', t + 0.4, {
            gain: 0.5,
            rate: 2 ** (-11 / 12),
            attack: 1.2,
            dur: 3.6,
            release: 1.5,
          });
          play(o, 'sigh-01', t + 1.6, { gain: 0.45, send: v, sendGain: 0.3, pan: 0.2 });
          break;
        case 'reveal':
          [54, 61, 66, 68, 69].forEach((m, k) =>
            piano(o, t + k * 0.11, m, 0.36 - k * 0.03, 4, k * 0.12 - 0.25, v),
          );
          glass(v, t + 0.2, 81, 0.3, 3.8, 0.3);
          glass(v, t + 0.6, 78, 0.22, 3.6, -0.3);
          play(v, 'hum-01', t + 0.4, {
            gain: 0.42,
            rate: 2 ** (0.6 / 12),
            attack: 0.8,
            dur: 3.4,
            release: 1.2,
          });
          break;
        case 'dawn':
          play(v, 'church-bell-01', t, {
            gain: 0.65,
            filter: { type: 'lowpass', freq: 2400 },
            dur: 6,
            release: 2,
          });
          play(o, 'dawn-birds-loop-01', t + 0.3, {
            gain: 0.16,
            offset: 4,
            attack: 1.5,
            dur: 4.5,
            release: 1.5,
            filter: { type: 'lowpass', freq: 3500 },
          });
          glass(v, t + 0.4, 82, 0.3, 4, 0.2);
          [66, 70, 73].forEach((m, k) => piano(o, t + 0.9 + k * 0.4, m, 0.24, 3, 0.2 - k * 0.2, v));
          play(o, 'breath-03', t + 2, { gain: 0.45, send: v, sendGain: 0.25 });
          break;
        case 'verdict':
          [0, 0.3, 0.6].forEach((d, k) => knock(o, t + d, 1, k === 2 ? 'knock-04' : 'knock-01', 0));
          play(o, 'knock-06', t + 0.9, { gain: 0.6, send: v, sendGain: 0.4 });
          piano(o, t + 0.6, 30, 0.8, 4, -0.1, v);
          piano(o, t + 0.6, 36, 0.6, 4, 0.1, v);
          piano(o, t + 0.6, 42, 0.5, 4, 0, v);
          cello(v, t + 0.6, 42, 0.5, 3.2, 0);
          play(o, 'gasp-crowd-01', t + 0.9, { gain: 0.45, send: v, sendGain: 0.3 });
          glass(v, t + 1, 80, 0.16, 3.4, -0.4);
          glass(v, t + 1, 81, 0.14, 3.4, 0.4);
          break;
      }
    };

    return { bed, sting };
  },
};
