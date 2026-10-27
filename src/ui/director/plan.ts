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
  type NightRecord,
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
  | { id: 'dayOpen'; variant: 'first' | 'quiet' | 'mourning'; day: number; line: string }
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
  | {
      id: 'nightfall';
      variant: 'lamps' | 'fog' | 'lantern';
      first: boolean;
      /** The first night's card text. */
      line: string;
    }
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
  | { id: 'finale'; outcome: GameResult['outcome']; won: boolean }
  /** The curtain call's "what really happened": every night replayed in shadow, on request. */
  | { id: 'replay'; nights: NightRecord[]; outcome: GameResult['outcome']; won: boolean };

export type SeqId = SeqSpec['id'];

export type Beat =
  | { type: 'speak'; who: PlayerId; text: string; act?: SpeechAct }
  | { type: 'whisper'; from: PlayerId; to: PlayerId }
  | { type: 'vote'; voter: PlayerId; target: PlayerId | null }
  | { type: 'ballot'; voter: PlayerId }
  | { type: 'votingOpen'; need: number }
  | { type: 'night' }
  /** The Mourner speaks to the dead: the dead see it as "the Mourner", the Mourner as their own line. */
  | { type: 'mourner'; text: string };

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

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const count = (n: number) => WORDS[n] ?? String(n);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Lines for the plate as a day opens; one is picked per day, the same for the whole room. */
export const DAY_LINES = {
  first: [
    'The company takes its marks.',
    'The curtain rises on a small town.',
    'Places, everyone. The lamp is lit.',
  ],
  quiet: [
    'The lamp rises on a quiet town.',
    'Every mark is filled this morning.',
    'The town wakes and counts itself. All here.',
    'No one is missing. Not yet.',
  ],
  mourning: [
    'One mark stands empty.',
    'The town wakes one fewer.',
    'A cold candle stands where someone was.',
    'There is a gap in the line this morning.',
  ],
  mourningMany: [
    '{N} marks stand empty.',
    'The town wakes {n} fewer.',
    '{N} cold candles this morning.',
  ],
} as const;

export const FIRST_NIGHT_LINES = [
  'Lamps out. Do your work in the dark.',
  'The town sleeps. Not all of it.',
  'Doors are barred. Some of them will open.',
  'Wicks are trimmed. The shadows go to work.',
] as const;

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
          const dead = memo.lastDawnDeaths;
          const variant = e.day === 1 ? 'first' : dead > 0 ? 'mourning' : 'quiet';
          const lines =
            variant === 'mourning' && dead > 1 ? DAY_LINES.mourningMany : DAY_LINES[variant];
          const line = pickVariant(memo, `day-${variant}`, salt(e), lines)
            .replace('{N}', cap(count(dead)))
            .replace('{n}', count(dead));
          seq({ id: 'dayOpen', variant, day: e.day, line });
        } else if (e.phase === 'voting') {
          beat({ type: 'votingOpen', need: view.voteThreshold });
        } else if (e.phase === 'night') {
          seq({
            id: 'nightfall',
            variant: pickVariant(memo, 'nightfall', salt(e), ['lamps', 'fog', 'lantern'] as const),
            first: e.day === 1,
            line: pickVariant(memo, 'firstNight', salt(e), FIRST_NIGHT_LINES),
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
        else if (
          e.channel === 'dead' &&
          e.phase === 'night' &&
          (e.from === null || (e.from === view.you.id && view.you.role === 'mourner'))
        )
          beat({ type: 'mourner', text: e.text });
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

/**
 * Rate limit for face cameos, so faces punctuate the day instead of flickering: a gap after
 * each one (only a more important beat may cut in), and a rest for each face. An urgent
 * cameo (the human's own face) always gets through.
 */
export class CameoGate {
  private lastAt = -Infinity;
  private lastPri = -1;
  private readonly seen = new Map<PlayerId, number>();

  constructor(
    private readonly gapMs = 3500,
    private readonly restMs = 10_000,
  ) {}

  allow(now: number, faces: readonly PlayerId[], pri: number, urgent = false): boolean {
    if (!urgent) {
      if (now - this.lastAt < this.gapMs && pri <= this.lastPri) return false;
      if (faces.some((id) => now - (this.seen.get(id) ?? -Infinity) < this.restMs)) return false;
    }
    this.lastAt = now;
    this.lastPri = pri;
    for (const id of faces) this.seen.set(id, now);
    return true;
  }
}

/** About how long a sequence runs at normal speed, so the director can fit it to its phase. */
export function nominalMs(q: SeqSpec): number {
  switch (q.id) {
    case 'deal':
      return 4900;
    case 'dayOpen':
      return q.variant === 'first' ? 3600 : q.variant === 'quiet' ? 2600 : 3000;
    case 'trial':
      return q.variant === 'walk' ? 3400 : 3000;
    case 'verdict':
      return q.variant === 'poly' ? 2500 + Math.min(6, q.guiltyVoters.length) * 280 : 3000;
    case 'magistrate':
      return 3500;
    case 'execution':
      return q.variant === 'lamp' ? 4700 : 5300;
    case 'nightfall':
      return (q.first ? 1500 : 0) + (q.variant === 'lantern' ? 4200 : 2900);
    case 'dawn': {
      const notes = q.notes.length * 2300;
      if (q.deaths.length === 0) return 3000 + notes;
      if (q.deaths.length === 1) return 5100 + notes;
      return 900 + q.deaths.length * 2800 + notes;
    }
    case 'death':
      return 5100;
    case 'notes':
      return q.notes.length * 2300;
    case 'finale':
      return 5400;
    case 'replay':
      return 0;
  }
}

/** Fastest a sequence plays to fit its phase; beyond this a card can no longer be read. */
export const MAX_FIT = 2.4;
/** A sequence whose phase is already over catches up in about this long. */
export const CATCH_UP_SEQ_MS = 1000;

/**
 * Playback speed for a sequence: it should end with its phase (`leftMs` before the phase
 * ends, null when the phase has no timer), never play slower than normal or faster than
 * MAX_FIT, and when its phase has already passed (`late`) catch up in about a second.
 */
export function fitSpeed(nominal: number, leftMs: number | null, late: boolean): number {
  if (late) return Math.max(MAX_FIT, nominal / CATCH_UP_SEQ_MS);
  if (leftMs === null || nominal <= 0) return 1;
  const budget = leftMs - 250;
  if (budget <= 0) return MAX_FIT;
  return Math.min(MAX_FIT, Math.max(1, nominal / budget));
}

/** Sequences that may be dropped when the stage falls behind the game. */
export const SKIPPABLE: ReadonlySet<SeqId> = new Set<SeqId>([
  'dayOpen',
  'nightfall',
  'trial',
  'magistrate',
  'notes',
]);
