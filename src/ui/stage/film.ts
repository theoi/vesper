import type { Face } from './art.ts';
import { closeup, type Close, type CloseOptions } from './portrait.ts';

export type Tone = 'town' | 'mafia' | 'neutral' | 'paper' | 'blood';

export interface CardText {
  kicker?: string;
  title?: string;
  /** Large italic line (a role name, a verdict). */
  role?: string;
  body?: string;
  tone?: Tone;
}

function div(cls: string, text?: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
}

/**
 * The film layer over the stage: hard cuts to black-and-white close-ups and silent-film
 * intertitles. Only one shot shows at a time; each new shot is a hard cut.
 */
export class Film {
  readonly el: HTMLElement;
  private readonly shotHost: HTMLElement;
  private readonly grainCanvas: HTMLCanvasElement;
  private readonly grain: { draw(amount: number): void; clear(): void };
  private live: { el: HTMLElement; closes: Close[] } | null = null;
  private hideTimer = 0;

  constructor() {
    this.el = div('vs-film');
    this.el.setAttribute('aria-live', 'polite');
    this.shotHost = div('vs-shots');
    this.grainCanvas = document.createElement('canvas');
    this.grainCanvas.className = 'vs-grain';
    this.el.append(this.shotHost, this.grainCanvas);
    this.grain = filmGrain(this.grainCanvas);
  }

  get on(): boolean {
    return this.live !== null;
  }

  private cut(el: HTMLElement, closes: Close[] = []): HTMLElement {
    window.clearTimeout(this.hideTimer);
    this.drop();
    el.classList.add('vs-shot');
    this.shotHost.append(el);
    this.el.classList.add('on');
    this.live = { el, closes };
    return el;
  }

  private drop(): void {
    if (!this.live) return;
    for (const c of this.live.closes) c.p.dispose();
    this.live.el.remove();
    this.live = null;
  }

  /** An intertitle: ink card, double rule, Old Standard type. */
  card(t: CardText, cls = ''): HTMLElement {
    const frame = div('vs-frame');
    if (t.kicker) frame.append(div('vs-k', t.kicker));
    if (t.title) frame.append(div('vs-title', t.title));
    if (t.role) frame.append(div(`vs-role tone-${t.tone ?? 'paper'}`, t.role));
    if (t.body) frame.append(div('vs-body', t.body));
    const shot = div(`vs-card ${cls}`);
    shot.append(frame);
    return this.cut(shot);
  }

  /** A full-frame close-up. */
  close(face: Face, o: CloseOptions = {}, caption?: string): Close {
    const c = closeup(face, { push: true, ...o });
    const shot = div('vs-close');
    const pic = div('vs-pic');
    pic.append(c.el);
    shot.append(pic);
    if (caption) shot.append(div('vs-caption', caption));
    this.cut(shot, [c]);
    return c;
  }

  /** Several faces side by side (a jury, a company). */
  poly(faces: readonly Face[], o: CloseOptions = {}, caption?: string): Close[] {
    const shot = div(`vs-poly n${Math.min(faces.length, 6)}`);
    const closes = faces.slice(0, 6).map((f, i) => {
      const c = closeup(f, { z: 1.5, blink: false, ...o, mirror: i % 2 === 1 });
      const pic = div('vs-pic');
      pic.style.setProperty('--i', String(i));
      pic.append(c.el);
      shot.append(pic);
      return c;
    });
    if (caption) shot.append(div('vs-caption', caption));
    this.cut(shot, closes);
    return closes;
  }

  /** Fade the film out (0 = at once). */
  clear(ms = 260): void {
    if (!this.live) return;
    this.el.classList.remove('on');
    window.clearTimeout(this.hideTimer);
    if (ms <= 0) {
      this.drop();
      this.grain.clear();
      return;
    }
    this.hideTimer = window.setTimeout(() => {
      this.drop();
      this.grain.clear();
    }, ms);
  }

  draw(): void {
    if (this.live) this.grain.draw(1);
  }

  dispose(): void {
    window.clearTimeout(this.hideTimer);
    this.drop();
  }
}

/** Silent-film grain, dust, hairs, scratches and exposure flicker on a 2D canvas. */
function filmGrain(canvas: HTMLCanvasElement): { draw(amount: number): void; clear(): void } {
  const c = canvas.getContext('2d');
  if (!c) return { draw() {}, clear() {} };
  const T = 180;
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const tiles = Array.from({ length: 4 }, () => {
    const t = document.createElement('canvas');
    t.width = t.height = T;
    const tc = t.getContext('2d');
    if (!tc) return t;
    const img = tc.createImageData(T, T);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = rand();
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
    clear() {
      c.clearRect(0, 0, canvas.width, canvas.height);
    },
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
      if (Math.random() < 0.5) {
        const n = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
          c.fillStyle = Math.random() < 0.7 ? 'rgba(8,6,4,0.75)' : 'rgba(240,236,226,0.6)';
          c.beginPath();
          c.arc(Math.random() * w, Math.random() * h, 0.4 + Math.random() * 1.6, 0, Math.PI * 2);
          c.fill();
        }
      }
      if (scratchLife <= 0 && Math.random() < 0.025) {
        scratchX = Math.random() * w;
        scratchLife = 6 + Math.random() * 22;
      }
      if (scratchLife > 0) {
        scratchLife--;
        scratchX += (Math.random() - 0.5) * 1.4;
        c.fillStyle = 'rgba(236,232,222,0.3)';
        c.fillRect(scratchX, 0, 1, h);
      }
    },
  };
}
