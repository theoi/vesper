import { slotName } from '../../engine/index.ts';
import { h, setText, show, ticket } from '../dom.ts';
import { audioControls } from '../hud/audio.ts';
import { openHelp } from '../hud/help.ts';
import { createStage } from '../stage/index.ts';
import { claudePanel } from './claude.ts';
import { bannerText, type Frame, type UiContext } from './context.ts';

const NETWORK_LABEL = {
  offline: 'Offline (solo)',
  opening: 'Opening room…',
  open: 'Open for friends',
  error: 'Not reachable',
} as const;

export function lobbyFrame(ctx: UiContext): Frame {
  const c = ctx.controller;
  const stage = createStage(ctx.audio);
  stage.setReducedMotion(ctx.prefs.reducedMotion);
  const unPrefs = ctx.prefs.subscribe((on) => stage.setReducedMotion(on));
  stage.onPick(() => {});

  const code = h('code', { 'data-testid': 'room-code', class: 'vx-room-code' });
  const link = h('input', {
    'data-testid': 'room-link',
    readonly: true,
    'aria-label': 'Share link',
    class: 'vx-room-link',
  });
  const copy = ticket('Copy link', { 'data-testid': 'copy-link' });
  copy.onclick = () => {
    void navigator.clipboard
      ?.writeText(link.value)
      .then(() => {
        copy.textContent = 'Copied';
        setTimeout(() => (copy.textContent = 'Copy link'), 1600);
      })
      .catch(() => undefined);
  };
  const net = h('span', { 'data-testid': 'network-status', class: 'vx-net' });
  const bannerEl = h('p', {
    'data-testid': 'banner',
    class: 'vx-banner',
    role: 'status',
    hidden: true,
  });
  const seats = h('ol', { 'data-testid': 'seats', class: 'vx-seats' });
  const seatCount = h('span', { 'data-testid': 'seat-count', class: 'vx-seat-count' });
  const addBot = ticket('Add a bot', { 'data-testid': 'add-bot' });
  addBot.onclick = () => c.addBot();
  const fillCount = h('select', { 'data-testid': 'fill-count', 'aria-label': 'Seats to fill' });
  for (let n = 4; n <= 16; n++) fillCount.append(h('option', { value: n, text: `${n} seats` }));
  fillCount.value = '7';
  const fill = ticket('Fill with bots', { 'data-testid': 'fill-bots' });
  fill.onclick = () => c.fillWithBots(Number(fillCount.value));
  const pace = h(
    'select',
    { 'data-testid': 'pace', 'aria-label': 'Pace' },
    h('option', { value: 'standard', text: 'Standard pace' }),
    h('option', { value: 'fast', text: 'Fast pace' }),
  );
  pace.onchange = () => c.updateSettings({ pace: pace.value === 'fast' ? 'fast' : 'standard' });
  const roles = h('ol', { 'data-testid': 'role-list', class: 'vx-roles' });
  const preset = h('p', { class: 'vx-preset' });
  const validation = h('p', { 'data-testid': 'validation', class: 'vx-validation' });
  const start = ticket(
    'Raise the curtain',
    { 'data-testid': 'start', class: 'vx-start' },
    'primary',
  );
  const startError = h('p', { 'data-testid': 'start-error', class: 'vx-error', role: 'alert' });
  start.onclick = () => {
    startError.textContent = c.start() ?? '';
  };
  const waiting = h('p', {
    'data-testid': 'waiting',
    class: 'vx-waiting',
    text: 'Waiting for the host to raise the curtain…',
  });
  const rename = h('input', {
    'data-testid': 'rename-input',
    maxlength: 24,
    'aria-label': 'Your name',
  });
  const renameBtn = ticket('Change name', { 'data-testid': 'rename' });
  renameBtn.onclick = () => rename.value.trim() && c.rename(rename.value);
  rename.onkeydown = (e) => e.key === 'Enter' && renameBtn.click();
  const leave = ticket('Leave room', { 'data-testid': 'leave', class: 'tk-tiny' }, 'ghost');
  leave.onclick = () => c.leaveRoom();
  const help = h('button', { type: 'button', class: 'vx-tool', text: 'Help' });
  help.onclick = () => openHelp(ctx.modals);
  const hostControls = h(
    'div',
    { class: 'vx-host-controls' },
    addBot,
    h('span', { class: 'vx-fill' }, fillCount, fill),
  );
  const claude = claudePanel(c);
  const company = h('p', { class: 'vx-stage-caption' });

  const el = h(
    'main',
    { 'data-testid': 'screen-lobby', class: 'vx-lobby' },
    h(
      'section',
      { class: 'vx-lobby-stage' },
      h(
        'header',
        { class: 'vx-bar' },
        h('span', { class: 'vx-wordmark', text: 'Vesper' }),
        h('span', { class: 'vx-bar-fill' }),
        audioControls(ctx.audio),
        help,
        leave,
      ),
      h('div', { class: 'vx-stage-host' }, stage.el, bannerEl),
      company,
    ),
    h(
      'aside',
      { class: 'vx-playbill vx-paper', 'aria-label': 'Playbill' },
      h(
        'header',
        { class: 'vx-bill-title' },
        h('p', { class: 'vx-bill-kicker', text: 'Tonight at the Vesper' }),
        h('p', { class: 'vx-bill-code-label', text: 'Room' }),
        code,
        h('div', { class: 'vx-share' }, link, copy),
        net,
      ),
      h(
        'section',
        { class: 'vx-bill-section' },
        h('h2', { class: 'vx-bill-head' }, 'The company ', seatCount),
        seats,
        hostControls,
      ),
      h(
        'section',
        { class: 'vx-bill-section' },
        h('h2', { class: 'vx-bill-head', text: 'The programme' }),
        h('label', { class: 'vx-inline-label' }, 'Pace ', pace),
        preset,
        roles,
        validation,
      ),
      claude.el,
      h(
        'section',
        { class: 'vx-bill-section' },
        h('h2', { class: 'vx-bill-head', text: 'Your billing' }),
        h('div', { class: 'vx-rename' }, rename, renameBtn),
      ),
      h('footer', { class: 'vx-bill-foot' }, start, startError, waiting),
    ),
  );

  return {
    el,
    dispose: () => {
      unPrefs();
      stage.dispose();
    },
    update: (st) => {
      const s = st.session;
      const lobby = s?.lobby;
      if (!s || !lobby) return;
      ctx.root.dataset.phase = 'lobby';
      const isHost = s.isHost;
      stage.showLobby(
        lobby.seats.map((seat) => ({ id: seat.id, name: seat.name, isBot: seat.kind === 'bot' })),
      );
      setText(code, s.code);
      link.value = st.link ?? '';
      link.hidden = copy.hidden = !st.link;
      setText(net, isHost ? NETWORK_LABEL[s.network.state] : '');
      net.dataset.state = s.network.state;
      const b = bannerText(s);
      setText(bannerEl, b);
      show(bannerEl, !!b);
      setText(seatCount, `${lobby.seats.length}/${lobby.maxSeats}`);
      const missing = Math.max(0, lobby.minSeats - lobby.seats.length);
      setText(
        company,
        missing
          ? `The company assembles. ${missing} more to begin.`
          : `${lobby.seats.length} players stand behind the cloth.`,
      );
      seats.replaceChildren(
        ...lobby.seats.map((seat, i) => {
          const remove =
            isHost && seat.kind !== 'host'
              ? ticket(
                  seat.kind === 'bot' ? 'Remove' : 'Kick',
                  {
                    'data-testid': `remove-${i}`,
                    class: 'tk-tiny',
                    'aria-label': `${seat.kind === 'bot' ? 'Remove' : 'Kick'} ${seat.name}`,
                  },
                  'ghost',
                )
              : null;
          if (remove) remove.onclick = () => c.removeSeat(seat.id);
          const tags = [
            seat.kind === 'host' ? 'host' : seat.kind === 'bot' ? 'bot' : '',
            seat.id === s.you ? 'you' : '',
            seat.kind === 'human' && !seat.connected ? 'away' : '',
          ].filter(Boolean);
          return h(
            'li',
            {
              'data-testid': `seat-${i}`,
              'data-player-id': seat.id,
              'data-kind': seat.kind,
              class: seat.id === s.you ? 'is-you' : '',
            },
            h('span', { class: 'vx-seat-name', text: seat.name }),
            h('span', { class: 'vx-leader', 'aria-hidden': 'true' }),
            h('span', { class: 'vx-seat-tags', text: tags.join(', ') }),
            remove,
          );
        }),
      );
      show(hostControls, isHost);
      show(claude.el, isHost);
      if (isHost) claude.update(st);
      pace.disabled = !isHost;
      pace.value = lobby.settings.pace;
      setText(preset, lobby.presetName ? `Setup: ${lobby.presetName}` : 'Custom setup');
      roles.replaceChildren(...lobby.roles.map((r) => h('li', { text: slotName(r) })));
      setText(validation, [...lobby.validation.errors, ...lobby.validation.warnings].join(' '));
      show(start, isHost);
      start.disabled = !lobby.validation.ok;
      show(startError, isHost);
      show(waiting, !isHost);
      if (document.activeElement !== rename) {
        rename.value = lobby.seats.find((x) => x.id === s.you)?.name ?? '';
      }
    },
  };
}
