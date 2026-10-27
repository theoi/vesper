import { ROLES } from './roles.ts';
import { isMafia, living, voteWeight } from './rules.ts';
import type { GameResult, GameState, PlayerId } from './types.ts';

/**
 * Win conditions, checked at the end of dawn and of an execution:
 * - Nobody alive: draw.
 * - No Syndicate and no Cutthroat alive: Town wins (a draw if no Town is left).
 * - No Cutthroat alive and the Syndicate's voting weight is at least everyone
 *   else's: the Syndicate wins.
 * - No Syndicate, one Cutthroat, and at most one other player alive: the
 *   Cutthroat wins.
 * Neutral goals are personal and coexist with any outcome: a Drifter wins if
 * alive at the end; a Harlequin or Accuser wins once their goal was met.
 */
export function evaluateWin(s: GameState): GameResult | null {
  const alive = living(s);
  if (alive.length === 0) return makeResult(s, 'draw', 'allDead');
  const mafia = alive.filter(isMafia);
  const cutthroats = alive.filter((p) => p.role === 'cutthroat');
  const town = alive.filter((p) => ROLES[p.role].faction === 'town');
  if (mafia.length === 0 && cutthroats.length === 0) {
    return makeResult(s, town.length > 0 ? 'town' : 'draw', 'threatsEliminated');
  }
  if (cutthroats.length === 0) {
    const mafiaWeight = mafia.reduce((n, p) => n + voteWeight(p), 0);
    const otherWeight = alive.filter((p) => !isMafia(p)).reduce((n, p) => n + voteWeight(p), 0);
    if (mafiaWeight >= otherWeight) return makeResult(s, 'mafia', 'mafiaParity');
  }
  if (mafia.length === 0 && cutthroats.length === 1 && alive.length <= 2) {
    return makeResult(s, 'cutthroat', 'lastKillerStanding');
  }
  return null;
}

export function makeResult(
  s: GameState,
  outcome: GameResult['outcome'],
  reason: GameResult['reason'],
): GameResult {
  return { outcome, winners: winnersFor(s, outcome), reason, day: s.phase.day };
}

export function winnersFor(s: GameState, outcome: GameResult['outcome']): PlayerId[] {
  return s.players
    .filter((p) => {
      switch (ROLES[p.role].win) {
        case 'town':
          return outcome === 'town';
        case 'mafia':
          return outcome === 'mafia';
        case 'cutthroat':
          return outcome === 'cutthroat' && p.alive;
        case 'survive':
          return p.alive;
        case 'harlequin':
        case 'accuser':
          return p.neutralWin;
      }
    })
    .map((p) => p.id);
}
