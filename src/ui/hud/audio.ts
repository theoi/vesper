import { h } from '../dom.ts';
import type { GameAudio } from '../contracts.ts';

/** Mute and volume, bound to the score. */
export function audioControls(audio: GameAudio): HTMLElement {
  const mute = h('button', { type: 'button', class: 'vx-tool vx-mute' });
  const volume = h('input', {
    type: 'range',
    min: 0,
    max: 100,
    step: 5,
    class: 'vx-volume',
    'aria-label': 'Volume',
  });
  const sync = () => {
    mute.textContent = audio.muted ? 'Muted' : 'Sound';
    mute.setAttribute('aria-pressed', String(audio.muted));
    mute.setAttribute('aria-label', audio.muted ? 'Unmute' : 'Mute');
    mute.classList.toggle('is-muted', audio.muted);
    volume.value = String(Math.round(audio.volume * 100));
  };
  mute.onclick = () => {
    audio.setMuted(!audio.muted);
    sync();
  };
  volume.oninput = () => {
    audio.setVolume(Number(volume.value) / 100);
    if (audio.muted) audio.setMuted(false);
    sync();
  };
  sync();
  return h('div', { class: 'vx-audio' }, mute, volume);
}
