import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';
import './style.css';
import { shaderLayer } from '../shared/gl.ts';
import { createPreview, el } from '../shared/harness.ts';
import { ease } from '../shared/tween.ts';
import { colorBars, fit, Scopes, wideWord } from './kit.ts';
import { buildScenes, type Kit } from './scenes.ts';
import { score } from './score.ts';
import { BG_FRAG, FX_FRAG } from './shaders.ts';

function gate(g: HTMLElement): void {
  g.innerHTML = `
    <div class="da-gate">
      <div class="da-row da-meta">
        <span class="da-cell"><b>VESPER</b></span>
        <span class="da-cell">ART &amp; SOUND DIRECTION PREVIEW</span>
        <span class="da-cell da-grow"></span>
        <span class="da-cell">TX 88.1 · STANDBY</span>
      </div>
      <div class="da-gate-word"></div>
      <div class="da-gate-bottom">
        <div class="da-gate-dir">
          <span class="da-k">DIRECTION —</span>
          <b class="da-wide">DEAD AIR</b>
          <span>A BRUTALIST GLITCH BROADCAST. NINE CHANNELS. ONE TOWN. EVERY LIE IS INTERFERENCE.</span>
        </div>
        <div class="da-gate-bars">${colorBars()}</div>
        <div class="da-gate-go">
          <button class="da-gate-btn" data-begin type="button"><span>▶</span> TUNE IN</button>
          <span class="da-gate-hint">SOUND ON · HEADPHONES RECOMMENDED<br />CLICK ANYWHERE OR PRESS ENTER</span>
        </div>
      </div>
    </div>`;
  const word = wideWord('VESPER', 'da-vesper');
  g.querySelector('.da-gate-word')?.append(word);
  requestAnimationFrame(() => fit(word));
}

const pv = createPreview({ slug: 'deadair', name: 'Dead Air', score, gate, exitMs: 260 });
const tw = pv.tween;

const hud = el(
  'header',
  'da-hud',
  `<span class="da-cell da-hud-brand"><i></i>VESPER</span>
   <span class="da-cell">DEAD AIR · PIRATE TX 88.1</span>
   <span class="da-cell da-hud-mid">STANDBY</span>
   <span class="da-cell da-grow"></span>
   <span class="da-cell da-hud-rec"><i></i>REC</span>
   <span class="da-cell da-hud-tc">00:00:00:00</span>`,
);
pv.stage.append(hud);
const hudMid = hud.querySelector<HTMLElement>('.da-hud-mid');
const hudTc = hud.querySelector<HTMLElement>('.da-hud-tc');

const bg = shaderLayer(pv.bg, BG_FRAG, { scale: 0.5, maxDpr: 1.5 });
const fx = shaderLayer(pv.fx, FX_FRAG, { scale: 1, maxDpr: 1, alpha: true });
const scopes = new Scopes();

let day = false;
let modeToken = 0;
let glitchTimer = 0;
let flashCol: [number, number, number] = [0.97, 0.97, 0.94];
tw.set('power', 2);
tw.set('signal', 0.06);
tw.set('inv', 0);

const applyMode = (d: boolean) => {
  day = d;
  document.body.classList.toggle('da-day', d);
  tw.set('inv', d ? 1 : 0);
};

const kit: Kit = {
  pv,
  scopes,
  mode(m, flicker = true) {
    const tok = ++modeToken;
    const d = m === 'day';
    if (!flicker || d === day) return applyMode(d);
    [0, 60, 110, 190, 250].forEach((ms, i) =>
      window.setTimeout(() => tok === modeToken && applyMode(i % 2 === 0 ? d : !d), ms),
    );
  },
  glitch(amount, ms) {
    tw.set('glitch', Math.max(amount, tw.get('glitch')));
    tw.to('glitch', 0, ms, ease.steps(5));
    document.body.classList.add('da-glitching');
    clearTimeout(glitchTimer);
    glitchTimer = window.setTimeout(() => document.body.classList.remove('da-glitching'), ms);
  },
  flash(col, ms) {
    flashCol = col === 'white' ? [0.97, 0.97, 0.94] : [1, 0.302, 0];
    tw.set('flash', 1);
    tw.to('flash', 0, ms, ease.steps(5));
  },
  reset(signal) {
    tw.set('power', 2);
    tw.set('flash', 0);
    tw.to('signal', signal, 300, ease.steps(4));
    kit.glitch(0.7, 260);
  },
  hud(text) {
    if (hudMid) hudMid.textContent = text;
  },
};

let lastTc = '';
pv.onFrame((now) => {
  const t = now / 1000;
  const lvl = pv.audio.level();
  const inv = tw.get('inv');
  const glitch = tw.get('glitch');
  bg.render(t, { uInv: inv, uSignal: tw.get('signal'), uGlitch: glitch, uLevel: lvl });
  fx.render(t, {
    uInv: inv,
    uGlitch: glitch,
    uPower: tw.get('power', 2),
    uFlash: tw.get('flash'),
    uFlashCol: flashCol,
  });
  scopes.draw(now, lvl, day);
  const f = Math.floor(t * 25);
  const tc = [Math.floor(f / 90000), Math.floor(f / 1500) % 60, Math.floor(f / 25) % 60, f % 25]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
  if (tc !== lastTc && hudTc) {
    lastTc = tc;
    hudTc.textContent = tc;
  }
});

pv.start(buildScenes(kit));
