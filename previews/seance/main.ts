import '@fontsource/homemade-apple/400.css';
import '@fontsource/im-fell-dw-pica/400.css';
import '@fontsource/im-fell-dw-pica/400-italic.css';
import '@fontsource/im-fell-english-sc/400.css';
import { createPreview, el, type SceneCtx, type SceneDef } from '../shared/harness.ts';
import { Portrait, VARIANTS, type Variant } from '../shared/portrait.ts';
import '../shared/portrait.css';
import { byName, loadImages } from '../shared/samples.ts';
import { ease } from '../shared/tween.ts';
import { seanceScore } from './score.ts';
import './style.css';

const IMG = byName(
  import.meta.glob('./img/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<
    string,
    string
  >,
);

const CAST = ['Orsola', 'Kestrel', 'Anton', 'Mira', 'Vale', 'Ilse', 'Bram', 'Juniper', 'Teodor'];
const ORSOLA = 0;
const KESTREL = 1;
const ANTON = 2;
const MIRA = 3;
const VALE = 4;
const ILSE = 5;
const BRAM = 6;
const JUNIPER = 7;
const TEODOR = 8;

const hash = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const pv = createPreview({
  slug: 'seance',
  name: 'Séance',
  score: seanceScore,
  exitMs: 1100,
  gate(g) {
    g.innerHTML = `
      <div class="gate-in">
        <div class="gate-kicker">Vesper &middot; a preview in seven sittings</div>
        <h1 class="gate-title">S&eacute;ance</h1>
        <p class="gate-sub">Nine at the table. One candle. Join hands.</p>
        <button data-begin class="gate-btn">Light the candle</button>
        <div class="gate-load">
          <div class="wick"><i></i></div>
          <div class="gate-load-text">the spirits are gathering &middot; <span data-progress>0%</span></div>
        </div>
        <p class="gate-hint">Sound on &middot; headphones recommended</p>
      </div>`;
  },
  preload: async (onProgress) => {
    ensureRoom();
    await loadImages(Object.values(IMG), onProgress);
  },
});

const T = pv.tween;
const LOOK = {
  light: 0,
  glow: 0,
  flicker: 0.6,
  dawn: 0,
  mist: 0.6,
  hands: 0,
  ring: 1,
  ghost: 0,
};
type Key = keyof typeof LOOK;
for (const [k, v] of Object.entries(LOOK)) T.set(k, v);
const look = (vals: Partial<Record<Key, number>>, ms = 1500, e = ease.inOut) => {
  for (const [k, v] of Object.entries(vals)) T.to(k, v, ms, e);
};

// --- the room: table, candle, light, mist, the nine plates and the ring of hands --------

class Seat {
  readonly el: HTMLElement;
  readonly tt: HTMLElement;
  readonly face: Portrait;
  readonly angle: number;
  dead = false;

  constructor(readonly i: number) {
    const id = (CAST[i] ?? '').toLowerCase();
    const urls: Partial<Record<Variant, string>> = {};
    for (const v of VARIANTS) {
      const u = IMG[`${id}-${v}`];
      if (u) urls[v] = u;
    }
    this.face = new Portrait(urls, { className: 'tt-face', blink: true, seed: i * 3 + 1 });
    this.angle = ((-90 + i * 40) * Math.PI) / 180;
    this.el = el('div', 'seat');
    this.el.style.setProperty('--c', Math.cos(this.angle).toFixed(4));
    this.el.style.setProperty('--s', Math.sin(this.angle).toFixed(4));
    this.el.style.setProperty('--rot', `${((hash(i + 3) - 0.5) * 8).toFixed(2)}deg`);
    this.el.style.setProperty('--d', `${(-hash(i) * 6).toFixed(2)}s`);
    this.el.innerHTML = `<div class="tt"><div class="win"><i class="fog"></i><i class="beads"><b></b><b></b><b></b></i></div><div class="plate">${CAST[i]}</div></div>`;
    this.tt = this.el.querySelector('.tt')!;
    this.el.querySelector('.win')!.prepend(this.face.el);
  }

  reset(dead: boolean): void {
    this.dead = dead;
    this.el.className = dead ? 'seat dead' : 'seat';
    this.el.style.removeProperty('left');
    this.el.style.removeProperty('top');
    this.el.style.removeProperty('--tt');
    this.face.show(dead ? 'closed' : 'neutral', 300);
  }

  place(x: string, y: string, size?: string): void {
    this.el.style.left = x;
    this.el.style.top = y;
    if (size) this.el.style.setProperty('--tt', size);
  }

  /** Centre of the plate in viewport pixels. */
  pos(): [number, number] {
    const r = this.tt.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }

  set(cls: string, on = true): void {
    this.el.classList.toggle(cls, on);
  }

  jolt(): void {
    this.face.flinch();
  }
}

let room: HTMLElement | null = null;
const seats: Seat[] = [];
let mistCanvas: HTMLCanvasElement | null = null;

function ensureRoom(): HTMLElement {
  if (room) return room;
  room = el('div', 'room');
  room.innerHTML = `
    <div class="table"><img src="${IMG.table ?? ''}" alt="" draggable="false"></div>
    <div class="pool"></div>
    <canvas class="mist"></canvas>
    <div class="candle">
      <img class="c-out" src="${IMG['candle-out'] ?? ''}" alt="" draggable="false">
      <img class="c-lit" src="${IMG['candle-lit'] ?? ''}" alt="" draggable="false">
      <i class="flame"></i>
    </div>
    <div class="dark"></div>
    <div class="wash"></div>
    <div class="ghost"></div>`;
  const dark = room.querySelector('.dark')!;
  for (let i = 0; i < CAST.length; i++) {
    const s = new Seat(i);
    seats.push(s);
    room.insertBefore(s.el, dark);
  }
  const ring = el('div', 'hands');
  for (let i = 0; i < CAST.length; i++) {
    const a = -70 + i * 40;
    const h = el('div', 'hand');
    const rad = (a * Math.PI) / 180;
    h.style.setProperty('--c', Math.cos(rad).toFixed(4));
    h.style.setProperty('--s', Math.sin(rad).toFixed(4));
    h.style.setProperty('--a', `${a - 90}deg`);
    h.style.setProperty('--flip', i % 2 ? '-1' : '1');
    h.style.setProperty('--d', `${(-hash(i + 20) * 7).toFixed(2)}s`);
    h.innerHTML = `<img src="${IMG.hand ?? ''}" alt="" draggable="false">`;
    ring.append(h);
  }
  room.append(ring);
  mistCanvas = room.querySelector<HTMLCanvasElement>('.mist');
  pv.stage.insertBefore(room, pv.stage.querySelector('.pv-scenes'));
  return room;
}

interface RoomState {
  dead?: number[];
  /** Instant setup: skip the transitions while seats return home. */
  instant?: boolean;
}

/** Bring the persistent room to a known state when a scene enters. */
function setRoom(ctx: SceneCtx, o: RoomState = {}): void {
  const r = ensureRoom();
  r.classList.toggle('instant', !!o.instant);
  if (o.instant) ctx.at(60, () => r.classList.remove('instant'));
  r.classList.remove('out', 'candle-out', 'blown', 'role', 'trial', 'withdraw');
  seats.forEach((s, i) => s.reset(o.dead?.includes(i) ?? false));
  r.querySelectorAll('.hand').forEach((h) => h.classList.remove('point', 'gone'));
}

const seat = (i: number): Seat => {
  const s = seats[i];
  if (!s) throw new Error(`no seat ${i}`);
  return s;
};

/** Every living face (but `except`) turns to look at seat `target` or a screen point. */
function glance(target: number | [number, number], except: number[] = []): void {
  const [tx] = typeof target === 'number' ? seat(target).pos() : target;
  seats.forEach((s, i) => {
    if (i === target || s.dead || except.includes(i)) return;
    const [x] = s.pos();
    const dx = tx - x;
    s.face.show(
      Math.abs(dx) < innerWidth * 0.035 ? 'neutral' : dx < 0 ? 'glanceL' : 'glanceR',
      260,
    );
  });
}

function centrePoint(): [number, number] {
  const c = room?.querySelector('.candle')?.getBoundingClientRect();
  return c ? [c.left + c.width / 2, c.top + c.height / 2] : [innerWidth / 2, innerHeight * 0.47];
}

function speaking(i: number | null): void {
  seats.forEach((s, k) => s.set('speaking', k === i));
}

// --- light and mist, every frame ---------------------------------------------------------

interface Puff {
  a: number;
  r: number;
  w: number;
  size: number;
  ph: number;
  grow: number;
  born: number;
  life: number;
}
const puffs: Puff[] = Array.from({ length: 30 }, (_, i) => ({
  a: hash(i) * Math.PI * 2,
  r: 0.25 + hash(i + 40) * 0.8,
  w: (0.02 + hash(i + 80) * 0.05) * (i % 3 ? 1 : -1),
  size: 0.18 + hash(i + 7) * 0.3,
  ph: hash(i + 9) * 6.28,
  grow: 0,
  born: 0,
  life: Infinity,
}));
let sprite: HTMLCanvasElement | null = null;
const makeSprite = () => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(236,226,206,0.9)');
  grd.addColorStop(0.45, 'rgba(220,210,196,0.35)');
  grd.addColorStop(1, 'rgba(200,196,190,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return c;
};

/** Smoke rising from the wick after the candle is blown out. */
function smokeBurst(): void {
  const now = performance.now();
  for (let i = 0; i < 14; i++) {
    puffs.push({
      a: hash(i + now) * Math.PI * 2,
      r: 0.01 + hash(i * 2) * 0.03,
      w: (hash(i + 3) - 0.5) * 0.3,
      size: 0.03 + hash(i + 5) * 0.04,
      ph: hash(i) * 6,
      grow: 0.025 + hash(i + 1) * 0.04,
      born: now + i * 90,
      life: 6000 + hash(i) * 3000,
    });
  }
}

const noise1 = (t: number) =>
  Math.sin(t * 7.1) * 0.5 + Math.sin(t * 13.7 + 1.3) * 0.3 + Math.sin(t * 29.3 + 4.1) * 0.2;

pv.onFrame((now) => {
  if (!room) return;
  const t = now / 1000;
  const f = noise1(t) * T.get('flicker');
  const light = T.get('light');
  const ring = T.get('ring');
  const st = pv.stage.style;
  st.setProperty('--ring', ring.toFixed(4));
  st.setProperty('--L', Math.max(0.05, light * (1 + f * 0.045)).toFixed(4));
  st.setProperty('--glow', (T.get('glow') * (0.85 + f * 0.15)).toFixed(3));
  st.setProperty('--fl', (1 + f * 0.12).toFixed(3));
  st.setProperty('--fx', (noise1(t * 0.7 + 9) * 4 * T.get('flicker')).toFixed(2));
  st.setProperty('--dawn', T.get('dawn').toFixed(3));
  st.setProperty('--hands', T.get('hands').toFixed(3));
  st.setProperty('--ghost', T.get('ghost').toFixed(3));

  const c = mistCanvas;
  if (!c) return;
  const w = Math.round(innerWidth * 0.5);
  const h = Math.round(innerHeight * 0.5);
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  sprite ??= makeSprite();
  const g = c.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, w, h);
  g.globalCompositeOperation = 'lighter';
  const [cxp, cyp] = centrePoint();
  const cx = cxp * 0.5;
  const cy = cyp * 0.5;
  const rx = Math.min(innerWidth * 0.37, innerHeight * 0.66) * 0.5 * ring;
  const ry = innerHeight * 0.34 * 0.5 * ring;
  const mist = T.get('mist');
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i];
    if (!p) continue;
    const age = now - p.born;
    if (age > p.life) {
      puffs.splice(i, 1);
      continue;
    }
    if (age < 0) continue;
    const finite = Number.isFinite(p.life);
    const a = p.a + t * p.w;
    const r = p.r + Math.sin(t * 0.3 + p.ph) * 0.06 + (finite ? (age / 1000) * p.grow : 0);
    const x = cx + Math.cos(a) * rx * r;
    const y = cy + Math.sin(a) * ry * r;
    const size = (p.size + (finite ? (age / 1000) * p.grow * 0.8 : 0)) * ry * 2.2;
    const alpha = finite
      ? 0.13 * Math.sin(Math.PI * Math.min(1, age / p.life)) ** 0.7
      : mist * (0.05 + 0.04 * Math.sin(t * 0.4 + p.ph));
    g.globalAlpha = Math.max(0, alpha);
    g.drawImage(sprite, x - size / 2, y - size / 2, size, size);
  }
  g.globalAlpha = 1;
});

// --- writing -------------------------------------------------------------------------------

interface Ink {
  node: HTMLElement;
  /** ms after the given delay when the last letter has landed. */
  end: number;
}

/** Spirit writing: letters bleed into being one at a time. */
function ink(text: string, delay = 0, per = 44, cls = ''): Ink {
  const node = el('div', `ink ${cls}`);
  let t = delay;
  let k = 0;
  node.innerHTML = text
    .split(' ')
    .map((word) => {
      const letters = [...word]
        .map((ch) => {
          const s = `<span class="il" style="animation-delay:${Math.round(t)}ms">${esc(ch)}</span>`;
          t += per * (0.65 + hash(k++) * 0.7);
          return s;
        })
        .join('');
      t += per * 1.6;
      return `<span class="iw">${letters}</span>`;
    })
    .join(' ');
  return { node, end: t - delay };
}

function zone(ctx: SceneCtx, cls: string): HTMLElement {
  const z = el('div', `zone ${cls}`);
  ctx.root.append(z);
  return z;
}

function caption(ctx: SceneCtx, small: string, big: string): void {
  const c = el('div', 'cap', `<span>${small}</span><b>${big}</b>`);
  ctx.root.append(c);
  ctx.at(150, () => c.classList.add('on'));
}

function line(who: string, text: string, delay = 0, per = 40, cls = ''): Ink {
  const w = ink(text, delay + 250, per, cls);
  const wrap = el('div', 'line');
  wrap.append(el('div', 'who', who), w.node);
  return { node: wrap, end: w.end + 250 };
}

/** A soft ring on the table where someone knocked. */
function ripple(ctx: SceneCtx, x: number, y: number, cls = ''): void {
  const r = el('i', `ripple ${cls}`);
  r.style.left = `${x}px`;
  r.style.top = `${y}px`;
  ctx.root.append(r);
  ctx.at(1800, () => r.remove());
}

// --- scenes ----------------------------------------------------------------------------------

const title: SceneDef = {
  id: 'title',
  label: 'The circle',
  duration: 13000,
  shots: [{ name: 'title', at: 6200 }],
  enter(ctx) {
    setRoom(ctx, { instant: true });
    T.set('light', 0.08);
    T.set('glow', 0);
    look({ ring: 1, dawn: 0, mist: 0.7, flicker: 0.9, hands: 0, ghost: 0 }, 600);
    ensureRoom().classList.add('candle-out', 'out');
    seats.forEach((s) => s.set('hidden'));
    ctx.audio.setBed('title', 2.5);
    ctx.at(500, () => {
      ensureRoom().classList.remove('candle-out');
      ctx.audio.sting('match');
      look({ light: 1, glow: 1 }, 2600, ease.out);
    });
    ctx.at(900, () => ensureRoom().classList.remove('out'));
    const order = [ORSOLA, KESTREL, ANTON, MIRA, VALE, ILSE, BRAM, JUNIPER, TEODOR];
    order.forEach((i, k) => {
      ctx.at(1300 + k * 330, () => {
        seat(i).set('hidden', false);
        if (k % 3 === 0) ctx.audio.sting('knock');
      });
    });
    ctx.at(4400, () => look({ hands: 1 }, 2200));
    const above = zone(ctx, 'z-above title-above');
    above.innerHTML = `<div class="kicker">a s&eacute;ance in seven sittings</div><p class="title-sub">Nine at the table. One of them is lying.</p>`;
    const below = zone(ctx, 'z-below title-below');
    const word = ink('Vesper', 3000, 150, 'title-word');
    below.append(word.node);
    ctx.at(2400, () => above.classList.add('on'));
    ctx.at(3800, () => above.classList.add('sub-on'));
    ctx.at(6800, () => glance(centrePoint()));
    ctx.at(8600, () => seats.forEach((s) => s.face.show('neutral', 500)));
  },
};

const role: SceneDef = {
  id: 'role',
  label: 'Your part',
  duration: 11000,
  shots: [{ name: 'role', at: 5600 }],
  enter(ctx) {
    setRoom(ctx);
    look(
      { light: 1.05, glow: 1, ring: 1.07, dawn: 0, mist: 0.8, flicker: 0.6, hands: 0.75, ghost: 0 },
      1200,
    );
    ensureRoom().classList.add('role');
    ctx.audio.setBed('title', 2);
    caption(ctx, 'the second sitting', 'The spirits deal you a part');
    const above = zone(ctx, 'z-above role-above');
    const you = ink('You are', 900, 70, 'role-you');
    above.append(el('div', 'kicker', 'the planchette spells'), you.node);
    const below = zone(ctx, 'z-below role-below');
    const name = ink('the Lamplighter', 1700, 85, 'role-name');
    below.append(name.node);
    below.insertAdjacentHTML(
      'beforeend',
      `<div class="role-tag">Town</div>
       <p class="ability">Each night, watch another player&rsquo;s door and learn who visited them.</p>`,
    );
    ctx.at(300, () => above.classList.add('on'));
    ctx.at(600, () => glance(centrePoint()));
    const planchette = el(
      'div',
      'planchette',
      `<svg viewBox="0 0 100 110" aria-hidden="true"><defs><radialGradient id="pw" cx="40%" cy="35%" r="75%"><stop offset="0" stop-color="#a0703e"/><stop offset=".6" stop-color="#5e3a1c"/><stop offset="1" stop-color="#2a170a"/></radialGradient><radialGradient id="pg" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fff6dc" stop-opacity=".55"/><stop offset="1" stop-color="#d9b46a" stop-opacity=".08"/></radialGradient></defs><path d="M50 106 C 34 90 4 64 4 38 C 4 16 22 4 38 4 C 45 4 50 9 50 9 C 50 9 55 4 62 4 C 78 4 96 16 96 38 C 96 64 66 90 50 106 Z" fill="url(#pw)" stroke="#c99a52" stroke-width="2"/><circle cx="50" cy="44" r="15" fill="url(#pg)" stroke="#e2c27c" stroke-width="2.4"/><circle cx="26" cy="28" r="3" fill="#c99a52"/><circle cx="74" cy="28" r="3" fill="#c99a52"/></svg>`,
    );
    ctx.root.append(planchette);
    ctx.at(1600, () => {
      planchette.classList.add('on');
      const letters = name.node.querySelectorAll<HTMLElement>('.il');
      letters.forEach((l) => {
        const d = parseFloat(l.style.animationDelay) - 1600;
        ctx.at(Math.max(0, d), () => {
          const r = l.getBoundingClientRect();
          planchette.style.left = `${r.left + r.width / 2}px`;
          planchette.style.top = `${r.top + r.height * 0.55}px`;
        });
      });
    });
    ctx.at(1700, () => ctx.audio.sting('reveal'));
    ctx.at(1700 + name.end + 300, () => {
      below.classList.add('on');
      planchette.classList.add('rest');
      seats.forEach((s) => s.face.show('neutral', 420));
    });
    ctx.at(7600, () => {
      seat(ILSE).face.show('glanceR', 300);
      seat(ANTON).face.show('glanceL', 300);
    });
  },
};

const nightfall: SceneDef = {
  id: 'nightfall',
  label: 'Nightfall',
  duration: 12500,
  shots: [{ name: 'nightfall', at: 8400 }],
  enter(ctx) {
    setRoom(ctx);
    look({ light: 1, glow: 1, ring: 1, dawn: 0, mist: 0.8, flicker: 0.6, hands: 1, ghost: 0 }, 500);
    ctx.audio.sting('gutter', 0.2);
    ctx.audio.setBed('night', 3, 0.8);
    caption(ctx, 'the third sitting', 'Nightfall');
    ctx.at(400, () => look({ light: 0.6, glow: 0.6, flicker: 1.8, mist: 1.1 }, 3000));
    ctx.at(1000, () => look({ hands: 0 }, 1800));
    ctx.at(1000, () => ensureRoom().classList.add('withdraw'));
    ctx.at(1700, () => {
      seats.forEach((s, i) => {
        if (i !== ILSE && i !== ANTON) s.set('asleep');
      });
      seat(VALE).face.show('closed', 900);
    });
    ctx.at(2500, () => {
      seat(ILSE).set('lit');
      seat(ANTON).set('lit');
      seat(ILSE).place('calc(var(--cx) - var(--tt) * 0.9)', 'calc(var(--cy) - 2vh)');
      seat(ANTON).place('calc(var(--cx) + var(--tt) * 0.9)', 'calc(var(--cy) - 2vh)');
    });
    ctx.at(3600, () => {
      seat(ILSE).face.show('glanceR', 400);
      seat(ANTON).face.show('glanceL', 400);
    });
    const left = zone(ctx, 'z-whisper wl');
    const right = zone(ctx, 'z-whisper wr');
    const a = line('Ilse', 'Vale. Tonight.', 0, 90, 'faint');
    const b = line('Anton', 'The healer goes first.', 0, 46, 'faint');
    ctx.at(4500, () => {
      left.append(a.node);
      ctx.audio.sting('whisper');
      seat(ILSE).face.show('glanceR', 300);
      seat(ANTON).face.show('glanceR', 300);
    });
    ctx.at(5500, () => {
      right.append(b.node);
      ctx.audio.sting('whisper', 0.1);
      seat(ILSE).face.show('glanceR', 300);
      seat(ANTON).face.show('glanceL', 300);
    });
    ctx.at(9800, () => look({ light: 0.42, glow: 0.4 }, 2500));
    return () => ensureRoom().classList.remove('withdraw');
  },
};

const dawn: SceneDef = {
  id: 'dawn',
  label: 'Dawn',
  duration: 11500,
  shots: [{ name: 'dawn', at: 6400 }],
  enter(ctx) {
    setRoom(ctx);
    T.set('light', 0.45);
    T.set('glow', 0.4);
    look({ ring: 1, mist: 1, flicker: 1, hands: 0, ghost: 0 }, 300);
    seats.forEach((s) => s.set('asleep'));
    seat(VALE).face.show('closed', 0);
    ctx.audio.setBed(null, 2);
    ctx.audio.sting('dawn', 0.3);
    caption(ctx, 'the fourth sitting', 'Dawn');
    ctx.at(400, () => look({ dawn: 1, light: 1.45, glow: 0.25, flicker: 0.25 }, 3200));
    ctx.at(1300, () => {
      seats.forEach((s, i) => i !== VALE && s.set('asleep', false));
    });
    ctx.at(1900, () => {
      seat(VALE).set('asleep', false);
      seat(VALE).reset(true);
      seat(VALE).set('dying');
    });
    ctx.at(2700, () => {
      glance(VALE);
      seat(MIRA).face.show('afraid', 500);
      seat(JUNIPER).face.show('afraid', 500);
      seat(MIRA).jolt();
    });
    const above = zone(ctx, 'z-above dawn-above');
    const below = zone(ctx, 'z-below dawn-below');
    const head = ink('Vale did not wake.', 3000, 55, 'notice');
    above.append(head.node);
    const was = ink('Vale was the Mender.', 3000 + head.end + 300, 50, 'notice-role');
    below.append(was.node);
    below.append(el('div', 'role-tag', 'Town &middot; the healer'));
    ctx.at(3000 + head.end + 300 + was.end, () => below.classList.add('on'));
    ctx.at(3000, () => ctx.audio.sting('knock'));
    ctx.at(4800, () => ctx.audio.setBed('day', 5));
  },
};

const CHAT: [number, string][] = [
  [MIRA, 'Vale healed me two nights ago. Now Vale is dead. Someone knew.'],
  [KESTREL, 'Anton was out past the second bell. I watched his door.'],
  [ANTON, 'I was walking. Since when is walking a crime?'],
  [ORSOLA, 'Since people started dying.'],
  [BRAM, 'I’m putting Anton up. Let him explain himself on the stand.'],
];
const CHAT_AT = [300, 2700, 5000, 7000, 8300];
const VOTERS = [BRAM, KESTREL, MIRA, ORSOLA, JUNIPER];

function accuse(ctx: SceneCtx): void {
  glance(ANTON);
  const a = seat(ANTON);
  a.face.show('afraid', 220);
  a.jolt();
  a.set('sweat');
  ctx.audio.sting('gasp');
}

const day: SceneDef = {
  id: 'day',
  label: 'The day',
  duration: 15000,
  shots: [{ name: 'day', at: 13400 }],
  enter(ctx) {
    setRoom(ctx, { dead: [VALE] });
    look(
      {
        light: 1.25,
        glow: 0.8,
        ring: 1,
        dawn: 0.25,
        mist: 0.6,
        flicker: 0.5,
        hands: 0.8,
        ghost: 0,
      },
      1200,
    );
    ctx.audio.setBed('day', 2);
    caption(ctx, 'the fifth sitting', 'The day');
    const above = zone(ctx, 'z-above day-above');
    const below = zone(ctx, 'z-below day-below');
    CHAT.forEach(([who, text], k) => {
      const at = CHAT_AT[k] ?? 0;
      ctx.at(at, () => {
        const prev = below.firstElementChild;
        if (prev) {
          above.replaceChildren(prev);
          prev.classList.add('risen');
        }
        const l = line(CAST[who] ?? '', text, 0, who === ANTON ? 34 : 30);
        below.append(l.node);
        speaking(who);
        glance(who);
        if (who === ANTON) seat(ANTON).face.talk(1900);
        ctx.audio.sting('voice', 0);
      });
    });
    // Kestrel names Anton; Bram names him again.
    ctx.at(3100, () => accuse(ctx));
    ctx.at(5000 + 1900, () => seat(ANTON).face.show('afraid', 300));
    ctx.at(8900, () => accuse(ctx));
    ctx.at(9700, () => {
      speaking(null);
      above.replaceChildren();
      const tally = el('div', 'tally');
      tally.innerHTML = `<div class="who">Hands raised against Anton</div><svg viewBox="0 0 120 50" aria-hidden="true">${[
        0, 1, 2, 3,
      ]
        .map(
          (i) =>
            `<path d="M${14 + i * 18} ${8 + hash(i) * 3} q ${(hash(i + 3) - 0.5) * 6} 18 ${(hash(i + 1) - 0.5) * 5} 34" pathLength="1"/>`,
        )
        .join('')}<path d="M4 34 Q 46 22 92 12" pathLength="1"/></svg><div class="tally-n"></div>`;
      above.append(tally);
      above.classList.add('voting');
    });
    VOTERS.forEach((v, k) => {
      ctx.at(9900 + k * 420, () => {
        const [x1, y1] = seat(v).pos();
        const [x2, y2] = seat(ANTON).pos();
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const hand = el('div', 'point', `<img src="${IMG.hand ?? ''}" alt="">`);
        // The fingertips should stop at the edge of Anton's plate, whatever the distance.
        const d = Math.hypot(x2 - x1, y2 - y1);
        const vh = innerHeight / 100;
        const len = Math.min(12 * vh, Math.max(4 * vh, d - 22 * vh));
        const wrist = Math.max(0, d - 13 * vh - len);
        hand.style.setProperty('--hs', (len / (12 * vh)).toFixed(3));
        hand.style.left = `${x1 + Math.cos(ang) * wrist}px`;
        hand.style.top = `${y1 + Math.sin(ang) * wrist}px`;
        hand.style.setProperty('--a', `${((ang * 180) / Math.PI + 90).toFixed(1)}deg`);
        ctx.root.append(hand);
        ctx.at(30, () => hand.classList.add('on'));
        ripple(ctx, x1, y1);
        seat(v).set('voted');
        seat(v).face.show(x2 < x1 ? 'glanceL' : 'glanceR', 200);
        seat(v).jolt();
        const a = seat(ANTON);
        a.jolt();
        a.face.show('afraid', 150);
        ctx.root.querySelectorAll('.tally path')[k]?.classList.add('on');
        const n = ctx.root.querySelector('.tally-n');
        if (n) n.textContent = ['one', 'two', 'three', 'four', 'five — to the stand'][k] ?? '';
        ctx.audio.sting('vote');
      });
    });
    ctx.at(9900 + VOTERS.length * 420 + 200, () => {
      seat(ANTON).set('accused');
      seats.forEach((s, i) => {
        if (i === ILSE || i === TEODOR) s.face.show(i === ILSE ? 'glanceL' : 'afraid', 400);
      });
    });
  },
};

function antonOnStand(): void {
  const a = seat(ANTON);
  a.set('stand');
  a.set('lit');
  a.set('sweat');
  a.place('var(--ax)', 'var(--ay)', 'var(--att)');
}

const BALLOTS: [number, boolean][] = [
  [BRAM, true],
  [ILSE, false],
  [MIRA, true],
  [KESTREL, true],
  [TEODOR, false],
  [ORSOLA, true],
  [JUNIPER, true],
];

const trial: SceneDef = {
  id: 'trial',
  label: 'The trial',
  duration: 17000,
  shots: [
    { name: 'trial', at: 4600 },
    { name: 'verdict', at: 11200 },
  ],
  enter(ctx) {
    setRoom(ctx, { dead: [VALE] });
    look(
      { light: 1.15, glow: 0.9, ring: 1.05, dawn: 0, mist: 0.7, flicker: 0.7, hands: 0, ghost: 0 },
      1200,
    );
    ensureRoom().classList.add('trial');
    ctx.audio.setBed('trial', 1.5);
    ctx.audio.sting('knock', 0.1);
    caption(ctx, 'the sixth sitting', 'The trial of Anton');
    seats.forEach((s, i) => i !== ANTON && s.set('recede'));
    ctx.at(80, () => antonOnStand());
    ctx.at(300, () => glance(ANTON));
    ctx.at(700, () => seat(ANTON).face.show('afraid', 400));
    const z = zone(ctx, 'z-side');
    const defence = line(
      'Anton, in his defence',
      'I’m a watcher. I saw Kestrel leave her house last night. Ask her where she went.',
      0,
      24,
    );
    ctx.at(800, () => {
      z.append(defence.node);
      seat(ANTON).face.talk(2400);
    });
    ctx.at(2100, () => {
      glance(KESTREL);
      seat(ANTON).face.show('glanceR', 200);
      seat(KESTREL).face.show('afraid', 300);
      seat(KESTREL).jolt();
    });
    ctx.at(3500, () => seat(ANTON).face.show('afraid', 300));
    ctx.at(5400, () => {
      defence.node.classList.add('faded');
      glance(ANTON);
    });
    const ballots = el('div', 'ballots');
    ballots.innerHTML = `<div class="col guilty"><div class="who">Knock &middot; guilty</div><ul></ul></div><div class="col innocent"><div class="who">Chime &middot; innocent</div><ul></ul></div>`;
    ctx.at(6000, () => defence.node.remove());
    ctx.at(5700, () => {
      z.append(ballots);
      ctx.at(30, () => ballots.classList.add('on'));
    });
    BALLOTS.forEach(([who, guilty], k) => {
      ctx.at(6100 + k * 520, () => {
        const ul = ballots.querySelector(guilty ? '.guilty ul' : '.innocent ul');
        const li = el('li', '', `<i></i>${CAST[who]}`);
        ul?.append(li);
        const s = seat(who);
        s.jolt();
        s.set(guilty ? 'knock' : 'chime');
        const [x, y] = s.pos();
        ripple(ctx, x, y, guilty ? '' : 'glass');
        const [ax] = seat(ANTON).pos();
        s.face.show(guilty ? (ax < x ? 'glanceL' : 'glanceR') : 'afraid', 200);
        if (guilty) {
          seat(ANTON).jolt();
          seat(ANTON).face.show('afraid', 120);
        } else {
          seat(ANTON).face.show(ax < x ? 'glanceR' : 'glanceL', 200);
        }
        ctx.audio.sting(guilty ? 'knock' : 'chime');
      });
    });
    const verdict = el('div', 'verdict');
    const word = ink('Guilty', 0, 70, 'verdict-word');
    verdict.append(word.node, el('div', 'verdict-sub', 'five to two'));
    ctx.at(10000, () => {
      z.prepend(verdict);
      ctx.audio.setBed(null, 0.4);
      ctx.audio.sting('verdict');
      look({ light: 0.9, glow: 1.2, flicker: 1.4 }, 600);
      seat(ANTON).face.show('afraid', 150);
      seat(ANTON).jolt();
      glance(ANTON);
      ctx.at(word.end + 200, () => verdict.classList.add('on'));
    });
    ctx.at(13200, () => ctx.audio.setBed('night', 4));
    return () => ensureRoom().classList.remove('trial');
  },
};

const execution: SceneDef = {
  id: 'execution',
  label: 'The candle',
  duration: 14000,
  shots: [{ name: 'execution', at: 9000 }],
  enter(ctx) {
    setRoom(ctx, { dead: [VALE] });
    look(
      { light: 1, glow: 1, ring: 1.05, dawn: 0, mist: 0.7, flicker: 0.8, hands: 0, ghost: 0 },
      900,
    );
    const r = ensureRoom();
    r.classList.add('trial');
    ctx.audio.setBed(null, 1.5);
    caption(ctx, 'the seventh sitting', 'His last words');
    seats.forEach((s, i) => i !== ANTON && s.set('recede'));
    ctx.at(60, () => antonOnStand());
    ctx.at(300, () => glance(ANTON));
    const z = zone(ctx, 'z-side');
    const last = line('Anton, at the last', 'You’ll miss me when the lamps go out.', 0, 46);
    ctx.at(700, () => {
      z.append(last.node);
      const a = seat(ANTON);
      a.face.show('speak', 200);
      a.face.talk(last.end);
    });
    const blow = 700 + last.end + 400;
    ctx.at(blow - 600, () => seat(ANTON).face.show('closed', 400));
    ctx.at(blow - 450, () => ctx.audio.sting('blowout'));
    ctx.at(blow, () => r.classList.add('blown'));
    ctx.at(blow + 650, () => {
      r.classList.add('candle-out');
      smokeBurst();
      look({ light: 0.16, glow: 0, flicker: 0, mist: 1.2 }, 900, ease.out);
      ctx.at(1400, () => look({ light: 0.75, ghost: 1 }, 2600));
      seats.forEach((s, i) => i !== ANTON && s.face.show(i === VALE ? 'closed' : 'afraid', 500));
    });
    ctx.at(blow + 900, () => {
      ctx.audio.sting('death');
      seat(ANTON).set('burn');
      last.node.classList.add('gone');
    });
    const role = ink('the Hatchet', 0, 80, 'reveal-role');
    ctx.at(blow + 2600, () => {
      const above = zone(ctx, 'z-above reveal-above');
      above.append(el('div', 'reveal-was', 'Anton was'), role.node);
      above.append(el('div', 'role-tag', 'the Syndicate'));
      const below = zone(ctx, 'z-below reveal-below');
      below.innerHTML = `<div class="will"><div class="who">His last will</div><p>&ldquo;Light the lamps for me. I never could.&rdquo;</p></div>`;
      ctx.audio.sting('reveal');
      ctx.at(30, () => above.classList.add('on'));
      ctx.at(role.end + 500, () => below.classList.add('on'));
    });
    ctx.at(blow + 3600, () => ctx.audio.setBed('night', 4));
  },
};

pv.start([title, role, nightfall, dawn, day, trial, execution]);
