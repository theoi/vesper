import type { AppState } from '../../app/controller.ts';
import { phaseLabel } from '../../app/format.ts';
import { ROLES } from '../../engine/index.ts';
import { h, setText, show, ticket } from '../dom.ts';
import { bannerText, type UiContext } from '../screens/context.ts';
import { audioControls } from './audio.ts';
import { openHelp, openRoleCard, openSettings } from './help.ts';

export interface TopBar {
  el: HTMLElement;
  /** Notices such as "Reconnecting"; the owner places it over the stage. */
  banner: HTMLElement;
  update(st: AppState): void;
  /** Redraw the timer (called a few times a second). */
  tick(): void;
}

export function createTopBar(ctx: UiContext, opts: { openLetters(): void }): TopBar {
  const c = ctx.controller;
  const phase = h('span', { 'data-testid': 'phase', class: 'vx-phase', 'aria-live': 'polite' });
  const burn = h('span', { class: 'vx-wick-left' });
  const secs = h('span', { class: 'vx-secs' });
  const timer = h(
    'span',
    { 'data-testid': 'timer', class: 'vx-timer', role: 'timer', 'aria-label': 'Time left' },
    h('span', { class: 'vx-wick', 'aria-hidden': 'true' }, burn),
    secs,
  );
  const youRole = h('span', { 'data-testid': 'you-role', class: 'vx-role-name' });
  const roleChip = h(
    'button',
    {
      type: 'button',
      'data-testid': 'role-card',
      class: 'vx-role-chip',
      title: 'Open your role card',
    },
    h('span', { class: 'vx-role-kicker', text: 'You are' }),
    youRole,
  );
  const claude = h('span', {
    'data-testid': 'claude-status',
    class: 'vx-claude-line',
    hidden: true,
  });
  const letters = h('button', {
    type: 'button',
    class: 'vx-tool',
    text: 'Will',
    'data-testid': 'will-open',
  });
  const help = h('button', { type: 'button', class: 'vx-tool', text: 'Help' });
  const settings = h('button', { type: 'button', class: 'vx-tool', text: 'Settings' });
  const leave = ticket('Leave', { 'data-testid': 'leave', class: 'tk-tiny' }, 'ghost');
  const banner = h('p', {
    'data-testid': 'banner',
    class: 'vx-banner',
    role: 'status',
    hidden: true,
  });

  let last: AppState | null = null;
  roleChip.onclick = () => {
    const view = last?.session?.view;
    if (view) openRoleCard(ctx.modals, view);
  };
  letters.onclick = () => opts.openLetters();
  help.onclick = () => openHelp(ctx.modals, last?.session?.view?.phase.kind);
  settings.onclick = () => openSettings(ctx.modals, ctx.prefs);
  leave.onclick = () => c.leaveRoom();

  const el = h(
    'header',
    { class: 'vx-top' },
    h('div', { class: 'vx-top-when' }, phase, timer),
    roleChip,
    claude,
    h('span', { class: 'vx-bar-fill' }),
    h(
      'nav',
      { class: 'vx-top-tools', 'aria-label': 'Game menu' },
      letters,
      help,
      audioControls(ctx.audio),
      settings,
      leave,
    ),
  );

  const tick = () => {
    const s = last?.session;
    const p = s?.view?.phase;
    if (!s || !p || p.endsAt === null) {
      show(timer, false);
      return;
    }
    show(timer, true);
    const now = Date.now() + s.clockOffset;
    const total = Math.max(1, p.endsAt - p.startedAt);
    const leftMs = Math.max(0, p.endsAt - now);
    const left = Math.ceil(leftMs / 1000);
    burn.style.width = `${Math.min(100, (leftMs / total) * 100).toFixed(2)}%`;
    setText(secs, `${left}s`);
    timer.classList.toggle('is-low', left <= 10);
  };

  return {
    el,
    banner,
    tick,
    update(st) {
      last = st;
      const s = st.session;
      const view = s?.view;
      const b = bannerText(s ?? null);
      setText(banner, b);
      show(banner, !!b);
      const cl = st.claude;
      show(claude, !!s?.isHost && cl.ready);
      claude.dataset.state = cl.status.state;
      setText(
        claude,
        `Claude: ${cl.status.state} (${cl.claudeLines}/${cl.lines} lines, ${cl.callsThisGame}/${cl.maxCallsPerGame} calls)`,
      );
      if (!view) {
        setText(phase, 'Starting…');
        tick();
        return;
      }
      setText(phase, view.phase.kind === 'night' ? `Night ${view.phase.day}` : phaseLabel(view));
      const role = ROLES[view.you.role];
      youRole.dataset.role = role.id;
      setText(youRole, role.name);
      roleChip.dataset.faction = role.faction;
      roleChip.classList.toggle('is-dead', !view.you.alive);
      setText(letters, role.deathNote ? 'Letters' : 'Will');
      tick();
    },
  };
}
