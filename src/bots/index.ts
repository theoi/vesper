/**
 * Scripted bots. A bot decides only from its own PlayerView.
 *
 * Host loop sketch (per bot):
 *   const view = viewFor(state, bot.id, { sinceSeq: bot.seenSeq });
 *   const d = decideBot(bot, view, now);
 *   bot = d.bot;
 *   for (const intent of d.intents) applyIntent(state, bot.id, intent, now);
 *   for (const s of d.speech) applyIntent(state, bot.id, s.intent, now); // or rewrite s.intent.text via an LLM first
 *   // call again at d.wakeAt or when new events arrive
 *
 * The LLM seam: `BotSpeech.act` is the structured meaning (claim, accusation,
 * reaction, ...). A chat layer may replace only `intent.text`; decisions stay here.
 */
import { Rng, hashSeed } from '../engine/rng.ts';
import type { PlayerId, PlayerView } from '../engine/types.ts';
import type { BotDecision, BotState, Personality } from './types.ts';

export type * from './types.ts';

export const PERSONALITIES: Personality[] = [
  {
    id: 'steady',
    label: 'Steady',
    voice: 'Calm, plain-spoken, reasons out loud.',
    temperament: 'calm',
    verbosity: 0.5,
    boldness: 0.5,
    trust: 0.5,
    quirks: [],
  },
];

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
    memory: {
      role: null,
      suspicion: {},
      known: {},
      claims: {},
      claimed: null,
      phaseKey: '',
      saidThisPhase: 0,
      actedThisPhase: false,
      topics: [],
      flags: {},
    },
  };
}

/** Decide what the bot does now, from its own view only. */
export function decideBot(bot: BotState, view: PlayerView, now: number): BotDecision {
  const next = { ...bot, seenSeq: view.lastSeq, wakeAt: now + 1000 };
  return { bot: next, intents: [], speech: [], wakeAt: next.wakeAt };
}
