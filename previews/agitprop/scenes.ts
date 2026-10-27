import type { SceneCtx, SceneDef } from '../shared/harness.ts';
import { ease } from '../shared/tween.ts';
import { bgSet, bgTo } from './backdrop.ts';
import {
  CAST,
  div,
  edge,
  feed,
  flicker,
  grid,
  hide,
  masthead,
  nn,
  onFrame,
  pop,
  setNight,
  shake,
  slam,
  snap,
  svg,
  tape,
  thrust,
  uid,
} from './kit.ts';
import { BPM, MORSE, morseAt } from './score.ts';

const DAY_PAPER = { inv: 0, invTo: 0, wipe: 0, wipeMode: 0, clip: 2 };

const EMBLEM = `<svg class="ag-emblem" viewBox="0 0 200 220" aria-hidden="true">
  <rect class="em em-top" x="22" y="16" width="156" height="24"/>
  <rect class="em em-l" x="22" y="48" width="26" height="86"/>
  <rect class="em em-r" x="152" y="48" width="26" height="86"/>
  <polygon class="em em-wl" points="22,142 96,142 99,210"/>
  <polygon class="em em-wr red" points="104,142 178,142 101,210"/>
  <circle class="em em-disc red" cx="100" cy="91" r="35"/>
  <rect class="em em-slash" x="93" y="44" width="14" height="94" transform="rotate(45 100 91)"/>
</svg>`;

const title: SceneDef = {
  id: 'title',
  label: 'Title',
  duration: 11000,
  shots: [{ name: 'title', at: 4000 }],
  enter(ctx) {
    const { root: r, tween: tw } = ctx;
    setNight(false);
    bgSet(tw, { ...DAY_PAPER, sx: 0.7, sy: 0.49, sr: 0.32, sred: 1, tone: 0.55 });
    ctx.audio.setBed('title', 0.6);
    const g = grid(ctx, BPM.title, 'title');

    const mast = masthead(r, 'EDITION No. 00 · THE PRESS ROLLS AT DUSK', 'PRICE: ONE VOTE');
    const ringId = uid('ring');
    const phrase = 'NINE CITIZENS · TWO KNIVES · ONE TRIBUNAL · A PRESS THAT NEVER STOPS · ';
    const ring = div(
      r,
      'ag-t-ring ag-wait',
      `<svg viewBox="-500 -500 1000 1000"><path id="${ringId}" d="M-430,0a430,430 0 1,1 860,0a430,430 0 1,1 -860,0" fill="none"/><text><textPath href="#${ringId}" textLength="2690" lengthAdjust="spacing">${phrase}${phrase}</textPath></text></svg>`,
    );
    const wedge = div(
      r,
      'ag-t-wedge ag-wait',
      '<svg viewBox="0 0 1000 100" preserveAspectRatio="none"><polygon points="0,0 1000,50 0,100"/></svg>',
    );
    const word = div(r, 'ag-t-word');
    const letters = [...'VESPER'].map((ch) => div(word, 'ag-wait', ch));
    const bar = div(r, 'ag-t-bar ag-wait', 'A TRIBUNAL IN SEVEN EDITIONS');
    const tag = div(
      r,
      'ag-t-tag ag-wait',
      'NINE CITIZENS. TWO KNIVES. ONE PRESS THAT NEVER STOPS.',
    );
    const cast = div(r, 'ag-t-cast');
    const castLabel = div(cast, 'ag-t-cast-label ag-wait', 'FIG. 1 — THE CAST, IN SEATING ORDER');
    const seats = CAST.map((name, i) =>
      div(cast, 'ag-t-seat ag-wait', `<i>${nn(i + 1)}</i><span>${name}</span>`),
    );
    const morse = div(r, 'ag-t-morse ag-wait');
    div(morse, 'ag-t-morse-l', 'WIRE');
    const syms: HTMLElement[] = [];
    let groupEl: HTMLElement | null = null;
    let lastLetter = -1;
    for (const m of MORSE) {
      if (m.letter !== lastLetter) {
        lastLetter = m.letter;
        groupEl = div(morse, 'ag-mg');
        div(groupEl, 'ag-mg-l', 'VESPER'[m.letter]);
      }
      syms.push(div(groupEl, m.len === 1 ? 'ag-dot' : 'ag-dash'));
    }
    edge(r, 'BROADSIDE · PRINTED AT DUSK · SEVEN EDITIONS · ONE TRIBUNAL', 'l');

    let lit = -1;
    onFrame(ctx, () => {
      const c = ctx.audio.bedClock();
      const k = c && c.name === 'title' ? morseAt(c.t) : -1;
      if (k === lit) return;
      syms[lit]?.classList.remove('on');
      syms[k]?.classList.add('on');
      lit = k;
    });

    ctx.at(g(0), () => slam(mast, '', { from: 1.25, rot: 0, dur: 240 }));
    ctx.at(g(1), () => {
      thrust(wedge, '', '-60vw', '0px', 460);
      flicker(ring, 400);
    });
    letters.forEach((el, k) =>
      ctx.at(g(1.5 + k * 0.5), () => slam(el, '', { from: 2.4, rot: k % 2 ? 7 : -7, dur: 250 })),
    );
    ctx.at(g(4.5), () => thrust(bar, 'rotate(-6deg)', '-70vw', '7.4vw', 520));
    ctx.at(g(5), () => {
      flicker(tag);
      feed(castLabel);
      cast.classList.add('ag-on');
    });
    seats.forEach((el, k) => ctx.at(g(5 + k * 0.125), () => pop(el)));
    ctx.at(g(6), () => feed(morse));
  },
};

const role: SceneDef = {
  id: 'role',
  label: 'Your role',
  duration: 11000,
  shots: [{ name: 'role', at: 5000 }],
  enter(ctx) {
    const { root: r, tween: tw } = ctx;
    setNight(false);
    bgSet(tw, { ...DAY_PAPER, sx: 0.665, sy: 0.49, sr: 0.41, sred: 1, tone: 0.32 });
    ctx.audio.setBed('title', 0.6);
    const g = grid(ctx, BPM.title, 'title');

    const mast = masthead(r, 'EDITION No. 01 · SEALED ASSIGNMENT', 'FOR YOUR EYES ONLY');
    const kicker = div(r, 'ag-r-kicker ag-wait', 'READ ALONE · TELL NO ONE · BURN AT DAWN');
    const you = div(r, 'ag-r-you ag-wait', 'YOU<br>ARE');
    const strip = div(r, 'ag-r-strip ag-wait', 'TOWN · PROTECTIVE · ONE DOOR A NIGHT');
    const fig = div(
      r,
      'ag-r-fig ag-wait',
      `<div class="ag-fig-l">FIG. 2 — ONE DOOR. ONE GUARD.</div>
      <svg viewBox="0 0 600 250" aria-hidden="true">
        <rect class="o" x="30" y="40" width="110" height="160"/>
        <rect class="o" x="245" y="40" width="110" height="160"/>
        <text x="85" y="134">01</text>
        <polygon class="k" points="610,92 610,140 372,116"/>
        <line class="o" x1="372" y1="60" x2="372" y2="172"/>
        <circle class="red" cx="300" cy="116" r="44"/>
        <rect class="k" x="226" y="196" width="148" height="12"/>
        <text class="s" x="300" y="238">YOU</text>
        <text class="s" x="520" y="76">THE KNIFE</text>
      </svg>`,
    );
    edge(r, 'ROLE CARD · ISSUED BY THE TRIBUNAL · KEEP SEALED', 'r');

    const card = div(r, 'ag-card ag-wait');
    const inner = div(card, 'ag-card-in');
    div(
      inner,
      'ag-face ag-back',
      `<i class="ag-cb-disc"></i><i class="ag-cb-bar"></i><i class="ag-cb-bar b2"></i><i class="ag-cb-bar b3"></i>
       <span class="ag-cb-word">VESPER</span><span class="ag-cb-seal">SEALED · No. 01</span>`,
    );
    const front = div(
      inner,
      'ag-face ag-front',
      `<div class="ag-cf-top"><span>TOWN · PROTECTIVE</span><span>No. 01</span></div>
       <div class="ag-cf-em">${EMBLEM}</div>
       <div class="ag-cf-name">THE<br>BULWARK</div>
       <div class="ag-cf-text"></div>
       <div class="ag-cf-foot"><span>FACTION<b>TOWN</b></span><span>ARCHETYPE<b>PROTECTIVE</b></span></div>`,
    );
    const stampEl = div(front, 'ag-cf-stamp ag-ink ag-wait', 'ON GUARD');
    const text = front.querySelector<HTMLElement>('.ag-cf-text');
    const pieces = [...front.querySelectorAll('.em')];
    const PIECE_FROM = [
      'translate(0px,-60px)',
      'translate(-60px,0px)',
      'translate(60px,0px)',
      'translate(-40px,60px)',
      'translate(40px,60px)',
      'scale(0)',
      'rotate(-90deg) scale(.2)',
    ];

    ctx.at(g(0), () => {
      slam(mast, '', { from: 1.25, rot: 0, dur: 240 });
      thrust(card, 'rotate(-4deg)', '34vw', '70vh', 620);
    });
    ctx.at(g(1), () => {
      flicker(kicker);
      slam(you, '', { from: 1.8, rot: -4 });
    });
    ctx.at(g(2), () => feed(strip));
    ctx.at(g(3), () => {
      ctx.audio.sting('reveal');
      inner.animate(
        [
          { transform: 'rotateY(0deg)' },
          { transform: 'rotateY(196deg)', offset: 0.72 },
          { transform: 'rotateY(180deg)' },
        ],
        { duration: 560, easing: 'cubic-bezier(.6,0,.3,1)', fill: 'both' },
      );
      pieces.forEach((p, k) =>
        p.animate(
          [
            { transform: PIECE_FROM[k] ?? 'scale(0)', opacity: 0 },
            { transform: 'none', opacity: 1 },
          ],
          {
            duration: 320,
            delay: 260 + k * 70,
            easing: 'cubic-bezier(.34,1.56,.64,1)',
            fill: 'both',
          },
        ),
      );
    });
    ctx.at(g(3) + 380, () => {
      if (text)
        typeTextInto(
          ctx,
          text,
          'EACH NIGHT, STAND GUARD AT ONE DOOR. IF THE KILLERS COME, YOU MEET THEM FIRST.',
        );
    });
    ctx.at(g(3) + 1000, () => {
      slam(stampEl, 'rotate(-13deg)', { from: 2.6, rot: -10, dur: 200 });
      shake(tw, 9);
    });
    ctx.at(g(5), () => flicker(fig, 360));
  },
};

function typeTextInto(ctx: SceneCtx, el: HTMLElement, s: string) {
  const t0 = performance.now();
  const id = window.setInterval(() => {
    const i = Math.floor((performance.now() - t0) / 9);
    el.innerHTML = `${s.slice(0, i)}<span class="ag-ghost">${s.slice(i)}</span>`;
    if (i >= s.length) window.clearInterval(id);
  }, 24);
  el.innerHTML = `<span class="ag-ghost">${s}</span>`;
  ctx.signal.addEventListener('abort', () => window.clearInterval(id));
}

const HOUSE_H = [52, 70, 44, 82, 58, 66, 48, 76, 56];

const nightfall: SceneDef = {
  id: 'nightfall',
  label: 'Nightfall',
  duration: 12000,
  shots: [{ name: 'nightfall', at: 6000 }],
  enter(ctx) {
    const { root: r, tween: tw } = ctx;
    setNight(false);
    bgSet(tw, { ...DAY_PAPER, invTo: 1, sx: 0.8, sy: 0.5, sr: 0.17, sred: 1, tone: 0.25 });
    const SLAM = 1850;
    ctx.audio.duck(0.2, 0.3, 1.4, 0.6);
    ctx.audio.sting('nightfall', 0.35);
    ctx.audio.setBed('night', 0.8, 1.7);
    const gN = grid(ctx, BPM.night, 'night');
    const at = (ms: number) => Math.max(ms, SLAM + 500);

    const day = div(r, 'ag-n-day');
    const mastD = masthead(day, 'EVENING EDITION · DAY 1', 'LAMPS LIT AT THE SECOND BELL');
    const head = div(day, 'ag-n-head ag-wait', 'THE LAMPS<br>ARE LIT.');
    const town = div(r, 'ag-n-town');
    const houses = HOUSE_H.map((h, i) => {
      const el = div(town, 'ag-house', `<b>${nn(i + 1)}</b><i></i>`);
      el.style.height = `${h}%`;
      return el;
    });
    div(town, 'ag-n-ground');

    const night = div(r, 'ag-n-night');
    const mastN = masthead(night, 'NIGHT EDITION · DAY 1', 'THE PRESS DOES NOT SLEEP');
    const big = div(night, 'ag-n-big ag-wait', 'NIGHT');
    const wire = div(night, 'ag-n-wire');
    const label = div(wire, 'ag-n-label ag-wait', 'INTERCEPTED · PRIVATE WIRE · NOT FOR THE TOWN');
    const t1 = tape(wire, 'ILSE', 'Vale. Tonight.', 'ag-tape-red ag-tape-big', -5);
    const t2 = tape(wire, 'ANTON', 'The healer goes first.', 'ag-tape-red ag-tape-big', -5);
    const edgeN = edge(night, 'NIGHT EDITION · SET IN THE DARK · PRINTED BY NO ONE', 'r');
    edgeN.classList.add('ag-wait');

    slam(mastD, '', { from: 1.15, rot: 0, dur: 200 });
    thrust(head, '', '-30vw', '0px', 380);
    ctx.at(350, () => {
      bgTo(tw, { wipe: 1 }, SLAM - 350, ease.in);
      bgTo(tw, { sy: 1.2 }, SLAM - 450, ease.in);
      town.animate(
        [
          { transform: 'rotate(0deg)', easing: 'cubic-bezier(.55,0,1,.45)' },
          { transform: 'rotate(-8deg)', offset: 0.9, easing: 'cubic-bezier(.16,1,.3,1)' },
          { transform: 'rotate(-6deg)' },
        ],
        { duration: SLAM - 350 + 260, fill: 'both' },
      );
    });
    ctx.at(SLAM, () => {
      setNight(true);
      r.classList.add('ag-is-night');
      bgSet(tw, { inv: 1, wipe: 0, sred: 0, sx: 0.79, sy: 0.3, sr: 0 });
      bgTo(tw, { sr: 0.13 }, 520, ease.backOut, 200);
      shake(tw, 18);
      hide(day, 60);
      slam(mastN, '', { from: 1.3, rot: 0, dur: 220 });
      slam(big, 'rotate(-90deg)', { from: 1.6, rot: 0, dur: 260 });
    });
    houses.forEach((h, k) =>
      ctx.at(at(gN(0.5)) + k * 134, () => {
        h.classList.add('out');
      }),
    );
    ctx.at(at(gN(1)), () => {
      flicker(label);
      flicker(edgeN, 300);
    });
    ctx.at(at(gN(1.5)), () => {
      t1.run(ctx, 34);
      ctx.audio.sting('type');
    });
    ctx.at(at(gN(2.5)), () => {
      t2.run(ctx, 34);
      ctx.audio.sting('type');
    });
  },
};

const dawn: SceneDef = {
  id: 'dawn',
  label: 'Dawn',
  duration: 11000,
  shots: [{ name: 'dawn', at: 5000 }],
  enter(ctx) {
    const { root: r, tween: tw } = ctx;
    setNight(true);
    r.classList.add('ag-pre');
    bgSet(tw, {
      inv: 1,
      invTo: 0,
      wipe: 0,
      wipeMode: 1,
      sx: 0.69,
      sy: 1.0,
      sr: 0.27,
      sred: 1,
      clip: 0.64,
      tone: 0.3,
    });
    ctx.audio.duck(0.2, 0.2, 1.4, 1.0);
    ctx.audio.sting('dawn', 0.25);
    ctx.audio.setBed('day', 2.5, 1.4);
    const g = grid(ctx, BPM.day, 'day');
    const at = (ms: number) => Math.max(ms, 1500);

    div(r, 'ag-d-horizon');
    const mast = masthead(r, 'MORNING EDITION · DAY 2', 'SUNRISE · FIRST BELL');
    const h1 = div(r, 'ag-d-h1 ag-wait', 'VALE');
    const h2 = div(r, 'ag-d-h2 ag-wait', 'FOUND DEAD');
    const h3 = div(r, 'ag-d-h3 ag-wait', 'THE TOWN’S MENDER DID NOT SEE THE MORNING');
    const obit = div(
      r,
      'ag-d-obit ag-wait',
      `<svg viewBox="-60 -60 120 120" aria-hidden="true"><circle r="50"/><text y="17">05</text><line x1="-58" y1="40" x2="58" y2="-40"/></svg>
       <div><b>05 · VALE</b><span>THE MENDER · TOWN</span><p>FOUND AT FIRST BELL. DOOR UNFORCED. NO SIGN OF A STRUGGLE.</p></div>`,
    );
    const roleCard = div(
      r,
      'ag-d-role ag-wait',
      `<small>THE DECEASED WAS</small><h4>THE MENDER</h4><p>EACH NIGHT, MEND ONE CITIZEN. WHOEVER YOU MEND SEES THE MORNING.</p>`,
    );
    const cols = div(r, 'ag-d-cols ag-wait');
    for (let c = 0; c < 2; c++) {
      const col = div(cols, 'ag-d-col');
      div(col, 'ag-d-col-h', c === 0 ? 'WHO KNEW?' : 'THE TALLY');
      for (let i = 0; i < 7; i++)
        div(col, 'ag-line').style.width = `${68 + ((i * 37 + c * 13) % 32)}%`;
    }
    div(cols, 'ag-d-count', '<b>8</b><span>LIVING</span><b class="red">1</b><span>DEAD</span>');

    ctx.at(250, () => bgTo(tw, { wipe: 1 }, 1300, ease.inOut));
    ctx.at(400, () => bgTo(tw, { sy: 0.6 }, 2600, ease.out));
    ctx.at(900, () => {
      setNight(false);
      r.classList.remove('ag-pre');
    });
    ctx.at(1400, () => {
      slam(mast, '', { from: 1.25, rot: 0, dur: 240 });
      shake(tw, 6);
    });
    ctx.at(at(g(1)), () => slam(h1, '', { from: 2, rot: -5, dur: 280 }));
    ctx.at(at(g(1.5)), () => thrust(h2, '', '-50vw', '0px', 420));
    ctx.at(at(g(2)), () => feed(h3));
    ctx.at(at(g(3)), () => thrust(obit, '', '0px', '30vh', 420));
    ctx.at(at(g(3.5)), () => thrust(roleCard, '', '0px', '30vh', 420));
    ctx.at(at(g(4)), () => flicker(cols, 320));
  },
};

const SEAT_R = 278;
const seatPos = (i: number) => {
  const a = ((-90 + i * 40) * Math.PI) / 180;
  return { x: SEAT_R * Math.cos(a), y: SEAT_R * Math.sin(a), deg: -90 + i * 40 };
};
const VALE = 4;
const ANTON = 2;
const VOTERS = [3, 1, 0, 6, 7];
const CHAT: [string, string][] = [
  ['MIRA', 'Vale healed me two nights ago. Now Vale is dead. Someone knew.'],
  ['KESTREL', 'Anton was out past the second bell. I watched his door.'],
  ['ANTON', 'I was walking. Since when is walking a crime?'],
  ['ORSOLA', 'Since people started dying.'],
  ['BRAM', 'I’m putting Anton up. Let him explain himself on the stand.'],
];

const day: SceneDef = {
  id: 'day',
  label: 'Day',
  duration: 14000,
  shots: [{ name: 'day', at: 8200 }],
  enter(ctx) {
    const { root: r, tween: tw } = ctx;
    setNight(false);
    bgSet(tw, { ...DAY_PAPER, sx: 0.27, sy: 0.5, sr: 0.13, sred: 1, tone: 0.18 });
    ctx.audio.setBed('day', 1.2);
    const g = grid(ctx, BPM.day, 'day');

    const mast = masthead(r, 'DAY 2 · THE SQUARE · OPEN DEBATE', 'EIGHT LIVING · ONE DEAD');
    const ring = div(r, 'ag-ring');
    const s = svg(ring, 'svg', { viewBox: '-500 -500 1000 1000' });
    const wedges = svg(s, 'g', { class: 'ag-wedges' });
    const seatsG = svg(s, 'g');
    const anton = seatPos(ANTON);
    const accRing = svg(seatsG, 'circle', {
      class: 'ag-acc-ring',
      cx: anton.x,
      cy: anton.y,
      r: 80,
    });
    const seatEls = CAST.map((name, i) => {
      const p = seatPos(i);
      const outer = svg(seatsG, 'g', {
        transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`,
      });
      const inner = svg(outer, 'g', { class: `ag-seat ag-wait${i === VALE ? ' ag-dead' : ''}` });
      svg(inner, 'circle', { r: 62 });
      svg(inner, 'text', { class: 'ag-num', y: 29 }, nn(i + 1));
      if (i === VALE) svg(inner, 'line', { x1: -70, y1: 46, x2: 70, y2: -46 });
      const flip = Math.abs(((p.deg + 540) % 360) - 180) > 90 ? 1 : 0;
      const rad = (p.deg * Math.PI) / 180;
      const nx = (SEAT_R + 76) * Math.cos(rad) - p.x;
      const ny = (SEAT_R + 76) * Math.sin(rad) - p.y;
      svg(
        inner,
        'text',
        {
          class: 'ag-name',
          x: nx.toFixed(1),
          y: ny.toFixed(1),
          'text-anchor': flip ? 'end' : 'start',
          transform: `rotate(${flip ? p.deg + 180 : p.deg} ${nx.toFixed(1)} ${ny.toFixed(1)})`,
        },
        name,
      );
      return inner;
    });
    const wedgeEls = VOTERS.map((v) => {
      const p = seatPos(v);
      const dx = anton.x - p.x;
      const dy = anton.y - p.y;
      const L = Math.hypot(dx, dy);
      const gW = svg(wedges, 'g', {
        transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(2)})`,
      });
      return svg(gW, 'polygon', { points: `0,-26 0,26 ${(L - 70).toFixed(1)},0` });
    });
    const stampG = svg(s, 'g', { transform: `translate(${anton.x - 6} ${anton.y + 8})` });
    const stamp = svg(stampG, 'g', { class: 'ag-ring-stamp ag-wait' });
    svg(stamp, 'rect', { x: -215, y: -38, width: 430, height: 76 });
    svg(stamp, 'text', { y: 17 }, 'TO THE STAND');

    const chat = div(r, 'ag-day-chat');
    const rots = [-1.6, 1.2, -0.8, 1.6, -1.2];
    const tapes = CHAT.map(([who, msg], k) =>
      tape(chat, who, msg, who === 'ANTON' ? 'ag-tape-acc' : '', rots[k]),
    );

    const tally = div(
      r,
      'ag-tally',
      `<div class="ag-tally-l">MOTION · No. 03 ANTON TO THE STAND · NEEDS 5</div>
       <div class="ag-tally-n"><b>0</b><span>/8</span></div>`,
    );
    const tallyN = tally.querySelector('b');
    const cells = div(tally, 'ag-cells');
    const cellEls = Array.from({ length: 8 }, (_, k) =>
      div(cells, k === 4 ? 'ag-cell ag-need' : 'ag-cell'),
    );

    ctx.at(0, () => slam(mast, '', { from: 1.2, rot: 0, dur: 220 }));
    seatEls.forEach((el, k) => ctx.at(g(k * 0.25), () => pop(el, '', 300)));
    tapes.forEach((t, k) => ctx.at(g([1, 3, 5, 6.5, 7.5][k] ?? 0), () => t.run(ctx, 80)));
    VOTERS.forEach((v, k) =>
      ctx.at(g(9 + k), () => {
        const w = wedgeEls[k];
        if (w)
          w.animate(
            [
              { transform: 'scaleX(0)' },
              { transform: 'scaleX(1.06)', offset: 0.7 },
              { transform: 'scaleX(1)' },
            ],
            {
              duration: 260,
              easing: 'cubic-bezier(.3,0,.2,1)',
              fill: 'both',
            },
          );
        ctx.audio.sting('vote');
        seatEls[v]?.classList.add('ag-voted');
        accRing.style.strokeWidth = String(6 + k * 5);
        if (tallyN) {
          tallyN.textContent = String(k + 1);
          slam(tallyN, '', { from: 1.6, rot: 0, dur: 200 });
        }
        cellEls[k]?.classList.add('on');
      }),
    );
    ctx.at(g(14), () => {
      slam(stamp, 'rotate(-10deg)', { from: 2.4, rot: -6, dur: 220 });
      ctx.audio.sting('stamp');
      shake(tw, 12);
      tally.classList.add('ag-carried');
    });
  },
};

const BALLOTS: [number, boolean][] = [
  [4, true],
  [2, true],
  [1, true],
  [6, false],
  [7, true],
  [9, false],
  [8, true],
];

const trial: SceneDef = {
  id: 'trial',
  label: 'Trial',
  duration: 14500,
  shots: [
    { name: 'trial', at: 4000 },
    { name: 'verdict', at: 10000 },
  ],
  enter(ctx) {
    const { root: r, tween: tw } = ctx;
    setNight(false);
    bgSet(tw, { ...DAY_PAPER, sx: 0.27, sy: 0.5, sr: 0.31, sred: 1, tone: 0.15 });
    ctx.audio.setBed('trial', 0.4);
    const g = grid(ctx, BPM.trial, 'trial');

    const mast = masthead(r, 'DAY 2 · THE TRIBUNAL · IN SESSION', 'THE ACCUSED · No. 03');
    slam(mast, '', { from: 1.2, rot: 0, dur: 220 });
    const acc = div(r, 'ag-acc ag-wait', '<b>03</b><span>ANTON</span>');
    const ribbon = div(
      r,
      'ag-acc-ribbon ag-wait',
      '<span>ON THE STAND</span><i></i><span>ON THE STAND</span><i></i><span>ON THE STAND</span>',
    );
    const def = div(r, 'ag-tr-def');
    const defLabel = div(def, 'ag-tr-label ag-wait', 'THE DEFENCE · No. 03 SPEAKS');
    const defense = tape(
      def,
      'ANTON',
      'I’m a watcher. I saw Kestrel leave her house last night. Ask her where she went.',
      'ag-tape-acc ag-tape-big',
      -1.5,
    );
    const mk = (cls: string, word: string) => {
      const b = div(
        r,
        `ag-blk ${cls} ag-wait`,
        `<h3>${word}</h3><b class="ag-blk-n">0</b><div class="ag-slots"></div>`,
      );
      return {
        el: b,
        n: b.querySelector<HTMLElement>('.ag-blk-n'),
        slots: b.querySelector<HTMLElement>('.ag-slots'),
      };
    };
    const G = mk('ag-blk-g', 'GUILTY');
    const I = mk('ag-blk-i', 'INNOCENT');
    edge(r, 'THE TRIBUNAL · SEVEN BALLOTS · A SIMPLE MAJORITY CONDEMNS', 'l');

    ctx.at(g(0), () => thrust(acc, '', '34vw', '-24vh', 520));
    ctx.at(g(1), () => {
      ctx.audio.sting('stamp');
      shake(tw, 8);
    });
    ctx.at(g(2), () => feed(ribbon, 'rotate(-14deg)', 420));
    ctx.at(g(3), () => {
      flicker(defLabel);
      defense.run(ctx, 52);
    });
    ctx.at(g(6), () => slam(G.el, '', { from: 1.4, rot: -3, dur: 260 }));
    ctx.at(g(6.5), () => slam(I.el, '', { from: 1.4, rot: 3, dur: 260 }));
    const counts = { g: 0, i: 0 };
    BALLOTS.forEach(([seat, guilty], k) =>
      ctx.at(g(10 + k), () => {
        const blk = guilty ? G : I;
        const n = guilty ? ++counts.g : ++counts.i;
        const b = div(
          blk.slots,
          'ag-ballot',
          `<i>${nn(seat)}</i><span>${CAST[seat - 1] ?? ''}</span>`,
        );
        const rot = ((k * 37) % 9) - 4;
        slam(b, `rotate(${rot}deg)`, { from: 2.2, rot: rot * 2, dur: 200 });
        if (blk.n) {
          blk.n.textContent = String(n);
          slam(blk.n, '', { from: 1.5, rot: 0, dur: 200 });
        }
        ctx.audio.sting('ballot');
        shake(tw, 3, 250);
      }),
    );
    ctx.at(g(20), () => {
      ctx.audio.setBed(null, 0.06);
      ctx.audio.sting('verdict');
      const v = div(
        r,
        'ag-verdict',
        `<div class="ag-v-box ag-ink"><div class="ag-v-word">GUILTY</div><div class="ag-v-sub">FIVE TO TWO · THE TOWN HAS SPOKEN</div></div>`,
      );
      slam(v, 'translate(-50%, -50%) rotate(-11deg)', { from: 3, rot: -9, dur: 210 });
      shake(tw, 34, 1000);
      I.el.classList.add('ag-lost');
      G.el.classList.add('ag-won');
      bgSet(tw, { sr: 0.37, inv: 1 });
      bgTo(tw, { sr: 0.31 }, 700, ease.out);
      window.setTimeout(() => bgSet(tw, { inv: 0 }), 70);
      ctx.at(ctx.elapsed() + 4200, () => ctx.audio.setBed('dirge', 3));
    });
  },
};

function shardPolys(R: number, seed: number): [number, number][][] {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const cuts: number[] = [];
  let a = rnd() * 0.6;
  while (a < Math.PI * 2 - 0.3) {
    cuts.push(a);
    a += 0.55 + rnd() * 0.75;
  }
  const out: [number, number][][] = [];
  const arc = (rad: number, a0: number, a1: number, n: number) =>
    Array.from({ length: n + 1 }, (_, k): [number, number] => {
      const t = a0 + ((a1 - a0) * k) / n;
      return [rad * Math.cos(t), rad * Math.sin(t)];
    });
  cuts.forEach((a0, k) => {
    const a1 = cuts[k + 1] ?? cuts[0]! + Math.PI * 2;
    const rm = R * (0.38 + rnd() * 0.3);
    const mid = a0 + (a1 - a0) * (0.35 + rnd() * 0.3);
    out.push([[0, 0], ...arc(rm, a0, a1, 3)]);
    out.push([...arc(R + 30, a0, mid, 3), ...arc(rm, mid, a0, 2)]);
    out.push([...arc(R + 30, mid, a1, 3), ...arc(rm, a1, mid, 2)]);
  });
  return out;
}

const execution: SceneDef = {
  id: 'execution',
  label: 'Execution',
  duration: 13000,
  shots: [{ name: 'execution', at: 5000 }],
  enter(ctx) {
    const { root: r, tween: tw } = ctx;
    setNight(false);
    bgSet(tw, { ...DAY_PAPER, sx: 0.27, sy: 0.47, sr: 0.31, sred: 0, tone: 0.2 });
    if (ctx.audio.bedClock()?.name === 'dirge') ctx.audio.duck(0.15, 0.05, 2.6, 2.5);
    else {
      ctx.audio.setBed(null, 0.4);
      ctx.at(3400, () => ctx.audio.setBed('dirge', 2.5));
    }
    ctx.audio.sting('death', 0.55);

    const mast = masthead(
      r,
      'DAY 2 · EVENING · SENTENCE CARRIED OUT',
      'No. 03 · STRUCK FROM THE ROLL',
    );
    slam(mast, '', { from: 1.2, rot: 0, dur: 220 });
    const stage = div(r, 'ag-x-stage');
    const s = svg(stage, 'svg', { viewBox: '-500 -500 1000 1000' });
    const id = uid('disc');
    const defs = svg(s, 'defs');
    const content = svg(defs, 'g', { id });
    const R = 225;
    svg(content, 'circle', { class: 'ag-x-disc', r: R });
    svg(content, 'text', { class: 'ag-x-num', y: 105 }, '03');
    svg(content, 'text', { class: 'ag-x-name', y: 170 }, 'ANTON');
    svg(s, 'rect', { class: 'ag-x-floor', x: -470, y: 396, width: 940, height: 12 });
    const whole = svg(s, 'use', { href: `#${id}`, class: 'ag-x-whole' });
    const polys = shardPolys(R, 9);
    const shards = polys.map((pts, k) => {
      const cid = `${id}-c${k}`;
      const cp = svg(defs, 'clipPath', { id: cid });
      svg(cp, 'polygon', {
        points: pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' '),
      });
      const outer = svg(s, 'g', { class: 'ag-shard' });
      const inner = svg(outer, 'g', { 'clip-path': `url(#${cid})` });
      svg(inner, 'use', { href: `#${id}` });
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
      const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      const maxd = Math.max(
        ...pts.map(([x, y]) => {
          const d = Math.hypot(x, y);
          const f = d > R + 9 ? (R + 9) / d : 1;
          return Math.hypot(x * f - cx, y * f - cy);
        }),
      );
      return { el: outer, cx, cy, maxd };
    });
    const barG = svg(s, 'g', { transform: 'rotate(-28)' });
    const bar = svg(barG, 'rect', {
      class: 'ag-x-bar ag-wait',
      x: -490,
      y: -36,
      width: 980,
      height: 72,
    });

    const col = div(r, 'ag-x-col');
    const h = div(col, 'ag-x-h ag-wait', 'EXECUTED');
    const who = div(col, 'ag-x-who ag-wait', '<b>03</b><span>ANTON</span>');
    const roleEl = div(
      col,
      'ag-x-role ag-wait',
      '<small>ROLE REVEALED</small><b>THE SABOTEUR</b><span>MAFIA · DECEPTION</span>',
    );
    const mafia = div(roleEl, 'ag-x-mafia ag-ink ag-wait', 'MAFIA');
    const words = tape(col, 'ANTON', 'You’ll miss me when the lamps go out.', 'ag-tape-big', -1.5);
    const will = div(
      r,
      'ag-x-will ag-wait',
      '<small>LAST WILL, FOUND IN HIS COAT</small><p>KESTREL LEFT HER HOUSE AT THE SECOND BELL. I SAW IT. WATCH HER. —A.</p>',
    );

    pop(whole, '', 260);
    ctx.at(550, () => {
      bar.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
        duration: 170,
        easing: 'cubic-bezier(.7,0,.9,.4)',
        fill: 'both',
      });
      bar.classList.remove('ag-wait');
      shake(tw, 24, 800);
      bgSet(tw, { inv: 1 });
      window.setTimeout(() => bgSet(tw, { inv: 0 }), 70);
    });
    ctx.at(1350, () => {
      whole.style.visibility = 'hidden';
      let sd = 5;
      const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
      for (const sh of shards) {
        const len = Math.hypot(sh.cx, sh.cy) || 1;
        const ux = sh.cx / len;
        const uy = sh.cy / len;
        const land = 394 - sh.maxd * 0.72 - rnd() * 16;
        const dx = ux * (90 + rnd() * 170);
        const dy = land - sh.cy;
        const rot = (rnd() - 0.5) * 300;
        sh.el.style.visibility = 'visible';
        sh.el.animate(
          [
            { transform: 'translate(0px,0px) rotate(0deg)', easing: 'cubic-bezier(.2,.8,.4,1)' },
            {
              transform: `translate(${ux * 34}px,${uy * 34 - 30}px) rotate(${rot * 0.12}deg)`,
              offset: 0.16,
              easing: 'cubic-bezier(.5,0,1,.6)',
            },
            {
              transform: `translate(${dx}px,${dy}px) rotate(${rot}deg)`,
              offset: 0.82,
              easing: 'ease-out',
            },
            {
              transform: `translate(${dx * 1.04}px,${dy - 14}px) rotate(${rot * 1.03}deg)`,
              offset: 0.9,
              easing: 'ease-in',
            },
            { transform: `translate(${dx * 1.06}px,${dy}px) rotate(${rot * 1.04}deg)` },
          ],
          { duration: 1150 + rnd() * 450, delay: rnd() * 90, fill: 'both' },
        );
      }
      shake(tw, 10, 400);
    });
    ctx.at(2300, () => slam(h, '', { from: 2.2, rot: -4, dur: 260 }));
    ctx.at(2750, () => thrust(who, '', '30vw', '0px', 420));
    ctx.at(3250, () => {
      thrust(roleEl, '', '0px', '20vh', 420);
    });
    ctx.at(3650, () => {
      slam(mafia, 'rotate(-12deg)', { from: 2.6, rot: -8, dur: 200 });
      ctx.audio.sting('stamp');
      shake(tw, 10);
    });
    ctx.at(3950, () => words.run(ctx, 70));
    ctx.at(4400, () => snap(will, '', 18, 420));
  },
};

export const SCENES: SceneDef[] = [title, role, nightfall, dawn, day, trial, execution];
