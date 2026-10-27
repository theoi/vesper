/**
 * Vesper rules engine: public types.
 *
 * Contract for every consumer (net, UI, bots, sim):
 * - Everything here is plain JSON. `GameState`, `PlayerView`, events, and intents
 *   survive `JSON.parse(JSON.stringify(x))` unchanged.
 * - The engine is pure and deterministic: the same state, inputs, and `now`
 *   always produce the same output. All randomness comes from the seeded RNG
 *   stored in `GameState.rng`.
 * - Every `GameEvent` carries an `audience`. Only players in the audience may
 *   receive it. `viewFor` and `eventsFor` apply that filter for you.
 * - Times (`now`, `endsAt`, timer lengths) are milliseconds. The engine never
 *   reads a clock; callers pass `now`.
 *
 * Day/night numbering: the game opens on Day 1 (discussion only), then Night 1,
 * then Day 2, and so on. `Phase.day` is that shared counter, so `night` with
 * `day: 1` is Night 1 and the `dawn` that follows it has `day: 2`.
 */

export type PlayerId = string;

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export type Faction = 'town' | 'mafia' | 'neutral';

export type RoleId =
  // Town
  | 'augur' // investigator: learns Suspicious / Clear
  | 'lamplighter' // watcher: learns who visited a house
  | 'mender' // healer
  | 'sentinel' // bodyguard
  | 'reckoner' // vigilante
  | 'muse' // town roleblocker
  | 'magistrate' // mayor: day reveal for 3 votes
  | 'mourner' // medium: talks with the dead at night
  | 'resident' // vanilla town
  // Mafia ("the Syndicate")
  | 'patron' // leader: orders the kill, reads Clear
  | 'hatchet' // killer: carries out the kill
  | 'lure' // mafia roleblocker
  | 'slanderer' // framer
  | 'embalmer' // cleaner: hides a victim's role and will
  // Neutral
  | 'harlequin' // jester: wins if executed
  | 'accuser' // executioner: wins if a given target is executed
  | 'cutthroat' // serial killer: last one standing
  | 'drifter'; // survivor: wins by staying alive

export type RoleCategory =
  | 'town-investigative'
  | 'town-protective'
  | 'town-killing'
  | 'town-support'
  | 'town-vanilla'
  | 'mafia-leader'
  | 'mafia-killing'
  | 'mafia-support'
  | 'neutral-benign'
  | 'neutral-evil'
  | 'neutral-killing';

/** Which rule decides whether a player with this role wins. */
export type WinCondition = 'town' | 'mafia' | 'cutthroat' | 'survive' | 'harlequin' | 'accuser';

/** A random slot in a role list, resolved when the game is created. */
export type RandomSlot =
  | 'any'
  | 'random-town'
  | 'town-investigative'
  | 'town-protective'
  | 'town-killing'
  | 'town-support'
  | 'random-mafia'
  | 'mafia-support'
  | 'random-neutral'
  | 'neutral-benign'
  | 'neutral-evil'
  | 'neutral-killing';

export type RoleSlot = RoleId | RandomSlot;

export type NightActionKind =
  | 'investigate' // augur
  | 'watch' // lamplighter
  | 'heal' // mender
  | 'guard' // sentinel
  | 'shoot' // reckoner
  | 'block' // muse, lure
  | 'kill' // patron (orders), hatchet (carries out)
  | 'frame' // slanderer
  | 'embalm' // embalmer
  | 'stab' // cutthroat
  | 'vest'; // drifter (self only)

/**
 * Who a night ability may target.
 * - `self`: only yourself (no choice; submit `[yourId]`)
 * - `other`: any living player except yourself
 * - `any`: any living player including yourself
 * - `nonMafia`: any living player not in the Syndicate
 */
export type TargetRule = 'self' | 'other' | 'any' | 'nonMafia';

export interface NightAbility {
  kind: NightActionKind;
  target: TargetRule;
  /** Total uses for the game. Omitted = unlimited. */
  uses?: number;
  /** Extra cap on targeting yourself (the Mender may self-heal once). */
  selfUses?: number;
  /** First night the ability may be used (the Reckoner starts on Night 2). */
  firstNight?: number;
  /** Whether using it counts as a visit (seen by the Lamplighter). */
  visits: boolean;
}

export interface RoleDef {
  id: RoleId;
  name: string;
  faction: Faction;
  category: RoleCategory;
  win: WinCondition;
  /** One line of flavor. */
  flavor: string;
  /** Short rules text shown on the role card. */
  summary: string;
  /** One-line goal shown on the role card. */
  goal: string;
  night?: NightAbility;
  /** May reveal publicly during the day (Magistrate). */
  dayReveal?: boolean;
  /** Can read and write the dead chat at night (Mourner). */
  hearsDead?: boolean;
  /** Night defense: 0 none, 1 survives basic attacks. */
  defense: 0 | 1;
  /** What an Augur sees when not framed. */
  appearsSuspicious: boolean;
  /** At most one per game. */
  unique: boolean;
  /** May write a death note that is shown on their night victims. */
  deathNote: boolean;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface PlayerConfig {
  id: PlayerId;
  name: string;
  isBot: boolean;
}

/** Phase lengths in milliseconds. */
export interface Timers {
  reveal: number;
  /** Day 1 discussion (there is no voting on Day 1 unless `firstDayVoting`). */
  firstDiscussion: number;
  discussion: number;
  /** Total voting time per day; trials pause it and acquittals resume it. */
  voting: number;
  defense: number;
  judgment: number;
  lastWords: number;
  execution: number;
  night: number;
  dawn: number;
  /** Extra dawn time per death being revealed. */
  dawnPerDeath: number;
}

export interface GameOptions {
  /** Max trials per day before night falls. */
  maxTrialsPerDay: number;
  /** Allow nominations on Day 1. */
  firstDayVoting: boolean;
  /** Allow whispers during the day (others see that a whisper happened). */
  whispers: boolean;
  /** Draw after this many full day/night cycles in a row with no death. */
  stalemateCycles: number;
  /** Hard cap: the game ends in a draw when this day would begin. */
  maxDays: number;
}

export interface GameConfig {
  /** Seat order. */
  players: PlayerConfig[];
  /** Same length as `players`. Assigned to seats at random from the seed. */
  roles: RoleSlot[];
  timers: Timers;
  options: GameOptions;
}

export interface SetupValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface Preset {
  id: string;
  name: string;
  players: number;
  roles: RoleSlot[];
  description: string;
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

/**
 * Flow:
 * reveal → discussion(D1) → night → dawn → discussion → voting
 *   voting → defense → judgment → (guilty) lastWords → execution → night
 *                               → (innocent) voting (remaining time) …
 *   voting (time up or trial cap reached) → night
 * Any phase transition may instead go to `ended` once a win condition holds
 * (checked at the end of `dawn` and `execution`, and after deaths at night).
 */
export type PhaseKind =
  | 'reveal'
  | 'discussion'
  | 'voting'
  | 'defense'
  | 'judgment'
  | 'lastWords'
  | 'execution'
  | 'night'
  | 'dawn'
  | 'ended';

export interface Phase {
  kind: PhaseKind;
  day: number;
  startedAt: number;
  /** When `tick` will advance this phase. `null` only for `ended`. */
  endsAt: number | null;
}

// ---------------------------------------------------------------------------
// State (host only; never send to clients)
// ---------------------------------------------------------------------------

export type DeathCause =
  | 'executed'
  | 'mafia' // the Syndicate's kill
  | 'cutthroat'
  | 'reckoner'
  | 'sentinel' // killed by a Sentinel defending their charge
  | 'guarding'; // a Sentinel who died defending their charge

export interface DeathRecord {
  day: number;
  time: 'day' | 'night';
  causes: DeathCause[];
  /** Embalmed: role and will are hidden from the public until the game ends. */
  embalmed: boolean;
  /** Death notes left by the killers, if any. */
  deathNotes: string[];
  /** Role and will at the moment of death. */
  role: RoleId;
  will: string;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  isBot: boolean;
  seat: number;
  role: RoleId;
  /** The role dealt at the start (differs after promotions and conversions). */
  originalRole: RoleId;
  alive: boolean;
  death: DeathRecord | null;
  will: string;
  deathNote: string;
  /** Remaining uses of the night ability; null = unlimited or no ability. */
  usesLeft: number | null;
  selfUsesLeft: number | null;
  magistrateRevealed: boolean;
  /** Accuser only: the Town player they must get executed. */
  accuserTarget: PlayerId | null;
  /** Harlequin executed, or Accuser's target executed. */
  neutralWin: boolean;
}

export type Ballot = 'guilty' | 'innocent' | 'abstain';

export interface TrialState {
  defendant: PlayerId;
  /** Explicit ballots; anyone missing counts as abstain. */
  ballots: Record<PlayerId, Ballot>;
  /** 1-based trial count for the day. */
  number: number;
}

export interface GameResult {
  /** The faction-level outcome. `cutthroat` is the neutral killer's solo win. */
  outcome: 'town' | 'mafia' | 'cutthroat' | 'draw';
  /** Every individual winner, including coexisting neutral wins. */
  winners: PlayerId[];
  reason:
    | 'threatsEliminated'
    | 'mafiaParity'
    | 'lastKillerStanding'
    | 'allDead'
    | 'stalemate'
    | 'dayLimit';
  day: number;
}

export interface GameState {
  v: 1;
  config: GameConfig;
  /** Seeded RNG state (uint32). */
  rng: number;
  players: PlayerState[];
  phase: Phase;
  /** Every event so far, in order. Filter with `eventsFor` before sending. */
  log: GameEvent[];
  /** Seq of the last event appended to `log` (0 = none yet). */
  seq: number;
  /** Nomination votes in the current voting phase: voter → target. */
  votes: Record<PlayerId, PlayerId>;
  trial: TrialState | null;
  trialsToday: number;
  /** Voting time left when a trial paused the vote. */
  votingRemaining: number | null;
  /** Tonight's submitted actions: actor → targets. */
  night: Record<PlayerId, PlayerId[]>;
  /** Players who pressed ready in the current phase. */
  ready: PlayerId[];
  /** Consecutive full cycles without a death (for the stalemate rule). */
  quietCycles: number;
  /** Deaths since the last discussion began (for the stalemate rule). */
  deathsThisCycle: number;
  result: GameResult | null;
}

// ---------------------------------------------------------------------------
// Chat and speech acts
// ---------------------------------------------------------------------------

/**
 * - `public`: living players during day phases; everyone after the game ends.
 * - `mafia`: living Syndicate members at night.
 * - `dead`: dead players, any time; a living Mourner joins at night
 *   (anonymously, as "the Mourner").
 * - `whisper`: day only, living to living; the public sees that it happened.
 */
export type ChatChannel = 'public' | 'mafia' | 'dead' | 'whisper';

export interface ClaimedResult {
  night: number;
  target: PlayerId;
  /** What the claimant says they learned. */
  finding: 'suspicious' | 'clear' | 'visited' | 'healed' | 'guarded' | 'blocked';
  visitors?: PlayerId[];
}

/**
 * Structured meaning of a chat line. Bots attach one so other bots can follow
 * claims and accusations without parsing prose, and so the optional Claude layer
 * can rewrite the wording while keeping the meaning. It is public exactly like
 * the text it accompanies. Humans normally send none.
 */
export type SpeechAct =
  | { kind: 'claim'; role: RoleId; results?: ClaimedResult[] }
  | { kind: 'accuse'; target: PlayerId; confidence: number }
  | { kind: 'defend'; target: PlayerId }
  | { kind: 'question'; target?: PlayerId }
  | { kind: 'vote'; target: PlayerId | null }
  | { kind: 'plan'; target: PlayerId } // Syndicate chat: proposed kill
  | {
      kind: 'react';
      about: 'death' | 'trial' | 'verdict' | 'will' | 'reveal' | 'phase' | 'quiet' | 'end';
      target?: PlayerId;
    }
  | { kind: 'banter' };

export interface ChatMessage {
  channel: ChatChannel;
  /** Null when the sender is hidden from this viewer (the Mourner to the dead). */
  from: PlayerId | null;
  /** Display label when `from` is hidden, e.g. "the Mourner". */
  fromLabel?: string;
  /** Whisper recipient. */
  to?: PlayerId;
  text: string;
  meta?: SpeechAct;
}

// ---------------------------------------------------------------------------
// Night results (private)
// ---------------------------------------------------------------------------

export type NightResult =
  | { kind: 'investigation'; target: PlayerId; finding: 'suspicious' | 'clear' }
  | { kind: 'visitors'; target: PlayerId; visitors: PlayerId[] }
  | { kind: 'blocked' }
  | { kind: 'attackedSurvived'; savedBy: 'defense' | 'vest' | 'healed' | 'guarded' }
  | { kind: 'patientAttacked'; target: PlayerId; saved: boolean }
  | { kind: 'guardFought'; target: PlayerId }
  | { kind: 'targetSurvived'; target: PlayerId }
  | { kind: 'reckonerGuilt'; target: PlayerId }
  | { kind: 'embalmed'; target: PlayerId; role: RoleId; will: string }
  | { kind: 'vestUsed' }
  | { kind: 'noAction' };

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** `all` = every player, living or dead. Otherwise an explicit list. */
export type Audience = 'all' | PlayerId[];

export interface EventBase {
  /** Strictly increasing across the game, starting at 1. */
  seq: number;
  at: number;
  day: number;
  phase: PhaseKind;
  audience: Audience;
}

export type GameEventBody =
  | {
      type: 'gameStart';
      players: { id: PlayerId; name: string; seat: number }[];
      roleList: RoleSlot[];
    }
  | {
      type: 'roleAssigned';
      player: PlayerId;
      role: RoleId;
      /** Syndicate members see each other. */
      teammates?: { id: PlayerId; role: RoleId }[];
      accuserTarget?: PlayerId;
    }
  | { type: 'phase'; phase: PhaseKind; day: number; endsAt: number | null }
  | ({ type: 'chat' } & ChatMessage)
  /** Public notice that a whisper happened (text not included). */
  | { type: 'whisperNotice'; from: PlayerId; to: PlayerId }
  | {
      type: 'vote';
      voter: PlayerId;
      target: PlayerId | null;
      previous: PlayerId | null;
      weight: number;
    }
  | { type: 'trial'; defendant: PlayerId; number: number }
  /** Public notice that a voter cast or changed a ballot (choice hidden until the verdict). */
  | { type: 'ballotCast'; voter: PlayerId }
  | {
      type: 'verdict';
      defendant: PlayerId;
      guilty: boolean;
      guiltyWeight: number;
      innocentWeight: number;
      ballots: { voter: PlayerId; ballot: Ballot; weight: number }[];
    }
  | { type: 'magistrateReveal'; player: PlayerId }
  /** Private acknowledgement of your night choice (null = cleared). */
  | { type: 'nightActionSet'; player: PlayerId; targets: PlayerId[] | null }
  /** Syndicate-only: a teammate's kill or ability pick. */
  | { type: 'mafiaPick'; player: PlayerId; kind: NightActionKind; targets: PlayerId[] | null }
  | {
      type: 'death';
      player: PlayerId;
      time: 'day' | 'night';
      causes: DeathCause[];
      /** Null when embalmed (until the game ends). */
      role: RoleId | null;
      will: string | null;
      deathNotes: string[];
      embalmed: boolean;
    }
  /** Dawn summary; emitted even when nobody died. */
  | { type: 'dawn'; deaths: PlayerId[] }
  | { type: 'nightResult'; player: PlayerId; night: number; result: NightResult }
  /** Private: a role changed (Accuser → Harlequin, Syndicate promotion). */
  | {
      type: 'roleChanged';
      player: PlayerId;
      from: RoleId;
      to: RoleId;
      reason: 'targetDied' | 'promoted';
    }
  /** A neutral achieved its goal mid-game (public for the Harlequin, private for the Accuser). */
  | { type: 'neutralWin'; player: PlayerId; role: RoleId }
  | { type: 'gameOver'; result: GameResult; roles: Record<PlayerId, RoleId> };

export type GameEvent = EventBase & GameEventBody;
export type GameEventType = GameEventBody['type'];

// ---------------------------------------------------------------------------
// Intents (what a player may ask the engine to do)
// ---------------------------------------------------------------------------

export type Intent =
  | { type: 'chat'; channel: 'public' | 'mafia' | 'dead'; text: string; meta?: SpeechAct }
  | { type: 'whisper'; to: PlayerId; text: string; meta?: SpeechAct }
  /** Nomination vote during `voting`; null withdraws. */
  | { type: 'vote'; target: PlayerId | null }
  /** Ballot during `judgment`. */
  | { type: 'judge'; ballot: Ballot }
  /** Set (or clear with null) tonight's action. Self-only abilities submit `[yourId]`. */
  | { type: 'night'; targets: PlayerId[] | null }
  /** Magistrate public reveal during day phases. */
  | { type: 'reveal' }
  | { type: 'will'; text: string }
  | { type: 'deathNote'; text: string }
  /** Ready to end the phase early (reveal, discussion, night; defense/lastWords for the speaker). */
  | { type: 'ready'; ready: boolean };

export type IntentType = Intent['type'];

export interface StepResult {
  state: GameState;
  /** Events appended to `state.log` by this step, in order. */
  events: GameEvent[];
}

export interface IntentResult extends StepResult {
  /** Set when the intent was rejected; `state` is then unchanged and `events` empty. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Player view (what one player may know)
// ---------------------------------------------------------------------------

export interface SelfView {
  id: PlayerId;
  name: string;
  seat: number;
  alive: boolean;
  role: RoleId;
  faction: Faction;
  will: string;
  deathNote: string;
  usesLeft: number | null;
  selfUsesLeft: number | null;
  /** Tonight's pending action, if any. */
  nightTargets: PlayerId[] | null;
  /** Your current nomination vote. */
  vote: PlayerId | null;
  /** Your current ballot in a running trial. */
  ballot: Ballot | null;
  ready: boolean;
  magistrateRevealed: boolean;
  accuserTarget: PlayerId | null;
  neutralWin: boolean;
  /** Syndicate members only (empty otherwise). */
  teammates: { id: PlayerId; name: string; role: RoleId; alive: boolean }[];
  /** All of your night results so far, oldest first. */
  nightResults: { night: number; result: NightResult }[];
}

export interface PublicPlayer {
  id: PlayerId;
  name: string;
  seat: number;
  alive: boolean;
  isBot: boolean;
  magistrateRevealed: boolean;
  /**
   * The role this viewer knows: their own, Syndicate teammates (for Syndicate
   * viewers), revealed dead (not embalmed), the revealed Magistrate, and
   * everyone once the game has ended. Otherwise null.
   */
  role: RoleId | null;
}

export interface GraveEntry {
  id: PlayerId;
  name: string;
  day: number;
  time: 'day' | 'night';
  causes: DeathCause[];
  /** Null when embalmed (until the game ends). */
  role: RoleId | null;
  will: string | null;
  deathNotes: string[];
}

export interface TrialView {
  defendant: PlayerId;
  number: number;
  /** Who has cast an explicit ballot (choices stay hidden until the verdict). */
  voted: PlayerId[];
}

export interface AllowedActions {
  /** Channels you may post to right now. */
  chat: ('public' | 'mafia' | 'dead')[];
  whisperTo: PlayerId[];
  /** Valid nomination targets right now (empty when you can't vote). */
  voteTargets: PlayerId[];
  judge: boolean;
  /** Valid night targets right now (empty when you can't act). */
  nightTargets: PlayerId[];
  nightAction: NightActionKind | null;
  reveal: boolean;
  will: boolean;
  deathNote: boolean;
  ready: boolean;
}

export interface PlayerView {
  you: SelfView;
  players: PublicPlayer[];
  phase: Phase;
  /** The public role list for this game (slots, not seat assignments). */
  roleList: RoleSlot[];
  timers: Timers;
  options: GameOptions;
  /** Current nomination votes (voter → target) during `voting`. */
  votes: Record<PlayerId, PlayerId>;
  /** Weighted votes needed to put someone on trial. */
  voteThreshold: number;
  trial: TrialView | null;
  trialsToday: number;
  graveyard: GraveEntry[];
  allowed: AllowedActions;
  /** Events visible to you: all of them, or those after `sinceSeq`. */
  events: GameEvent[];
  /** Seq of the newest event in the game log (pass as `sinceSeq` next time). */
  lastSeq: number;
  result: GameResult | null;
}

export interface ViewOptions {
  /** Only include events with `seq > sinceSeq`. */
  sinceSeq?: number;
}
