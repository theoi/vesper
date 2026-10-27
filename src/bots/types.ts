import type { ClaimedResult, Intent, PlayerId, RoleId, SpeechAct } from '../engine/types.ts';

export type Temperament =
  'calm' | 'fiery' | 'anxious' | 'cheerful' | 'cold' | 'theatrical' | 'wry' | 'earnest';

export type Quirk =
  | 'lowercase' // writes everything in lowercase
  | 'ellipses' // trails off...
  | 'exclaims' // lots of exclamation marks
  | 'nicknames' // shortens names
  | 'catchphrase' // repeats a signature phrase
  | 'questions' // tags statements with questions
  | 'formal' // no contractions
  | 'terse'; // drops filler words

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
  /** Template category the scripted text came from (useful context for an LLM). */
  category: string;
}

export type ReasonKey =
  | 'readSuspicious'
  | 'votedTown'
  | 'wagonStarter'
  | 'defendedMafia'
  | 'innocentOnMafia'
  | 'fakeClaim'
  | 'counterClaim'
  | 'lyingAboutMe'
  | 'quiet'
  | 'visitedVictim'
  | 'accusedByDead'
  | 'claimedSuspicious'
  | 'accusedMe'
  | 'gut';

export interface Reason {
  k: ReasonKey;
  x?: PlayerId;
  day: number;
}

/** What a direct question asks for. */
export type Ask = 'role' | 'suspect' | 'open';

/** Something a bot intends to say; turned into a line when its turn comes. */
export type Topic =
  | { t: 'greet' }
  | { t: 'death'; player: PlayerId; role: RoleId | null; power: boolean }
  | { t: 'deathNote'; player: PlayerId; note: string }
  | { t: 'will'; player: PlayerId; summary: string }
  | { t: 'quietNight' }
  | { t: 'exec'; player: PlayerId; role: RoleId }
  | { t: 'claim'; role: RoleId; results?: ClaimedResult[] }
  | { t: 'accuse'; target: PlayerId; hard: boolean }
  | { t: 'defendSelf'; accuser: PlayerId }
  | { t: 'defendOther'; target: PlayerId }
  | { t: 'question'; target?: PlayerId }
  | { t: 'doubt'; target: PlayerId; role: RoleId }
  | { t: 'believe'; target: PlayerId; role: RoleId }
  | { t: 'vote'; target: PlayerId }
  | { t: 'urge'; target: PlayerId }
  | { t: 'plea' }
  | { t: 'judge'; target: PlayerId; guilty: boolean }
  | { t: 'lastWords' }
  | { t: 'trialReact'; target: PlayerId }
  | { t: 'banter' }
  | { t: 'mafiaPlan'; target: PlayerId; why: string }
  | { t: 'mafiaAgree'; target: PlayerId }
  | { t: 'mafiaCover'; role: RoleId }
  | { t: 'mafiaBanter' }
  | { t: 'deadIntro' }
  | { t: 'deadTip'; target: PlayerId; finding: string }
  | { t: 'deadBanter' }
  | { t: 'mournerAsk' }
  | { t: 'mournerRelay'; target: PlayerId; finding: string }
  | { t: 'magistrate' }
  | { t: 'magistrateReact'; target: PlayerId }
  | { t: 'bait' }
  /** An answer to a question; `open` when it was asked of everyone. */
  | { t: 'reply'; to: PlayerId; ask?: Ask; open?: boolean }
  /** Someone else claimed our unique role. */
  | { t: 'counterClaim'; target: PlayerId; role: RoleId }
  | { t: 'whisperClaim'; to: PlayerId; role: RoleId }
  | { t: 'end'; outcome: 'win' | 'lose' | 'draw' };

/** Internal bot memory; JSON only. Other modules should treat it as opaque. */
export interface BotMemory {
  role: RoleId | null;
  teammates: PlayerId[];
  /** Suspicion per player: positive = likely hostile, negative = likely town. */
  suspicion: Record<PlayerId, number>;
  reasons: Record<PlayerId, Reason[]>;
  /** Hard knowledge from own results, reveals, and contradictions. */
  known: Record<PlayerId, 'town' | 'hostile'>;
  /** Public role claims seen: player → claimed role. */
  claims: Record<PlayerId, RoleId>;
  claimDay: Record<PlayerId, number>;
  claimResults: Record<PlayerId, ClaimedResult[]>;
  /** Our own public claim, once made. */
  claimed: RoleId | null;
  /** The role we will claim if pressed (our real one for Town). */
  cover: RoleId | null;
  /** Fabricated results backing a fake investigative claim. */
  fakeResults: ClaimedResult[];
  checked: PlayerId[];
  /** Public lines per player today. */
  msgs: Record<PlayerId, number>;
  accusedBy: Record<PlayerId, PlayerId[]>;
  defendedBy: Record<PlayerId, PlayerId[]>;
  /** Voters who put each defendant on trial (latest trial). */
  wagons: Record<PlayerId, PlayerId[]>;
  ballots: Record<PlayerId, { guilty: PlayerId[]; innocent: PlayerId[] }>;
  /** Live nomination votes today: voter → target, in vote order. */
  dayVotes: Record<PlayerId, PlayerId>;
  /** Dead tips heard as the Mourner. */
  deadTips: { target: PlayerId; finding: string }[];
  /** Teammates' night picks (Syndicate). */
  mafiaPicks: Record<PlayerId, PlayerId>;
  phaseKey: string;
  phaseStart: number;
  said: number;
  nextChatAt: number;
  actAt: number;
  acted: boolean;
  readyAt: number;
  queue: Topic[];
  /** Reactions saved for the next time public chat opens. */
  pending: Topic[];
  /** Topic keys already covered, to avoid repeating ourselves. */
  topics: string[];
  /** Recently used template ids. */
  recent: string[];
  /** Recently heard public lines (normalized), to avoid echoing others. */
  heard: string[];
  /** Pressure on us today (accusations, votes). */
  heat: number;
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
