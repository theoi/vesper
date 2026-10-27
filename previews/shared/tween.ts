export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  in: (t: number) => t * t * t,
  out: (t: number) => 1 - (1 - t) ** 3,
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  sine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  expoOut: (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  expoIn: (t: number) => (t <= 0 ? 0 : 2 ** (10 * t - 10)),
  backOut: (t: number) => {
    const s = 1.70158;
    return 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;
  },
  steps:
    (n: number): Ease =>
    (t: number) =>
      Math.min(1, Math.floor(t * n) / n),
} satisfies Record<string, Ease | ((n: number) => Ease)>;

interface Tween {
  from: number;
  to: number;
  start: number;
  dur: number;
  ease: Ease;
}

/** Named scalar values animated on the shared frame clock (shader uniforms, layout params). */
export class Tweener {
  private values = new Map<string, number>();
  private tweens = new Map<string, Tween>();

  get(key: string, fallback = 0): number {
    return this.values.get(key) ?? fallback;
  }

  set(key: string, value: number): void {
    this.tweens.delete(key);
    this.values.set(key, value);
  }

  /** Animate `key` to `target`. A new tween on the same key replaces the old one from its current value. */
  to(key: string, target: number, ms: number, e: Ease = ease.inOut, delay = 0): void {
    const from = this.get(key, target);
    if (ms <= 0 && delay <= 0) return this.set(key, target);
    this.tweens.set(key, { from, to: target, start: performance.now() + delay, dur: ms, ease: e });
  }

  update(now: number): void {
    for (const [key, tw] of this.tweens) {
      if (now < tw.start) continue;
      const t = tw.dur <= 0 ? 1 : Math.min(1, (now - tw.start) / tw.dur);
      this.values.set(key, tw.from + (tw.to - tw.from) * tw.ease(t));
      if (t >= 1) this.tweens.delete(key);
    }
  }
}

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
