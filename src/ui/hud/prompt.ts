import { nameOf } from '../../app/format.ts';
import { fill } from '../../content/index.ts';
import { ROLES, type NightActionKind, type PlayerId, type PlayerView } from '../../engine/index.ts';
import type { PickMode } from '../contracts.ts';
import { h, setText, show, ticket } from '../dom.ts';
import type { UiContext } from '../screens/context.ts';

export interface PickState {
  mode: PickMode;
  targets: readonly PlayerId[];
  chosen: readonly PlayerId[];
}

const NIGHT_ASK: Record<NightActionKind, string> = {
  investigate: 'Choose whose shadow to read tonight.',
  watch: 'Choose whose door to watch tonight.',
  heal: 'Choose whose candle to tend tonight.',
  guard: 'Choose whose door to guard tonight.',
  shoot: 'Choose whom to shoot tonight.',
  block: 'Choose whom to distract tonight.',
  kill: fill('Choose who the {mafia} kills tonight.'),
  frame: 'Choose whose shadow to mark tonight.',
  embalm: 'Choose whose body to embalm tonight.',
  stab: 'Choose your victim tonight.',
  vest: 'Put on your vest tonight?',
};

const NIGHT_VERB: Record<NightActionKind, string> = {
  investigate: 'read',
  watch: 'watch',
  heal: 'tend',
  guard: 'guard',
  shoot: 'shoot',
  block: 'distract',
  kill: 'kill',
  frame: 'mark',
  embalm: 'embalm',
  stab: 'stab',
  vest: 'wear the vest for',
};

const OUTCOME: Record<'town' | 'mafia' | 'cutthroat' | 'draw', string> = {
  town: fill('The {town} prevails.'),
  mafia: fill('The {mafia} prevails.'),
  cutthroat: fill('The {cutthroat} stands alone.'),
  draw: 'A draw. The lamp gutters out.',
};

/** Weighted nomination votes per target. */
export function tallyVotes(view: PlayerView): Map<PlayerId, number> {
  const tally = new Map<PlayerId, number>();
  for (const [voter, target] of Object.entries(view.votes)) {
    const weight = view.players.find((p) => p.id === voter)?.magistrateRevealed ? 3 : 1;
    tally.set(target, (tally.get(target) ?? 0) + weight);
  }
  return tally;
}

function lastCondemned(view: PlayerView): PlayerId | null {
  for (let i = view.events.length - 1; i >= 0; i--) {
    const e = view.events[i];
    if (e?.type === 'verdict' && e.guilty) return e.defendant;
  }
  return null;
}

/** One sentence: what this player can do right now. */
export function promptText(view: PlayerView, pick: PickState): string {
  const n = (id: PlayerId | null | undefined) => nameOf(view, id);
  const you = view.you;
  const kind = view.phase.kind;
  if (kind === 'ended' && view.result) return OUTCOME[view.result.outcome];
  if (pick.mode === 'whisper') {
    const to = pick.chosen[0];
    return to
      ? `Whispering to ${n(to)}. The town sees that you whisper, not what.`
      : 'Click someone to whisper to them.';
  }
  if (!you.alive) {
    return kind === 'night'
      ? 'You are among the dead. Speak in the séance.'
      : 'You are among the dead. Watch, and speak in the séance.';
  }
  const defendant = view.trial?.defendant ?? null;
  switch (kind) {
    case 'reveal':
      return 'Read your role card. Press Ready when you have it by heart.';
    case 'discussion':
      return view.phase.day === 1 && !view.options.firstDayVoting
        ? 'Talk it over. Voting starts on Day 2.'
        : 'Talk it over. The vote opens soon.';
    case 'voting': {
      if (pick.mode !== 'vote') return 'The town is voting.';
      return you.vote
        ? `You vote against ${n(you.vote)}. Click them again to take it back.`
        : `Vote to put someone on trial (${view.voteThreshold} needed).`;
    }
    case 'defense':
      return defendant === you.id
        ? 'You are on trial. Make your defense.'
        : `${n(defendant)} speaks in their defense.`;
    case 'judgment':
      if (defendant === you.id) return 'The town is judging you.';
      return view.allowed.judge
        ? `Is ${n(defendant)} guilty or innocent?`
        : `The town judges ${n(defendant)}.`;
    case 'lastWords': {
      const who = defendant ?? lastCondemned(view);
      return who === you.id ? 'Your last words. Make them count.' : `${n(who)} has a final say.`;
    }
    case 'execution':
      return 'The sentence is carried out.';
    case 'night': {
      const action = view.allowed.nightAction;
      if (pick.mode === 'night' && action) {
        const chosen = you.nightTargets;
        if (!chosen?.length) return NIGHT_ASK[action];
        if (action === 'vest') return 'You will wear your vest tonight.';
        return `You will ${NIGHT_VERB[action]} ${chosen.map(n).join(' and ')} tonight.`;
      }
      if (you.faction === 'mafia') return fill('Agree on a kill in the {mafia} chat.');
      if (ROLES[you.role].hearsDead) return 'The dead are near. Speak with them in the séance.';
      return 'The town sleeps. Wait for dawn.';
    }
    case 'dawn':
      return 'See who survived the night.';
    default:
      return '';
  }
}

export interface PromptBar {
  el: HTMLElement;
  update(view: PlayerView, pick: PickState, whisperOpen: boolean): void;
}

export function createPromptBar(
  ctx: UiContext,
  opts: { pick(id: PlayerId): void; toggleWhisper(): void },
): PromptBar {
  const c = ctx.controller;
  const cue = h('p', { class: 'vx-cue', 'aria-live': 'polite' });
  const meterFill = h('span', { class: 'vx-meter-fill' });
  const meterLabel = h('span', { class: 'vx-meter-label' });
  const meter = h(
    'div',
    { class: 'vx-meter', hidden: true },
    h('span', { class: 'vx-meter-bar', 'aria-hidden': 'true' }, meterFill),
    meterLabel,
  );
  const targets = h('div', { class: 'vx-targets', role: 'group', 'aria-label': 'Choose a player' });
  const trial = h('section', { 'data-testid': 'trial', class: 'vx-trial', hidden: true });
  const trialWho = h('span', { class: 'vx-trial-who' });
  const trialCount = h('span', { class: 'vx-trial-count' });
  const judge = (
    ballot: 'guilty' | 'innocent' | 'abstain',
    label: string,
    kind: 'danger' | 'plain' | 'ghost',
  ) => {
    const b = ticket(label, { 'data-testid': `judge-${ballot}` }, kind);
    b.onclick = () => c.judge(ballot);
    return b;
  };
  const guilty = judge('guilty', 'Guilty', 'danger');
  const innocent = judge('innocent', 'Innocent', 'plain');
  const abstain = judge('abstain', 'Abstain', 'ghost');
  trial.append(
    h('div', { class: 'vx-trial-head' }, trialWho, trialCount),
    h('div', { class: 'vx-trial-ballots' }, guilty, innocent, abstain),
  );

  const whisper = ticket('Whisper', { class: 'vx-whisper-btn' });
  whisper.onclick = () => opts.toggleWhisper();
  const clearVote = ticket('Withdraw vote', { 'data-testid': 'clear-vote' }, 'ghost');
  clearVote.onclick = () => c.vote(null);
  const clearNight = ticket('Cancel night action', { 'data-testid': 'clear-night' }, 'ghost');
  clearNight.onclick = () => c.nightAction(null);
  const reveal = ticket('Reveal as Magistrate', { 'data-testid': 'reveal' }, 'primary');
  reveal.onclick = () => c.reveal();
  const ready = ticket('Ready', {
    'data-testid': 'ready',
    title: 'End this phase early once everyone is ready',
  });
  let view: PlayerView | null = null;
  ready.onclick = () => view && c.ready(!view.you.ready);

  const el = h(
    'footer',
    { class: 'vx-prompt', 'aria-label': 'What you can do now' },
    h('div', { class: 'vx-prompt-main' }, cue, meter),
    targets,
    trial,
    h('div', { class: 'vx-actions' }, whisper, clearVote, clearNight, reveal, ready),
  );

  let targetsKey = '';
  return {
    el,
    update(v, pick, whisperOpen) {
      view = v;
      el.dataset.mode = pick.mode;
      setText(cue, promptText(v, pick));
      const you = v.you;

      const voting = v.phase.kind === 'voting';
      show(meter, voting);
      const tally = tallyVotes(v);
      if (voting) {
        let top: PlayerId | null = null;
        let most = 0;
        for (const [id, w] of tally) if (w > most) [top, most] = [id, w];
        meterFill.style.width = `${Math.min(100, (most / Math.max(1, v.voteThreshold)) * 100)}%`;
        setText(
          meterLabel,
          top ? `${nameOf(v, top)} ${most}/${v.voteThreshold}` : `0/${v.voteThreshold} votes`,
        );
      }

      const key = `${pick.mode}|${pick.targets.join()}|${pick.chosen.join()}|${[...tally].join()}`;
      if (key !== targetsKey) {
        targetsKey = key;
        const prefix = pick.mode === 'vote' ? 'vote' : pick.mode === 'night' ? 'night' : null;
        targets.replaceChildren(
          ...pick.targets.map((id) => {
            const p = v.players.find((x) => x.id === id);
            const chosen = pick.chosen.includes(id);
            const votes = pick.mode === 'vote' ? tally.get(id) : undefined;
            const b = h(
              'button',
              {
                type: 'button',
                class: `vx-target${chosen ? ' is-chosen' : ''}`,
                'data-testid': prefix && p ? `${prefix}-${p.seat}` : undefined,
                'aria-pressed': String(chosen),
              },
              h('span', { text: p?.id === you.id ? `${p.name} (you)` : (p?.name ?? id) }),
              votes ? h('span', { class: 'vx-target-votes', text: String(votes) }) : null,
            );
            b.onclick = () => opts.pick(id);
            return b;
          }),
        );
      }
      show(targets, pick.mode !== 'none');

      show(trial, !!v.trial);
      if (v.trial) {
        const condemned = v.phase.kind === 'lastWords' || v.phase.kind === 'execution';
        setText(
          trialWho,
          `${condemned ? 'Condemned' : 'On trial'}: ${nameOf(v, v.trial.defendant)}`,
        );
        const voted = v.trial.voted.length;
        setText(
          trialCount,
          v.phase.kind === 'judgment' ? `${voted} ballot${voted === 1 ? '' : 's'} cast` : '',
        );
        const judging = v.phase.kind === 'judgment' && v.trial.defendant !== you.id && you.alive;
        for (const [b, ballot] of [
          [guilty, 'guilty'],
          [innocent, 'innocent'],
          [abstain, 'abstain'],
        ] as const) {
          b.disabled = !v.allowed.judge;
          b.classList.toggle('is-chosen', you.ballot === ballot);
          b.setAttribute('aria-pressed', String(you.ballot === ballot));
          show(b, judging);
        }
      }

      // During a trial the bar is crowded; the Whisper tab in the chat still works.
      show(whisper, v.allowed.whisperTo.length > 0 && (!v.trial || whisperOpen));
      setText(whisper, whisperOpen ? 'Cancel whisper' : 'Whisper');
      show(clearVote, !!you.vote);
      show(clearNight, !!you.nightTargets && v.allowed.nightTargets.length > 0);
      show(reveal, v.allowed.reveal);
      show(ready, v.allowed.ready);
      setText(ready, you.ready ? 'Ready ✓' : 'Ready');
      ready.title = you.ready
        ? 'You are ready. Click again to take it back.'
        : 'End this phase early once everyone is ready';
      ready.setAttribute('aria-pressed', String(you.ready));
      ready.classList.toggle('is-chosen', you.ready);
    },
  };
}
