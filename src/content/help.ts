/**
 * In-game help as plain data: how to play, one note per phase, a card per
 * role, and a glossary. Text is direction-neutral; the UI decides how it looks.
 *
 * Copy refers to roles and factions with tokens such as `{augur}` or `{mafia}`,
 * filled from the engine's names, so renaming a role there renames it here.
 */
import { CATEGORY_NAMES, FACTIONS, ROLES, isRoleId } from '../engine/roles.ts';
import type { Faction, PhaseKind, RoleId } from '../engine/types.ts';

export interface HelpSection {
  id: string;
  title: string;
  /** Paragraphs or list items, in order. */
  body: string[];
}

export interface PhaseHelp {
  title: string;
  /** One line for a phase banner. */
  short: string;
  /** Two or three sentences for a tooltip or help panel. */
  detail: string;
}

export interface RoleCard {
  role: RoleId;
  name: string;
  /** Faction display name: Town, Syndicate, or Neutral. */
  faction: string;
  /** Category display name, e.g. "Town Investigative". */
  category: string;
  goal: string;
  /** What the role does, in plain words. */
  ability: string;
  tips: string[];
  /** What an Augur sees when studying this role (before any Slanderer mark). */
  reads: 'Suspicious' | 'Clear';
  /** At most one of this role can be in a game. */
  unique: boolean;
  /** Flavor line; kept in the engine so it can be restyled with the names. */
  flavor: string;
}

export interface GlossaryEntry {
  term: string;
  definition: string;
  /** Set when the term is a role, so the UI can link to its card. */
  role?: RoleId;
}

const FACTION_IDS = Object.keys(FACTIONS) as Faction[];

/** Replace `{roleId}` and `{faction}` tokens with their display names. */
export function fill(text: string): string {
  return text.replace(/\{(\w+)\}/g, (token, id: string) => {
    if (isRoleId(id)) return ROLES[id].name;
    const faction = FACTION_IDS.find((f) => f === id);
    if (faction) return FACTIONS[faction].name;
    throw new Error(`Unknown help token ${token}`);
  });
}

const HOW_TO_PLAY_RAW: HelpSection[] = [
  {
    id: 'idea',
    title: 'The idea',
    body: [
      'Everyone gets a secret role. Most players are {town}. A few are the {mafia}: they know each other and kill at night. A few {neutral} loners want something else entirely.',
      "Talk, vote, and work out who is lying before it's too late.",
    ],
  },
  {
    id: 'day-night',
    title: 'Days and nights',
    body: [
      'Day: talk it over, then vote to put someone on trial. Day 1 is for talking; voting starts on Day 2.',
      'Night: roles with abilities use them in secret, and the {mafia} chooses someone to kill.',
      'Dawn: everyone sees who died, what role they had, and the will they left.',
    ],
  },
  {
    id: 'trials',
    title: 'Trials',
    body: [
      'During voting, pick a player to put on trial. When a majority of living players agree, that player takes the stand.',
      'The accused gets a short defense. Then everyone else votes guilty, innocent, or abstain, and all ballots are shown.',
      'More guilty than innocent: the accused says last words and is executed. Otherwise voting picks up where it left off.',
      'There are at most three trials a day. If time runs out first, night falls.',
    ],
  },
  {
    id: 'winning',
    title: 'Winning',
    body: [
      '{town} wins once the whole {mafia} and any {cutthroat} are dead.',
      'The {mafia} wins when it matches or outnumbers everyone else and no {cutthroat} is left.',
      '{neutral} roles have goals of their own; check the role card. Some of them can win alongside anyone.',
      'If nobody dies for three days and nights in a row, or the game drags on too long, it ends in a draw.',
    ],
  },
  {
    id: 'talking',
    title: 'Talking',
    body: [
      'Daytime chat is public. You can also whisper to one player; everyone sees that you whispered, but not what you said.',
      'At night the {mafia} has a private chat. The dead talk among themselves, and a living {mourner} can hear them.',
      'Claiming means saying which role you have. Anyone can claim anything, so weigh claims against what has happened.',
    ],
  },
  {
    id: 'wills',
    title: 'Wills and death notes',
    body: [
      'Write a will at any time. When you die, everyone reads it, unless an {embalmer} hid it.',
      'Keep it current: your role, what you learned each night, and who you suspect.',
      'Killers can leave a death note on their victim. It tells you something about who did it, or what they want you to think.',
    ],
  },
];

const PHASE_HELP_RAW: Record<PhaseKind, PhaseHelp> = {
  reveal: {
    title: 'Your role',
    short: 'Read your role card. Keep it secret.',
    detail:
      'Everyone has just been given a secret role. Read your goal and ability. {mafia} members also see who their partners are.',
  },
  discussion: {
    title: 'Discussion',
    short: 'Talk it over. Share, ask, and listen.',
    detail:
      "Share what you know, ask questions, and claim your role if it helps. Notice who stays quiet and who pushes hard. On Day 1 there's no vote.",
  },
  voting: {
    title: 'Voting',
    short: 'Vote to put someone on trial.',
    detail:
      'Pick a player to put on trial. When a majority of living players agree, that player takes the stand. You can change your vote until then. If time runs out, night falls.',
  },
  defense: {
    title: 'Defense',
    short: 'The accused speaks. Everyone else listens.',
    detail:
      'Only the player on trial can talk. Listen for a claim, a story that holds up, or one that falls apart.',
  },
  judgment: {
    title: 'Judgment',
    short: 'Guilty, innocent, or abstain?',
    detail:
      'Everyone except the accused casts a ballot. More guilty than innocent means execution. All ballots are shown afterward, so vote like you mean it.',
  },
  lastWords: {
    title: 'Last words',
    short: 'The condemned gets a final say.',
    detail: 'The town found them guilty. They may claim, accuse, or say goodbye.',
  },
  execution: {
    title: 'Execution',
    short: 'The sentence is carried out.',
    detail:
      'The condemned is executed. Their role and will are revealed. Night follows unless the game is over.',
  },
  night: {
    title: 'Night',
    short: 'Use your ability, if you have one.',
    detail:
      'Choose a target for your night ability, if you have one. The {mafia} agrees on a kill in its private chat. The dead talk among themselves.',
  },
  dawn: {
    title: 'Dawn',
    short: 'See who survived the night.',
    detail:
      'Deaths from the night are revealed, with each role, will, and any death note. Your own night results arrive now too.',
  },
  ended: {
    title: 'Game over',
    short: 'Every role is revealed.',
    detail: 'See who won and why. Every role is now public, so look back at who was lying.',
  },
};

const ROLE_TEXT: Record<RoleId, { ability: string; tips: string[] }> = {
  augur: {
    ability:
      'Each night, study another player. At dawn you learn whether they read Suspicious or Clear. The {patron} reads Clear, and anyone a {slanderer} marked that night reads Suspicious.',
    tips: [
      'Put every reading in your will, so the town gets it even if you die.',
      'Clear is good news, not proof: the {patron} reads Clear too.',
      'Claiming makes you a target. Wait until a reading is worth it.',
    ],
  },
  lamplighter: {
    ability: "Each night, watch another player's door. At dawn you learn who visited them.",
    tips: [
      'Watch someone the killers might want. A visitor to a body is a strong lead.',
      'Protectors visit too: a {mender} or {sentinel} at the door is good news.',
      "Players who were distracted, or didn't act, leave no trace.",
    ],
  },
  mender: {
    ability:
      'Each night, tend one player. They survive any attack that night, and you learn if they were attacked. You can tend yourself once.',
    tips: [
      'Tend whoever has claimed something valuable, like an {augur} with readings.',
      'If your patient was attacked, the killers wanted them gone. Tell the town.',
      "Save your self-tend for a night when you've drawn attention.",
    ],
  },
  sentinel: {
    ability:
      'Each night, guard another player. The first attacker to reach them fights you instead: the attacker dies, and so do you unless a {mender} tends you.',
    tips: [
      'Guard a player the town is counting on.',
      'Your guard can kill even the {patron} or the {cutthroat}.',
      'Write who you are guarding in your will.',
    ],
  },
  reckoner: {
    ability:
      'From Night 2, shoot one player at night. You have two bullets. Shoot a Town member and guilt stops you from shooting again.',
    tips: [
      "Only shoot when you're sure. A bullet in a {town} player hurts everyone.",
      'The {patron} and the {cutthroat} survive your shot, and so does an armored {drifter}.',
    ],
  },
  muse: {
    ability:
      "Each night, captivate another player so their night action fails. They're told they were distracted.",
    tips: [
      'Distract the player you suspect most: a distracted killer kills nobody.',
      'Never visit the {cutthroat}. It kills you instead of its target.',
    ],
  },
  magistrate: {
    ability:
      'Once, during the day, reveal yourself to everyone. From then on your trial votes and ballots count three times.',
    tips: [
      'Reveal when your votes can swing a trial, not before.',
      "Once revealed, you're the top target at night. A {mender} can help.",
      'Nobody can fake the reveal, so a revealed {magistrate} is proven {town}.',
    ],
  },
  mourner: {
    ability:
      'At night you can talk with the dead and hear them. They see you only as "the {mourner}".',
    tips: [
      'Ask the dead what they knew, then bring it to the day.',
      'The dead can lie. A dead {mafia} member still wants their side to win.',
    ],
  },
  resident: {
    ability: 'No night ability. Your voice and your vote are what count.',
    tips: [
      'Ask questions, track votes, and notice who defends whom.',
      "If you're put on trial, claim. The town loses little by sparing a {resident}.",
    ],
  },
  patron: {
    ability:
      "You lead the {mafia}. Each night, choose who it kills; the {hatchet} carries it out, or you do if there's none. You read Clear and survive basic attacks.",
    tips: [
      'Agree on a target with your partners in the night chat.',
      "Reading Clear makes a {town} story easier to sell. Don't oversell it.",
      'You can leave a death note on your victims.',
    ],
  },
  hatchet: {
    ability:
      "You carry out the {mafia} kill each night. The {patron}'s order wins; without one, your own pick stands.",
    tips: [
      'You read Suspicious, so have a believable cover role ready.',
      'If the {patron} falls, the kill is yours to choose.',
    ],
  },
  lure: {
    ability: 'Each night, lure away a player outside the {mafia} so their night action fails.',
    tips: [
      "Lure whoever is most likely to protect or study tonight's target.",
      'Never visit the {cutthroat}. It kills you instead of its target.',
    ],
  },
  slanderer: {
    ability:
      'Each night, mark a player outside the {mafia}. If an {augur} studies them that night, they read Suspicious.',
    tips: [
      'Mark someone the town already doubts, so the reading feels believable.',
      'Framing a real power role can get the town to execute its own helper.',
    ],
  },
  embalmer: {
    ability:
      'Twice per game, prepare a player outside the {mafia}. If they die that night, their role and will stay hidden from the town; only you learn them.',
    tips: [
      "Prepare your team's target, especially one with a will full of notes.",
      'A hidden role lets your team claim it was something else.',
    ],
  },
  harlequin: {
    ability: 'No night ability. Your goal is to get the town to execute you.',
    tips: [
      'Act a little guilty. Too much, and nobody takes the bait.',
      "You win the moment you're executed. The game goes on without you.",
      'You read Clear, which can make the town hesitate.',
    ],
  },
  accuser: {
    ability:
      "You're given a {town} player as your target. Get them executed while you're alive. If they die any other way, you become a {harlequin}.",
    tips: [
      "Build the case slowly: votes, odd claims, things that don't add up.",
      'You read Clear, so you can push hard without an {augur} exposing you.',
    ],
  },
  cutthroat: {
    ability:
      'Kill one player each night. Only a {mender} or {sentinel} can stop your blade. You survive basic attacks, and anyone who tries to distract you becomes your victim.',
    tips: [
      'You win alone, so the {mafia} has to go too.',
      'You read Suspicious, so a cover story helps.',
      'A {lamplighter} can see you visit. Vary your targets.',
    ],
  },
  drifter: {
    ability:
      'Twice per game, put on armor at night to survive a basic attack. You win if you are alive at the end, alongside anyone.',
    tips: [
      "Save your armor for nights when you're likely to be a target.",
      'Armor stops the {mafia} and the {reckoner}, but not the {cutthroat}.',
    ],
  },
};

const GLOSSARY_RAW: GlossaryEntry[] = [
  { term: '{town}', definition: 'The majority. They win by finding and executing every threat.' },
  {
    term: '{mafia}',
    definition: 'A small crew that knows each other, talks privately at night, and kills.',
  },
  {
    term: '{neutral}',
    definition: 'Loners with goals of their own. Some win alongside anyone.',
  },
  { term: '{patron}', definition: 'Leader of the {mafia}. Reads Clear.', role: 'patron' },
  {
    term: '{hatchet}',
    definition: 'The {mafia} member who carries out the kill.',
    role: 'hatchet',
  },
  {
    term: '{augur}',
    definition: 'Studies one player a night and learns Suspicious or Clear.',
    role: 'augur',
  },
  {
    term: '{cutthroat}',
    definition: 'A lone killer who wants to be the last one standing.',
    role: 'cutthroat',
  },
  {
    term: 'Suspicious',
    definition:
      'An {augur} reading. Most of the {mafia} and the {cutthroat} read Suspicious, as does anyone a {slanderer} marked.',
  },
  {
    term: 'Clear',
    definition: 'An {augur} reading. Town and most loners read Clear, but so does the {patron}.',
  },
  { term: 'Claim', definition: 'Saying which role you have. Anyone can lie.' },
  {
    term: 'Counter-claim',
    definition:
      'Two players claiming a role the game has room for only once. At least one is lying.',
  },
  {
    term: 'Role list',
    definition:
      'The public list of roles, or random slots, in this game. A claim that fits nothing on it is a lie.',
  },
  {
    term: 'Trial',
    definition: 'What a majority vote leads to: a defense, then a guilty or innocent verdict.',
  },
  {
    term: 'Ballot',
    definition: 'Your verdict at a trial: guilty, innocent, or abstain. Ballots are public.',
  },
  {
    term: 'Last words',
    definition: 'A final say for a player found guilty, before the execution.',
  },
  { term: 'Will', definition: 'Notes you keep during the game. Everyone reads them when you die.' },
  { term: 'Death note', definition: 'A message a killer leaves on the body.' },
  {
    term: 'Whisper',
    definition: 'A private daytime message to one player. Others see that it happened.',
  },
  {
    term: 'Visit',
    definition: 'Most night abilities visit their target. A {lamplighter} sees who visited.',
  },
  { term: 'Distracted', definition: 'Stopped from acting tonight by a {muse} or a {lure}.' },
  {
    term: 'Marked',
    definition: 'Framed by a {slanderer}: reads Suspicious to an {augur} that night.',
  },
  { term: 'Tended', definition: 'Protected by a {mender}: survives any attack that night.' },
  { term: 'Guarded', definition: 'Watched over by a {sentinel}, who fights the first attacker.' },
  { term: 'Armor', definition: "A {drifter}'s protection against a basic attack, for one night." },
  {
    term: 'Basic attack',
    definition:
      'Most night kills. The {patron}, the {cutthroat}, and an armored {drifter} survive them.',
  },
  {
    term: 'Embalmed',
    definition: 'Prepared by an {embalmer}: role and will stay hidden until the game ends.',
  },
  {
    term: 'Reveal',
    definition:
      'The {magistrate} showing their role to everyone. Their votes then count three times.',
  },
  {
    term: 'Dead chat',
    definition: 'Where the dead talk. Only a living {mourner} can hear it, at night.',
  },
  {
    term: 'Promotion',
    definition: 'When the {mafia} has lost its killers, another member becomes the {hatchet}.',
  },
  {
    term: 'Draw',
    definition:
      'Nobody wins: no deaths for three days and nights in a row, or a game that runs too long.',
  },
];

export const HOW_TO_PLAY: HelpSection[] = HOW_TO_PLAY_RAW.map((s) => ({
  ...s,
  title: fill(s.title),
  body: s.body.map(fill),
}));

export const PHASE_HELP: Record<PhaseKind, PhaseHelp> = Object.fromEntries(
  Object.entries(PHASE_HELP_RAW).map(([k, h]) => [
    k,
    { title: fill(h.title), short: fill(h.short), detail: fill(h.detail) },
  ]),
) as Record<PhaseKind, PhaseHelp>;

export const ROLE_CARDS: Record<RoleId, RoleCard> = Object.fromEntries(
  (Object.keys(ROLE_TEXT) as RoleId[]).map((id) => {
    const def = ROLES[id];
    const card: RoleCard = {
      role: id,
      name: def.name,
      faction: FACTIONS[def.faction].name,
      category: CATEGORY_NAMES[def.category],
      goal: def.goal,
      ability: fill(ROLE_TEXT[id].ability),
      tips: ROLE_TEXT[id].tips.map(fill),
      reads: def.appearsSuspicious ? 'Suspicious' : 'Clear',
      unique: def.unique,
      flavor: def.flavor,
    };
    return [id, card];
  }),
) as Record<RoleId, RoleCard>;

export const GLOSSARY: GlossaryEntry[] = GLOSSARY_RAW.map((g) => ({
  ...g,
  term: fill(g.term),
  definition: fill(g.definition),
})).sort((a, b) => a.term.localeCompare(b.term));
