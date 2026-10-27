import type { AppController } from '../../app/controller.ts';
import { h, ticket } from '../dom.ts';
import { openHelp } from '../hud/help.ts';
import type { Frame, UiContext } from './context.ts';

/** The lit cloth behind the entry screens, with the title cast on it as a shadow. */
function backdrop(panel: HTMLElement, testid: string, extra: Node | null = null): HTMLElement {
  return h(
    'main',
    { 'data-testid': testid, class: 'vx-entry' },
    h('div', { class: 'vx-cloth', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'vx-entry-inner' },
      h('p', { class: 'vx-entry-kicker', text: 'A shadow play in one small town' }),
      h('h1', { class: 'vx-title', text: 'Vesper' }),
      extra,
      panel,
    ),
  );
}

export function homeFrame(ctx: UiContext): Frame {
  const c: AppController = ctx.controller;
  const st = c.getState();
  const name = h('input', {
    'data-testid': 'name-input',
    id: 'vx-name',
    maxlength: 24,
    autocomplete: 'nickname',
    placeholder: 'How the town will know you',
    value: st.name,
  });
  const code = h('input', {
    'data-testid': 'code-input',
    id: 'vx-code',
    placeholder: 'Room code or link',
    value: st.linkCode ?? '',
  });
  const error = h('p', { 'data-testid': 'home-error', role: 'alert', class: 'vx-error' });
  const needName = () => {
    if (name.value.trim()) return false;
    error.textContent = 'Enter a name first.';
    name.focus();
    return true;
  };
  const solo = ticket('Play solo with bots', { 'data-testid': 'host-solo' }, 'primary');
  const host = ticket('Host a game', { 'data-testid': 'host-online' });
  const join = ticket('Join', { 'data-testid': 'join' });
  const help = h('button', { type: 'button', class: 'vx-link', text: 'How to play' });
  host.onclick = () => !needName() && void c.hostRoom(name.value, { online: true });
  solo.onclick = () => !needName() && void c.hostRoom(name.value, { online: false, seats: 7 });
  join.onclick = () => !needName() && void c.joinRoom(code.value, name.value);
  help.onclick = () => openHelp(ctx.modals);
  code.onkeydown = (e) => e.key === 'Enter' && join.click();
  name.onkeydown = (e) => e.key === 'Enter' && (code.value.trim() ? join : solo).click();

  const panel = h(
    'section',
    { class: 'vx-plate vx-home-panel' },
    h('label', { class: 'vx-label', for: 'vx-name', text: 'Your name' }),
    name,
    h('div', { class: 'vx-home-actions' }, solo, host),
    h('div', { class: 'vx-rule', 'aria-hidden': 'true' }, h('span', { text: 'or' })),
    h('label', { class: 'vx-label', for: 'vx-code', text: 'Join with a code or link' }),
    h('div', { class: 'vx-join' }, code, join),
    error,
    h('div', { class: 'vx-home-foot' }, help),
  );
  const tagline = h('p', {
    class: 'vx-tagline',
    text: 'Everyone holds a secret. Talk by lamplight, vote by day, and find the shadow that lies.',
  });
  if (st.linkCode) setTimeout(() => (name.value ? join.focus() : name.focus()));
  return {
    el: backdrop(panel, 'screen-home', tagline),
    update: (s) => {
      error.textContent = s.homeError ?? '';
    },
  };
}

export function connectingFrame(ctx: UiContext): Frame {
  const msg = h('p', { 'data-testid': 'connecting', class: 'vx-entry-msg', role: 'status' });
  const cancel = ticket('Cancel', { 'data-testid': 'leave' }, 'ghost');
  cancel.onclick = () => ctx.controller.leaveRoom();
  const panel = h(
    'section',
    { class: 'vx-plate vx-entry-panel' },
    h('div', { class: 'vx-wait-candle', 'aria-hidden': 'true' }),
    msg,
    cancel,
  );
  return {
    el: backdrop(panel, 'screen-connecting'),
    update: (s) => {
      msg.textContent = `Connecting to room ${s.session?.code ?? ''}…`;
    },
  };
}

export function noticeFrame(ctx: UiContext): Frame {
  const msg = h('p', { 'data-testid': 'notice', role: 'alert', class: 'vx-entry-msg' });
  const home = ticket('Back to start', { 'data-testid': 'go-home' }, 'primary');
  home.onclick = () => ctx.controller.goHome();
  const panel = h('section', { class: 'vx-plate vx-entry-panel' }, msg, home);
  return {
    el: backdrop(panel, 'screen-notice'),
    update: (s) => {
      msg.textContent = s.session?.notice?.message ?? 'The room is closed.';
      msg.dataset.code = s.session?.notice?.code ?? '';
    },
  };
}
