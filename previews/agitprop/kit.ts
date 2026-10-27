import type { SceneCtx } from '../shared/harness.ts';
import { ease, type Tweener } from '../shared/tween.ts';

export const SVGNS = 'http://www.w3.org/2000/svg';

export const CAST = [
  'ORSOLA',
  'KESTREL',
  'ANTON',
  'MIRA',
  'VALE',
  'ILSE',
  'BRAM',
  'JUNIPER',
  'TEODOR',
] as const;

export const nn = (n: number) => String(n).padStart(2, '0');

export function div(parent: Element | null, cls: string, html?: string): HTMLDivElement {
  const e = document.createElement('div');
  e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  parent?.append(e);
  return e;
}

export function svg<K extends keyof SVGElementTagNameMap>(
  parent: Element | null,
  tag: K,
  attrs: Record<string, string | number> = {},
  text?: string,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  parent?.append(e);
  return e;
}

let uidCounter = 0;
export const uid = (p: string) => `${p}-${++uidCounter}`;

/** Per-frame hooks for the active scene; removed automatically when the scene is left. */
export const frameHooks = new Set<(now: number) => void>();
export function onFrame(ctx: SceneCtx, fn: (now: number) => void): void {
  frameHooks.add(fn);
  ctx.signal.addEventListener('abort', () => frameHooks.delete(fn));
}

/**
 * Milliseconds-from-now for beat `n` of the running bed, so entrances land on the grid.
 * Beat 0 is the first beat at or after this call.
 */
export function grid(ctx: SceneCtx, bpm: number, bed: string): (beats: number) => number {
  const beat = 60000 / bpm;
  const clock = ctx.audio.bedClock();
  let offset = 0;
  if (clock && clock.name === bed) {
    const t = clock.t * 1000;
    offset = t < 0 ? -t : (beat - (t % beat)) % beat;
  }
  return (n) => offset + n * beat;
}

export function setNight(on: boolean): void {
  document.body.classList.toggle('ag-night', on);
}

export function shake(tw: Tweener, amount: number, ms = 650): void {
  tw.set('shake', amount);
  tw.to('shake', 0, ms, ease.out);
}

// Motion vocabulary: things are placed with force. Slam (drop onto the paper), thrust
// (driven along a diagonal), snap (rotate into place), pop (stamp out of nothing).
const EASE_IN = 'cubic-bezier(.55,0,1,.45)';
const BACK = 'cubic-bezier(.34,1.56,.64,1)';
const SNAP = 'cubic-bezier(.16,1,.3,1)';

export function slam(
  el: Element,
  base = '',
  o: { from?: number; rot?: number; dur?: number } = {},
) {
  return el.animate(
    [
      {
        transform: `${base} scale(${o.from ?? 2.2}) rotate(${o.rot ?? -5}deg)`,
        opacity: 0,
        easing: EASE_IN,
      },
      { transform: `${base} scale(0.95) rotate(0deg)`, opacity: 1, offset: 0.6, easing: SNAP },
      { transform: `${base} scale(1) rotate(0deg)`, opacity: 1 },
    ],
    { duration: o.dur ?? 300, fill: 'both' },
  );
}

export function thrust(el: Element, base: string, dx: string, dy: string, dur = 420) {
  return el.animate(
    [
      { transform: `translate(${dx}, ${dy}) ${base}`, opacity: 1 },
      { transform: `translate(0px, 0px) ${base}`, opacity: 1 },
    ],
    { duration: dur, easing: BACK, fill: 'both' },
  );
}

export function pop(el: Element, base = '', dur = 280) {
  return el.animate(
    [
      { transform: `${base} scale(0)`, opacity: 1 },
      { transform: `${base} scale(1)`, opacity: 1 },
    ],
    { duration: dur, easing: 'cubic-bezier(.2,1.9,.45,1)', fill: 'both' },
  );
}

export function snap(el: Element, base: string, fromRot: number, dur = 380) {
  return el.animate(
    [
      { transform: `${base} rotate(${fromRot}deg) scale(.6)`, opacity: 0 },
      { transform: `${base} rotate(0deg) scale(1)`, opacity: 1 },
    ],
    { duration: dur, easing: BACK, fill: 'both' },
  );
}

/** Wipe in along the x axis from the left, like a strip fed through the press. */
export function feed(el: Element, base = '', dur = 360) {
  return el.animate(
    [
      { transform: `${base} scaleX(0)`, opacity: 1 },
      { transform: `${base} scaleX(1)`, opacity: 1 },
    ],
    { duration: dur, easing: SNAP, fill: 'both' },
  );
}

export function flicker(el: Element, dur = 260) {
  return el.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }], {
    duration: dur,
    easing: 'steps(4, end)',
    fill: 'both',
  });
}

export function hide(el: Element, dur = 160) {
  return el.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: dur,
    easing: 'steps(2, end)',
    fill: 'both',
  });
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Type `text` into `el`; untyped characters stay laid out but invisible so nothing reflows. */
export function typeText(ctx: SceneCtx, el: HTMLElement, text: string, cps = 60): void {
  const t0 = performance.now();
  const render = (i: number) => {
    el.innerHTML =
      i >= text.length
        ? esc(text)
        : `${esc(text.slice(0, i))}<i class="ag-caret"></i><span class="ag-ghost">${esc(text.slice(i))}</span>`;
  };
  render(0);
  const id = window.setInterval(() => {
    const i = Math.floor(((performance.now() - t0) / 1000) * cps);
    render(i);
    if (i >= text.length) window.clearInterval(id);
  }, 30);
  ctx.signal.addEventListener('abort', () => {
    window.clearInterval(id);
    render(text.length);
  });
}

export interface Tape {
  el: HTMLDivElement;
  run(ctx: SceneCtx, cps?: number): void;
}

/** A telegram strip: speaker in red, message in cream condensed caps, ending in STOP. */
export function tape(parent: Element, who: string, msg: string, cls = '', rot = 0): Tape {
  const el = div(parent, `ag-tape ag-wait ${cls}`);
  el.style.setProperty('--rot', `${rot}deg`);
  const full = `${msg.toUpperCase()} STOP.`;
  el.innerHTML = `<b>${who}:</b> <span class="ag-msg"><span class="ag-ghost">${esc(full)}</span></span>`;
  const body = el.querySelector<HTMLElement>('.ag-msg');
  return {
    el,
    run(ctx, cps = 70) {
      const a = (rot * Math.PI) / 180;
      thrust(el, `rotate(${rot}deg)`, `${14 * Math.cos(a)}vw`, `${14 * Math.sin(a)}vw`, 380);
      if (body) typeText(ctx, body, full, cps);
    },
  };
}

export function masthead(parent: Element, centre: string, right: string): HTMLDivElement {
  return div(
    parent,
    'ag-mast ag-wait',
    `<span class="ag-mast-l">THE VESPER<br>BROADSIDE</span><span class="ag-mast-c">${centre}</span><span class="ag-mast-r">${right}</span>`,
  );
}

export function edge(parent: Element, text: string, side: 'l' | 'r' = 'l'): HTMLDivElement {
  return div(parent, `ag-edge ag-edge-${side}`, text);
}

function canvasTile(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): string {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d');
  if (c) draw(c);
  return cv.toDataURL('image/png');
}

/** Sparse paper/ink specks that sit over the DOM type so it reads as printed. */
export function grainTile(paper: string, ink: string): string {
  return canvasTile(256, 256, (c) => {
    let s = 7;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 900; i++) {
      c.fillStyle = i % 3 === 0 ? ink : paper;
      c.globalAlpha = 0.25 + r() * 0.5;
      const sz = r() < 0.9 ? 1 : 2;
      c.fillRect(Math.floor(r() * 256), Math.floor(r() * 256), sz, sz);
    }
  });
}

/** Alpha mask with voids and worn edges for rubber-stamp ink. */
export function inkMask(): string {
  return canvasTile(512, 256, (c) => {
    let s = 11;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    c.fillStyle = '#000';
    c.fillRect(0, 0, 512, 256);
    c.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 1400; i++) {
      c.globalAlpha = 0.2 + r() * 0.8;
      c.beginPath();
      c.arc(r() * 512, r() * 256, r() < 0.92 ? r() * 1.6 : 2 + r() * 4, 0, Math.PI * 2);
      c.fill();
    }
    for (let i = 0; i < 26; i++) {
      c.globalAlpha = 0.25 + r() * 0.35;
      c.fillRect(r() * 512, r() * 256, 20 + r() * 120, 1 + r() * 2);
    }
  });
}
