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

// The host's browser is the game: closing it ends the room for everyone.
addEventListener('pagehide', () => {
  if (controller.host) controller.leaveRoom();
});

const app = document.querySelector<HTMLElement>('#app');
if (app) mountShell(app, controller);

// Opening a share link with a remembered name rejoins straight away.
const linkCode = controller.getState().linkCode;
const name = controller.getState().name;
if (linkCode && name) void controller.joinRoom(linkCode, name);
