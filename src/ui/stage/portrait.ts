import { faceUrl, type Expression, type Face } from './art.ts';

/**
 * A face made of expression variants stacked as images. Changing expression crossfades
 * between them; breathing, blinking and flinching are CSS transforms on top.
 */
export class Portrait {
  readonly el: HTMLElement;
  private readonly layers = new Map<Expression, HTMLImageElement>();
  private held: Expression = 'neutral';
  private shown: Expression = 'neutral';
  private talkTimer = 0;
  private blinkTimer = 0;
  private dead = false;

  constructor(
    readonly face: Face,
    opts: { blink?: boolean; seed?: number } = {},
  ) {
    this.el = document.createElement('div');
    this.el.className = 'pt';
    const seed = opts.seed ?? face.id.length * 7 + face.id.charCodeAt(0);
    this.el.style.setProperty('--pt-d', `${-((seed * 1.37) % 5).toFixed(2)}s`);
    const inner = document.createElement('div');
    inner.className = 'pt-in';
    for (const v of ['neutral', 'afraid', 'speak', 'closed'] as const) {
      const img = document.createElement('img');
      img.className = `pt-v${v === 'neutral' ? ' on' : ''}`;
      img.src = faceUrl(face.id, v);
      img.alt = '';
      img.decoding = 'async';
      img.draggable = false;
      inner.append(img);
      this.layers.set(v, img);
    }
    this.el.append(inner);
    if (opts.blink ?? true) this.scheduleBlink(seed);
  }

  private paint(v: Expression, ms: number): void {
    if (v === this.shown) return;
    this.el.style.setProperty('--pt-fade', `${ms}ms`);
    this.layers.get(this.shown)?.classList.remove('on');
    this.layers.get(v)?.classList.add('on');
    this.shown = v;
  }

  /** Hold an expression until the next call. */
  show(v: Expression, ms = 380): this {
    window.clearInterval(this.talkTimer);
    this.held = v;
    this.paint(v, ms);
    return this;
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

  private scheduleBlink(seed: number): void {
    const r = Math.sin(seed * 99.1 + performance.now()) * 0.5 + 0.5;
    this.blinkTimer = window.setTimeout(
      () => {
        if (this.dead) return;
        if (this.shown === 'neutral' && this.held === 'neutral') {
          this.paint('closed', 60);
          window.setTimeout(() => {
            if (this.shown === 'closed' && this.held !== 'closed') this.paint(this.held, 90);
          }, 140);
        }
        this.scheduleBlink(seed);
      },
      2600 + r * 4200,
    );
  }

  dispose(): void {
    this.dead = true;
    window.clearInterval(this.talkTimer);
    window.clearTimeout(this.blinkTimer);
  }
}

export interface CloseOptions {
  x?: Expression;
  /** Portrait size as a multiple of the frame's shorter side. */
  z?: number;
  /** Where the face centre lands in the frame (0..1). */
  ax?: number;
  ay?: number;
  mirror?: boolean;
  /** Slow push in while the shot is live. */
  push?: boolean;
  blink?: boolean;
  cls?: string;
}

export interface Close {
  el: HTMLElement;
  p: Portrait;
  /** Change how tight the shot is. */
  zoom(z: number): void;
}

/** A tight, off-centre close-up of one face, cropped by a frame with container units. */
export function closeup(face: Face, o: CloseOptions = {}): Close {
  const p = new Portrait(face, { blink: o.blink ?? true });
  if (o.x) p.show(o.x, 0);
  const frame = document.createElement('div');
  frame.className = `cu ${o.cls ?? ''}`;
  const st = frame.style;
  const ay = o.ay ?? 0.54;
  st.setProperty('--fx', String(o.mirror ? 1 - face.cx : face.cx));
  st.setProperty('--fy', String(face.cy));
  st.setProperty('--ax', String(o.ax ?? 0.5));
  st.setProperty('--ay', String(ay));
  // Smallest portrait size (in frame heights) that still covers the frame top to bottom.
  st.setProperty('--cov', (Math.max(ay / face.cy, (1 - ay) / (1 - face.cy)) + 0.02).toFixed(3));
  const zoom = (z: number) => st.setProperty('--z', String(z));
  zoom(o.z ?? 1.7);
  if (o.mirror) frame.classList.add('mirror');
  if (o.push) frame.classList.add('push');
  frame.append(p.el);
  return { el: frame, p, zoom };
}
