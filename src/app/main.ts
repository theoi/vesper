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

const app = document.querySelector<HTMLElement>('#app');
if (app) mountShell(app, controller);

// Opening a share link with a remembered name rejoins straight away.
const linkCode = controller.getState().linkCode;
const name = controller.getState().name;
if (!controller.resumeHost() && linkCode && name) void controller.joinRoom(linkCode, name);
