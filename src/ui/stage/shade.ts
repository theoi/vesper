import { POSE, poseFor, poseUrl, type Act, type Figure, type Pose } from './art.ts';

/** Standing height of a shadow in `--u` units. */
const TALL = 46;
/**
 * Where the lamp projects onto the cloth, in container units. A body walking toward the lamp
 * casts a shadow scaled about this point, so it grows upward and outward.
 */
const LAMP = { x: 50, y: 66 };

export interface ShadeOptions {
  x: number;
  fig: Figure;
  /** Height multiplier (people are not all the same size). */
  h?: number;
  z?: number;
  dim?: number;
  /** Seconds offset for the idle sway, so a crowd does not breathe in unison. */
  sway?: number;
}

/** One shadow-play body behind the scrim: stacked pose silhouettes that crossfade. */
export class Shade {
  readonly el: HTMLElement;
  private readonly inner: HTMLElement;
  private readonly layers = new Map<Pose, HTMLImageElement>();
  x: number;
  z = 0;
  dim: number;
  current: Pose;
  facing: 1 | -1 = 1;
  readonly fig: Figure;
  readonly h: number;

  constructor(
    parent: HTMLElement,
    o: ShadeOptions,
    private readonly still: () => boolean,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'sh';
    this.inner = document.createElement('div');
    this.inner.className = 'sh-in';
    this.x = o.x;
    this.z = o.z ?? 0;
    this.dim = o.dim ?? 1;
    this.h = o.h ?? 1;
    this.fig = o.fig;
    this.current = poseFor('idle', o.fig);
    this.el.style.setProperty('--h', String(this.h));
    this.el.style.setProperty('--sd', `${-(o.sway ?? o.x / 7) % 6}s`);
    this.layer(this.current).classList.add('on');
    this.el.append(this.inner);
    parent.append(this.el);
    this.place(0);
  }

  private layer(p: Pose): HTMLImageElement {
    let img = this.layers.get(p);
    if (img) return img;
    const info = POSE[p];
    img = document.createElement('img');
    img.className = 'sh-p';
    img.src = poseUrl(p);
    img.alt = '';
    img.draggable = false;
    img.style.setProperty('--w', (TALL / info.k).toFixed(3));
    img.style.setProperty('--ar', info.ar.toFixed(4));
    img.style.setProperty('--ax', String(info.ax));
    img.style.setProperty('--by', String(info.by));
    if (info.f < 0) img.classList.add('turn');
    this.inner.append(img);
    this.layers.set(p, img);
    return img;
  }

  private scale(): number {
    return 1 + this.z * 1.35;
  }

  /** Apply the current x/z/dim, transitioning over `ms`. */
  place(ms: number, easing = 'cubic-bezier(.45,0,.3,1)'): this {
    if (this.still()) ms = Math.min(ms, 0);
    const s = this.scale();
    const px = LAMP.x + (this.x - LAMP.x) * s;
    const py = LAMP.y + (100 - LAMP.y) * s;
    const st = this.el.style;
    st.transition =
      ms > 0
        ? `transform ${ms}ms ${easing}, filter ${ms}ms ${easing}, opacity ${ms}ms ${easing}`
        : '';
    st.transform = `translate(${px.toFixed(3)}cqw, ${py.toFixed(3)}cqh) scale(${s.toFixed(4)})`;
    st.filter = `blur(${(this.z * 1.25).toFixed(3)}vh)`;
    st.opacity = ((1 - this.z * 0.42) * this.dim).toFixed(3);
    return this;
  }

  go(to: { x?: number; z?: number; dim?: number }, ms: number, easing?: string): this {
    if (to.x !== undefined) this.x = to.x;
    if (to.z !== undefined) this.z = to.z;
    if (to.dim !== undefined) this.dim = to.dim;
    return this.place(ms, easing);
  }

  /** Walk to `x` (with a gait) over a time that suits the distance; returns the ms taken. */
  walkTo(x: number, opts: { speed?: number; z?: number; dim?: number; act?: Act } = {}): number {
    const d = Math.abs(x - this.x);
    if (d < 0.5 && opts.z === undefined) {
      if (opts.dim !== undefined) this.go({ dim: opts.dim }, 300);
      return 0;
    }
    const ms = this.still() ? 0 : Math.max(500, (d / (opts.speed ?? 14)) * 1000);
    if (d >= 0.5) this.face(x > this.x ? 1 : -1);
    this.act(opts.act ?? 'walk', 160);
    this.walk(true);
    this.go({ x, z: opts.z, dim: opts.dim }, ms, 'cubic-bezier(.4,0,.6,1)');
    return ms;
  }

  pose(p: Pose, ms = 240): this {
    if (p === this.current) return this;
    this.el.style.setProperty('--pf', `${this.still() ? 0 : ms}ms`);
    const next = this.layer(p);
    this.layers.get(this.current)?.classList.remove('on');
    next.classList.add('on');
    this.current = p;
    return this;
  }

  act(a: Act, ms?: number): this {
    return this.pose(poseFor(a, this.fig), ms);
  }

  face(dir: 1 | -1): this {
    this.facing = dir;
    this.el.classList.toggle('flip', dir < 0);
    return this;
  }

  walk(on: boolean): this {
    this.el.classList.toggle('walk', on && !this.still());
    return this;
  }

  /** Lean and bob for a moment, as when speaking. */
  speak(ms = 1600): this {
    if (this.still()) return this;
    this.el.classList.remove('talk');
    void this.el.offsetWidth;
    this.el.classList.add('talk');
    this.el.style.setProperty('--talk', `${ms}ms`);
    return this;
  }

  flag(cls: string, on: boolean): this {
    this.el.classList.toggle(cls, on);
    return this;
  }

  /** Stage position (0..1 of the container) of a point given in image fractions of the pose. */
  point(box: DOMRect, ix: number, iy: number): [number, number] {
    const W = box.width;
    const H = box.height;
    const u = Math.min(H / 100, (0.9 * W) / 100);
    const info = POSE[this.current];
    const w = (TALL / info.k) * this.h * u;
    const s = this.scale();
    const flip = this.facing < 0 ? -1 : 1;
    const turn = info.f < 0 ? -1 : 1;
    const fx = ((LAMP.x + (this.x - LAMP.x) * s) / 100) * W;
    const fy = ((LAMP.y + (100 - LAMP.y) * s) / 100) * H;
    const x = fx + (ix - info.ax) * w * s * flip * turn;
    const y = fy - (info.by - iy) * w * info.ar * s;
    return [x / W, y / H];
  }
}
