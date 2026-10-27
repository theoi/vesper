import {
  eventsFor,
  type GameEvent,
  type PlayerId,
  type PlayerView,
} from '../../src/engine/index.ts';
import type { HostMessage } from '../../src/net/protocol.ts';

/**
 * Hidden-information audit for one client's received messages.
 *
 * `hostLog` and `tokens` come from the host's state at the end of the game.
 * Returns a list of violations (empty = clean).
 */
export function auditClientMessages(input: {
  playerId: PlayerId;
  messages: readonly HostMessage[];
  hostLog: readonly GameEvent[];
  tokens: Readonly<Record<string, PlayerId>>;
}): string[] {
  const { playerId, messages, hostLog, tokens } = input;
  const problems: string[] = [];
  const strip = (e: GameEvent) => {
    const { seq: _seq, ...rest } = e;
    return JSON.stringify(rest);
  };
  const entitled = new Map<string, number>();
  for (const e of eventsFor(hostLog, playerId)) {
    const k = strip(e);
    entitled.set(k, (entitled.get(k) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const tokenList = Object.keys(tokens);

  messages.forEach((msg, i) => {
    const json = JSON.stringify(msg);
    for (const token of tokenList) {
      if (json.includes(token)) problems.push(`#${i} ${msg.t}: contains a player token`);
    }
    for (const key of ['"rng":', '"originalRole":', '"deathsThisCycle":', '"ballots":{']) {
      if (json.includes(key)) problems.push(`#${i} ${msg.t}: contains host-only field ${key}`);
    }
    if (msg.t !== 'view') return;
    const view = msg.view;
    if (view.you.id !== playerId) problems.push(`#${i}: view is for ${view.you.id}`);
    problems.push(...roleLeaks(view).map((p) => `#${i}: ${p}`));
    if (msg.full) seen.clear();
    let lastSeq = 0;
    for (const e of view.events) {
      if (e.seq <= lastSeq) problems.push(`#${i}: event seq not increasing`);
      lastSeq = e.seq;
      const k = strip(e);
      if (!entitled.has(k)) {
        problems.push(`#${i}: received ${e.type} event not addressed to ${playerId}`);
        continue;
      }
      seen.set(k, (seen.get(k) ?? 0) + 1);
      if ((seen.get(k) ?? 0) > (entitled.get(k) ?? 0)) {
        problems.push(`#${i}: ${e.type} event delivered more often than it happened`);
      }
    }
  });
  return problems;
}

/** Roles visible in a view that this viewer should not know. */
export function roleLeaks(view: PlayerView): string[] {
  const out: string[] = [];
  if (view.phase.kind === 'ended') return out;
  const mafia = view.you.faction === 'mafia';
  const teammates = new Set(view.you.teammates.map((t) => t.id));
  if (!mafia && teammates.size > 0) out.push('non-Syndicate viewer sees teammates');
  for (const p of view.players) {
    if (p.id === view.you.id || p.role === null) continue;
    const grave = view.graveyard.find((g) => g.id === p.id);
    const ok =
      (grave && grave.role !== null) ||
      (p.magistrateRevealed && p.role === 'magistrate') ||
      (mafia && teammates.has(p.id));
    if (!ok) out.push(`sees role of ${p.id}`);
  }
  return out;
}
