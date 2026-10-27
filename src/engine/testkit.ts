/**
 * Test helpers: build games with roles pinned to seats and drive them quickly.
 * Not used by production code.
 */
import { applyIntent, createGame, tick } from './game.ts';
import { ROLES } from './roles.ts';
import { DEFAULT_OPTIONS } from './setup.ts';
import type {
  GameEvent,
  GameOptions,
  GameState,
  Intent,
  NightResult,
  PhaseKind,
  PlayerId,
  RoleId,
  Timers,
} from './types.ts';

export const NAMES = [
  'Ada',
  'Bea',
  'Cal',
  'Dov',
  'Eli',
  'Fay',
  'Gus',
  'Hal',
  'Ivy',
  'Jo',
  'Kit',
  'Lu',
  'Max',
  'Nell',
  'Oz',
  'Pia',
];

export const TEST_TIMERS: Timers = {
  reveal: 1000,
  firstDiscussion: 1000,
  discussion: 1000,
  voting: 10_000,
  defense: 1000,
  judgment: 1000,
  lastWords: 1000,
  execution: 1000,
  night: 1000,
  dawn: 1000,
  dawnPerDeath: 0,
};

/**
 * A game whose seat i holds roles[i]. Player ids are 'p0', 'p1', ...
 * The deal is overridden after creation, so any list that passes validation
 * when shuffled works.
 */
export function pinnedGame(
  roles: RoleId[],
  options: Partial<GameOptions> = {},
  accuserTarget?: PlayerId,
): GameState {
  const players = roles.map((_, i) => ({ id: `p${i}`, name: NAMES[i] as string, isBot: true }));
  const { state } = createGame(
    { players, roles, timers: TEST_TIMERS, options: { ...DEFAULT_OPTIONS, ...options } },
    1,
    0,
  );
  const firstTown = roles.findIndex((r) => ROLES[r].faction === 'town');
  state.players = state.players.map((p, i) => {
    const role = roles[i] as RoleId;
    const ability = ROLES[role].night;
    return {
      ...p,
      role,
      originalRole: role,
      usesLeft: ability?.uses ?? null,
      selfUsesLeft: ability?.selfUses ?? null,
      accuserTarget: role === 'accuser' ? (accuserTarget ?? `p${firstTown}`) : null,
    };
  });
  // Keep the private role events consistent with the pinned seats.
  const mafia = state.players.filter((p) => ROLES[p.role].faction === 'mafia');
  state.log = state.log.map((e) => {
    if (e.type !== 'roleAssigned') return e;
    const p = state.players.find((x) => x.id === e.player);
    if (!p) return e;
    const { teammates: _t, accuserTarget: _a, ...rest } = e;
    return {
      ...rest,
      role: p.role,
      ...(ROLES[p.role].faction === 'mafia'
        ? { teammates: mafia.filter((m) => m.id !== p.id).map((m) => ({ id: m.id, role: m.role })) }
        : {}),
      ...(p.accuserTarget ? { accuserTarget: p.accuserTarget } : {}),
    };
  });
  return state;
}

export interface Driver {
  state: GameState;
  events: GameEvent[];
}

/** Apply an intent at the current phase start + 1ms; throws on rejection. */
export function act(d: Driver, id: PlayerId, intent: Intent): Driver {
  const r = applyIntent(d.state, id, intent, d.state.phase.startedAt + 1);
  if (r.error) throw new Error(`${id} ${intent.type}: ${r.error}`);
  return { state: r.state, events: [...d.events, ...r.events] };
}

export function tryAct(d: Driver, id: PlayerId, intent: Intent): string | undefined {
  return applyIntent(d.state, id, intent, d.state.phase.startedAt + 1).error;
}

/** Fire the current phase's timer once. */
export function step(d: Driver): Driver {
  const endsAt = d.state.phase.endsAt;
  if (endsAt === null) return d;
  const r = tick(d.state, endsAt);
  return { state: r.state, events: [...d.events, ...r.events] };
}

/** Fire timers until the phase is `kind` (throws after many steps). */
export function until(d: Driver, kind: PhaseKind, day?: number): Driver {
  let cur = d;
  for (let i = 0; i < 200; i++) {
    if (cur.state.phase.kind === kind && (day === undefined || cur.state.phase.day === day)) {
      return cur;
    }
    if (cur.state.phase.kind === 'ended') throw new Error(`Game ended before ${kind}`);
    cur = step(cur);
  }
  throw new Error(`Never reached ${kind}`);
}

export function start(state: GameState): Driver {
  return { state, events: [] };
}

/** Submit night actions (actor → target), then resolve to dawn. */
export function runNight(d: Driver, actions: Record<PlayerId, PlayerId>): Driver {
  let cur = until(d, 'night');
  for (const [actor, target] of Object.entries(actions)) {
    cur = act(cur, actor, { type: 'night', targets: [target] });
  }
  return step(cur);
}

export function resultsFor(d: Driver, id: PlayerId): NightResult[] {
  const p = d.state.players.find((x) => x.id === id);
  const night = d.state.phase.day - 1;
  return (p?.nightResults ?? []).filter((r) => r.night === night).map((r) => r.result);
}

export function alive(d: Driver, id: PlayerId): boolean {
  return !!d.state.players.find((p) => p.id === id)?.alive;
}

/** Put `defendant` on trial by having every listed voter vote for them. */
export function putOnTrial(d: Driver, defendant: PlayerId, voters: PlayerId[]): Driver {
  let cur = until(d, 'voting');
  for (const v of voters) {
    if (cur.state.phase.kind !== 'voting') break;
    cur = act(cur, v, { type: 'vote', target: defendant });
  }
  return cur;
}

/** Trial + judgment with the given ballots, ending after the verdict. */
export function judge(
  d: Driver,
  ballots: Record<PlayerId, 'guilty' | 'innocent' | 'abstain'>,
): Driver {
  let cur = until(d, 'judgment');
  for (const [v, b] of Object.entries(ballots)) {
    if (cur.state.phase.kind !== 'judgment') break;
    cur = act(cur, v, { type: 'judge', ballot: b });
  }
  if (cur.state.phase.kind === 'judgment') cur = step(cur);
  return cur;
}
