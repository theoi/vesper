import { Rng } from './rng.ts';
import type {
  Audience,
  GameEvent,
  GameEventBody,
  GameState,
  PlayerId,
  PlayerState,
} from './types.ts';

/** Mutable working copy for one engine step. Never escapes the engine. */
export interface Ctx {
  s: GameState;
  rng: Rng;
  events: GameEvent[];
  now: number;
}

/**
 * Copy everything a step may mutate. `config` is never mutated and `log` is
 * append-only (rebuilt in `finish`), so both are shared with the input state.
 */
export function cloneState(s: GameState): GameState {
  return {
    ...s,
    phase: { ...s.phase },
    players: s.players.map((p) => ({
      ...p,
      death: p.death
        ? { ...p.death, causes: p.death.causes.slice(), deathNotes: p.death.deathNotes.slice() }
        : null,
      nightResults: p.nightResults.slice(),
    })),
    votes: { ...s.votes },
    trial: s.trial ? { ...s.trial, ballots: { ...s.trial.ballots } } : null,
    night: Object.fromEntries(Object.entries(s.night).map(([k, v]) => [k, v.slice()])),
    ready: s.ready.slice(),
    result: s.result ? { ...s.result, winners: s.result.winners.slice() } : null,
  };
}

export function begin(state: GameState, now: number): Ctx {
  const s = cloneState(state);
  return { s, rng: new Rng(s.rng), events: [], now };
}

export function finish(ctx: Ctx): { state: GameState; events: GameEvent[] } {
  ctx.s.rng = ctx.rng.state;
  if (ctx.events.length > 0) ctx.s.log = ctx.s.log.concat(ctx.events);
  return { state: ctx.s, events: ctx.events };
}

export function emit(ctx: Ctx, audience: Audience, body: GameEventBody): GameEvent {
  const s = ctx.s;
  s.seq += 1;
  const event = {
    seq: s.seq,
    at: ctx.now,
    day: s.phase.day,
    phase: s.phase.kind,
    audience: audience === 'all' ? 'all' : audience.slice(),
    ...body,
  } as GameEvent;
  ctx.events.push(event);
  return event;
}

export function findPlayer(s: GameState, id: PlayerId): PlayerState | undefined {
  return s.players.find((p) => p.id === id);
}
