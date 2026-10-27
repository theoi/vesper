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

const controller = new AppController({
  transport: () => transportByName(params.get('net')),
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
