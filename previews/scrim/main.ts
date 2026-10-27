import '@fontsource/old-standard-tt/400.css';
import '@fontsource/old-standard-tt/400-italic.css';
import '@fontsource/old-standard-tt/700.css';
import '@fontsource/homemade-apple/400.css';
import '../shared/portrait.css';
import { shaderLayer } from '../shared/gl.ts';
import { createPreview, el, type SceneCtx, type SceneDef } from '../shared/harness.ts';
import type { Portrait } from '../shared/portrait.ts';
import { loadImages } from '../shared/samples.ts';
import { ease } from '../shared/tween.ts';
import { scrimScore } from './score.ts';
import { SCRIM_FRAG } from './shader.ts';
import {
  APRON,
  closeup,
  filmGrain,
  IMG,
  Shade,
  type Close,
  type CloseOptions,
  type Pose,
  type ShadeOptions,
} from './stage.ts';
import './style.css';

const CAST = [
  'Orsola',
  'Kestrel',
  'Anton',
  'Mira',
  'Vale',
  'Ilse',
  'Bram',
  'Juniper',
  'Teodor',
] as const;
type Name = (typeof CAST)[number];
const BODY: Record<Name, { pose: Pose; h: number }> = {
  Orsola: { pose: 'standw', h: 0.98 },
  Kestrel: { pose: 'standw', h: 1 },
  Anton: { pose: 'stand', h: 1.03 },
  Mira: { pose: 'standw', h: 0.95 },
  Vale: { pose: 'stand', h: 0.99 },
  Ilse: { pose: 'standw', h: 1.01 },
  Bram: { pose: 'stand', h: 1.07 },
  Juniper: { pose: 'standw', h: 0.92 },
  Teodor: { pose: 'stand', h: 0.97 },
};

const pv = createPreview({
  slug: 'scrim',
  name: 'Scrim',
  score: scrimScore,
  exitMs: 450,
  gate(g) {
    g.innerHTML = `
      <div class="gate-frame">
        <div class="it-k">Vesper &middot; a shadow play in seven reels</div>
        <h1 class="gate-title">Scrim</h1>
        <p class="gate-sub">faces, bodies &amp; a lamp behind the cloth</p>
        <button data-begin class="gate-btn">Light the lamp</button>
        <div class="gate-load"><i></i><span data-progress>0%</span></div>
        <p class="gate-hint">sound on &middot; voices &amp; body percussion</p>
      </div>`;
  },
  preload: (onProgress) => loadImages(Object.values(IMG), onProgress),
});

const gl = shaderLayer(pv.bg, SCRIM_FRAG, { scale: 0.8, maxDpr: 1.5 });
const grain = filmGrain(pv.fx);
pv.stage.append(el('div', 'vig'));
const T = pv.tween;
const U = {
  lamp: 0,
  hotX: 0.5,
  hotY: 0.55,
  hotR: 0.26,
  cold: 0,
  dawn: 0,
  ember: 0,
  flicker: 0.3,
  glow: 0,
  film: 0.3,
};
type Key = keyof typeof U;
for (const [k, v] of Object.entries(U)) T.set(k, v);

/** Tween the cloth and its lamp (shader uniforms) towards a look. */
const look = (vals: Partial<Record<Key, number>>, ms = 1500, e = ease.inOut) => {
  for (const [k, v] of Object.entries(vals)) T.to(k, v, ms, e);
};

let glowAt: [number, number] = [0.5, 0.5];
let hook: (() => void) | null = null;
pv.onFrame((now) => {
  hook?.();
  const g = (k: Key) => T.get(k);
  gl.render(now / 1000, {
    uLamp: g('lamp'),
    uHot: [g('hotX'), g('hotY'), g('hotR')],
    uCold: g('cold'),
    uDawn: g('dawn'),
    uEmber: g('ember'),
    uFlicker: g('flicker'),
    uGlow: [glowAt[0], 1 - glowAt[1], g('glow')],
    uFloor: APRON,
  });
  grain.draw(g('film'));
});

// --- scene kit ---------------------------------------------------------------------------

interface Kit {
  ctx: SceneCtx;
  at(ms: number, fn: () => void): void;
  shadows: HTMLElement;
  over: HTMLElement;
  shade(poses: readonly Pose[], o: ShadeOptions): Shade;
  face(name: Name, o?: CloseOptions): Close;
  /** A film shot (hidden until cut to): a picture area holding the given children. */
  shot(cls: string, ...children: (HTMLElement | string)[]): HTMLElement;
  /** Hard cut to a film shot, or back to the scrim with null. */
  cut(ms: number, shot: HTMLElement | null, o?: { sting?: boolean; then?: () => void }): void;
  /** Names painted on the apron under each body. */
  names(xs: Partial<Record<Name, number>>): Partial<Record<Name, HTMLElement>>;
}

function scene(
  id: string,
  label: string,
  duration: number,
  shots: { name: string; at: number }[],
  body: (k: Kit) => void,
): SceneDef {
  return {
    id,
    label,
    duration,
    shots,
    enter(ctx) {
      const portraits: Portrait[] = [];
      const shadows = el('div', 'shadows');
      const over = el('div', 'over');
      const film = el('div', 'film');
      ctx.root.append(shadows, over, film);
      T.set('film', 0.3);
      T.set('glow', 0);
      const doCut = (shot: HTMLElement | null, o: { sting?: boolean; then?: () => void }) => {
        film.querySelectorAll('.shot.live').forEach((s) => s.classList.remove('live'));
        if (shot) shot.classList.add('live');
        film.classList.toggle('on', !!shot);
        T.set('film', shot ? 1 : 0.3);
        if (o.sting) ctx.audio.sting('cut');
        o.then?.();
      };
      const k: Kit = {
        ctx,
        shadows,
        over,
        at: (ms, fn) => ctx.at(ms, fn),
        shade: (poses, o) => new Shade(shadows, poses, o),
        face(name, o) {
          const c = closeup(name.toLowerCase(), o);
          portraits.push(c.p);
          return c;
        },
        shot(cls, ...children) {
          const s = el('div', `shot ${cls}`);
          const pic = el('div', 'pic');
          for (const c of children) {
            if (typeof c === 'string') pic.insertAdjacentHTML('beforeend', c);
            else pic.append(c);
          }
          s.append(pic);
          film.append(s);
          return s;
        },
        cut(ms, shot, o = {}) {
          if (ms <= 0) doCut(shot, o);
          else ctx.at(ms, () => doCut(shot, o));
        },
        names(xs) {
          const out: Partial<Record<Name, HTMLElement>> = {};
          for (const [n, x] of Object.entries(xs) as [Name, number][]) {
            const e = el('div', 'nm', n);
            e.style.left = `${x}%`;
            ctx.root.append(e);
            out[n] = e;
          }
          return out;
        },
      };
      body(k);
      return () => {
        hook = null;
        portraits.forEach((p) => p.dispose());
      };
    },
  };
}

const words = (s: string, start = 0, step = 90) =>
  s
    .split(' ')
    .map((w, i) => `<span class="w" style="--wd:${start + i * step}ms">${w}</span>`)
    .join(' ');

/** An intertitle panel: white type on black inside a thin double rule. */
const txt = (who: string | null, html: string, cls = '') =>
  `<div class="txt ${cls}"><div class="frame">${who ? `<div class="who">${who}</div>` : ''}<p class="it">${html}</p></div></div>`;

// --- scenes ------------------------------------------------------------------------------

const ROW9 = [10, 20, 30, 40, 50, 60, 70, 80, 90];

const title = scene('title', 'Overture', 13000, [{ name: 'title', at: 9300 }], (k) => {
  look(
    {
      lamp: 0,
      hotX: 0.5,
      hotY: 0.56,
      hotR: 0.27,
      cold: 0,
      dawn: 0,
      ember: 0,
      flicker: 0.3,
    },
    0,
  );
  k.ctx.audio.setBed('title', 2.5);
  k.at(350, () => {
    k.ctx.audio.sting('lamp');
    T.to('lamp', 1.4, 220, ease.out);
    T.set('flicker', 1.4);
  });
  k.at(600, () => {
    T.to('lamp', 1, 1800, ease.out);
    T.to('flicker', 0.35, 2600);
  });
  const dancer = k.shade(['dance'], { x: -16, z: 0.9, h: 1.05 });
  k.at(1250, () => {
    dancer.el.classList.add('leap');
    dancer.go({ x: 118, z: 0.04 }, 2800, 'linear');
  });
  const card = k.shot(
    'card',
    `<div class="frame">
      <div class="it-k">a shadow play in seven reels</div>
      <div class="it-title">Vesper</div>
      <div class="it-orn">&#10022;</div>
      <div class="it-k">nine villagers &middot; one lamp &middot; one liar</div>
    </div>`,
  );
  k.cut(4100, card, { sting: true });
  const row: Shade[] = [];
  k.at(6700, () => {
    CAST.forEach((n, i) => {
      row.push(
        k.shade([BODY[n].pose], {
          x: ROW9[i] ?? 50,
          h: BODY[n].h,
          flip: i > 4,
          z: i % 3 === 1 ? 0.05 : 0,
          sway: i * 0.9,
        }),
      );
    });
    k.names(Object.fromEntries(CAST.map((n, i) => [n, ROW9[i] ?? 50])));
  });
  k.cut(6900, null, { sting: true });
  const line = el(
    'div',
    'shadow-line',
    'Nine villagers. One lamp. <span>Somebody here is lying.</span>',
  );
  k.over.append(line);
  k.at(7300, () => line.classList.add('on'));
  k.at(10100, () => row[2]?.flip(true));
  k.at(10900, () => row[5]?.go({ z: 0.14 }, 1400));
  k.at(11600, () => row[2]?.flip(false));
});

const role = scene('role', 'The part', 11000, [{ name: 'role', at: 5200 }], (k) => {
  look(
    { lamp: 0.55, hotX: 0.32, hotY: 0.5, hotR: 0.22, cold: 0.15, dawn: 0, ember: 0, flicker: 0.4 },
    900,
  );
  k.ctx.audio.setBed('title', 2);
  T.set('lx', -10);
  T.set('lz', 0.1);
  const man = k.shade(['lantern'], { x: -10, h: 1.08, z: 0.1 });
  hook = () => {
    man.x = T.get('lx');
    man.z = T.get('lz');
    man.place(0);
    glowAt = man.stagePoint(0.79, 0.29);
  };
  look({ glow: 0.85 }, 700);
  k.at(150, () => {
    man.walk(true);
    T.to('lx', 30, 3000, (t) => 1 - (1 - t) ** 2);
  });
  k.at(3150, () => {
    man.walk(false);
    k.ctx.audio.sting('lamp');
    T.to('lz', 0.24, 1000, ease.out);
    look({ glow: 1.8, lamp: 0.85, hotX: 0.38 }, 1000, ease.out);
  });
  const card = el(
    'div',
    'placard',
    `<div class="frame">
      <div class="it-k">the part you are dealt</div>
      <div class="it-role">The Lamplighter</div>
      <div class="it-k it-town">Town &middot; Investigative</div>
      <div class="it-orn">&#10022;</div>
      <p class="it-body">Each night, watch another player&rsquo;s door and learn who visited them.</p>
    </div>`,
  );
  k.over.append(card);
  k.at(3800, () => {
    card.classList.add('on');
    k.ctx.audio.sting('cut');
  });
});

const nightfall = scene('nightfall', 'Nightfall', 12500, [{ name: 'nightfall', at: 8300 }], (k) => {
  look({ lamp: 0.9, hotX: 0.5, hotY: 0.58, hotR: 0.24, cold: 0, dawn: 0, ember: 0 }, 300);
  k.at(250, () => look({ cold: 1, lamp: 0.66, hotR: 0.21, flicker: 0.18 }, 3200));
  k.ctx.audio.sting('dusk', 0.2);
  k.ctx.audio.setBed('night', 3, 0.6);
  const anton = k.shade(['stand'], { x: 16, h: 1.03 });
  const ilse = k.shade(['standw'], { x: 84, flip: true, h: 1.01 });
  const pair = k.shade(['whisper'], { x: 50, dim: 0, h: 1.03 });
  k.at(450, () => {
    anton.walk(true).go({ x: 43.5 }, 2600, 'cubic-bezier(.3,0,.6,1)');
    ilse.walk(true).go({ x: 56.5 }, 2600, 'cubic-bezier(.3,0,.6,1)');
  });
  k.at(3100, () => {
    anton.walk(false).go({ dim: 0 }, 380);
    ilse.walk(false).go({ dim: 0 }, 380);
    pair.go({ dim: 1 }, 380);
  });

  const f1 = k.face('Ilse', { v: 'speak', z: 2.25, ax: 0.36, ay: 0.5, push: true });
  const s1 = k.shot('full', f1.el);
  k.cut(4100, s1, { sting: true, then: () => f1.p.talk(900) });
  const c1 = k.shot(
    'card',
    `<div class="frame"><div class="who">Ilse</div><p class="it">&ldquo;Vale. Tonight.&rdquo;</p></div>`,
  );
  k.cut(5100, c1);
  const f2 = k.face('Anton', { z: 2.35, ax: 0.64, ay: 0.5, push: true });
  const s2 = k.shot('full', f2.el);
  k.cut(6200, s2, { sting: true, then: () => f2.p.talk(900) });
  const dI = k.face('Ilse', { z: 1.95, ax: 0.6, ay: 0.52 });
  const dA = k.face('Anton', { z: 1.95, ax: 0.4, ay: 0.52 });
  const dip = k.shot(
    'split cap',
    dI.el,
    dA.el,
    `<div class="capline"><span class="who">Anton</span>&ldquo;The healer goes first.&rdquo;</div>`,
  );
  k.cut(7300, dip, { sting: true, then: () => dA.p.talk(1500) });
  k.cut(10100, null, {
    then: () => {
      pair.go({ dim: 0 }, 300);
      anton.flip(true).go({ dim: 1 }, 300).walk(true);
      ilse.flip(false).go({ dim: 1 }, 300).walk(true);
      k.at(350, () => {
        anton.go({ x: -12 }, 2600, 'linear');
        ilse.go({ x: 112 }, 2600, 'linear');
      });
    },
  });
});

const dawn = scene('dawn', 'Dawn', 11500, [{ name: 'dawn', at: 5600 }], (k) => {
  look(
    { lamp: 0.42, hotX: 0.5, hotY: 0.3, hotR: 0.3, cold: 1, dawn: 0, ember: 0, flicker: 0.1 },
    0,
  );
  k.at(150, () => look({ cold: 0.12, dawn: 1, lamp: 0.95, hotY: 0.56 }, 3800, ease.out));
  k.ctx.audio.setBed('lament', 3, 0.8);
  k.ctx.audio.sting('dawn', 0.2);
  k.shade(['standw'], { x: 17, z: 0.45, dim: 0.75, sway: 2 });
  k.shade(['lie'], { x: 44, h: 0.99 });
  const mourner = k.shade(['grieve'], { x: 60.5, h: 0.95, sway: 1 });
  const vale = k.face('Vale', {
    v: 'closed',
    blink: false,
    z: 2.05,
    ax: 0.5,
    ay: 0.52,
    push: true,
    cls: 'still',
  });
  k.cut(2700, k.shot('full', vale.el), { sting: true });
  const vale2 = k.face('Vale', {
    v: 'closed',
    blink: false,
    z: 1.8,
    ax: 0.56,
    ay: 0.53,
    cls: 'still',
  });
  const combo = k.shot(
    'combo',
    vale2.el,
    `<div class="txt"><div class="frame">
      <p class="it">Vale did not wake.</p>
      <div class="it-orn">&#10022;</div>
      <div class="it-k">Vale was</div>
      <div class="it-role">the Mender</div>
      <div class="it-k">Town &middot; the healer</div>
    </div></div>`,
  );
  k.cut(4300, combo, { sting: true });
  const comer = k.shade(['stand'], { x: 108, flip: true, h: 0.97 });
  k.cut(7900, null, {
    then: () => {
      comer.walk(true).go({ x: 78 }, 2200, 'cubic-bezier(.2,0,.5,1)');
      k.at(2200, () => comer.walk(false));
      mourner.go({ z: 0.06 }, 3000);
    },
  });
});

const LINES: [Name, string, number, number][] = [
  ['Mira', 'Vale healed me two nights ago. Now Vale is dead. Someone knew.', 700, 1700],
  ['Kestrel', 'Anton was out past the second bell. I watched his door.', 2400, 1400],
  ['Anton', 'I was walking. Since when is walking a crime?', 4300, 1300],
  ['Orsola', 'Since people started dying.', 5600, 900],
  ['Bram', 'I&rsquo;m putting Anton up. Let him explain himself on the stand.', 6500, 1300],
];
const VOTERS: Name[] = ['Bram', 'Kestrel', 'Mira', 'Orsola', 'Juniper'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

const day = scene('day', 'The square', 15000, [{ name: 'day', at: 11000 }], (k) => {
  look(
    { lamp: 1, hotX: 0.4, hotY: 0.56, hotR: 0.33, cold: 0, dawn: 0.3, ember: 0, flicker: 0.25 },
    900,
  );
  k.ctx.audio.setBed('day', 1.5);
  const X: Partial<Record<Name, number>> = {
    Orsola: 4,
    Juniper: 11,
    Mira: 18,
    Teodor: 25,
    Kestrel: 32,
    Ilse: 39.5,
    Bram: 47,
    Anton: 59.5,
  };
  const sh: Partial<Record<Name, Shade>> = {};
  for (const [n, x] of Object.entries(X) as [Name, number][]) {
    const extra: Pose[] =
      n === 'Bram' ? ['point'] : n === 'Anton' ? ['recoil'] : VOTERS.includes(n) ? ['vote'] : [];
    sh[n] = k.shade([BODY[n].pose, ...extra], {
      x,
      h: BODY[n].h * 0.92,
      flip: n === 'Anton',
      turn: ['recoil'],
      sway: x / 9,
    });
  }
  const nm = k.names(X);

  const shots = LINES.map(([n, line], i) => {
    const f = k.face(n, {
      z: 1.85,
      ax: i % 2 ? 0.44 : 0.56,
      ay: 0.53,
      v: n === 'Anton' ? 'afraid' : 'neutral',
    });
    const s = k.shot(i % 2 ? 'combo rev' : 'combo', f.el, txt(n, `&ldquo;${line}&rdquo;`));
    return { f, s };
  });
  const orsolaSplit = (() => {
    const o = k.face('Orsola', { z: 1.95, ax: 0.58, ay: 0.52 });
    const a = k.face('Anton', { v: 'afraid', z: 1.95, ax: 0.42, ay: 0.52 });
    const s = k.shot(
      'split cap',
      o.el,
      a.el,
      `<div class="capline"><span class="who">Orsola</span>&ldquo;Since people started dying.&rdquo;</div>`,
    );
    return { o, a, s };
  })();
  const flinchA = k.face('Anton', { v: 'afraid', z: 2.6, ax: 0.62, ay: 0.5 });
  const flinchShot = k.shot('full', flinchA.el);

  LINES.forEach(([n, , at, dur], i) => {
    const sh0 = shots[i];
    if (!sh0) return;
    if (n === 'Orsola') {
      k.cut(at, orsolaSplit.s, {
        sting: true,
        then: () => {
          orsolaSplit.o.p.talk(dur);
          orsolaSplit.a.p.flinch();
        },
      });
      return;
    }
    k.cut(at, sh0.s, { sting: true, then: () => sh0.f.p.talk(dur) });
  });
  k.cut(3850, flinchShot, { sting: true, then: () => flinchA.p.flinch() });

  const inset = el('div', 'inset');
  const ia = k.face('Anton', { v: 'afraid', z: 1.9, ax: 0.5, ay: 0.5 });
  inset.append(
    ia.el,
    el('div', 'tally', '<span class="t-k">to the stand</span><span class="t-n">&ndash;</span>'),
  );
  k.over.append(inset);
  k.cut(7900, null, {
    sting: true,
    then: () => {
      inset.classList.add('on');
      sh.Bram?.pose('point', 200);
      sh.Bram?.go({ z: 0.06 }, 400);
    },
  });
  k.at(8150, () => {
    sh.Anton?.pose('recoil', 220);
    ia.p.flinch();
  });
  VOTERS.forEach((n, i) => {
    k.at(8400 + i * 430, () => {
      if (n !== 'Bram') sh[n]?.pose('vote', 200);
      nm[n]?.classList.add('hot');
      const t = inset.querySelector('.t-n');
      if (t) t.textContent = ROMAN[i] ?? '';
      ia.p.flinch();
      k.ctx.audio.sting('vote');
    });
  });
  k.at(9000, () => sh.Ilse?.flip(true));
  k.at(9400, () => sh.Teodor?.go({ z: 0.09, dim: 0.8 }, 900));
  k.at(10400, () => inset.classList.add('summoned'));

  const t1 = k.face('Ilse', { v: 'afraid', z: 1.95, ax: 0.5, ay: 0.52 });
  const t2 = k.face('Anton', { v: 'afraid', z: 1.9, ax: 0.5, ay: 0.52 });
  const t3 = k.face('Teodor', { v: 'closed', blink: false, z: 1.95, ax: 0.5, ay: 0.52 });
  const tri = k.shot('tri', t1.el, t2.el, t3.el);
  k.cut(11700, tri, { sting: true, then: () => t2.p.flinch() });
  k.at(12900, () => t1.p.show('closed', 200));
  k.at(13300, () => t1.p.show('afraid', 300));
});

const DEFENCE =
  'I&rsquo;m a watcher. I saw Kestrel leave her house last night. Ask her where she went.';
const BALLOTS: [Name, boolean][] = [
  ['Bram', true],
  ['Ilse', false],
  ['Mira', true],
  ['Kestrel', true],
  ['Teodor', false],
  ['Orsola', true],
  ['Juniper', true],
];
const POLY: Name[] = ['Bram', 'Ilse', 'Mira', 'Anton', 'Kestrel', 'Teodor', 'Orsola', 'Juniper'];

const trial = scene(
  'trial',
  'The trial',
  17000,
  [
    { name: 'trial', at: 4600 },
    { name: 'verdict', at: 11200 },
  ],
  (k) => {
    look(
      {
        lamp: 0.85,
        hotX: 0.5,
        hotY: 0.56,
        hotR: 0.2,
        cold: 0,
        dawn: 0,
        ember: 0.24,
        flicker: 0.35,
      },
      600,
    );
    k.ctx.audio.setBed('trial', 1);
    const a = k.face('Anton', { v: 'afraid', z: 2.1, ax: 0.58, ay: 0.5, push: true });
    const def = k.shot(
      'combo rev wide',
      a.el,
      txt('Anton, on the stand', `&ldquo;${words(DEFENCE, 400, 115)}&rdquo;`, 'long'),
    );
    k.cut(0, def, { then: () => a.p.talk(2300) });
    k.at(1500, () => a.p.flinch());
    k.at(2900, () => a.p.talk(1100));

    const L = [9, 18, 27, 36];
    const R = [64, 73, 82];
    const others: Name[] = ['Bram', 'Ilse', 'Mira', 'Kestrel', 'Teodor', 'Orsola', 'Juniper'];
    const crowd = others.map((n, i) =>
      k.shade([BODY[n].pose], {
        x: i < 4 ? (L[i] ?? 10) : (R[i - 4] ?? 90),
        h: BODY[n].h * 0.94,
        flip: i >= 4,
        dim: 0.85,
        z: i % 2 ? 0.05 : 0,
      }),
    );
    const accused = k.shade(['stand', 'kneel'], { x: 50, h: 1.06 });
    k.cut(5300, null, { sting: true });
    k.at(5550, () => {
      accused.pose('kneel', 420);
      k.ctx.audio.sting('stomp');
    });

    const panels = new Map<Name, { wrap: HTMLElement; c: Close }>();
    const rowEl = el('div', 'pp-row');
    for (const n of POLY) {
      const isA = n === 'Anton';
      const c = k.face(n, {
        v: isA ? 'afraid' : 'neutral',
        z: isA ? 1.75 : 2.55,
        ax: 0.5,
        ay: isA ? 0.5 : 0.48,
        blink: true,
      });
      const wrap = el('div', `pp${isA ? ' accused' : ''}`);
      wrap.append(c.el, el('div', 'vl', isA ? 'the accused' : '&nbsp;'));
      rowEl.append(wrap);
      panels.set(n, { wrap, c });
    }
    const poly = k.shot(
      'poly',
      rowEl,
      `<div class="verdict"><div class="v-pre it-k">the village votes</div><div class="v-word">Guilty</div><div class="v-sub it-k">five to two</div></div>`,
    );
    k.cut(6300, poly, { sting: true });
    const antonP = panels.get('Anton')?.c.p;
    BALLOTS.forEach(([n, guilty], i) => {
      k.at(6700 + i * 480, () => {
        const pnl = panels.get(n);
        if (!pnl) return;
        pnl.wrap.classList.add('cast', guilty ? 'g' : 'i');
        const vl = pnl.wrap.querySelector('.vl');
        if (vl) vl.textContent = guilty ? 'guilty' : 'innocent';
        if (guilty) {
          pnl.c.p.talk(260);
          antonP?.flinch();
        } else pnl.c.p.show('closed', 120);
        k.ctx.audio.sting(guilty ? 'stomp' : 'snap');
      });
    });
    k.at(10200, () => {
      poly.classList.add('judged');
      k.ctx.audio.setBed(null, 0.3);
      k.ctx.audio.sting('verdict');
      antonP?.flinch();
      T.set('flicker', 1.2);
    });
    k.at(12100, () => antonP?.show('closed', 500));
    k.cut(13300, null, {
      sting: true,
      then: () => {
        look({ ember: 0.4, lamp: 0.7, hotR: 0.17 }, 1500);
        crowd.forEach((c, i) => k.at(i * 140, () => c.flip(i < 4 ? true : false)));
      },
    });
    k.at(13500, () => k.ctx.audio.setBed('lament', 3));
  },
);

const execution = scene('execution', 'Curtain', 14000, [{ name: 'execution', at: 7600 }], (k) => {
  look(
    { lamp: 0.95, hotX: 0.5, hotY: 0.55, hotR: 0.22, cold: 0, dawn: 0, ember: 0.38, flicker: 0.45 },
    500,
  );
  k.ctx.audio.setBed('lament', 1.5);
  const f = k.face('Anton', { v: 'speak', z: 2.0, ax: 0.44, ay: 0.5, push: true });
  const last = k.shot(
    'combo',
    f.el,
    txt('his last words', '&ldquo;You&rsquo;ll miss me when the lamps go out.&rdquo;'),
  );
  k.cut(0, last, { then: () => f.p.talk(2000) });
  k.shade(['standw'], { x: 14, z: 0.32, dim: 0.55, sway: 1 });
  k.shade(['stand'], { x: 86, z: 0.32, dim: 0.55, flip: true, sway: 3 });
  const a = k.shade(['stand', 'fall', 'lie'], { x: 50, h: 1.2 });
  k.cut(2700, null, { sting: true });
  k.at(2900, () => {
    a.walk(true).go({ z: 0.85 }, 1500, 'cubic-bezier(.4,0,.4,1)');
    look({ hotR: 0.26, lamp: 1.05 }, 1500);
  });
  k.at(4400, () => {
    a.walk(false);
    T.set('flicker', 1.5);
  });
  k.at(5100, () => {
    a.pose('fall', 150).go({ z: 0.1 }, 700, 'cubic-bezier(.6,0,.9,.5)');
    k.ctx.audio.sting('fall');
    T.set('flicker', 1.8);
  });
  k.at(5800, () => {
    a.pose('lie', 200).go({ z: 0.01 }, 180);
    k.ctx.audio.sting('death');
    look({ lamp: 0.66, flicker: 1.3, ember: 0.46, hotY: 0.3, hotR: 0.24 }, 1500, ease.out);
  });
  const reveal = el(
    'div',
    'placard reveal',
    `<div class="frame">
      <div class="it-k">Anton was</div>
      <div class="it-role">the Hatchet</div>
      <div class="it-k it-town">of the Syndicate</div>
    </div>`,
  );
  const will = el('div', 'will', '<b>his last will</b>Light the lamps for me. I&nbsp;never could.');
  k.over.append(reveal, will);
  k.at(6300, () => {
    reveal.classList.add('on');
    k.ctx.audio.sting('reveal');
  });
  k.at(6700, () => will.classList.add('on'));
  k.at(8800, () => look({ lamp: 0.3, flicker: 0.9 }, 4500));
});

pv.start([title, role, nightfall, dawn, day, trial, execution]);
