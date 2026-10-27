import {
  impulse,
  mtof,
  noise,
  noiseBed,
  noiseHit,
  reverb,
  steps,
  voice,
  type Bed,
  type Ctx,
  type Score,
} from '../shared/audio-kit.ts';

/*
 * Masque: a dream opera. Everything is built from four instruments: a formant-filtered
 * choir, struck bells, a celesta/harp pair, and timpani. Key of D minor, with the
 * Phrygian E-flat for dread and a D-major Picardy third for revelation.
 */

type Vowel = 'a' | 'o' | 'u' | 'e';
// [centre Hz, level dB, bandwidth Hz] for the first four formants of a sung vowel.
const FORMANTS: Record<Vowel, [number, number, number][]> = {
  a: [
    [800, 0, 80],
    [1150, -6, 90],
    [2900, -32, 120],
    [3900, -20, 130],
  ],
  o: [
    [450, 0, 70],
    [800, -11, 80],
    [2830, -22, 100],
    [3800, -22, 130],
  ],
  u: [
    [325, 0, 50],
    [700, -16, 60],
    [2700, -35, 170],
    [3800, -40, 180],
  ],
  e: [
    [400, 0, 60],
    [1700, -14, 80],
    [2600, -18, 120],
    [3200, -20, 150],
  ],
};

const hash = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

interface SectionOptions {
  slots: number;
  perSlot?: number;
  vowel?: Vowel;
  /** Formant scale: below 1 for darker, male-sounding sections. */
  shift?: number;
  spread?: number;
  /** Use a plain lowpass instead of formants (string section). */
  lowpass?: number;
  tremolo?: number;
  seed?: number;
}

/** A sustained ensemble of detuned saws through a shared formant (or lowpass) filter bank. */
class Section {
  private oscs: OscillatorNode[][] = [];
  private slotGains: GainNode[] = [];
  private filters: { f: BiquadFilterNode; g: GainNode }[] = [];
  private lfos: OscillatorNode[] = [];
  private breath: AudioBufferSourceNode | null = null;
  readonly level: GainNode;
  private shift: number;

  constructor(ctx: Ctx, out: AudioNode, o: SectionOptions) {
    const per = o.perSlot ?? 3;
    this.shift = o.shift ?? 1;
    const input = ctx.createGain();
    this.level = ctx.createGain();
    this.level.gain.value = 0;
    const amp = ctx.createGain();
    if (o.lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lowpass;
      f.Q.value = 0.5;
      const g = ctx.createGain();
      g.gain.value = 0.5;
      input.connect(f).connect(g).connect(amp);
      this.filters.push({ f, g });
    } else {
      for (const [freq, db, bw] of FORMANTS[o.vowel ?? 'a']) {
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = freq * this.shift;
        f.Q.value = freq / bw;
        const g = ctx.createGain();
        g.gain.value = 10 ** (db / 20) * 3.2;
        input.connect(f).connect(g).connect(amp);
        this.filters.push({ f, g });
      }
      const b = ctx.createBufferSource();
      b.buffer = noise(ctx, 'pink');
      b.loop = true;
      const bg = ctx.createGain();
      bg.gain.value = 0.05;
      b.connect(bg).connect(input);
      this.breath = b;
    }
    if (o.tremolo) {
      const t = ctx.createOscillator();
      t.frequency.value = o.tremolo;
      const depth = ctx.createGain();
      depth.gain.value = 0.45;
      amp.gain.value = 0.55;
      t.connect(depth).connect(amp.gain);
      this.lfos.push(t);
    }
    amp.connect(this.level).connect(out);

    const vib = [5.1, 5.6, 4.7].map((rate) => {
      const l = ctx.createOscillator();
      l.frequency.value = rate;
      const d = ctx.createGain();
      d.gain.value = 9;
      l.connect(d);
      this.lfos.push(l);
      return d;
    });
    const seed = o.seed ?? 1;
    const spread = o.spread ?? 0.7;
    for (let s = 0; s < o.slots; s++) {
      const sg = ctx.createGain();
      sg.gain.value = 0;
      sg.connect(input);
      this.slotGains.push(sg);
      const row: OscillatorNode[] = [];
      for (let k = 0; k < per; k++) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.detune.value = (hash(seed + s * 13 + k * 7) - 0.5) * 22;
        vib[(s + k) % vib.length]?.connect(osc.detune);
        const p = ctx.createStereoPanner();
        p.pan.value = (hash(seed * 3 + s * 5 + k) * 2 - 1) * spread;
        const g = ctx.createGain();
        g.gain.value = 1 / per;
        osc.connect(g).connect(p).connect(sg);
        row.push(osc);
      }
      this.oscs.push(row);
    }
  }

  start(t: number): void {
    for (const row of this.oscs) for (const o of row) o.start(t);
    for (const l of this.lfos) l.start(t);
    this.breath?.start(t);
  }

  stop(t: number): void {
    for (const row of this.oscs) for (const o of row) o.stop(t);
    for (const l of this.lfos) l.stop(t);
    this.breath?.stop(t);
  }

  /** Move slots to new pitches; slots beyond the chord fall silent. */
  chord(midis: readonly number[], t: number, glide = 0.25, slotLevel = 1): void {
    this.slotGains.forEach((g, i) => {
      const m = midis[i];
      g.gain.setTargetAtTime(m === undefined ? 0 : slotLevel, t, glide);
      if (m === undefined) return;
      for (const o of this.oscs[i] ?? []) o.frequency.setTargetAtTime(mtof(m), t, glide);
    });
  }

  /** Jump slots to pitches with no glide (used before the section is audible). */
  set(midis: readonly number[], t: number): void {
    this.slotGains.forEach((g, i) => {
      const m = midis[i];
      g.gain.setValueAtTime(m === undefined ? 0 : 1, t);
      if (m !== undefined)
        for (const o of this.oscs[i] ?? []) o.frequency.setValueAtTime(mtof(m), t);
    });
  }

  vowel(v: Vowel, t: number, time = 1): void {
    FORMANTS[v].forEach(([freq, db], i) => {
      const f = this.filters[i];
      if (!f) return;
      f.f.frequency.setTargetAtTime(freq * this.shift, t, time / 3);
      f.g.gain.setTargetAtTime(10 ** (db / 20) * 3.2, t, time / 3);
    });
  }

  fade(to: number, t: number, time = 1): void {
    this.level.gain.setTargetAtTime(to, t, Math.max(0.005, time / 3));
  }

  /** A sforzando-style swell: up fast, settle, die away. */
  swell(peak: number, t: number, up = 0.15, hold = 0.2, down = 0.6, rest = 0): void {
    const p = this.level.gain;
    p.setTargetAtTime(peak, t, up / 3);
    p.setTargetAtTime(rest, t + up + hold, down / 3);
  }
}

// --- one-shot instruments -------------------------------------------------------------

const BELL: [number, number, number][] = [
  [0.5, 0.9, 1],
  [1, 0.7, 0.8],
  [1.183, 0.45, 0.55],
  [1.506, 0.35, 0.5],
  [2, 0.55, 0.45],
  [2.514, 0.22, 0.32],
  [2.662, 0.18, 0.3],
  [3.011, 0.16, 0.25],
  [4.166, 0.1, 0.18],
  [5.433, 0.07, 0.12],
];

function bell(ctx: Ctx, out: AudioNode, t: number, midi: number, gain = 0.2, decay = 7, pan = 0) {
  const f0 = mtof(midi);
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  p.connect(out);
  BELL.forEach(([ratio, amp, ds], i) => {
    const o = ctx.createOscillator();
    o.frequency.value = f0 * ratio * (1 + (hash(i + midi) - 0.5) * 0.002);
    const g = ctx.createGain();
    const d = decay * ds;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp * gain, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.003, d / 4);
    o.connect(g).connect(p);
    o.start(t);
    o.stop(t + d * 1.3);
  });
  noiseHit(ctx, out, { t, dur: 0.04, gain: gain * 0.4, type: 'highpass', freq: 2500, pan });
}

function celesta(ctx: Ctx, out: AudioNode, t: number, midi: number, gain = 0.1, pan = 0) {
  const f = mtof(midi);
  voice(ctx, out, { t, freq: f, dur: 1.8, gain, env: { a: 0.002, d: 1.6, s: 0, r: 0.6 }, pan });
  voice(ctx, out, {
    t,
    freq: f * 4,
    dur: 0.4,
    gain: gain * 0.12,
    env: { a: 0.001, d: 0.3, s: 0, r: 0.2 },
    pan,
  });
  voice(ctx, out, {
    t,
    freq: f * 2.005,
    dur: 0.9,
    gain: gain * 0.18,
    env: { a: 0.002, d: 0.8, s: 0, r: 0.3 },
    pan,
  });
}

function harp(ctx: Ctx, out: AudioNode, t: number, midi: number, gain = 0.12, pan = 0, len = 1.6) {
  const f = mtof(midi);
  voice(ctx, out, {
    t,
    freq: f,
    dur: len,
    type: 'triangle',
    gain,
    env: { a: 0.003, d: len * 0.8, s: 0, r: 0.4 },
    filter: { freq: Math.min(9000, f * 8), envTo: Math.max(300, f * 1.5), envTime: 0.5 },
    pan,
  });
  voice(ctx, out, {
    t,
    freq: f * 2,
    dur: 0.5,
    gain: gain * 0.15,
    env: { a: 0.002, d: 0.4, s: 0, r: 0.2 },
    pan,
  });
}

function timpani(ctx: Ctx, out: AudioNode, t: number, midi: number, vel = 1, pan = 0) {
  const f = mtof(midi);
  voice(ctx, out, {
    t,
    freq: f * 1.06,
    glideTo: f,
    glideTime: 0.12,
    dur: 1.6,
    gain: 0.55 * vel,
    env: { a: 0.004, d: 1.5, s: 0, r: 0.5 },
    pan,
  });
  voice(ctx, out, {
    t,
    freq: f * 1.51,
    dur: 0.7,
    gain: 0.18 * vel,
    env: { a: 0.003, d: 0.6, s: 0, r: 0.3 },
    pan,
  });
  voice(ctx, out, {
    t,
    freq: f * 1.98,
    dur: 0.4,
    gain: 0.08 * vel,
    env: { a: 0.003, d: 0.35, s: 0, r: 0.2 },
    pan,
  });
  noiseHit(ctx, out, {
    t,
    dur: 0.07,
    gain: 0.25 * vel,
    type: 'lowpass',
    freq: 700,
    color: 'pink',
    pan,
  });
}

function roll(
  ctx: Ctx,
  out: AudioNode,
  t: number,
  dur: number,
  midi: number,
  from = 0.15,
  to = 0.6,
) {
  const n = Math.floor(dur * 18);
  for (let i = 0; i < n; i++) {
    const x = i / n;
    timpani(
      ctx,
      out,
      t + i / 18 + (hash(i) - 0.5) * 0.01,
      midi,
      (from + (to - from) * x) * (0.75 + hash(i + 9) * 0.25),
    );
  }
}

function gong(ctx: Ctx, out: AudioNode, t: number, gain = 0.35) {
  const car = ctx.createOscillator();
  const mod = ctx.createOscillator();
  const idx = ctx.createGain();
  car.frequency.value = 62;
  mod.frequency.value = 62 * 1.414;
  idx.gain.setValueAtTime(260, t);
  idx.gain.setTargetAtTime(15, t, 1.2);
  mod.connect(idx).connect(car.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.02);
  g.gain.setTargetAtTime(0, t + 0.05, 2.2);
  car.connect(g).connect(out);
  car.start(t);
  mod.start(t);
  car.stop(t + 9);
  mod.stop(t + 9);
  [1.0, 1.52, 2.31, 2.94, 3.73].forEach((r, i) =>
    voice(ctx, out, {
      t,
      freq: 98 * r,
      dur: 5 - i * 0.6,
      gain: gain * 0.18,
      env: { a: 0.01, d: 5, s: 0, r: 1 },
      pan: (i % 2 ? 1 : -1) * 0.3,
    }),
  );
  noiseHit(ctx, out, {
    t,
    dur: 3,
    gain: gain * 0.25,
    type: 'bandpass',
    freq: 3200,
    q: 0.6,
    env: { a: 0.05, d: 3, s: 0 },
  });
}

function cymbal(ctx: Ctx, out: AudioNode, t: number, gain = 0.2) {
  noiseHit(ctx, out, {
    t,
    dur: 3.5,
    gain,
    type: 'highpass',
    freq: 5200,
    env: { a: 0.004, d: 3.5, s: 0 },
  });
  noiseHit(ctx, out, {
    t,
    dur: 1.2,
    gain: gain * 0.6,
    type: 'bandpass',
    freq: 8000,
    q: 0.8,
    env: { a: 0.002, d: 1.2, s: 0 },
  });
}

function velvet(ctx: Ctx, out: AudioNode, t: number, dur = 2.6, gain = 0.6) {
  noiseHit(ctx, out, {
    t,
    dur,
    gain,
    color: 'pink',
    type: 'bandpass',
    freq: 1400,
    sweepTo: 260,
    q: 0.7,
    env: { a: dur * 0.35, d: dur, s: 0 },
    pan: -0.5,
  });
  noiseHit(ctx, out, {
    t: t + 0.12,
    dur,
    gain,
    color: 'pink',
    type: 'bandpass',
    freq: 1200,
    sweepTo: 240,
    q: 0.7,
    env: { a: dur * 0.35, d: dur, s: 0 },
    pan: 0.5,
  });
}

function crack(ctx: Ctx, out: AudioNode, t: number) {
  for (let i = 0; i < 9; i++) {
    const at = t + hash(i * 3.1) * 0.35 + i * 0.03;
    noiseHit(ctx, out, {
      t: at,
      dur: 0.02 + hash(i) * 0.03,
      gain: 0.35 * (1 - i / 12),
      type: 'highpass',
      freq: 3500 + hash(i + 2) * 3000,
      pan: hash(i + 5) - 0.5,
    });
  }
  voice(ctx, out, { t, freq: 3100, dur: 0.6, gain: 0.05, env: { a: 0.001, d: 0.5, s: 0, r: 0.3 } });
  voice(ctx, out, {
    t: t + 0.02,
    freq: 4630,
    dur: 0.4,
    gain: 0.03,
    env: { a: 0.001, d: 0.35, s: 0, r: 0.2 },
  });
}

// --- harmony ----------------------------------------------------------------------

const CH = {
  Dm: [50, 57, 62, 65],
  Dmaj: [50, 57, 62, 66],
  Bb: [53, 58, 62, 65],
  Gm: [55, 58, 62, 67],
  A: [52, 57, 61, 64],
  FC: [48, 57, 60, 65],
  C: [52, 55, 60, 64],
  F: [53, 57, 60, 65],
  Eb: [51, 58, 63, 67],
} as const;
const ROOT: Record<keyof typeof CH, number> = {
  Dm: 38,
  Dmaj: 38,
  Bb: 34,
  Gm: 43,
  A: 33,
  FC: 36,
  C: 36,
  F: 41,
  Eb: 39,
};

const TITLE_PROG: (keyof typeof CH)[] = ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'FC', 'Bb', 'A'];
// The Vesper motif: [bar, beat, midi, beats].
const MOTIF: [number, number, number, number][] = [
  [0, 0, 74, 1],
  [0, 1, 77, 1],
  [0, 2, 81, 1],
  [1, 0, 77, 2],
  [1, 2, 74, 1],
  [2, 0, 79, 1],
  [2, 1, 82, 1],
  [2, 2, 81, 1],
  [3, 0, 76, 2],
  [3, 2, 73, 1],
  [4, 0, 74, 1],
  [4, 1, 76, 1],
  [4, 2, 77, 1],
  [5, 0, 81, 2],
  [5, 2, 79, 1],
  [6, 0, 77, 1],
  [6, 1, 74, 1],
  [6, 2, 70, 1],
  [7, 0, 73, 3],
];

const DAY_PROG: (keyof typeof CH)[] = ['Dm', 'Gm', 'C', 'F', 'Bb', 'Gm', 'A', 'A'];
const DAY_TUNE: [number, number, number][] = [
  [0, 1, 81],
  [0, 2, 77],
  [1, 1, 79],
  [1, 2, 74],
  [2, 1, 76],
  [2, 2, 79],
  [3, 0, 77],
  [4, 1, 74],
  [4, 2, 77],
  [5, 1, 82],
  [5, 2, 79],
  [6, 0, 76],
  [6, 2, 73],
  [7, 1, 76],
];

const NIGHT_PROG: (keyof typeof CH)[] = ['Dm', 'Eb', 'Dm', 'C'];
const NIGHT_LOW: Record<string, number[]> = {
  Dm: [38, 45, 50, 57],
  Eb: [39, 46, 51, 58],
  C: [36, 43, 48, 55],
};
// Soprano phrases over the night drone: [offset s within 32 s cycle, midi, length s].
const NIGHT_SOPRANO: [number, number, number][] = [
  [2, 69, 4.5],
  [7, 70, 3],
  [10.5, 69, 4],
  [18, 65, 4],
  [22.5, 64, 3],
  [26, 62, 5],
];
const PENTA = [74, 77, 79, 81, 84, 86, 89];

export const masqueScore: Score = {
  beds: ['title', 'day', 'night', 'trial'],
  stings: ['reveal', 'nightfall', 'dawn', 'vote', 'verdict', 'death', 'crack', 'curtain', 'toll'],

  create(ctx, out) {
    const hall = impulse(ctx, 4.8, 2.6, { darkness: 0.6, seed: 11, predelay: 0.03 });
    const stingVerb = reverb(ctx, hall, out, 0.9);
    let voteCount = 0;

    const send = (wet: AudioNode, outNode: AudioNode, wetAmt: number) => {
      const bus = ctx.createGain();
      const d = ctx.createGain();
      d.gain.value = 1 - wetAmt * 0.5;
      const w = ctx.createGain();
      w.gain.value = wetAmt;
      bus.connect(d).connect(outNode);
      bus.connect(w).connect(wet);
      return bus;
    };

    const bed = (name: string, bedOut: AudioNode): Bed => {
      const verb = reverb(ctx, hall, bedOut, 1);
      const mix = send(verb, bedOut, 0.55);
      const wetMix = send(verb, bedOut, 0.85);
      let origin = 0;
      const extras: { stop(t: number): void }[] = [];

      if (name === 'title') {
        const choir = new Section(ctx, mix, { slots: 4, vowel: 'u', seed: 3 });
        const bass = new Section(ctx, mix, { slots: 1, perSlot: 2, lowpass: 380, seed: 9 });
        return {
          start(t) {
            origin = t;
            choir.start(t);
            bass.start(t);
            choir.set(CH.Dm, t);
            bass.set([ROOT.Dm], t);
            choir.fade(0.32, t, 4);
            bass.fade(0.22, t, 3);
            choir.vowel('o', t + 6, 6);
          },
          schedule(from, to) {
            steps(origin, 72, 1, from, to, (i, t) => {
              const bar = Math.floor(i / 3);
              const beat = i % 3;
              const name8 = TITLE_PROG[bar % 8] ?? 'Dm';
              const chord = CH[name8];
              if (beat === 0) {
                choir.chord(chord, t, 0.35);
                bass.chord([ROOT[name8]], t, 0.1);
                choir.vowel(bar % 4 === 2 ? 'a' : 'o', t, 2);
                harp(ctx, wetMix, t, ROOT[name8] + 12, 0.16, -0.3, 2.4);
                if (bar % 8 === 0) bell(ctx, wetMix, t, 62, 0.07, 8, 0.2);
              }
              const arp = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[3] + 12];
              harp(ctx, mix, t, arp[(beat + bar) % 4] ?? 62, 0.07, 0.35);
              harp(ctx, mix, t + 0.4167, arp[(beat + 2) % 4] ?? 65, 0.05, 0.1);
              for (const [mb, mbeat, midi] of MOTIF) {
                if (mb === bar % 8 && mbeat === beat && bar >= 2)
                  celesta(ctx, wetMix, t, midi, 0.12, 0.1);
              }
            });
          },
          stop(t) {
            choir.stop(t);
            bass.stop(t);
          },
        };
      }

      if (name === 'day') {
        const choir = new Section(ctx, mix, { slots: 4, vowel: 'o', seed: 21, spread: 0.9 });
        const murmurSrc = noiseBed(ctx, mix, 0, {
          color: 'pink',
          type: 'bandpass',
          freq: 700,
          q: 4,
          gain: 0,
        });
        extras.push(murmurSrc);
        return {
          start(t) {
            origin = t;
            choir.start(t);
            choir.set(CH.Dm, t);
            choir.fade(0.17, t, 3);
            murmurSrc.gain.gain.cancelScheduledValues(t);
            murmurSrc.gain.gain.setValueAtTime(0, t);
            murmurSrc.gain.gain.linearRampToValueAtTime(0.08, t + 3);
          },
          schedule(from, to) {
            steps(origin, 84, 1, from, to, (i, t) => {
              const bar = Math.floor(i / 3);
              const beat = i % 3;
              const n = DAY_PROG[bar % 8] ?? 'Dm';
              const chord = CH[n];
              if (beat === 0) {
                choir.chord(chord, t, 0.4);
                harp(ctx, mix, t, ROOT[n] + 12, 0.26, -0.2, 1.2);
              } else {
                harp(ctx, mix, t, (chord[1] ?? 57) + 12, 0.1, 0.3, 0.5);
                harp(ctx, mix, t, (chord[3] ?? 65) + 12, 0.08, 0.4, 0.5);
              }
              if (Math.floor(bar / 8) % 2 === 1 || bar % 8 >= 4) {
                for (const [b, bt, m] of DAY_TUNE)
                  if (b === bar % 8 && bt === beat) celesta(ctx, wetMix, t, m, 0.15, -0.15);
              }
              // The town murmurs: the noise band hops between vowel formants.
              const v = FORMANTS[(['a', 'o', 'e', 'u'] as const)[Math.floor(hash(i) * 4)] ?? 'a'];
              murmurSrc.filter.frequency.setTargetAtTime(
                (v[0]?.[0] ?? 500) * (0.8 + hash(i + 1) * 0.6),
                t,
                0.08,
              );
              murmurSrc.filter.frequency.setTargetAtTime((v[1]?.[0] ?? 900) * 0.9, t + 0.35, 0.08);
            });
          },
          stop(t) {
            choir.stop(t);
            for (const x of extras) x.stop(t);
          },
        };
      }

      if (name === 'night') {
        const low = new Section(ctx, wetMix, { slots: 4, vowel: 'u', shift: 0.82, seed: 33 });
        const sop = new Section(ctx, wetMix, {
          slots: 1,
          perSlot: 3,
          vowel: 'o',
          seed: 41,
          spread: 0.3,
        });
        const wind = noiseBed(ctx, mix, 0, {
          color: 'pink',
          type: 'bandpass',
          freq: 420,
          q: 1.2,
          gain: 0,
        });
        return {
          start(t) {
            origin = t;
            low.start(t);
            sop.start(t);
            low.set(NIGHT_LOW.Dm ?? [], t);
            sop.set([69], t);
            low.fade(0.24, t, 5);
            wind.gain.gain.cancelScheduledValues(t);
            wind.gain.gain.setValueAtTime(0, t);
            wind.gain.gain.linearRampToValueAtTime(0.07, t + 4);
          },
          schedule(from, to) {
            steps(origin, 60, 1 / 8, from, to, (i, t) => {
              const n = NIGHT_PROG[i % 4] ?? 'Dm';
              low.chord(NIGHT_LOW[n] ?? [], t, 1.2);
              low.vowel(i % 2 ? 'o' : 'u', t, 4);
              wind.filter.frequency.setTargetAtTime(300 + hash(i) * 500, t, 2.5);
              if (i % 2 === 0) bell(ctx, wetMix, t + 1, 50, 0.05, 9, -0.4);
            });
            steps(origin, 60, 1 / 32, from, to, (_i, cycle) => {
              for (const [off, midi, len] of NIGHT_SOPRANO) {
                sop.chord([midi], cycle + off, 0.4);
                sop.swell(0.15, cycle + off, 1.2, len - 1.5, 1.5, 0);
              }
            });
            steps(origin, 60, 1, from, to, (i, t) => {
              if (hash(i * 1.7) > 0.8)
                celesta(
                  ctx,
                  wetMix,
                  t + hash(i) * 0.5,
                  PENTA[Math.floor(hash(i + 4) * PENTA.length)] ?? 81,
                  0.06,
                  hash(i + 8) - 0.5,
                );
            });
          },
          stop(t) {
            low.stop(t);
            sop.stop(t);
            wind.stop(t);
          },
        };
      }

      // trial: a heartbeat under a tightening chromatic cluster.
      const cluster = new Section(ctx, mix, { slots: 3, vowel: 'a', seed: 51, spread: 0.9 });
      const strings = new Section(ctx, mix, {
        slots: 2,
        perSlot: 3,
        lowpass: 1400,
        tremolo: 9,
        seed: 61,
      });
      const high = new Section(ctx, wetMix, {
        slots: 2,
        perSlot: 2,
        lowpass: 3200,
        tremolo: 11,
        seed: 71,
      });
      return {
        start(t) {
          origin = t;
          cluster.start(t);
          strings.start(t);
          high.start(t);
          cluster.set([62, 63, 64], t);
          strings.set([38, 45], t);
          high.set([81, 82], t);
          strings.fade(0.18, t, 2);
        },
        schedule(from, to) {
          steps(origin, 100, 1, from, to, (i, t) => {
            const bar = Math.floor(i / 4);
            const beat = i % 4;
            const stage = Math.min(6, bar);
            const beatLen = 0.6;
            if (beat === 0 || beat === 2) {
              timpani(ctx, mix, t, 38, 0.42 + stage * 0.05);
              timpani(ctx, mix, t + beatLen * 0.4, 38, 0.24 + stage * 0.035);
            }
            if (beat === 0) {
              const lift = Math.min(4, Math.floor(stage / 1.5));
              cluster.chord([62 + lift, 63 + lift, 64 + lift], t, 0.2);
              strings.fade(0.11 + stage * 0.03, t, 1);
              if (stage >= 3) high.fade(0.03 + (stage - 3) * 0.025, t, 1.5);
              if (stage >= 4) high.chord([81 + lift, 82 + lift], t, 0.3);
            }
            if (stage >= 2 && (beat === 1 || beat === 3))
              cluster.swell(0.1 + stage * 0.03, t, 0.08, 0.1, 0.35, 0.02);
            if (stage >= 4 && beat === 3) roll(ctx, mix, t, beatLen, 45, 0.1, 0.4);
          });
        },
        stop(t) {
          cluster.stop(t);
          strings.stop(t);
          high.stop(t);
        },
      };
    };

    const sting = (name: string, t: number) => {
      const o = stingVerb;
      const dry = out;
      switch (name) {
        case 'reveal': {
          for (let i = 0; i < 14; i++)
            harp(
              ctx,
              o,
              t + i * 0.045,
              [62, 66, 69, 74][i % 4]! + Math.floor(i / 4) * 12,
              0.08,
              (i / 14) * 1.2 - 0.6,
              1.4,
            );
          const c = new Section(ctx, o, { slots: 4, vowel: 'a', seed: 81, spread: 1 });
          c.set(
            CH.Dmaj.map((m) => m + 12),
            t,
          );
          c.start(t);
          c.swell(0.35, t + 0.5, 0.8, 1.2, 2.5);
          c.stop(t + 7);
          [86, 90, 93, 98].forEach((m, i) =>
            celesta(ctx, o, t + 0.65 + i * 0.09, m, 0.07, i * 0.2 - 0.3),
          );
          gong(ctx, o, t + 0.6, 0.12);
          break;
        }
        case 'nightfall': {
          const scale = [
            86, 84, 81, 79, 77, 76, 74, 72, 70, 69, 67, 65, 64, 62, 60, 58, 57, 55, 53, 50,
          ];
          scale.forEach((m, i) => harp(ctx, o, t + i * 0.055, m, 0.08, 0.6 - i * 0.06, 1.6));
          const c = new Section(ctx, o, { slots: 4, vowel: 'u', shift: 0.85, seed: 91 });
          c.set([38, 45, 50, 53], t);
          c.start(t);
          c.swell(0.4, t + 0.6, 1.6, 1.4, 2.5);
          c.stop(t + 8);
          bell(ctx, o, t + 1.2, 50, 0.12, 9);
          break;
        }
        case 'dawn': {
          [74, 78, 81, 86, 90, 93].forEach((m, i) =>
            celesta(ctx, o, t + i * 0.13, m, 0.09, i * 0.15 - 0.4),
          );
          for (let i = 0; i < 12; i++)
            harp(
              ctx,
              o,
              t + 0.1 + i * 0.05,
              [62, 66, 69][i % 3]! + Math.floor(i / 3) * 12,
              0.06,
              0.4 - i * 0.06,
              1.4,
            );
          const s = new Section(ctx, o, {
            slots: 1,
            perSlot: 3,
            vowel: 'a',
            seed: 101,
            spread: 0.3,
          });
          s.set([69], t);
          s.start(t);
          s.chord([74], t + 1.6, 0.25);
          s.swell(0.28, t + 0.3, 1.2, 2.2, 1.8);
          s.stop(t + 7);
          const pad = new Section(ctx, o, { slots: 4, vowel: 'o', seed: 103 });
          pad.set(CH.Dmaj, t);
          pad.start(t);
          pad.swell(0.2, t + 0.4, 1.5, 2, 2.5);
          pad.stop(t + 8);
          bell(ctx, o, t + 0.2, 74, 0.06, 6, 0.3);
          break;
        }
        case 'vote': {
          const m = [62, 65, 69, 72, 74, 77, 81, 84][voteCount++ % 8] ?? 69;
          harp(ctx, o, t, m, 0.3, 0.2, 1.8);
          harp(ctx, dry, t, m - 12, 0.2, -0.2, 1.4);
          celesta(ctx, o, t + 0.01, m + 12, 0.08);
          bell(ctx, o, t, m + 12, 0.035, 3);
          break;
        }
        case 'verdict': {
          timpani(ctx, dry, t, 38, 1.2);
          timpani(ctx, dry, t, 33, 0.9);
          gong(ctx, o, t, 0.42);
          cymbal(ctx, o, t, 0.16);
          const c = new Section(ctx, o, { slots: 4, perSlot: 4, vowel: 'a', seed: 111, spread: 1 });
          c.set([50, 57, 62, 65], t);
          c.start(t);
          c.swell(0.75, t, 0.04, 0.5, 2.6);
          c.stop(t + 7);
          const b = new Section(ctx, dry, { slots: 2, perSlot: 3, lowpass: 600, seed: 113 });
          b.set([26, 38], t);
          b.start(t);
          b.swell(0.5, t, 0.02, 0.3, 1.5);
          b.stop(t + 5);
          bell(ctx, o, t + 0.02, 50, 0.12, 9, -0.2);
          break;
        }
        case 'death': {
          bell(ctx, o, t, 50, 0.3, 11, 0);
          bell(ctx, o, t + 2.8, 50, 0.16, 10, 0.15);
          const s = new Section(ctx, o, {
            slots: 1,
            perSlot: 4,
            vowel: 'a',
            seed: 121,
            spread: 0.4,
          });
          s.set([69], t);
          s.start(t);
          s.swell(0.3, t + 0.2, 0.5, 2.6, 2.2);
          s.chord([62], t + 0.9, 0.9);
          s.vowel('o', t + 1.4, 2);
          s.stop(t + 8);
          const low = new Section(ctx, o, { slots: 3, vowel: 'u', shift: 0.8, seed: 123 });
          low.set([38, 39, 45], t);
          low.start(t);
          low.swell(0.38, t + 0.4, 2, 2.5, 3);
          low.stop(t + 10);
          roll(ctx, o, t + 0.2, 2.4, 38, 0.35, 0.05);
          break;
        }
        case 'crack':
          crack(ctx, dry, t);
          crack(ctx, o, t + 0.01);
          break;
        case 'curtain':
          velvet(ctx, o, t);
          velvet(ctx, dry, t, 2.6, 0.35);
          break;
        case 'toll':
          bell(ctx, o, t, 50, 0.2, 10);
          break;
      }
    };

    return { bed, sting };
  },
};
