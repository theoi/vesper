import '@fontsource/im-fell-english';
import '@fontsource/im-fell-english/400-italic.css';
import '@fontsource/im-fell-english-sc';
import { createPreview, el, type SceneCtx, type SceneDef } from '../shared/harness.ts';
import { Portrait, VARIANTS, type Variant } from '../shared/portrait.ts';
import '../shared/portrait.css';
import { byName, loadImages } from '../shared/samples.ts';
import { ease } from '../shared/tween.ts';
import { supperScore } from './score.ts';
import './style.css';

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
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

const IMG = byName(
  import.meta.glob('./img/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<
    string,
    string
  >,
);

const faces = (i: number): Partial<Record<Variant, string>> => {
  const id = (CAST[i] ?? '').toLowerCase();
  const out: Partial<Record<Variant, string>> = {};
  for (const v of VARIANTS) {
    const url = IMG[`${id}-${v}`];
    if (url) out[v] = url;
  }
  return out;
};

const pv = createPreview({
  slug: 'supper',
  name: 'Supper',
  score: supperScore,
  exitMs: 1400,
  gate(g) {
    g.innerHTML = `
      <div class="gate-in">
        <div class="g-candle"><i class="halo"></i><i class="flame"></i><i class="stick"></i></div>
        <div class="kicker">Vesper &middot; a preview in seven courses</div>
        <h1>Supper</h1>
        <p class="gate-sub">nine at one table, by candlelight &mdash; and one of them is lying</p>
        <button data-begin class="gate-btn">Light the candles</button>
        <div class="gate-load"><div class="bar"><i></i></div><span>setting the table &middot; <b data-progress>0%</b></span></div>
        <p class="gate-hint">sound on &middot; the portraits and recordings load after you begin</p>
      </div>`;
  },
  preload: (p) => loadImages(Object.values(IMG), p),
});

const T = pv.tween;

// --- camera: the whole table lives in one "world" measured in u (see --u in style.css) ---

const SPACING = 19;
const seatX = (i: number) => (i - 4) * SPACING;
const candleX = (j: number) => (j - 4.5) * SPACING;
T.set('camX', 0);
T.set('camY', 0);
T.set('camS', 0.56);
let world: HTMLElement | null = null;
const unit = () => Math.min(innerWidth / 100, (innerHeight * 1.78) / 100);
// Portrait screens get a closer camera so faces stay readable.
const zoom = () => (innerHeight > innerWidth ? 1.9 : 1);
pv.onFrame(() => {
  if (!world) return;
  const u = unit();
  const s = T.get('camS') * zoom();
  world.style.transform = `translate(${(-T.get('camX') * u * s).toFixed(1)}px, ${(-T.get('camY') * u * s).toFixed(1)}px) scale(${s.toFixed(4)})`;
});
const cam = (x: number, s: number, ms = 1600, y = 0, e = ease.inOut) => {
  T.to('camX', x, ms, e);
  T.to('camS', s, ms, e);
  T.to('camY', y, ms, e);
};
const camSet = (x: number, s: number, y = 0) => {
  T.set('camX', x);
  T.set('camS', s);
  T.set('camY', y);
};

// --- the table -------------------------------------------------------------------------

interface Seat {
  i: number;
  el: HTMLElement;
  p: Portrait;
}

interface Table {
  root: HTMLElement;
  seats: Seat[];
  candles: HTMLElement[];
  cards: HTMLElement[];
}

interface TableOptions {
  dead?: number[];
  /** Candles start unlit (and the faces dark). */
  unlit?: boolean;
}

const living = (t: Table, dead: number[] = []) => t.seats.filter((s) => !dead.includes(s.i));

function table(ctx: SceneCtx, o: TableOptions = {}): Table {
  const root = el('div', 'world');
  const seatsEl = el('div', 'seats');
  const seats: Seat[] = CAST.map((name, i) => {
    const dead = o.dead?.includes(i) ?? false;
    const p = new Portrait(faces(i), { blink: !dead, seed: i + 1 });
    const s = el('div', `seat${dead ? ' dead' : ''}${o.unlit ? ' dark' : ''}`);
    s.style.setProperty('--x', String(seatX(i)));
    s.style.setProperty('--y', String(i % 2 ? -3.2 : -4.4));
    s.style.setProperty('--fd', `${((i * 0.37) % 1.3).toFixed(2)}s`);
    s.append(p.el);
    if (dead) {
      p.show('closed', 0);
      s.append(el('i', 'crepe'));
    }
    s.dataset.name = name;
    seatsEl.append(s);
    ctx.signal.addEventListener('abort', () => p.dispose());
    return { i, el: s, p };
  });
  const cloth = el('div', 'cloth', '<i class="top"></i><i class="drop"></i>');
  const props = el('div', 'props');
  const candles = Array.from({ length: 10 }, (_, j) => {
    const c = el(
      'div',
      `candle${o.unlit ? ' out' : ''}`,
      '<i class="pool"></i><i class="stick"></i><i class="halo"></i><i class="flame"></i><i class="smoke"></i>',
    );
    c.style.setProperty('--x', String(candleX(j)));
    c.style.setProperty('--h', String(9 + ((j * 7) % 4)));
    c.style.setProperty('--fd', `${((j * 0.61) % 1.7).toFixed(2)}s`);
    props.append(c);
    return c;
  });
  const cards = CAST.map((name, i) => {
    const card = el('div', 'card', `<span>${name}</span>`);
    card.style.setProperty('--x', String(seatX(i)));
    card.style.setProperty('--r', `${((i * 37) % 7) - 3}deg`);
    props.append(card);
    return card;
  });
  // A few tactile things on the cloth: letters, a goblet, bread.
  const things: [string, number, number, number][] = [
    ['missive', -66, 13.5, -8],
    ['goblet', -47, 8, 0],
    ['bread', -27, 11.5, 0],
    ['missive', 8, 13.8, 6],
    ['goblet', 29, 8.4, 0],
    ['missive', 50, 13.2, -4],
    ['bread', 69, 11.8, 0],
  ];
  for (const [kind, x, y, r] of things) {
    const t = el('i', `thing ${kind}`);
    t.style.setProperty('--x', String(x));
    t.style.setProperty('--y', String(y));
    t.style.setProperty('--r', `${r}deg`);
    props.append(t);
  }
  root.append(seatsEl, cloth, props);
  ctx.root.append(root);
  world = root;
  return { root, seats, candles, cards };
}

/** Light or snuff candle j; a seat is lit while either neighbouring candle burns. */
function setCandle(t: Table, j: number, on: boolean): void {
  const c = t.candles[j];
  if (!c) return;
  c.classList.toggle('out', !on);
  if (!on) {
    c.classList.remove('smoking');
    void c.offsetWidth;
    c.classList.add('smoking');
  }
  for (const s of t.seats) {
    const lit =
      !t.candles[s.i]?.classList.contains('out') || !t.candles[s.i + 1]?.classList.contains('out');
    s.el.classList.toggle('dark', !lit);
  }
}

/** Every face in `who` turns its eyes towards seat `target`. */
function lookAt(seats: Seat[], target: number, except: number[] = []): void {
  for (const s of seats) {
    if (s.i === target || except.includes(s.i)) continue;
    s.p.show(seatX(s.i) < seatX(target) ? 'glanceR' : 'glanceL', 260);
  }
}

/** Idle life: now and then someone steals a glance at a neighbour. */
function idle(ctx: SceneCtx, seats: Seat[], from = 0): void {
  let k = 0;
  ctx.at(from, () =>
    ctx.every(1150, () => {
      k++;
      const s = seats[(k * 5 + 3) % seats.length];
      if (!s) return;
      if (s.p.expression !== 'neutral') s.p.show('neutral', 420);
      else {
        const other = seats[(k * 7 + 1) % seats.length];
        if (other && other !== s)
          s.p.show(seatX(s.i) < seatX(other.i) ? 'glanceR' : 'glanceL', 320);
      }
    }),
  );
}

function say(ctx: SceneCtx, who: string, line: string, cls = ''): HTMLElement {
  ctx.root.querySelectorAll('.say').forEach((e) => e.classList.add('gone'));
  const s = el('div', `say ${cls}`, `<b>${who}</b><span>${line}</span>`);
  ctx.root.append(s);
  requestAnimationFrame(() => s.classList.add('on'));
  return s;
}

/** Reveal an element (fade/slide via the `.on` class) `ms` from now. */
const show = (ctx: SceneCtx, ms: number, e: Element | null, cls = 'on') => {
  if (e) ctx.at(ms, () => e.classList.add(cls));
};

// --- scenes ----------------------------------------------------------------------------

const title: SceneDef = {
  id: 'title',
  label: 'Overture',
  duration: 13000,
  shots: [{ name: 'title', at: 7200 }],
  enter(ctx) {
    ctx.audio.setBed('title', 2.5);
    camSet(0, 0.5, 3);
    cam(0, 0.57, 12500, 0, ease.sine);
    const t = table(ctx, { unlit: true });
    [4, 5, 3, 6, 2, 7, 1, 8, 0, 9].forEach((j, k) =>
      ctx.at(900 + k * 360, () => {
        setCandle(t, j, true);
        if (k % 3 === 0) ctx.audio.sting('match');
      }),
    );
    ctx.root.insertAdjacentHTML(
      'beforeend',
      `<div class="title-block">
        <div class="kicker">a supper in seven courses</div>
        <h1 class="title">Vesper</h1>
        <p class="title-sub">Nine at the table. One of them is lying.</p>
      </div>`,
    );
    show(ctx, 3600, ctx.root.querySelector('.title-block .kicker'));
    show(ctx, 4200, ctx.root.querySelector('.title'));
    show(ctx, 5400, ctx.root.querySelector('.title-sub'));
    idle(ctx, t.seats, 4800);
  },
};

const role: SceneDef = {
  id: 'role',
  label: 'The letter',
  duration: 11000,
  shots: [{ name: 'role', at: 5600 }],
  enter(ctx) {
    ctx.audio.setBed('title', 2);
    cam(0, 0.6, 2200, 5);
    const t = table(ctx);
    t.root.classList.add('hushed');
    ctx.root.insertAdjacentHTML(
      'beforeend',
      `<div class="letter"><img alt="" src="${IMG['prop-letter'] ?? ''}" /></div>
      <div class="note">
        <div class="kicker">sealed, and meant for you alone</div>
        <p class="you">You are</p>
        <h2>the Lamplighter</h2>
        <div class="side">of the Town</div>
        <p class="ability">Each night, keep watch on another&rsquo;s door, and learn who came calling.</p>
        <i class="seal"></i>
      </div>`,
    );
    show(ctx, 150, ctx.root.querySelector('.letter'));
    ctx.at(900, () => ctx.audio.sting('paper'));
    ctx.at(2100, () => {
      ctx.root.querySelector('.letter')?.classList.add('opened');
      ctx.root.querySelector('.note')?.classList.add('on');
      ctx.audio.sting('reveal');
    });
    ctx.at(2700, () => {
      for (const s of t.seats) {
        if (s.i !== VALE) s.p.show(s.i < 4 ? 'glanceR' : 'glanceL', 300);
      }
    });
    ctx.at(6400, () => t.seats[ILSE]?.p.show('glanceL', 300));
    ctx.at(7600, () => t.seats[ANTON]?.p.show('neutral', 500));
  },
};

const nightfall: SceneDef = {
  id: 'nightfall',
  label: 'Nightfall',
  duration: 12500,
  shots: [{ name: 'nightfall', at: 8800 }],
  enter(ctx) {
    ctx.audio.setBed('night', 3, 0.8);
    cam(0, 0.56, 1400);
    const t = table(ctx);
    [0, 9, 1, 8, 2, 7, 3, 6, 4, 5].forEach((j, k) =>
      ctx.at(500 + k * 330, () => {
        setCandle(t, j, false);
        if (k % 3 === 1) ctx.audio.sting('snuff');
      }),
    );
    ctx.at(1600, () => lookAt(t.seats, 4));
    const duo = el('div', 'duo');
    const anton = new Portrait(faces(ANTON), { blink: true, seed: 3 });
    const ilse = new Portrait(faces(ILSE), { blink: true, seed: 6 });
    anton.el.classList.add('d-left');
    ilse.el.classList.add('d-right');
    duo.append(
      el('div', 'duo-hands', `<img alt="" src="${IMG['prop-hands'] ?? ''}" />`),
      anton.el,
      ilse.el,
      el(
        'div',
        'candle solo-candle',
        '<i class="pool"></i><i class="stick"></i><i class="halo"></i><i class="flame"></i>',
      ),
      el('div', 'kicker duo-k', 'after the candles &middot; two stay at the table'),
    );
    ctx.root.append(duo);
    ctx.signal.addEventListener('abort', () => {
      anton.dispose();
      ilse.dispose();
    });
    ctx.at(4300, () => {
      duo.classList.add('on');
      anton.show('glanceR', 0);
      ilse.show('glanceL', 0);
    });
    ctx.at(5300, () => {
      ilse.talk(1500);
      ctx.audio.sting('whisper');
      say(ctx, 'Ilse', '&ldquo;Vale. Tonight.&rdquo;', 'hush');
    });
    ctx.at(7100, () => {
      anton.talk(1700);
      ctx.audio.sting('whisper2');
      say(ctx, 'Anton', '&ldquo;The healer goes first.&rdquo;', 'hush');
    });
    ctx.at(9200, () => {
      anton.show('closed', 900);
      ilse.show('neutral', 900);
    });
  },
};

const dawn: SceneDef = {
  id: 'dawn',
  label: 'Dawn',
  duration: 11500,
  shots: [{ name: 'dawn', at: 6000 }],
  enter(ctx) {
    ctx.audio.setBed(null, 2);
    ctx.audio.sting('dawn', 0.3);
    ctx.audio.sting('toll', 2.2);
    ctx.at(5600, () => ctx.audio.setBed('day', 5));
    camSet(0, 0.56);
    cam(0, 0.66, 7000, 1, ease.sine);
    const t = table(ctx, { dead: [VALE], unlit: true });
    t.root.classList.add('grey');
    ctx.root.append(el('div', 'dawnlight'));
    ctx.root.insertAdjacentHTML(
      'beforeend',
      `<div class="notice">
        <div class="kicker">first light &middot; the second day</div>
        <h2>Vale did not wake.</h2>
        <p>Vale was <em>the Mender</em> &middot; of the Town</p>
      </div>`,
    );
    ctx.at(2400, () => {
      lookAt(living(t, [VALE]), VALE);
      t.seats[MIRA]?.p.show('afraid', 500);
      t.seats[ILSE]?.p.show('closed', 600);
    });
    ctx.at(3600, () => t.seats[KESTREL]?.p.show('afraid', 500));
    show(ctx, 3000, ctx.root.querySelector('.notice'));
  },
};

const CHAT: [number, string][] = [
  [MIRA, 'Vale healed me two nights ago. Now Vale is dead. Someone knew.'],
  [KESTREL, 'Anton was out past the second bell. I watched his door.'],
  [ANTON, 'I was walking. Since when is walking a crime?'],
  [ORSOLA, 'Since people started dying.'],
  [BRAM, 'I&rsquo;m putting Anton up. Let him explain himself on the stand.'],
];
const VOTERS = [BRAM, KESTREL, MIRA, ORSOLA, JUNIPER];

const day: SceneDef = {
  id: 'day',
  label: 'At table',
  duration: 15500,
  shots: [{ name: 'day', at: 12200 }],
  enter(ctx) {
    ctx.audio.setBed('day', 2);
    camSet(seatX(3) - 4, 0.62);
    cam(seatX(3), 0.7, 3000);
    const t = table(ctx, { dead: [VALE] });
    const alive = living(t, [VALE]);
    const seat = (i: number) => t.seats[i];
    CHAT.forEach(([who, line], k) => {
      ctx.at(500 + k * 1550, () => {
        say(ctx, CAST[who] ?? '', line);
        alive.forEach((s) => s.el.classList.toggle('speaking', s.i === who));
        lookAt(alive, who);
        const p = seat(who)?.p;
        if (who === ANTON) p?.show('afraid', 200);
        p?.talk(1250);
      });
    });
    ctx.at(500 + 1550 + 750, () => {
      lookAt(alive, ANTON, [KESTREL]);
      seat(ANTON)?.p.show('afraid', 200).flinch();
      ctx.audio.sting('gasp');
    });
    ctx.at(500 + 3 * 1550 + 200, () => seat(ANTON)?.p.show('glanceL', 300));
    ctx.at(500 + 4 * 1550 + 800, () => lookAt(alive, ANTON, [BRAM]));
    const tally = el(
      'div',
      'tally',
      '<span class="n"></span><span class="of">of VIII &middot; to the stand</span>',
    );
    tally.style.setProperty('--x', String(seatX(ANTON)));
    t.root.append(tally);
    const voteAt = 8500;
    ctx.at(voteAt - 300, () => {
      cam(-6, 0.62, 1500);
      alive.forEach((s) => s.el.classList.remove('speaking'));
      ctx.root.querySelectorAll('.say').forEach((e) => e.classList.add('gone'));
      seat(ILSE)?.p.show('afraid', 400);
      seat(TEODOR)?.p.show('glanceR', 400);
    });
    VOTERS.forEach((v, k) => {
      ctx.at(voteAt + 500 + k * 600, () => {
        const bean = el('i', 'bean');
        bean.style.setProperty('--x0', String(seatX(v)));
        bean.style.setProperty('--x1', String(seatX(ANTON) + (k - 2) * 1.6));
        t.root.append(bean);
        requestAnimationFrame(() => bean.classList.add('go'));
        seat(v)?.p.show(seatX(v) < seatX(ANTON) ? 'glanceR' : 'glanceL', 200);
        seat(v)?.el.classList.add('voted');
        seat(ANTON)?.p.show('afraid', 150).flinch();
        tally.classList.add('on');
        tally.querySelector('.n')!.textContent = ROMAN[k] ?? '';
        ctx.audio.sting('vote');
      });
    });
    ctx.at(voteAt + 500 + VOTERS.length * 600 + 200, () => {
      tally.classList.add('summoned');
      t.cards[ANTON]?.classList.add('marked');
    });
  },
};

const BALLOTS: [number, boolean][] = [
  [BRAM, true],
  [ILSE, false],
  [MIRA, true],
  [KESTREL, true],
  [TEODOR, false],
  [ORSOLA, true],
  [JUNIPER, true],
];

function solo(ctx: SceneCtx): Portrait {
  world = null;
  const p = new Portrait(faces(ANTON), { blink: true, seed: 3, className: 'solo' });
  ctx.root.append(
    p.el,
    el(
      'div',
      'candle solo-candle big',
      '<i class="pool"></i><i class="stick"></i><i class="halo"></i><i class="flame"></i><i class="smoke"></i>',
    ),
  );
  ctx.signal.addEventListener('abort', () => p.dispose());
  return p;
}

const trial: SceneDef = {
  id: 'trial',
  label: 'The stand',
  duration: 17000,
  shots: [
    { name: 'trial', at: 4600 },
    { name: 'verdict', at: 11400 },
  ],
  enter(ctx) {
    ctx.audio.setBed('trial', 1.2);
    ctx.root.classList.add('stand');
    const anton = solo(ctx);
    ctx.at(500, () => {
      anton.show('afraid', 600);
      anton.talk(4200);
      say(
        ctx,
        'Anton, on the stand',
        '&ldquo;I&rsquo;m a watcher. I saw Kestrel leave her house last night. Ask her where she went.&rdquo;',
      );
    });
    ctx.root.insertAdjacentHTML(
      'beforeend',
      `<div class="col guilty"><h3>Guilty</h3><div class="count"></div><div class="bowl"></div><div class="faces"></div></div>
      <div class="col innocent"><h3>Innocent</h3><div class="count"></div><div class="bowl"></div><div class="faces"></div></div>
      <div class="verdict"><div class="w">Guilty</div><div class="by">by five voices to two</div></div>`,
    );
    ctx.at(5700, () => {
      ctx.root.querySelectorAll('.say').forEach((e) => e.classList.add('gone'));
      ctx.root.querySelectorAll('.col').forEach((c) => c.classList.add('on'));
    });
    const n = { g: 0, i: 0 };
    const minis: Portrait[] = [];
    BALLOTS.forEach(([who, guilty], k) => {
      ctx.at(6300 + k * 520, () => {
        const col = ctx.root.querySelector(guilty ? '.col.guilty' : '.col.innocent')!;
        const count = guilty ? ++n.g : ++n.i;
        col.querySelector('.count')!.textContent = ROMAN[count - 1] ?? '';
        const mini = new Portrait(faces(who), { blink: true, seed: who + 11, className: 'mini' });
        minis.push(mini);
        ctx.signal.addEventListener('abort', () => mini.dispose());
        mini.show(who === ILSE ? 'afraid' : guilty ? 'glanceR' : 'glanceL', 0);
        const fig = el('figure', '', `<figcaption>${CAST[who] ?? ''}</figcaption>`);
        fig.prepend(mini.el);
        col.querySelector('.faces')!.append(fig);
        col.querySelector('.bowl')!.append(el('i', `bean ${guilty ? 'black' : 'white'}`));
        requestAnimationFrame(() => fig.classList.add('on'));
        if (guilty) anton.flinch();
        ctx.audio.sting(guilty ? 'vote' : 'voteSoft');
      });
    });
    ctx.at(10200, () => {
      ctx.audio.setBed(null, 0.3);
      ctx.audio.sting('verdict');
      anton.show('afraid', 100).flinch();
      ctx.root.classList.add('judged');
      ctx.root.querySelector('.verdict')?.classList.add('on');
      minis.forEach((m, k) => {
        if (m.expression === 'glanceR') m.show(k % 2 ? 'closed' : 'glanceR', 600);
      });
    });
    ctx.at(13400, () => ctx.audio.setBed('night', 4));
  },
};

const execution: SceneDef = {
  id: 'execution',
  label: 'The last candle',
  duration: 14000,
  shots: [{ name: 'execution', at: 8400 }],
  enter(ctx) {
    ctx.audio.setBed(null, 1.5);
    ctx.audio.setBed('lament', 2, 0.5);
    ctx.root.classList.add('stand', 'last');
    const anton = solo(ctx);
    anton.show('afraid', 0);
    ctx.root.insertAdjacentHTML(
      'beforeend',
      `<div class="snuff"><img alt="" src="${IMG['prop-snuff'] ?? ''}" /></div>
      <div class="reveal">
        <div class="kicker">and when the smoke had cleared</div>
        <div class="name">Anton</div>
        <div class="was">was <em>the Hatchet</em></div>
        <div class="side">of the Syndicate</div>
      </div>
      <div class="will"><b>found in his coat</b>Light the lamps for me. I never could.</div>`,
    );
    ctx.at(500, () => {
      anton.show('neutral', 700);
      anton.talk(2600);
      say(
        ctx,
        'Anton&rsquo;s last words',
        '&ldquo;You&rsquo;ll miss me when the lamps go out.&rdquo;',
      );
    });
    ctx.at(3900, () => {
      ctx.root.querySelector('.snuff')?.classList.add('on');
      ctx.root.classList.add('snuffing');
    });
    ctx.at(4700, () => {
      ctx.audio.sting('snuff');
      ctx.audio.sting('death', 0.15);
      ctx.root.querySelector('.solo-candle')?.classList.add('out', 'smoking');
      ctx.root.classList.add('dark');
      ctx.root.querySelectorAll('.say').forEach((e) => e.classList.add('gone'));
    });
    ctx.at(5300, () => anton.show('closed', 1800));
    show(ctx, 5600, ctx.root.querySelector('.reveal'));
    show(ctx, 7000, ctx.root.querySelector('.will'));
  },
};

pv.start([title, role, nightfall, dawn, day, trial, execution]);
