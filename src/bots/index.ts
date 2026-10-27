/**
 * Scripted bots. A bot decides only from its own PlayerView.
 *
 * Host loop sketch (per bot):
 *   const view = viewFor(state, bot.id, { sinceSeq: bot.seenSeq });
 *   const d = decideBot(bot, view, now);
 *   bot = d.bot;
 *   for (const s of d.speech) applyIntent(state, bot.id, s.intent, now); // or rewrite s.intent.text first
 *   for (const intent of d.intents) applyIntent(state, bot.id, intent, now);
 *   // call again at d.wakeAt, and whenever new events arrive
 *
 * The LLM seam: `BotSpeech.act` is the structured meaning (claim, accusation,
 * reaction, ...) and `BotSpeech.category` the kind of line. A chat layer may
 * replace only `intent.text`; every decision stays scripted here.
 */
import { Rng, hashSeed } from '../engine/rng.ts';
import type { PlayerId } from '../engine/types.ts';
import { freshMemory } from './brain.ts';
import { PERSONALITIES } from './personalities.ts';
import type { BotState } from './types.ts';

export type * from './types.ts';
export { decideBot } from './brain.ts';
export { PERSONALITIES } from './personalities.ts';
export { askOf, parseLine, parseWill } from './parse.ts';

export const BOT_NAMES = [
  'Ottilie',
  'Bram',
  'Wren',
  'Cassius',
  'Marisol',
  'Ines',
  'Tobiah',
  'Odessa',
  'Linnea',
  'Fennick',
  'Juniper',
  'Arvo',
  'Sabine',
  'Lucan',
  'Mireille',
  'Thaddeus',
  'Ysolde',
  'Corin',
  'Petra',
  'Ansel',
  'Delphine',
  'Hollis',
  'Margo',
  'Silas',
  'Vesna',
  'Rook',
  'Elowen',
  'Caspian',
  'Agathe',
  'Bastian',
];

/** Pick `count` distinct bot names not in `taken` (case-insensitive). */
export function pickBotNames(count: number, seed: number | string, taken: string[] = []): string[] {
  const rng = new Rng(hashSeed(seed));
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  const pool = rng.shuffle(BOT_NAMES.filter((n) => !lower.has(n.toLowerCase())));
  const out = pool.slice(0, count);
  for (let i = 1; out.length < count; i++) {
    const name = `Guest ${i}`;
    if (!lower.has(name.toLowerCase())) out.push(name);
  }
  return out;
}

/** Create a bot for a seat. Pass a personality id to choose its voice. */
export function createBot(
  playerId: PlayerId,
  seed: number | string,
  opts: { personality?: string } = {},
): BotState {
  const rng = new Rng(hashSeed(seed));
  const personality =
    PERSONALITIES.find((p) => p.id === opts.personality) ?? rng.pick(PERSONALITIES);
  return {
    id: playerId,
    rng: rng.state,
    personality,
    seenSeq: 0,
    wakeAt: 0,
    memory: freshMemory(),
  };
}
