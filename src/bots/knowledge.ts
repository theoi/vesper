/** Shared helpers for reasoning over a PlayerView and bot memory. */
import { ROLES, RANDOM_SLOT_ROLES, isRoleId } from '../engine/roles.ts';
import type { PlayerId, PlayerView, PublicPlayer, RoleId } from '../engine/types.ts';
import type { BotMemory, BotState, Reason, ReasonKey } from './types.ts';

export type Side = 'town' | 'mafia' | 'cutthroat' | 'harlequin' | 'accuser' | 'drifter';

export function sideOf(role: RoleId): Side {
  switch (ROLES[role].win) {
    case 'town':
      return 'town';
    case 'mafia':
      return 'mafia';
    case 'cutthroat':
      return 'cutthroat';
    case 'harlequin':
      return 'harlequin';
    case 'accuser':
      return 'accuser';
    case 'survive':
      return 'drifter';
  }
}

/** True for sides that know they are not a threat to the Town. */
export function knowsInnocent(side: Side): boolean {
  return side === 'town' || side === 'drifter';
}

/** How many copies of a role the public role list could contain. */
export function maxCopies(view: PlayerView, role: RoleId): number {
  let n = 0;
  for (const slot of view.roleList) {
    if (isRoleId(slot)) n += slot === role ? 1 : 0;
    else if (RANDOM_SLOT_ROLES[slot].includes(role)) n += 1;
  }
  return ROLES[role].unique ? Math.min(1, n) : n;
}

export function possible(view: PlayerView, role: RoleId): boolean {
  return maxCopies(view, role) > 0;
}

export function livingOthers(view: PlayerView): PublicPlayer[] {
  return view.players.filter((p) => p.alive && p.id !== view.you.id);
}

export function nameOf(view: PlayerView, id: PlayerId | null | undefined): string {
  return view.players.find((p) => p.id === id)?.name ?? 'someone';
}

export function isAlive(view: PlayerView, id: PlayerId): boolean {
  return !!view.players.find((p) => p.id === id)?.alive;
}

/** Suspicion including hard knowledge. Teammates read as strongly "not a target". */
export function score(mem: BotMemory, id: PlayerId): number {
  const k = mem.known[id];
  const base = mem.suspicion[id] ?? 0;
  if (k === 'hostile') return base + 20;
  if (k === 'town') return base - 20;
  return base;
}

/** How much this bot believes `id`'s claims (0..1). */
export function cred(bot: BotState, mem: BotMemory, id: PlayerId): number {
  const k = mem.known[id];
  if (k === 'town') return 1;
  if (k === 'hostile') return 0.05;
  const s = mem.suspicion[id] ?? 0;
  return Math.min(1, Math.max(0.05, 0.35 + bot.personality.trust * 0.5 - s * 0.07));
}

export function bump(
  mem: BotMemory,
  id: PlayerId,
  delta: number,
  reason?: ReasonKey,
  x?: PlayerId,
  day = 0,
): void {
  mem.suspicion[id] = (mem.suspicion[id] ?? 0) + delta;
  if (reason && delta > 0) {
    const list: Reason[] = mem.reasons[id] ?? [];
    list.push(x ? { k: reason, x, day } : { k: reason, day });
    mem.reasons[id] = list.slice(-5);
  }
}

/** The power-role value of what a player has claimed or revealed (for kills and protection). */
export function claimValue(view: PlayerView, mem: BotMemory, id: PlayerId): number {
  const p = view.players.find((x) => x.id === id);
  if (p?.magistrateRevealed) return 6;
  const role = mem.claims[id];
  if (!role) return 0;
  const values: Partial<Record<RoleId, number>> = {
    augur: 6,
    lamplighter: 4,
    mender: 3,
    sentinel: 3,
    reckoner: 3,
    mourner: 2,
    muse: 2,
    magistrate: 3,
    resident: 0.5,
    drifter: -1,
  };
  return values[role] ?? 0;
}

/** Lowercased, punctuation-free form of a chat line, for spotting repeats. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
