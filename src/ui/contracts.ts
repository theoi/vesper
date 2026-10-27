/**
 * Seams between the parts of the game UI, so they can be built and tested apart:
 * - the app shell and HUD (`src/ui/app.ts`, `src/ui/hud/`, `src/ui/screens/`),
 * - the stage, where the town is a shadow play behind a lit scrim (`src/ui/stage/`),
 * - the director, which turns engine events into short staged sequences (`src/ui/director/`),
 * - the score (`src/audio/`).
 */
import type { NightRecord, PlayerId, PlayerView } from '../engine/index.ts';

/** What clicking a shadow or candle does right now. */
export type PickMode = 'vote' | 'night' | 'whisper' | 'none';

export interface LobbySeat {
  id: PlayerId;
  name: string;
  isBot: boolean;
}

export interface StageApi {
  /** Root element; the owner places it (it fills its container). */
  readonly el: HTMLElement;
  /** Lobby: one shadow and candle per seat, lit as seats fill. */
  showLobby(seats: readonly LobbySeat[]): void;
  /** Game: render the latest view (marks, candles alive/out/guttering, lighting for the phase). */
  update(view: PlayerView): void;
  /** Which shadows and candles are clickable, and which are chosen. */
  setPick(mode: PickMode, targets: readonly PlayerId[], chosen: readonly PlayerId[]): void;
  /** Called when the player clicks a targetable shadow or candle. */
  onPick(cb: (id: PlayerId) => void): void;
  /** Turn reduced motion on or off (no travel, no flicker, no camera moves). */
  setReducedMotion(on: boolean): void;
  dispose(): void;
}

export interface DirectorApi {
  /**
   * Feed every new view; the director reads events it has not seen (by seq) and stages them.
   * `clockOffset` (add to `Date.now()` for host time) lets sequences fit the phase timer.
   */
  feed(view: PlayerView, clockOffset?: number): void;
  /** Skip the sequence that is playing. */
  skip(): void;
  /** After the game: replay every night in shadow ("what really happened"). */
  replay(nights: NightRecord[]): void;
  setReducedMotion(on: boolean): void;
  dispose(): void;
}

/** Beds. The director picks one from the phase and who you are. */
export type AudioScene =
  | 'silence'
  | 'lobby'
  | 'day'
  | 'voting'
  | 'trial'
  | 'night'
  | 'nightSyndicate'
  | 'nightDead'
  | 'dawn'
  | 'end';

/** One-shot cues. Each has several takes; `variant` picks one (else it rotates). */
export type CueName =
  | 'ui' // soft click for buttons
  | 'chat' // a line arrives (very quiet)
  | 'whisper' // a whisper notice
  | 'knock' // a vote lands
  | 'unknock' // a vote is withdrawn
  | 'stomp' // a ballot is cast
  | 'cut' // hard cut to a close-up
  | 'claim' // an intertitle for a claim or accusation
  | 'roleTown'
  | 'roleMafia'
  | 'roleNeutral'
  | 'dayBreak' // the lamp rises on a new day
  | 'nightfall' // variants 0..2 match the three nightfall sequences
  | 'creep' // a shadow crosses the stage at night
  | 'dawnQuiet' // nobody died
  | 'dawnDeath' // a body is found
  | 'candleOut'
  | 'candleLight'
  | 'deathMafia'
  | 'deathCutthroat'
  | 'deathReckoner'
  | 'deathGuard'
  | 'deathExecuted'
  | 'trial'
  | 'guilty'
  | 'innocent'
  | 'reveal' // Magistrate reveal, role reveal of the dead
  | 'will' // a letter unfolds
  | 'win'
  | 'lose';

export interface CueOptions {
  variant?: number;
  /** Stereo position -1..1 (e.g. where the shadow stands). */
  pan?: number;
  /** Seconds from now. */
  delay?: number;
  /** Gain multiplier (default 1). */
  gain?: number;
}

export type EndVariant = 'town' | 'mafia' | 'cutthroat' | 'draw';

export interface GameAudio {
  /** Unlock and load. Call from a user gesture; safe to call again. Resolves when samples are decoded (or failed). */
  begin(): Promise<void>;
  readonly started: boolean;
  setScene(scene: AudioScene, opts?: { end?: EndVariant; won?: boolean }): void;
  /** 0..1: how close the town is to putting someone on trial, or how tense the trial is. */
  setTension(x: number): void;
  cue(name: CueName, opts?: CueOptions): void;
  readonly muted: boolean;
  readonly volume: number;
  setMuted(muted: boolean): void;
  setVolume(volume: number): void;
  /** Output level 0..1 for visuals that react to the music. */
  level(): number;
  dispose(): void;
}
