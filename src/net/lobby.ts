import {
  DEFAULT_OPTIONS,
  DEFAULT_TIMERS,
  FAST_TIMERS,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  MIN_PLAYERS,
  presetFor,
  validateRoleList,
  type GameConfig,
  type PlayerId,
  type RoleSlot,
  type SetupValidation,
} from '../engine/index.ts';

export type SeatKind = 'host' | 'human' | 'bot';
export type Pace = 'standard' | 'fast';

export interface LobbySettings {
  /** Custom role list; null uses the built-in preset for the seat count. */
  roles: RoleSlot[] | null;
  pace: Pace;
}

export interface LobbySeat {
  id: PlayerId;
  name: string;
  kind: SeatKind;
  /** False while a human is disconnected. Bots and the host are always connected. */
  connected: boolean;
}

export type LobbyStatus = 'open' | 'playing' | 'ended';

/** Public lobby state. Safe to send to every player. */
export interface LobbyView {
  code: string;
  hostId: PlayerId;
  status: LobbyStatus;
  seats: LobbySeat[];
  settings: LobbySettings;
  /** The role list that will be used (custom or preset). */
  roles: RoleSlot[];
  presetName: string | null;
  validation: SetupValidation;
  minSeats: number;
  maxSeats: number;
  /** Games started in this room. A new number means a new game. */
  round: number;
}

export function cleanName(raw: string): string {
  return raw
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

/** A unique, non-empty display name: "Wren", then "Wren 2", "Wren 3", ... */
export function uniqueName(raw: string, taken: readonly string[], fallback = 'Guest'): string {
  const base = cleanName(raw) || fallback;
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const suffix = ` ${i}`;
    const name = base.slice(0, MAX_NAME_LENGTH - suffix.length) + suffix;
    if (!lower.has(name.toLowerCase())) return name;
  }
}

export function rolesFor(settings: LobbySettings, seats: number): RoleSlot[] {
  return settings.roles ? settings.roles.slice() : presetFor(seats).roles.slice();
}

export function lobbyView(
  code: string,
  hostId: PlayerId,
  status: LobbyStatus,
  seats: readonly LobbySeat[],
  settings: LobbySettings,
  round = 0,
): LobbyView {
  const roles = rolesFor(settings, seats.length);
  return {
    code,
    hostId,
    status,
    seats: seats.map((s) => ({ ...s })),
    settings: { roles: settings.roles ? settings.roles.slice() : null, pace: settings.pace },
    roles,
    presetName: settings.roles ? null : presetFor(seats.length).name,
    validation: validateRoleList(roles, seats.length),
    minSeats: MIN_PLAYERS,
    maxSeats: MAX_PLAYERS,
    round,
  };
}

export function gameConfigFor(seats: readonly LobbySeat[], settings: LobbySettings): GameConfig {
  return {
    players: seats.map((s) => ({ id: s.id, name: s.name, isBot: s.kind === 'bot' })),
    roles: rolesFor(settings, seats.length),
    timers: { ...(settings.pace === 'fast' ? FAST_TIMERS : DEFAULT_TIMERS) },
    options: { ...DEFAULT_OPTIONS },
  };
}
