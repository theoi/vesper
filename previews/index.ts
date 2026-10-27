import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/bodoni-moda/standard-italic.css';
import '@fontsource-variable/cormorant-garamond/wght-italic.css';
import '@fontsource-variable/big-shoulders-display';
import '@fontsource-variable/unbounded';
import '@fontsource/space-mono/400.css';
import { maskSVG } from './masque/masks.ts';
import './index.css';

// Directions that are merged and live; the others show as "in rehearsal".
const LIVE = new Set(['masque', 'agitprop', 'deadair']);

const mask = document.querySelector('.mq-mask');
if (mask) mask.innerHTML = maskSVG({ variant: 0, eyesClosed: true });

document.querySelectorAll<HTMLAnchorElement>('.panel').forEach((panel) => {
  if (LIVE.has(panel.dataset.slug ?? '')) return;
  panel.classList.add('soon');
  panel.removeAttribute('href');
  panel.setAttribute('aria-disabled', 'true');
  const enter = panel.querySelector('.enter');
  if (enter) enter.textContent = 'In rehearsal, arriving shortly';
});
