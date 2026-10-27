/** The curtain-call epilogue: what really happened each night, in plain sentences. */
import {
  ROLES,
  type NightAction,
  type NightRecord,
  type PlayerId,
  type PlayerView,
} from '../../engine/index.ts';

type Names = (id: PlayerId) => string;

/** The night-by-night record, revealed only by `gameOver`. */
export function nightsOf(view: PlayerView): NightRecord[] {
  for (let i = view.events.length - 1; i >= 0; i--) {
    const e = view.events[i];
    if (e?.type === 'gameOver') return e.nights;
  }
  return [];
}

const ATTACK = {
  kill: { did: 'killed', tried: 'attacked' },
  stab: { did: 'stabbed', tried: 'went for' },
  shoot: { did: 'shot', tried: 'shot at' },
} as const;

function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? 'nobody';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** One sentence for one ability used in the night. */
export function describeAction(a: NightAction, name: Names): string {
  const who = `${name(a.actor)} the ${ROLES[a.role].name}`;
  const t = name(a.target);
  if (a.outcome === 'blocked') {
    return a.kind === 'vest'
      ? `${who} reached for the armor but was distracted.`
      : `${who} set out for ${t} but was distracted and never arrived.`;
  }
  switch (a.kind) {
    case 'kill':
    case 'stab':
    case 'shoot': {
      if (a.outcome === 'ordered') return `${who} ordered the kill on ${t}.`;
      const v = ATTACK[a.kind];
      const body =
        a.outcome === 'killed'
          ? `${who} ${v.did} ${t}.`
          : a.outcome === 'intercepted'
            ? `${who} ${v.tried} ${t}, but a Sentinel took the blow.`
            : `${who} ${v.tried} ${t}, who lived through it.`;
      if (!a.chose) return body;
      return a.kind === 'stab'
        ? `${body} (${t} had come to distract them.)`
        : `${body} (It was the Patron's order; their own pick was ${name(a.chose)}.)`;
    }
    case 'investigate':
      return `${who} read ${t}: ${a.outcome === 'suspicious' ? 'suspicious' : 'clear'}.`;
    case 'watch':
      return `${who} watched ${t}'s door and saw ${list((a.visitors ?? []).map(name))}.`;
    case 'heal':
      return a.outcome === 'saved'
        ? `${who} tended ${t} and saved their life.`
        : `${who} tended ${t}. Nobody needed saving.`;
    case 'guard':
      return a.outcome === 'fought'
        ? `${who} guarded ${t} and fought the attacker at the door.`
        : `${who} guarded ${t}. Nobody came.`;
    case 'block':
      return a.outcome === 'resisted'
        ? `${who} tried to distract ${t}, who would not be kept.`
        : `${who} kept ${t} busy all night.`;
    case 'frame':
      return `${who} framed ${t}.`;
    case 'embalm':
      return a.outcome === 'embalmed'
        ? `${who} embalmed ${t}, hiding their role.`
        : `${who} waited to embalm ${t}, but ${t} lived.`;
    case 'vest':
      return `${who} slept in armor.`;
  }
}

/** The night's deaths as one line. */
export function deathsLine(n: NightRecord, name: Names): string {
  if (!n.deaths.length) return 'Nobody died.';
  return `${list(n.deaths.map(name))} died.`;
}
