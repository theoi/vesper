/**
 * Night resolution.
 *
 * Every action is simultaneous: a player killed tonight still acts tonight, and
 * the order players submitted in never matters (actors are handled in seat
 * order). The steps run in this fixed order:
 *
 * 1. Collect. Each living player's submitted action is re-validated.
 * 2. Distraction. Muse and Lure targets lose their action tonight and are told
 *    so. Distractors cannot be distracted, and Drifter armor cannot be stopped.
 *    A Cutthroat cannot be distracted either: it attacks its first distractor
 *    (by seat) instead of its own target.
 * 3. Syndicate kill. The Patron's order stands unless the Patron is distracted;
 *    otherwise the Hatchet's own pick. The Hatchet carries it out, or the Patron
 *    when no Hatchet lives. A distracted executor kills nobody.
 * 4. Marks. Slanderers frame their targets; Embalmers prepare theirs.
 * 5. Protection. Mender heals give defense 2 tonight, Drifter armor defense 1,
 *    and Sentinels stand guard.
 * 6. Attacks in order: Syndicate (power 1), Cutthroats (power 2), Reckoners
 *    (power 1). Each
 *    guarding Sentinel intercepts one attack on its charge: that attack is
 *    cancelled, the Sentinel strikes the attacker (power 2), and the attacker's
 *    blow lands on the Sentinel (power 2). An attack kills when its power exceeds
 *    the target's defense: max(role defense, armor 1, heal 2).
 * 7. Information. An Augur reads Suspicious when the target's role appears
 *    suspicious or a Slanderer framed them tonight, else Clear. A Lamplighter sees
 *    every successful visit to its target except its own.
 * 8. Aftermath. Deaths are applied. Embalmed victims hide their role and will.
 *    A Reckoner who killed a Town member gives up its remaining shots. An Accuser
 *    whose target died becomes a Harlequin. If the Syndicate has no killer left,
 *    a random member becomes the Hatchet.
 */
import type { Ctx } from './ctx.ts';
import { ROLES } from './roles.ts';
import { nightTargets } from './rules.ts';
import type {
  Audience,
  DeathCause,
  GameEventBody,
  NightActionKind,
  NightResult,
  PlayerId,
  PlayerState,
} from './types.ts';

export type Emitter = (audience: Audience, body: GameEventBody) => void;

interface Attack {
  attacker: PlayerState;
  target: PlayerState;
  power: number;
  cause: DeathCause;
  primary: boolean;
}

export interface NightReport {
  /** Events to emit after the dawn phase begins, in order. */
  pending: { audience: Audience; body: GameEventBody }[];
  deaths: PlayerId[];
}

export function resolveNight(ctx: Ctx): NightReport {
  const s = ctx.s;
  const night = s.phase.day;
  const alive = s.players.filter((p) => p.alive);
  const byId = new Map(s.players.map((p) => [p.id, p]));
  const results: { player: PlayerState; result: NightResult }[] = [];
  const resultKeys = new Set<string>();
  const tell = (player: PlayerState, result: NightResult) => {
    const key = `${player.id}:${JSON.stringify(result)}`;
    if (resultKeys.has(key)) return;
    resultKeys.add(key);
    results.push({ player, result });
  };
  const kindOf = (p: PlayerState): NightActionKind | undefined => ROLES[p.role].night?.kind;

  // 1. Collect.
  const acts = new Map<PlayerId, PlayerState>();
  for (const p of alive) {
    const target = s.night[p.id]?.[0];
    if (target === undefined || !nightTargets(s, p).includes(target)) continue;
    const t = byId.get(target);
    if (t) acts.set(p.id, t);
  }
  const actors = (kind: NightActionKind) =>
    alive.filter((p) => acts.has(p.id) && kindOf(p) === kind);

  // 2. Distraction.
  const blocked = new Set<PlayerId>();
  const redirect = new Map<PlayerId, PlayerState>();
  for (const b of actors('block')) {
    const t = acts.get(b.id) as PlayerState;
    const tk = kindOf(t);
    if (t.role === 'cutthroat') {
      if (!redirect.has(t.id)) redirect.set(t.id, b);
      continue;
    }
    if (tk === 'block' || tk === 'vest') continue;
    blocked.add(t.id);
  }
  for (const id of blocked) tell(byId.get(id) as PlayerState, { kind: 'blocked' });
  const active = (p: PlayerState) => acts.has(p.id) && !blocked.has(p.id);

  const visits: [PlayerState, PlayerState][] = [];
  const primary: Attack[] = [];

  // 3. Syndicate kill.
  const patron = alive.find((p) => p.role === 'patron');
  const hatchet = alive.find((p) => p.role === 'hatchet');
  const order = patron && active(patron) ? acts.get(patron.id) : undefined;
  let killer: PlayerState | undefined;
  let killTarget: PlayerState | undefined;
  if (hatchet) {
    killer = hatchet;
    killTarget = blocked.has(hatchet.id) ? undefined : (order ?? acts.get(hatchet.id));
  } else if (patron) {
    killer = patron;
    killTarget = order;
  }
  if (killer && killTarget) {
    visits.push([killer, killTarget]);
    primary.push({ attacker: killer, target: killTarget, power: 1, cause: 'mafia', primary: true });
  }

  // Visits for every other ability that visits (the Syndicate kill is handled above).
  for (const p of alive) {
    const kind = kindOf(p);
    if (!kind || kind === 'kill' || kind === 'stab' || !ROLES[p.role].night?.visits) continue;
    if (active(p)) visits.push([p, acts.get(p.id) as PlayerState]);
  }

  // Cutthroats: distracted ones attack their distractor instead.
  for (const c of alive.filter((p) => p.role === 'cutthroat')) {
    const target = redirect.get(c.id) ?? (active(c) ? acts.get(c.id) : undefined);
    if (!target) continue;
    visits.push([c, target]);
    const power = ROLES[c.role].night?.power ?? 1;
    primary.push({ attacker: c, target, power, cause: 'cutthroat', primary: true });
  }

  // Reckoners.
  for (const r of actors('shoot')) {
    if (!active(r)) continue;
    const target = acts.get(r.id) as PlayerState;
    if (r.usesLeft !== null) r.usesLeft -= 1;
    primary.push({ attacker: r, target, power: 1, cause: 'reckoner', primary: true });
  }

  // 4. Marks.
  const framed = new Set<PlayerId>();
  for (const f of actors('frame')) if (active(f)) framed.add((acts.get(f.id) as PlayerState).id);
  const embalm = new Map<PlayerId, PlayerState>();
  for (const e of actors('embalm')) {
    const t = acts.get(e.id) as PlayerState;
    if (active(e) && !embalm.has(t.id)) embalm.set(t.id, e);
  }

  // 5. Protection.
  const heals = new Map<PlayerId, PlayerState[]>();
  for (const m of actors('heal')) {
    if (!active(m)) continue;
    const t = acts.get(m.id) as PlayerState;
    if (t.id === m.id && m.selfUsesLeft !== null) m.selfUsesLeft -= 1;
    heals.set(t.id, [...(heals.get(t.id) ?? []), m]);
  }
  const guards = new Map<PlayerId, PlayerState[]>();
  for (const g of actors('guard')) {
    if (!active(g)) continue;
    const t = acts.get(g.id) as PlayerState;
    guards.set(t.id, [...(guards.get(t.id) ?? []), g]);
  }
  const armored = new Set<PlayerId>();
  for (const d of actors('vest')) {
    armored.add(d.id);
    if (d.usesLeft !== null) d.usesLeft -= 1;
    tell(d, { kind: 'vestUsed' });
  }

  // 6. Attacks.
  const resolved: Attack[] = [];
  for (const a of primary) {
    const sentinel = guards.get(a.target.id)?.shift();
    if (!sentinel) {
      resolved.push(a);
      continue;
    }
    tell(a.target, { kind: 'attackedSurvived', savedBy: 'guarded' });
    tell(sentinel, { kind: 'guardFought', target: a.target.id });
    resolved.push({
      attacker: sentinel,
      target: a.attacker,
      power: 2,
      cause: 'sentinel',
      primary: false,
    });
    resolved.push({
      attacker: a.attacker,
      target: sentinel,
      power: 2,
      cause: 'guarding',
      primary: false,
    });
  }
  const defenseOf = (p: PlayerState) =>
    Math.max(ROLES[p.role].defense, armored.has(p.id) ? 1 : 0, heals.has(p.id) ? 2 : 0);
  const dying = new Map<
    PlayerId,
    { causes: DeathCause[]; notes: string[]; killers: PlayerState[] }
  >();
  for (const a of resolved) {
    if (a.power > defenseOf(a.target)) {
      const d = dying.get(a.target.id) ?? { causes: [], notes: [], killers: [] };
      if (!d.causes.includes(a.cause)) d.causes.push(a.cause);
      d.killers.push(a.attacker);
      const note = a.attacker.deathNote.trim();
      if (a.primary && ROLES[a.attacker.role].deathNote && note && !d.notes.includes(note)) {
        d.notes.push(note);
      }
      dying.set(a.target.id, d);
      continue;
    }
    const savedBy = heals.has(a.target.id)
      ? 'healed'
      : armored.has(a.target.id)
        ? 'vest'
        : 'defense';
    tell(a.target, { kind: 'attackedSurvived', savedBy });
    for (const m of heals.get(a.target.id) ?? []) {
      tell(m, { kind: 'patientAttacked', target: a.target.id, saved: true });
    }
    if (a.primary) tell(a.attacker, { kind: 'targetSurvived', target: a.target.id });
  }

  // 7. Information (roles as they were during the night).
  for (const aug of actors('investigate')) {
    if (!active(aug)) continue;
    const t = acts.get(aug.id) as PlayerState;
    const suspicious = framed.has(t.id) || ROLES[t.role].appearsSuspicious;
    tell(aug, {
      kind: 'investigation',
      target: t.id,
      finding: suspicious ? 'suspicious' : 'clear',
    });
  }
  for (const l of actors('watch')) {
    if (!active(l)) continue;
    const t = acts.get(l.id) as PlayerState;
    const seen = new Set<PlayerId>();
    for (const [v, tt] of visits) if (tt.id === t.id && v.id !== l.id) seen.add(v.id);
    const visitors = s.players.filter((p) => seen.has(p.id)).map((p) => p.id);
    tell(l, { kind: 'visitors', target: t.id, visitors });
  }

  // 8. Aftermath.
  const pending: NightReport['pending'] = [];
  const out: Emitter = (audience, body) => pending.push({ audience, body });
  const deaths: PlayerId[] = [];
  for (const p of s.players) {
    const d = dying.get(p.id);
    if (!d) continue;
    p.alive = false;
    p.death = {
      day: night,
      time: 'night',
      causes: d.causes,
      embalmed: false,
      deathNotes: d.notes,
      role: p.role,
      will: p.will,
    };
    deaths.push(p.id);
    s.deathsThisCycle += 1;
  }
  for (const [targetId, e] of embalm) {
    const t = byId.get(targetId) as PlayerState;
    if (!t.death || t.death.day !== night || t.death.time !== 'night') continue;
    t.death.embalmed = true;
    if (e.usesLeft !== null) e.usesLeft -= 1;
    tell(e, { kind: 'embalmed', target: t.id, role: t.death.role, will: t.death.will });
  }
  for (const a of resolved) {
    if (a.cause !== 'reckoner' || !dying.has(a.target.id)) continue;
    if (ROLES[a.target.role].faction !== 'town') continue;
    a.attacker.usesLeft = 0;
    tell(a.attacker, { kind: 'reckonerGuilt', target: a.target.id });
  }

  for (const id of deaths) {
    const p = byId.get(id) as PlayerState;
    const d = p.death as NonNullable<PlayerState['death']>;
    out('all', {
      type: 'death',
      player: id,
      time: 'night',
      causes: d.causes,
      role: d.embalmed ? null : d.role,
      will: d.embalmed ? null : d.will,
      deathNotes: d.deathNotes,
      embalmed: d.embalmed,
    });
  }
  out('all', { type: 'dawn', deaths });
  for (const { player, result } of results) {
    player.nightResults.push({ night, result });
    out([player.id], { type: 'nightResult', player: player.id, night, result });
  }
  convertAccusers(ctx, deaths, out);
  ensureSyndicateKiller(ctx, out);
  return { pending, deaths };
}

/** Accusers whose target died other than by execution become Harlequins. */
export function convertAccusers(ctx: Ctx, deaths: PlayerId[], out: Emitter): void {
  for (const a of ctx.s.players) {
    if (!a.alive || a.role !== 'accuser' || a.neutralWin) continue;
    if (!a.accuserTarget || !deaths.includes(a.accuserTarget)) continue;
    a.role = 'harlequin';
    out([a.id], {
      type: 'roleChanged',
      player: a.id,
      from: 'accuser',
      to: 'harlequin',
      reason: 'targetDied',
    });
  }
}

/** If the Syndicate lives but has no Patron or Hatchet, promote a random member. */
export function ensureSyndicateKiller(ctx: Ctx, out: Emitter): void {
  const mafia = ctx.s.players.filter((p) => p.alive && ROLES[p.role].faction === 'mafia');
  if (mafia.length === 0 || mafia.some((p) => p.role === 'patron' || p.role === 'hatchet')) return;
  const chosen = ctx.rng.pick(mafia);
  const from = chosen.role;
  chosen.role = 'hatchet';
  chosen.usesLeft = null;
  chosen.selfUsesLeft = null;
  out(
    mafia.map((p) => p.id),
    { type: 'roleChanged', player: chosen.id, from, to: 'hatchet', reason: 'promoted' },
  );
}
