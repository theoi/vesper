import { bank, CELLO, GLASS, HUMS, PIANO, SINGERS, VIOLIN } from './bank.ts';
import { clamp, hash, noise, rng, st, type Ctx } from './dsp.ts';

/** Where a bed or cue writes: the dry signal and two reverb sends. */
export interface Outs {
  dry: AudioNode;
  hall: AudioNode;
  room: AudioNode;
}

/** Counts scheduled sources so beds and cue bursts cannot pile up without bound. */
export class Voices {
  active = 0;
  peak = 0;
  limit = Number.POSITIVE_INFINITY;
  can(): boolean {
    return this.active < this.limit;
  }
  track(node: AudioScheduledSourceNode): void {
    this.active++;
    if (this.active > this.peak) this.peak = this.active;
    node.addEventListener(
      'ended',
      () => {
        this.active--;
      },
      { once: true },
    );
  }
}

export interface PlayOpts {
  rate?: number;
  pan?: number;
  offset?: number;
  /** Play at most this long, then fade over `release`. */
  dur?: number;
  attack?: number;
  release?: number;
  loop?: boolean;
  lp?: number;
  hp?: number;
  /** Send levels into the hall and room reverbs. */
  hall?: number;
  room?: number;
  /** Write into this node instead of the dry output. */
  to?: AudioNode;
  reverse?: boolean;
}

export interface Voice {
  src: AudioBufferSourceNode;
  stop(t: number, release?: number): void;
}

export interface Holder {
  /** Start the loop at `t` if its sample has been decoded and it has not started yet. */
  ensure(t: number): void;
  stop(t: number): void;
}

type Table = readonly (readonly [string, number])[];

/** The sample nearest to `midi` and the playback rate that tunes it there. */
function nearest(table: Table, midi: number): [string, number] {
  let best = table[0] ?? ['', 0];
  for (const s of table) if (Math.abs(s[1] - midi) < Math.abs(best[1] - midi)) best = s;
  return [best[0], st(midi - best[1])];
}

interface SendOpts {
  pan?: number;
  hall?: number;
  room?: number;
  lp?: number;
}

/**
 * The company: every sound is placed at an explicit time on the context clock, so the same
 * code runs live (driven by the lookahead scheduler) and offline (renders used for checks).
 */
export class Band {
  readonly r: () => number;

  constructor(
    readonly ctx: Ctx,
    readonly outs: Outs,
    readonly voices: Voices,
    seed = 1,
  ) {
    this.r = rng(seed);
  }

  duration(name: string): number {
    return bank.duration(name);
  }

  has(name: string): boolean {
    return !!bank.get(name);
  }

  private send(from: AudioNode, to: AudioNode, level: number): void {
    const s = this.ctx.createGain();
    s.gain.value = level;
    from.connect(s).connect(to);
  }

  /** Schedule a sample at `t` with `gain` relative to its normalised peak. */
  play(name: string, t: number, gain: number, o: PlayOpts = {}): Voice | null {
    const buf = o.reverse ? bank.reversed(name) : bank.get(name);
    if (!buf || !(gain > 0) || !this.voices.can()) return null;
    const ctx = this.ctx;
    t = Math.max(0, t);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (o.rate) src.playbackRate.value = o.rate;
    src.loop = !!o.loop;
    let node: AudioNode = src;
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lp;
      f.Q.value = 0.5;
      node = node.connect(f);
    }
    if (o.hp) {
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = o.hp;
      f.Q.value = 0.5;
      node = node.connect(f);
    }
    const g = ctx.createGain();
    const peak = gain * bank.norm(name);
    const attack = o.attack ?? 0.004;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    node.connect(g);
    let tail: AudioNode = g;
    if (o.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(o.pan, -1, 1);
      tail = g.connect(p);
    }
    tail.connect(o.to ?? this.outs.dry);
    if (o.hall) this.send(tail, this.outs.hall, o.hall);
    if (o.room) this.send(tail, this.outs.room, o.room);
    src.start(t, clamp(o.offset ?? 0, 0, Math.max(0, buf.duration - 0.01)));
    this.voices.track(src);
    let stopped = false;
    const stop = (at: number, release = o.release ?? 0.08) => {
      if (stopped) return;
      stopped = true;
      const from = Math.max(t + attack, at);
      g.gain.setValueAtTime(peak, from);
      g.gain.linearRampToValueAtTime(0, from + release);
      src.stop(from + release + 0.02);
    };
    if (o.dur !== undefined) stop(t + o.dur);
    return { src, stop };
  }

  /** A looping sample held by a bed; it starts once the sample is decoded. */
  hold(name: string, gain: number, o: PlayOpts = {}): Holder {
    let v: Voice | null = null;
    let stopped = false;
    return {
      ensure: (t) => {
        if (v || stopped || !this.has(name)) return;
        const len = this.duration(name);
        v = this.play(name, t, gain, {
          loop: true,
          attack: 1.5,
          offset: hash(Math.floor(t * 10)) * Math.max(0, len - 1),
          ...o,
        });
      },
      stop: (t) => {
        stopped = true;
        v?.stop(t, 0.4);
      },
    };
  }

  /** A sustained sung note of any length: overlapping grains of the nearest recording. */
  sing(
    midi: number,
    t: number,
    dur: number,
    gain: number,
    o: SendOpts & { attack?: number } = {},
  ): void {
    let v: (typeof SINGERS)[number] = SINGERS[0];
    for (const s of SINGERS) if (Math.abs(s.midi - midi) < Math.abs(v.midi - midi)) v = s;
    let shift = midi - v.midi;
    while (shift > 7) shift -= 12;
    while (shift < -9) shift += 12;
    const rate = st(shift);
    const span = v.s1 - v.s0;
    const g = Math.min(2.4, span / rate - 0.05);
    let first = true;
    for (let tt = t; tt < t + dur; tt += g * 0.5) {
      this.play(v.name, tt, gain, {
        rate,
        offset: v.s0 + this.r() * Math.max(0, span - g * rate),
        attack: first && o.attack !== undefined ? o.attack : g * 0.4,
        dur: g * 0.6,
        release: g * 0.4,
        pan: o.pan,
        hall: o.hall,
        room: o.room,
        lp: o.lp,
      });
      first = false;
    }
  }

  /** A sung chord, voices spread across the stage. */
  chord(notes: readonly number[], t: number, dur: number, gain: number, o: SendOpts = {}): void {
    notes.forEach((m, i) =>
      this.sing(m, t, dur, gain * (i === 0 ? 0.9 : 0.7), {
        ...o,
        pan: (o.pan ?? 0) + ([-0.1, -0.45, 0.4, 0.15][i] ?? 0),
      }),
    );
  }

  /** A hummed drone at `midi` from overlapping grains of a hum recording. */
  hum(
    midi: number,
    t: number,
    dur: number,
    gain: number,
    o: SendOpts & { kind?: keyof typeof HUMS } = {},
  ): void {
    const h = HUMS[o.kind ?? 'group'];
    const rate = st(midi - h.midi);
    const span = h.s1 - h.s0;
    const g = Math.max(0.6, Math.min(2.6, span / rate - 0.05));
    for (let tt = t; tt < t + dur; tt += g * 0.5)
      this.play(h.name, tt, gain, {
        rate,
        offset: h.s0 + this.r() * Math.max(0, span - g * rate),
        attack: g * 0.45,
        dur: g * 0.55,
        release: g * 0.45,
        pan: (o.pan ?? 0) + (this.r() - 0.5) * 0.4,
        hall: o.hall,
        room: o.room,
        lp: o.lp,
      });
  }

  /** Felt piano: a pitch-shifted grand with its hammers muffled by a lowpass. */
  piano(midi: number, t: number, gain: number, dur = 3, o: SendOpts = {}): void {
    const [name, rate] = nearest(PIANO, midi);
    this.play(name, t, gain, {
      rate,
      dur,
      attack: 0.006,
      release: 1.2,
      lp: o.lp ?? 1600,
      pan: o.pan,
      hall: o.hall ?? 0.35,
      room: o.room,
    });
  }

  /** A bowed note; long notes are re-bowed with overlapping strokes. */
  bow(
    kind: 'cello' | 'violin',
    midi: number,
    t: number,
    dur: number,
    gain: number,
    o: SendOpts & { attack?: number } = {},
  ): Voice | null {
    const [name, rate] = nearest(kind === 'cello' ? CELLO : VIOLIN, midi);
    const stroke = 2.6;
    let first: Voice | null = null;
    for (let s = 0; s < dur; s += stroke - 0.5) {
      const v = this.play(name, t + s, gain, {
        rate,
        offset: 0.05,
        dur: Math.min(stroke, dur - s + 0.4),
        attack: s === 0 ? (o.attack ?? 0.12) : 0.45,
        release: 0.6,
        pan: o.pan,
        hall: o.hall ?? 0.5,
        room: o.room,
        lp: o.lp,
      });
      first ??= v;
    }
    return first;
  }

  /** A rubbed wine glass. */
  glass(midi: number, t: number, gain: number, len = 3.5, o: SendOpts = {}): void {
    const [name, rate] = nearest(GLASS, midi);
    this.play(name, t, gain, {
      rate,
      offset: 0.2,
      dur: len,
      attack: 1,
      release: 1.4,
      pan: o.pan,
      hall: o.hall ?? 0.6,
      lp: o.lp,
    });
  }

  /** A whisper that travels around the listener's head (pan sweep, darker when behind). */
  circling(
    name: string,
    t: number,
    dur: number,
    gain: number,
    seed: number,
    o: { lp?: number; width?: number; hall?: number } = {},
  ): void {
    if (!this.has(name) || !this.voices.can()) return;
    const ctx = this.ctx;
    t = Math.max(0, t);
    const p = ctx.createStereoPanner();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.connect(p).connect(this.outs.dry);
    const n = 32;
    const pans = new Float32Array(n);
    const freqs = new Float32Array(n);
    const start = hash(seed) * Math.PI * 2;
    const dir = seed % 2 ? 1 : -1;
    const top = o.lp ?? 5000;
    for (let i = 0; i < n; i++) {
      const ph = start + dir * (i / (n - 1)) * Math.PI * 1.4;
      pans[i] = Math.sin(ph) * (o.width ?? 0.95);
      freqs[i] = top * (0.55 + 0.45 * Math.cos(ph));
    }
    p.pan.setValueCurveAtTime(pans, t, dur);
    f.frequency.setValueCurveAtTime(freqs, t, dur);
    const off = hash(seed + 3) * Math.max(0, this.duration(name) - dur);
    this.play(name, t, gain, {
      offset: off,
      dur,
      attack: 0.5,
      release: 0.6,
      to: f,
      hall: o.hall ?? 0.3,
    });
  }

  /** A sample whose position slides from `from` to `to` across the stage. */
  cross(name: string, t: number, dur: number, gain: number, from: number, to: number, lp = 3000) {
    if (!this.has(name) || !this.voices.can()) return;
    t = Math.max(0, t);
    const p = this.ctx.createStereoPanner();
    p.pan.setValueAtTime(from, t);
    p.pan.linearRampToValueAtTime(to, t + dur);
    p.connect(this.outs.dry);
    this.play(name, t, gain, { dur, attack: 0.3, release: 0.8, lp, to: p, hall: 0.3 });
  }

  /** A knock on the oak: the recorded knock plus the table's low body. */
  knock(t: number, gain: number, o: { name?: string; pan?: number; far?: boolean } = {}): void {
    const far = !!o.far;
    this.play(o.name ?? 'knock-01', t, gain, {
      rate: 0.94 + hash(Math.floor(t * 100)) * 0.1,
      pan: o.pan,
      lp: far ? 1400 : undefined,
      room: far ? 0 : 0.35,
      hall: far ? 0.9 : 0.1,
    });
    if (!far) this.thump(t, gain * 0.3, 70, o.pan);
  }

  /** Sub thump under a stomp or knock: synthesis supports the body, never replaces it. */
  thump(t: number, gain: number, f = 58, pan = 0): void {
    if (!(gain > 0) || !this.voices.can()) return;
    const ctx = this.ctx;
    t = Math.max(0, t);
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(f * 1.6, t);
    osc.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.01, 0.06);
    let tail: AudioNode = osc.connect(g);
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      tail = tail.connect(p);
    }
    tail.connect(this.outs.dry);
    osc.start(t);
    osc.stop(t + 0.45);
    this.voices.track(osc);
  }

  /** A filtered-noise swell (air moving, a lamp rising or lowering). */
  swell(t: number, dur: number, gain: number, from: number, to: number, hall = 0.5): void {
    if (!this.voices.can()) return;
    const ctx = this.ctx;
    t = Math.max(0, t);
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx, 'pink');
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.65);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(f).connect(g).connect(this.outs.dry);
    if (hall) this.send(g, this.outs.hall, hall);
    src.start(t, (t * 1.37) % 3);
    src.stop(t + dur + 0.05);
    this.voices.track(src);
  }

  /** A sharp crack of filtered noise, for the gunshot-like clap. */
  crack(t: number, gain: number): void {
    if (!this.voices.can()) return;
    const ctx = this.ctx;
    t = Math.max(0, t);
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx, 'white');
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.001);
    g.gain.setTargetAtTime(0, t + 0.002, 0.018);
    src.connect(f).connect(g).connect(this.outs.dry);
    this.send(g, this.outs.hall, 0.8);
    src.start(t, 0.5);
    src.stop(t + 0.3);
    this.voices.track(src);
  }

  /** A soft synthetic drone under a bed (a low sine pair a fifth apart). */
  drone(t: number, freq: number, gain: number): { stop(t: number): void } {
    const ctx = this.ctx;
    t = Math.max(0, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 3);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400;
    g.connect(f).connect(this.outs.dry);
    const oscs = [freq, freq * 1.5].map((hz, i) => {
      const o = ctx.createOscillator();
      o.frequency.value = hz;
      o.detune.value = i ? 3 : -2;
      const og = ctx.createGain();
      og.gain.value = i ? 0.35 : 1;
      o.connect(og).connect(g);
      o.start(t);
      return o;
    });
    return {
      stop: (at) => {
        const end = Math.max(t, at);
        g.gain.setTargetAtTime(0, end, 0.1);
        oscs.forEach((o) => o.stop(end + 0.6));
      },
    };
  }

  /** Room tone: low brown noise. */
  room(t: number, gain: number, freq = 380): { stop(t: number): void } {
    const ctx = this.ctx;
    t = Math.max(0, t);
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx, 'brown');
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.8);
    src.connect(f).connect(g).connect(this.outs.dry);
    src.start(t);
    return { stop: (at) => src.stop(Math.max(t, at) + 0.05) };
  }
}
