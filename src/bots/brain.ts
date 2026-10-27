/**
 * The bot loop: ingest new events, plan per phase, act on a human-like clock,
 * and turn topics into chat lines. Decisions come only from the bot's view.
 */
import { Rng } from '../engine/rng.ts';
import { ROLES } from '../engine/roles.ts';
import type { Intent, PlayerId, PlayerView, SpeechAct } from '../engine/types.ts';
import { DEATH_NOTES, render, type Category, type RenderInput } from './lines.ts';
import {
  clearedByMe,
  holdsClear,
  isAlive,
  livingOthers,
  nameOf,
  normalize,
  possible,
  score,
} from './knowledge.ts';
import { ingest, type Mind } from './memory.ts';
import {
  ballotChoice,
  chooseCover,
  claimNow,
  claimResults,
  describeResults,
  heldClear,
  nightChoice,
  shouldReveal,
  sideNow,
  teamKillTarget,
  topSuspect,
  voteChoice,
  writeWill,
} from './policy.ts';
import type { BotDecision, BotMemory, BotSpeech, BotState, Reason, Topic } from './types.ts';

interface Turn extends Mind {
  intents: Intent[];
  speech: BotSpeech[];
}

export function freshMemory(): BotMemory {
  return {
    role: null,
    teammates: [],
    suspicion: {},
    reasons: {},
    known: {},
    claims: {},
    claimDay: {},
    claimResults: {},
    claimed: null,
    cover: null,
    fakeResults: [],
    checked: [],
    msgs: {},
    accusedBy: {},
    defendedBy: {},
    wagons: {},
    ballots: {},
    dayVotes: {},
    deadTips: [],
    mafiaPicks: {},
    phaseKey: '',
    phaseStart: 0,
    said: 0,
    nextChatAt: 0,
    actAt: 0,
    acted: false,
    readyAt: 0,
    queue: [],
    pending: [],
    topics: [],
    recent: [],
    heard: [],
    heat: 0,
    flags: {},
  };
}

const copyLists = <T>(r: Record<string, T[]>): Record<string, T[]> => {
  const out: Record<string, T[]> = {};
  for (const k in r) out[k] = (r[k] as T[]).slice();
  return out;
};

function cloneMemory(m: BotMemory): BotMemory {
  return {
    ...m,
    teammates: m.teammates.slice(),
    suspicion: { ...m.suspicion },
    reasons: copyLists(m.reasons),
    known: { ...m.known },
    claims: { ...m.claims },
    claimDay: { ...m.claimDay },
    claimResults: copyLists(m.claimResults),
    fakeResults: m.fakeResults.slice(),
    checked: m.checked.slice(),
    msgs: { ...m.msgs },
    accusedBy: copyLists(m.accusedBy),
    defendedBy: copyLists(m.defendedBy),
    wagons: copyLists(m.wagons),
    ballots: { ...m.ballots },
    dayVotes: { ...m.dayVotes },
    deadTips: m.deadTips.slice(),
    mafiaPicks: { ...m.mafiaPicks },
    queue: m.queue.slice(),
    pending: m.pending.slice(),
    topics: m.topics.slice(),
    recent: m.recent.slice(),
    heard: m.heard.slice(),
    flags: { ...m.flags },
  };
}

/** Decide what the bot does now, from its own view only. */
export function decideBot(bot: BotState, view: PlayerView, now: number): BotDecision {
  const turn: Turn = {
    bot,
    mem: cloneMemory(bot.memory),
    view,
    rng: new Rng(bot.rng),
    now,
    at: now,
    reactive: [],
    intents: [],
    speech: [],
  };
  if (turn.mem.role === null) setup(turn);
  for (const e of view.events) {
    if (e.seq <= bot.seenSeq) continue;
    turn.at = e.at;
    ingest(turn, e);
  }
  // The view is authoritative for our own role and team.
  turn.mem.role = view.you.role;
  turn.mem.teammates = view.you.teammates.map((m) => m.id);
  const key = `${view.phase.kind}:${view.phase.day}:${view.phase.startedAt}`;
  if (key !== turn.mem.phaseKey) onPhase(turn, key);
  // Reactions to events from the current phase go to the front of the queue.
  for (const r of turn.reactive.reverse()) {
    if (r.at >= view.phase.startedAt) turn.mem.queue.unshift(r.topic);
  }
  act(turn);
  const wakeAt = nextWake(turn);
  return {
    bot: { ...bot, rng: turn.rng.state, memory: turn.mem, seenSeq: view.lastSeq, wakeAt },
    intents: turn.intents,
    speech: turn.speech,
    wakeAt,
  };
}

function setup(t: Turn): void {
  const v = t.view;
  t.mem.role = v.you.role;
  t.mem.teammates = v.you.teammates.map((m) => m.id);
  for (const p of v.players)
    if (p.id !== v.you.id) t.mem.suspicion[p.id] = (t.rng.next() - 0.5) * 1.2;
  t.mem.cover = chooseCover(t);
  if (ROLES[v.you.role].deathNote && v.allowed.deathNote) {
    const temp = t.bot.personality.temperament;
    const chance = temp === 'cold' || temp === 'theatrical' || temp === 'wry' ? 0.6 : 0.25;
    if (t.rng.chance(chance)) t.intents.push({ type: 'deathNote', text: t.rng.pick(DEATH_NOTES) });
  }
}

// ---------------------------------------------------------------------------
// Phase planning
// ---------------------------------------------------------------------------

function rand(t: Turn, lo: number, hi: number): number {
  return lo + t.rng.next() * (hi - lo);
}

function duration(t: Turn): number {
  const p = t.view.phase;
  return p.endsAt === null ? 30_000 : Math.max(1, p.endsAt - p.startedAt);
}

function maxLines(t: Turn): number {
  const verb = t.bot.personality.verbosity;
  if (!t.view.you.alive) return t.view.phase.kind === 'ended' ? 1 : 2;
  switch (t.view.phase.kind) {
    case 'discussion':
      return 1 + Math.round(verb * 5);
    case 'voting':
      return 1 + Math.round(verb * 2);
    case 'judgment':
      return 1;
    case 'defense':
      return 3;
    case 'lastWords':
      return 2;
    case 'night':
      return 3;
    case 'ended':
      return 1;
    default:
      return 0;
  }
}

function gap(t: Turn): number {
  const verb = t.bot.personality.verbosity;
  const base = (9000 - 5500 * verb) * rand(t, 0.6, 1.4);
  return Math.min(base, duration(t) / (maxLines(t) + 1.5));
}

function onPhase(t: Turn, key: string): void {
  const mem = t.mem;
  const v = t.view;
  const start = v.phase.startedAt;
  const dur = duration(t);
  const verb = t.bot.personality.verbosity;
  const bold = t.bot.personality.boldness;
  mem.phaseKey = key;
  mem.phaseStart = start;
  mem.said = 0;
  mem.acted = false;
  mem.queue = [];
  mem.nextChatAt = start + Math.min(dur * 0.3, rand(t, 1500, 6000) * (1.3 - verb));
  mem.readyAt = start + dur * rand(t, 0.45, 0.8);
  mem.actAt = start + dur * rand(t, 0.1, 0.5);
  const me = v.you;
  const kind = v.phase.kind;
  if (kind === 'ended') {
    if (t.rng.chance(0.4 + verb * 0.4)) {
      const won = v.result?.winners.includes(me.id) ?? false;
      mem.queue.push({
        t: 'end',
        outcome: v.result?.outcome === 'draw' && !won ? 'draw' : won ? 'win' : 'lose',
      });
    }
    return;
  }
  if (!me.alive) {
    planDead(t);
    return;
  }
  switch (kind) {
    case 'reveal':
      mem.readyAt = start + Math.min(dur * 0.6, rand(t, 1200, 3500));
      return;
    case 'discussion':
      planDiscussion(t);
      return;
    case 'voting':
      mem.actAt = start + Math.min(dur * 0.6, dur * rand(t, 0.05, 0.45) * (1.25 - bold));
      return;
    case 'defense':
      if (v.trial?.defendant === me.id) planDefense(t);
      return;
    case 'judgment':
      mem.actAt = start + dur * rand(t, 0.1, 0.6);
      return;
    case 'lastWords':
      if (v.trial?.defendant === me.id) {
        const role = sideNow(t) === 'town' ? me.role : (mem.claimed ?? null);
        mem.queue.push({ t: 'lastWords' });
        if (role && t.rng.chance(0.4)) mem.queue.push({ t: 'claim', role });
        mem.nextChatAt = start + Math.min(dur * 0.2, 800);
      }
      return;
    case 'night':
      planNight(t);
      return;
    default:
      return;
  }
}

function planDiscussion(t: Turn): void {
  const v = t.view;
  const mem = t.mem;
  const p = t.bot.personality;
  const side = sideNow(t);
  const q: Topic[] = [];
  if (v.phase.day === 1) {
    if (t.rng.chance(0.4 + p.verbosity * 0.4)) q.push({ t: 'greet' });
    if (t.rng.chance(p.verbosity * 0.5)) q.push({ t: 'banter' });
    if (t.rng.chance(0.25)) q.push({ t: 'question' });
  }
  // Reactions to what happened since we could last speak.
  let reactions = 0;
  for (const topic of mem.pending) {
    const chance = reactions === 0 ? 0.85 : 0.45 * (0.5 + p.verbosity);
    if (t.rng.chance(chance)) {
      q.push(topic);
      reactions++;
    }
  }
  mem.pending = [];
  // Mourner relays what the dead said.
  if (v.you.role === 'mourner' && mem.deadTips.length > 0) {
    const tip = mem.deadTips.find((x) => isAlive(v, x.target));
    if (tip && t.rng.chance(0.75)) {
      q.unshift({ t: 'mournerRelay', target: tip.target, finding: tip.finding });
      if (!mem.claimed) mem.claimed = 'mourner';
    }
    mem.deadTips = [];
  }
  const claim = claimNow(t, false);
  if (claim) q.unshift({ t: 'claim', role: claim, results: claimResults(t, claim) });
  // Accusations.
  if (
    side === 'accuser' &&
    v.you.accuserTarget &&
    isAlive(v, v.you.accuserTarget) &&
    t.rng.chance(0.4 + p.boldness * 0.5)
  ) {
    q.push({ t: 'accuse', target: v.you.accuserTarget, hard: t.rng.chance(p.boldness) });
  }
  const top = topSuspect(t, heldClear(t));
  if (top) {
    const s =
      side === 'mafia' || side === 'cutthroat' ? (mem.suspicion[top] ?? 0) : score(mem, top);
    const bar = side === 'mafia' || side === 'cutthroat' ? 1.5 : 2.5 - p.boldness;
    if (s >= bar && t.rng.chance(0.6 + p.boldness * 0.4))
      q.push({ t: 'accuse', target: top, hard: s >= 7 });
  }
  if (side === 'harlequin' && t.rng.chance(0.5)) q.push({ t: 'bait' });
  // Defend a trusted player who is under fire.
  const defended = livingOthers(v).find(
    (x) =>
      (mem.accusedBy[x.id]?.length ?? 0) > 0 &&
      (mem.known[x.id] === 'town' || score(mem, x.id) < -3),
  );
  if (defended && t.rng.chance(0.5)) q.push({ t: 'defendOther', target: defended.id });
  if (t.rng.chance(p.verbosity * 0.5)) q.push({ t: 'question' });
  if (t.rng.chance(p.verbosity * 0.6)) q.push({ t: 'banter' });
  // Quiet whisper of a claim to a revealed Magistrate.
  const mag = livingOthers(v).find((x) => x.magistrateRevealed);
  if (
    mag &&
    side === 'town' &&
    v.you.role !== 'resident' &&
    !mem.topics.includes(`whisper:${mag.id}`) &&
    t.rng.chance(0.3)
  ) {
    mem.topics.push(`whisper:${mag.id}`);
    q.push({ t: 'whisperClaim', to: mag.id, role: v.you.role });
  }
  mem.queue = q.slice(0, maxLines(t) + 1);
}

function planDefense(t: Turn): void {
  const mem = t.mem;
  const q: Topic[] = [{ t: 'plea' }];
  if (shouldReveal(t)) t.mem.flags.revealNow = 1;
  const claim = claimNow(t, true);
  if (claim && t.view.you.role !== 'magistrate')
    q.push({ t: 'claim', role: claim, results: claimResults(t, claim) });
  const wagon = Object.entries(mem.wagons).find(([d]) => d === t.view.you.id)?.[1] ?? [];
  const starter = wagon.find((id) => isAlive(t.view, id) && !holdsClear(t.view, mem, id));
  if (starter && t.rng.chance(0.5)) q.push({ t: 'accuse', target: starter, hard: false });
  mem.queue = q;
  mem.nextChatAt = t.view.phase.startedAt + Math.min(duration(t) * 0.15, 1000);
}

function planNight(t: Turn): void {
  const v = t.view;
  const mem = t.mem;
  const side = sideNow(t);
  const dur = duration(t);
  mem.actAt = v.phase.startedAt + dur * rand(t, 0.08, 0.4);
  mem.readyAt = mem.actAt + Math.min(dur * 0.3, rand(t, 800, 4000));
  if (side === 'mafia') {
    if (v.phase.day === 1 && mem.cover && t.rng.chance(0.4))
      mem.queue.push({ t: 'mafiaCover', role: mem.cover });
    if (t.rng.chance(0.25)) mem.queue.push({ t: 'mafiaBanter' });
  }
  if (v.you.role === 'mourner' && t.rng.chance(0.6)) mem.queue.push({ t: 'mournerAsk' });
}

function planDead(t: Turn): void {
  const v = t.view;
  const mem = t.mem;
  if (!mem.flags.deadIntro) {
    mem.flags.deadIntro = 1;
    if (t.rng.chance(0.7)) mem.queue.push({ t: 'deadIntro' });
  }
  if (v.phase.kind === 'night' && possible(v, 'mourner')) {
    const top = topSuspect(t, heldClear(t));
    if (top && score(mem, top) > 2 && sideNow(t) === 'town' && t.rng.chance(0.6)) {
      const results = claimResults(t, v.you.role).filter(
        (r) => r.finding === 'suspicious' && isAlive(v, r.target),
      );
      const target = results[0]?.target ?? top;
      mem.queue.push({
        t: 'deadTip',
        target,
        finding: results[0] ? 'read Suspicious' : 'suspicious',
      });
    }
  }
  if (t.rng.chance(0.25)) mem.queue.push({ t: 'deadBanter' });
}

// ---------------------------------------------------------------------------
// Acting
// ---------------------------------------------------------------------------

function act(t: Turn): void {
  const v = t.view;
  const mem = t.mem;
  const me = v.you;
  if (v.phase.kind !== 'ended' && me.alive) {
    maybeWill(t);
    if (mem.flags.revealNow && v.allowed.reveal) {
      t.intents.push({ type: 'reveal' });
      mem.queue.unshift({ t: 'magistrate' });
      delete mem.flags.revealNow;
    }
    switch (v.phase.kind) {
      case 'discussion':
      case 'voting':
        if (shouldReveal(t) && v.allowed.reveal && !mem.topics.includes('revealed')) {
          mem.topics.push('revealed');
          t.intents.push({ type: 'reveal' });
          mem.queue.unshift({ t: 'magistrate' });
        }
        if (v.phase.kind === 'voting' && !t.intents.some((i) => i.type === 'reveal')) actVote(t);
        break;
      case 'judgment':
        if (!mem.acted && t.now >= mem.actAt && v.allowed.judge) {
          mem.acted = true;
          const ballot = ballotChoice(t);
          t.intents.push({ type: 'judge', ballot });
          const d = v.trial?.defendant;
          if (d && ballot !== 'abstain' && t.rng.chance(0.25 + t.bot.personality.verbosity * 0.3)) {
            mem.queue.push({ t: 'judge', target: d, guilty: ballot === 'guilty' });
          }
        }
        break;
      case 'night':
        actNight(t);
        break;
      default:
        break;
    }
  }
  speak(t);
  maybeReady(t);
}

function actVote(t: Turn): void {
  const v = t.view;
  const mem = t.mem;
  if (t.now < mem.actAt || v.allowed.voteTargets.length === 0) return;
  const recheck = mem.flags.nextVoteCheck ?? 0;
  if (mem.acted && t.now < recheck) return;
  mem.flags.nextVoteCheck = t.now + rand(t, 2000, 5000);
  const choice = voteChoice(t);
  const current = v.you.vote;
  if (choice && choice !== current && (!mem.acted || !current || t.rng.chance(0.5))) {
    t.intents.push({ type: 'vote', target: choice });
    if (t.rng.chance(0.35 + t.bot.personality.verbosity * 0.35))
      mem.queue.unshift({ t: 'vote', target: choice });
    const need = v.voteThreshold;
    const tally = Object.values(v.votes).filter((x) => x === choice).length + 1;
    if (tally === need - 1 && t.rng.chance(0.3)) mem.queue.push({ t: 'urge', target: choice });
  }
  mem.acted = true;
}

function actNight(t: Turn): void {
  const v = t.view;
  const mem = t.mem;
  const role = v.you.role;
  const side = sideNow(t);
  if (!mem.acted && t.now >= mem.actAt) {
    const waitForOrder =
      (role === 'embalmer' || role === 'slanderer') &&
      !teamKillTarget(t) &&
      t.now < mem.phaseStart + duration(t) * 0.6;
    if (!waitForOrder) {
      mem.acted = true;
      const target = nightChoice(t);
      if (target) t.intents.push({ type: 'night', targets: [target] });
      if (side === 'mafia' && target && (role === 'patron' || role === 'hatchet')) {
        const leader =
          role === 'patron' || !v.you.teammates.some((m) => m.role === 'patron' && m.alive);
        if (leader || t.rng.chance(0.3))
          mem.queue.push({ t: 'mafiaPlan', target, why: planReason(t, target) });
      }
    }
  }
  // Follow the Patron's order as the Hatchet; agree in chat.
  if (mem.acted && side === 'mafia') {
    const team = teamKillTarget(t);
    const mine = v.you.nightTargets?.[0];
    if (role === 'hatchet' && team && team !== mine && v.allowed.nightTargets.includes(team)) {
      t.intents.push({ type: 'night', targets: [team] });
    }
    if (
      team &&
      team !== mine &&
      !mem.topics.includes(`agree:${v.phase.day}`) &&
      t.rng.chance(0.6)
    ) {
      mem.topics.push(`agree:${v.phase.day}`);
      mem.queue.push({ t: 'mafiaAgree', target: team });
    }
  }
}

function planReason(t: Turn, target: PlayerId): string {
  const mem = t.mem;
  const claim = mem.claims[target];
  if (t.view.players.find((p) => p.id === target)?.magistrateRevealed)
    return 'They are the Magistrate';
  if (claim) return `They claim ${ROLES[claim].name}`;
  if (mem.teammates.some((m) => mem.accusedBy[m]?.includes(target))) return 'They are onto us';
  return t.rng.pick([
    'They talk too much',
    'Too sharp for comfort',
    'The town trusts them',
    'Easy pick',
  ]);
}

function maybeWill(t: Turn): void {
  const v = t.view;
  if (!v.allowed.will) return;
  const k = v.phase.kind;
  if (k !== 'night' && k !== 'discussion') return;
  const stamp = `${k}:${v.phase.day}`;
  if (t.mem.flags[`will:${stamp}`]) return;
  t.mem.flags[`will:${stamp}`] = 1;
  const text = writeWill(t);
  if (text !== v.you.will) t.intents.push({ type: 'will', text });
}

function maybeReady(t: Turn): void {
  const v = t.view;
  const mem = t.mem;
  // Never end a phase in the same turn as speaking, or the line would be rejected.
  if (!v.allowed.ready || v.you.ready || t.now < mem.readyAt || t.speech.length > 0) return;
  const k = v.phase.kind;
  const quiet = mem.queue.length === 0 || mem.said >= maxLines(t);
  if (k === 'night' && !mem.acted) return;
  if (k === 'defense' || k === 'lastWords') {
    if (quiet) t.intents.push({ type: 'ready', ready: true });
    return;
  }
  if (quiet) t.intents.push({ type: 'ready', ready: true });
}

// ---------------------------------------------------------------------------
// Speech
// ---------------------------------------------------------------------------

function channelFor(t: Turn, topic: Topic): 'public' | 'mafia' | 'dead' | 'whisper' | null {
  const allowed = t.view.allowed.chat;
  switch (topic.t) {
    case 'mafiaPlan':
    case 'mafiaAgree':
    case 'mafiaCover':
    case 'mafiaBanter':
      return allowed.includes('mafia') ? 'mafia' : null;
    case 'deadIntro':
    case 'deadTip':
    case 'deadBanter':
    case 'mournerAsk':
      return allowed.includes('dead') ? 'dead' : null;
    case 'whisperClaim':
      return t.view.allowed.whisperTo.includes(topic.to) ? 'whisper' : null;
    default:
      return allowed.includes('public') ? 'public' : null;
  }
}

function speak(t: Turn): void {
  const mem = t.mem;
  if (mem.said >= maxLines(t) || t.now < mem.nextChatAt) return;
  while (mem.queue.length > 0) {
    const topic = mem.queue.shift() as Topic;
    const channel = channelFor(t, topic);
    if (!channel) continue;
    const line = toLine(t, topic);
    if (!line) continue;
    const text = line.text;
    const act = line.act;
    if (channel === 'whisper' && topic.t === 'whisperClaim') {
      t.speech.push({
        intent: { type: 'whisper', to: topic.to, text, meta: act },
        act,
        personality: t.bot.personality.id,
        category: line.category,
      });
    } else if (channel !== 'whisper') {
      t.speech.push({
        intent: { type: 'chat', channel, text, meta: act },
        act,
        personality: t.bot.personality.id,
        category: line.category,
      });
    }
    if (act.kind === 'claim' && channel === 'public') {
      mem.claimed = act.role;
    }
    mem.said++;
    mem.nextChatAt = t.now + gap(t);
    return;
  }
}

interface Line {
  text: string;
  act: SpeechAct;
  category: Category;
}

function say(t: Turn, category: Category, input: RenderInput, act: SpeechAct): Line {
  const heard = new Set(t.mem.heard);
  const tried = t.mem.recent.slice();
  let r = render(category, input, t.bot.personality, t.rng, tried);
  for (let i = 0; i < 4 && heard.has(normalize(r.text)); i++) {
    tried.push(r.id);
    r = render(category, input, t.bot.personality, t.rng, tried);
  }
  t.mem.recent.push(r.id);
  if (t.mem.recent.length > 40) t.mem.recent.splice(0, t.mem.recent.length - 40);
  return { text: r.text, act, category };
}

function reasonText(t: Turn, target: PlayerId): string {
  // A claimed Augur turning on someone it called Clear owes the table an explanation.
  if (t.mem.claimed === 'augur' && possible(t.view, 'patron') && clearedByMe(t.view, t.mem, target))
    return `A Clear reading can't rule out the Patron. ${baseReason(t, target, true)}`;
  return baseReason(t, target, false);
}

function baseReason(t: Turn, target: PlayerId, specific: boolean): string {
  const v = t.view;
  const list: Reason[] = t.mem.reasons[target] ?? [];
  const r = (specific ? list.filter((x) => x.k !== 'gut') : list).at(-1) ?? list.at(-1);
  const x = r?.x ? nameOf(v, r.x) : '';
  switch (r?.k) {
    case 'readSuspicious':
      return t.mem.claimed === 'augur' ? 'My reading came back Suspicious' : 'I have my reasons';
    case 'votedTown':
      return `They pushed the vote on ${x}, who was Town`;
    case 'wagonStarter':
      return `They started the wagon on ${x}`;
    case 'defendedMafia':
      return `They defended ${x}, who was Syndicate`;
    case 'innocentOnMafia':
      return `They voted innocent on ${x}`;
    case 'fakeClaim':
      return "That claim doesn't fit the role list";
    case 'counterClaim':
      return x ? `Their claim clashes with ${x}` : 'Their story keeps changing';
    case 'lyingAboutMe':
      return 'They are lying about me, and I know it';
    case 'visitedVictim':
      return r?.x && isAlive(v, r.x)
        ? `They keep turning up at ${x}'s door at night`
        : `They were at ${x}'s door the night ${x} died`;
    case 'accusedByDead':
      return `${x} suspected them before dying`;
    case 'claimedSuspicious':
      return `${x} read them as Suspicious`;
    case 'accusedMe':
      return "They're pushing me with nothing";
    case 'quiet':
      return "They've barely said a word";
    default: {
      const msgs = t.mem.msgs[target] ?? 0;
      if (msgs === 0 && t.view.phase.day > 1) return "They've barely said a word";
      return t.rng.pick([
        'Just a feeling',
        'The way they talk',
        "Their votes don't add up",
        'Too comfortable',
      ]);
    }
  }
}

function quietest(t: Turn): PlayerId | null {
  const pool = livingOthers(t.view).filter((p) => !t.mem.teammates.includes(p.id));
  if (pool.length === 0) return null;
  const least = Math.min(...pool.map((p) => t.mem.msgs[p.id] ?? 0));
  return t.rng.pick(pool.filter((p) => (t.mem.msgs[p.id] ?? 0) === least)).id;
}

function toLine(t: Turn, topic: Topic): Line | null {
  const v = t.view;
  const mem = t.mem;
  const name = (id: PlayerId) => nameOf(v, id);
  switch (topic.t) {
    case 'greet':
      return say(t, 'greet', {}, { kind: 'banter' });
    case 'death': {
      if (!topic.role)
        return say(
          t,
          'embalmedReact',
          { v: name(topic.player) },
          { kind: 'react', about: 'death', target: topic.player },
        );
      const cat: Category = topic.power ? 'deathReactPower' : 'deathReact';
      return say(
        t,
        cat,
        { v: name(topic.player), r: ROLES[topic.role].name },
        { kind: 'react', about: 'death', target: topic.player },
      );
    }
    case 'deathNote':
      return say(
        t,
        'deathNoteReact',
        { v: name(topic.player), x: topic.note.slice(0, 80) },
        { kind: 'react', about: 'death', target: topic.player },
      );
    case 'will':
      return say(
        t,
        'willReact',
        { v: name(topic.player), x: topic.summary },
        { kind: 'react', about: 'will', target: topic.player },
      );
    case 'quietNight':
      return say(t, 'quietNight', {}, { kind: 'react', about: 'quiet' });
    case 'exec': {
      const f = ROLES[topic.role].faction;
      const cat: Category = f === 'town' ? 'execTown' : f === 'mafia' ? 'execMafia' : 'execNeutral';
      return say(
        t,
        cat,
        { v: name(topic.player), r: ROLES[topic.role].name },
        { kind: 'react', about: 'verdict', target: topic.player },
      );
    }
    case 'claim': {
      if (mem.claimed && mem.claimed !== topic.role) return null;
      const results = topic.results ?? [];
      const act: SpeechAct =
        results.length > 0
          ? { kind: 'claim', role: topic.role, results }
          : { kind: 'claim', role: topic.role };
      const r = ROLES[topic.role].name;
      if (results.length > 0)
        return say(t, 'claimResult', { r, x: describeResults(v, results) }, act);
      return say(t, 'claim', { r }, act);
    }
    case 'accuse': {
      if (!isAlive(v, topic.target)) return null;
      const confidence = Math.min(1, Math.max(0.3, score(mem, topic.target) / 8));
      return say(
        t,
        topic.hard ? 'accuseHard' : 'accuse',
        { t: name(topic.target), x: reasonText(t, topic.target) },
        { kind: 'accuse', target: topic.target, confidence },
      );
    }
    case 'defendSelf': {
      if (!isAlive(v, topic.accuser)) return null;
      if (mem.heat >= 2.5 && !mem.claimed && v.you.role !== 'magistrate') {
        const role = claimNow(t, true);
        if (role) {
          const results = claimResults(t, role);
          return say(
            t,
            'defendSelfClaim',
            { r: ROLES[role].name },
            results.length > 0 ? { kind: 'claim', role, results } : { kind: 'claim', role },
          );
        }
      }
      return say(t, 'defendSelf', { t: name(topic.accuser) }, { kind: 'defend', target: v.you.id });
    }
    case 'defendOther':
      if (!isAlive(v, topic.target)) return null;
      return say(
        t,
        'defendOther',
        { t: name(topic.target) },
        { kind: 'defend', target: topic.target },
      );
    case 'question': {
      const target = topic.target ?? (t.rng.chance(0.6) ? quietest(t) : null);
      if (target && isAlive(v, target))
        return say(t, 'question', { t: name(target) }, { kind: 'question', target });
      return say(t, 'questionGeneric', {}, { kind: 'question' });
    }
    case 'doubt':
      if (!isAlive(v, topic.target)) return null;
      return say(
        t,
        'doubtClaim',
        { t: name(topic.target), r: ROLES[topic.role].name },
        { kind: 'accuse', target: topic.target, confidence: 0.4 },
      );
    case 'believe':
      if (!isAlive(v, topic.target)) return null;
      return say(
        t,
        'believeClaim',
        { t: name(topic.target), r: ROLES[topic.role].name },
        { kind: 'defend', target: topic.target },
      );
    case 'vote':
      return say(t, 'vote', { t: name(topic.target) }, { kind: 'vote', target: topic.target });
    case 'urge':
      return say(t, 'urge', { t: name(topic.target) }, { kind: 'vote', target: topic.target });
    case 'plea':
      return say(t, 'defensePlea', {}, { kind: 'defend', target: v.you.id });
    case 'judge':
      return say(
        t,
        topic.guilty ? 'judgeGuilty' : 'judgeInnocent',
        { t: name(topic.target) },
        topic.guilty
          ? { kind: 'accuse', target: topic.target, confidence: 0.5 }
          : { kind: 'defend', target: topic.target },
      );
    case 'lastWords':
      if (v.you.role === 'harlequin')
        return say(t, 'lastWordsHarlequin', {}, { kind: 'react', about: 'end' });
      return say(t, 'lastWords', {}, { kind: 'react', about: 'end' });
    case 'trialReact':
      if (t.rng.chance(0.65)) return null;
      return say(
        t,
        'trialReact',
        { t: name(topic.target) },
        { kind: 'react', about: 'trial', target: topic.target },
      );
    case 'banter':
      return say(t, 'banter', {}, { kind: 'banter' });
    case 'mafiaPlan':
      return say(
        t,
        'mafiaPlan',
        { t: name(topic.target), x: topic.why },
        { kind: 'plan', target: topic.target },
      );
    case 'mafiaAgree':
      return say(
        t,
        'mafiaAgree',
        { t: name(topic.target) },
        { kind: 'plan', target: topic.target },
      );
    case 'mafiaCover':
      return say(
        t,
        'mafiaCover',
        { r: ROLES[topic.role].name },
        { kind: 'claim', role: topic.role },
      );
    case 'mafiaBanter':
      return say(t, 'mafiaBanter', {}, { kind: 'banter' });
    case 'deadIntro':
      return say(
        t,
        'deadIntro',
        { r: ROLES[v.you.role].name },
        { kind: 'claim', role: v.you.role },
      );
    case 'deadTip':
      return say(
        t,
        'deadTip',
        { t: name(topic.target), x: `They ${topic.finding.toLowerCase()}` },
        { kind: 'accuse', target: topic.target, confidence: 0.8 },
      );
    case 'deadBanter':
      return say(t, 'deadBanter', {}, { kind: 'banter' });
    case 'mournerAsk':
      return say(t, 'mournerAsk', {}, { kind: 'question' });
    case 'mournerRelay':
      if (!isAlive(v, topic.target)) return null;
      return say(
        t,
        'mournerRelay',
        { t: name(topic.target), x: `They were ${topic.finding.toLowerCase()}` },
        { kind: 'accuse', target: topic.target, confidence: 0.7 },
      );
    case 'magistrate':
      return say(t, 'magistrateReveal', {}, { kind: 'claim', role: 'magistrate' });
    case 'magistrateReact':
      if (!isAlive(v, topic.target)) return null;
      return say(
        t,
        'magistrateReact',
        { t: name(topic.target) },
        { kind: 'react', about: 'reveal', target: topic.target },
      );
    case 'bait':
      return say(t, 'harlequinBait', {}, { kind: 'banter' });
    case 'reply':
      if (!isAlive(v, topic.to)) return null;
      return say(t, 'reply', { t: name(topic.to) }, { kind: 'defend', target: v.you.id });
    case 'whisperClaim':
      return say(
        t,
        'whisperClaim',
        { r: ROLES[topic.role].name },
        { kind: 'claim', role: topic.role },
      );
    case 'end':
      return say(
        t,
        topic.outcome === 'win' ? 'endWin' : topic.outcome === 'lose' ? 'endLose' : 'endDraw',
        {},
        { kind: 'react', about: 'end' },
      );
  }
}

function nextWake(t: Turn): number {
  const v = t.view;
  const mem = t.mem;
  const now = t.now;
  const options: number[] = [];
  if (v.phase.endsAt !== null) options.push(v.phase.endsAt);
  if (mem.queue.length > 0 && mem.said < maxLines(t)) options.push(mem.nextChatAt);
  if (!mem.acted && ['voting', 'judgment', 'night'].includes(v.phase.kind) && v.you.alive)
    options.push(mem.actAt);
  if (v.phase.kind === 'voting' && v.you.alive) options.push(mem.flags.nextVoteCheck ?? now + 3000);
  if (v.phase.kind === 'night' && v.you.alive && mem.acted && sideNow(t) === 'mafia')
    options.push(now + 3000);
  if (v.allowed.ready && !v.you.ready) options.push(mem.readyAt);
  if (v.phase.kind === 'night' && !mem.acted) options.push(now + 2000);
  const future = options.filter((x) => x > now);
  const next = future.length > 0 ? Math.min(...future) : now + 2000;
  return Math.max(now + 250, Math.round(next));
}
