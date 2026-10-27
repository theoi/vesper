import { el, type Preview, type SceneCtx, type SceneDef } from '../shared/harness.ts';
import { ease } from '../shared/tween.ts';
import {
  CAST,
  barcode,
  chn,
  colorBars,
  decode,
  fit,
  jolt,
  severSigil,
  stepWidth,
  wideWord,
  type Scope,
  type Scopes,
} from './kit.ts';

export interface Kit {
  pv: Preview;
  scopes: Scopes;
  mode(m: 'day' | 'night', flicker?: boolean): void;
  glitch(amount: number, ms: number): void;
  flash(col: 'white' | 'orange', ms: number): void;
  /** Baseline state every scene sets on entry, so any scene can be entered directly. */
  reset(signal: number): void;
  hud(text: string): void;
}

const q = <T extends Element = HTMLElement>(root: ParentNode, sel: string): T => {
  const e = root.querySelector<T>(sel);
  if (!e) throw new Error(`deadair: missing ${sel}`);
  return e;
};

const qa = (root: ParentNode, sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];

const frame = (c: SceneCtx, cls: string, html: string) => {
  const f = el('div', `da-frame ${cls}`, html);
  c.root.append(f);
  return f;
};

/** Hide now, stutter in at `ms`. */
const show = (c: SceneCtx, e: Element, ms: number) => {
  e.classList.add('da-hide');
  c.at(ms, () => {
    e.classList.remove('da-hide');
    e.classList.add('da-in');
  });
};

const hide = (e: Element) => {
  e.classList.add('da-hide');
  e.classList.remove('da-in');
};

function tile(k: Kit, i: number, cls = ''): { el: HTMLElement; scope: Scope } {
  const t = el(
    'div',
    `da-tile ${cls}`,
    `<canvas class="da-scope"></canvas>
     <div class="da-tile-top"><span>CH${chn(i)}</span><span class="da-tile-state">LIVE</span></div>
     <div class="da-tile-num da-wide">${chn(i)}</div>
     <div class="da-tile-name">${CAST[i] ?? ''}</div>
     <div class="da-tile-vote"></div>`,
  );
  return { el: t, scope: k.scopes.add(q<HTMLCanvasElement>(t, 'canvas'), i) };
}

const setState = (t: HTMLElement, s: string) => {
  q(t, '.da-tile-state').textContent = s;
};

/** Periodic idle violence: a held frame broken by a short glitch and a letter jolt. */
function idleGlitch(c: SceneCtx, k: Kit, every: number, words: () => HTMLElement[]) {
  c.every(every, () => {
    k.glitch(0.35 + Math.random() * 0.3, 200);
    for (const w of words()) jolt(w, 3, 0.4);
  });
}

export function buildScenes(k: Kit): SceneDef[] {
  const tw = k.pv.tween;

  const title: SceneDef = {
    id: 'title',
    label: 'Title',
    duration: 11000,
    shots: [{ name: 'title', at: 4000 }],
    enter(c) {
      k.mode('night', false);
      k.reset(0.07);
      k.hud('CH00 — PRE-SHOW');
      c.audio.setBed('title', 0.3);
      const f = frame(
        c,
        'da-title',
        `<div class="da-row da-meta">
          <span class="da-cell"><b>S01 / E01</b></span>
          <span class="da-cell">THE LAMPS GO OUT</span>
          <span class="da-cell da-grow"></span>
          <span class="da-cell">9 CHANNELS · 1 TOWN · NO GUARANTEES</span>
          <span class="da-cell da-sig">● ON AIR</span>
        </div>
        <div class="da-title-word"></div>
        <div class="da-row da-sub">
          <span class="da-cell da-sub-a">A SOCIAL DEDUCTION BROADCAST</span>
          <span class="da-cell da-grow da-sub-line"><i></i></span>
          <span class="da-cell da-sub-b">DO NOT ADJUST YOUR SET</span>
        </div>
        <div class="da-guide">${CAST.map(
          (n, i) => `<div class="da-guide-c"><b>${chn(i)}</b><span>${n}</span><i></i></div>`,
        ).join('')}</div>`,
      );
      const word = wideWord('VESPER', 'da-vesper da-slam');
      q(f, '.da-title-word').append(word);
      fit(word);
      show(c, q(f, '.da-meta'), 200);
      show(c, q(f, '.da-sub'), 700);
      qa(f, '.da-guide-c').forEach((g, i) => show(c, g, 1000 + i * 70));

      const BAR = (14 * 60) / 132 / 4;
      let lastBar = -1;
      const levels = qa(f, '.da-guide-c i');
      c.every(83, () => {
        const bc = c.audio.bedClock();
        const t = bc && bc.name === 'title' ? bc.t : c.elapsed() / 1000;
        const bar = Math.floor(t / BAR);
        if (bar !== lastBar && c.elapsed() > 1200) {
          lastBar = bar;
          if (bar % 4 === 3) {
            stepWidth(word, [104, 80, 62]);
            c.at(750, () => stepWidth(word, [84, 125]));
            k.glitch(0.45, 240);
          } else jolt(word, 3, 0.34);
        }
        const lvl = c.audio.level();
        levels.forEach((l) => {
          l.style.transform = `scaleY(${Math.min(1, 0.06 + lvl * 4 * (0.3 + Math.random()))})`;
        });
      });
    },
  };

  const role: SceneDef = {
    id: 'role',
    label: 'Role',
    duration: 11000,
    shots: [{ name: 'role', at: 5000 }],
    enter(c) {
      k.mode('night', false);
      k.reset(0.06);
      k.hud('CH?? — ASSIGNING SIGNAL');
      c.audio.setBed('title', 0.6);
      const f = frame(
        c,
        'da-role',
        `<div class="da-row da-meta">
          <span class="da-cell">PRIVATE FEED</span>
          <span class="da-cell">RECIPIENT: YOU</span>
          <span class="da-cell da-grow"></span>
          <span class="da-cell">DO NOT SHARE YOUR SCREEN</span>
        </div>
        <div class="da-card">
          <div class="da-card-back">
            ${colorBars()}
            <div class="da-card-grid"></div>
            <div class="da-card-ring"></div>
            <div class="da-card-label"><b>STAND BY</b><span>YOUR ROLE IS BEING TRANSMITTED</span></div>
            <div class="da-card-ch">CH ??</div>
          </div>
          <div class="da-card-front">
            <div class="da-emb">
              <div class="da-emb-top"><span>SIGIL</span><span>07 / S</span></div>
              ${severSigil()}
              <div class="da-emb-bot"><span>CUT LINE</span><span>N01 →</span></div>
            </div>
            <div class="da-dos">
              <div class="da-dos-head"><span>DOSSIER 07/S</span><span>EYES ONLY</span><span>ISSUED N01 · 00:00</span></div>
              <div class="da-dos-k">YOUR SIGNAL —</div>
              <div class="da-dos-name"><div class="da-wide da-fit da-role-name">THE SEVER</div></div>
              <div class="da-dos-tags"><span class="da-tag da-tag-sig">MAFIA</span><span class="da-tag">KILLING</span><span class="da-tag da-tag-line">ENCRYPTED BAND 06</span></div>
              <div class="da-dos-list">
                <div class="da-dl"><span class="da-dt">ABILITY</span><span class="da-dd"></span></div>
                <div class="da-dl"><span class="da-dt">NOTE</span><span class="da-dd"></span></div>
                <div class="da-dl"><span class="da-dt">BAND 06</span><span class="da-dd da-dd-band"><b>CH06 ILSE</b><b>CH03 ANTON</b><b class="da-you">CH07 YOU</b></span></div>
              </div>
              <div class="da-dos-foot">${barcode(451)}<span>SVR-0451-N · DESTROY AFTER VIEWING</span></div>
            </div>
          </div>
        </div>`,
      );
      const back = q(f, '.da-card-back');
      const front = q(f, '.da-card-front');
      const name = q(f, '.da-role-name');
      const dds = qa(f, '.da-dd');
      const lines = [
        'Each night, choose one signal. Cut it.',
        'You hear the encrypted band. The town hears only static.',
      ];
      hide(front);
      show(c, q(f, '.da-meta'), 150);
      show(c, q(f, '.da-card'), 0);
      c.at(1700, () => {
        c.audio.sting('reveal');
        c.audio.duck(0.35, 0.05, 1.6, 2);
        k.glitch(1, 650);
        back.classList.add('da-roll');
      });
      c.at(2360, () => {
        hide(back);
        front.classList.remove('da-hide');
        front.classList.add('da-in');
        k.hud('CH07 — THE SEVER');
        fit(name);
        decode(name, 'THE SEVER', 900, c.signal, true);
        stepWidth(name, [62, 62, 74, 92, 125, 108, 125]);
      });
      c.at(2900, () => {
        const [a, b] = dds;
        if (a) decode(a, lines[0] ?? '', 900, c.signal);
        if (b) c.at(800, () => decode(b, lines[1] ?? '', 1100, c.signal));
      });
      qa(f, '.da-tag').forEach((t, i) => show(c, t, 3000 + i * 160));
      show(c, q(f, '.da-dos-foot'), 3900);
      c.every(3100, () => {
        if (c.elapsed() < 6000) return;
        stepWidth(name, [92, 62, 62, 125]);
        k.glitch(0.4, 200);
      });
    },
  };

  const nightfall: SceneDef = {
    id: 'nightfall',
    label: 'Nightfall',
    duration: 12000,
    shots: [{ name: 'nightfall', at: 6000 }],
    enter(c) {
      k.mode('day', false);
      k.reset(0.04);
      k.hud('DAY 01 — SIGN-OFF');
      c.audio.setBed(null, 1.4);
      const a = frame(
        c,
        'da-signoff',
        `<div class="da-row da-meta">
          <span class="da-cell"><b>DAY 01</b></span>
          <span class="da-cell">LAST BELL</span>
          <span class="da-cell da-grow"></span>
          <span class="da-cell da-clock">18:59:57</span>
        </div>
        <div class="da-signoff-word"></div>
        <div class="da-row da-signoff-row">
          <span class="da-cell">THE TOWN GOES DARK IN</span>
          <span class="da-cell da-count da-wide">3</span>
          <span class="da-cell da-grow"></span>
          <span class="da-cell">LOCK YOUR DOORS · KILL YOUR LAMPS</span>
        </div>`,
      );
      const off = wideWord('SIGNING OFF', 'da-signoff-w');
      q(a, '.da-signoff-word').append(off);
      fit(off);
      const count = q(a, '.da-count');
      const clock = q(a, '.da-clock');
      c.at(500, () => {
        count.textContent = '2';
        clock.textContent = '18:59:58';
        jolt(off, 2, 0.3);
      });
      c.at(1000, () => {
        count.textContent = '1';
        clock.textContent = '18:59:59';
        jolt(off, 2, 0.5);
      });
      c.at(1500, () => {
        clock.textContent = '19:00:00';
        count.textContent = '0';
        c.audio.sting('nightfall');
        k.glitch(0.7, 300);
        tw.to('power', 1, 360, ease.in);
      });
      c.at(1880, () => tw.to('power', 0.004, 300, ease.in));
      c.at(2400, () => tw.set('power', 0));

      const b = frame(
        c,
        'da-night',
        `<div class="da-row da-meta">
          <span class="da-cell da-sig"><b>● ENCRYPTED</b></span>
          <span class="da-cell">NIGHT 01</span>
          <span class="da-cell">00:00 — 06:00</span>
          <span class="da-cell da-grow"></span>
          <span class="da-cell">PUBLIC BAND: OFF AIR</span>
        </div>
        <div class="da-night-word"></div>
        <div class="da-night-grid">
          <div class="da-night-l">
            <div class="da-night-open">ENCRYPTED CHANNEL OPEN<i class="da-cursor"></i></div>
            <div class="da-mini"></div>
            <div class="da-mini-cap"><span>TOWN STATUS</span><span>7 ASLEEP · 2 AWAKE</span></div>
          </div>
          <div class="da-intercept">
            <div class="da-int-head"><span>▌INTERCEPT</span><span>BAND 06</span><span>00:03:12</span><span class="da-int-dec">DECRYPT 000%</span></div>
            <div class="da-int-line"><b>ILSE</b><span class="da-int-msg"></span></div>
            <div class="da-int-line"><b>ANTON</b><span class="da-int-msg"></span></div>
            <div class="da-int-scope"><canvas class="da-scope"></canvas></div>
            <div class="da-int-foot">${barcode(66, 90, 16)}<span>SOURCE: CH03 ⇄ CH06</span></div>
          </div>
        </div>`,
      );
      hide(b);
      const nw = wideWord('NIGHT 01', 'da-night-w');
      q(b, '.da-night-word').append(nw);
      const mini = q(b, '.da-mini');
      const tiles = CAST.map((_, i) => {
        const t = tile(k, i, 'da-tile-mini');
        t.scope.mode = 'static';
        mini.append(t.el);
        return t;
      });
      c.at(2550, () => {
        a.remove();
        k.mode('night', false);
        k.hud('NIGHT 01 — ENCRYPTED');
        c.audio.setBed('night', 2.5);
      });
      c.at(2700, () => {
        tw.set('power', 2);
        b.classList.remove('da-hide');
        b.classList.add('da-in');
        fit(nw);
        stepWidth(nw, [62, 62, 80, 125, 100, 125]);
        k.glitch(0.8, 400);
      });
      tiles.forEach((t, i) =>
        c.at(3100 + i * 110, () => {
          const awake = i === 2 || i === 5;
          t.scope.mode = awake ? 'trace' : 'off';
          t.scope.hot = awake;
          t.el.classList.toggle('da-hot', awake);
          t.el.classList.toggle('da-dark', !awake);
          setState(t.el, awake ? 'AWAKE' : 'ASLEEP');
        }),
      );
      const iscope = k.scopes.add(q<HTMLCanvasElement>(b, '.da-int-scope canvas'), 5, true);
      iscope.hot = true;
      const dec = q(b, '.da-int-dec');
      const msgs = qa(b, '.da-int-msg');
      show(c, q(b, '.da-intercept'), 3500);
      c.at(3600, () => {
        let p = 0;
        const id = window.setInterval(() => {
          p = Math.min(100, p + 7 + Math.floor(Math.random() * 9));
          dec.textContent = `DECRYPT ${String(p).padStart(3, '0')}%`;
          if (p >= 100) clearInterval(id);
        }, 42);
        c.signal.addEventListener('abort', () => clearInterval(id));
      });
      c.at(4200, () => {
        const m = msgs[0];
        if (m) decode(m, 'Vale. Tonight.', 650, c.signal);
        tiles[5]?.scope.speak(900);
        iscope.speak(900);
      });
      c.at(5100, () => {
        const m = msgs[1];
        if (m) decode(m, 'The healer goes first.', 750, c.signal);
        tiles[2]?.scope.speak(1000);
        iscope.speak(1100);
      });
      idleGlitch(c, k, 2900, () => (c.elapsed() > 6500 ? [nw] : []));
    },
  };

  const dawn: SceneDef = {
    id: 'dawn',
    label: 'Dawn',
    duration: 11000,
    shots: [{ name: 'dawn', at: 5000 }],
    enter(c) {
      k.mode('night', false);
      k.reset(0.08);
      tw.set('power', 0);
      k.hud('OFF AIR');
      c.audio.setBed(null, 1.2);
      const bars = el(
        'div',
        'da-fullbars',
        `${colorBars()}<div class="da-fullbars-cap"><b class="da-wide">BACK ON AIR</b><span>DAY 02 · 06:00:00 · TX 88.1</span></div>`,
      );
      c.root.append(bars);
      const f = frame(
        c,
        'da-dawn',
        `<div class="da-row da-meta">
          <span class="da-cell da-sig"><b>● BACK ON AIR</b></span>
          <span class="da-cell">DAY 02</span>
          <span class="da-cell">06:00:00</span>
          <span class="da-cell da-grow"></span>
          <span class="da-cell">OVERNIGHT REPORT · 1 SIGNAL LOST</span>
        </div>
        <div class="da-dawn-main">
          <div class="da-dawn-feed">
            <canvas class="da-scope"></canvas>
            <div class="da-nosig"><b>NO SIGNAL</b><span>CH05 · VALE</span></div>
            <div class="da-dawn-feed-ch da-wide">05</div>
          </div>
          <div class="da-dawn-copy">
            <div class="da-k">CH05 — NO SIGNAL SINCE 03:12</div>
            <div class="da-dawn-name"></div>
            <div class="da-dawn-was"><span>VALE WAS</span><b class="da-wide">THE PATCH</b></div>
            <div class="da-dawn-desc">TOWN · PROTECTIVE — KEPT ONE SIGNAL ALIVE EACH NIGHT. NOT THIS ONE.</div>
          </div>
        </div>
        <div class="da-ticker"><div class="da-ticker-in">${'<span>BREAKING</span> CH05 LOST OVERNIGHT ▪ THE PATCH IS GONE ▪ FOUND AT 03:12, SET STILL WARM ▪ WHO CUT THE LINE? ▪ '.repeat(4)}</div></div>`,
      );
      hide(f);
      const name = wideWord('VALE', 'da-dawn-w');
      q(f, '.da-dawn-name').append(name);
      const feed = k.scopes.add(q<HTMLCanvasElement>(f, '.da-dawn-feed canvas'), 4);
      feed.mode = 'bars';
      c.at(250, () => {
        c.audio.sting('dawn');
        tw.set('power', 0.004);
        tw.to('power', 1, 320, ease.out);
      });
      c.at(620, () => tw.to('power', 2, 360, ease.out));
      c.at(1700, () => {
        bars.remove();
        k.mode('day', true);
        k.hud('DAY 02 — 06:00 — BACK ON AIR');
        f.classList.remove('da-hide');
        f.classList.add('da-in');
        fit(name);
        stepWidth(name, [62, 70, 125, 96, 125]);
        k.glitch(0.7, 350);
        c.audio.setBed('day', 3, 1.2);
      });
      show(c, q(f, '.da-dawn-was'), 2400);
      show(c, q(f, '.da-dawn-desc'), 2800);
      c.every(2700, () => {
        if (c.elapsed() < 5500) return;
        k.glitch(0.35, 200);
        jolt(name, 3, 0.5);
      });
    },
  };

  const day: SceneDef = {
    id: 'day',
    label: 'Day',
    duration: 13500,
    shots: [{ name: 'day', at: 9300 }],
    enter(c) {
      k.mode('day', false);
      k.reset(0.05);
      k.hud('DAY 02 — OPEN FLOOR');
      c.audio.setBed('day', 1.2);
      const f = frame(
        c,
        'da-dayscene',
        `<div class="da-row da-meta">
          <span class="da-cell"><b>DAY 02</b></span>
          <span class="da-cell">08:41</span>
          <span class="da-cell">OPEN FLOOR</span>
          <span class="da-cell da-grow"></span>
          <span class="da-cell">8 LIVE · 1 LOST</span>
          <span class="da-cell">MAJORITY 5</span>
        </div>
        <div class="da-day-main">
          <div class="da-wall"></div>
          <div class="da-side">
            <div class="da-log">
              <div class="da-panel-h"><span>TERMINAL // TOWN SQUARE</span><span>D2 · REC</span></div>
              <div class="da-log-body"></div>
            </div>
            <div class="da-votes">
              <div class="da-panel-h"><span>VOTES ▶ CH03 ANTON</span><span class="da-votes-state">FLOOR OPEN</span></div>
              <div class="da-votes-main">
                <div class="da-wide da-vote-count">0/8</div>
                <div class="da-votes-cap"><b>TO THE STAND</b><span>5 NEEDED</span></div>
              </div>
              <div class="da-pips">${'<i></i>'.repeat(8)}</div>
            </div>
          </div>
        </div>`,
      );
      const wall = q(f, '.da-wall');
      const tiles = CAST.map((_, i) => {
        const t = tile(k, i);
        if (i === 4) {
          t.scope.mode = 'bars';
          t.el.classList.add('da-lost');
          setState(t.el, 'NO SIGNAL');
        }
        wall.append(t.el);
        return t;
      });
      qa(wall, '.da-tile').forEach((t, i) => show(c, t, 80 + ((i * 4) % 9) * 45));
      const log = q(f, '.da-log-body');
      const chat: [number, number, string, string][] = [
        [500, 3, '08:41', 'Vale healed me two nights ago. Now Vale is dead. Someone knew.'],
        [1500, 1, '08:41', 'Anton was out past the second bell. I watched his door.'],
        [2600, 2, '08:42', 'I was walking. Since when is walking a crime?'],
        [3400, 0, '08:42', 'Since people started dying.'],
        [4200, 6, '08:42', "I'm putting Anton up. Let him explain himself on the stand."],
      ];
      for (const [at, who, ts, msg] of chat) {
        c.at(at, () => {
          const line = el(
            'div',
            'da-line da-in',
            `<span class="da-ts">[D2 ${ts}]</span><span class="da-who">&lt;${CAST[who] ?? ''}&gt;</span><span class="da-msg"></span>`,
          );
          log.append(line);
          decode(q(line, '.da-msg'), msg, msg.length * 11, c.signal);
          tiles[who]?.scope.speak(msg.length * 11 + 300);
          tiles[who]?.el.classList.add('da-speaking');
          c.at(msg.length * 11 + 300, () => tiles[who]?.el.classList.remove('da-speaking'));
        });
      }
      c.at(5000, () => {
        log.append(
          el(
            'div',
            'da-line da-prompt da-in',
            '<span class="da-ts">[D2 08:43]</span><span class="da-who">&gt;</span><span>FLOOR OPEN · CAST YOUR VOTE<i class="da-cursor"></i></span>',
          ),
        );
      });
      const count = q(f, '.da-vote-count');
      const pips = qa(f, '.da-pips i');
      const anton = tiles[2]?.el;
      const voters = [6, 1, 3, 0, 8];
      voters.forEach((v, n) =>
        c.at(5200 + n * 700, () => {
          c.audio.sting('vote');
          const t = tiles[v];
          if (t) {
            q(t.el, '.da-tile-vote').textContent = 'VOTE ▶ CH03';
            t.el.classList.add('da-voted');
          }
          if (anton) {
            anton.classList.toggle('da-hit-a', n % 2 === 0);
            anton.classList.toggle('da-hit-b', n % 2 === 1);
          }
          count.textContent = `${n + 1}/8`;
          count.classList.remove('da-slam', 'da-slam2');
          count.classList.add(n % 2 ? 'da-slam2' : 'da-slam');
          pips[n]?.classList.add('da-on');
          k.glitch(0.25 + n * 0.08, 180);
        }),
      );
      c.at(8500, () => {
        anton?.classList.add('da-accused');
        q(f, '.da-votes').classList.add('da-called');
        q(f, '.da-votes-state').textContent = 'TRIAL CALLED';
        k.hud('DAY 02 — ANTON TO THE STAND');
        k.glitch(0.8, 380);
        k.flash('orange', 220);
      });
      c.every(3300, () => {
        if (c.elapsed() < 9500) return;
        k.glitch(0.3, 180);
        jolt(count, 2, 0.5);
      });
    },
  };

  const trial: SceneDef = {
    id: 'trial',
    label: 'Trial',
    duration: 14000,
    shots: [
      { name: 'trial', at: 4000 },
      { name: 'verdict', at: 10000 },
    ],
    enter(c) {
      k.mode('day', false);
      k.reset(0.1);
      k.hud('THE STAND — CH03 ANTON');
      c.audio.setBed('trial', 0.6);
      const f = frame(
        c,
        'da-trial',
        `<div class="da-feed da-zoom">
          <canvas class="da-scope"></canvas>
          <div class="da-feed-top">
            <div class="da-feed-ch da-wide">CH03</div>
            <div class="da-feed-meta"><span>THE STAND · D2 · 09:02</span><span>ACCUSED · 5 OF 8</span></div>
            <div class="da-onair"><i></i>ON AIR</div>
          </div>
          <div class="da-meters">
            <div class="da-meter da-meter-g"><div class="da-meter-h"><span class="da-wide">GUILTY</span><b class="da-wide">0</b></div><div class="da-meter-bar">${'<i></i>'.repeat(7)}</div></div>
            <div class="da-meter da-meter-i"><div class="da-meter-h"><span class="da-wide">INNOCENT</span><b class="da-wide">0</b></div><div class="da-meter-bar">${'<i></i>'.repeat(7)}</div></div>
            <div class="da-meters-cap"><span class="da-ballots">BALLOTS SEALED</span><span>0 / 7</span></div>
          </div>
          <div class="da-feed-name"></div>
          <div class="da-lower"><span class="da-lower-who">ANTON ▶</span><span class="da-lower-msg"></span></div>
        </div>`,
      );
      const name = wideWord('ANTON', 'da-feed-w');
      q(f, '.da-feed-name').append(name);
      fit(name);
      const scope = k.scopes.add(q<HTMLCanvasElement>(f, '.da-feed canvas'), 2, true);
      const msg = q(f, '.da-lower-msg');
      const defense =
        "I'm a watcher. I saw Kestrel leave her house last night. Ask her where she went.";
      c.at(900, () => {
        decode(msg, defense, 2300, c.signal);
        scope.speak(2600);
      });
      const meters = q(f, '.da-meters');
      show(c, meters, 600);
      const gSeg = qa(f, '.da-meter-g i');
      const iSeg = qa(f, '.da-meter-i i');
      const gN = q(f, '.da-meter-g b');
      const iN = q(f, '.da-meter-i b');
      const cap = qa(f, '.da-meters-cap span');
      const ballots = 'GIGGIGG';
      let g = 0;
      let inn = 0;
      c.at(4300, () => {
        if (cap[0]) cap[0].textContent = 'BALLOTS OPEN';
        tw.to('signal', 0.5, 4200, ease.in);
      });
      [...ballots].forEach((b, n) =>
        c.at(4500 + n * 450, () => {
          c.audio.sting('vote');
          if (b === 'G') {
            gSeg[g]?.classList.add('da-on');
            g++;
            gN.textContent = String(g);
          } else {
            iSeg[inn]?.classList.add('da-on');
            inn++;
            iN.textContent = String(inn);
          }
          if (cap[1]) cap[1].textContent = `${n + 1} / 7`;
          k.glitch(0.3 + n * 0.07, 200);
          jolt(name, 2, 0.3 + n * 0.05);
        }),
      );
      c.at(8200, () => {
        if (cap[0]) cap[0].textContent = 'COUNT CLOSED';
        tw.to('signal', 0.9, 700, ease.in);
        c.audio.duck(0.2, 0.3, 0.6, 0.2);
        k.glitch(0.9, 700);
      });
      const v = el(
        'div',
        'da-verdict',
        `<div class="da-verdict-word"></div>
         <div class="da-row da-verdict-meta">
           <span class="da-cell"><b>5</b> GUILTY</span>
           <span class="da-cell"><b>2</b> INNOCENT</span>
           <span class="da-cell da-grow"></span>
           <span class="da-cell">CH03 ANTON — SIGNAL TO BE CUT</span>
         </div>
         <div class="da-verdict-top"><span>VERDICT</span><span>D2 · 09:09:41</span></div>`,
      );
      c.root.append(v);
      hide(v);
      const gw = wideWord('GUILTY', 'da-rgb');
      q(v, '.da-verdict-word').append(gw);
      c.at(9000, () => {
        c.audio.setBed(null, 0.05);
        c.audio.sting('verdict');
        k.flash('white', 420);
        tw.set('signal', 0.05);
        k.hud('VERDICT — GUILTY');
        v.classList.remove('da-hide');
        v.classList.add('da-in');
        fit(gw);
        stepWidth(gw, [125, 125, 62, 62, 90, 125, 112, 125]);
        k.glitch(1, 500);
      });
      c.every(1700, () => {
        if (c.elapsed() < 10500) return;
        k.glitch(0.45, 220);
        jolt(gw, 3, 0.45);
      });
    },
  };

  const execution: SceneDef = {
    id: 'execution',
    label: 'Execution',
    duration: 12500,
    shots: [{ name: 'execution', at: 7200 }],
    enter(c) {
      k.mode('day', false);
      k.reset(0.12);
      k.hud('CH03 — FINAL TRANSMISSION');
      c.audio.setBed(null, 1);
      const f = frame(
        c,
        'da-exec',
        `<div class="da-feed">
          <canvas class="da-scope"></canvas>
          <div class="da-feed-top">
            <div class="da-feed-ch da-wide">CH03</div>
            <div class="da-feed-meta"><span>FINAL TRANSMISSION</span><span>D2 · 09:14</span></div>
            <div class="da-onair"><i></i>ON AIR</div>
          </div>
          <div class="da-lastwords"><span class="da-k">ANTON · LAST WORDS —</span><div class="da-quote da-wide"></div></div>
          <div class="da-lower"><span class="da-lower-who">CH03 ▶</span><span>SIGNAL SCHEDULED FOR TERMINATION</span></div>
        </div>`,
      );
      const feed = q(f, '.da-feed');
      const scope = k.scopes.add(q<HTMLCanvasElement>(feed, 'canvas'), 2, true);
      const quote = q(f, '.da-quote');
      c.at(400, () => {
        decode(quote, '“You’ll miss me\nwhen the lamps go out.”', 1700, c.signal);
        scope.speak(2000);
      });
      const slices = el('div', 'da-slices');
      f.append(slices);
      const smear = el('canvas', 'da-smear');
      c.root.append(smear);
      const nosig = el(
        'div',
        'da-nosig-full',
        '<b class="da-wide">NO SIGNAL</b><span>CH03 · 09:14:07</span>',
      );
      c.root.append(nosig);
      hide(nosig);
      const rv = frame(
        c,
        'da-reveal',
        `<div class="da-row da-meta">
          <span class="da-cell">CH03 · ANTON</span>
          <span class="da-cell">SIGNAL TERMINATED 09:14:07</span>
          <span class="da-cell da-grow"></span>
          <span class="da-cell da-sig"><b>ROLE DECLASSIFIED</b></span>
        </div>
        <div class="da-was"><span>ANTON WAS</span><span class="da-tag da-tag-sig">MAFIA</span><span class="da-tag">DECEPTION</span></div>
        <div class="da-reveal-word"></div>
        <div class="da-reveal-bottom">
          <div class="da-reveal-quote"><span class="da-k">LAST WORDS</span><p>“You’ll miss me when the lamps go out.”</p></div>
          <div class="da-will"><span class="da-k">LAST WILL — RECOVERED 61%</span><p class="da-will-p"></p></div>
          <div class="da-static-seat"><canvas class="da-scope"></canvas><span>SEAT 03 · STATIC</span></div>
        </div>
        <div class="da-guide da-guide-cut">${CAST.map(
          (n, i) =>
            `<div class="da-guide-c${i === 2 || i === 4 ? ' da-cut' : ''}"><b>${chn(i)}</b><span>${i === 2 || i === 4 ? 'NO SIGNAL' : n}</span></div>`,
        ).join('')}</div>`,
      );
      hide(rv);
      qa(rv, '.da-guide-c').forEach((g, i) => show(c, g, 4500 + i * 50));
      const rw = wideWord('THE SCRAMBLER', 'da-reveal-w');
      q(rv, '.da-reveal-word').append(rw);
      const seat = k.scopes.add(q<HTMLCanvasElement>(rv, '.da-static-seat canvas'), 2);
      seat.mode = 'static';

      c.at(2600, () => {
        c.audio.sting('death');
        k.glitch(1, 900);
        const src = q<HTMLCanvasElement>(feed, 'canvas');
        const n = 14;
        for (let i = 0; i < n; i++) {
          const cl = feed.cloneNode(true);
          if (!(cl instanceof HTMLElement)) continue;
          const cv = cl.querySelector('canvas');
          if (cv) {
            cv.width = src.width;
            cv.height = src.height;
            cv.getContext('2d')?.drawImage(src, 0, 0);
          }
          cl.classList.add('da-slice');
          cl.style.clipPath = `inset(${(i / n) * 100}% 0 ${100 - ((i + 1) / n) * 100}% 0)`;
          cl.style.setProperty('--dx', `${(Math.random() - 0.5) * 24}vw`);
          cl.style.setProperty('--dx2', `${(Math.random() - 0.5) * 60}vw`);
          cl.style.animationDelay = `${Math.floor(Math.random() * 3) * 83}ms`;
          slices.append(cl);
        }
        feed.style.visibility = 'hidden';
      });
      const g2 = smear.getContext('2d');
      let smearStart = 0;
      c.at(3250, () => {
        k.mode('night', false);
        smearStart = performance.now();
        smear.width = Math.round(smear.clientWidth / 3);
        smear.height = Math.round(smear.clientHeight / 3);
      });
      c.every(83, () => {
        if (!smearStart || !g2) return;
        const p = (performance.now() - smearStart) / 650;
        if (p > 1.3) return;
        const w = smear.width;
        const h = smear.height;
        for (let x = 0; x < w; x += 1 + Math.floor(Math.random() * 3)) {
          if (Math.random() > 0.55) continue;
          const y0 = Math.random() * h * 0.8;
          const len = h * (0.1 + Math.random() * 0.7) * Math.min(1, p + 0.2);
          const r = Math.random();
          const col = r < 0.18 ? '255,77,0' : r < 0.6 ? '242,242,236' : '120,120,116';
          const gr = g2.createLinearGradient(0, y0, 0, y0 + len);
          gr.addColorStop(0, `rgba(${col},${0.9 - p * 0.5})`);
          gr.addColorStop(1, `rgba(${col},0)`);
          g2.fillStyle = gr;
          g2.fillRect(x, y0, 1 + Math.floor(Math.random() * 2), len);
        }
      });
      c.at(3900, () => {
        slices.remove();
        smear.classList.add('da-gone');
        nosig.classList.remove('da-hide');
        nosig.classList.add('da-in');
        tw.set('signal', 0.95);
        k.hud('CH03 — NO SIGNAL');
      });
      c.at(4400, () => {
        hide(nosig);
        smear.remove();
        tw.to('signal', 0.12, 420, ease.steps(5));
        rv.classList.remove('da-hide');
        rv.classList.add('da-in');
        fit(rw);
        stepWidth(rw, [62, 62, 78, 125, 104, 125]);
        k.glitch(0.6, 300);
        k.hud('CH03 — DECLASSIFIED');
        c.audio.setBed('night', 3, 1.2);
        decode(
          q(rv, '.da-will-p'),
          'Kestrel l█es. I watched her d██r on N1. Trust n█ one on CH0█ — A.',
          1400,
          c.signal,
        );
      });
      c.every(2300, () => {
        if (c.elapsed() < 6500) return;
        k.glitch(0.4, 200);
        jolt(rw, 3, 0.4);
      });
    },
  };

  return [title, role, nightfall, dawn, day, trial, execution];
}
