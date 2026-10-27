import { begin, emit, finish, findPlayer, type Ctx } from './ctx.ts';
import { convertAccusers, ensureSyndicateKiller, resolveNight, type Emitter } from './night.ts';
import { ROLES, isRoleId } from './roles.ts';
import { Rng, hashSeed } from './rng.ts';
import {
  CHAT_MAX,
  DEATH_NOTE_MAX,
  WILL_MAX,
  canActTonight,
  canEditDeathNote,
  canEditWill,
  canJudge,
  canReady,
  canReveal,
  chatChannels,
  cleanBlock,
  cleanLine,
  everyoneReady,
  isMafia,
  judgmentVoters,
  nightTargets,
  tallyFor,
  voteTargets,
  voteThreshold,
  voteWeight,
  whisperTargets,
} from './rules.ts';
import { MAX_NAME_LENGTH, dealRoles, validateRoleList } from './setup.ts';
import type {
  Ballot,
  GameConfig,
  GameResult,
  GameState,
  Intent,
  IntentResult,
  PhaseKind,
  PlayerId,
  PlayerState,
  SpeechAct,
  StepResult,
  Timers,
} from './types.ts';
import { evaluateWin, makeResult } from './win.ts';

const TIMER_KEYS: (keyof Timers)[] = [
  'reveal',
  'firstDiscussion',
  'discussion',
  'voting',
  'defense',
  'judgment',
  'lastWords',
  'execution',
  'night',
  'dawn',
  'dawnPerDeath',
];

/** Throws with a readable message if the config cannot start a game. */
export function assertValidConfig(config: GameConfig): void {
  const errors: string[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const p of config.players) {
    if (typeof p.id !== 'string' || p.id === '') errors.push('Every player needs an id.');
    else if (ids.has(p.id)) errors.push(`Duplicate player id ${p.id}.`);
    ids.add(p.id);
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    if (!name) errors.push('Every player needs a name.');
    else if (names.has(name.toLowerCase())) errors.push(`Two players are named ${name}.`);
    names.add(name.toLowerCase());
  }
  const roles = validateRoleList(config.roles, config.players.length);
  errors.push(...roles.errors);
  for (const k of TIMER_KEYS) {
    const v = config.timers?.[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0)
      errors.push(`Timer ${k} is invalid.`);
  }
  const o = config.options;
  if (!o || !(o.maxTrialsPerDay >= 1) || !(o.stalemateCycles >= 1) || !(o.maxDays >= 2)) {
    errors.push('Game options are invalid.');
  }
  if (errors.length > 0) throw new Error(`Invalid game config: ${errors.join(' ')}`);
}

/**
 * Create a game in the `reveal` phase. Roles are dealt from `seed`.
 * Throws if the config is invalid (see `validateRoleList`).
 */
export function createGame(config: GameConfig, seed: number | string, now = 0): StepResult {
  assertValidConfig(config);
  const rng = new Rng(hashSeed(seed));
  const roles = dealRoles(config.roles, rng);
  const players: PlayerState[] = config.players.map((pc, seat) => {
    const role = roles[seat] as PlayerState['role'];
    const ability = ROLES[role].night;
    return {
      id: pc.id,
      name: pc.name.trim().slice(0, MAX_NAME_LENGTH),
      isBot: !!pc.isBot,
      seat,
      role,
      originalRole: role,
      alive: true,
      death: null,
      will: '',
      deathNote: '',
      usesLeft: ability?.uses ?? null,
      selfUsesLeft: ability?.selfUses ?? null,
      magistrateRevealed: false,
      accuserTarget: null,
      neutralWin: false,
      nightResults: [],
    };
  });
  for (const a of players.filter((p) => p.role === 'accuser')) {
    const town = players.filter((p) => ROLES[p.role].faction === 'town');
    const preferred = town.filter((p) => p.role !== 'magistrate');
    a.accuserTarget = rng.pick(preferred.length > 0 ? preferred : town).id;
  }
  const state: GameState = {
    v: 1,
    config: JSON.parse(JSON.stringify(config)) as GameConfig,
    rng: rng.state,
    players,
    phase: { kind: 'reveal', day: 1, startedAt: now, endsAt: now + config.timers.reveal },
    log: [],
    seq: 0,
    votes: {},
    trial: null,
    trialsToday: 0,
    votingRemaining: null,
    night: {},
    ready: [],
    quietCycles: 0,
    deathsThisCycle: 0,
    nights: [],
    result: null,
  };
  const ctx: Ctx = { s: state, rng, events: [], now };
  emit(ctx, 'all', {
    type: 'gameStart',
    players: players.map((p) => ({ id: p.id, name: p.name, seat: p.seat })),
    roleList: state.config.roles.slice(),
  });
  const mafia = players.filter(isMafia);
  for (const p of players) {
    emit(ctx, [p.id], {
      type: 'roleAssigned',
      player: p.id,
      role: p.role,
      ...(isMafia(p)
        ? { teammates: mafia.filter((m) => m.id !== p.id).map((m) => ({ id: m.id, role: m.role })) }
        : {}),
      ...(p.accuserTarget ? { accuserTarget: p.accuserTarget } : {}),
    });
  }
  emit(ctx, 'all', { type: 'phase', phase: 'reveal', day: 1, endsAt: state.phase.endsAt });
  return finish(ctx);
}

/**
 * Apply one player's intent. Invalid intents are rejected with `error` and leave
 * the state unchanged. May advance the phase (a trial majority, all ballots in,
 * everyone ready). Call `tick` first if the current phase may have expired.
 */
export function applyIntent(
  state: GameState,
  playerId: PlayerId,
  intent: Intent,
  now: number,
): IntentResult {
  if (!findPlayer(state, playerId)) return { state, events: [], error: 'Unknown player.' };
  if (!intent || typeof intent !== 'object') return { state, events: [], error: 'Bad intent.' };
  const ctx = begin(state, now);
  const me = findPlayer(ctx.s, playerId) as PlayerState;
  const error = handleIntent(ctx, me, intent);
  if (error) return { state, events: [], error };
  return finish(ctx);
}

/** Advance any phases whose timers have run out by `now`. */
export function tick(state: GameState, now: number): StepResult {
  if (state.phase.endsAt === null || now < state.phase.endsAt) return { state, events: [] };
  const ctx = begin(state, now);
  for (let i = 0; i < 32; i++) {
    const endsAt = ctx.s.phase.endsAt;
    if (endsAt === null || now < endsAt) break;
    advance(ctx);
  }
  return finish(ctx);
}

/** When the host should call `tick` next (null once the game has ended). */
export function nextDeadline(state: GameState): number | null {
  return state.phase.endsAt;
}

// ---------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------

function handleIntent(ctx: Ctx, me: PlayerState, intent: Intent): string | null {
  const s = ctx.s;
  switch (intent.type) {
    case 'chat': {
      const channel = intent.channel;
      if (!chatChannels(s, me).includes(channel))
        return `You can't post to ${String(channel)} now.`;
      const text = cleanLine(intent.text, CHAT_MAX);
      if (!text) return 'Empty message.';
      const meta = sanitizeMeta(s, intent.meta);
      const extra = meta ? { meta } : {};
      if (channel === 'public') {
        emit(ctx, 'all', { type: 'chat', channel, from: me.id, text, ...extra });
      } else if (channel === 'mafia') {
        const audience = s.players.filter((p) => p.alive && isMafia(p)).map((p) => p.id);
        emit(ctx, audience, { type: 'chat', channel, from: me.id, text, ...extra });
      } else {
        const night = s.phase.kind === 'night';
        const dead = s.players.filter((p) => !p.alive).map((p) => p.id);
        const mourners = night
          ? s.players.filter((p) => p.alive && ROLES[p.role].hearsDead).map((p) => p.id)
          : [];
        if (me.alive) {
          // The living Mourner is anonymous to everyone else in the channel.
          const others = [...dead, ...mourners.filter((id) => id !== me.id)];
          if (others.length > 0) {
            emit(ctx, others, {
              type: 'chat',
              channel,
              from: null,
              fromLabel: 'the Mourner',
              text,
              ...extra,
            });
          }
          emit(ctx, [me.id], {
            type: 'chat',
            channel,
            from: me.id,
            fromLabel: 'the Mourner',
            text,
            ...extra,
          });
        } else {
          emit(ctx, [...dead, ...mourners], { type: 'chat', channel, from: me.id, text, ...extra });
        }
      }
      return null;
    }
    case 'whisper': {
      if (!whisperTargets(s, me).includes(intent.to)) return `You can't whisper to them now.`;
      const text = cleanLine(intent.text, CHAT_MAX);
      if (!text) return 'Empty message.';
      const meta = sanitizeMeta(s, intent.meta);
      emit(ctx, [me.id, intent.to], {
        type: 'chat',
        channel: 'whisper',
        from: me.id,
        to: intent.to,
        text,
        ...(meta ? { meta } : {}),
      });
      emit(ctx, 'all', { type: 'whisperNotice', from: me.id, to: intent.to });
      return null;
    }
    case 'vote': {
      const target = intent.target ?? null;
      if (s.phase.kind !== 'voting' || !me.alive) return `You can't vote now.`;
      if (target !== null && !voteTargets(s, me).includes(target)) return 'Invalid vote target.';
      const previous = s.votes[me.id] ?? null;
      if (previous === target) return null;
      if (target === null) delete s.votes[me.id];
      else s.votes[me.id] = target;
      emit(ctx, 'all', { type: 'vote', voter: me.id, target, previous, weight: voteWeight(me) });
      if (target !== null && tallyFor(s, target) >= voteThreshold(s)) startTrial(ctx, target);
      return null;
    }
    case 'judge': {
      const ballot = intent.ballot;
      if (!canJudge(s, me)) return `You can't judge now.`;
      if (ballot !== 'guilty' && ballot !== 'innocent' && ballot !== 'abstain')
        return 'Bad ballot.';
      const trial = s.trial as NonNullable<GameState['trial']>;
      if (trial.ballots[me.id] === ballot) return null;
      trial.ballots[me.id] = ballot;
      emit(ctx, 'all', { type: 'ballotCast', voter: me.id });
      if (judgmentVoters(s).every((v) => trial.ballots[v.id] !== undefined)) concludeTrial(ctx);
      return null;
    }
    case 'night': {
      if (!canActTonight(s, me)) return `You have no action to take now.`;
      const mafiaAudience = isMafia(me)
        ? s.players.filter((p) => p.alive && isMafia(p)).map((p) => p.id)
        : null;
      const kind = ROLES[me.role].night?.kind ?? 'kill';
      if (intent.targets === null) {
        if (!s.night[me.id]) return null;
        delete s.night[me.id];
        emit(ctx, [me.id], { type: 'nightActionSet', player: me.id, targets: null });
        if (mafiaAudience)
          emit(ctx, mafiaAudience, { type: 'mafiaPick', player: me.id, kind, targets: null });
        return null;
      }
      const targets = intent.targets;
      if (!Array.isArray(targets) || targets.length !== 1) return 'Pick exactly one target.';
      const target = targets[0] as PlayerId;
      if (!nightTargets(s, me).includes(target)) return 'Invalid target.';
      if (s.night[me.id]?.[0] === target) return null;
      s.night[me.id] = [target];
      emit(ctx, [me.id], { type: 'nightActionSet', player: me.id, targets: [target] });
      if (mafiaAudience) {
        emit(ctx, mafiaAudience, { type: 'mafiaPick', player: me.id, kind, targets: [target] });
      }
      return null;
    }
    case 'reveal': {
      if (!canReveal(s, me)) return `You can't reveal now.`;
      me.magistrateRevealed = true;
      emit(ctx, 'all', { type: 'magistrateReveal', player: me.id });
      if (s.phase.kind === 'voting') {
        const target = s.votes[me.id];
        if (target && tallyFor(s, target) >= voteThreshold(s)) startTrial(ctx, target);
      }
      return null;
    }
    case 'will': {
      if (!canEditWill(s, me)) return `You can't edit your will now.`;
      me.will = cleanBlock(intent.text, WILL_MAX);
      return null;
    }
    case 'deathNote': {
      if (!canEditDeathNote(s, me)) return `You can't write a death note.`;
      me.deathNote = cleanBlock(intent.text, DEATH_NOTE_MAX);
      return null;
    }
    case 'ready': {
      if (!canReady(s, me)) return `You can't skip this phase.`;
      const on = intent.ready !== false;
      const has = s.ready.includes(me.id);
      if (on && !has) s.ready.push(me.id);
      if (!on && has) s.ready = s.ready.filter((id) => id !== me.id);
      if (everyoneReady(s)) advance(ctx);
      return null;
    }
    default:
      return 'Unknown intent.';
  }
}

const SPEECH_KINDS = new Set([
  'claim',
  'accuse',
  'defend',
  'question',
  'vote',
  'plan',
  'react',
  'banter',
]);

/** Keep a speech act only if it is well-formed and names real players and roles. */
function sanitizeMeta(s: GameState, meta: unknown): SpeechAct | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  const m = meta as Record<string, unknown>;
  if (typeof m.kind !== 'string' || !SPEECH_KINDS.has(m.kind)) return undefined;
  const ids = new Set(s.players.map((p) => p.id));
  for (const key of ['target'] as const) {
    if (m[key] !== undefined && m[key] !== null && !ids.has(m[key] as string)) return undefined;
  }
  if (m.kind === 'claim') {
    if (!isRoleId(m.role)) return undefined;
    if (m.results !== undefined) {
      if (!Array.isArray(m.results)) return undefined;
      for (const r of m.results as Record<string, unknown>[]) {
        if (!r || typeof r !== 'object' || !ids.has(r.target as string)) return undefined;
        if (
          r.visitors !== undefined &&
          (!Array.isArray(r.visitors) || r.visitors.some((v) => !ids.has(v as string)))
        ) {
          return undefined;
        }
      }
    }
  }
  if (
    (m.kind === 'accuse' || m.kind === 'defend' || m.kind === 'plan') &&
    !ids.has(m.target as string)
  ) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(meta)) as SpeechAct;
}

// ---------------------------------------------------------------------------
// Phase machine
// ---------------------------------------------------------------------------

function enterPhase(
  ctx: Ctx,
  kind: PhaseKind,
  duration: number | null,
  day = ctx.s.phase.day,
): void {
  const s = ctx.s;
  s.phase = {
    kind,
    day,
    startedAt: ctx.now,
    endsAt: duration === null ? null : ctx.now + Math.max(0, duration),
  };
  s.ready = [];
  emit(ctx, 'all', { type: 'phase', phase: kind, day, endsAt: s.phase.endsAt });
}

function advance(ctx: Ctx): void {
  const s = ctx.s;
  const t = s.config.timers;
  switch (s.phase.kind) {
    case 'reveal':
      startDiscussion(ctx);
      return;
    case 'discussion':
      if (s.phase.day === 1 && !s.config.options.firstDayVoting) startNight(ctx);
      else enterPhase(ctx, 'voting', t.voting);
      return;
    case 'voting':
      startNight(ctx);
      return;
    case 'defense':
      enterPhase(ctx, 'judgment', t.judgment);
      return;
    case 'judgment':
      concludeTrial(ctx);
      return;
    case 'lastWords':
      execute(ctx);
      return;
    case 'execution':
      if (!checkEnd(ctx)) startNight(ctx);
      return;
    case 'night':
      startDawn(ctx);
      return;
    case 'dawn':
      endDawn(ctx);
      return;
    case 'ended':
      return;
  }
}

function startDiscussion(ctx: Ctx): void {
  const s = ctx.s;
  s.votes = {};
  s.trial = null;
  s.trialsToday = 0;
  s.votingRemaining = null;
  const t = s.config.timers;
  enterPhase(ctx, 'discussion', s.phase.day === 1 ? t.firstDiscussion : t.discussion);
}

function startNight(ctx: Ctx): void {
  const s = ctx.s;
  s.votes = {};
  s.trial = null;
  s.votingRemaining = null;
  s.night = {};
  enterPhase(ctx, 'night', s.config.timers.night);
}

function startTrial(ctx: Ctx, defendant: PlayerId): void {
  const s = ctx.s;
  s.votingRemaining = Math.max(0, (s.phase.endsAt ?? ctx.now) - ctx.now);
  s.trialsToday += 1;
  s.trial = { defendant, ballots: {}, number: s.trialsToday };
  s.votes = {};
  emit(ctx, 'all', { type: 'trial', defendant, number: s.trialsToday });
  enterPhase(ctx, 'defense', s.config.timers.defense);
}

function concludeTrial(ctx: Ctx): void {
  const s = ctx.s;
  const trial = s.trial;
  if (!trial) {
    startNight(ctx);
    return;
  }
  const ballots = judgmentVoters(s).map((v) => ({
    voter: v.id,
    ballot: (trial.ballots[v.id] ?? 'abstain') as Ballot,
    weight: voteWeight(v),
  }));
  const guiltyWeight = ballots
    .filter((b) => b.ballot === 'guilty')
    .reduce((n, b) => n + b.weight, 0);
  const innocentWeight = ballots
    .filter((b) => b.ballot === 'innocent')
    .reduce((n, b) => n + b.weight, 0);
  const guilty = guiltyWeight > innocentWeight;
  emit(ctx, 'all', {
    type: 'verdict',
    defendant: trial.defendant,
    guilty,
    guiltyWeight,
    innocentWeight,
    ballots,
  });
  if (guilty) {
    enterPhase(ctx, 'lastWords', s.config.timers.lastWords);
    return;
  }
  s.trial = null;
  const remaining = s.votingRemaining ?? 0;
  if (s.trialsToday >= s.config.options.maxTrialsPerDay || remaining <= 0) startNight(ctx);
  else enterPhase(ctx, 'voting', remaining);
}

function execute(ctx: Ctx): void {
  const s = ctx.s;
  const trial = s.trial;
  enterPhase(ctx, 'execution', s.config.timers.execution);
  const d = trial ? findPlayer(s, trial.defendant) : undefined;
  s.trial = null;
  s.votes = {};
  if (!d || !d.alive) return;
  d.alive = false;
  d.death = {
    day: s.phase.day,
    time: 'day',
    causes: ['executed'],
    embalmed: false,
    deathNotes: [],
    role: d.role,
    will: d.will,
  };
  s.deathsThisCycle += 1;
  emit(ctx, 'all', {
    type: 'death',
    player: d.id,
    time: 'day',
    causes: ['executed'],
    role: d.role,
    will: d.will,
    deathNotes: [],
    embalmed: false,
  });
  if (d.role === 'harlequin') {
    d.neutralWin = true;
    emit(ctx, 'all', { type: 'neutralWin', player: d.id, role: 'harlequin' });
  }
  for (const a of s.players) {
    if (a.alive && a.role === 'accuser' && a.accuserTarget === d.id && !a.neutralWin) {
      a.neutralWin = true;
      emit(ctx, [a.id], { type: 'neutralWin', player: a.id, role: 'accuser' });
    }
  }
  const out: Emitter = (audience, body) => emit(ctx, audience, body);
  convertAccusers(ctx, [], out);
  ensureSyndicateKiller(ctx, out);
}

function startDawn(ctx: Ctx): void {
  const s = ctx.s;
  const report = resolveNight(ctx);
  s.night = {};
  const t = s.config.timers;
  enterPhase(ctx, 'dawn', t.dawn + t.dawnPerDeath * report.deaths.length, s.phase.day + 1);
  for (const e of report.pending) emit(ctx, e.audience, e.body);
}

function endDawn(ctx: Ctx): void {
  const s = ctx.s;
  if (checkEnd(ctx)) return;
  s.quietCycles = s.deathsThisCycle === 0 ? s.quietCycles + 1 : 0;
  s.deathsThisCycle = 0;
  if (s.quietCycles >= s.config.options.stalemateCycles) {
    endGame(ctx, makeResult(s, 'draw', 'stalemate'));
    return;
  }
  if (s.phase.day > s.config.options.maxDays) {
    endGame(ctx, makeResult(s, 'draw', 'dayLimit'));
    return;
  }
  startDiscussion(ctx);
}

function checkEnd(ctx: Ctx): boolean {
  const result = evaluateWin(ctx.s);
  if (!result) return false;
  endGame(ctx, result);
  return true;
}

function endGame(ctx: Ctx, result: GameResult): void {
  const s = ctx.s;
  s.result = result;
  s.votes = {};
  s.trial = null;
  s.night = {};
  emit(ctx, 'all', {
    type: 'gameOver',
    result,
    roles: Object.fromEntries(s.players.map((p) => [p.id, p.role])),
    nights: s.nights,
  });
  enterPhase(ctx, 'ended', null);
}
