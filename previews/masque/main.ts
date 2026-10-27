import '@fontsource-variable/bodoni-moda/standard.css';
import '@fontsource-variable/bodoni-moda/standard-italic.css';
import '@fontsource-variable/cormorant-garamond';
import '@fontsource-variable/cormorant-garamond/wght-italic.css';
import { shaderLayer } from '../shared/gl.ts';
import { createPreview, el, type SceneCtx, type SceneDef } from '../shared/harness.ts';
import { ease } from '../shared/tween.ts';
import { maskSVG } from './masks.ts';
import { masqueScore } from './score.ts';
import { PIAZZA_FRAG } from './shader.ts';
import './style.css';

const CAST = ['Orsola', 'Kestrel', 'Anton', 'Mira', 'Vale', 'Ilse', 'Bram', 'Juniper', 'Teodor'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
const ANTON = 2;
const VALE = 4;
const ILSE = 5;
const KESTREL = 1;
const MIRA = 3;
const ORSOLA = 0;
const BRAM = 6;
const JUNIPER = 7;
const TEODOR = 8;

const pv = createPreview({
  slug: 'masque',
  name: 'Masque',
  score: masqueScore,
  exitMs: 1200,
  gate(g) {
    g.innerHTML = `
      <div class="gate-inner">
        <div class="kicker">Vesper &middot; a preview in seven tableaux</div>
        <h1 class="gold">Masque</h1>
        <p class="gate-sub">a surrealist opera of masks &amp; murder</p>
        <button data-begin class="gate-btn">Raise the curtain</button>
        <p class="gate-hint">Sound on &middot; headphones recommended</p>
      </div>`;
  },
});

const gl = shaderLayer(pv.bg, PIAZZA_FRAG, { scale: 0.8, maxDpr: 1.5 });
const T = pv.tween;
const U = {
  day: 1,
  ground: 1,
  dawn: 0.2,
  curtain: 1,
  dim: 0,
  spotX: 0.5,
  spotY: 0.42,
  spotR: 0.3,
  red: 0,
  flash: 0,
  sunX: 0,
  sunY: 0.76,
  shadow: 0.5,
};
type Key = keyof typeof U;
for (const [k, v] of Object.entries(U)) T.set(k, v);

/** Tween the stage (shader uniforms) towards a look. */
const look = (vals: Partial<Record<Key, number>>, ms = 1500, e = ease.inOut) => {
  for (const [k, v] of Object.entries(vals)) T.to(k, v, ms, e);
};

let mouse: [number, number] = [0.5, 0.5];
const smooth: [number, number] = [0.5, 0.5];
let level = 0;
window.addEventListener('pointermove', (e) => {
  mouse = [e.clientX / innerWidth, 1 - e.clientY / innerHeight];
});
pv.onFrame((now, dt) => {
  const k = 1 - Math.exp(-dt / 500);
  smooth[0] += (mouse[0] - smooth[0]) * k;
  smooth[1] += (mouse[1] - smooth[1]) * k;
  level += (pv.audio.level() - level) * 0.08;
  pv.stage.style.setProperty('--mx', (smooth[0] - 0.5).toFixed(4));
  pv.stage.style.setProperty('--my', (smooth[1] - 0.5).toFixed(4));
  const g = (k: Key) => T.get(k);
  gl.render(now / 1000, {
    uDay: g('day'),
    uGround: g('ground'),
    uDawn: g('dawn'),
    uCurtain: g('curtain'),
    uDim: g('dim'),
    uSpot: [g('spotX'), g('spotY'), g('spotR')],
    uRed: g('red'),
    uFlash: g('flash'),
    uSun: [g('sunX'), g('sunY')],
    uShadow: g('shadow'),
    uMouse: smooth,
    uLevel: level,
  });
});

// --- the town: masks on plinths in a half-ring across the piazza -----------------------

interface Seat {
  x: number;
  y: number;
  s: number;
}
const seatPos = (i: number): Seat => {
  const x = 17 + (66 * i) / 8;
  const depth = Math.sqrt(Math.max(0, 1 - ((x - 50) / 36) ** 2));
  return { x, y: 82 - 11 * depth, s: 1 - 0.3 * depth };
};
/** Centre of a seated mask in viewport percent. */
const maskCentre = (i: number): [number, number] => {
  const p = seatPos(i);
  return [p.x, p.y - 21 * p.s];
};

interface TownOptions {
  dead?: number[];
  dimmed?: boolean;
  omit?: number[];
  glow?: number[];
}

function town(root: HTMLElement, o: TownOptions = {}): HTMLElement[] {
  const wrap = el('div', 'town');
  const seats: HTMLElement[] = [];
  CAST.forEach((name, i) => {
    const p = seatPos(i);
    const seat = el('div', 'seat');
    seat.style.left = `${p.x}%`;
    seat.style.top = `${p.y}%`;
    seat.style.setProperty('--s', p.s.toFixed(3));
    seat.style.setProperty('--d', `${(i * 0.73) % 3}s`);
    seat.style.zIndex = String(Math.round(p.y));
    const dead = o.dead?.includes(i);
    if (dead) seat.classList.add('dead');
    if (o.omit?.includes(i)) seat.classList.add('omit');
    seat.innerHTML = `
      <div class="figure">
        <div class="mask">${maskSVG({ variant: i, cracked: dead, glowEyes: o.glow?.includes(i) })}</div>
        <div class="plinth">${dead ? '<i class="ribbon"></i>' : ''}</div>
      </div>
      <div class="nameplate"><span class="rn">${ROMAN[i]}</span>${name}</div>`;
    wrap.append(seat);
    seats.push(seat);
  });
  if (o.dimmed) wrap.classList.add('dimmed');
  root.append(wrap);
  return seats;
}

/** Words that arrive one at a time, like a sung line. */
function sung(text: string, startDelay = 0, step = 70): string {
  return text
    .split(' ')
    .map((w, i) => `<span class="w" style="animation-delay:${startDelay + i * step}ms">${w}</span>`)
    .join(' ');
}

const show = (ctx: SceneCtx, ms: number, node: Element, cls = 'on') =>
  ctx.at(ms, () => node.classList.add(cls));

// --- scenes ---------------------------------------------------------------------------

const title: SceneDef = {
  id: 'title',
  label: 'Overture',
  duration: 13000,
  shots: [{ name: 'title', at: 4500 }],
  enter(ctx) {
    look(
      {
        day: 1,
        ground: 1,
        dawn: 0.32,
        dim: 0,
        red: 0,
        flash: 0,
        sunX: 0.125,
        sunY: 0.765,
        shadow: 0.16,
      },
      800,
    );
    ctx.at(350, () => look({ curtain: 0 }, 3600));
    ctx.audio.setBed('title', 2.5);
    ctx.audio.sting('curtain', 0.25);
    ctx.root.innerHTML = `
      <div class="moon">${maskSVG({ variant: 0, eyesClosed: true })}</div>
      <div class="title-block">
        <div class="kicker">an opera of masks &amp; murder in seven tableaux</div>
        <h1 class="title gold">${[...'VESPER'].map((c, i) => `<span style="animation-delay:${1500 + i * 120}ms">${c}</span>`).join('')}</h1>
        <p class="title-sub">Nine voices. One lamp. Somebody here is lying.</p>
      </div>`;
    show(ctx, 200, ctx.root.querySelector('.moon')!);
    show(ctx, 2600, ctx.root.querySelector('.kicker')!);
    show(ctx, 3200, ctx.root.querySelector('.title-sub')!);
  },
};

const LANTERN = `<svg viewBox="0 0 120 150" class="emblem" aria-hidden="true">
  <defs>
    <radialGradient id="flame" cx="50%" cy="60%" r="55%"><stop offset="0" stop-color="#fff6d0"/><stop offset=".45" stop-color="#f2b54a"/><stop offset="1" stop-color="#b8461f" stop-opacity="0"/></radialGradient>
    <linearGradient id="lg" x1="0" x2="1"><stop offset="0" stop-color="#8a6a2a"/><stop offset=".5" stop-color="#e6c877"/><stop offset="1" stop-color="#8a6a2a"/></linearGradient>
  </defs>
  <g stroke="url(#lg)" fill="none" stroke-width="1.6">
    ${Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      const r1 = 46,
        r2 = i % 2 ? 54 : 60;
      return `<path d="M${60 + Math.cos(a) * r1} ${84 + Math.sin(a) * r1} L${60 + Math.cos(a) * r2} ${84 + Math.sin(a) * r2}" stroke-width=".9"/>`;
    }).join('')}
    <circle cx="60" cy="10" r="6"/>
    <path d="M60 16 L60 26"/>
    <path d="M40 40 L46 28 L74 28 L80 40 Z"/>
    <path d="M38 40 L82 40 L78 120 L42 120 Z"/>
    <path d="M42 120 L36 132 L84 132 L78 120"/>
    <path d="M50 40 L50 120 M70 40 L70 120" stroke-width=".7"/>
  </g>
  <ellipse cx="60" cy="84" rx="26" ry="34" fill="url(#flame)"/>
  <path d="M44 84 Q60 66 76 84 Q60 102 44 84 Z" fill="#fff8e2" stroke="#8a6a2a" stroke-width="1"/>
  <circle cx="60" cy="84" r="7.5" fill="#2a1616"/><circle cx="62.5" cy="81.5" r="2" fill="#fff8e2"/>
</svg>`;

const role: SceneDef = {
  id: 'role',
  label: 'The role',
  duration: 11000,
  shots: [{ name: 'role', at: 5200 }],
  enter(ctx) {
    look(
      {
        day: 1,
        ground: 1,
        dawn: 0.2,
        curtain: 0.12,
        dim: 0.86,
        spotX: 0.5,
        spotY: 0.5,
        spotR: 0.5,
        red: 0,
        flash: 0,
        sunX: -0.55,
        sunY: 0.74,
        shadow: 0.9,
      },
      1400,
    );
    ctx.audio.setBed('title', 2);
    ctx.root.innerHTML = `
      <div class="role-kicker kicker">You have been cast as</div>
      <div class="card-wrap"><div class="card">
        <div class="face back">
          <div class="back-frame"><div class="back-mono gold">V</div><div class="back-rays"></div></div>
        </div>
        <div class="face front">
          <div class="front-frame">
            <div class="card-top">Town &middot; Investigative</div>
            ${LANTERN}
            <h2 class="role-name">The Lamplighter</h2>
            <p class="ability">Each night, carry your lamp to one door and learn whether the one within keeps faith with the Town.</p>
            <p class="flavor">&ldquo;Light is a question the dark must answer.&rdquo;</p>
          </div>
        </div>
      </div></div>`;
    const card = ctx.root.querySelector('.card')!;
    show(ctx, 60, ctx.root.querySelector('.card-wrap')!, 'in');
    show(ctx, 400, ctx.root.querySelector('.role-kicker')!);
    ctx.at(1900, () => {
      card.classList.add('flipped');
      ctx.audio.sting('reveal');
    });
  },
};

const nightfall: SceneDef = {
  id: 'nightfall',
  label: 'Nightfall',
  duration: 12500,
  shots: [{ name: 'nightfall', at: 8300 }],
  enter(ctx) {
    look(
      {
        day: 1,
        ground: 1,
        dawn: 0.15,
        curtain: 0,
        dim: 0,
        red: 0,
        flash: 0,
        sunX: 0.3,
        sunY: 0.66,
        shadow: 1.2,
      },
      500,
    );
    ctx.at(600, () => look({ ground: 0, dawn: 0.45 }, 3600));
    ctx.at(2800, () => look({ day: 0, dawn: 0, sunX: -0.24, sunY: 0.8 }, 5600));
    ctx.audio.sting('nightfall', 0.4);
    ctx.audio.setBed('night', 3.5, 1.2);
    const seats = town(ctx.root, { glow: [ILSE, ANTON] });
    ctx.root.insertAdjacentHTML(
      'beforeend',
      `<div class="night-text">
        <div class="kicker">Act I &middot; nightfall</div>
        <h2 class="night-title">Night the First</h2>
        <div class="whisper">
          <div class="aside">sotto voce &mdash; the masked ones confer</div>
          <p class="wl"><b>Ilse</b> Vale. Tonight.</p>
          <p class="wl"><b>Anton</b> The healer goes first.</p>
        </div>
      </div>`,
    );
    ctx.at(700, () => ctx.root.querySelector('.town')!.classList.add('night'));
    show(ctx, 3200, ctx.root.querySelector('.night-title')!);
    show(ctx, 3200, ctx.root.querySelector('.night-text .kicker')!);
    show(ctx, 4300, ctx.root.querySelector('.aside')!);
    ctx.at(4600, () => {
      seats[ILSE]?.classList.add('conspire', 'lean-r');
      seats[ANTON]?.classList.add('conspire', 'lean-l');
    });
    const lines = ctx.root.querySelectorAll('.wl');
    lines.forEach((l, i) => show(ctx, 4700 + i * 1300, l));
  },
};

const dawn: SceneDef = {
  id: 'dawn',
  label: 'Dawn',
  duration: 11500,
  shots: [{ name: 'dawn', at: 5600 }],
  enter(ctx) {
    look(
      {
        day: 0,
        ground: 0,
        dawn: 0,
        curtain: 0,
        dim: 0,
        red: 0,
        flash: 0,
        sunX: 0.5,
        sunY: 0.44,
        shadow: 1.3,
      },
      500,
    );
    ctx.at(400, () => look({ dawn: 1 }, 2600));
    ctx.at(600, () => look({ day: 1, sunX: 0.46, sunY: 0.68 }, 5200));
    ctx.at(1500, () => look({ ground: 1 }, 3800));
    ctx.at(4200, () => look({ dawn: 0.3 }, 4000));
    ctx.audio.setBed(null, 2);
    ctx.audio.sting('dawn', 0.35);
    ctx.audio.sting('toll', 3.1);
    ctx.at(5200, () => ctx.audio.setBed('day', 5));
    town(ctx.root, { dead: [VALE] });
    ctx.at(30, () => ctx.root.querySelector('.town')!.classList.add('night', 'instant'));
    ctx.at(1600, () => ctx.root.querySelector('.town')!.classList.remove('night', 'instant'));
    ctx.root.insertAdjacentHTML(
      'beforeend',
      `<div class="notice">
        <div class="notice-in">
          <div class="kicker">Dawn &middot; the second day</div>
          <h2>Vale did not wake.</h2>
          <p class="notice-sub">Found at first light beneath the arcade, mask broken.</p>
          <div class="notice-role">Vale was <em>the Apothecary</em><span>Town &middot; Protective</span></div>
        </div>
      </div>`,
    );
    show(ctx, 3000, ctx.root.querySelector('.notice')!);
  },
};

const CHAT: [number, string][] = [
  [MIRA, 'Vale healed me two nights ago. Now Vale is dead. Someone knew.'],
  [KESTREL, 'Anton was out past the second bell. I watched his door.'],
  [ANTON, 'I was walking. Since when is walking a crime?'],
  [ORSOLA, 'Since people started dying.'],
  [BRAM, 'I’m putting Anton up. Let him explain himself on the stand.'],
];
const VOTERS = [BRAM, KESTREL, MIRA, ORSOLA, JUNIPER];

const day: SceneDef = {
  id: 'day',
  label: 'The square',
  duration: 15000,
  shots: [{ name: 'day', at: 11000 }],
  enter(ctx) {
    look(
      {
        day: 1,
        ground: 1,
        dawn: 0.12,
        curtain: 0,
        dim: 0,
        red: 0,
        flash: 0,
        sunX: 0.55,
        sunY: 0.8,
        shadow: 0.95,
      },
      1200,
    );
    ctx.audio.setBed('day', 2);
    const seats = town(ctx.root, { dead: [VALE] });
    const lib = el('aside', 'libretto');
    lib.innerHTML = `<header><span>Libretto</span><span>Day the Second</span></header><ol></ol>`;
    ctx.root.append(lib);
    show(ctx, 100, lib);
    const ol = lib.querySelector('ol')!;
    CHAT.forEach(([who, line], i) => {
      ctx.at(700 + i * 1300, () => {
        const li = el('li', '', `<b>${CAST[who]}</b><span>${sung(line, 120, 55)}</span>`);
        ol.append(li);
        seats.forEach((s) => s.classList.remove('speaking'));
        seats[who]?.classList.add('speaking');
      });
    });
    ctx.at(700 + CHAT.length * 1300 + 600, () =>
      seats.forEach((s) => s.classList.remove('speaking')),
    );

    const threads = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    threads.setAttribute('class', 'threads');
    threads.setAttribute('viewBox', '0 0 100 100');
    threads.setAttribute('preserveAspectRatio', 'none');
    ctx.root.append(threads);
    const tally = el('div', 'tally', '<span class="n gold"></span><span class="of">of VIII</span>');
    const [ax, ay] = maskCentre(ANTON);
    tally.style.left = `${ax}%`;
    tally.style.top = `${ay - 8.5}%`;
    ctx.root.append(tally);
    VOTERS.forEach((v, i) => {
      ctx.at(7400 + i * 750, () => {
        const [x1, y1] = maskCentre(v);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const cx = (x1 + ax) / 2;
        const cy = Math.min(y1, ay) - 10 - i * 2;
        path.setAttribute('d', `M${x1} ${y1} Q${cx} ${cy} ${ax} ${ay}`);
        path.setAttribute('pathLength', '1');
        threads.append(path);
        seats[v]?.classList.add('voted');
        tally.classList.add('on');
        tally.querySelector('.n')!.textContent = ROMAN[i] ?? '';
        tally.classList.remove('pulse');
        void tally.offsetWidth;
        tally.classList.add('pulse');
        ctx.audio.sting('vote');
      });
    });
    ctx.at(7400 + VOTERS.length * 750 + 300, () => {
      seats[ANTON]?.classList.add('accused');
      tally.classList.add('summoned');
    });
  },
};

function soloAnton(root: HTMLElement, cracked = false): HTMLElement {
  const solo = el('div', 'solo');
  solo.innerHTML = `<div class="mask">${maskSVG({ variant: ANTON, cracked })}</div><div class="plinth"></div><div class="nameplate"><span class="rn">III</span>Anton</div>`;
  root.append(solo);
  return solo;
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
    look(
      {
        day: 1,
        ground: 1,
        dawn: 0.1,
        curtain: 0.2,
        dim: 0.84,
        spotX: 0.5,
        spotY: 0.42,
        spotR: 0.34,
        red: 0,
        flash: 0,
        sunX: 0.55,
        sunY: 0.8,
      },
      1400,
    );
    ctx.audio.setBed('trial', 1.2);
    town(ctx.root, { dead: [VALE], omit: [ANTON], dimmed: true });
    soloAnton(ctx.root);
    ctx.root.insertAdjacentHTML(
      'beforeend',
      `<div class="defense">
        <div class="kicker">the accused sings in his defence</div>
        <p>&ldquo;${sung('I’m a watcher. I saw Kestrel leave her house last night. Ask her where she went.', 900, 120)}&rdquo;</p>
      </div>
      <div class="ballots guilty"><h3>Guilty</h3><div class="count gold"></div><ul></ul><div class="heap"></div></div>
      <div class="ballots innocent"><h3>Innocent</h3><div class="count"></div><ul></ul><div class="heap"></div></div>
      <div class="verdict"><div class="verdict-word gold">Guilty</div><div class="verdict-sub">by five voices to two</div></div>`,
    );
    show(ctx, 300, ctx.root.querySelector('.defense')!);
    ctx.at(5600, () => {
      ctx.root.querySelector('.defense')!.classList.add('fade');
      ctx.root.querySelectorAll('.ballots').forEach((b) => b.classList.add('on'));
    });
    const tallies = { true: 0, false: 0 };
    BALLOTS.forEach(([who, guilty], i) => {
      ctx.at(6300 + i * 520, () => {
        const col = ctx.root.querySelector(guilty ? '.ballots.guilty' : '.ballots.innocent')!;
        const n = ++tallies[guilty ? 'true' : 'false'];
        col.querySelector('.count')!.textContent = ROMAN[n - 1] ?? '';
        col.querySelector('ul')!.append(el('li', '', CAST[who]));
        const petal = el('i', `petal ${guilty ? 'red' : 'white'}`);
        petal.style.setProperty('--dx', `${(i % 3) * 1.4 - 1.4}vw`);
        petal.style.setProperty('--r', `${(i * 47) % 180}deg`);
        petal.style.setProperty('--k', String(n));
        col.querySelector('.heap')!.append(petal);
        ctx.audio.sting('vote');
      });
    });
    ctx.at(10200, () => {
      ctx.audio.setBed(null, 0.25);
      ctx.audio.sting('verdict');
      T.set('flash', 0.85);
      look({ flash: 0, red: 1, spotR: 0.4 }, 1800, ease.out);
      ctx.root.classList.add('judged');
    });
    ctx.at(13400, () => ctx.audio.setBed('night', 4));
  },
};

const execution: SceneDef = {
  id: 'execution',
  label: 'Curtain',
  duration: 14000,
  shots: [{ name: 'execution', at: 7600 }],
  enter(ctx) {
    look(
      {
        day: 1,
        ground: 1,
        dawn: 0.1,
        curtain: 0.2,
        dim: 0.86,
        spotX: 0.5,
        spotY: 0.42,
        spotR: 0.34,
        red: 0.65,
        flash: 0,
        sunX: 0.55,
        sunY: 0.8,
      },
      900,
    );
    ctx.audio.setBed(null, 1.5);
    const solo = soloAnton(ctx.root, true);
    solo.classList.add('condemned');
    const halves = el('div', 'halves');
    halves.innerHTML = `<div class="half l">${maskSVG({ variant: ANTON, half: 'left' })}</div><div class="half r">${maskSVG({ variant: ANTON, half: 'right' })}</div>`;
    ctx.root.append(halves);
    ctx.root.insertAdjacentHTML(
      'beforeend',
      `<div class="last-words"><div class="kicker">his last words</div><p>&ldquo;You&rsquo;ll miss me when the lamps go out.&rdquo;</p></div>
      <div class="reveal">
        <div class="reveal-name">Anton</div>
        <div class="reveal-was">was</div>
        <div class="reveal-role gold">the Understudy</div>
        <div class="reveal-faction">one of the Masked &middot; Mafia</div>
      </div>
      <div class="will"><b>Last will</b>Light the lamps for me. I never could.</div>`,
    );
    ctx.at(500, () => {
      ctx.audio.sting('crack');
      ctx.audio.sting('death', 0.05);
      solo.classList.add('cracking');
    });
    ctx.at(1700, () => {
      solo.classList.add('broken');
      halves.classList.add('fall');
    });
    show(ctx, 1300, ctx.root.querySelector('.last-words')!);
    ctx.at(2300, () => {
      ctx.audio.sting('curtain');
      look({ curtain: 1, dim: 0.2, red: 0 }, 2900, ease.inOut);
    });
    show(ctx, 5000, ctx.root.querySelector('.reveal')!);
    show(ctx, 6600, ctx.root.querySelector('.will')!);
    ctx.at(7200, () => ctx.audio.setBed('night', 5));
  },
};

pv.start([title, role, nightfall, dawn, day, trial, execution]);
