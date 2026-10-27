/**
 * The director's planner: turns a batch of new engine events into staging steps. Pure, so the
 * choices (which sequence, which variant) can be tested without a DOM.
 */
import { parseLine } from '../../bots/parse.ts';
import {
  ROLES,
  type DeathCause,
  type GameEvent,
  type GameResult,
  type NightResult,
  type PlayerId,
  type PlayerView,
  type RoleId,
  type SpeechAct,
} from '../../engine/index.ts';

export interface DeathInfo {
  player: PlayerId;
  causes: DeathCause[];
  role: RoleId | null;
  will: string | null;
  notes: string[];
  embalmed: boolean;
  /** How the death is staged in silhouette. */
  staging: 'mafia' | 'cutthroat' | 'reckoner' | 'guard' | 'executed';
}

export interface Note {
  text: string;
  tone: 'town' | 'mafia' | 'neutral';
}

export type SeqSpec =
  | {
      id: 'deal';
      tone: 'town' | 'mafia' | 'neutral';
      role: RoleId;
      teammates: PlayerId[];
      changed: boolean;
    }
  | { id: 'dayOpen'; variant: 'first' | 'quiet' | 'mourning'; day: number }
  | { id: 'trial'; variant: 'cut' | 'walk' | 'again'; defendant: PlayerId }
  | {
      id: 'verdict';
      variant: 'poly' | 'slam' | 'flare' | 'exhale' | 'claps';
      guilty: boolean;
      defendant: PlayerId;
      guiltyVoters: PlayerId[];
      innocentVoters: PlayerId[];
      g: number;
      i: number;
    }
  | { id: 'magistrate'; player: PlayerId }
  | { id: 'execution'; variant: 'lamp' | 'lowered'; player: PlayerId; death: DeathInfo | null }
  | { id: 'nightfall'; variant: 'lamps' | 'fog' | 'lantern'; first: boolean }
  | {
      id: 'dawn';
      variant: 'quiet' | 'one' | 'several';
      quiet: 'birds' | 'candles';
      deaths: DeathInfo[];
      notes: Note[];
      day: number;
    }
  | { id: 'death'; death: DeathInfo }
  | { id: 'notes'; notes: Note[] }
  | { id: 'finale'; outcome: GameResult['outcome']; won: boolean };

export type SeqId = SeqSpec['id'];

export type Beat =
  | { type: 'speak'; who: PlayerId; text: string; act?: SpeechAct }
  | { type: 'whisper'; from: PlayerId; to: PlayerId }
  | { type: 'vote'; voter: PlayerId; target: PlayerId | null }
  | { type: 'ballot'; voter: PlayerId }
  | { type: 'votingOpen'; need: number }
  | { type: 'night' };

export type Step = { kind: 'beat'; beat: Beat } | { kind: 'seq'; seq: SeqSpec };

/** What the planner remembers between batches. */
export interface Memo {
  /** Identifies the game, so every client in a room picks the same variants. */
  key: string;
  /** Last variant index used per event kind, so a variant never plays twice in a row. */
  last: Record<string, number>;
  /** Deaths revealed at the last dawn. */
  lastDawnDeaths: number;
}

export function newMemo(key: string): Memo {
  return { key, last: {}, lastDawnDeaths: 0 };
}

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

/**
 * Pick a variant for `kind`, seeded by the game and the event (not by local state), and never
 * the one used last time for the same kind.
 */
export function pickVariant<T>(memo: Memo, kind: string, salt: string, options: readonly T[]): T {
  const n = options.length;
  let i = hash(`${memo.key}|${kind}|${salt}`) % n;
  if (n > 1 && memo.last[kind] === i) i = (i + 1) % n;
  memo.last[kind] = i;
  return options[i] as T;
}

/** Stage the first cause: causes are listed in the order the attacks resolved. */
function staging(causes: readonly DeathCause[]): DeathInfo['staging'] {
  switch (causes[0]) {
    case 'executed':
      return 'executed';
    case 'mafia':
      return 'mafia';
    case 'cutthroat':
      return 'cutthroat';
    case 'reckoner':
      return 'reckoner';
    default:
      return 'guard';
  }
}

/** The speech act to stage for a line: the bot's own, or one read from a human's words. */
function actOf(e: Extract<GameEvent, { type: 'chat' }>, view: PlayerView): SpeechAct | undefined {
  if (e.meta) return e.meta;
  if (!e.from) return undefined;
  const acts = parseLine(e.text, view.players, e.from);
  return acts.find((a) => a.kind === 'claim') ?? acts.find((a) => a.kind === 'accuse');
}

function deathInfo(e: Extract<GameEvent, { type: 'death' }>): DeathInfo {
  return {
    player: e.player,
    causes: e.causes,
    role: e.role,
    will: e.will,
    notes: e.deathNotes,
    embalmed: e.embalmed,
    staging: staging(e.causes),
  };
}

const roleName = (r: RoleId) => ROLES[r].name;

/** A private night result as a line of spirit writing (null = nothing worth staging). */
export function noteFor(r: NightResult, name: (id: PlayerId) => string): Note | null {
  switch (r.kind) {
    case 'investigation':
      return {
        text: `${name(r.target)}: ${r.finding === 'suspicious' ? 'Suspicious' : 'Clear'}`,
        tone: r.finding === 'suspicious' ? 'mafia' : 'town',
      };
    case 'visitors':
      return {
        text: r.visitors.length
          ? `At ${name(r.target)}'s door: ${r.visitors.map(name).join(', ')}`
          : `No one came to ${name(r.target)}'s door`,
        tone: 'neutral',
      };
    case 'blocked':
      return { text: 'Someone kept you home', tone: 'neutral' };
    case 'attackedSurvived':
      return { text: 'A hand closed around your candle', tone: 'town' };
    case 'patientAttacked':
      return r.saved
        ? { text: `${name(r.target)} was attacked, and lived`, tone: 'town' }
        : { text: `You could not save ${name(r.target)}`, tone: 'mafia' };
    case 'guardFought':
      return { text: `You fought at ${name(r.target)}'s door`, tone: 'town' };
    case 'targetSurvived':
      return { text: `${name(r.target)} survived the night`, tone: 'neutral' };
    case 'reckonerGuilt':
      return { text: `${name(r.target)} was innocent`, tone: 'mafia' };
    case 'embalmed':
      return { text: `You laid out ${name(r.target)}, the ${roleName(r.role)}`, tone: 'mafia' };
    case 'vestUsed':
      return { text: 'You wore your vest', tone: 'neutral' };
    case 'noAction':
      return null;
  }
}

/** Plan the staging for a batch of new events (in order) seen by `view.you`. */
export function plan(events: readonly GameEvent[], view: PlayerView, memo: Memo): Step[] {
  const steps: Step[] = [];
  const me = view.you.id;
  const name = (id: PlayerId) => view.players.find((p) => p.id === id)?.name ?? 'someone';
  const seq = (s: SeqSpec) => steps.push({ kind: 'seq', seq: s });
  const beat = (b: Beat) => steps.push({ kind: 'beat', beat: b });
  const salt = (e: GameEvent) => `${e.day}:${e.at}`;

  let dawn: Extract<SeqSpec, { id: 'dawn' }> | null = null;
  let execution: Extract<SeqSpec, { id: 'execution' }> | null = null;
  const loose: Note[] = [];

  for (const e of events) {
    switch (e.type) {
      case 'roleAssigned':
        if (e.player !== me) break;
        seq({
          id: 'deal',
          tone: ROLES[e.role].faction,
          role: e.role,
          teammates: (e.teammates ?? []).map((t) => t.id),
          changed: false,
        });
        break;
      case 'roleChanged':
        if (e.player !== me) break;
        seq({ id: 'deal', tone: ROLES[e.to].faction, role: e.to, teammates: [], changed: true });
        break;
      case 'phase':
        if (e.phase === 'discussion') {
          const variant = e.day === 1 ? 'first' : memo.lastDawnDeaths > 0 ? 'mourning' : 'quiet';
          seq({ id: 'dayOpen', variant, day: e.day });
        } else if (e.phase === 'voting') {
          beat({ type: 'votingOpen', need: view.voteThreshold });
        } else if (e.phase === 'night') {
          seq({
            id: 'nightfall',
            variant: pickVariant(memo, 'nightfall', salt(e), ['lamps', 'fog', 'lantern'] as const),
            first: e.day === 1,
          });
        } else if (e.phase === 'dawn') {
          dawn = {
            id: 'dawn',
            variant: 'quiet',
            quiet: 'birds',
            deaths: [],
            notes: [],
            day: e.day,
          };
          seq(dawn);
        } else if (e.phase === 'execution') {
          const player = view.graveyard.find(
            (g) => g.causes.includes('executed') && g.day === e.day,
          )?.id;
          execution = {
            id: 'execution',
            variant: pickVariant(memo, 'execution', salt(e), ['lamp', 'lowered'] as const),
            player: player ?? '',
            death: null,
          };
          seq(execution);
        }
        break;
      case 'death': {
        const d = deathInfo(e);
        if (dawn && e.time === 'night') dawn.deaths.push(d);
        else if (execution && d.staging === 'executed') {
          execution.player = d.player;
          execution.death = d;
        } else seq({ id: 'death', death: d });
        break;
      }
      case 'dawn':
        if (dawn) {
          const n = dawn.deaths.length;
          dawn.variant = n === 0 ? 'quiet' : n === 1 ? 'one' : 'several';
          if (n === 0)
            dawn.quiet = pickVariant(memo, 'dawnQuiet', salt(e), ['birds', 'candles'] as const);
        }
        memo.lastDawnDeaths = e.deaths.length;
        break;
      case 'nightResult': {
        if (e.player !== me) break;
        const note = noteFor(e.result, name);
        if (!note) break;
        if (dawn) dawn.notes.push(note);
        else loose.push(note);
        break;
      }
      case 'chat':
        if (e.channel === 'public' && e.from)
          beat({ type: 'speak', who: e.from, text: e.text, act: actOf(e, view) });
        break;
      case 'whisperNotice':
        beat({ type: 'whisper', from: e.from, to: e.to });
        break;
      case 'vote':
        beat({ type: 'vote', voter: e.voter, target: e.target });
        break;
      case 'trial':
        seq({
          id: 'trial',
          variant:
            e.number > 1 ? 'again' : pickVariant(memo, 'trial', salt(e), ['cut', 'walk'] as const),
          defendant: e.defendant,
        });
        break;
      case 'ballotCast':
        beat({ type: 'ballot', voter: e.voter });
        break;
      case 'verdict': {
        const by = (b: string) => e.ballots.filter((x) => x.ballot === b).map((x) => x.voter);
        seq({
          id: 'verdict',
          variant: e.guilty
            ? pickVariant(memo, 'guilty', salt(e), ['poly', 'slam', 'flare'] as const)
            : pickVariant(memo, 'innocent', salt(e), ['exhale', 'claps'] as const),
          guilty: e.guilty,
          defendant: e.defendant,
          guiltyVoters: by('guilty'),
          innocentVoters: by('innocent'),
          g: e.guiltyWeight,
          i: e.innocentWeight,
        });
        break;
      }
      case 'magistrateReveal':
        seq({ id: 'magistrate', player: e.player });
        break;
      case 'nightActionSet':
      case 'mafiaPick':
        beat({ type: 'night' });
        break;
      case 'neutralWin':
        if (e.player === me) loose.push({ text: 'Your wish is granted', tone: 'neutral' });
        break;
      case 'gameOver':
        seq({ id: 'finale', outcome: e.result.outcome, won: e.result.winners.includes(me) });
        break;
      default:
        break;
    }
  }
  if (loose.length) seq({ id: 'notes', notes: loose });
  return steps;
}

/** Sequences that may be dropped when the stage falls behind the game. */
export const SKIPPABLE: ReadonlySet<SeqId> = new Set<SeqId>([
  'dayOpen',
  'nightfall',
  'trial',
  'magistrate',
  'notes',
]);
