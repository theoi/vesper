import { ROLES } from './roles.ts';
import {
  canEditDeathNote,
  canEditWill,
  canJudge,
  canReady,
  canReveal,
  chatChannels,
  isMafia,
  nightTargets,
  trialOpensAt,
  voteTargets,
  voteThreshold,
  whisperTargets,
} from './rules.ts';
import type {
  GameEvent,
  GameState,
  GraveEntry,
  PlayerId,
  PlayerState,
  PlayerView,
  PublicPlayer,
  RoleId,
  ViewOptions,
} from './types.ts';

/** Everything `playerId` may know right now. Throws for an unknown player. */
export function viewFor(state: GameState, playerId: PlayerId, opts: ViewOptions = {}): PlayerView {
  const me = state.players.find((p) => p.id === playerId);
  if (!me) throw new Error(`Unknown player ${playerId}`);
  const ended = state.phase.kind === 'ended';
  const mafiaViewer = isMafia(me);

  const knownRole = (p: PlayerState): RoleId | null => {
    if (ended) return p.role;
    if (p.id === me.id) return p.role;
    if (mafiaViewer && isMafia(p)) return p.role;
    if (p.death && !p.death.embalmed) return p.death.role;
    if (p.magistrateRevealed) return 'magistrate';
    return null;
  };

  const players: PublicPlayer[] = state.players.map((p) => ({
    id: p.id,
    name: p.name,
    seat: p.seat,
    alive: p.alive,
    isBot: p.isBot,
    magistrateRevealed: p.magistrateRevealed,
    role: knownRole(p),
  }));

  const graveyard: GraveEntry[] = state.players
    .filter((p) => p.death)
    .map((p) => {
      const d = p.death as NonNullable<PlayerState['death']>;
      const hidden = d.embalmed && !ended;
      return {
        id: p.id,
        name: p.name,
        day: d.day,
        time: d.time,
        causes: d.causes.slice(),
        role: hidden ? null : d.role,
        will: hidden ? null : d.will,
        deathNotes: d.deathNotes.slice(),
      };
    })
    .sort((a, b) => a.day - b.day || (a.time === b.time ? 0 : a.time === 'day' ? -1 : 1));

  const since = Math.max(0, opts.sinceSeq ?? 0);
  // `log[i].seq === i + 1`, so slicing by seq skips straight to new events.
  const events = eventsFor(state.log.slice(since), playerId);

  const trial = state.trial;
  const night = ROLES[me.role].night;
  const targets = nightTargets(state, me);

  return {
    you: {
      id: me.id,
      name: me.name,
      seat: me.seat,
      alive: me.alive,
      role: me.role,
      faction: ROLES[me.role].faction,
      will: me.will,
      deathNote: me.deathNote,
      usesLeft: me.usesLeft,
      selfUsesLeft: me.selfUsesLeft,
      nightTargets: state.night[me.id]?.slice() ?? null,
      vote: state.votes[me.id] ?? null,
      ballot: trial?.ballots[me.id] ?? null,
      ready: state.ready.includes(me.id),
      magistrateRevealed: me.magistrateRevealed,
      accuserTarget: me.accuserTarget,
      neutralWin: me.neutralWin,
      teammates: mafiaViewer
        ? state.players
            .filter((p) => p.id !== me.id && isMafia(p))
            .map((p) => ({ id: p.id, name: p.name, role: p.role, alive: p.alive }))
        : [],
      nightResults: me.nightResults.map((r) => ({ night: r.night, result: { ...r.result } })),
    },
    players,
    phase: { ...state.phase },
    roleList: state.config.roles.slice(),
    timers: { ...state.config.timers },
    options: { ...state.config.options },
    votes: state.phase.kind === 'voting' ? { ...state.votes } : {},
    voteThreshold: voteThreshold(state),
    trialOpensAt: trialOpensAt(state),
    trial: trial
      ? { defendant: trial.defendant, number: trial.number, voted: Object.keys(trial.ballots) }
      : null,
    trialsToday: state.trialsToday,
    graveyard,
    allowed: {
      chat: chatChannels(state, me),
      whisperTo: whisperTargets(state, me),
      voteTargets: voteTargets(state, me),
      judge: canJudge(state, me),
      nightTargets: targets,
      nightAction: targets.length > 0 && night ? night.kind : null,
      reveal: canReveal(state, me),
      will: canEditWill(state, me),
      deathNote: canEditDeathNote(state, me),
      ready: canReady(state, me),
    },
    events,
    lastSeq: state.seq,
    result: state.result ? { ...state.result, winners: state.result.winners.slice() } : null,
  };
}

/** Filter events to those `playerId` may receive. */
export function eventsFor(events: readonly GameEvent[], playerId: PlayerId): GameEvent[] {
  return events.filter((e) => e.audience === 'all' || e.audience.includes(playerId));
}
