import {
  ROLES,
  type GameEvent,
  type PlayerId,
  type PlayerView,
  type RoleId,
} from '../engine/index.ts';

/** Plain-text descriptions of game state for the shell UI and tests. */

export function roleName(role: RoleId | null | undefined): string {
  return role ? ROLES[role].name : 'Unknown';
}

export function nameOf(view: PlayerView, id: PlayerId | null | undefined): string {
  if (!id) return 'someone';
  return view.players.find((p) => p.id === id)?.name ?? id;
}

const PHASE_NAMES: Record<string, string> = {
  reveal: 'Role reveal',
  discussion: 'Discussion',
  voting: 'Voting',
  defense: 'Defense',
  judgment: 'Judgment',
  lastWords: 'Last words',
  execution: 'Execution',
  night: 'Night',
  dawn: 'Dawn',
  ended: 'Game over',
};

export function phaseLabel(view: PlayerView): string {
  const { kind, day } = view.phase;
  if (kind === 'ended') return PHASE_NAMES.ended!;
  const when = kind === 'night' ? `Night ${day}` : `Day ${day}`;
  return `${when} · ${PHASE_NAMES[kind] ?? kind}`;
}

export function describeEvent(view: PlayerView, e: GameEvent): string | null {
  const n = (id: PlayerId | null | undefined) => nameOf(view, id);
  switch (e.type) {
    case 'gameStart':
      return `The game begins with ${e.players.length} players.`;
    case 'roleAssigned': {
      const mates = e.teammates?.length
        ? ` Your Syndicate: ${e.teammates.map((t) => `${n(t.id)} (${roleName(t.role)})`).join(', ')}.`
        : '';
      const target = e.accuserTarget ? ` Your target: ${n(e.accuserTarget)}.` : '';
      return `You are the ${roleName(e.role)}.${mates}${target}`;
    }
    case 'phase':
      return `— ${phaseLabel({ ...view, phase: { ...view.phase, kind: e.phase, day: e.day } })} —`;
    case 'chat': {
      const who = e.from ? n(e.from) : (e.fromLabel ?? 'someone');
      const where =
        e.channel === 'public'
          ? ''
          : e.channel === 'whisper'
            ? ` (whisper to ${n(e.to)})`
            : ` [${e.channel === 'mafia' ? 'Syndicate' : 'dead'}]`;
      return `${who}${where}: ${e.text}`;
    }
    case 'whisperNotice':
      return `${n(e.from)} whispers to ${n(e.to)}.`;
    case 'vote':
      return e.target
        ? `${n(e.voter)} votes against ${n(e.target)}.`
        : `${n(e.voter)} withdraws their vote.`;
    case 'trial':
      return `${n(e.defendant)} is put on trial.`;
    case 'ballotCast':
      return `${n(e.voter)} has voted.`;
    case 'verdict':
      return `${n(e.defendant)} is found ${e.guilty ? 'guilty' : 'innocent'} (${e.guiltyWeight} guilty, ${e.innocentWeight} innocent).`;
    case 'magistrateReveal':
      return `${n(e.player)} reveals as the Magistrate.`;
    case 'nightActionSet':
      return e.targets
        ? `You target ${e.targets.map(n).join(', ')} tonight.`
        : 'You cancel your action.';
    case 'mafiaPick':
      return e.targets
        ? `${n(e.player)} picks ${e.targets.map(n).join(', ')} (${e.kind}).`
        : `${n(e.player)} cancels their pick.`;
    case 'death': {
      const role = e.embalmed ? 'role hidden' : roleName(e.role);
      const will = e.will ? ` Their will: "${e.will}"` : '';
      return `${n(e.player)} died (${e.causes.join(', ')}). ${role}.${will}`;
    }
    case 'dawn':
      return e.deaths.length === 0 ? 'Nobody died last night.' : null;
    case 'nightResult':
      return `Night ${e.night}: ${describeResult(view, e.result)}`;
    case 'roleChanged':
      return `You are now the ${roleName(e.to)}.`;
    case 'neutralWin':
      return `${n(e.player)} (${roleName(e.role)}) has achieved their goal.`;
    case 'gameOver':
      return `Game over: ${e.result.outcome} (${e.result.reason}).`;
  }
}

function describeResult(
  view: PlayerView,
  r: Extract<GameEvent, { type: 'nightResult' }>['result'],
) {
  const n = (id: PlayerId) => nameOf(view, id);
  switch (r.kind) {
    case 'investigation':
      return `${n(r.target)} looks ${r.finding}.`;
    case 'visitors':
      return r.visitors.length
        ? `${n(r.target)} was visited by ${r.visitors.map(n).join(', ')}.`
        : `Nobody visited ${n(r.target)}.`;
    case 'blocked':
      return 'You were distracted and could not act.';
    case 'attackedSurvived':
      return `You were attacked but survived (${r.savedBy}).`;
    case 'patientAttacked':
      return `${n(r.target)} was attacked${r.saved ? ' and you saved them' : ''}.`;
    case 'guardFought':
      return `You fought off an attacker at ${n(r.target)}'s door.`;
    case 'targetSurvived':
      return `${n(r.target)} survived your attack.`;
    case 'reckonerGuilt':
      return `You shot ${n(r.target)}, who was innocent.`;
    case 'embalmed':
      return `You embalmed ${n(r.target)} (${roleName(r.role)}).`;
    case 'vestUsed':
      return 'You put on your vest.';
    case 'noAction':
      return 'You stayed home.';
  }
}
