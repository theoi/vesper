import { nameOf, roleName } from '../../app/format.ts';
import { FACTIONS, ROLES, type GameResult, type PlayerView } from '../../engine/index.ts';
import { fill } from '../../content/index.ts';
import type { SessionSnapshot } from '../../net/index.ts';
import { h, show, ticket } from '../dom.ts';
import type { UiContext } from '../screens/context.ts';

const HEADLINE: Record<GameResult['outcome'], string> = {
  town: fill('The {town} prevails'),
  mafia: fill('The {mafia} prevails'),
  cutthroat: fill('The {cutthroat} stands alone'),
  draw: 'A draw',
};

const REASON: Record<GameResult['reason'], string> = {
  threatsEliminated: 'Every threat to the town is gone.',
  mafiaParity: fill('The {mafia} has the numbers now.'),
  lastKillerStanding: 'One killer is left standing.',
  allDead: 'Nobody is left alive.',
  stalemate: 'Three quiet days and nights in a row.',
  dayLimit: 'The town ran out of days.',
};

/** The curtain call: outcome, winners, and the full cast with every role. */
export function createResult(ctx: UiContext): {
  el: HTMLElement;
  update(view: PlayerView, session: SessionSnapshot): void;
} {
  const c = ctx.controller;
  const back = ticket('Back to lobby', { 'data-testid': 'back-to-lobby', hidden: true }, 'primary');
  back.onclick = () => c.backToLobby();
  const body = h('div', { class: 'vx-curtain-card vx-paper' });
  const hide = h('button', {
    type: 'button',
    class: 'vx-link vx-curtain-toggle',
    text: 'Look at the stage',
  });
  const el = h('section', { 'data-testid': 'result', class: 'vx-curtain', hidden: true }, body);
  hide.onclick = () => {
    const collapsed = el.classList.toggle('is-collapsed');
    hide.textContent = collapsed ? 'Show the playbill' : 'Look at the stage';
  };
  let key = '';
  return {
    el,
    update(view, s) {
      const r = view.result;
      show(el, !!r);
      show(back, s.isHost && s.status === 'ended');
      if (!r) return;
      el.dataset.outcome = r.outcome;
      const k = `${r.outcome}|${view.players.map((p) => p.role).join()}`;
      if (k === key) return;
      key = k;
      const winners = new Set(r.winners);
      const youWon = winners.has(view.you.id);
      body.replaceChildren(
        h('p', { class: 'vx-bill-kicker', text: 'Curtain call' }),
        h('h2', { class: 'vx-curtain-head', text: HEADLINE[r.outcome] }),
        h('p', { class: 'vx-curtain-reason', text: REASON[r.reason] }),
        h('p', {
          class: `vx-curtain-you ${youWon ? 'is-won' : 'is-lost'}`,
          text: youWon ? 'You are among the winners.' : 'You did not win this time.',
        }),
        h(
          'p',
          { class: 'vx-curtain-winners' },
          'Winners: ',
          r.winners.map((id) => nameOf(view, id)).join(', ') || 'nobody',
        ),
        h('h3', { class: 'vx-bill-head', text: 'The cast' }),
        h(
          'ol',
          { class: 'vx-cast' },
          ...view.players.map((p) => {
            const faction = p.role ? ROLES[p.role].faction : 'town';
            return h(
              'li',
              {
                class: `${winners.has(p.id) ? 'is-won' : 'is-lost'}${p.alive ? '' : ' is-dead'}`,
                'data-faction': faction,
              },
              h('span', { class: 'vx-cast-candle', 'aria-hidden': 'true' }),
              h('span', {
                class: 'vx-cast-name',
                text: p.id === view.you.id ? `${p.name} (you)` : p.name,
              }),
              h('span', { class: 'vx-leader', 'aria-hidden': 'true' }),
              h('span', { class: 'vx-cast-role', text: `${roleName(p.role)}` }),
              h('span', { class: 'vx-cast-faction', text: FACTIONS[faction].name }),
            );
          }),
        ),
        h('div', { class: 'vx-curtain-actions' }, back, hide),
      );
    },
  };
}
