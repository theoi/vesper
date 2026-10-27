/**
 * A stand-in for a human player in headless games: plain-text chat with no
 * speech acts, and reading and thinking time before every action. It is
 * deliberately simple; it measures pacing (does a person get to act?), not skill.
 */
import { Rng } from '../src/engine/rng.ts';
import { ROLES, type Intent, type PlayerId, type PlayerView } from '../src/engine/index.ts';

export interface StandIn {
  style: StandInStyle;
  id: PlayerId;
  rng: number;
  wakeAt: number;
  phaseKey: string;
  /** Planned times for this phase (ms since epoch of the game clock); 0 = none. */
  talkAt: number[];
  voteAt: number;
  judgeAt: number;
  nightAt: number;
  replyAt: number;
  repliedSeq: number;
  /** Every voting phase this stand-in saw: when it opened and when the stand-in meant to vote. */
  votePlans: { day: number; openedAt: number; voteAt: number }[];
}

/** How long a person needs before acting, by phase (ms after the phase opens). */
export const HUMAN_DELAY = {
  /** Read the "vote is open" plate, look at the candles, decide. */
  vote: [4500, 9000],
  judge: [3000, 6500],
  night: [5000, 12_000],
  firstLine: [6000, 14_000],
  reply: [4000, 8000],
} as const;

/** Knobs for experiments: when the stand-in votes, and how often it votes at all. */
export interface StandInStyle {
  voteDelay: readonly [number, number];
  voteChance: number;
}

export function createStandIn(
  id: PlayerId,
  seed: number,
  style: Partial<StandInStyle> = {},
): StandIn {
  return {
    style: { voteDelay: HUMAN_DELAY.vote, voteChance: 0.8, ...style },
    id,
    rng: new Rng(seed >>> 0).state,
    wakeAt: 0,
    phaseKey: '',
    talkAt: [],
    voteAt: 0,
    judgeAt: 0,
    nightAt: 0,
    replyAt: 0,
    repliedSeq: 0,
    votePlans: [],
  };
}

export function actStandIn(
  prev: StandIn,
  view: PlayerView,
  now: number,
): { standIn: StandIn; intents: Intent[] } {
  const s: StandIn = { ...prev, talkAt: prev.talkAt.slice(), votePlans: prev.votePlans };
  const rng = new Rng(s.rng);
  const between = (r: readonly [number, number]) => r[0] + rng.next() * (r[1] - r[0]);
  const intents: Intent[] = [];
  const p = view.phase;
  const others = view.players.filter((x) => x.alive && x.id !== view.you.id);
  const key = `${p.kind}:${p.day}:${p.startedAt}`;
  if (key !== s.phaseKey) {
    s.phaseKey = key;
    s.talkAt = [];
    s.voteAt = 0;
    s.judgeAt = 0;
    s.nightAt = 0;
    const len = (p.endsAt ?? p.startedAt) - p.startedAt;
    if (view.you.alive) {
      if (p.kind === 'discussion') {
        const first = p.startedAt + between(HUMAN_DELAY.firstLine);
        if (first < p.startedAt + len) s.talkAt.push(first);
        if (rng.chance(0.5) && first + 7000 < p.startedAt + len) s.talkAt.push(first + 7000);
      }
      if (p.kind === 'voting') {
        s.voteAt = p.startedAt + between(s.style.voteDelay);
        s.votePlans.push({ day: p.day, openedAt: p.startedAt, voteAt: s.voteAt });
        if (!rng.chance(s.style.voteChance)) s.voteAt = 0;
      }
      if (p.kind === 'judgment' && view.allowed.judge)
        s.judgeAt = p.startedAt + between(HUMAN_DELAY.judge);
      if (p.kind === 'defense' && view.trial?.defendant === view.you.id)
        s.talkAt.push(p.startedAt + 2500);
      if (p.kind === 'night' && view.allowed.nightTargets.length > 0)
        s.nightAt = p.startedAt + between(HUMAN_DELAY.night);
    }
  }
  // Someone named us (a question or an accusation): answer a few seconds later.
  const asked = view.events.find(
    (e) =>
      e.type === 'chat' &&
      e.channel === 'public' &&
      e.seq > s.repliedSeq &&
      e.from !== view.you.id &&
      e.text.toLowerCase().includes(view.you.name.toLowerCase()),
  );
  if (asked && view.allowed.chat.includes('public') && s.replyAt === 0) {
    s.replyAt = now + between(HUMAN_DELAY.reply);
    s.repliedSeq = asked.seq;
  }
  const say = (text: string) => intents.push({ type: 'chat', channel: 'public', text });
  if (view.allowed.chat.includes('public')) {
    if (s.replyAt && now >= s.replyAt) {
      s.replyAt = 0;
      const role = ROLES[view.you.faction === 'town' ? view.you.role : 'resident'].name;
      say(
        rng.chance(0.5) ? `I'm the ${role}, for what it's worth.` : 'Nothing to report yet, sorry.',
      );
    }
    const due = s.talkAt.findIndex((t) => now >= t);
    if (due >= 0) {
      s.talkAt.splice(due, 1);
      const target = others.length > 0 ? rng.pick(others) : null;
      if (p.kind === 'defense') {
        const role = ROLES[view.you.faction === 'town' ? view.you.role : 'resident'].name;
        say(`I'm the ${role}! You have the wrong person.`);
      } else if (p.day === 1 && rng.chance(0.6))
        say(rng.pick(['hi all', 'hello everyone', 'evening']));
      else if (target && rng.chance(0.5)) say(`I think ${target.name} is acting suspicious`);
      else if (target) say(`${target.name}, what's your role?`);
    }
  }
  if (s.voteAt && now >= s.voteAt && view.allowed.voteTargets.length > 0) {
    s.voteAt = 0;
    const counts = new Map<PlayerId, number>();
    for (const t of Object.values(view.votes)) counts.set(t, (counts.get(t) ?? 0) + 1);
    const lead = [...counts.entries()]
      .filter(([id]) => view.allowed.voteTargets.includes(id))
      .sort((a, b) => b[1] - a[1])[0]?.[0];
    const target = lead && rng.chance(0.6) ? lead : rng.pick(view.allowed.voteTargets);
    intents.push({ type: 'vote', target });
  }
  if (s.judgeAt && now >= s.judgeAt && view.allowed.judge) {
    s.judgeAt = 0;
    const r = rng.next();
    intents.push({ type: 'judge', ballot: r < 0.5 ? 'guilty' : r < 0.85 ? 'innocent' : 'abstain' });
  }
  if (s.nightAt && now >= s.nightAt && view.allowed.nightTargets.length > 0) {
    s.nightAt = 0;
    intents.push({ type: 'night', targets: [rng.pick(view.allowed.nightTargets)] });
  }
  const times = [...s.talkAt, s.voteAt, s.judgeAt, s.nightAt, s.replyAt].filter((t) => t > now);
  s.wakeAt = times.length > 0 ? Math.min(...times) : now + 2000;
  s.rng = rng.state;
  return { standIn: s, intents };
}
