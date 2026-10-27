import {
  impulse,
  noiseBed,
  noiseHit,
  reverb,
  rng,
  steps,
  voice,
  type Bed,
  type Score,
} from '../shared/audio-kit.ts';
import { byName, pick, SampleBank, type PlayOptions } from '../shared/samples.ts';

/*
 * Scrim: a cappella voices and body percussion on a wooden stage. Sung single notes are
 * pitch-shifted and overlapped in grains to build sustained chords; claps, stomps, snaps,
 * chest and thigh slaps make the rhythm; breath, hums and whispers are the room. Synthesis
 * only adds sub thumps under stomps, a soft room tone and the reverb. Key of D minor.
 */

const ALL = byName(
  import.meta.glob('../shared/samples/*.mp3', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>,
);

const NAMES = [
  'choir-sus-F3',
  'choir-sus-As3',
  'choir-sus-A4',
  'choir-sus-E4',
  'choir-sus-Fs4',
  'choir-sus-G4',
  'choir-phrase-02',
  'choir-phrase-06',
  'hum-group-01',
  'hum-01',
  'hum-03',
  'breath-02',
  'breath-03',
  'breath-04',
  'breath-06',
  'sigh-03',
  'gasp-01',
  'gasp-crowd-01',
  'shh-02',
  'whisper-01',
  'whisper-03',
  'whisper-05',
  'murmur-loop-01',
  'murmur-trial-01',
  'clap-03',
  'clap-04',
  'stomp-01',
  'stomp-02',
  'stomp-03',
  'stomp-04',
  'snap-01',
  'snap-02',
  'slap-01',
  'slap-02',
  'slap-03',
  'chest-slap-01',
  'chest-slap-02',
  'footstep-05',
  'match-strike-01',
  'candle-blow-02',
  'candle-flame-loop-01',
] as const;
type Sample = (typeof NAMES)[number];

const bank = new SampleBank(pick(ALL, NAMES));

/** Sung sustained notes: MIDI pitch and the steady part of each recording (seconds). */
const SINGERS: { name: Sample; midi: number; s0: number; s1: number }[] = [
  { name: 'choir-sus-F3', midi: 53, s0: 0.35, s1: 5.2 },
  { name: 'choir-sus-As3', midi: 58, s0: 0.25, s1: 3.8 },
  { name: 'choir-sus-E4', midi: 64, s0: 0.6, s1: 3.9 },
  { name: 'choir-sus-Fs4', midi: 66, s0: 0.2, s1: 3.1 },
  { name: 'choir-sus-G4', midi: 67, s0: 0.3, s1: 2.85 },
  { name: 'choir-sus-A4', midi: 69, s0: 0.45, s1: 3.35 },
];

const CHORDS = {
  Dm: [50, 57, 62, 65],
  Bb: [46, 58, 62, 65],
  F: [53, 57, 60, 65],
  C: [48, 55, 64, 67],
  Gm: [43, 58, 62, 67],
  A: [45, 57, 61, 64],
  Dmaj: [50, 57, 62, 66],
} as const;
type Chord = keyof typeof CHORDS;

const peaks = new Map<string, number>();
/** Gain that brings a sample's peak to full scale (the library is not normalised). */
function norm(name: Sample): number {
  const hit = peaks.get(name);
  if (hit !== undefined) return hit;
  const buf = bank.get(name);
  if (!buf) return 1;
  let p = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i += 2) {
      const x = Math.abs(d[i] ?? 0);
      if (x > p) p = x;
    }
  }
  const g = p > 0 ? 1 / p : 1;
  peaks.set(name, g);
  return g;
}

export const scrimScore: Score = {
  beds: ['title', 'night', 'day', 'trial', 'lament'],
  stings: [
    'lamp',
    'cut',
    'reveal',
    'dusk',
    'dawn',
    'vote',
    'stomp',
    'snap',
    'verdict',
    'fall',
    'death',
  ],
  prepare: (ctx, onProgress) => bank.load(ctx, onProgress),

  create(ctx, out) {
    const hall = impulse(ctx, 2.8, 2.4, { darkness: 0.55, seed: 21, predelay: 0.02 });
    const stage = impulse(ctx, 1.1, 3, { darkness: 0.35, seed: 5, predelay: 0.006 });
    const stingHall = reverb(ctx, hall, out, 0.8);
    const stingRoom = reverb(ctx, stage, out, 0.7);
    const R = rng(77);
    let voteCount = 0;

    const play = (dest: AudioNode, name: Sample, t: number, gain: number, o: PlayOptions = {}) =>
      bank.play(ctx, dest, name, Math.max(0, t), { ...o, gain: gain * norm(name) });

    /** A sustained sung note of any length: overlapping grains of the nearest recording. */
    const sing = (
      dest: AudioNode,
      midi: number,
      t: number,
      dur: number,
      gain: number,
      o: { pan?: number; send?: AudioNode; sendGain?: number; r?: () => number } = {},
    ) => {
      let v = SINGERS[0];
      for (const s of SINGERS) if (v && Math.abs(s.midi - midi) < Math.abs(v.midi - midi)) v = s;
      if (!v) return;
      let shift = midi - v.midi;
      while (shift > 7) shift -= 12;
      while (shift < -9) shift += 12;
      const rate = 2 ** (shift / 12);
      const span = v.s1 - v.s0;
      const g = Math.min(2.4, span / rate - 0.05);
      const r = o.r ?? R;
      for (let tt = t; tt < t + dur; tt += g * 0.5) {
        play(dest, v.name, tt, gain, {
          rate,
          offset: v.s0 + r() * Math.max(0, span - g * rate),
          attack: g * 0.4,
          dur: g * 0.6,
          release: g * 0.4,
          pan: o.pan ?? 0,
          send: o.send,
          sendGain: o.sendGain,
        });
      }
    };

    const chord = (
      dest: AudioNode,
      name: Chord,
      t: number,
      dur: number,
      gain: number,
      send?: AudioNode,
    ) => {
      CHORDS[name].forEach((m, i) =>
        sing(dest, m, t, dur, gain * (i === 0 ? 0.9 : 0.7), {
          pan: [-0.1, -0.45, 0.4, 0.15][i] ?? 0,
          send,
          sendGain: 0.6,
        }),
      );
    };

    /** Sub thump under a stomp: synthesis supports the body, never replaces it. */
    const thump = (dest: AudioNode, t: number, gain: number, f = 58) =>
      voice(ctx, dest, {
        t,
        freq: f * 1.6,
        glideTo: f * 0.7,
        glideTime: 0.14,
        dur: 0.16,
        gain,
        env: { a: 0.003, d: 0.2, s: 0, r: 0.12 },
      });

    /** A long-held hum drone (group hum pitched to D) made of overlapping grains. */
    const humDrone = (dest: AudioNode, t: number, dur: number, gain: number, midi = 50) => {
      const rate = 2 ** ((midi - 53) / 12);
      const g = 2.6;
      for (let tt = t; tt < t + dur; tt += g * 0.5)
        play(dest, 'hum-group-01', tt, gain, {
          rate,
          offset: 0.4 + R() * (6.6 - g * rate),
          attack: g * 0.45,
          dur: g * 0.55,
          release: g * 0.45,
          pan: (R() - 0.5) * 0.5,
        });
    };

    const room = (dest: AudioNode, t: number, gain = 0.03) =>
      noiseBed(ctx, dest, t, { color: 'brown', type: 'lowpass', freq: 380, gain });

    const bed = (name: string, bedOut: AudioNode): Bed => {
      const verb = reverb(ctx, hall, bedOut, 1);
      const roomVerb = reverb(ctx, stage, bedOut, 0.8);
      const r = rng(name.length * 131 + 7);
      const loops: { stop(t: number, release?: number): void }[] = [];
      let origin = 0;
      const loop = (s: Sample, t: number, gain: number, o: PlayOptions = {}) => {
        const v = play(bedOut, s, t, gain, { loop: true, attack: 1.2, ...o });
        if (v) loops.push(v);
      };
      const stopAll = (t: number) => loops.forEach((l) => l.stop(t, 0.3));

      if (name === 'title') {
        const prog: Chord[] = ['Dm', 'Bb', 'F', 'C'];
        return {
          start(t) {
            origin = t;
            loops.push(room(bedOut, t));
            loop('candle-flame-loop-01', t, 0.05, { send: roomVerb, sendGain: 0.2 });
            humDrone(verb, t, 1, 0.25);
          },
          schedule(from, to) {
            steps(origin, 60, 1 / 4, from, to, (i, t) => {
              const c = prog[i % 4] ?? 'Dm';
              chord(bedOut, c, t, 4.4, 0.085, verb);
              humDrone(verb, t, 4.4, 0.22, CHORDS[c][0] + 12);
              if (i % 2 === 0)
                play(bedOut, 'breath-06', t - 0.9, 0.12, { send: roomVerb, sendGain: 0.3 });
              if (i % 2 === 1)
                play(bedOut, 'choir-phrase-06', t + 0.6, 0.14, {
                  send: verb,
                  sendGain: 0.7,
                  pan: 0.2,
                  rate: c === 'F' ? 2 ** (3 / 12) : 1,
                });
              thump(bedOut, t, 0.18, 46);
              play(roomVerb, 'stomp-03', t, 0.12, { filter: { freq: 900 } });
            });
          },
          stop: stopAll,
        };
      }

      if (name === 'night') {
        return {
          start(t) {
            origin = t;
            loops.push(room(bedOut, t, 0.04));
            loop('candle-flame-loop-01', t, 0.035);
            loop('whisper-03', t, 0.06, {
              filter: { type: 'lowpass', freq: 2600 },
              send: verb,
              sendGain: 0.5,
              pan: -0.3,
            });
            voice(ctx, bedOut, { t, freq: 73.4, dur: 600, gain: 0.03, env: { a: 3, s: 1 } });
          },
          schedule(from, to) {
            steps(origin, 60, 1 / 2, from, to, (i, t) => {
              humDrone(bedOut, t, 2.2, 0.32, 50);
              play(verb, 'hum-03', t + 0.1, 0.18, { rate: 2 ** (-0.8 / 12), pan: 0.25 });
              if (i % 4 === 1)
                sing(verb, i % 8 === 1 ? 69 : 65, t + 0.4, 3.6, 0.07, { pan: 0.35, r });
              if (i % 3 === 2)
                play(verb, r() < 0.5 ? 'whisper-05' : 'whisper-01', t + r(), 0.11, {
                  pan: r() < 0.5 ? -0.7 : 0.7,
                  filter: { type: 'lowpass', freq: 3000 },
                });
              if (i % 4 === 3) play(bedOut, 'breath-03', t + 0.5, 0.09, { pan: -0.2 });
            });
          },
          stop(t) {
            stopAll(t);
          },
        };
      }

      if (name === 'day') {
        const bpm = 92;
        const prog: Chord[] = ['Dm', 'Bb', 'Gm', 'A'];
        const hum: number[] = [65, 65, 67, 64];
        return {
          start(t) {
            origin = t;
            loops.push(room(bedOut, t));
            loop('murmur-loop-01', t, 0.1, {
              filter: { type: 'lowpass', freq: 2400 },
              send: roomVerb,
              sendGain: 0.4,
            });
          },
          schedule(from, to) {
            steps(origin, bpm, 4, from, to, (i, t) => {
              const s = i % 16;
              const bar = Math.floor(i / 16);
              const k = { send: roomVerb, sendGain: 0.35 };
              if (s === 0 || s === 8) {
                play(bedOut, bar % 2 ? 'stomp-04' : 'stomp-01', t, 0.5, k);
                thump(bedOut, t, 0.32);
              }
              if (s === 6 && bar % 2 === 1) play(bedOut, 'stomp-01', t, 0.3, k);
              if (s === 4 || s === 12)
                play(bedOut, s === 4 ? 'clap-03' : 'clap-04', t, 0.42, { ...k, pan: 0.15 });
              if (s === 3 || s === 10 || s === 14)
                play(bedOut, s === 10 ? 'slap-01' : 'slap-02', t, 0.3, { ...k, pan: -0.35 });
              if (s === 7 || s === 15)
                play(bedOut, s === 7 ? 'snap-01' : 'snap-02', t, 0.22, { ...k, pan: 0.5 });
              if (s === 11) play(bedOut, 'chest-slap-02', t, 0.32, k);
              if (s === 0 && bar % 2 === 0) {
                const c = prog[(bar / 2) % 4] ?? 'Dm';
                chord(bedOut, c, t, (60 / bpm) * 8 + 0.4, 0.06, verb);
                play(bedOut, 'hum-01', t + 0.05, 0.2, {
                  rate: 2 ** (((hum[(bar / 2) % 4] ?? 65) - 65.4) / 12),
                  send: verb,
                  sendGain: 0.5,
                  pan: -0.15,
                });
              }
            });
          },
          stop: stopAll,
        };
      }

      if (name === 'trial') {
        const beat = 60 / 66;
        return {
          start(t) {
            origin = t;
            loops.push(room(bedOut, t, 0.035));
            loop('murmur-trial-01', t, 0.08, {
              filter: { type: 'lowpass', freq: 1800 },
              send: verb,
              sendGain: 0.4,
            });
            loop('breath-04', t, 0.07, { pan: 0.3, filter: { type: 'lowpass', freq: 2200 } });
          },
          schedule(from, to) {
            steps(origin, 66, 1, from, to, (i, t) => {
              const stage = Math.min(5, Math.floor(i / 4));
              play(bedOut, 'stomp-03', t, 0.55 + stage * 0.04, {
                filter: { type: 'lowpass', freq: 1400 },
                send: roomVerb,
                sendGain: 0.3,
              });
              thump(bedOut, t, 0.42 + stage * 0.03, 52);
              play(bedOut, 'chest-slap-01', t + beat * 0.27, 0.38, { send: roomVerb });
              thump(bedOut, t + beat * 0.27, 0.22, 46);
              if (stage >= 1) {
                play(bedOut, 'snap-02', t + beat * 0.5, 0.1 + stage * 0.025, { pan: 0.55 });
                if (stage >= 3)
                  play(bedOut, 'snap-01', t + beat * 0.75, 0.08 + stage * 0.02, { pan: -0.5 });
              }
              if (i % 4 === 0) {
                const lift = Math.min(3, Math.floor(stage / 2));
                sing(bedOut, 50 + lift, t, beat * 4 + 0.3, 0.1, { pan: -0.3, send: verb, r });
                sing(bedOut, 51 + lift, t, beat * 4 + 0.3, 0.08, { pan: 0.3, send: verb, r });
                if (stage >= 2)
                  sing(bedOut, 69 + lift, t, beat * 4 + 0.3, 0.05 + stage * 0.01, {
                    pan: 0.1,
                    send: verb,
                    r,
                  });
              }
            });
          },
          stop: stopAll,
        };
      }

      // lament: low chant, a wordless female lament, slow sung chords, sighs.
      const prog: Chord[] = ['Dm', 'Gm', 'Dm', 'A'];
      return {
        start(t) {
          origin = t;
          loops.push(room(bedOut, t));
          loop('candle-flame-loop-01', t, 0.04);
          loop('choir-phrase-02', t, 0.14, {
            send: verb,
            sendGain: 0.6,
            filter: { type: 'lowpass', freq: 2200 },
          });
        },
        schedule(from, to) {
          steps(origin, 60, 1 / 5, from, to, (i, t) => {
            const c = prog[i % 4] ?? 'Dm';
            chord(bedOut, c, t, 5.4, 0.07, verb);
            if (i % 2 === 0)
              play(verb, 'choir-phrase-06', t + 0.8, 0.22, {
                pan: -0.2,
                rate: c === 'Gm' ? 2 ** (5 / 12) : 1,
              });
            if (i % 3 === 1) play(bedOut, 'sigh-03', t + 2.5, 0.12, { pan: 0.4, offset: 2.6 });
          });
        },
        stop: stopAll,
      };
    };

    const sting = (name: string, t: number) => {
      const h = stingHall;
      const rm = stingRoom;
      switch (name) {
        case 'lamp':
          play(out, 'match-strike-01', t, 0.55, { send: rm, sendGain: 0.4 });
          play(out, 'breath-02', t + 0.02, 0.35, { send: rm });
          noiseHit(ctx, h, {
            t: t + 0.08,
            dur: 1.4,
            gain: 0.12,
            color: 'pink',
            type: 'bandpass',
            freq: 500,
            sweepTo: 1600,
            env: { a: 0.25, d: 1.2, s: 0 },
          });
          chord(h, 'Dmaj', t + 0.15, 2.2, 0.11);
          sing(out, 74, t + 0.2, 1.8, 0.1, { send: h, sendGain: 0.8 });
          break;
        case 'cut':
          play(out, 'breath-02', t, 0.42, { send: rm, sendGain: 0.25 });
          play(out, 'clap-03', t + 0.01, 0.32, { send: rm, sendGain: 0.45 });
          thump(out, t, 0.12, 70);
          break;
        case 'reveal':
          play(out, 'gasp-crowd-01', t, 0.45, { send: h, sendGain: 0.4 });
          play(out, 'stomp-02', t + 0.05, 0.6, { send: rm });
          thump(out, t + 0.05, 0.5, 44);
          chord(h, 'Bb', t + 0.1, 3.4, 0.18);
          sing(out, 77, t + 0.25, 3, 0.1, { send: h, sendGain: 0.7 });
          break;
        case 'dusk':
          play(out, 'breath-03', t, 0.4, { send: h, sendGain: 0.5 });
          play(h, 'shh-02', t + 0.6, 0.3, { pan: -0.3 });
          humDrone(h, t + 0.2, 3.2, 0.4, 50);
          sing(h, 57, t + 0.3, 3, 0.12);
          break;
        case 'dawn':
          play(out, 'breath-06', t, 0.3, { send: rm, offset: 0.7, dur: 0.9 });
          sing(h, 66, t + 0.3, 3.4, 0.2, { pan: 0.2 });
          sing(h, 62, t + 0.3, 3.4, 0.14, { pan: -0.3 });
          sing(h, 57, t + 0.3, 3.4, 0.12);
          play(out, 'hum-01', t + 0.5, 0.25, { send: h, rate: 2 ** ((62 - 65.4) / 12) });
          break;
        case 'vote': {
          const n = voteCount++ % 8;
          play(out, n % 2 ? 'stomp-04' : 'stomp-01', t, 0.6, { send: rm, sendGain: 0.4 });
          play(out, 'clap-03', t + 0.012, 0.5, { send: rm, sendGain: 0.5, pan: 0.2 });
          play(out, 'chest-slap-02', t + 0.02, 0.35);
          thump(out, t, 0.4, 50 + n * 3);
          sing(h, [62, 65, 69, 72, 74, 77, 81, 84][n] ?? 69, t + 0.03, 0.7, 0.08);
          break;
        }
        case 'stomp':
          play(out, 'stomp-02', t, 0.7, { send: rm, sendGain: 0.5, dur: 0.6, release: 0.3 });
          play(out, 'stomp-04', t + 0.015, 0.4, { pan: -0.3 });
          thump(out, t, 0.55, 46);
          break;
        case 'snap':
          play(out, 'snap-01', t, 0.5, { send: rm, sendGain: 0.5, pan: 0.3 });
          play(out, 'snap-02', t + 0.11, 0.45, { send: rm, sendGain: 0.5, pan: -0.3 });
          break;
        case 'verdict':
          for (let i = 0; i < 6; i++) {
            const s: Sample = i % 3 === 0 ? 'stomp-02' : i % 3 === 1 ? 'stomp-01' : 'stomp-04';
            play(out, s, t + R() * 0.035, 0.45, {
              pan: (i / 5) * 1.4 - 0.7,
              send: rm,
              sendGain: 0.5,
              dur: 0.8,
            });
          }
          play(out, 'clap-04', t + 0.02, 0.5, { send: h, sendGain: 0.4 });
          thump(out, t, 0.75, 40);
          play(out, 'gasp-crowd-01', t + 0.18, 0.5, { send: h, sendGain: 0.5 });
          chord(h, 'Dm', t + 0.25, 3.6, 0.17);
          sing(h, 51, t + 0.25, 3.6, 0.12, { pan: 0.3 });
          break;
        case 'fall':
          play(out, 'gasp-01', t, 0.45, { send: rm });
          play(out, 'stomp-02', t + 0.42, 0.75, { send: rm, sendGain: 0.6 });
          play(out, 'footstep-05', t + 0.45, 0.5, { send: rm, pan: 0.2 });
          play(out, 'chest-slap-01', t + 0.47, 0.4);
          thump(out, t + 0.42, 0.7, 38);
          break;
        case 'death':
          play(out, 'candle-blow-02', t, 0.6, { send: rm });
          play(out, 'sigh-03', t + 0.1, 0.4, { offset: 2.4, send: h, sendGain: 0.5 });
          sing(h, 50, t + 0.2, 4.2, 0.2, { pan: -0.2 });
          sing(h, 53, t + 0.2, 4.2, 0.16, { pan: 0.25 });
          sing(h, 57, t + 0.5, 3.8, 0.12);
          play(h, 'choir-phrase-06', t + 0.9, 0.35, { pan: 0.1 });
          humDrone(h, t, 4, 0.35, 38 + 12);
          break;
      }
    };

    return { bed, sting };
  },
};
