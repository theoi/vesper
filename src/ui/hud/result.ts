import { nameOf, roleName } from '../../app/format.ts';
import {
  FACTIONS,
  ROLES,
  type GameResult,
  type NightRecord,
  type PlayerView,
} from '../../engine/index.ts';
import { fill } from '../../content/index.ts';
import type { SessionSnapshot } from '../../net/index.ts';
import { deathsLine, describeAction, nightsOf } from '../director/history.ts';
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

/** The curtain call: outcome, winners, the full cast with every role, and what really happened. */
export function createResult(
  ctx: UiContext,
  opts: { replay(): void },
): {
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
  const collapse = (on: boolean) => {
    el.classList.toggle('is-collapsed', on);
    hide.textContent = on ? 'Show the playbill' : 'Look at the stage';
  };
  hide.onclick = () => collapse(!el.classList.contains('is-collapsed'));
  const watch = ticket('Watch the nights', { 'data-testid': 'replay-nights' });
  watch.onclick = () => {
    collapse(true);
    opts.replay();
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
      const nights = nightsOf(view);
      const k = `${r.outcome}|${view.players.map((p) => p.role).join()}|${nights.length}`;
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
        ...(nights.length ? [epilogue(view, nights)] : []),
        h('div', { class: 'vx-curtain-actions' }, back, nights.length ? watch : null, hide),
      );
    },
  };
}

/** Night by night: every ability used and what came of it. */
function epilogue(view: PlayerView, nights: readonly NightRecord[]): HTMLElement {
  const name = (id: string) => nameOf(view, id);
  return h(
    'section',
    { class: 'vx-nights', 'data-testid': 'epilogue' },
    h('h3', { class: 'vx-bill-head', text: 'What really happened' }),
    ...nights.map((n) =>
      h(
        'details',
        { class: 'vx-night' },
        h(
          'summary',
          {},
          h('span', { class: 'vx-night-n', text: `Night ${n.night}` }),
          h('span', { class: 'vx-night-d', text: deathsLine(n, name) }),
        ),
        n.actions.length
          ? h('ol', {}, ...n.actions.map((a) => h('li', { text: describeAction(a, name) })))
          : h('p', { class: 'vx-night-quiet', text: 'Everyone stayed home.' }),
      ),
    ),
  );
}
