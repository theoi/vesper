import type { Intent, PlayerId, RoleId, SpeechAct } from '../engine/types.ts';

export type Temperament =
  'calm' | 'fiery' | 'anxious' | 'cheerful' | 'cold' | 'theatrical' | 'wry' | 'earnest';

export type Quirk =
  | 'lowercase' // writes everything in lowercase
  | 'ellipses' // trails off...
  | 'exclaims' // lots of exclamation marks
  | 'nicknames' // shortens names
  | 'catchphrase' // repeats a signature phrase
  | 'questions' // answers with questions
  | 'formal' // stiff, complete sentences
  | 'terse'; // drops words

export interface Personality {
  id: string;
  /** Short label for the host's settings screen and the LLM prompt. */
  label: string;
  /** One-sentence description of how this bot talks. */
  voice: string;
  temperament: Temperament;
  /** 0..1: how often the bot speaks. */
  verbosity: number;
  /** 0..1: how readily it accuses, claims, and pushes votes. */
  boldness: number;
  /** 0..1: how much it believes other players' claims. */
  trust: number;
  quirks: Quirk[];
  catchphrase?: string;
}

/** A chat line a bot wants to say, with its structured meaning. */
export interface BotSpeech {
  /** Ready-to-apply intent carrying the scripted text; `intent.meta` equals `act`. */
  intent: Extract<Intent, { type: 'chat' } | { type: 'whisper' }>;
  act: SpeechAct;
  /** Personality id of the speaker (for an LLM layer to keep the voice). */
  personality: string;
}

/** Internal bot memory; JSON only. Other modules should treat it as opaque. */
export interface BotMemory {
  role: RoleId | null;
  /** Suspicion per player: positive = likely hostile, negative = likely town. */
  suspicion: Record<PlayerId, number>;
  /** Players this bot has hard knowledge about (own results, teammates, reveals). */
  known: Record<PlayerId, 'town' | 'hostile' | 'mafia'>;
  /** Public role claims seen: player → claimed role. */
  claims: Record<PlayerId, RoleId>;
  /** Our own public claim, once made. */
  claimed: RoleId | null;
  /** Per-phase bookkeeping, reset on phase change. */
  phaseKey: string;
  saidThisPhase: number;
  actedThisPhase: boolean;
  topics: string[];
  /** Free-form counters and flags. */
  flags: Record<string, number>;
}

export interface BotState {
  id: PlayerId;
  /** RNG state (uint32). */
  rng: number;
  personality: Personality;
  /** Seq of the newest event processed; pass as `viewFor(..., { sinceSeq })`. */
  seenSeq: number;
  /** Earliest time the bot wants to be asked again. */
  wakeAt: number;
  memory: BotMemory;
}

export interface BotDecision {
  bot: BotState;
  /** Non-chat intents (votes, ballots, night actions, wills, ready). */
  intents: Intent[];
  /** Chat lines. Apply `speech[i].intent` directly, or rewrite its text first. */
  speech: BotSpeech[];
  /** When to call `decideBot` again (also call it whenever new events arrive). */
  wakeAt: number;
}
