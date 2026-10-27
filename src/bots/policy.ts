/** Scripted decisions: votes, ballots, night targets, claims, and wills. */
import { ROLES } from '../engine/roles.ts';
import type { ClaimedResult, NightResult, PlayerId, PlayerView, RoleId } from '../engine/types.ts';
import {
  claimValue,
  isAlive,
  livingOthers,
  maxCopies,
  nameOf,
  possible,
  score,
  sideOf,
  type Side,
} from './knowledge.ts';
import type { Mind } from './memory.ts';

export function sideNow(m: Mind): Side {
  return sideOf(m.mem.role ?? m.view.you.role);
}

function noise(m: Mind, amount = 1): number {
  return (m.rng.next() - 0.5) * 2 * amount;
}

/** Weighted pick of the best-scoring ids (softmax-like with personality noise). */
function pickBest(
  m: Mind,
  ids: PlayerId[],
  value: (id: PlayerId) => number,
  spread = 1.2,
): PlayerId | null {
  if (ids.length === 0) return null;
  const scored = ids.map((id) => ({ id, v: value(id) + noise(m, spread) }));
  scored.sort((a, b) => b.v - a.v);
  return scored[0]?.id ?? null;
}

const isTeammate = (m: Mind, id: PlayerId) => m.mem.teammates.includes(id);

/** What the town (as modelled by public evidence) thinks of a player. */
function townSuspicion(m: Mind, id: PlayerId): number {
  return m.mem.suspicion[id] ?? 0;
}

// ---------------------------------------------------------------------------
// Night
// ---------------------------------------------------------------------------

export function nightChoice(m: Mind): PlayerId | null {
  const v = m.view;
  const targets = v.allowed.nightTargets;
  if (targets.length === 0) return null;
  const role = v.you.role;
  const mem = m.mem;
  const self = v.you.id;
  const others = targets.filter((t) => t !== self);
  const night = v.phase.day;
  switch (role) {
    case 'augur': {
      const fresh = others.filter((t) => !mem.checked.includes(t) && !mem.known[t]);
      const pool = fresh.length > 0 ? fresh : others;
      return pickBest(m, pool, (t) => score(mem, t) * 0.6 + claimValue(v, mem, t) * 0.4 + 2, 1.5);
    }
    case 'lamplighter':
    case 'sentinel':
      return pickBest(m, others, (t) => protectValue(m, t), 1.5);
    case 'mender': {
      const best = pickBest(m, others, (t) => protectValue(m, t), 1.5);
      const selfOk = targets.includes(self);
      const danger = mem.heat + (mem.claimed ? 2 : 0) + (v.you.magistrateRevealed ? 3 : 0);
      if (selfOk && danger >= 2.5 && m.rng.chance(0.6)) return self;
      return best;
    }
    case 'reckoner': {
      const top = pickBest(m, others, (t) => score(mem, t), 0.5);
      if (!top) return null;
      const s = score(mem, top);
      const threshold = 7 - m.bot.personality.boldness * 2.5;
      return s >= threshold ? top : null;
    }
    case 'muse': {
      const pool = others.filter((t) => mem.known[t] !== 'town');
      return pickBest(m, pool.length > 0 ? pool : others, (t) => score(mem, t), 1.5);
    }
    case 'patron':
    case 'hatchet':
      return killChoice(m, targets);
    case 'lure':
      return pickBest(
        m,
        targets,
        (t) => claimValue(v, mem, t) * 1.2 - townSuspicion(m, t) * 0.3 + 1,
        2,
      );
    case 'slanderer': {
      const kill = teamKillTarget(m);
      const pool = targets.filter((t) => t !== kill);
      return pickBest(
        m,
        pool.length > 0 ? pool : targets,
        (t) => townSuspicion(m, t) + claimValue(v, mem, t) * 0.2,
        1.5,
      );
    }
    case 'embalmer': {
      const kill = teamKillTarget(m);
      if (!kill || !targets.includes(kill)) return null;
      const valuable = claimValue(v, mem, kill) >= 3;
      if (valuable || (night >= 2 && m.rng.chance(0.3))) return kill;
      return null;
    }
    case 'cutthroat':
      return pickBest(
        m,
        others,
        (t) =>
          claimValue(v, mem, t) +
          (mem.accusedBy[self]?.includes(t) ? 3 : 0) -
          townSuspicion(m, t) * 0.3 +
          1,
        2.5,
      );
    case 'drifter': {
      const danger = mem.heat + (livingOthers(v).length <= 4 ? 1.5 : 0);
      if (danger >= 1 || m.rng.chance(0.3)) return self;
      return null;
    }
    default:
      return null;
  }
}

/** Killers learn from failed attacks: a target that just survived is probably protected. */
function survivedPenalty(m: Mind, id: PlayerId): number {
  const when = m.mem.flags[`survived:${id}`];
  if (when === undefined) return 0;
  const times = m.mem.flags[`survivedN:${id}`] ?? 1;
  return m.view.phase.day - when <= 1 ? 6 * times : 2 * times;
}

/** Quiet days push the Town to act on weaker evidence. */
function pressure(m: Mind): number {
  const quiet = m.mem.flags.quietDawns ?? 0;
  const few = m.view.players.filter((p) => p.alive).length <= 5 ? 0.5 : 0;
  return (quiet >= 2 ? 3.5 : quiet === 1 ? 1.5 : 0) + few;
}

function protectValue(m: Mind, id: PlayerId): number {
  return claimValue(m.view, m.mem, id) * 1.3 - score(m.mem, id) * 0.4 + 1;
}

/** The kill target the Syndicate is converging on, if any. */
export function teamKillTarget(m: Mind): PlayerId | null {
  const v = m.view;
  const patron = v.you.teammates.find((t) => t.role === 'patron' && t.alive);
  if (patron) {
    const pick = m.mem.mafiaPicks[patron.id];
    if (pick && isAlive(v, pick)) return pick;
  }
  for (const t of v.you.teammates) {
    const pick = m.mem.mafiaPicks[t.id];
    if (t.alive && (t.role === 'hatchet' || t.role === 'patron') && pick && isAlive(v, pick))
      return pick;
  }
  if (v.you.role === 'patron' || v.you.role === 'hatchet') return v.you.nightTargets?.[0] ?? null;
  return null;
}

function killChoice(m: Mind, targets: PlayerId[]): PlayerId | null {
  const v = m.view;
  const team = teamKillTarget(m);
  if (v.you.role === 'hatchet' && team && targets.includes(team)) return team;
  const mem = m.mem;
  const topSuspect = pickBest(m, targets, (t) => townSuspicion(m, t), 0);
  return pickBest(
    m,
    targets,
    (t) => {
      let val = 1 + claimValue(v, mem, t) * 1.2;
      for (const mate of mem.teammates) if (mem.accusedBy[mate]?.includes(t)) val += 2;
      if (
        (mem.claimResults[t] ?? []).some(
          (r) => r.finding === 'suspicious' && isTeammate(m, r.target),
        )
      )
        val += 5;
      val -= townSuspicion(m, t) * 0.4;
      if (t === topSuspect && townSuspicion(m, t) > 2) val -= 3;
      if (mem.claims[t] === 'harlequin' || mem.claims[t] === 'drifter') val -= 1;
      return val - survivedPenalty(m, t);
    },
    2,
  );
}

// ---------------------------------------------------------------------------
// Day
// ---------------------------------------------------------------------------

function tallies(m: Mind): Map<PlayerId, number> {
  const t = new Map<PlayerId, number>();
  for (const [voter, target] of Object.entries(m.view.votes)) {
    const p = m.view.players.find((x) => x.id === voter);
    if (!p?.alive) continue;
    t.set(target, (t.get(target) ?? 0) + (p.magistrateRevealed ? 3 : 1));
  }
  return t;
}

/** Who to vote for right now, or null to hold. */
export function voteChoice(m: Mind): PlayerId | null {
  const v = m.view;
  const options = v.allowed.voteTargets;
  if (options.length === 0) return null;
  const mem = m.mem;
  const side = sideNow(m);
  const tally = tallies(m);
  const need = v.voteThreshold;
  const p = m.bot.personality;
  const leading = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const nearMajority =
    leading.find(([id, n]) => n >= need - 1 && options.includes(id))?.[0] ?? null;

  if (side === 'mafia' || side === 'cutthroat') {
    const safe = options.filter((id) => !isTeammate(m, id));
    const wagon = leading.find(([id, n]) => n >= 1 && safe.includes(id))?.[0];
    if (wagon && m.rng.chance(0.85)) return wagon;
    const scapegoat = pickBest(m, safe, (id) => townSuspicion(m, id), 1);
    if (scapegoat && (townSuspicion(m, scapegoat) >= 1.5 || m.rng.chance(p.boldness * 0.5)))
      return scapegoat;
    return null;
  }
  if (side === 'accuser') {
    const target = v.you.accuserTarget;
    if (target && options.includes(target)) return target;
  }
  if (side === 'harlequin' && m.rng.chance(0.5)) return m.rng.pick(options);

  const best = pickBest(m, options, (id) => score(mem, id), 0.8);
  if (!best) return null;
  const known = options.find((id) => mem.known[id] === 'hostile');
  if (known) return known;
  if (nearMajority && score(mem, nearMajority) >= 0.5 && mem.known[nearMajority] !== 'town')
    return nearMajority;
  const threshold = (side === 'drifter' ? 4.5 : 3.5) - p.boldness * 1.5 - pressure(m);
  if (score(mem, best) >= threshold) return best;
  return null;
}

export function ballotChoice(m: Mind): 'guilty' | 'innocent' | 'abstain' {
  const v = m.view;
  const d = v.trial?.defendant;
  if (!d) return 'abstain';
  const mem = m.mem;
  const side = sideNow(m);
  if (side === 'mafia') {
    if (isTeammate(m, d)) return m.rng.chance(0.08) ? 'guilty' : 'innocent';
    return m.rng.chance(0.85) ? 'guilty' : 'abstain';
  }
  if (side === 'cutthroat') return m.rng.chance(0.85) ? 'guilty' : 'abstain';
  if (side === 'harlequin') return m.rng.pick(['guilty', 'innocent', 'guilty'] as const);
  if (side === 'accuser' && d === v.you.accuserTarget) return 'guilty';
  if (mem.known[d] === 'hostile') return 'guilty';
  if (mem.known[d] === 'town') return 'innocent';
  let s = score(mem, d);
  const claim = mem.claims[d];
  if (claim && possible(v, claim) && (mem.suspicion[d] ?? 0) < 3)
    s -= 1.2 * m.bot.personality.trust;
  if (s >= 0.8 - m.bot.personality.boldness * 0.6 - pressure(m) * 0.5) return 'guilty';
  if (s <= -1.2) return 'innocent';
  return m.rng.chance(0.5 + m.bot.personality.boldness * 0.3) ? 'guilty' : 'abstain';
}

export function shouldReveal(m: Mind): boolean {
  const v = m.view;
  if (!v.allowed.reveal) return false;
  if (v.trial?.defendant === v.you.id) return true;
  const alive = v.players.filter((p) => p.alive).length;
  if (alive <= 6 && v.phase.day >= 3) return m.rng.chance(0.5);
  if (v.phase.kind === 'voting' && v.phase.day >= 3) {
    const top = pickBest(m, v.allowed.voteTargets, (id) => score(m.mem, id), 0);
    if (top && score(m.mem, top) >= 6) return m.rng.chance(0.4 + m.bot.personality.boldness * 0.4);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Claims and cover stories
// ---------------------------------------------------------------------------

const COVERS: RoleId[] = [
  'resident',
  'mender',
  'sentinel',
  'lamplighter',
  'muse',
  'mourner',
  'reckoner',
];

/** Pick a cover role for hostile or neutral bots at game start. */
export function chooseCover(m: Mind): RoleId {
  const v = m.view;
  const role = v.you.role;
  const side = sideNow(m);
  if (side === 'town') return role;
  if (side === 'drifter' && m.rng.chance(0.7)) return 'drifter';
  const taken = new Set(v.you.teammates.map((t) => t.role));
  const pool = COVERS.filter((r) => possible(v, r) && !(ROLES[r].unique && taken.has(r)));
  const bold = m.bot.personality.boldness;
  if (
    (side === 'mafia' || side === 'accuser') &&
    possible(v, 'augur') &&
    m.rng.chance(bold * 0.45)
  ) {
    return 'augur';
  }
  if (pool.length === 0) return 'resident';
  return m.rng.weighted(pool, (r) => (r === 'resident' ? 3 : 1));
}

/** Results to back up a claim: real ones for Town, fabricated ones for bluffers. */
export function claimResults(m: Mind, role: RoleId): ClaimedResult[] {
  const v = m.view;
  if (sideNow(m) === 'town') {
    return v.you.nightResults.flatMap(({ night, result }) => toClaimed(night, result, v));
  }
  if (role !== 'augur') return [];
  // Fabricate one result per night survived, keeping earlier fabrications.
  const mem = m.mem;
  const nights = v.phase.day - 1;
  while (mem.fakeResults.length < nights) {
    const night = mem.fakeResults.length + 1;
    const pool = livingOthers(v).filter(
      (p) => !isTeammate(m, p.id) && !mem.fakeResults.some((r) => r.target === p.id),
    );
    const mate = v.you.teammates.find(
      (t) => t.alive && !mem.fakeResults.some((r) => r.target === t.id),
    );
    if (sideNow(m) === 'mafia' && mate && m.rng.chance(0.35)) {
      mem.fakeResults.push({ night, target: mate.id, finding: 'clear' });
      continue;
    }
    const target =
      sideNow(m) === 'accuser' && v.you.accuserTarget && night === 1
        ? v.you.accuserTarget
        : pickBest(
            m,
            pool.map((p) => p.id),
            (id) => (mem.suspicion[id] ?? 0) - claimValue(v, mem, id),
            1,
          );
    if (!target) break;
    mem.fakeResults.push({ night, target, finding: m.rng.chance(0.6) ? 'suspicious' : 'clear' });
  }
  return mem.fakeResults.filter((r) => isAlive(v, r.target) || r.finding === 'suspicious');
}

function toClaimed(night: number, r: NightResult, v: PlayerView): ClaimedResult[] {
  switch (r.kind) {
    case 'investigation':
      return [{ night, target: r.target, finding: r.finding }];
    case 'visitors': {
      const died = !v.players.find((p) => p.id === r.target)?.alive;
      return died && r.visitors.length > 0
        ? [{ night, target: r.target, finding: 'visited', visitors: r.visitors }]
        : [];
    }
    case 'patientAttacked':
      return [{ night, target: r.target, finding: 'healed' }];
    case 'guardFought':
      return [{ night, target: r.target, finding: 'guarded' }];
    default:
      return [];
  }
}

/** Should we claim now (and as what)? Called once per discussion and on trial. */
export function claimNow(m: Mind, onTrial: boolean): RoleId | null {
  const v = m.view;
  const mem = m.mem;
  if (v.you.role === 'magistrate') return null;
  const cover = mem.cover ?? v.you.role;
  if (mem.claimed) return onTrial ? mem.claimed : null;
  const side = sideNow(m);
  const bold = m.bot.personality.boldness;
  if (onTrial) return side === 'harlequin' ? harlequinClaim(m) : cover;
  if (side === 'town') {
    const results = claimResults(m, cover);
    const hard = results.some((r) => r.finding === 'suspicious' || r.finding === 'visited');
    if (hard && m.rng.chance(0.5 + bold * 0.5)) return cover;
    if (mem.heat >= 2.5 && m.rng.chance(0.6)) return cover;
    return null;
  }
  if (side === 'harlequin') return m.rng.chance(0.25) ? harlequinClaim(m) : null;
  if (cover === 'augur' && v.phase.day >= 2 && m.rng.chance(0.35 + bold * 0.3)) return cover;
  if (mem.heat >= 2 && m.rng.chance(0.55)) return cover;
  return null;
}

function harlequinClaim(m: Mind): RoleId {
  const pool: RoleId[] = ['augur', 'magistrate', 'reckoner', 'patron', 'resident', 'mender'];
  return m.rng.pick(pool);
}

/** A short description of a claimed result for chat. */
export function describeResults(v: PlayerView, results: ClaimedResult[]): string {
  return results
    .slice(-3)
    .map((r) => {
      const name = nameOf(v, r.target);
      switch (r.finding) {
        case 'suspicious':
          return `${name} read Suspicious`;
        case 'clear':
          return `${name} read Clear`;
        case 'visited':
          return `${(r.visitors ?? []).map((x) => nameOf(v, x)).join(' and ')} visited ${name} the night they died`;
        case 'healed':
          return `I saved ${name} from an attack`;
        case 'guarded':
          return `I fought off an attacker at ${name}'s door`;
        default:
          return `I visited ${name}`;
      }
    })
    .join('; ');
}

/** A will in a format other bots (and people) can read. */
export function writeWill(m: Mind): string {
  const v = m.view;
  const mem = m.mem;
  const side = sideNow(m);
  const role = side === 'town' ? v.you.role : (mem.claimed ?? mem.cover ?? 'resident');
  if (side !== 'town' && m.rng.chance(0.25) && !mem.claimed) return '';
  const lines = [`${ROLES[role].name}.`];
  const results = side === 'town' ? claimResults(m, role) : role === 'augur' ? mem.fakeResults : [];
  for (const r of results) {
    const name = nameOf(v, r.target);
    if (r.finding === 'suspicious' || r.finding === 'clear') {
      lines.push(`N${r.night}: ${name} - ${r.finding === 'suspicious' ? 'Suspicious' : 'Clear'}`);
    } else if (r.finding === 'visited') {
      lines.push(
        `N${r.night}: ${name} visited by ${(r.visitors ?? []).map((x) => nameOf(v, x)).join(', ')}`,
      );
    } else if (r.finding === 'healed') {
      lines.push(`N${r.night}: saved ${name} from an attack`);
    }
  }
  const top = topSuspect(m);
  if (top && score(mem, top) > 2) lines.push(`Suspect: ${nameOf(v, top)}.`);
  return lines.join('\n');
}

export function topSuspect(m: Mind, exclude: PlayerId[] = []): PlayerId | null {
  const pool = livingOthers(m.view)
    .map((p) => p.id)
    .filter((id) => !exclude.includes(id) && !isTeammate(m, id));
  if (pool.length === 0) return null;
  return pool.reduce((best, id) => (score(m.mem, id) > score(m.mem, best) ? id : best));
}

export function claimIsPlausible(v: PlayerView, role: RoleId): boolean {
  return maxCopies(v, role) > 0;
}
