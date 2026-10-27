import '@fontsource-variable/big-shoulders-display';
import '@fontsource-variable/unbounded';
import '@fontsource/space-mono';
import './style.css';
import { createPreview } from '../shared/harness.ts';
import { createBackdrop } from './backdrop.ts';
import { div, frameHooks, grainTile, inkMask } from './kit.ts';
import { SCENES } from './scenes.ts';
import { score } from './score.ts';

const rootStyle = document.documentElement.style;
rootStyle.setProperty('--grain-day', `url(${grainTile('#efe4cf', '#121110')})`);
rootStyle.setProperty('--grain-night', `url(${grainTile('#141312', '#efe4cf')})`);
rootStyle.setProperty('--ink-mask', `url(${inkMask()})`);

const pv = createPreview({
  slug: 'agitprop',
  name: 'Agitprop',
  score,
  exitMs: 480,
  gate(el) {
    el.innerHTML = `
      <div class="ag-g">
        <div class="ag-g-top"><span>VESPER · ART &amp; SOUND DIRECTION</span><span>PROOF SHEET · 07 PLATES</span></div>
        <div class="ag-g-kicker">A SOCIAL DEDUCTION GAME · NINE CITIZENS · TWO KNIVES</div>
        <h1 class="ag-g-word">VESPER</h1>
        <div class="ag-g-dir"><b>AGITPROP</b><span>A CONSTRUCTIVIST BROADSIDE</span></div>
        <p class="ag-g-blurb">The town is a poster that reprints itself every day. Votes are red wedges, the score is a factory, and the night is a printing press that never stops.</p>
        <button class="ag-g-begin" data-begin type="button"><span>START THE PRESS</span><svg viewBox="0 0 60 40" aria-hidden="true"><polygon points="0,0 60,20 0,40"/></svg></button>
        <div class="ag-g-sound"><svg viewBox="0 0 40 30" aria-hidden="true"><rect x="0" y="10" width="9" height="10"/><polygon points="9,10 22,1 22,29 9,20"/><rect x="27" y="11" width="3" height="8"/><rect x="33" y="7" width="3" height="16"/></svg>SOUND ON · HEADPHONES RECOMMENDED · CLICK ANYWHERE</div>
      </div>`;
  },
});

const draw = createBackdrop(pv.bg, pv.tween);
const grain = div(null, 'ag-grain');
pv.stage.insertBefore(grain, pv.fx);
let lastGrain = 0;
let shaking = false;

pv.onFrame((now) => {
  draw(now / 1000, Math.min(1, pv.audio.level() * 6));
  const s = pv.reducedMotion ? 0 : pv.tween.get('shake');
  if (s > 0.25) {
    const j = () => (Math.random() - 0.5) * s;
    pv.stage.style.transform = `translate(${j()}px, ${j()}px) rotate(${j() * 0.02}deg)`;
    shaking = true;
  } else if (shaking) {
    pv.stage.style.transform = '';
    shaking = false;
  }
  if (now - lastGrain > 83) {
    lastGrain = now;
    grain.style.transform = `translate(${Math.floor(Math.random() * 64)}px, ${Math.floor(Math.random() * 64)}px)`;
  }
  for (const f of frameHooks) f(now);
});

pv.start(SCENES);
