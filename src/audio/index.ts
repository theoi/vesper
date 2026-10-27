import type { GameAudio } from '../ui/contracts.ts';
import { AudioEngine, audioSupported, SilentAudio } from './engine.ts';

/** The game score: a cappella voices and body percussion in D minor at 92 BPM. */
export function createGameAudio(): GameAudio {
  return audioSupported() ? new AudioEngine() : new SilentAudio();
}
