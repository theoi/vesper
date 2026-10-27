import type { AppController, AppState } from '../../app/controller.ts';
import type { SessionSnapshot } from '../../net/index.ts';
import type { GameAudio } from '../contracts.ts';
import type { ModalHost } from '../hud/modal.ts';

export interface Frame {
  el: HTMLElement;
  update(state: AppState): void;
  /** Esc with no modal open. */
  skip?(): void;
  dispose?(): void;
}

export interface Prefs {
  readonly reducedMotion: boolean;
  setReducedMotion(on: boolean): void;
  subscribe(cb: (reducedMotion: boolean) => void): () => void;
}

export interface UiContext {
  controller: AppController;
  audio: GameAudio;
  prefs: Prefs;
  modals: ModalHost;
  /** The mount root; frames set `data-phase` and friends on it for the CSS. */
  root: HTMLElement;
}

const MOTION_KEY = 'vesper.reducedMotion';

export function createPrefs(): Prefs {
  let stored: string | null;
  try {
    stored = localStorage.getItem(MOTION_KEY);
  } catch {
    stored = null;
  }
  let reduced =
    stored === null
      ? (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
      : stored === '1';
  const listeners = new Set<(on: boolean) => void>();
  return {
    get reducedMotion() {
      return reduced;
    },
    setReducedMotion(on) {
      reduced = on;
      try {
        localStorage.setItem(MOTION_KEY, on ? '1' : '0');
      } catch {
        // Private mode: the choice lasts for this page only.
      }
      for (const l of [...listeners]) l(on);
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

export function bannerText(s: SessionSnapshot | null): string {
  if (!s) return '';
  if (s.status === 'reconnecting') return 'Connection lost. Reconnecting…';
  if (s.isHost && s.network.state === 'error')
    return `Friends can't join: ${s.network.error.message}`;
  return '';
}
