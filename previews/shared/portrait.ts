import { el } from './harness.ts';

export const VARIANTS = ['neutral', 'glanceL', 'glanceR', 'afraid', 'speak', 'closed'] as const;
export type Variant = (typeof VARIANTS)[number];

export interface PortraitOptions {
  className?: string;
  /** Blink (a short crossfade to `closed`) every few seconds while holding `neutral`. */
  blink?: boolean;
  /** Seed for the breathing phase and blink timing. */
  seed?: number;
}

/**
 * A face made of expression variants stacked as images. Changing expression crossfades
 * between them; breathing, blinking and flinching are CSS transforms on top. Missing
 * variants fall back to `neutral`.
 */
export class Portrait {
  readonly el: HTMLElement;
  private readonly layers = new Map<string, HTMLImageElement>();
  private held: Variant = 'neutral';
  private shown: Variant = 'neutral';
  private talkTimer = 0;
  private blinkTimer = 0;
  private dead = false;

  constructor(
    urls: Partial<Record<Variant, string>>,
    readonly o: PortraitOptions = {},
  ) {
    this.el = el('div', `pt ${o.className ?? ''}`);
    const seed = o.seed ?? 0;
    this.el.style.setProperty('--pt-d', `${-((seed * 1.37) % 5).toFixed(2)}s`);
    const inner = el('div', 'pt-in');
    for (const v of VARIANTS) {
      const url = urls[v];
      if (!url) continue;
      const img = el('img', `pt-v pt-${v}`);
      img.src = url;
      img.alt = '';
      img.decoding = 'async';
      img.draggable = false;
      if (v === 'neutral') img.classList.add('on');
      inner.append(img);
      this.layers.set(v, img);
    }
    this.el.append(inner);
    if (o.blink && this.layers.has('closed')) this.scheduleBlink();
  }

  private paint(v: Variant, ms: number): void {
    const target = this.layers.has(v) ? v : 'neutral';
    if (target === this.shown) return;
    this.el.style.setProperty('--pt-fade', `${ms}ms`);
    this.layers.get(this.shown)?.classList.remove('on');
    this.layers.get(target)?.classList.add('on');
    this.shown = target;
  }

  /** Hold an expression until the next call. */
  show(v: Variant, ms = 380): this {
    window.clearInterval(this.talkTimer);
    this.held = v;
    this.paint(v, ms);
    return this;
  }

  get expression(): Variant {
    return this.held;
  }

  /** Alternate `speak` with the held expression for `ms`, like a mouth moving. */
  talk(ms: number): this {
    window.clearInterval(this.talkTimer);
    const base = this.held === 'speak' ? 'neutral' : this.held;
    const end = performance.now() + ms;
    let open = false;
    const step = () => {
      if (performance.now() > end || this.dead) {
        window.clearInterval(this.talkTimer);
        this.paint(base, 160);
        return;
      }
      open = !open || Math.random() < 0.25;
      this.paint(open ? 'speak' : base, 90 + Math.random() * 70);
    };
    step();
    this.talkTimer = window.setInterval(step, 170 + Math.random() * 60);
    return this;
  }

  /** A startled jolt. */
  flinch(): this {
    this.el.classList.remove('pt-flinch');
    void this.el.offsetWidth;
    this.el.classList.add('pt-flinch');
    return this;
  }

  blinkNow(): void {
    if (this.shown !== 'neutral' || !this.layers.has('closed')) return;
    this.paint('closed', 60);
    window.setTimeout(() => {
      if (this.shown === 'closed' && this.held !== 'closed') this.paint(this.held, 90);
    }, 140);
  }

  private scheduleBlink(): void {
    const rnd = Math.sin((this.o.seed ?? 1) * 99.1 + performance.now()) * 0.5 + 0.5;
    this.blinkTimer = window.setTimeout(
      () => {
        if (this.dead) return;
        this.blinkNow();
        this.scheduleBlink();
      },
      2600 + rnd * 4200,
    );
  }

  /** Stop timers (call when the scene leaves). */
  dispose(): void {
    this.dead = true;
    window.clearInterval(this.talkTimer);
    window.clearTimeout(this.blinkTimer);
  }
}
