import { rng } from '../shared/audio-kit.ts';
import { el } from '../shared/harness.ts';
import { Portrait, type Variant } from '../shared/portrait.ts';
import { byName } from '../shared/samples.ts';

export const IMG = byName(
  import.meta.glob('./img/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<
    string,
    string
  >,
);

export type Pose =
  | 'stand'
  | 'standw'
  | 'point'
  | 'recoil'
  | 'whisper'
  | 'kneel'
  | 'fall'
  | 'vote'
  | 'grieve'
  | 'dance'
  | 'lantern'
  | 'lie';

/**
 * Per-pose metrics measured from the alpha of each silhouette. The source images draw people
 * at different scales, so `k` (standing height divided by image width) keeps every pose at the
 * same human size; `ax`/`by` are the feet anchor; `ar` is height/width.
 */
interface PoseInfo {
  k: number;
  ar: number;
  ax: number;
  by: number;
}
const POSE: Record<Pose, PoseInfo> = {
  stand: { k: 1.375, ar: 1.5, ax: 0.48, by: 0.948 },
  standw: { k: 1.4, ar: 1.5, ax: 0.48, by: 0.967 },
  point: { k: 1.125, ar: 768 / 720, ax: 0.35, by: 0.947 },
  recoil: { k: 1.25, ar: 1.2, ax: 0.53, by: 0.941 },
  whisper: { k: 1.13, ar: 1.2, ax: 0.5, by: 0.955 },
  kneel: { k: 1.33, ar: 768 / 720, ax: 0.5, by: 0.917 },
  fall: { k: 1.47, ar: 1.5, ax: 0.5, by: 0.93 },
  vote: { k: 1.18, ar: 1.5, ax: 0.42, by: 0.969 },
  grieve: { k: 1.25, ar: 1.2, ax: 0.5, by: 0.978 },
  dance: { k: 1.25, ar: 863 / 720, ax: 0.53, by: 0.94 },
  lantern: { k: 0.97, ar: 758 / 720, ax: 0.5, by: 0.951 },
  lie: { k: 0.89, ar: 480 / 720, ax: 0.5, by: 0.825 },
};

/** Standing height of a shadow in `--u` units. */
const TALL = 46;
/** Fraction of the stage height taken by the apron in front of the cloth. */
export const APRON = 0.12;
/**
 * Where the lamp projects onto the cloth, in container units. A body walking toward the lamp
 * casts a shadow scaled about this point, so it grows upward and outward.
 */
const LAMP = { x: 50, y: 66 };

export interface ShadeOptions {
  x: number;
  h?: number;
  flip?: boolean;
  z?: number;
  dim?: number;
  pose?: Pose;
  /** Seconds offset for the idle sway, so a crowd does not breathe in unison. */
  sway?: number;
  /** Poses drawn mirrored relative to the body's facing (silhouettes face different ways). */
  turn?: readonly Pose[];
}

/** One shadow-play body behind the scrim: stacked pose silhouettes that crossfade. */
export class Shade {
  readonly el: HTMLElement;
  private readonly inner: HTMLElement;
  private readonly layers = new Map<Pose, HTMLImageElement>();
  x: number;
  z: number;
  dim: number;
  current: Pose;
  readonly h: number;

  constructor(parent: HTMLElement, poses: readonly Pose[], o: ShadeOptions) {
    this.el = el('div', 'sh');
    this.inner = el('div', 'sh-in');
    this.x = o.x;
    this.z = o.z ?? 0;
    this.dim = o.dim ?? 1;
    this.h = o.h ?? 1;
    this.current = o.pose ?? poses[0] ?? 'stand';
    this.el.style.setProperty('--h', String(this.h));
    this.el.style.setProperty('--sd', `${-(o.sway ?? o.x / 7) % 6}s`);
    for (const p of poses) {
      const info = POSE[p];
      const img = el('img', `sh-p sh-${p}`);
      img.src = IMG[`pose-${p}`] ?? '';
      img.alt = '';
      img.draggable = false;
      img.style.setProperty('--w', (TALL / info.k).toFixed(3));
      img.style.setProperty('--ar', info.ar.toFixed(4));
      img.style.setProperty('--ax', String(info.ax));
      img.style.setProperty('--by', String(info.by));
      if (p === this.current) img.classList.add('on');
      if (o.turn?.includes(p)) img.classList.add('turn');
      this.inner.append(img);
      this.layers.set(p, img);
    }
    if (o.flip) this.el.classList.add('flip');
    this.el.append(this.inner);
    parent.append(this.el);
    this.place(0);
  }

  private scale(): number {
    return 1 + this.z * 1.35;
  }

  /** Apply the current x/z/dim, transitioning over `ms`. */
  place(ms: number, easing = 'cubic-bezier(.45,0,.3,1)'): this {
    const s = this.scale();
    const px = LAMP.x + (this.x - LAMP.x) * s;
    const py = LAMP.y + (100 - LAMP.y) * s;
    const st = this.el.style;
    st.transition =
      ms > 0
        ? `transform ${ms}ms ${easing}, filter ${ms}ms ${easing}, opacity ${ms}ms ${easing}`
        : '';
    st.transform = `translate(${px.toFixed(3)}cqw, ${py.toFixed(3)}cqh) scale(${s.toFixed(4)})`;
    st.filter = `blur(${(this.z * 1.25).toFixed(3)}vh) drop-shadow(1.8vw 0.3vh 0.5vh rgba(0,0,0,${(0.2 * (1 - this.z)).toFixed(3)}))`;
    st.opacity = ((1 - this.z * 0.42) * this.dim).toFixed(3);
    return this;
  }

  go(to: { x?: number; z?: number; dim?: number }, ms: number, easing?: string): this {
    if (to.x !== undefined) this.x = to.x;
    if (to.z !== undefined) this.z = to.z;
    if (to.dim !== undefined) this.dim = to.dim;
    return this.place(ms, easing);
  }

  pose(p: Pose, ms = 240): this {
    if (p === this.current) return this;
    this.el.style.setProperty('--pf', `${ms}ms`);
    this.layers.get(this.current)?.classList.remove('on');
    this.layers.get(p)?.classList.add('on');
    this.current = p;
    return this;
  }

  flip(on: boolean): this {
    this.el.classList.toggle('flip', on);
    return this;
  }

  walk(on: boolean): this {
    this.el.classList.toggle('walk', on);
    return this;
  }

  /**
   * Stage position (0..1, origin top-left) of a point given in image fractions of the current
   * pose, for lights that follow a prop.
   */
  stagePoint(ix: number, iy: number): [number, number] {
    const W = innerWidth;
    const H = innerHeight * (1 - APRON);
    const u = Math.min(H / 100, (0.9 * W) / 100);
    const info = POSE[this.current];
    const w = (TALL / info.k) * this.h * u;
    const s = this.scale();
    const flip = this.el.classList.contains('flip') ? -1 : 1;
    const fx = ((LAMP.x + (this.x - LAMP.x) * s) / 100) * W;
    const fy = ((LAMP.y + (100 - LAMP.y) * s) / 100) * H;
    const x = fx + (ix - info.ax) * w * s * flip;
    const y = fy - (info.by - iy) * w * info.ar * s;
    return [x / W, y / innerHeight];
  }
}

/** Face centre (between the eyes and the mouth) of each portrait, in image fractions. */
const FACE: Record<string, [number, number]> = {
  anton: [0.49, 0.565],
  ilse: [0.5, 0.525],
  vale: [0.51, 0.555],
  kestrel: [0.51, 0.58],
  mira: [0.49, 0.575],
  orsola: [0.49, 0.555],
  bram: [0.47, 0.475],
  juniper: [0.5, 0.58],
  teodor: [0.5, 0.545],
};

export interface CloseOptions {
  v?: Variant;
  /** Portrait size as a multiple of the frame's shorter side. */
  z?: number;
  /** Where the face centre lands in the frame (0..1). */
  ax?: number;
  ay?: number;
  /** Shift the focal point down (+) or up (-) in image fractions. */
  dy?: number;
  mirror?: boolean;
  blink?: boolean;
  push?: boolean;
  cls?: string;
}

export interface Close {
  el: HTMLElement;
  p: Portrait;
}

/** A tight, off-centre close-up of one villager, cropped by a frame with container units. */
export function closeup(id: string, o: CloseOptions = {}): Close {
  const urls: Partial<Record<Variant, string>> = {};
  for (const v of ['neutral', 'afraid', 'speak', 'closed'] as const) {
    const url = IMG[`${id}-${v}`];
    if (url) urls[v] = url;
  }
  const p = new Portrait(urls, { blink: o.blink ?? true, seed: id.length * 7 + id.charCodeAt(0) });
  if (o.v) p.show(o.v, 0);
  const frame = el('div', `cu ${o.cls ?? ''}`);
  const [fx, fy] = FACE[id] ?? [0.5, 0.55];
  const st = frame.style;
  st.setProperty('--z', String(o.z ?? 1.7));
  st.setProperty('--fx', String(o.mirror ? 1 - fx : fx));
  st.setProperty('--fy', String(fy + (o.dy ?? 0)));
  st.setProperty('--ax', String(o.ax ?? 0.5));
  const ay = o.ay ?? 0.54;
  const fyy = fy + (o.dy ?? 0);
  st.setProperty('--ay', String(ay));
  // Smallest portrait size (in frame heights) that still covers the frame top to bottom.
  st.setProperty('--cov', (Math.max(ay / fyy, (1 - ay) / (1 - fyy)) + 0.02).toFixed(3));
  if (o.mirror) frame.classList.add('mirror');
  if (o.push) frame.classList.add('push');
  frame.append(p.el);
  return { el: frame, p };
}

/** Silent-film grain, dust, hairs, scratches and exposure flicker on the fx canvas. */
export function filmGrain(canvas: HTMLCanvasElement): { draw(amount: number): void } {
  const c = canvas.getContext('2d');
  if (!c) return { draw() {} };
  const T = 180;
  const tiles = Array.from({ length: 4 }, (_, n) => {
    const t = document.createElement('canvas');
    t.width = t.height = T;
    const tc = t.getContext('2d');
    if (!tc) return t;
    const img = tc.createImageData(T, T);
    const r = rng(n * 31 + 7);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = r();
      const a = Math.abs(v - 0.5) * 2;
      const tone = v > 0.5 ? 236 : 12;
      img.data[i] = tone;
      img.data[i + 1] = tone;
      img.data[i + 2] = tone - 6;
      img.data[i + 3] = a * a * a * 170;
    }
    tc.putImageData(img, 0, 0);
    return t;
  });
  let frame = 0;
  let scratchX = 0;
  let scratchLife = 0;
  return {
    draw(amount) {
      frame++;
      if (frame % 2) return;
      const w = Math.ceil(canvas.clientWidth / 2);
      const h = Math.ceil(canvas.clientHeight / 2);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      c.clearRect(0, 0, w, h);
      const tile = tiles[(frame >> 1) % tiles.length];
      const pat = tile ? c.createPattern(tile, 'repeat') : null;
      if (pat) {
        c.save();
        c.globalAlpha = 0.12 + 0.3 * amount;
        c.translate(-Math.random() * T, -Math.random() * T);
        c.fillStyle = pat;
        c.fillRect(0, 0, w + T, h + T);
        c.restore();
      }
      c.fillStyle = `rgba(0,0,0,${(Math.random() * 0.07 * amount).toFixed(3)})`;
      c.fillRect(0, 0, w, h);
      if (amount > 0.5 && Math.random() < 0.55) {
        const n = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
          const x = Math.random() * w;
          const y = Math.random() * h;
          c.fillStyle = Math.random() < 0.7 ? 'rgba(8,6,4,0.75)' : 'rgba(240,236,226,0.6)';
          c.beginPath();
          c.arc(x, y, 0.4 + Math.random() * 1.6, 0, Math.PI * 2);
          c.fill();
        }
        if (Math.random() < 0.12) {
          const x = Math.random() * w;
          const y = Math.random() * h;
          c.strokeStyle = 'rgba(10,8,6,0.55)';
          c.lineWidth = 0.7;
          c.beginPath();
          c.moveTo(x, y);
          c.quadraticCurveTo(x + 14 * Math.random(), y + 10, x + 6 - 12 * Math.random(), y + 26);
          c.stroke();
        }
      }
      if (scratchLife <= 0 && amount > 0.5 && Math.random() < 0.025) {
        scratchX = Math.random() * w;
        scratchLife = 6 + Math.random() * 22;
      }
      if (scratchLife > 0 && amount > 0.5) {
        scratchLife--;
        scratchX += (Math.random() - 0.5) * 1.4;
        c.fillStyle = 'rgba(236,232,222,0.3)';
        c.fillRect(scratchX, 0, 1, h);
      }
    },
  };
}
