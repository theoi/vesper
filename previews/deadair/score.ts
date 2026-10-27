import {
  type Bed,
  type Ctx,
  type Score,
  crush,
  impulse,
  mtof,
  noiseBed,
  noiseHit,
  reverb,
  rng,
  softClip,
  steps,
  voice,
} from '../shared/audio-kit.ts';

// Hash-style randomness keyed by step index, so pattern choices do not depend on how the
// scheduler slices time into windows.
const rand = (i: number, salt = 0) =>
  rng((Math.imul(i + 1, 2654435761) ^ Math.imul(salt + 7, 40503)) >>> 0)();

function pan(ctx: Ctx, out: AudioNode, p: number): AudioNode {
  if (!p) return out;
  const n = ctx.createStereoPanner();
  n.pan.value = Math.max(-1, Math.min(1, p));
  n.connect(out);
  return n;
}

function echo(ctx: Ctx, out: AudioNode, time: number, fb: number, wet: number, tone = 2400) {
  const input = ctx.createGain();
  const d = ctx.createDelay(2);
  d.delayTime.value = time;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = tone;
  const g = ctx.createGain();
  g.gain.value = fb;
  const w = ctx.createGain();
  w.gain.value = wet;
  input.connect(d);
  d.connect(f).connect(g).connect(d);
  f.connect(w).connect(out);
  return input;
}

function kick(ctx: Ctx, out: AudioNode, t: number, g = 0.8, f0 = 150, f1 = 44, len = 0.42) {
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + 0.1);
  const a = ctx.createGain();
  a.gain.setValueAtTime(0, t);
  a.gain.linearRampToValueAtTime(g, t + 0.003);
  a.gain.exponentialRampToValueAtTime(0.001, t + len);
  o.connect(a).connect(out);
  o.start(t);
  o.stop(t + len + 0.02);
  noiseHit(ctx, out, { t, dur: 0.012, gain: g * 0.18, type: 'bandpass', freq: 2500, q: 0.8 });
}

function hat(ctx: Ctx, out: AudioNode, t: number, g: number, open = false, p = 0) {
  noiseHit(ctx, out, {
    t,
    dur: open ? 0.2 : 0.03,
    gain: g,
    type: 'bandpass',
    freq: 6200,
    q: 0.9,
    pan: p,
  });
}

function clap(ctx: Ctx, out: AudioNode, t: number, g: number, p = 0) {
  for (const dt of [0, 0.011, 0.022])
    noiseHit(ctx, out, { t: t + dt, dur: 0.018, gain: g * 0.6, freq: 1300, q: 1.3, pan: p });
  noiseHit(ctx, out, { t: t + 0.03, dur: 0.17, gain: g, freq: 1100, q: 1, pan: p });
}

interface AcidNote {
  t: number;
  midi: number;
  dur: number;
  accent: boolean;
  from?: number;
  cut: number;
  gain?: number;
}

function acid(ctx: Ctx, out: AudioNode, o: AcidNote) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  const f = mtof(o.midi);
  if (o.from !== undefined) {
    osc.frequency.setValueAtTime(mtof(o.from), o.t);
    osc.frequency.exponentialRampToValueAtTime(f, o.t + 0.07);
  } else osc.frequency.setValueAtTime(f, o.t);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = o.accent ? 15 : 10;
  const peak = Math.min(4200, o.cut * (o.accent ? 1.9 : 1));
  lp.frequency.setValueAtTime(peak, o.t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(110, o.cut * 0.16), o.t + o.dur + 0.06);
  const g = ctx.createGain();
  const amp = (o.gain ?? 0.2) * (o.accent ? 1.3 : 1);
  g.gain.setValueAtTime(0, o.t);
  g.gain.linearRampToValueAtTime(amp, o.t + 0.004);
  g.gain.setTargetAtTime(amp * 0.55, o.t + 0.01, o.dur * 0.6);
  g.gain.setTargetAtTime(0, o.t + o.dur, 0.012);
  osc.connect(lp).connect(g).connect(out);
  osc.start(o.t);
  osc.stop(o.t + o.dur + 0.1);
}

interface FmNote {
  t: number;
  freq: number;
  dur: number;
  ratio: number;
  index: number;
  gain: number;
  pan?: number;
}

function fm(ctx: Ctx, out: AudioNode, o: FmNote) {
  const car = ctx.createOscillator();
  car.frequency.setValueAtTime(o.freq, o.t);
  const mod = ctx.createOscillator();
  mod.frequency.setValueAtTime(o.freq * o.ratio, o.t);
  const mg = ctx.createGain();
  mg.gain.setValueAtTime(o.freq * o.index, o.t);
  mg.gain.exponentialRampToValueAtTime(o.freq * o.index * 0.04 + 0.01, o.t + o.dur);
  mod.connect(mg).connect(car.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, o.t);
  g.gain.linearRampToValueAtTime(o.gain, o.t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0004, o.t + o.dur);
  car.connect(g).connect(pan(ctx, out, o.pan ?? 0));
  car.start(o.t);
  mod.start(o.t);
  car.stop(o.t + o.dur + 0.05);
  mod.stop(o.t + o.dur + 0.05);
}

function pad(
  ctx: Ctx,
  out: AudioNode,
  t: number,
  dur: number,
  notes: readonly number[],
  cut: number,
  gain: number,
) {
  notes.forEach((m, i) => {
    for (const det of [-8, 8]) {
      voice(ctx, out, {
        t,
        freq: mtof(m),
        dur,
        type: 'sawtooth',
        gain,
        detune: det,
        env: { a: 0.6, d: 0.8, s: 0.75, r: 1.2 },
        filter: { freq: cut, q: 0.6 },
        pan: (i / Math.max(1, notes.length - 1) - 0.5) * 0.9 * Math.sign(det),
      });
    }
  });
}

type Step = readonly [number, boolean, boolean] | null;

/** "0a" = root accented, "12s" = octave with slide in, "." = rest. */
const pattern = (src: string): Step[] =>
  src.split(/\s+/).map((tok) => {
    if (tok === '.') return null;
    const n = parseInt(tok, 10);
    return [n, tok.includes('a'), tok.includes('s')] as const;
  });

function titleBed(ctx: Ctx, out: AudioNode, ir: AudioBuffer): Bed {
  const bpm = 132;
  const stepDur = 60 / bpm / 4;
  const rv = reverb(ctx, ir, out, 0.45);
  const dly = echo(ctx, out, stepDur * 3, 0.45, 0.5, 2000);
  dly.connect(rv);
  const drums = ctx.createGain();
  drums.gain.value = 0.85;
  drums.connect(out);
  const bassIn = ctx.createGain();
  const bassOut = ctx.createGain();
  bassOut.gain.value = 0.42;
  bassIn.connect(softClip(ctx, 2.4)).connect(bassOut).connect(out);
  const padBus = ctx.createGain();
  padBus.gain.value = 0.55;
  padBus.connect(out);
  padBus.connect(rv);
  // 7/8 grouped 4+4+6 sixteenths; harmony moves every two bars.
  const ROOTS = [45, 45, 41, 41, 48, 48, 43, 40];
  const CHORDS = [
    [57, 60, 64, 71],
    [57, 60, 64, 69],
    [53, 57, 60, 64],
    [53, 60, 64, 67],
    [52, 55, 60, 62],
    [55, 60, 64, 67],
    [55, 59, 62, 65],
    [52, 56, 59, 62],
  ];
  const BASS = [
    pattern('0a . 12 0s . 0 10 . 0a 12 . 7 0 3s'),
    pattern('0a 0 . 12a . 3 . 5s 0 . 12 . 10a 7'),
  ];
  const KICK = [
    [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0],
    [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0],
  ];
  const PENT = [0, 3, 5, 7, 10];
  let origin = 0;
  let prev = 45;
  return {
    start(t) {
      origin = t;
    },
    schedule(from, to) {
      steps(origin, bpm, 4, from, to, (i, t) => {
        const bar = Math.floor(i / 14);
        const s = i % 14;
        const unit = Math.floor(bar / 2) % 8;
        const root = ROOTS[unit] ?? 45;
        const intro = bar < 2;
        if (s === 0 && bar % 2 === 0)
          pad(ctx, padBus, t, stepDur * 26, CHORDS[unit] ?? [57, 60, 64], 700 + unit * 90, 0.022);
        if (!intro && KICK[bar % 4 === 3 ? 1 : 0]?.[s]) kick(ctx, drums, t, 0.75);
        if (!intro && (s === 4 || s === 10)) clap(ctx, drums, t, 0.2, s === 4 ? -0.15 : 0.15);
        if (bar % 4 === 3 && s === 13) clap(ctx, drums, t, 0.09, 0.4);
        if (s % 2 === 1 || (bar % 2 === 1 && s === 12)) {
          const open = s === 13 && bar % 2 === 0;
          hat(ctx, drums, t, open ? 0.06 : s % 4 === 3 ? 0.09 : 0.05, open, 0.35);
        } else if (rand(i, 3) < 0.3) hat(ctx, drums, t, 0.025, false, -0.35);
        const pat = BASS[Math.floor(bar / 4) % 2] ?? [];
        const note = pat[s];
        if (note) {
          const midi = root + note[0];
          const cyc = (bar % 16) / 16;
          acid(ctx, bassIn, {
            t,
            midi,
            dur: stepDur * (note[2] ? 1.6 : 0.9),
            accent: note[1],
            from: note[2] ? prev : undefined,
            cut: 520 + 900 * (0.5 - 0.5 * Math.cos(cyc * Math.PI * 2)),
            gain: 0.2,
          });
          prev = midi;
        }
        const p = bar % 4 === 3 ? 0.32 : 0.15;
        if (rand(i, 11) < p) {
          const deg = PENT[Math.floor(rand(i, 12) * PENT.length)] ?? 0;
          const oct = rand(i, 13) < 0.5 ? 69 : 81;
          fm(ctx, dly, {
            t,
            freq: mtof(oct + deg + ((root - 45) % 12)),
            dur: 0.09,
            ratio: 2,
            index: 1.6,
            gain: 0.05,
            pan: rand(i, 14) * 1.6 - 0.8,
          });
        }
      });
    },
    stop() {},
  };
}

function nightBed(ctx: Ctx, out: AudioNode, ir: AudioBuffer): Bed {
  const rv = reverb(ctx, ir, out, 0.8);
  const dly = echo(ctx, out, 0.5, 0.5, 0.45, 1800);
  dly.connect(rv);
  const ROOTS = [38, 34, 41, 36];
  const PENT = [0, 3, 5, 7, 10, 12];
  let origin = 0;
  const nodes: { stop(t: number): void }[] = [];
  let car: OscillatorNode | null = null;
  let car2: OscillatorNode | null = null;
  let mod: OscillatorNode | null = null;
  return {
    start(t) {
      origin = t;
      const hiss = noiseBed(ctx, out, t, {
        color: 'pink',
        type: 'bandpass',
        freq: 1400,
        q: 0.7,
        gain: 0.075,
      });
      const sweep = ctx.createOscillator();
      sweep.frequency.value = 0.045;
      const sd = ctx.createGain();
      sd.gain.value = 900;
      sweep.connect(sd).connect(hiss.filter.frequency);
      sweep.start(t);
      nodes.push(hiss, sweep);

      const droneLp = ctx.createBiquadFilter();
      droneLp.type = 'lowpass';
      droneLp.frequency.value = 520;
      const droneG = ctx.createGain();
      droneG.gain.setValueAtTime(0, t);
      droneG.gain.linearRampToValueAtTime(0.32, t + 3);
      droneLp.connect(droneG).connect(out);
      droneG.connect(rv);
      car = ctx.createOscillator();
      car2 = ctx.createOscillator();
      car2.type = 'triangle';
      mod = ctx.createOscillator();
      car.frequency.setValueAtTime(mtof(38), t);
      car2.frequency.setValueAtTime(mtof(45), t);
      mod.frequency.setValueAtTime(mtof(38) * 2.003, t);
      const md = ctx.createGain();
      md.gain.value = 30;
      const mdLfo = ctx.createOscillator();
      mdLfo.frequency.value = 0.07;
      const mdAmt = ctx.createGain();
      mdAmt.gain.value = 45;
      mdLfo.connect(mdAmt).connect(md.gain);
      mod.connect(md).connect(car.frequency);
      const c2g = ctx.createGain();
      c2g.gain.value = 0.35;
      car.connect(droneLp);
      car2.connect(c2g).connect(droneLp);
      for (const o of [car, car2, mod, mdLfo]) {
        o.start(t);
        nodes.push(o);
      }
    },
    schedule(from, to) {
      steps(origin, 30 / 4, 1, from, to, (i, t) => {
        const r = ROOTS[i % ROOTS.length] ?? 38;
        car?.frequency.setTargetAtTime(mtof(r), t, 1.2);
        car2?.frequency.setTargetAtTime(mtof(r + 7), t, 1.5);
        mod?.frequency.setTargetAtTime(mtof(r) * 2.003, t, 1.2);
      });
      steps(origin, 75, 1, from, to, (i, t) => {
        if (i < 1) return;
        const g = i % 8 === 0 ? 0.55 : 0.4;
        kick(ctx, out, t, g, 70, 32, 0.32);
        kick(ctx, out, t + 0.24, g * 0.6, 62, 30, 0.3);
      });
      steps(origin, 90, 2, from, to, (i, t) => {
        if (rand(i, 21) > 0.13) return;
        const sec = Math.floor((t - origin) / 8) % ROOTS.length;
        const deg = PENT[Math.floor(rand(i, 22) * PENT.length)] ?? 0;
        fm(ctx, dly, {
          t,
          freq: mtof((ROOTS[sec] ?? 38) + 36 + deg),
          dur: 0.5,
          ratio: 3.01,
          index: 1.2,
          gain: 0.07,
          pan: rand(i, 23) * 1.8 - 0.9,
        });
      });
      steps(origin, 60 / 11, 1, from, to, (i, t) => {
        if (i < 1) return;
        noiseHit(ctx, rv, {
          t,
          dur: 0.9,
          gain: 0.05,
          freq: 600,
          sweepTo: 3200,
          q: 4,
          pan: rand(i, 31) - 0.5,
        });
      });
    },
    stop(t) {
      nodes.forEach((n) => n.stop(t));
    },
  };
}

function dayBed(ctx: Ctx, out: AudioNode, ir: AudioBuffer): Bed {
  const bpm = 124;
  const stepDur = 60 / bpm / 4;
  const rv = reverb(ctx, ir, out, 0.4);
  const dly = echo(ctx, out, stepDur * 3, 0.38, 0.42, 2600);
  dly.connect(rv);
  const drums = ctx.createGain();
  drums.gain.value = 0.85;
  drums.connect(out);
  const bassIn = ctx.createGain();
  const bassOut = ctx.createGain();
  bassOut.gain.value = 0.38;
  bassIn.connect(softClip(ctx, 2.2)).connect(bassOut).connect(out);
  // E phrygian: the flat second keeps the bright groove uneasy.
  const ROOTS = [40, 40, 41, 40, 38, 38, 41, 43];
  const BELL = [
    [64, 67, 71, 76],
    [64, 67, 71, 74],
    [65, 69, 72, 76],
    [64, 67, 71, 77],
    [62, 65, 69, 74],
    [62, 65, 69, 72],
    [65, 69, 72, 77],
    [67, 71, 74, 77],
  ];
  const BASS = [
    pattern('0a . 0 12 . 0 . 0s 0a . 12 . 1 . 0 12s'),
    pattern('0a 0 . 12a 0 . 3 . 0a . 0 12 . 13s 12 .'),
  ];
  let origin = 0;
  let prev = 40;
  return {
    start(t) {
      origin = t;
    },
    schedule(from, to) {
      steps(origin, bpm, 4, from, to, (i, t) => {
        const bar = Math.floor(i / 16);
        const s = i % 16;
        const unit = bar % 8;
        const root = ROOTS[unit] ?? 40;
        const fill = bar % 4 === 3;
        if (s % 4 === 0 && !(fill && s === 12)) kick(ctx, drums, t, 0.72);
        if (fill && s === 14) kick(ctx, drums, t, 0.5);
        if (s === 4 || s === 12) clap(ctx, drums, t, 0.22, 0.1);
        hat(ctx, drums, t, s % 4 === 2 ? 0.075 : 0.035, s % 4 === 2 && s % 8 === 6, 0.3);
        if (s % 3 === 0) {
          fm(ctx, out, {
            t,
            freq: mtof(91),
            dur: 0.03,
            ratio: 1.5,
            index: 0.6,
            gain: 0.018,
            pan: -0.5,
          });
        }
        const note = (BASS[Math.floor(bar / 2) % 2] ?? [])[s];
        if (note) {
          const midi = root + note[0];
          acid(ctx, bassIn, {
            t,
            midi,
            dur: stepDur * (note[2] ? 1.5 : 0.8),
            accent: note[1],
            from: note[2] ? prev : undefined,
            cut: 700 + 500 * Math.sin((bar / 8) * Math.PI),
            gain: 0.19,
          });
          prev = midi;
        }
        const arpPos = [0, 3, 6, 8, 11, 14].indexOf(s);
        if (arpPos >= 0) {
          const chord = BELL[unit] ?? [64, 67, 71];
          const up = bar % 2 === 0;
          const idx = up ? arpPos % chord.length : chord.length - 1 - (arpPos % chord.length);
          fm(ctx, dly, {
            t,
            freq: mtof(chord[idx] ?? 64),
            dur: 0.6,
            ratio: 3.5,
            index: 1.4,
            gain: 0.045,
            pan: arpPos % 2 ? 0.55 : -0.55,
          });
        }
      });
    },
    stop() {},
  };
}

function trialBed(ctx: Ctx, out: AudioNode, ir: AudioBuffer): Bed {
  const bpm = 100;
  const rv = reverb(ctx, ir, out, 0.55);
  const N = 7;
  const CYCLE = N * 4;
  const F0 = 55;
  const bell = (x: number) => Math.exp(-((x - 0.5) ** 2) / (2 * 0.15 ** 2));
  const shepLp = ctx.createBiquadFilter();
  shepLp.type = 'lowpass';
  shepLp.Q.value = 1.2;
  const shep = ctx.createGain();
  shep.gain.value = 0.1;
  shep.connect(shepLp);
  shepLp.connect(out);
  shepLp.connect(rv);
  const bassLp = ctx.createBiquadFilter();
  bassLp.type = 'lowpass';
  bassLp.Q.value = 7;
  const bassOut = ctx.createGain();
  bassOut.gain.value = 0.36;
  bassLp.connect(softClip(ctx, 2)).connect(bassOut).connect(out);
  const ROOTS = [33, 34, 35, 36];
  const voices: { o: OscillatorNode; g: GainNode; next: number }[] = [];
  const rise = (v: { o: OscillatorNode; g: GainNode; next: number }, ts: number, phase: number) => {
    const dur = CYCLE * (1 - phase);
    v.o.frequency.setValueAtTime(F0 * 2 ** (N * phase), ts);
    v.o.frequency.exponentialRampToValueAtTime(F0 * 2 ** N, ts + dur);
    const n = Math.max(2, Math.round(24 * (1 - phase)));
    v.g.gain.setValueAtTime(bell(phase), ts);
    for (let s = 1; s <= n; s++) {
      v.g.gain.linearRampToValueAtTime(bell(phase + (1 - phase) * (s / n)), ts + dur * (s / n));
    }
    v.next = ts + dur;
  };
  let origin = 0;
  return {
    start(t) {
      origin = t;
      shepLp.frequency.setValueAtTime(500, t);
      shepLp.frequency.exponentialRampToValueAtTime(4200, t + 20);
      bassLp.frequency.setValueAtTime(170, t);
      bassLp.frequency.exponentialRampToValueAtTime(1500, t + 20);
      for (let i = 0; i < N; i++) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g).connect(pan(ctx, shep, i % 2 ? 0.4 : -0.4));
        const v = { o, g, next: 0 };
        rise(v, t, i / N);
        o.start(t);
        voices.push(v);
      }
    },
    schedule(from, to) {
      for (const v of voices) while (v.next < to) rise(v, v.next, 0);
      steps(origin, bpm, 2, from, to, (i, t) => {
        const bar = Math.floor(i / 8);
        const root = ROOTS[Math.floor(bar / 4) % ROOTS.length] ?? 33;
        const up = i % 8 === 7 || (i % 4 === 3 && bar % 2 === 1);
        voice(ctx, bassLp, {
          t,
          freq: mtof(root + (up ? 12 : 0)),
          dur: 0.18,
          type: 'sawtooth',
          gain: i % 2 ? 0.16 : 0.22,
          env: { a: 0.004, d: 0.12, s: 0.5, r: 0.1 },
        });
        noiseHit(ctx, out, {
          t,
          dur: 0.025,
          gain: i % 2 ? 0.05 : 0.11,
          freq: i % 2 ? 2300 : 3200,
          q: 9,
          pan: i % 2 ? 0.45 : -0.45,
        });
        if (i % 32 === 0) {
          kick(ctx, out, t, 0.6, 90, 36, 0.9);
          noiseHit(ctx, rv, { t, dur: 0.6, gain: 0.12, type: 'lowpass', freq: 500 });
        }
      });
    },
    stop(t) {
      voices.forEach((v) => v.o.stop(t));
    },
  };
}

const BED_TRIM: Record<string, number> = { title: 0.55, night: 0.34, day: 0.62, trial: 0.68 };

export const score: Score = {
  beds: ['title', 'night', 'day', 'trial'],
  stings: ['reveal', 'nightfall', 'dawn', 'vote', 'verdict', 'death'],
  create(ctx, out) {
    const ir = impulse(ctx, 3.2, 3, { darkness: 0.6, seed: 9 });
    const rv = reverb(ctx, ir, out, 0.6);
    const grit = ctx.createGain();
    grit.gain.value = 0.7;
    grit.connect(crush(ctx, 6)).connect(out);

    const stings: Record<string, (t: number) => void> = {
      reveal(t) {
        const r = rng(41);
        for (let i = 0; i < 24; i++) {
          fm(ctx, out, {
            t: t + i * 0.026,
            freq: mtof(72 + Math.floor(r() * 26)),
            dur: 0.045,
            ratio: 2 + Math.floor(r() * 4),
            index: 2.5,
            gain: 0.09,
            pan: r() * 1.6 - 0.8,
          });
        }
        noiseHit(ctx, grit, { t, dur: 0.62, gain: 0.12, freq: 2400, q: 0.6, sweepTo: 600 });
        const hit = t + 0.66;
        kick(ctx, out, hit, 0.8, 110, 36, 0.8);
        noiseHit(ctx, rv, { t: hit, dur: 0.25, gain: 0.2, freq: 1600, q: 0.7 });
        [38, 50, 57, 62, 64, 69].forEach((m, i) => {
          voice(ctx, out, {
            t: hit,
            freq: mtof(m),
            dur: 1.6,
            type: 'sawtooth',
            gain: 0.05,
            detune: i % 2 ? 7 : -7,
            env: { a: 0.01, d: 1.2, s: 0.4, r: 1.6 },
            filter: { freq: 3000, q: 1.5, envTo: 500, envTime: 2.2 },
            pan: (i / 5 - 0.5) * 1.2,
          });
          voice(ctx, rv, {
            t: hit,
            freq: mtof(m),
            dur: 1.8,
            type: 'triangle',
            gain: 0.05,
            env: { a: 0.02, d: 1, s: 0.5, r: 2 },
          });
        });
        fm(ctx, rv, { t: hit, freq: mtof(81), dur: 2.2, ratio: 3.5, index: 2, gain: 0.08 });
      },
      vote(t) {
        fm(ctx, out, { t, freq: 880, dur: 0.11, ratio: 1.5, index: 4, gain: 0.2, pan: 0.1 });
        fm(ctx, rv, { t, freq: 1320, dur: 0.18, ratio: 2, index: 1, gain: 0.06 });
        noiseHit(ctx, grit, { t, dur: 0.04, gain: 0.5, freq: 1800, q: 0.7 });
        kick(ctx, out, t, 0.35, 220, 80, 0.12);
      },
      nightfall(t) {
        voice(ctx, out, {
          t,
          freq: 4200,
          glideTo: 55,
          glideTime: 1.1,
          dur: 1.0,
          type: 'sine',
          gain: 0.045,
          env: { a: 0.01, d: 0.5, s: 0.9, r: 0.3 },
        });
        voice(ctx, out, {
          t,
          freq: 1400,
          glideTo: 40,
          glideTime: 1,
          dur: 0.9,
          type: 'triangle',
          gain: 0.08,
          env: { a: 0.01, d: 0.4, s: 0.8, r: 0.3 },
          filter: { freq: 2400, q: 2 },
        });
        noiseHit(ctx, grit, { t: t + 0.3, dur: 0.5, gain: 0.18, freq: 3000, sweepTo: 300, q: 1 });
        kick(ctx, out, t + 0.88, 1, 95, 26, 1.1);
        noiseHit(ctx, rv, { t: t + 0.88, dur: 0.4, gain: 0.35, type: 'lowpass', freq: 400 });
        noiseHit(ctx, out, {
          t: t + 0.9,
          dur: 2.4,
          gain: 0.12,
          color: 'pink',
          freq: 700,
          sweepTo: 2600,
          q: 0.8,
          env: { a: 1.1, d: 1.6, s: 0, r: 0.4 },
        });
        voice(ctx, rv, {
          t: t + 0.9,
          freq: mtof(26),
          dur: 2,
          type: 'sine',
          gain: 0.3,
          env: { a: 0.3, d: 1.5, s: 0.4, r: 1.5 },
        });
      },
      dawn(t) {
        const hum = ctx.createOscillator();
        hum.type = 'sawtooth';
        hum.frequency.value = 50;
        const hlp = ctx.createBiquadFilter();
        hlp.type = 'lowpass';
        hlp.frequency.value = 420;
        const hg = ctx.createGain();
        hg.gain.setValueAtTime(0, t);
        hg.gain.linearRampToValueAtTime(0.16, t + 0.02);
        hg.gain.setTargetAtTime(0.05, t + 0.05, 0.25);
        hg.gain.setTargetAtTime(0, t + 1.8, 0.3);
        const wob = ctx.createOscillator();
        wob.frequency.value = 7;
        const wg = ctx.createGain();
        wg.gain.setValueAtTime(0.1, t);
        wg.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
        wob.connect(wg).connect(hg.gain);
        hum.connect(hlp).connect(hg).connect(out);
        for (const o of [hum, wob]) {
          o.start(t);
          o.stop(t + 3.2);
        }
        kick(ctx, out, t, 0.9, 120, 40, 0.5);
        noiseHit(ctx, out, { t, dur: 0.08, gain: 0.3, type: 'lowpass', freq: 600 });
        voice(ctx, out, {
          t: t + 0.05,
          freq: 260,
          glideTo: 3000,
          glideTime: 0.85,
          dur: 0.8,
          type: 'sine',
          gain: 0.04,
          env: { a: 0.3, d: 0.4, s: 0.8, r: 0.1 },
        });
        const hit = t + 0.86;
        [57, 61, 64, 68, 71, 76].forEach((m, i) => {
          voice(ctx, out, {
            t: hit,
            freq: mtof(m),
            dur: 1.4,
            type: 'sawtooth',
            gain: 0.04,
            detune: i % 2 ? 6 : -6,
            env: { a: 0.01, d: 1.1, s: 0.45, r: 1.6 },
            filter: { freq: 3400, q: 0.8, envTo: 900, envTime: 2.4 },
            pan: (i / 5 - 0.5) * 1.3,
          });
          voice(ctx, rv, {
            t: hit,
            freq: mtof(m + 12),
            dur: 1.2,
            type: 'triangle',
            gain: 0.03,
            env: { a: 0.02, d: 1, s: 0.4, r: 2 },
          });
        });
        [69, 73, 76, 80, 83].forEach((m, i) =>
          fm(ctx, rv, {
            t: hit + i * 0.06,
            freq: mtof(m),
            dur: 1.2,
            ratio: 3.5,
            index: 1.5,
            gain: 0.05,
            pan: i % 2 ? 0.6 : -0.6,
          }),
        );
      },
      verdict(t) {
        const sub = ctx.createOscillator();
        sub.frequency.setValueAtTime(120, t);
        sub.frequency.exponentialRampToValueAtTime(30, t + 1.4);
        const sg = ctx.createGain();
        sg.gain.setValueAtTime(0, t);
        sg.gain.linearRampToValueAtTime(0.95, t + 0.01);
        sg.gain.setTargetAtTime(0, t + 0.9, 0.5);
        sub.connect(sg).connect(out);
        sub.start(t);
        sub.stop(t + 3.5);
        kick(ctx, out, t, 1, 160, 38, 0.7);
        const src = ctx.createBufferSource();
        const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.2), ctx.sampleRate);
        const d = nb.getChannelData(0);
        const r = rng(77);
        for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
        src.buffer = nb;
        const nlp = ctx.createBiquadFilter();
        nlp.type = 'lowpass';
        nlp.frequency.setValueAtTime(5000, t);
        nlp.frequency.exponentialRampToValueAtTime(700, t + 1);
        const gate = ctx.createGain();
        const gs = 60 / 128 / 4;
        gate.gain.setValueAtTime(0, t);
        for (let k = 0; k < 8; k++) {
          const at = t + k * gs;
          gate.gain.setValueAtTime(0.32 * (1 - k / 10), at);
          gate.gain.setValueAtTime(0, at + gs * 0.55);
        }
        src.connect(nlp).connect(gate).connect(out);
        gate.connect(rv);
        src.start(t);
        src.stop(t + 1.2);
        const dist = softClip(ctx, 5);
        const dlp = ctx.createBiquadFilter();
        dlp.type = 'lowpass';
        dlp.frequency.setValueAtTime(3200, t);
        dlp.frequency.exponentialRampToValueAtTime(260, t + 3);
        const dg = ctx.createGain();
        dg.gain.setValueAtTime(0, t);
        dg.gain.linearRampToValueAtTime(0.2, t + 0.01);
        dg.gain.setTargetAtTime(0, t + 1.2, 0.7);
        dist.connect(dlp).connect(dg).connect(out);
        dg.connect(rv);
        [28, 40, 47, 52, 55, 59].forEach((m, i) => {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = mtof(m);
          o.detune.value = i % 2 ? 9 : -9;
          const g = ctx.createGain();
          g.gain.value = 0.22;
          o.connect(g).connect(dist);
          o.start(t);
          o.stop(t + 4.5);
        });
        noiseHit(ctx, rv, { t, dur: 0.5, gain: 0.4, freq: 900, q: 0.5 });
      },
      death(t) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(2600, t);
        lp.frequency.exponentialRampToValueAtTime(140, t + 1.2);
        const cg = ctx.createGain();
        cg.gain.setValueAtTime(0, t);
        cg.gain.linearRampToValueAtTime(0.26, t + 0.02);
        cg.gain.setValueAtTime(0.26, t + 0.5);
        cg.gain.linearRampToValueAtTime(0, t + 1.25);
        const clip = softClip(ctx, 2.5);
        lp.connect(clip).connect(cg).connect(out);
        cg.connect(rv);
        [45, 52, 57, 60, 64, 69].forEach((m, i) => {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.detune.value = i % 2 ? 6 : -6;
          const f = mtof(m);
          o.frequency.setValueAtTime(f, t);
          o.frequency.setValueAtTime(f, t + 0.25);
          o.frequency.exponentialRampToValueAtTime(f / 12, t + 1.25);
          const g = ctx.createGain();
          g.gain.value = 0.16;
          o.connect(g).connect(pan(ctx, lp, (i / 5 - 0.5) * 1.2));
          o.start(t);
          o.stop(t + 1.3);
        });
        const cut = t + 1.25;
        noiseHit(ctx, grit, { t: cut, dur: 0.45, gain: 0.5, freq: 1800, q: 0.4 });
        noiseHit(ctx, out, { t: cut, dur: 0.5, gain: 0.25, type: 'lowpass', freq: 5000 });
        kick(ctx, out, cut, 0.9, 80, 28, 0.8);
        voice(ctx, out, {
          t: cut + 0.5,
          freq: 1000,
          dur: 2.4,
          type: 'sine',
          gain: 0.07,
          env: { a: 0.005, d: 0.1, s: 1, r: 1.6 },
        });
        voice(ctx, rv, {
          t: cut,
          freq: mtof(21),
          dur: 2,
          type: 'sine',
          gain: 0.3,
          env: { a: 0.05, d: 1.5, s: 0.3, r: 1.5 },
        });
      },
    };

    return {
      bed(name, bedOut) {
        const trim = ctx.createGain();
        trim.gain.value = BED_TRIM[name] ?? 0.5;
        trim.connect(bedOut);
        if (name === 'night') return nightBed(ctx, trim, ir);
        if (name === 'day') return dayBed(ctx, trim, ir);
        if (name === 'trial') return trialBed(ctx, trim, ir);
        return titleBed(ctx, trim, ir);
      },
      sting(name, t) {
        stings[name]?.(t);
      },
    };
  },
};
