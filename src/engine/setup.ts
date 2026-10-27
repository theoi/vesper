import { ROLES, RANDOM_SLOT_ROLES, isRandomSlot, isRoleId } from './roles.ts';
import type { Rng } from './rng.ts';
import type {
  GameConfig,
  GameOptions,
  PlayerConfig,
  Preset,
  RandomSlot,
  RoleId,
  RoleSlot,
  SetupValidation,
  Timers,
} from './types.ts';

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 16;
export const MAX_NAME_LENGTH = 24;

export const DEFAULT_TIMERS: Timers = {
  reveal: 10_000,
  firstDiscussion: 40_000,
  discussion: 60_000,
  voting: 40_000,
  defense: 20_000,
  judgment: 15_000,
  lastWords: 8_000,
  execution: 6_000,
  night: 40_000,
  dawn: 6_000,
  dawnPerDeath: 3_000,
};

/** Short timers for quick games and tests. */
export const FAST_TIMERS: Timers = {
  reveal: 4_000,
  firstDiscussion: 15_000,
  discussion: 25_000,
  voting: 20_000,
  defense: 10_000,
  judgment: 10_000,
  lastWords: 5_000,
  execution: 3_000,
  night: 20_000,
  dawn: 3_000,
  dawnPerDeath: 1_500,
};

export const DEFAULT_OPTIONS: GameOptions = {
  maxTrialsPerDay: 3,
  firstDayVoting: false,
  whispers: true,
  stalemateCycles: 3,
  maxDays: 25,
};

/** Hand-tuned setups. Each is balanced by simulation; see the sim report. */
export const PRESETS: Preset[] = [
  {
    id: 'vesper-7',
    name: 'Seven Candles',
    players: 7,
    roles: ['augur', 'mender', 'muse', 'resident', 'patron', 'hatchet', 'harlequin'],
    description: 'A tight table: one reader, one healer, and a Syndicate pair.',
  },
  {
    id: 'vesper-8',
    name: 'Eight Bells',
    players: 8,
    roles: [
      'augur',
      'lamplighter',
      'mender',
      'resident',
      'resident',
      'patron',
      'hatchet',
      'accuser',
    ],
    description: 'Two investigators against a pair, with an Accuser stirring the pot.',
  },
  {
    id: 'vesper-9',
    name: 'Nine Lanterns',
    players: 9,
    roles: [
      'augur',
      'lamplighter',
      'mender',
      'reckoner',
      'resident',
      'patron',
      'hatchet',
      'lure',
      'harlequin',
    ],
    description: 'A Reckoner joins the town; the Syndicate brings a Lure.',
  },
  {
    id: 'vesper-10',
    name: 'Ten Shutters',
    players: 10,
    roles: [
      'augur',
      'lamplighter',
      'mender',
      'sentinel',
      'muse',
      'resident',
      'patron',
      'hatchet',
      'slanderer',
      'drifter',
    ],
    description: 'Framing and guarding. The Drifter just wants to see dawn.',
  },
  {
    id: 'vesper-11',
    name: 'Eleven Keys',
    players: 11,
    roles: [
      'augur',
      'lamplighter',
      'mender',
      'sentinel',
      'reckoner',
      'magistrate',
      'patron',
      'hatchet',
      'lure',
      'accuser',
      'drifter',
    ],
    description: 'The Magistrate holds three votes, if they live to use them.',
  },
  {
    id: 'vesper-12',
    name: 'Twelve Chimes',
    players: 12,
    roles: [
      'augur',
      'lamplighter',
      'mender',
      'sentinel',
      'reckoner',
      'muse',
      'mourner',
      'patron',
      'hatchet',
      'slanderer',
      'harlequin',
      'cutthroat',
    ],
    description: 'A Cutthroat stalks the streets alongside the Syndicate.',
  },
  {
    id: 'vesper-13',
    name: 'Thirteen Doors',
    players: 13,
    roles: [
      'augur',
      'lamplighter',
      'mender',
      'sentinel',
      'reckoner',
      'muse',
      'magistrate',
      'resident',
      'patron',
      'hatchet',
      'lure',
      'slanderer',
      'cutthroat',
    ],
    description: 'Three Syndicate, a Cutthroat, and a full town bench.',
  },
  {
    id: 'vesper-14',
    name: 'Fourteen Wicks',
    players: 14,
    roles: [
      'augur',
      'lamplighter',
      'mender',
      'sentinel',
      'reckoner',
      'muse',
      'magistrate',
      'mourner',
      'resident',
      'patron',
      'hatchet',
      'lure',
      'embalmer',
      'accuser',
    ],
    description: 'Bodies go missing: the Embalmer hides what the dead were.',
  },
  {
    id: 'vesper-15',
    name: 'Fifteen Hours',
    players: 15,
    roles: [
      'augur',
      'lamplighter',
      'mender',
      'sentinel',
      'reckoner',
      'muse',
      'magistrate',
      'mourner',
      'random-town',
      'patron',
      'hatchet',
      'slanderer',
      'embalmer',
      'cutthroat',
      'harlequin',
    ],
    description: 'The full night: every archetype at one table.',
  },
];

/** Built-in setup for a player count. Sizes outside 7–15 get a scaled fallback. */
export function presetFor(playerCount: number): Preset {
  const exact = PRESETS.find((p) => p.players === playerCount);
  if (exact) return exact;
  if (playerCount < 7) {
    const town: RoleSlot[] = ['augur', 'mender', 'resident', 'resident', 'resident'];
    return {
      id: `vesper-${playerCount}`,
      name: `${playerCount} Players`,
      players: playerCount,
      roles: [...town.slice(0, Math.max(0, playerCount - 1)), 'hatchet'],
      description: 'A small table with a lone Hatchet.',
    };
  }
  const base = PRESETS[PRESETS.length - 1] as Preset;
  const roles = base.roles.slice();
  while (roles.length < playerCount) roles.push('random-town');
  return {
    id: `vesper-${playerCount}`,
    name: `${playerCount} Players`,
    players: playerCount,
    roles,
    description: 'The full night, with extra Random Town seats.',
  };
}

export function defaultConfig(
  players: PlayerConfig[],
  overrides: Partial<GameConfig> = {},
): GameConfig {
  return {
    players,
    roles: overrides.roles ?? presetFor(players.length).roles.slice(),
    timers: { ...DEFAULT_TIMERS, ...overrides.timers },
    options: { ...DEFAULT_OPTIONS, ...overrides.options },
  };
}

function slotFaction(slot: RoleSlot): 'town' | 'mafia' | 'neutral' | 'mixed' {
  if (isRoleId(slot)) return ROLES[slot].faction;
  const factions = new Set(RANDOM_SLOT_ROLES[slot].map((r) => ROLES[r].faction));
  return factions.size === 1 ? ([...factions][0] as 'town' | 'mafia' | 'neutral') : 'mixed';
}

/** Validate a host-configured role list for a given player count. */
export function validateRoleList(roles: readonly string[], playerCount: number): SetupValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    errors.push(`Games need ${MIN_PLAYERS} to ${MAX_PLAYERS} players.`);
  }
  if (roles.length !== playerCount) {
    errors.push(`The role list has ${roles.length} slots for ${playerCount} players.`);
  }
  const unknown = roles.filter((r) => !isRoleId(r) && !isRandomSlot(r));
  if (unknown.length > 0) errors.push(`Unknown role or slot: ${unknown.join(', ')}.`);
  if (errors.length > 0) return { ok: false, errors, warnings };

  const slots = roles as RoleSlot[];
  const counts = new Map<RoleId, number>();
  for (const s of slots) if (isRoleId(s)) counts.set(s, (counts.get(s) ?? 0) + 1);
  for (const [role, n] of counts) {
    if (ROLES[role].unique && n > 1) errors.push(`${ROLES[role].name} can appear only once.`);
  }

  // Every random slot must still be fillable once explicit roles are placed.
  const fill = tryResolve(slots, null);
  if (!fill) errors.push('Some random slots cannot be filled without breaking one-per-game roles.');

  const town = slots.filter((s) => slotFaction(s) === 'town').length;
  const mafia = slots.filter((s) => slotFaction(s) === 'mafia').length;
  const killers = slots.filter((s) => s === 'cutthroat' || s === 'neutral-killing').length;
  if (mafia + killers === 0) {
    errors.push('Add at least one Syndicate slot or a Cutthroat so the town has someone to find.');
  }
  if (mafia > 0 && mafia >= town) errors.push('The Syndicate must start smaller than the Town.');
  if (slots.includes('accuser') && town === 0)
    errors.push('An Accuser needs at least one Town player.');

  if (mafia > 0 && !slots.some((s) => s === 'patron' || s === 'hatchet' || s === 'random-mafia')) {
    warnings.push(
      'No Syndicate killer is listed; one Syndicate member will be promoted to Hatchet.',
    );
  }
  if (
    !slots.some((s) => isRoleId(s) && ROLES[s].category === 'town-investigative') &&
    !slots.includes('town-investigative')
  ) {
    warnings.push('No investigative role: the town will be playing blind.');
  }
  const hostile = mafia + killers;
  if (hostile / playerCount > 0.4) warnings.push('Very many killers for this table size.');
  if (playerCount >= 8 && hostile / playerCount < 0.18)
    warnings.push('Very few killers for this table size.');
  if (slots.includes('any')) warnings.push('"Any Role" slots can tilt the balance a lot.');
  return { ok: errors.length === 0, errors, warnings };
}

const SLOT_ORDER: RandomSlot[] = [
  'town-investigative',
  'town-protective',
  'town-killing',
  'town-support',
  'mafia-support',
  'neutral-benign',
  'neutral-evil',
  'neutral-killing',
  'random-mafia',
  'random-town',
  'random-neutral',
  'any',
];

/**
 * Resolve random slots to concrete roles. With `rng = null` it checks feasibility
 * deterministically (first available choice). Returns null if impossible.
 */
function tryResolve(slots: readonly RoleSlot[], rng: Rng | null): RoleId[] | null {
  const out: (RoleId | null)[] = slots.map((s) => (isRoleId(s) ? s : null));
  const used = new Map<RoleId, number>();
  for (const r of out) if (r) used.set(r, (used.get(r) ?? 0) + 1);
  for (const kind of SLOT_ORDER) {
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] !== kind) continue;
      const options = RANDOM_SLOT_ROLES[kind].filter((r) => !ROLES[r].unique || !used.has(r));
      if (options.length === 0) return null;
      const role = rng ? rng.pick(options) : (options[0] as RoleId);
      out[i] = role;
      used.set(role, (used.get(role) ?? 0) + 1);
    }
  }
  return out as RoleId[];
}

/**
 * Turn a validated role list into one concrete role per seat. Random slots are
 * resolved, a Syndicate killer is guaranteed, and roles are shuffled over seats.
 */
export function dealRoles(slots: readonly RoleSlot[], rng: Rng): RoleId[] {
  const resolved = tryResolve(slots, rng);
  if (!resolved) throw new Error('Role list cannot be resolved');
  const mafiaIdx = resolved.flatMap((r, i) => (ROLES[r].faction === 'mafia' ? [i] : []));
  const hasKiller = resolved.some((r) => r === 'patron' || r === 'hatchet');
  if (mafiaIdx.length > 0 && !hasKiller) resolved[mafiaIdx[0] as number] = 'hatchet';
  return rng.shuffle(resolved);
}
