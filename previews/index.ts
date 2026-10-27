import '@fontsource/im-fell-english';
import '@fontsource/im-fell-english/400-italic.css';
import '@fontsource/im-fell-english-sc';
import seance from './seance/img/mira-glanceL.webp?url';
import supper from './supper/img/kestrel-glanceR.webp?url';
import scrim from './scrim/img/anton-afraid.webp?url';
import './index.css';

// Directions that are merged and live; the others show as "in rehearsal".
const LIVE = new Set(['supper']);
const ART: Record<string, string> = { supper, seance, scrim };

document.querySelectorAll<HTMLAnchorElement>('.panel').forEach((panel) => {
  const slug = panel.dataset.slug ?? '';
  const art = panel.querySelector<HTMLElement>('.art');
  if (art && ART[slug]) art.style.backgroundImage = `url("${ART[slug]}")`;
  if (LIVE.has(slug)) return;
  panel.classList.add('soon');
  panel.removeAttribute('href');
  panel.setAttribute('aria-disabled', 'true');
  const enter = panel.querySelector('.enter');
  if (enter) enter.textContent = 'In rehearsal, arriving shortly';
});
