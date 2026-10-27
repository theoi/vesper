import {
  impulse,
  mtof,
  noiseBed,
  noiseHit,
  reverb,
  rng,
  steps,
  voice,
  type Bed,
  type Ctx,
  type Score,
} from '../shared/audio-kit.ts';

export const BPM = { title: 112, day: 120, night: 56, trial: 132, dirge: 64 } as const;

interface Bus {
  ctx: Ctx;
  dry: AudioNode;
  wet: AudioNode;
}

/** A gain node routed to the dry bus (panned) with a reverb send. */
function tap(b: Bus, send = 0, pan = 0, gain = 1): GainNode {
  const g = b.ctx.createGain();
  g.gain.value = gain;
  let node: AudioNode = g;
  if (pan) {
    const p = b.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p);
    node = p;
  }
  node.connect(b.dry);
  if (send > 0) {
    const s = b.ctx.createGain();
    s.gain.value = send;
    node.connect(s).connect(b.wet);
  }
  return g;
}

function decayEnv(p: AudioParam, t: number, peak: number, dur: number, attack = 0.002): void {
  p.setValueAtTime(0.0001, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.exponentialRampToValueAtTime(0.0001, t + attack + dur);
}

function kick(
  b: Bus,
  t: number,
  o: {
    gain?: number;
    f0?: number;
    f1?: number;
    decay?: number;
    send?: number;
    click?: number;
  } = {},
): void {
  const { ctx } = b;
  const dur = o.decay ?? 0.38;
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(o.f0 ?? 140, t);
  osc.frequency.exponentialRampToValueAtTime(o.f1 ?? 42, t + 0.12);
  const g = ctx.createGain();
  decayEnv(g.gain, t, o.gain ?? 0.8, dur, 0.003);
  osc.connect(g).connect(tap(b, o.send ?? 0.04));
  osc.start(t);
  osc.stop(t + dur + 0.05);
  const click = o.click ?? 0.2;
  if (click > 0)
    noiseHit(ctx, tap(b, 0), {
      t,
      dur: 0.014,
      type: 'highpass',
      freq: 3000,
      gain: (o.gain ?? 0.8) * click,
    });
}

function snare(b: Bus, t: number, gain = 0.3, pan = 0, send = 0.15): void {
  const out = tap(b, send, pan);
  noiseHit(b.ctx, out, { t, dur: 0.16, type: 'bandpass', freq: 1900, q: 0.7, gain });
  noiseHit(b.ctx, out, { t, dur: 0.05, type: 'highpass', freq: 6000, gain: gain * 0.5 });
  voice(b.ctx, out, {
    t,
    freq: 200,
    glideTo: 150,
    glideTime: 0.05,
    dur: 0.03,
    type: 'triangle',
    gain: gain * 0.9,
    env: { a: 0.001, d: 0.05, s: 0, r: 0.05 },
  });
}

function hat(b: Bus, t: number, gain = 0.04, pan = 0): void {
  noiseHit(b.ctx, tap(b, 0.05, pan), { t, dur: 0.035, type: 'highpass', freq: 7500, gain });
}

/** Inharmonic two-operator FM: struck metal. */
function clank(
  b: Bus,
  t: number,
  f: number,
  o: {
    gain?: number;
    pan?: number;
    send?: number;
    dur?: number;
    ratio?: number;
    index?: number;
  } = {},
): void {
  const { ctx } = b;
  const dur = o.dur ?? 0.45;
  const car = ctx.createOscillator();
  const mod = ctx.createOscillator();
  car.frequency.value = f;
  mod.frequency.value = f * (o.ratio ?? 1.414);
  const mg = ctx.createGain();
  const idx = o.index ?? 3;
  mg.gain.setValueAtTime(f * idx, t);
  mg.gain.exponentialRampToValueAtTime(f * idx * 0.08, t + dur);
  mod.connect(mg).connect(car.frequency);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 300;
  const g = ctx.createGain();
  decayEnv(g.gain, t, o.gain ?? 0.08, dur, 0.001);
  car
    .connect(hp)
    .connect(g)
    .connect(tap(b, o.send ?? 0.2, o.pan ?? 0));
  car.start(t);
  mod.start(t);
  car.stop(t + dur + 0.05);
  mod.stop(t + dur + 0.05);
}

const ANVIL = [
  [1, 1, 1],
  [2.76, 0.55, 0.7],
  [5.4, 0.35, 0.45],
  [8.93, 0.22, 0.3],
  [13.34, 0.12, 0.2],
] as const;

function partials(
  b: Bus,
  t: number,
  f: number,
  table: readonly (readonly [number, number, number])[],
  gain: number,
  dur: number,
  pan = 0,
  send = 0.4,
): void {
  const out = tap(b, send, pan);
  for (const [ratio, amp, dec] of table) {
    const fr = f * ratio;
    if (fr > 16000) continue;
    const o = b.ctx.createOscillator();
    o.frequency.value = fr;
    const g = b.ctx.createGain();
    decayEnv(g.gain, t, gain * amp, dur * dec, 0.001);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur * dec + 0.05);
  }
}

const anvil = (b: Bus, t: number, f: number, gain = 0.1, pan = 0, send = 0.5, dur = 2.2) => {
  partials(b, t, f, ANVIL, gain, dur, pan, send);
  noiseHit(b.ctx, tap(b, send, pan), { t, dur: 0.02, type: 'highpass', freq: 2500, gain: gain });
};

const BELL = [
  [1, 1, 1],
  [2.0, 0.5, 0.6],
  [3.01, 0.3, 0.4],
  [4.2, 0.2, 0.25],
] as const;
const bell = (b: Bus, t: number, f: number, gain = 0.1, pan = 0, send = 0.3) =>
  partials(b, t, f, BELL, gain, 1.4, pan, send);

function beep(b: Bus, t: number, dur: number, f: number, gain = 0.05, pan = 0, send = 0.2): void {
  const { ctx } = b;
  const o = ctx.createOscillator();
  o.frequency.value = f;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.004);
  g.gain.setValueAtTime(gain, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.008);
  const lp = ctx.createBiquadFilter();
  lp.frequency.value = 3000;
  o.connect(lp)
    .connect(g)
    .connect(tap(b, send, pan));
  o.start(t);
  o.stop(t + dur + 0.05);
}

function typeKey(b: Bus, t: number, gain = 0.08, pan = 0): void {
  const out = tap(b, 0.08, pan);
  noiseHit(b.ctx, out, { t, dur: 0.012, type: 'highpass', freq: 2800, gain });
  noiseHit(b.ctx, out, { t, dur: 0.025, type: 'bandpass', freq: 700, q: 2, gain: gain * 0.9 });
}

function typeBurst(b: Bus, t: number, n: number, span: number, seed: number, gain = 0.08): void {
  const r = rng(seed);
  for (let i = 0; i < n; i++)
    typeKey(b, t + (i / n) * span + r() * 0.03, gain * (0.6 + r() * 0.5), r() - 0.5);
}

/** Detuned saws through a fast filter envelope. */
function brass(
  b: Bus,
  t: number,
  notes: readonly number[],
  dur: number,
  o: { gain?: number; bright?: number; attack?: number; send?: number; spread?: number } = {},
): void {
  const { ctx } = b;
  const atk = o.attack ?? 0.03;
  const bright = o.bright ?? 1800;
  notes.forEach((m, k) => {
    const pan = notes.length > 1 ? ((k / (notes.length - 1)) * 2 - 1) * (o.spread ?? 0.5) : 0;
    const out = tap(b, o.send ?? 0.25, pan);
    const lp = ctx.createBiquadFilter();
    lp.Q.value = 1.6;
    lp.frequency.setValueAtTime(180, t);
    lp.frequency.linearRampToValueAtTime(bright, t + atk);
    lp.frequency.setTargetAtTime(bright * 0.45, t + atk, 0.12);
    lp.frequency.setTargetAtTime(160, t + dur, 0.08);
    const g = ctx.createGain();
    const peak = o.gain ?? 0.06;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    g.gain.setTargetAtTime(peak * 0.7, t + atk, 0.2);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.07);
    lp.connect(g).connect(out);
    for (const det of [-9, 0, 8]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = mtof(m);
      osc.detune.value = det;
      osc.connect(lp);
      osc.start(t);
      osc.stop(t + dur + 0.6);
    }
  });
}

/** Steam whistle: a sine chord that scoops into pitch, with vibrato and breath. */
function whistle(
  b: Bus,
  t: number,
  notes: readonly number[],
  dur: number,
  o: { gain?: number; rise?: number; send?: number; vib?: number } = {},
): void {
  notes.forEach((m, k) => {
    const f = mtof(m);
    const pan = (k / Math.max(1, notes.length - 1) - 0.5) * 0.8;
    voice(b.ctx, tap(b, o.send ?? 0.45, pan), {
      t,
      freq: f * 0.94,
      glideTo: f * (o.rise ?? 1),
      glideTime: o.rise ? dur : 0.14,
      dur,
      gain: o.gain ?? 0.05,
      env: { a: 0.09, d: 0.3, s: 0.85, r: 0.45 },
      vibrato: { rate: 5.6 + k * 0.4, cents: o.vib ?? 14 },
    });
    noiseHit(b.ctx, tap(b, 0.3, pan), {
      t,
      dur,
      type: 'bandpass',
      freq: f,
      q: 6,
      gain: (o.gain ?? 0.05) * 0.8,
      env: { a: 0.08, d: dur, s: 0.6, r: 0.3 },
    });
  });
}

function siren(b: Bus, t: number, f0: number, f1: number, dur: number, gain = 0.1, pan = 0): void {
  voice(b.ctx, tap(b, 0.5, pan), {
    t,
    freq: f0,
    glideTo: f1,
    glideTime: dur,
    dur,
    type: 'triangle',
    gain,
    env: { a: 0.12, d: 0.4, s: 0.9, r: 0.35 },
    vibrato: { rate: 6.5, cents: 35 },
    filter: { freq: 1800, q: 0.8 },
  });
}

function sub(b: Bus, t: number, f0: number, f1: number, dur: number, gain = 0.6): void {
  voice(b.ctx, tap(b, 0.05), {
    t,
    freq: f0,
    glideTo: f1,
    glideTime: dur * 0.8,
    dur: 0.05,
    gain,
    env: { a: 0.005, d: dur, s: 0, r: dur * 0.5 },
  });
}

function crash(b: Bus, t: number, gain = 0.2, dur = 2.4): void {
  noiseHit(b.ctx, tap(b, 0.5, -0.2), { t, dur, type: 'highpass', freq: 3500, gain });
  noiseHit(b.ctx, tap(b, 0.5, 0.2), {
    t,
    dur: dur * 0.6,
    type: 'bandpass',
    freq: 6000,
    q: 0.6,
    gain: gain * 0.7,
  });
  clank(b, t, 1180, {
    gain: gain * 0.5,
    ratio: 2.76,
    index: 5,
    dur: dur * 0.7,
    send: 0.6,
    pan: 0.3,
  });
  clank(b, t, 1730, {
    gain: gain * 0.4,
    ratio: 1.414,
    index: 4,
    dur: dur * 0.6,
    send: 0.6,
    pan: -0.3,
  });
}

function bass(b: Bus, t: number, m: number, dur: number, gain = 0.1, cutoff = 400, pan = 0): void {
  voice(b.ctx, tap(b, 0.04, pan), {
    t,
    freq: mtof(m),
    dur,
    type: 'square',
    gain,
    env: { a: 0.004, d: 0.12, s: 0.55, r: 0.05 },
    filter: { freq: cutoff * 3, envTo: cutoff, envTime: 0.09, q: 3 },
  });
}

/** Heavy press stroke: low thud plus a dull iron body. */
function thud(b: Bus, t: number, gain = 0.9): void {
  kick(b, t, { gain, f0: 95, f1: 30, decay: 0.95, send: 0.15, click: 0.05 });
  noiseHit(b.ctx, tap(b, 0.25), { t, dur: 0.3, type: 'lowpass', freq: 260, gain: gain * 0.5 });
  clank(b, t + 0.01, 96, { gain: gain * 0.12, ratio: 1.41, index: 2, dur: 0.6, send: 0.3 });
}

function stamp(b: Bus, t: number, gain = 0.8): void {
  kick(b, t, { gain, f0: 120, f1: 40, decay: 0.3, send: 0.2, click: 0.1 });
  noiseHit(b.ctx, tap(b, 0.25), { t, dur: 0.12, type: 'lowpass', freq: 700, gain: gain * 0.7 });
  noiseHit(b.ctx, tap(b, 0.15), { t, dur: 0.05, type: 'bandpass', freq: 1500, gain: gain * 0.35 });
}

// Morse for V E S P E R, in grid units (one unit = a sixteenth of the title march).
const MORSE_CODE = ['...-', '.', '...', '.--.', '.', '.-.'];
export const MORSE: { u: number; len: number; letter: number }[] = (() => {
  const out: { u: number; len: number; letter: number }[] = [];
  let u = 0;
  MORSE_CODE.forEach((code, letter) => {
    for (const sym of code) {
      const len = sym === '.' ? 1 : 3;
      out.push({ u, len, letter });
      u += len + 1;
    }
    u += 2;
  });
  return out;
})();
const MORSE_PHRASES = [2, 10];

/** Index of the Morse element sounding at title-bed time `t` (seconds), or -1. */
export function morseAt(t: number): number {
  const sx = 60 / BPM.title / 4;
  const i = Math.floor(t / sx);
  const bar = Math.floor(i / 16) % 16;
  const phrase = MORSE_PHRASES.find((p) => bar >= p && bar < p + 4);
  if (phrase === undefined) return -1;
  const u = ((t / sx) % 256) - phrase * 16;
  return MORSE.findIndex((m) => u >= m.u && u < m.u + m.len);
}

type BedFn = (b: Bus) => Bed;

const TITLE_CHORDS: { root: number; stab: number[] }[] = [
  { root: 38, stab: [62, 65, 69] },
  { root: 34, stab: [62, 65, 70] },
  { root: 31, stab: [62, 67, 70] },
  { root: 33, stab: [61, 64, 69] },
  { root: 38, stab: [62, 65, 69] },
  { root: 41, stab: [60, 65, 69] },
  { root: 36, stab: [60, 64, 67] },
  { root: 33, stab: [61, 64, 69] },
  { root: 34, stab: [62, 65, 70] },
  { root: 36, stab: [60, 64, 67] },
  { root: 38, stab: [62, 65, 69] },
  { root: 38, stab: [62, 65, 69] },
  { root: 31, stab: [62, 67, 70] },
  { root: 33, stab: [61, 64, 69] },
  { root: 38, stab: [62, 65, 69] },
  { root: 33, stab: [61, 64, 69] },
];
type Mel = readonly (readonly [number, number, number])[];
const MEL_A: Mel = [
  [0, 74, 3],
  [3, 69, 1],
  [4, 74, 2],
  [6, 77, 2],
  [8, 76, 4],
  [12, 74, 2],
  [14, 72, 2],
  [16, 74, 6],
  [22, 70, 2],
  [24, 69, 8],
  [32, 67, 3],
  [35, 70, 1],
  [36, 74, 4],
  [40, 72, 2],
  [42, 70, 2],
  [44, 69, 4],
  [48, 73, 6],
  [54, 76, 2],
  [56, 69, 8],
];
const MEL_B: Mel = [
  [0, 77, 3],
  [3, 74, 1],
  [4, 77, 2],
  [6, 79, 2],
  [8, 77, 4],
  [12, 74, 4],
  [16, 76, 6],
  [22, 79, 2],
  [24, 76, 8],
  [32, 74, 3],
  [35, 77, 1],
  [36, 81, 4],
  [40, 79, 2],
  [42, 77, 2],
  [44, 76, 4],
  [48, 74, 12],
];

const titleBed: BedFn = (b) => {
  let origin = 0;
  const sx = 60 / BPM.title / 4;
  return {
    start(t) {
      origin = t;
    },
    schedule(from, to) {
      steps(origin, BPM.title, 4, from, to, (i, t) => {
        const bar = Math.floor(i / 16) % 16;
        const pos = i % 16;
        const ch = TITLE_CHORDS[bar] ?? TITLE_CHORDS[0]!;
        const end4 = bar % 4 === 3;
        if (pos === 0 || pos === 8) kick(b, t, { gain: 0.62, f0: 120, f1: 45, decay: 0.32 });
        if (end4 && pos === 14) kick(b, t, { gain: 0.4, f0: 120, f1: 45, decay: 0.25 });
        if (pos === 4 || pos === 12) snare(b, t, 0.18, 0.1);
        if (pos === 3 || pos === 11) snare(b, t, 0.05, -0.2, 0.05);
        if (end4 && pos >= 13) snare(b, t, 0.06 + (pos - 13) * 0.03, 0.15);
        if (pos % 4 === 2)
          clank(b, t, pos % 8 === 2 ? 520 : 780, {
            gain: 0.035,
            pan: pos % 8 === 2 ? -0.45 : 0.45,
          });
        if (pos === 0) bass(b, t, ch.root, sx * 3, 0.07, 380);
        if (pos === 8) bass(b, t, ch.root + 7, sx * 3, 0.06, 380);
        const inMel = bar < 4 || (bar >= 8 && bar < 12);
        if ((pos === 4 || pos === 12) && (!inMel || pos === 12))
          brass(b, t, ch.stab, sx * 1.4, { gain: 0.028, bright: 1500, attack: 0.012 });
        if (bar >= 12 && (pos === 6 || pos === 14))
          brass(
            b,
            t,
            ch.stab.map((n) => n + 12),
            sx * 1.2,
            { gain: 0.018, bright: 2200, attack: 0.01 },
          );
        if (inMel) {
          const mel = bar < 4 ? MEL_A : MEL_B;
          const u = (bar % 4) * 16 + pos;
          const note = mel.find((n) => n[0] === u);
          if (note)
            brass(b, t, [note[1]], note[2] * sx * 0.92, {
              gain: 0.05,
              bright: 2600,
              attack: 0.025,
              send: 0.3,
            });
        }
        if (bar === 4 || bar === 12) {
          if (pos === 0)
            brass(
              b,
              t,
              ch.stab.map((n) => n - 12),
              sx * 30,
              { gain: 0.028, bright: 700, attack: 0.4 },
            );
        }
        if (bar === 6 && pos === 0)
          brass(
            b,
            t,
            ch.stab.map((n) => n - 12),
            sx * 30,
            { gain: 0.028, bright: 700, attack: 0.4 },
          );
        const phrase = MORSE_PHRASES.find((p) => bar >= p && bar < p + 4);
        if (phrase !== undefined) {
          const u = (i % 256) - phrase * 16;
          const m = MORSE.find((x) => x.u === u);
          if (m) beep(b, t, m.len * sx * 0.82, 1320, 0.05, 0.35, 0.25);
        }
        if (bar % 8 === 7 && pos === 15) bell(b, t, 2350, 0.05, 0.5);
      });
    },
    stop() {},
  };
};

const DAY_ROOTS = [45, 45, 41, 43, 45, 45, 41, 40, 38, 38, 41, 43, 45, 48, 43, 40];
const DAY_STAB: Record<number, number[]> = {
  45: [57, 60, 64],
  41: [57, 60, 65],
  43: [55, 59, 62],
  40: [56, 59, 64],
  38: [57, 62, 65],
  48: [55, 60, 64],
};
const DAY_RIFF = [0, 0, 12, 0, 0, 7, 0, 12, 0, 0, 12, 0, 10, 0, 7, 0];
const DAY_CLANK = [660, 990, 830];

const dayBed: BedFn = (b) => {
  let origin = 0;
  const sx = 60 / BPM.day / 4;
  return {
    start(t) {
      origin = t;
    },
    schedule(from, to) {
      steps(origin, BPM.day, 4, from, to, (i, t) => {
        const bar = Math.floor(i / 16) % 16;
        const pos = i % 16;
        const root = DAY_ROOTS[bar] ?? 45;
        const late = bar >= 8;
        if (pos === 0 || pos === 6 || pos === 8 || (late && pos === 11))
          kick(b, t, { gain: pos === 0 ? 0.66 : 0.5, f0: 130, f1: 44, decay: 0.3 });
        if (pos === 4 || pos === 12) snare(b, t, 0.16, 0, 0.18);
        if (pos % 4 === 2) hat(b, t, 0.035, 0.25);
        if (late && pos % 2 === 1) hat(b, t, 0.016, -0.3);
        if (i % 3 === 0)
          clank(b, t, DAY_CLANK[(i / 3) % 3] ?? 660, { gain: 0.03, pan: -0.55, dur: 0.3 });
        if (i % 4 === 2) clank(b, t, 1240, { gain: 0.02, pan: 0.55, ratio: 2.76, dur: 0.25 });
        const off = DAY_RIFF[pos] ?? 0;
        const sweep = 0.5 - 0.5 * Math.cos((2 * Math.PI * bar) / 16);
        bass(
          b,
          t,
          root + off,
          sx * 0.8,
          pos % 4 === 0 ? 0.075 : 0.055,
          260 + 700 * sweep + (pos % 4 === 0 ? 200 : 0),
        );
        if (late && (pos === 6 || pos === 14))
          brass(b, t, DAY_STAB[root] ?? [57, 60, 64], sx * 1.3, {
            gain: 0.024,
            bright: 1700,
            attack: 0.012,
          });
        if (!late && bar % 2 === 0 && pos === 0)
          brass(
            b,
            t,
            (DAY_STAB[root] ?? [57, 60, 64]).map((n) => n - 12),
            sx * 30,
            { gain: 0.018, bright: 650, attack: 0.5 },
          );
        const r = rng(i * 7 + 3)();
        const density = bar % 4 === 3 ? 0.15 : 0.32;
        if (r < density) typeKey(b, t + r * 0.04, 0.06, r * 2 - 0.4);
        if (r < density * 0.5) typeKey(b, t + sx * 0.5, 0.045, 0.3);
        if (bar % 4 === 3 && pos === 15) bell(b, t, 2350, 0.045, 0.6);
        if (bar % 8 === 0 && pos === 0) anvil(b, t, 440, 0.04, -0.6, 0.6);
      });
    },
    stop() {},
  };
};

const NIGHT_ROOTS = [38, 38, 34, 34, 36, 36, 33, 33];
const NIGHT_PAD: Record<number, number[]> = {
  38: [50, 53, 57],
  34: [50, 53, 58],
  36: [48, 52, 55],
  33: [49, 52, 57],
};

const nightBed: BedFn = (b) => {
  let origin = 0;
  const sx = 60 / BPM.night / 4;
  const parts: { stop(t: number): void }[] = [];
  let drones: OscillatorNode[] = [];
  return {
    start(t) {
      origin = t;
      const { ctx } = b;
      const lp = ctx.createBiquadFilter();
      lp.frequency.value = 240;
      lp.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.03, t + 1.5);
      lp.connect(g).connect(tap(b, 0.3));
      drones = [-7, 6, -1200].map((det, k) => {
        const o = ctx.createOscillator();
        o.type = k === 2 ? 'sine' : 'sawtooth';
        o.frequency.value = mtof(38);
        o.detune.value = det;
        if (k === 2) {
          const sg = ctx.createGain();
          sg.gain.value = 2.2;
          o.connect(sg).connect(lp);
        } else o.connect(lp);
        o.start(t);
        return o;
      });
      parts.push(
        noiseBed(ctx, tap(b, 0.4, 0.3), t, {
          color: 'white',
          type: 'highpass',
          freq: 5200,
          gain: 0.006,
        }),
      );
    },
    schedule(from, to) {
      steps(origin, BPM.night, 4, from, to, (i, t) => {
        const bar = Math.floor(i / 16) % 8;
        const pos = i % 16;
        const root = NIGHT_ROOTS[bar] ?? 38;
        if (pos === 0) for (const o of drones) o.frequency.setTargetAtTime(mtof(root), t, 0.4);
        if (pos === 0 || pos === 8) {
          thud(b, t, pos === 0 ? 0.5 : 0.34);
          noiseHit(b.ctx, tap(b, 0.4, pos === 0 ? -0.5 : 0.5), {
            t: t + 0.12,
            dur: 0.9,
            type: 'highpass',
            freq: 3000,
            gain: 0.035,
            env: { a: 0.12, d: 0.9, s: 0, r: 0.3 },
          });
        }
        if (pos === 6 || pos === 14) {
          noiseHit(b.ctx, tap(b, 0.2, 0.2), {
            t,
            dur: 0.06,
            type: 'bandpass',
            freq: 1300,
            q: 2,
            gain: 0.07,
          });
          clank(b, t, 212, { gain: 0.03, ratio: 2.76, dur: 0.3, pan: 0.2 });
        }
        if (pos === 3 || pos === 11)
          clank(b, t, 1600, { gain: 0.012, ratio: 1.414, dur: 0.12, pan: -0.3 });
        if (bar % 2 === 1 && pos === 4) anvil(b, t, 330, 0.05, -0.6, 0.8, 2.6);
        if (bar % 2 === 0 && pos === 0)
          brass(b, t, NIGHT_PAD[root] ?? [50, 53, 57], sx * 30, {
            gain: 0.03,
            bright: 520,
            attack: 0.9,
            send: 0.45,
          });
        if ((bar === 2 || bar === 5 || bar === 7) && pos >= 9) {
          const r = rng(i * 13 + 5);
          if (r() < 0.6) beep(b, t, r() < 0.35 ? sx * 0.8 : sx * 0.28, 1480, 0.028, 0.6, 0.6);
        }
      });
    },
    stop(t) {
      for (const o of drones) o.stop(t);
      for (const p of parts) p.stop(t);
    },
  };
};

const TRIAL_PEDAL = [40, 41, 42, 43];

const trialBed: BedFn = (b) => {
  let origin = 0;
  let sirenOsc: OscillatorNode | null = null;
  let sirenGain: GainNode | null = null;
  let parts: OscillatorNode[] = [];
  const barDur = (60 / BPM.trial) * 4;
  return {
    start(t) {
      origin = t;
      const { ctx } = b;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 260;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 6;
      const lg = ctx.createGain();
      lg.gain.value = 22;
      lfo.connect(lg).connect(o.detune);
      const lp = ctx.createBiquadFilter();
      lp.frequency.value = 1600;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.018, t + 2);
      o.connect(lp)
        .connect(g)
        .connect(tap(b, 0.5, -0.25));
      o.start(t);
      lfo.start(t);
      sirenOsc = o;
      sirenGain = g;
      parts = [o, lfo];
    },
    schedule(from, to) {
      steps(origin, BPM.trial, 4, from, to, (i, t) => {
        const bar = Math.floor(i / 16) % 16;
        const pos = i % 16;
        const lvl = bar / 15;
        const pedal = TRIAL_PEDAL[Math.floor(bar / 4)] ?? 40;
        if (pos === 0 && sirenOsc && sirenGain) {
          const lo = 240 * 2 ** (bar / 14);
          sirenOsc.frequency.setValueAtTime(lo, t);
          sirenOsc.frequency.exponentialRampToValueAtTime(lo * 1.5, t + barDur * 0.95);
          sirenGain.gain.setTargetAtTime(0.016 + lvl * 0.03, t, 0.5);
        }
        if (pos % 4 === 0) kick(b, t, { gain: 0.55 + lvl * 0.15, f0: 110, f1: 42, decay: 0.28 });
        if (bar >= 8 && pos === 14) kick(b, t, { gain: 0.4, f0: 110, f1: 42, decay: 0.2 });
        const acc = pos % 4 === 0 ? 1 : 0.6;
        bass(b, t, pedal, 0.07, 0.06 * acc, 220 + bar * 45 + acc * 180);
        const g = (0.03 + lvl * 0.1) * (0.55 + 0.45 * (pos / 15));
        if (bar < 4) {
          if (pos % 2 === 0) snare(b, t, g * (pos % 8 === 4 ? 2.2 : 1), 0.15, 0.12);
        } else {
          snare(b, t, g * (pos % 4 === 0 ? 1.6 : 1), pos % 2 ? 0.2 : -0.1, 0.12);
          if (bar >= 12) snare(b, t + 60 / BPM.trial / 8, g * 0.8, 0.1, 0.12);
        }
        if (pos === 12) clank(b, t, 700, { gain: 0.05, ratio: 2.76, dur: 0.5, pan: 0.4 });
        if (pos % 4 === 2) bell(b, t, 3100, 0.012, 0.6, 0.1);
        if (bar >= 4 && pos === 0)
          brass(b, t, [pedal + 24, pedal + 25, pedal + 31], 0.28, {
            gain: 0.03 + lvl * 0.02,
            bright: 1500 + lvl * 1500,
            attack: 0.01,
          });
        if (bar >= 10 && pos === 8)
          brass(b, t, [pedal + 36, pedal + 37], 0.18, { gain: 0.022, bright: 2400, attack: 0.01 });
      });
    },
    stop(t) {
      for (const p of parts) p.stop(t);
    },
  };
};

const DIRGE_PAD = [
  [50, 53, 57],
  [50, 55, 58],
  [49, 52, 57],
  [50, 53, 57],
  [46, 50, 53],
  [48, 52, 55],
  [49, 52, 57],
  [50, 53, 57],
];

const dirgeBed: BedFn = (b) => {
  let origin = 0;
  const sx = 60 / BPM.dirge / 4;
  let hiss: { stop(t: number): void } | null = null;
  return {
    start(t) {
      origin = t;
      hiss = noiseBed(b.ctx, tap(b, 0.5, -0.2), t, {
        color: 'pink',
        type: 'bandpass',
        freq: 2400,
        q: 0.8,
        gain: 0.012,
      });
    },
    schedule(from, to) {
      steps(origin, BPM.dirge, 4, from, to, (i, t) => {
        const bar = Math.floor(i / 16) % 8;
        const pos = i % 16;
        if (pos === 0)
          kick(b, t, { gain: 0.7, f0: 80, f1: 32, decay: 0.8, send: 0.2, click: 0.02 });
        if (pos === 3) kick(b, t, { gain: 0.35, f0: 80, f1: 32, decay: 0.5, send: 0.2, click: 0 });
        if (pos === 8) thud(b, t, 0.35);
        if (pos === 0) anvil(b, t, bar % 2 ? 147 : 196, 0.06, bar % 2 ? 0.4 : -0.4, 0.7, 3.2);
        if (pos === 0)
          brass(b, t, DIRGE_PAD[bar] ?? [50, 53, 57], sx * 15.5, {
            gain: 0.035,
            bright: 680,
            attack: 0.7,
            send: 0.5,
          });
        if (pos === 12 && bar % 4 === 3)
          clank(b, t, 1250, { gain: 0.02, dur: 1, send: 0.7, pan: 0.6 });
      });
    },
    stop(t) {
      hiss?.stop(t);
    },
  };
};

const BEDS: Record<string, BedFn> = {
  title: titleBed,
  day: dayBed,
  night: nightBed,
  trial: trialBed,
  dirge: dirgeBed,
};

export const score: Score = {
  beds: Object.keys(BEDS),
  stings: ['reveal', 'nightfall', 'dawn', 'vote', 'verdict', 'death', 'ballot', 'type', 'stamp'],
  create(ctx, out) {
    const ir = impulse(ctx, 2.8, 2.6, { darkness: 0.55, seed: 11 });
    const bigIr = impulse(ctx, 5, 2.1, { darkness: 0.6, predelay: 0.02, seed: 23 });
    const sb: Bus = { ctx, dry: out, wet: reverb(ctx, bigIr, out, 0.9) };
    return {
      bed(name, bedOut) {
        const fn = BEDS[name] ?? titleBed;
        return fn({ ctx, dry: bedOut, wet: reverb(ctx, ir, bedOut, 0.8) });
      },
      sting(name, t) {
        switch (name) {
          case 'reveal':
            typeBurst(sb, t, 14, 0.75, 41, 0.12);
            bell(sb, t + 0.82, 2350, 0.12, 0.4);
            stamp(sb, t + 1.0, 0.9);
            break;
          case 'type':
            typeBurst(sb, t, 7, 0.35, Math.floor(t * 100), 0.3);
            break;
          case 'stamp':
            stamp(sb, t, 0.8);
            break;
          case 'vote':
            kick(sb, t, { gain: 0.4, f0: 150, f1: 60, decay: 0.15, send: 0.1 });
            clank(sb, t, 520, { gain: 0.2, ratio: 2.76, index: 4, dur: 0.6, send: 0.35 });
            bell(sb, t + 0.04, 1760, 0.1, 0.2, 0.35);
            break;
          case 'ballot':
            stamp(sb, t, 0.55);
            clank(sb, t, 880, { gain: 0.06, ratio: 1.414, dur: 0.25, send: 0.2 });
            break;
          case 'nightfall':
            siren(sb, t, 900, 150, 1.5, 0.16);
            siren(sb, t + 0.05, 905 * 1.5, 225, 1.45, 0.05, 0.4);
            thud(sb, t + 1.5, 1);
            noiseHit(ctx, tap(sb, 0.8), {
              t: t + 1.5,
              dur: 0.6,
              type: 'lowpass',
              freq: 500,
              gain: 0.7,
            });
            clank(sb, t + 1.5, 140, { gain: 0.3, ratio: 1.41, index: 6, dur: 1.6, send: 0.9 });
            anvil(sb, t + 1.52, 220, 0.14, 0.2, 0.9, 3);
            sub(sb, t + 1.5, 60, 28, 2.5, 0.5);
            break;
          case 'dawn':
            whistle(sb, t, [62, 66, 69, 74], 2.2, { gain: 0.045 });
            for (const [k, dt] of [0.5, 0.62, 0.74].entries())
              brass(sb, t + dt, [62, 50], 0.1, {
                gain: 0.05 + k * 0.01,
                bright: 2600,
                attack: 0.008,
              });
            brass(sb, t + 0.9, [69, 57], 0.24, { gain: 0.06, bright: 2800, attack: 0.01 });
            brass(sb, t + 1.15, [50, 62, 66, 69, 74], 1.7, {
              gain: 0.06,
              bright: 3200,
              attack: 0.02,
              spread: 0.7,
            });
            kick(sb, t + 1.15, { gain: 0.7, f0: 100, f1: 40, decay: 0.6, send: 0.3 });
            crash(sb, t + 1.15, 0.08, 2.4);
            break;
          case 'verdict':
            kick(sb, t, { gain: 1, f0: 170, f1: 34, decay: 1.1, send: 0.3, click: 0.3 });
            noiseHit(ctx, tap(sb, 0.6), {
              t,
              dur: 0.45,
              type: 'lowpass',
              freq: 3000,
              sweepTo: 280,
              gain: 0.85,
            });
            brass(sb, t + 0.005, [38, 50, 57, 62, 65, 69, 74], 2.4, {
              gain: 0.07,
              bright: 4200,
              attack: 0.012,
              spread: 0.8,
              send: 0.5,
            });
            crash(sb, t, 0.3, 3);
            sub(sb, t, 58, 28, 3.2, 0.65);
            anvil(sb, t + 0.01, 175, 0.14, 0, 0.8, 3.2);
            break;
          case 'death':
            kick(sb, t, { gain: 1, f0: 140, f1: 30, decay: 1.4, send: 0.4, click: 0.3 });
            sub(sb, t, 62, 24, 3.6, 0.7);
            noiseHit(ctx, tap(sb, 0.7), {
              t,
              dur: 0.35,
              type: 'lowpass',
              freq: 1800,
              sweepTo: 200,
              gain: 0.6,
            });
            whistle(sb, t + 0.05, [86, 87, 91], 1.3, {
              gain: 0.035,
              rise: 1.12,
              vib: 45,
              send: 0.7,
            });
            {
              const r = rng(77);
              let dt = 0.8;
              let gap = 0.22;
              for (let k = 0; k < 15; k++) {
                const f = 300 + r() * 2100;
                clank(sb, t + dt, f, {
                  gain: 0.13 * (1 - k / 18),
                  ratio: r() < 0.5 ? 2.76 : 1.414,
                  index: 3 + r() * 3,
                  dur: 0.25 + r() * 0.5,
                  pan: r() * 1.6 - 0.8,
                  send: 0.5,
                });
                dt += gap * (0.6 + r() * 0.6);
                gap *= 0.86;
              }
              thud(sb, t + dt + 0.1, 0.7);
            }
            break;
        }
      },
    };
  },
};
