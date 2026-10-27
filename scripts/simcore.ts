/**
 * Headless bot-only games for the simulator and tests. This is the referee:
 * it holds the full state, feeds each bot only its own view, and checks
 * invariants independently of the engine's own logic.
 */
import {
  createBot,
  decideBot,
  pickBotNames,
  type BotSpeech,
  type BotState,
} from '../src/bots/index.ts';
import {
  ROLES,
  applyIntent,
  createGame,
  defaultConfig,
  FAST_TIMERS,
  nextDeadline,
  tick,
  viewFor,
  type GameConfig,
  type GameEvent,
  type GameResult,
  type GameState,
  type Intent,
  type PhaseKind,
  type PlayerId,
  type RoleSlot,
  type Timers,
} from '../src/engine/index.ts';

/** Markdown transcript of a finished game; `annotate` may add lines under a chat event. */
export function formatTranscript(
  s: GameState,
  title: string,
  annotate: (e: Extract<GameEvent, { type: 'chat' }>) => string[] = () => [],
): string {
  const name = (id: string | null | undefined) => s.players.find((p) => p.id === id)?.name ?? '?';
  const lines = [`# ${title}`, ``];
  lines.push(
    `Roles: ${s.players.map((p) => `${p.name} (${ROLES[p.originalRole].name})`).join(', ')}`,
    ``,
  );
  for (const e of s.log) {
    const where = `[${e.phase} ${e.day}]`;
    if (e.type === 'phase') lines.push(``, `## ${e.phase} ${e.day}`);
    else if (e.type === 'chat') {
      const who = e.from ? name(e.from) : (e.fromLabel ?? '?');
      const ch = e.channel === 'public' ? '' : ` (${e.channel}${e.to ? ` to ${name(e.to)}` : ''})`;
      if (e.audience === 'all' || e.channel !== 'dead' || e.from) {
        lines.push(`- **${who}**${ch}: ${e.text}`);
        for (const extra of annotate(e)) lines.push(`  - ${extra}`);
      }
    } else if (e.type === 'vote')
      lines.push(`- ${where} ${name(e.voter)} votes ${e.target ? name(e.target) : 'nobody'}`);
    else if (e.type === 'trial') lines.push(`- ${where} **${name(e.defendant)} is on trial**`);
    else if (e.type === 'verdict')
      lines.push(
        `- ${where} verdict: ${e.guilty ? 'GUILTY' : 'innocent'} (${e.guiltyWeight}–${e.innocentWeight})`,
      );
    else if (e.type === 'death')
      lines.push(
        `- ${where} **${name(e.player)} died** (${e.causes.join(', ')}; ${e.role ? ROLES[e.role].name : 'role hidden'})`,
      );
    else if (e.type === 'magistrateReveal')
      lines.push(`- ${where} ${name(e.player)} reveals as Magistrate`);
    else if (e.type === 'gameOver')
      lines.push(
        ``,
        `**Game over: ${e.result.outcome} (${e.result.reason}). Winners: ${e.result.winners.map(name).join(', ')}**`,
      );
  }
  return lines.join('\n') + '\n';
}

export interface SimOptions {
  seed: number;
  players: number;
  roles?: RoleSlot[];
  timers?: Timers;
  /** Abort if the game runs longer than this much game time (ms). */
  maxGameTime?: number;
  /** Keep the full log on the result (for transcripts). */
  keepState?: boolean;
}

export interface SimResult {
  seed: number;
  players: number;
  ended: boolean;
  result: GameResult | null;
  days: number;
  gameTimeMs: number;
  steps: number;
  botCalls: number;
  chatLines: number;
  rejected: number;
  rejectedSamples: string[];
  violations: string[];
  roles: Record<PlayerId, string>;
  originalRoles: Record<PlayerId, string>;
  neutral: {
    harlequinExecuted: number;
    accuserWon: number;
    drifterAlive: number;
    drifters: number;
    harlequins: number;
    accusers: number;
  };
  state?: GameState;
}

const NEXT: Record<PhaseKind, PhaseKind[]> = {
  reveal: ['discussion'],
  discussion: ['voting', 'night'],
  voting: ['defense', 'night'],
  defense: ['judgment'],
  judgment: ['lastWords', 'voting', 'night'],
  lastWords: ['execution'],
  execution: ['night', 'ended'],
  night: ['dawn'],
  dawn: ['discussion', 'ended'],
  ended: [],
};

/** Independent re-statement of the win rules, used to audit the engine's verdict. */
export function auditResult(s: GameState): string[] {
  const out: string[] = [];
  const r = s.result;
  if (!r) return ['game ended without a result'];
  const alive = s.players.filter((p) => p.alive);
  const mafia = alive.filter((p) => ROLES[p.role].faction === 'mafia');
  const cut = alive.filter((p) => p.role === 'cutthroat');
  const town = alive.filter((p) => ROLES[p.role].faction === 'town');
  const weight = (ps: typeof alive) =>
    ps.reduce((n, p) => n + (p.magistrateRevealed && p.role === 'magistrate' ? 3 : 1), 0);
  switch (r.outcome) {
    case 'town':
      if (mafia.length > 0 || cut.length > 0 || town.length === 0)
        out.push('town win with threats alive or no town');
      break;
    case 'mafia':
      if (
        mafia.length === 0 ||
        cut.length > 0 ||
        weight(mafia) < weight(alive.filter((p) => ROLES[p.role].faction !== 'mafia'))
      ) {
        out.push('mafia win without parity');
      }
      break;
    case 'cutthroat':
      if (cut.length !== 1 || mafia.length > 0 || alive.length > 2)
        out.push('cutthroat win while contested');
      break;
    case 'draw':
      if (r.reason === 'allDead' && alive.length > 0) out.push('allDead draw with survivors');
      if (r.reason === 'stalemate' && s.quietCycles < s.config.options.stalemateCycles)
        out.push('early stalemate');
      if (
        r.reason === 'threatsEliminated' &&
        (mafia.length > 0 || cut.length > 0 || town.length > 0)
      )
        out.push('bad no-town draw');
      break;
  }
  const expected = s.players
    .filter((p) => {
      const win = ROLES[p.role].win;
      if (win === 'town') return r.outcome === 'town';
      if (win === 'mafia') return r.outcome === 'mafia';
      if (win === 'cutthroat') return r.outcome === 'cutthroat' && p.alive;
      if (win === 'survive') return p.alive;
      return p.neutralWin;
    })
    .map((p) => p.id)
    .sort();
  if (JSON.stringify(expected) !== JSON.stringify(r.winners.slice().sort())) {
    out.push(`winners mismatch: expected ${expected.join(',')} got ${r.winners.join(',')}`);
  }
  out.push(...auditNights(s));
  // Harlequin wins must come from an execution; Accuser wins from the target's execution.
  for (const p of s.players) {
    if (!p.neutralWin) continue;
    if (p.role === 'harlequin' && p.death?.causes[0] !== 'executed')
      out.push('harlequin won without execution');
    if (p.role === 'accuser') {
      const target = s.players.find((x) => x.id === p.accuserTarget);
      if (target?.death?.causes[0] !== 'executed') out.push('accuser won without target execution');
    }
  }
  return out;
}

/** The end-of-game night history must agree with the dawns and deaths the players saw. */
function auditNights(s: GameState): string[] {
  const out: string[] = [];
  const dawns = s.log.filter((e) => e.type === 'dawn');
  if (dawns.length !== s.nights.length) out.push('night history and dawn count differ');
  const over = s.log.find((e) => e.type === 'gameOver');
  if (over && JSON.stringify(over.nights) !== JSON.stringify(s.nights))
    out.push('gameOver nights differ from the host record');
  s.nights.forEach((n, i) => {
    const dawn = dawns[i];
    if (n.night !== i + 1) out.push(`night history out of order at ${i + 1}`);
    if (dawn && JSON.stringify(dawn.deaths) !== JSON.stringify(n.deaths))
      out.push(`night ${n.night}: history deaths differ from the dawn`);
    for (const a of n.actions) {
      const p = s.players.find((x) => x.id === a.actor);
      const d = p?.death;
      const aliveThen = !d || d.day > n.night || (d.time === 'night' && d.day === n.night);
      if (!aliveThen) out.push(`night ${n.night}: ${a.actor} acted while dead`);
      if (a.outcome === 'killed' && !n.deaths.includes(a.target))
        out.push(`night ${n.night}: ${a.actor} killed ${a.target}, who lived`);
    }
  });
  return out;
}

/** Check one step's events against the state before and after it. */
function auditEvents(
  before: GameState,
  after: GameState,
  events: GameEvent[],
  violations: string[],
): void {
  let lastSeq = before.seq;
  const wasAlive = new Map(before.players.map((p) => [p.id, p.alive]));
  const role = new Map(after.players.map((p) => [p.id, p.role]));
  let phase = before.phase.kind;
  for (const e of events) {
    if (e.seq !== lastSeq + 1) violations.push(`seq gap at ${e.seq}`);
    lastSeq = e.seq;
    switch (e.type) {
      case 'phase':
        if (!NEXT[phase].includes(e.phase)) violations.push(`bad transition ${phase}→${e.phase}`);
        phase = e.phase;
        break;
      case 'vote':
        if (!wasAlive.get(e.voter)) violations.push(`dead voter ${e.voter}`);
        if (e.target && !wasAlive.get(e.target)) violations.push(`vote for dead ${e.target}`);
        break;
      case 'ballotCast':
        if (!wasAlive.get(e.voter)) violations.push(`dead ballot ${e.voter}`);
        break;
      case 'nightActionSet':
        if (!wasAlive.get(e.player)) violations.push(`dead night action ${e.player}`);
        break;
      case 'death':
        if (!wasAlive.get(e.player)) violations.push(`died twice ${e.player}`);
        wasAlive.set(e.player, false);
        break;
      case 'chat': {
        const aud = e.audience;
        if (
          e.channel === 'mafia' &&
          (aud === 'all' || aud.some((id) => ROLES[role.get(id) ?? 'resident'].faction !== 'mafia'))
        ) {
          violations.push('mafia chat leaked');
        }
        if (e.channel === 'dead') {
          if (aud === 'all') violations.push('dead chat to all');
          else
            for (const id of aud) {
              const p = after.players.find((x) => x.id === id);
              const mournerAtNight = p?.alive && ROLES[p.role].hearsDead && e.phase === 'night';
              if (p?.alive && !mournerAtNight) violations.push(`dead chat reached living ${id}`);
            }
          if (
            e.from &&
            wasAlive.get(e.from) &&
            !(ROLES[role.get(e.from) ?? 'resident'].hearsDead && e.phase === 'night')
          ) {
            violations.push(`living non-Mourner in dead chat ${e.from}`);
          }
        }
        if (e.channel === 'public' && e.from && !wasAlive.get(e.from) && e.phase !== 'ended') {
          violations.push(`dead player spoke publicly ${e.from}`);
        }
        if (e.channel === 'whisper' && e.from && !wasAlive.get(e.from))
          violations.push('dead whisper');
        break;
      }
      default:
        break;
    }
  }
}

/** Spot-check that a view reveals no role it should not. */
function auditView(s: GameState, id: PlayerId, violations: string[]): void {
  const v = viewFor(s, id);
  const me = s.players.find((p) => p.id === id);
  if (!me) return;
  const ended = s.phase.kind === 'ended';
  const meMafia = ROLES[me.role].faction === 'mafia';
  for (const p of v.players) {
    if (p.role === null) continue;
    const real = s.players.find((x) => x.id === p.id);
    if (!real) continue;
    const ok =
      ended ||
      p.id === id ||
      (meMafia && ROLES[real.role].faction === 'mafia') ||
      (real.death && !real.death.embalmed) ||
      real.magistrateRevealed;
    if (!ok) violations.push(`view of ${id} leaks role of ${p.id}`);
  }
  for (const e of v.events) {
    if (e.audience !== 'all' && !e.audience.includes(id))
      violations.push(`view of ${id} has foreign event`);
  }
}

/** A bot line about to be applied; the driver may rewrite or drop it. */
export interface SpeechTurn {
  botId: PlayerId;
  speech: BotSpeech;
  /** Full state at this moment (the referee's; build the bot's view from it). */
  state: GameState;
  now: number;
}

/** Bot-only game with scripted chat. */
export function runGame(opts: SimOptions): SimResult {
  const game = playGame(opts);
  let step = game.next();
  while (!step.done) step = game.next(step.value.speech.intent);
  return step.value;
}

/** Bot-only game whose lines pass through `voice` (e.g. the Claude chat layer). */
export async function runGameAsync(
  opts: SimOptions,
  voice: (turn: SpeechTurn) => Promise<Intent | null>,
): Promise<SimResult> {
  const game = playGame(opts);
  let step = game.next();
  while (!step.done) step = game.next(await voice(step.value));
  return step.value;
}

/**
 * Plays one game, yielding each bot line before it is applied. Send back the
 * intent to apply (the scripted one, a rewritten copy, or null to drop it).
 */
export function* playGame(opts: SimOptions): Generator<SpeechTurn, SimResult, Intent | null> {
  const timers = opts.timers ?? FAST_TIMERS;
  const names = pickBotNames(opts.players, opts.seed);
  const players = names.map((name, i) => ({ id: `b${i}`, name, isBot: true }));
  const base = defaultConfig(players, { timers });
  const config: GameConfig = { ...base, roles: opts.roles ?? base.roles };
  let { state } = createGame(config, opts.seed, 0);
  const bots = new Map<PlayerId, BotState>(
    players.map((p, i) => [p.id, createBot(p.id, opts.seed * 31 + i)]),
  );
  const lastPhase = new Map<PlayerId, number>();
  const violations: string[] = [];
  const rejectedSamples: string[] = [];
  let now = 0;
  let steps = 0;
  let botCalls = 0;
  let chatLines = 0;
  let rejected = 0;
  const maxGameTime = opts.maxGameTime ?? 6 * 60 * 60 * 1000;
  let endedPasses = 0;

  const apply = (id: PlayerId, intent: Intent) => {
    const before = state;
    const actorAlive = !!before.players.find((p) => p.id === id)?.alive;
    const r = applyIntent(state, id, intent, now);
    steps++;
    if (r.error) {
      rejected++;
      if (rejectedSamples.length < 5)
        rejectedSamples.push(`${before.phase.kind}:${intent.type}:${r.error}`);
      return;
    }
    const deadOk =
      intent.type === 'chat' && (intent.channel === 'dead' || before.phase.kind === 'ended');
    if (!actorAlive && !deadOk && r.events.length > 0)
      violations.push(`dead ${id} did ${intent.type}`);
    if (intent.type === 'chat' || intent.type === 'whisper') chatLines++;
    auditEvents(before, r.state, r.events, violations);
    state = r.state;
  };

  for (let guard = 0; guard < 200_000; guard++) {
    // Let every bot that is due (or whose phase changed) act at `now`.
    for (let pass = 0; pass < 20; pass++) {
      let any = false;
      for (const p of players) {
        const bot = bots.get(p.id) as BotState;
        const phaseChanged = lastPhase.get(p.id) !== state.phase.startedAt;
        // Like the host: wake a bot early when it has new events to see.
        const fresh = state.log
          .slice(bot.seenSeq)
          .some((e) => e.audience === 'all' || e.audience.includes(p.id));
        if (bot.wakeAt > now && !phaseChanged && !fresh) continue;
        lastPhase.set(p.id, state.phase.startedAt);
        const view = viewFor(state, p.id, { sinceSeq: bot.seenSeq });
        const d = decideBot(bot, view, now);
        botCalls++;
        bots.set(p.id, d.bot);
        const seqBefore = state.seq;
        for (const s of d.speech) {
          const intent = yield { botId: p.id, speech: s, state, now };
          if (intent) apply(p.id, intent);
        }
        for (const intent of d.intents) apply(p.id, intent);
        if (state.seq !== seqBefore) any = true;
      }
      if (!any) break;
    }
    if (state.phase.kind === 'ended') {
      if (endedPasses++ > 0) break;
      now += 3000;
      continue;
    }
    const deadline = nextDeadline(state) ?? now;
    let next = deadline;
    for (const b of bots.values()) if (b.wakeAt > now && b.wakeAt < next) next = b.wakeAt;
    now = Math.max(now + 1, next);
    if (now >= deadline) {
      const before = state;
      const r = tick(state, now);
      steps++;
      auditEvents(before, r.state, r.events, violations);
      state = r.state;
      if (r.events.some((e) => e.type === 'phase')) {
        const sample = state.players[Math.floor((state.seq * 7919) % state.players.length)];
        if (sample) auditView(state, sample.id, violations);
      }
    }
    if (now > maxGameTime) break;
  }
  const ended = state.phase.kind === 'ended';
  if (ended) violations.push(...auditResult(state));
  else violations.push('game did not end');
  const roles = Object.fromEntries(state.players.map((p) => [p.id, p.role]));
  const originalRoles = Object.fromEntries(state.players.map((p) => [p.id, p.originalRole]));
  const harlequins = state.players.filter(
    (p) => p.role === 'harlequin' || p.originalRole === 'harlequin',
  );
  const accusers = state.players.filter((p) => p.originalRole === 'accuser');
  const drifters = state.players.filter((p) => p.role === 'drifter');
  return {
    seed: opts.seed,
    players: opts.players,
    ended,
    result: state.result,
    days: state.phase.day,
    gameTimeMs: now,
    steps,
    botCalls,
    chatLines,
    rejected,
    rejectedSamples,
    violations,
    roles,
    originalRoles,
    neutral: {
      harlequins: harlequins.length,
      harlequinExecuted: harlequins.filter((p) => p.neutralWin).length,
      accusers: accusers.length,
      accuserWon: accusers.filter((p) => p.role === 'accuser' && p.neutralWin).length,
      drifters: drifters.length,
      drifterAlive: drifters.filter((p) => p.alive).length,
    },
    ...(opts.keepState ? { state } : {}),
  };
}
