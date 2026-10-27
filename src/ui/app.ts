import '@fontsource/old-standard-tt/400.css';
import '@fontsource/old-standard-tt/400-italic.css';
import '@fontsource/old-standard-tt/700.css';
import '@fontsource/homemade-apple/400.css';
import '@fontsource-variable/archivo/index.css';
import '../styles/base.css';
import '../styles/screens.css';
import '../styles/game.css';
import type { AppController, AppState } from '../app/controller.ts';
import { createGameAudio } from '../audio/index.ts';
import { createModalHost } from './hud/modal.ts';
import { lobbyFrame } from './screens/lobby.ts';
import { gameFrame } from './screens/game.ts';
import { connectingFrame, homeFrame, noticeFrame } from './screens/entry.ts';
import { createPrefs, type Frame, type UiContext } from './screens/context.ts';

type FrameKey = 'home' | 'connecting' | 'notice' | 'lobby' | 'game';

const FRAMES: Record<FrameKey, (ctx: UiContext) => Frame> = {
  home: homeFrame,
  connecting: connectingFrame,
  notice: noticeFrame,
  lobby: lobbyFrame,
  game: gameFrame,
};

function frameFor(state: AppState): FrameKey {
  const s = state.session;
  if (state.screen === 'home' || !s) return 'home';
  if (s.status === 'closed' || s.status === 'error') return 'notice';
  if (s.status === 'connecting' || !s.lobby) return 'connecting';
  return s.lobby.status === 'open' ? 'lobby' : 'game';
}

const ROOT_KEYS = ['screen', 'phase', 'faction', 'alive'] as const;

/** Mount the Scrim UI over the controller. Returns an unmount function. */
export function mountApp(root: HTMLElement, controller: AppController): () => void {
  const audio = createGameAudio();
  const prefs = createPrefs();
  const modals = createModalHost();
  const ctx: UiContext = { controller, audio, prefs, modals, root };
  root.classList.add('vx');
  const showMotion = (reduced: boolean) => (root.dataset.motion = reduced ? 'reduced' : 'full');
  showMotion(prefs.reducedMotion);
  const unPrefs = prefs.subscribe(showMotion);

  let frame: Frame | null = null;
  let frameKey = '';
  const render = (state: AppState) => {
    const key = frameFor(state);
    // Each game gets a fresh game screen, even if a reconnect skipped the lobby in between.
    const id = key === 'game' ? `game:${state.session?.lobby?.round ?? 0}` : key;
    if (id !== frameKey) {
      modals.closeAll();
      frame?.dispose?.();
      for (const k of ROOT_KEYS) delete root.dataset[k];
      root.dataset.screen = key;
      frameKey = id;
      frame = FRAMES[key](ctx);
      root.replaceChildren(frame.el, modals.el);
    }
    frame?.update(state);
  };

  // Browsers only let audio start from a user gesture.
  const unlock = () => {
    document.removeEventListener('pointerdown', unlock, true);
    document.removeEventListener('keydown', unlock, true);
    void audio.begin();
  };
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (!modals.closeTop()) frame?.skip?.();
  };
  document.addEventListener('keydown', onKey);

  const onClick = (e: MouseEvent) => {
    const target = e.target instanceof Element ? e.target.closest('button.tk') : null;
    if (target instanceof HTMLButtonElement && !target.disabled) audio.cue('ui');
  };
  root.addEventListener('click', onClick);

  render(controller.getState());
  const unsubscribe = controller.subscribe(render);
  return () => {
    unsubscribe();
    unPrefs();
    document.removeEventListener('pointerdown', unlock, true);
    document.removeEventListener('keydown', unlock, true);
    document.removeEventListener('keydown', onKey);
    root.removeEventListener('click', onClick);
    modals.closeAll();
    frame?.dispose?.();
    audio.dispose();
    root.classList.remove('vx');
    for (const k of ROOT_KEYS) delete root.dataset[k];
    delete root.dataset.motion;
    root.replaceChildren();
  };
}
