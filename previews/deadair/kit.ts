import { rng } from '../shared/audio-kit.ts';
import { el } from '../shared/harness.ts';

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

export const chn = (i: number) => String(i + 1).padStart(2, '0');

export const INK = { night: '#f2f2ec', day: '#0b0b0b' } as const;
export const PAPER = { night: '#0b0b0b', day: '#f2f2ec' } as const;
export const SIG = '#ff4d00';

const GLYPHS = '▓▒░█<>/\\|_=+#01';
const glyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? '#';

/**
 * Types `text` into `node` with a scrambled leading edge that resolves left to right.
 * `full` scrambles the whole string from the start (decode) instead of typing it in.
 */
export function decode(
  node: HTMLElement,
  text: string,
  ms: number,
  signal: AbortSignal,
  full = false,
): void {
  const start = performance.now();
  const chars = [...text];
  let id = 0;
  const tick = () => {
    const p = Math.min(1, (performance.now() - start) / ms);
    const n = Math.floor(p * chars.length);
    let s = '';
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i] ?? '';
      if (i < n || c === ' ') s += c;
      else if (full || i < n + 4) s += glyph();
      else break;
    }
    node.textContent = s;
    if (p >= 1) clearInterval(id);
  };
  id = window.setInterval(tick, 42);
  signal.addEventListener('abort', () => clearInterval(id));
  tick();
}

/** A word built from per-letter spans so each glyph can jump on the width axis. */
export function wideWord(text: string, cls = ''): HTMLElement {
  const w = el('div', `da-wide da-fit ${cls}`);
  w.dataset.t = text;
  for (const ch of text) {
    const s = el('span', 'da-ch');
    s.textContent = ch === ' ' ? '\u00a0' : ch;
    w.append(s);
  }
  return w;
}

/** Randomise the width and weight axes of some letters for a few 12 fps frames. */
export function jolt(word: HTMLElement, frames = 3, amount = 0.5): void {
  const spans = [...word.querySelectorAll<HTMLElement>('.da-ch')];
  for (let f = 0; f < frames; f++) {
    window.setTimeout(() => {
      for (const s of spans) {
        s.style.fontVariationSettings =
          Math.random() < amount
            ? `'wdth' ${Math.round(62 + Math.random() * 63)}, 'wght' ${Math.round(100 + Math.random() * 800)}`
            : '';
      }
    }, f * 83);
  }
  window.setTimeout(() => spans.forEach((s) => (s.style.fontVariationSettings = '')), frames * 83);
}

/** Step the whole word through width values at 12 fps. */
export function stepWidth(word: HTMLElement, widths: readonly number[], weight = 900): void {
  widths.forEach((w, i) =>
    window.setTimeout(() => {
      word.style.fontVariationSettings = `'wdth' ${w}, 'wght' ${weight}`;
    }, i * 83),
  );
}

const fitted = new Set<HTMLElement>();

/** Size a single-line element so it spans its parent's content box (times `ratio`). */
export function fit(e: HTMLElement, ratio = 1): void {
  e.dataset.fit = String(ratio);
  fitted.add(e);
  refit(e);
}

function refit(e: HTMLElement): void {
  const box = e.parentElement;
  if (!box) return;
  const cs = getComputedStyle(box);
  const inner = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const saved = e.style.fontVariationSettings;
  e.style.fontVariationSettings = '';
  // A running width-axis animation would be measured mid-frame; measure the rest state.
  e.style.animationPlayState = 'paused';
  e.style.animationName = 'none';
  e.style.fontSize = '100px';
  const w = e.scrollWidth;
  e.style.animationName = '';
  e.style.animationPlayState = '';
  e.style.fontVariationSettings = saved;
  if (w > 0) e.style.fontSize = `${(100 * inner * Number(e.dataset.fit ?? 1)) / w}px`;
}

export function refitAll(): void {
  for (const e of fitted) {
    if (!e.isConnected) fitted.delete(e);
    else refit(e);
  }
}
window.addEventListener('resize', refitAll);
document.fonts.addEventListener('loadingdone', refitAll);

export function colorBars(): string {
  const top = ['#f2f2ec', '#d6d6cf', '#ff4d00', '#a2a29b', '#5a5a56', '#b83700', '#242422'];
  const mid = ['#242422', '#0b0b0b', '#b83700', '#0b0b0b', '#a2a29b', '#0b0b0b', '#f2f2ec'];
  const low: [string, number][] = [
    ['#0b0b0b', 120],
    ['#f2f2ec', 120],
    ['#0b0b0b', 30],
    ['#ff4d00', 90],
    ['#0b0b0b', 110],
    ['#121211', 40],
    ['#1c1c1a', 40],
    ['#0b0b0b', 150],
  ];
  let s =
    '<svg class="da-bars" viewBox="0 0 700 400" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">';
  top.forEach(
    (c, i) => (s += `<rect x="${i * 100}" y="0" width="100.5" height="272" fill="${c}"/>`),
  );
  mid.forEach(
    (c, i) => (s += `<rect x="${i * 100}" y="272" width="100.5" height="34" fill="${c}"/>`),
  );
  let x = 0;
  for (const [c, w] of low) {
    s += `<rect x="${x}" y="306" width="${w + 0.5}" height="94" fill="${c}"/>`;
    x += w;
  }
  return s + '</svg>';
}

export function barcode(seed: number, bars = 64, h = 40): string {
  const r = rng(seed);
  let x = 0;
  let rects = '';
  for (let i = 0; i < bars; i++) {
    const w = 1 + Math.floor(r() * 3.2);
    if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="${h}"/>`;
    x += w;
  }
  return `<svg class="da-barcode" viewBox="0 0 ${x} ${h}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" fill="currentColor">${rects}</svg>`;
}

/** Sigil for THE SEVER: a ring of broadcast circles cut along a diagonal, the lower half slipped. */
export function severSigil(): string {
  const rings = [44, 76, 108, 140]
    .map(
      (r) =>
        `<circle cx="200" cy="200" r="${r}" fill="none" stroke="currentColor" stroke-width="15"/>`,
    )
    .join('');
  const core = '<rect x="184" y="184" width="32" height="32" fill="currentColor"/>';
  const ticks = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    const r0 = i % 6 === 0 ? 166 : 172;
    return `<line x1="${200 + Math.cos(a) * r0}" y1="${200 + Math.sin(a) * r0}" x2="${200 + Math.cos(a) * 184}" y2="${200 + Math.sin(a) * 184}"/>`;
  }).join('');
  return `<svg class="da-sigil" viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="da-sv-a"><polygon points="0,0 400,0 400,140 0,252"/></clipPath>
    <clipPath id="da-sv-b"><polygon points="0,272 400,160 400,400 0,400"/></clipPath>
  </defs>
  <g stroke="currentColor" stroke-width="3" opacity=".55">${ticks}</g>
  <g clip-path="url(#da-sv-a)">${rings}${core}</g>
  <g clip-path="url(#da-sv-b)" transform="translate(22 -6)">${rings}${core}</g>
  <line x1="-10" y1="265" x2="410" y2="148" stroke="currentColor" stroke-width="2" stroke-dasharray="6 6"/>
</svg>`;
}

export type ScopeMode = 'trace' | 'static' | 'bars' | 'off';

export interface Scope {
  mode: ScopeMode;
  hot: boolean;
  speak(ms: number): void;
}

interface ScopeEntry extends Scope {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  a: number;
  b: number;
  big: boolean;
  speakUntil: number;
  checked: number;
}

const RATIOS: [number, number][] = [
  [1, 2],
  [3, 2],
  [3, 4],
  [2, 3],
  [1, 1],
  [5, 4],
  [3, 1],
  [4, 3],
  [5, 6],
];

/** Per-player oscilloscope / static canvases, redrawn together at a deliberately choppy 20 fps. */
export class Scopes {
  private list: ScopeEntry[] = [];
  private last = 0;
  private statics: Record<'night' | 'day', HTMLCanvasElement[]> = { night: [], day: [] };

  add(canvas: HTMLCanvasElement, player: number, big = false): Scope {
    const g = canvas.getContext('2d');
    if (!g) return { mode: 'trace', hot: false, speak() {} };
    const [a, b] = RATIOS[player % RATIOS.length] ?? [1, 2];
    const entry: ScopeEntry = {
      canvas,
      g,
      mode: 'trace',
      hot: false,
      a,
      b,
      big,
      speakUntil: 0,
      checked: 0,
      speak(ms) {
        entry.speakUntil = performance.now() + ms;
      },
    };
    this.list.push(entry);
    return entry;
  }

  private staticFrames(day: boolean): HTMLCanvasElement[] {
    const key = day ? 'day' : 'night';
    const cached = this.statics[key];
    if (cached.length) return cached;
    for (let f = 0; f < 6; f++) {
      const c = document.createElement('canvas');
      c.width = 120;
      c.height = 68;
      const g = c.getContext('2d');
      if (!g) continue;
      const img = g.createImageData(c.width, c.height);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() ** 1.5 * 150;
        const px = day ? 242 - v : 11 + v;
        img.data[i] = px;
        img.data[i + 1] = px;
        img.data[i + 2] = day ? px - 4 : px;
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      cached.push(c);
    }
    return cached;
  }

  draw(now: number, level: number, day: boolean): void {
    if (now - this.last < 50) return;
    this.last = now;
    this.list = this.list.filter((s) => s.canvas.isConnected);
    const t = now / 1000;
    const ink = day ? INK.day : INK.night;
    const rule = day ? 'rgba(11,11,11,.16)' : 'rgba(242,242,236,.14)';
    const frames = this.staticFrames(day);
    for (const s of this.list) {
      const { canvas: cv, g } = s;
      if (now - s.checked > 500) {
        s.checked = now;
        const scale = Math.min(window.devicePixelRatio || 1, 1.5) * (s.big ? 0.8 : 1);
        const w = Math.max(2, Math.round(cv.clientWidth * scale));
        const h = Math.max(2, Math.round(cv.clientHeight * scale));
        if (cv.width !== w || cv.height !== h) {
          cv.width = w;
          cv.height = h;
        }
      }
      const w = cv.width;
      const h = cv.height;
      g.clearRect(0, 0, w, h);
      if (s.mode === 'static' || s.mode === 'off') {
        const fr = frames[Math.floor(Math.random() * frames.length)];
        g.imageSmoothingEnabled = false;
        g.globalAlpha = s.mode === 'off' ? 0.22 : 0.9;
        if (fr) g.drawImage(fr, 0, 0, w, h);
        g.globalAlpha = 1;
        continue;
      }
      if (s.mode === 'bars') {
        const cols = ['#f2f2ec', '#d6d6cf', '#ff4d00', '#a2a29b', '#5a5a56', '#b83700', '#242422'];
        const roll = (Math.floor(t * 12) % 9) * 0.004 * h;
        cols.forEach((c, i) => {
          g.fillStyle = c;
          g.fillRect(Math.floor((i * w) / 7), roll, Math.ceil(w / 7) + 1, h * 0.72);
        });
        g.fillStyle = '#0b0b0b';
        g.fillRect(0, h * 0.72 + roll, w, h);
        continue;
      }
      g.strokeStyle = rule;
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 1; i < 4; i++) {
        g.moveTo(Math.round((w * i) / 4) + 0.5, 0);
        g.lineTo(Math.round((w * i) / 4) + 0.5, h);
        g.moveTo(0, Math.round((h * i) / 4) + 0.5);
        g.lineTo(w, Math.round((h * i) / 4) + 0.5);
      }
      g.stroke();
      const sp = Math.max(0, Math.min(1, (s.speakUntil - now) / 400));
      const amp = 0.2 + sp * 0.6 + Math.min(0.4, level * 1.6);
      g.strokeStyle = s.hot || sp > 0 ? SIG : ink;
      g.lineWidth = (s.big ? 3 : 1.6) * (sp > 0 ? 1.4 : 1);
      g.beginPath();
      const n = s.big ? 520 : 160;
      for (let k = 0; k <= n; k++) {
        const th = (k / n) * Math.PI * 2;
        const jit = sp > 0 ? Math.sin(th * 41 + t * 50) * 0.16 * sp : 0;
        const x = w / 2 + Math.sin(s.a * th + t * 0.8) * (amp + jit) * w * 0.42;
        const y = h / 2 + Math.sin(s.b * th) * (amp + jit * 0.5) * h * 0.4;
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
  }
}
