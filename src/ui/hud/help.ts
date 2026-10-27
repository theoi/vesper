import { ROLES, type PhaseKind, type PlayerView } from '../../engine/index.ts';
import { GLOSSARY, HOW_TO_PLAY, PHASE_HELP, ROLE_CARDS, fill } from '../../content/index.ts';
import { nameOf, roleName } from '../../app/format.ts';
import { h } from '../dom.ts';
import type { Prefs } from '../screens/context.ts';
import type { ModalHost } from './modal.ts';

/** How to play and the glossary, with a note on the current phase when in a game. */
export function openHelp(modals: ModalHost, phase?: PhaseKind): void {
  const now = phase ? PHASE_HELP[phase] : null;
  const content = h(
    'div',
    { class: 'vx-help' },
    now
      ? h(
          'section',
          { class: 'vx-help-now' },
          h('p', { class: 'vx-kicker', text: 'Right now' }),
          h('h3', { text: now.title }),
          h('p', { text: now.detail }),
        )
      : null,
    ...HOW_TO_PLAY.map((s) =>
      h(
        'section',
        { class: 'vx-help-section' },
        h('h3', { text: s.title }),
        ...s.body.map((p) => h('p', { text: p })),
      ),
    ),
    h(
      'section',
      { class: 'vx-help-section' },
      h('h3', { text: 'Glossary' }),
      h(
        'dl',
        { class: 'vx-glossary' },
        ...GLOSSARY.flatMap((g) => [h('dt', { text: g.term }), h('dd', { text: g.definition })]),
      ),
    ),
  );
  modals.open({ title: 'How to play', content, className: 'vx-modal-wide' });
}

export function openRoleCard(modals: ModalHost, view: PlayerView): void {
  const card = ROLE_CARDS[view.you.role];
  const def = ROLES[view.you.role];
  const you = view.you;
  const content = h(
    'article',
    { class: 'vx-rolecard', 'data-faction': def.faction },
    h('p', { class: 'vx-kicker', text: `${card.faction} · ${card.category}` }),
    h('h3', { class: 'vx-rolecard-name', text: card.name }),
    h('p', { class: 'vx-rolecard-flavor', text: card.flavor }),
    h(
      'dl',
      { class: 'vx-rolecard-facts' },
      h('dt', { text: 'Goal' }),
      h('dd', { text: card.goal }),
      h('dt', { text: 'Ability' }),
      h('dd', { text: card.ability }),
      h('dt', { text: fill('To the {augur}') }),
      h('dd', { text: `Reads ${card.reads}.${card.unique ? ' Only one per game.' : ''}` }),
    ),
    you.teammates.length
      ? h(
          'p',
          { class: 'vx-rolecard-mates' },
          `Your ${fill('{mafia}')}: `,
          you.teammates
            .map((t) => `${t.name} (${roleName(t.role)})${t.alive ? '' : ', dead'}`)
            .join('; '),
        )
      : null,
    you.accuserTarget
      ? h('p', {
          class: 'vx-rolecard-mates',
          text: `Your target: ${nameOf(view, you.accuserTarget)}`,
        })
      : null,
    card.tips.length
      ? h(
          'section',
          {},
          h('h4', { text: 'Tips' }),
          h('ul', {}, ...card.tips.map((t) => h('li', { text: t }))),
        )
      : null,
    you.alive
      ? null
      : h('p', {
          class: 'vx-rolecard-dead',
          text: 'You are dead. You can still speak with the séance.',
        }),
  );
  modals.open({ title: 'Your role', content, className: 'vx-modal-card' });
}

export function openSettings(modals: ModalHost, prefs: Prefs): void {
  const box = h('input', { type: 'checkbox', 'data-testid': 'reduced-motion' });
  box.checked = prefs.reducedMotion;
  box.onchange = () => prefs.setReducedMotion(box.checked);
  const content = h(
    'div',
    { class: 'vx-settings' },
    h(
      'label',
      { class: 'vx-check' },
      box,
      h(
        'span',
        {},
        h('strong', { text: 'Reduced motion' }),
        h('span', {
          class: 'vx-hint',
          text: 'No camera moves, no shadow travel and no flicker. Sequences become still frames.',
        }),
      ),
    ),
  );
  modals.open({ title: 'Settings', content, focus: box });
}
