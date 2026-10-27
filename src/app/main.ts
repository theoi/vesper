import { DEFAULT_LIMITS } from '../bots/llm/index.ts';
import { roomFromUrl, transportByName } from '../net/index.ts';
import { AppController } from './controller.ts';
import { mountShell } from './shell.ts';

const params = new URLSearchParams(location.search);

// Opt-in network recording for e2e tests and debugging.
const recordNet = (() => {
  try {
    return localStorage.getItem('vesper.netlog') === '1';
  } catch {
    return false;
  }
})();

function browserStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function tabStorage(): Storage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

// `?claudeCalls=N` lowers the per-game Claude call budget (cost control for tests).
const claudeCalls = Number(params.get('claudeCalls'));

const controller = new AppController({
  transport: () => transportByName(params.get('net')),
  storage: browserStorage(),
  claudeLimits:
    Number.isInteger(claudeCalls) && claudeCalls > 0 && claudeCalls < DEFAULT_LIMITS.maxCallsPerGame
      ? { maxCallsPerGame: claudeCalls }
      : {},
  baseUrl: location.origin + location.pathname,
  linkCode: roomFromUrl(),
  recordNet,
  // Per tab, so a reload resumes the room but a second tab doesn't fork it.
  hostStore: tabStorage(),
  // The bundle URL carries a content hash, so it changes with every deploy.
  buildId: import.meta.url,
  onRoomUrl: (code) => {
    const url = new URL(location.href);
    if (code) url.searchParams.set('room', code);
    else url.searchParams.delete('room');
    history.replaceState(null, '', url);
  },
});

declare global {
  interface Window {
    /** Controller handle for e2e tests and debugging (see src/app/README.md). */
    __vesper?: AppController;
  }
}
window.__vesper = controller;

// The host's browser is the game. Keep a copy of the room in this tab so a
// reload picks the game back up while friends wait to reconnect. Leaving with
// the Leave button still ends the room for everyone.
const SAVE_MS = 5000;
setInterval(() => controller.saveHost(), SAVE_MS);
addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') controller.saveHost();
});
let suspended = false;
addEventListener('pagehide', () => {
  if (!controller.host) return;
  suspended = true;
  controller.suspendHost();
});
// Back from the back-forward cache with the room suspended: reload to resume it.
addEventListener('pageshow', (e) => {
  if (e.persisted && suspended) location.reload();
});

type MountUi = (root: HTMLElement, controller: AppController) => () => void;

// `?ui=v2` mounts the new UI from src/ui (its own lazy chunk); `?ui=shell` or
// no parameter mounts the placeholder shell. The glob finds src/ui/index.ts
// only once it exists, so this builds either way.
const uiModules = import.meta.glob<{ mountUi: MountUi }>('../ui/index.ts');

async function chooseUi(): Promise<{ name: 'v2' | 'shell'; mount: MountUi }> {
  const load = params.get('ui') === 'v2' ? uiModules['../ui/index.ts'] : undefined;
  if (load) {
    try {
      return { name: 'v2', mount: (await load()).mountUi };
    } catch (e) {
      console.error('Could not load the new UI; showing the shell instead.', e);
    }
  } else if (params.get('ui') === 'v2') {
    console.warn('This build has no new UI yet; showing the shell.');
  }
  return { name: 'shell', mount: mountShell };
}

const app = document.querySelector<HTMLElement>('#app');
if (app) {
  void chooseUi().then(({ name, mount }) => {
    document.documentElement.dataset.ui = name;
    mount(app, controller);
  });
}

// Opening a share link with a remembered name rejoins straight away.
const linkCode = controller.getState().linkCode;
const name = controller.getState().name;
if (!controller.resumeHost() && linkCode && name) void controller.joinRoom(linkCode, name);
