import type { AppController } from '../app/controller.ts';
import { mountApp } from './app.ts';

/** Mount the game UI (the "Scrim" direction) over the controller. Returns an unmount function. */
export function mountUi(root: HTMLElement, controller: AppController): () => void {
  return mountApp(root, controller);
}
