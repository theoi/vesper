import {
  eventsFor,
  type GameEvent,
  type PlayerId,
  type PlayerView,
} from '../../src/engine/index.ts';
import type { HostMessage } from '../../src/net/protocol.ts';
import { mergeView } from '../../src/net/session.ts';

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
  /** Strings no client may ever receive (e.g. the host's API key). Never echoed in problems. */
  forbidden?: readonly string[];
}): string[] {
  const { playerId, messages, hostLog, tokens } = input;
  const forbidden = (input.forbidden ?? []).filter((s) => s.length >= 8);
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
  // Patches are checked on the view the client builds from them.
  let current: PlayerView | null = null;

  messages.forEach((msg, i) => {
    const json = JSON.stringify(msg);
    for (const token of tokenList) {
      if (json.includes(token)) problems.push(`#${i} ${msg.t}: contains a player token`);
    }
    if (forbidden.some((s) => json.includes(s))) {
      problems.push(`#${i} ${msg.t}: contains a forbidden secret`);
    }
    for (const key of ['"rng":', '"originalRole":', '"deathsThisCycle":', '"ballots":{']) {
      if (json.includes(key)) problems.push(`#${i} ${msg.t}: contains host-only field ${key}`);
    }
    if (msg.t !== 'view') return;
    if (!msg.full && !current) problems.push(`#${i}: view patch before any full view`);
    current = mergeView(current, msg);
    if (current) {
      if (current.you.id !== playerId) problems.push(`#${i}: view is for ${current.you.id}`);
      problems.push(...roleLeaks(current).map((p) => `#${i}: ${p}`));
    }
    if (msg.full) seen.clear();
    let lastSeq = 0;
    for (const e of msg.view.events) {
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
