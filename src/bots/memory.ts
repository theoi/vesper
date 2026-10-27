/** Event ingestion: updates a bot's memory from the events in its own view. */
import type { Rng } from '../engine/rng.ts';
import { ROLES } from '../engine/roles.ts';
import type {
  ClaimedResult,
  GameEvent,
  PlayerId,
  PlayerView,
  RoleId,
  SpeechAct,
} from '../engine/types.ts';
import {
  bump,
  cred,
  holdsClear,
  knowsInnocent,
  maxCopies,
  normalize,
  possible,
  score,
  sideOf,
} from './knowledge.ts';
import { askOf, parseLine, parseWill } from './parse.ts';
import type { BotMemory, BotState, Topic } from './types.ts';

export interface Mind {
  bot: BotState;
  mem: BotMemory;
  view: PlayerView;
  rng: Rng;
  now: number;
  /** Time of the event being ingested. */
  at: number;
  /** Reactions raised during this call, re-queued after phase planning. */
  reactive: { topic: Topic; at: number }[];
}

const POWER: RoleId[] = [
  'augur',
  'lamplighter',
  'mender',
  'sentinel',
  'reckoner',
  'magistrate',
  'mourner',
];

function me(m: Mind): PlayerId {
  return m.view.you.id;
}

function day(m: Mind): number {
  return m.view.phase.day;
}

function side(m: Mind) {
  return sideOf(m.mem.role ?? m.view.you.role);
}

/** React later (when public chat opens) unless already covered. */
function later(m: Mind, key: string, topic: Topic): void {
  if (m.mem.topics.includes(key)) return;
  m.mem.topics.push(key);
  m.mem.pending.push(topic);
}

/** React now: front of the current queue (if the phase it belongs to is still on). */
function soon(m: Mind, key: string, topic: Topic): void {
  if (m.mem.topics.includes(key)) return;
  m.mem.topics.push(key);
  m.reactive.push({ topic, at: m.at });
}

/** React now if the event happened in this day's open talk, else when public chat next opens. */
function react(m: Mind, key: string, topic: Topic): void {
  const k = m.view.phase.kind;
  const open = k === 'discussion' || k === 'voting';
  if (open && m.at >= m.view.phase.startedAt && m.view.you.alive) soon(m, key, topic);
  else later(m, key, topic);
}

export function ingest(m: Mind, e: GameEvent): void {
  const mem = m.mem;
  const self = me(m);
  switch (e.type) {
    case 'roleAssigned':
      if (e.player === self) {
        mem.role = e.role;
        mem.teammates = (e.teammates ?? []).map((t) => t.id);
      }
      return;
    case 'roleChanged':
      if (e.player === self) mem.role = e.to;
      return;
    case 'phase':
      if (e.phase === 'night') mem.mafiaPicks = {};
      if (e.phase === 'discussion') {
        mem.msgs = {};
        mem.dayVotes = {};
        mem.heat = Math.max(0, mem.heat * 0.4);
      }
      return;
    case 'chat':
      onChat(m, e);
      return;
    case 'vote': {
      if (e.target === null) delete mem.dayVotes[e.voter];
      else {
        delete mem.dayVotes[e.voter];
        mem.dayVotes[e.voter] = e.target;
      }
      if (e.voter === self || e.target === null) return;
      if (e.target === self) {
        mem.heat += 0.5;
        if (knowsInnocent(side(m))) bump(mem, e.voter, 0.6, 'accusedMe', undefined, day(m));
      } else if (mem.known[e.target] === 'town') {
        bump(mem, e.voter, 1.5, 'gut', undefined, day(m));
      } else if (mem.known[e.target] === 'hostile') {
        bump(mem, e.voter, -0.5);
      }
      return;
    }
    case 'trial': {
      mem.wagons[e.defendant] = Object.entries(mem.dayVotes)
        .filter(([, t]) => t === e.defendant)
        .map(([v]) => v);
      mem.dayVotes = {};
      if (e.defendant === self) mem.heat += 2;
      if (e.defendant !== self)
        soon(m, `trialReact:${e.defendant}:${e.seq}`, { t: 'trialReact', target: e.defendant });
      return;
    }
    case 'verdict': {
      const guilty = e.ballots.filter((b) => b.ballot === 'guilty').map((b) => b.voter);
      const innocent = e.ballots.filter((b) => b.ballot === 'innocent').map((b) => b.voter);
      mem.ballots[e.defendant] = { guilty, innocent };
      const k = mem.known[e.defendant];
      if (k === 'hostile') for (const v of innocent) bump(mem, v, 2, 'gut', undefined, day(m));
      if (k === 'town')
        for (const v of guilty) if (v !== self) bump(mem, v, 1.5, 'gut', undefined, day(m));
      return;
    }
    case 'death':
      onDeath(m, e);
      return;
    case 'dawn':
      if (e.deaths.length === 0) {
        later(m, `quiet:${e.day}`, { t: 'quietNight' });
        mem.flags.quietDawns = (mem.flags.quietDawns ?? 0) + (mem.flags.execToday ? 0 : 1);
      } else {
        mem.flags.quietDawns = 0;
      }
      mem.flags.execToday = 0;
      return;
    case 'magistrateReveal':
      mem.known[e.player] = 'town';
      if (e.player !== self)
        later(m, `mag:${e.player}`, { t: 'magistrateReact', target: e.player });
      return;
    case 'nightResult':
      if (e.player === self) onResult(m, e);
      return;
    case 'mafiaPick':
      if (e.player !== self) {
        if (e.targets?.[0]) mem.mafiaPicks[e.player] = e.targets[0];
        else delete mem.mafiaPicks[e.player];
      }
      return;
    default:
      return;
  }
}

function onChat(m: Mind, e: Extract<GameEvent, { type: 'chat' }>): void {
  const mem = m.mem;
  const self = me(m);
  if (e.channel === 'public' && e.from) {
    mem.msgs[e.from] = (mem.msgs[e.from] ?? 0) + 1;
    mem.heard.push(normalize(e.text));
    if (mem.heard.length > 40) mem.heard.splice(0, mem.heard.length - 40);
    mem.room = mem.room.filter((at) => at > e.at - 10_000);
    mem.room.push(e.at);
    if (e.meta?.kind === 'question' && e.meta.target) mem.flags[`asked:${e.meta.target}`] = day(m);
    if (e.meta?.kind === 'react' && e.meta.about === 'death' && e.meta.target) {
      const key = `reacted:${e.meta.target}`;
      mem.flags[key] = (mem.flags[key] ?? 0) + 1;
    }
  }
  if (e.channel === 'dead' && m.view.you.alive && e.from && e.from !== self) {
    // Living Mourner: collect tips from the dead.
    const acts = e.meta ? [e.meta] : parseLine(e.text, m.view.players, e.from);
    for (const a of acts) {
      if (a.kind === 'accuse')
        mem.deadTips.push({ target: a.target, finding: 'named by the dead' });
      if (a.kind === 'claim') {
        for (const r of a.results ?? []) {
          if (r.finding === 'suspicious')
            mem.deadTips.push({ target: r.target, finding: 'read Suspicious' });
        }
      }
    }
    return;
  }
  if (e.channel !== 'public' || !e.from || e.from === self) return;
  const from = e.from;
  const acts: SpeechAct[] = e.meta ? [e.meta] : parseLine(e.text, m.view.players, from);
  for (const a of acts) applyAct(m, from, a, e.text, !e.meta);
}

/** `human`: the line came as free text, without a speech act. */
function applyAct(m: Mind, from: PlayerId, a: SpeechAct, text: string, human: boolean): void {
  const mem = m.mem;
  const self = me(m);
  const d = day(m);
  switch (a.kind) {
    case 'claim':
      onClaim(m, from, a.role, a.results ?? []);
      return;
    case 'accuse': {
      const list = mem.accusedBy[a.target] ?? [];
      if (!list.includes(from)) list.push(from);
      mem.accusedBy[a.target] = list;
      // Someone put a name forward during the vote: the room has its push for today.
      if (m.view.phase.kind === 'voting') {
        mem.flags.pushDay = d;
        mem.flags.pushTarget = m.view.players.findIndex((p) => p.id === a.target);
      }
      if (a.target === self) {
        mem.heat += a.confidence;
        if (knowsInnocent(side(m))) {
          bump(
            mem,
            from,
            1 + (m.bot.personality.temperament === 'fiery' ? 0.6 : 0),
            'accusedMe',
            undefined,
            d,
          );
        }
        soon(m, `defend:${from}:${d}`, { t: 'defendSelf', accuser: from });
        // Turn it around on an accuser we already distrust.
        const s = score(mem, from);
        if (s >= 3 && !mem.teammates.includes(from) && !holdsClear(m.view, mem, from))
          soon(m, `counter:${from}:${d}`, { t: 'accuse', target: from, hard: s >= 7 });
      } else if (!mem.teammates.includes(a.target)) {
        bump(mem, a.target, 0.7 * a.confidence * cred(m.bot, mem, from));
        if (mem.known[a.target] === 'hostile') bump(mem, from, -0.4);
        if (mem.known[a.target] === 'town') bump(mem, from, 1, 'gut', undefined, d);
      }
      return;
    }
    case 'defend': {
      const list = mem.defendedBy[a.target] ?? [];
      if (!list.includes(from)) list.push(from);
      mem.defendedBy[a.target] = list;
      if (mem.known[a.target] === 'hostile') bump(mem, from, 2, 'gut', undefined, d);
      return;
    }
    case 'question': {
      const ask = askOf(text);
      const phase = m.view.phase.kind;
      if (a.target === self || (text.includes('?') && mentionsMe(m, text))) {
        soon(m, `reply:${from}:${d}:${phase}:${ask}`, { t: 'reply', to: from, ask });
      } else if (
        human &&
        !a.target &&
        ask === 'suspect' &&
        m.rng.chance(0.15 + 0.25 * m.bot.personality.verbosity)
      ) {
        // A person asking the whole table gets a few answers, not one from everyone.
        soon(m, `open:${from}:${d}:${phase}`, { t: 'reply', to: from, ask, open: true });
      }
      return;
    }
    default:
      return;
  }
}

function mentionsMe(m: Mind, text: string): boolean {
  return text.toLowerCase().includes(m.view.you.name.toLowerCase());
}

export function onClaim(m: Mind, from: PlayerId, role: RoleId, results: ClaimedResult[]): void {
  const mem = m.mem;
  const self = me(m);
  const d = day(m);
  if (from === self || mem.teammates.includes(from)) {
    if (from !== self) mem.claims[from] = role;
    return;
  }
  const first = mem.claims[from] === undefined;
  const changed = !first && mem.claims[from] !== role;
  mem.claims[from] = role;
  mem.claimDay[from] = mem.claimDay[from] ?? d;
  if (changed) bump(mem, from, 3, 'counterClaim', undefined, d);
  if (!possible(m.view, role)) bump(mem, from, 6, 'fakeClaim', undefined, d);
  const myRole = mem.role ?? m.view.you.role;
  const holders = m.view.players.filter(
    (p) => p.id !== from && ((!p.alive && p.role === role) || mem.claims[p.id] === role),
  );
  let countered = false;
  if (myRole === role && maxCopies(m.view, role) <= 1 && knowsInnocent(side(m))) {
    bump(mem, from, 10, 'lyingAboutMe', undefined, d);
    mem.known[from] = 'hostile';
    if (side(m) === 'town' && role !== 'magistrate') {
      countered = true;
      react(m, `counterClaim:${from}`, { t: 'counterClaim', target: from, role });
      react(m, `liar:${from}`, { t: 'accuse', target: from, hard: true });
    }
  } else if (holders.length + 1 > Math.max(1, maxCopies(m.view, role))) {
    const deadHolder = holders.find((p) => !p.alive);
    bump(mem, from, deadHolder ? 7 : 3, 'counterClaim', holders[0]?.id, d);
    for (const h of holders) if (h.alive) bump(mem, h.id, 1);
  }
  const c = cred(m.bot, mem, from);
  const prior = mem.claimResults[from] ?? [];
  for (const r of results) {
    if (prior.some((p) => p.target === r.target && p.finding === r.finding)) continue;
    prior.push(r);
    if (r.finding === 'suspicious') {
      if (r.target === self) {
        mem.heat += 1;
        soon(m, `defend:${from}:${d}`, { t: 'defendSelf', accuser: from });
      }
      if (r.target === self && knowsInnocent(side(m))) {
        const framable = possible(m.view, 'slanderer');
        bump(mem, from, framable ? 3 : 8, 'lyingAboutMe', undefined, d);
        if (!framable) mem.known[from] = 'hostile';
      } else if (!mem.teammates.includes(r.target)) {
        bump(mem, r.target, 5 * c, 'claimedSuspicious', from, d);
      }
    } else if (r.finding === 'clear') {
      if (mem.known[r.target] === 'hostile') bump(mem, from, 3, 'gut', undefined, d);
      else bump(mem, r.target, -3 * c);
    } else if (r.finding === 'visited') {
      for (const v of r.visitors ?? [])
        if (v !== self && !mem.teammates.includes(v))
          bump(mem, v, 4 * c, 'visitedVictim', r.target, d);
    }
  }
  mem.claimResults[from] = prior;
  if (first && POWER.includes(role) && !countered) {
    const doubt = (mem.suspicion[from] ?? 0) > 2 && !holdsClear(m.view, mem, from);
    react(
      m,
      `claimReact:${from}`,
      doubt ? { t: 'doubt', target: from, role } : { t: 'believe', target: from, role },
    );
  }
}

function onDeath(m: Mind, e: Extract<GameEvent, { type: 'death' }>): void {
  const mem = m.mem;
  const self = me(m);
  const d = day(m);
  delete mem.dayVotes[e.player];
  if (e.time === 'day') {
    mem.flags.execToday = 1;
    mem.flags.quietDawns = 0;
  }
  if (e.player === self) return;
  const wagon = mem.wagons[e.player] ?? [];
  const ballots = mem.ballots[e.player] ?? { guilty: [], innocent: [] };
  const accusers = mem.accusedBy[e.player] ?? [];
  const defenders = mem.defendedBy[e.player] ?? [];
  const role = e.role;
  if (role) {
    const faction = ROLES[role].faction;
    const hostile = faction === 'mafia' || role === 'cutthroat';
    if (hostile) {
      for (const v of wagon) bump(mem, v, -1.5);
      for (const v of ballots.guilty) bump(mem, v, -1);
      for (const v of ballots.innocent)
        if (!mem.teammates.includes(v)) bump(mem, v, 2.5, 'innocentOnMafia', e.player, d);
      for (const v of defenders)
        if (!mem.teammates.includes(v)) bump(mem, v, 2.5, 'defendedMafia', e.player, d);
      for (const v of accusers) bump(mem, v, -2);
    } else if (faction === 'town' && e.time === 'day') {
      wagon.forEach((v, i) => {
        if (v === self || mem.teammates.includes(v)) return;
        bump(mem, v, 1.5 + (i < 2 ? 1 : 0), i < 2 ? 'wagonStarter' : 'votedTown', e.player, d);
      });
      for (const v of ballots.guilty) if (v !== self) bump(mem, v, 1);
      for (const v of ballots.innocent) bump(mem, v, -0.5);
      for (const v of accusers)
        if (v !== self && !mem.teammates.includes(v)) bump(mem, v, 1.5, 'votedTown', e.player, d);
    } else if (faction === 'town' && e.time === 'night') {
      for (const [target, accs] of Object.entries(mem.accusedBy)) {
        if (accs.includes(e.player) && target !== self && !mem.teammates.includes(target)) {
          bump(mem, target, 1.5, 'accusedByDead', e.player, d);
        }
      }
      if (mem.claims[e.player] === role) {
        for (const r of mem.claimResults[e.player] ?? []) applyTrusted(m, e.player, r);
      }
    }
  }
  if (e.will) {
    const results = parseWill(e.will, m.view.players);
    const trusted = role !== null && ROLES[role].faction === 'town';
    for (const r of results) if (trusted) applyTrusted(m, e.player, r);
    if (results.length > 0) {
      const top = results.find((r) => r.finding === 'suspicious') ?? results[0];
      if (top) {
        const name = m.view.players.find((p) => p.id === top.target)?.name ?? 'someone';
        later(m, `will:${e.player}`, {
          t: 'will',
          player: e.player,
          summary: `${name} ${top.finding}`,
        });
      }
    }
  }
  if (e.time === 'night') {
    later(m, `death:${e.player}`, {
      t: 'death',
      player: e.player,
      role,
      power: role !== null && POWER.includes(role),
    });
    const note = e.deathNotes[0];
    if (note && m.rng.chance(0.5))
      later(m, `note:${e.player}`, { t: 'deathNote', player: e.player, note });
  } else if (role) {
    later(m, `exec:${e.player}`, { t: 'exec', player: e.player, role });
  }
}

/** Apply a result from a confirmed-Town source at full weight. */
function applyTrusted(m: Mind, source: PlayerId, r: ClaimedResult): void {
  const mem = m.mem;
  const self = me(m);
  const d = day(m);
  if (r.target === self || mem.teammates.includes(r.target)) return;
  if (r.finding === 'suspicious') bump(mem, r.target, 7, 'claimedSuspicious', source, d);
  if (r.finding === 'clear') bump(mem, r.target, -4);
  if (r.finding === 'visited') {
    for (const v of r.visitors ?? [])
      if (v !== self && !mem.teammates.includes(v)) bump(mem, v, 5, 'visitedVictim', r.target, d);
  }
}

function onResult(m: Mind, e: Extract<GameEvent, { type: 'nightResult' }>): void {
  const mem = m.mem;
  const r = e.result;
  const d = day(m);
  switch (r.kind) {
    case 'investigation': {
      if (!mem.checked.includes(r.target)) mem.checked.push(r.target);
      if (r.finding === 'suspicious') {
        const framable = possible(m.view, 'slanderer');
        bump(mem, r.target, framable ? 8 : 12, 'readSuspicious', undefined, d);
        if (!framable) mem.known[r.target] = 'hostile';
      } else {
        const patron = possible(m.view, 'patron');
        bump(mem, r.target, patron ? -3 : -6);
        if (!patron) mem.known[r.target] = 'town';
      }
      return;
    }
    case 'visitors': {
      if (!mem.checked.includes(r.target)) mem.checked.push(r.target);
      const died = !m.view.players.find((p) => p.id === r.target)?.alive;
      const trustedTarget = mem.known[r.target] === 'town' || (mem.suspicion[r.target] ?? 0) < -3;
      for (const v of r.visitors) {
        if (mem.known[v] === 'town' || mem.teammates.includes(v)) continue;
        if (died) bump(mem, v, r.visitors.length === 1 ? 9 : 5, 'visitedVictim', r.target, d);
        else if (trustedTarget) {
          // Repeat visitors to a protected Town player are attackers or protectors.
          const protector = mem.claims[v] === 'mender' || mem.claims[v] === 'sentinel';
          bump(mem, v, protector ? 0.3 : 1.5, 'visitedVictim', r.target, d);
        } else bump(mem, v, 0.3);
      }
      return;
    }
    case 'targetSurvived':
      mem.flags[`survived:${r.target}`] = d;
      mem.flags[`survivedN:${r.target}`] = (mem.flags[`survivedN:${r.target}`] ?? 0) + 1;
      return;
    case 'patientAttacked':
      bump(mem, r.target, -6);
      return;
    case 'guardFought':
      bump(mem, r.target, -6);
      return;
    default:
      return;
  }
}
