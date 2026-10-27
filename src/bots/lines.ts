/**
 * Scripted chat: template pools plus a personality filter.
 * Placeholders: {t} target, {v} victim, {r} role, {x} extra detail.
 */
import type { Rng } from '../engine/rng.ts';
import type { Personality, Temperament } from './types.ts';

export type Category =
  | 'greet'
  | 'deathReact'
  | 'deathReactPower'
  | 'deathReactHostile'
  | 'embalmedReact'
  | 'deathNoteReact'
  | 'quietNight'
  | 'willReact'
  | 'execTown'
  | 'execMafia'
  | 'execNeutral'
  | 'claim'
  | 'claimResult'
  | 'accuse'
  | 'accuseHard'
  | 'defendSelf'
  | 'defendSelfClaim'
  | 'question'
  | 'questionGeneric'
  | 'doubtClaim'
  | 'believeClaim'
  | 'defendOther'
  | 'vote'
  | 'urge'
  | 'defensePlea'
  | 'judgeGuilty'
  | 'judgeInnocent'
  | 'lastWords'
  | 'lastWordsClaim'
  | 'lastWordsHarlequin'
  | 'banter'
  | 'mafiaPlan'
  | 'mafiaAgree'
  | 'mafiaCover'
  | 'mafiaBanter'
  | 'deadIntro'
  | 'deadTip'
  | 'deadBanter'
  | 'mournerAsk'
  | 'mournerRelay'
  | 'magistrateReveal'
  | 'magistrateReact'
  | 'harlequinBait'
  | 'endWin'
  | 'endLose'
  | 'endDraw'
  | 'reply'
  | 'replyHold'
  | 'replyNoRead'
  | 'counterClaim'
  | 'whisperClaim'
  | 'trialReact';

export const LINES: Record<Category, string[]> = {
  greet: [
    'Evening, everyone.',
    'Well. Here we all are.',
    'Good luck, all of you. Mostly.',
    'Let us keep our heads tonight.',
    'Nobody panic. Yet.',
    'Okay. Eyes open, everybody.',
    'Hello, hello. Who wants to confess first?',
    'Lamps lit? Good. Let us begin.',
    'I have a good feeling about this table.',
    'Remember: talk a lot, trust a little.',
    'Here we go again.',
    'Stay close, stay loud.',
  ],
  deathReact: [
    'Rest easy, {v}. They were the {r}.',
    'We lost {v} overnight. {r}.',
    '{v} is gone. A {r}, too.',
    'Poor {v}. The {r}, if anyone missed it.',
    'So {v} was the {r}. That stings.',
    "{v} didn't make it. {r}.",
    'Another empty chair: {v}, our {r}.',
    'They got {v}. {r}. Who wanted {v} gone?',
    '{v}, the {r}. Somebody saw them as a threat.',
    "I'm sorry, {v}. You deserved better than that.",
  ],
  deathReactPower: [
    'They took out our {r}. {v} must have been onto something.',
    '{v} was the {r}. That is a real loss.',
    'Of course they went for the {r} first. Sorry, {v}.',
    'Losing {v} hurts. The {r} was our best tool.',
    'The {r} is dead. Whoever {v} suspected deserves a hard look.',
    '{v} the {r}, gone. Read their will, everyone.',
  ],
  deathReactHostile: [
    '{v} was the {r}. Somebody did us a favor.',
    'A {r} down overnight: {v}. I will not pretend to mourn.',
    '{v}, the {r}. Whoever did that, thank you.',
    'Well. {v} was the {r}. The Syndicate is a little smaller.',
    'Someone took out {v}, a {r}. Our protectors are earning their keep.',
    '{v} turned out to be the {r}. Who was vouching for them?',
  ],
  embalmedReact: [
    "No role on {v}'s body. Someone tidied up.",
    '{v} died and we learned nothing. That is an Embalmer at work.',
    'Embalmed. Whatever {v} was, the Syndicate wanted it hidden.',
    "They hid {v}'s role. Meaning {v} mattered.",
    "Not even a will from {v}. Someone's covering tracks.",
  ],
  deathNoteReact: [
    'There was a note on {v}. "{x}" Charming.',
    'The killer left a note on {v}: "{x}"',
    '"{x}". Someone is enjoying this far too much.',
    'A note on the body. "{x}" Creepy.',
  ],
  quietNight: [
    'Nobody died. Somebody got protected, or somebody held back.',
    'A quiet night. I do not trust quiet nights.',
    'Everyone is still here? Interesting.',
    'No bodies. Thank the Mender, maybe.',
    'Nothing happened? That tells us something.',
    'Peaceful night. Let us not waste it.',
    "No deaths. Don't relax, though.",
  ],
  willReact: [
    "{v}'s will says: {x}. Worth taking seriously.",
    'Read the will. {v} wrote {x}.',
    "So {v} left us {x}. Let's use it.",
    "{v}'s will points somewhere: {x}.",
    'The dead do not lie. {v} wrote {x}.',
  ],
  execTown: [
    'We hanged a {r} yesterday. {v} was innocent.',
    'Yesterday was a mistake. {v} was the {r}.',
    '{v} was Town. Whoever pushed that vote owes us answers.',
    'We got {v} wrong. {r}. Let us look at who led that wagon.',
    'Innocent blood on our hands. {v}, I am sorry.',
  ],
  execMafia: [
    'Good call yesterday: {v} was the {r}.',
    '{v} was Syndicate. Now, who was defending them?',
    'One down. {v}, the {r}.',
    'Got one! {v} was the {r}.',
    '{v} was the {r}. Check who voted innocent.',
  ],
  execNeutral: [
    'We executed the {r}. Not ideal.',
    '{v} was the {r}. That helped nobody but them.',
    '{v} was a {r}. Wasted a day on that.',
  ],
  claim: [
    "I'm the {r}.",
    'For the record, I am the {r}.',
    'Fine. I am the {r}.',
    "I'll say it: {r}.",
    "Cards on the table: I'm the {r}.",
    'My role is {r}.',
    "I'm {r}. Make of that what you will.",
  ],
  claimResult: [
    "I'm the {r}. {x}.",
    'I am the {r}, and here is what I know: {x}.',
    '{r} here. {x}.',
    'Listen. I am the {r}. {x}.',
    'Time to share. I am the {r}: {x}.',
    "I've been quiet for a reason. {r}. {x}.",
  ],
  accuse: [
    "I don't like {t}. {x}.",
    '{t} feels off to me. {x}.',
    'My eyes are on {t}. {x}.',
    '{t}, explain yourself. {x}.',
    'I think {t} is hiding something. {x}.',
    'Something about {t} bothers me. {x}.',
    'If I had to pick today, {t}. {x}.',
    '{t} is my top suspect. {x}.',
    'Can we talk about {t}? {x}.',
    "{t} isn't adding up. {x}.",
  ],
  accuseHard: [
    '{t} is Syndicate. {x}.',
    'It is {t}. I am certain. {x}.',
    'Vote {t}. {x}.',
    '{t} is lying to all of us. {x}.',
    'No more games: {t}. {x}.',
    'I would bet my life on {t}. {x}.',
  ],
  defendSelf: [
    "{t}, you've got the wrong person.",
    "I'm not your problem, {t}.",
    'Accusing me wastes a day, {t}.',
    "{t}, look elsewhere. I'm on your side.",
    'Me? Really, {t}? Why?',
    "That's a stretch, {t}.",
    '{t} is pushing me awfully hard. Ask yourselves why.',
    'Funny how {t} needs me gone so badly.',
  ],
  defendSelfClaim: [
    "Stop. I'm the {r}. Look elsewhere.",
    "You're wasting your votes. I am the {r}.",
    "I'm the {r}, and you need me alive.",
    'Fine, if it saves me: {r}. Now leave me be.',
  ],
  question: [
    '{t}, what is your role?',
    '{t}, you have been quiet. What do you think?',
    'Who do you suspect, {t}?',
    "{t}, where's your head at?",
    "{t}, why haven't you said anything?",
    'Any thoughts, {t}?',
    "What's your read, {t}?",
    '{t}, care to claim?',
  ],
  questionGeneric: [
    'Does anyone have information?',
    'Investigators, now would be a good time.',
    'Who has something real to share?',
    'Anyone see anything last night?',
    'Can we get some claims going?',
    'Who here has not said a word yet?',
    'Quiet people, speak up.',
  ],
  doubtClaim: [
    "{t} claiming {r}? I don't buy it.",
    '{r}, {t}? Convenient timing.',
    "I'm not sure {t} is really the {r}.",
    '{t} only claimed {r} once the heat was on.',
    'Anyone can say {r}, {t}.',
    'That {r} claim smells, {t}.',
  ],
  believeClaim: [
    "{t}'s {r} claim makes sense to me.",
    'I believe {t}. The {r} story holds up.',
    'Okay, {t} as {r} tracks.',
    '{t} is probably telling the truth about {r}.',
    "Let's trust {t} for now.",
  ],
  defendOther: [
    "Leave {t} alone. They've been helpful.",
    "{t} isn't the one. I'd bet on it.",
    'I trust {t}. Look elsewhere.',
    '{t} has been straight with us.',
    "Not {t}. They're Town in my book.",
  ],
  vote: [
    'Voting {t}.',
    'My vote goes to {t}.',
    '{t}. Up you go.',
    "I'm putting {t} up.",
    '{t}, defend yourself.',
    'Vote on {t}.',
    "{t}. Let's hear it.",
  ],
  urge: [
    'One more on {t}!',
    "We're close on {t}.",
    '{t} needs a couple more votes.',
    "Come on, let's get {t} on the stand.",
    "Don't let {t} slip away.",
  ],
  defensePlea: [
    "I'm innocent. You're about to make a mistake.",
    'Please. I am Town. Think about who pushed this.',
    'If you hang me, the killers win the day.',
    "I'm not who you're looking for.",
    'You have the wrong person. Check the votes tomorrow.',
    "Look at who started this. That's your Syndicate.",
    "I've done nothing but help. Vote innocent.",
    'Do not waste this vote on me.',
  ],
  judgeGuilty: [
    'Guilty. The story does not add up.',
    'Guilty. Sorry, {t}.',
    "I'm voting guilty on {t}.",
    'Guilty. Too many holes.',
    'Not convinced, {t}. Guilty.',
  ],
  judgeInnocent: [
    'Innocent. This feels rushed.',
    'Innocent. I believe {t}.',
    'Innocent. We are being played.',
    "I'm not hanging {t} on this.",
    'Innocent. Wrong target.',
  ],
  lastWords: [
    "You'll regret this.",
    'Remember who pushed this.',
    'Good luck. You will need it.',
    'Check the votes. That is all I ask.',
    'I forgive most of you.',
    'Look at who was loudest.',
    'Well. That is that.',
  ],
  lastWordsClaim: [
    'I was the {r}. Remember that tomorrow.',
    'For the record: {r}. You hanged the {r}.',
    '{r}. Look at who wanted me gone.',
  ],
  lastWordsHarlequin: [
    'Ha! Exactly as planned.',
    'Thank you, thank you. You have all been wonderful.',
    'Finally. Took you long enough.',
    'Bow, curtain, exit stage left!',
  ],
  banter: [
    'Anyone else feel watched?',
    'The bells sound different tonight.',
    "Let's not tunnel on one person.",
    'Talk it out, everyone. Silence helps the killers.',
    "I'm keeping notes. Just so you know.",
    'Who voted for whom yesterday? I remember.',
    "Everybody's so polite today. Suspicious.",
    'If you have a role worth hiding, hide it well.',
    'Somebody here is lying beautifully.',
    'I want claims before I want votes.',
    'Patience. The truth comes out at dawn.',
    "Don't follow the loudest voice blindly.",
    "Let's watch how people vote.",
    'Every quiet day is a gift to the Syndicate.',
  ],
  mafiaPlan: [
    "Let's take {t} tonight. {x}.",
    '{t}. {x}.',
    'I say {t} goes tonight. {x}.',
    'Target: {t}. {x}.',
    'How about {t}? {x}.',
  ],
  mafiaAgree: [
    'Agreed. {t}.',
    'Fine by me. {t} it is.',
    'Yes, {t}.',
    "{t}. Let's do it.",
    'Works for me.',
  ],
  mafiaCover: [
    "If anyone asks, I'm the {r}.",
    "I'll claim {r} if they come for me.",
    'My cover is {r}. Back me up.',
    "Say I'm the {r} if it comes to that.",
  ],
  mafiaBanter: [
    'Keep your heads down tomorrow.',
    "Don't defend each other too hard.",
    "Vote with the crowd unless it's one of us.",
    'Nobody panic. They have nothing.',
    'Watch for their investigator.',
    'Quiet and steady. We have time.',
  ],
  deadIntro: [
    'Well, that is me out. I was the {r}.',
    '{r}, for whoever is listening down here.',
    'Hello, dead friends. I was the {r}.',
    "So this is the graveyard. I'm the {r}.",
  ],
  deadTip: [
    'Mourner, if you hear me: {t} is the one. {x}.',
    'Tell them about {t}. {x}.',
    'Listen, Mourner: {x}. It is {t}.',
    'Someone up there needs to know: {t}. {x}.',
  ],
  deadBanter: [
    'Watching from here is agony.',
    'They are so close and so wrong.',
    'At least the view is good.',
    'Come on, look at the votes!',
    'I can see it all now. Painful.',
    'Who wants to bet on tomorrow?',
  ],
  mournerAsk: [
    'Spirits, who did this to you?',
    'Anyone down there? Tell me what you saw.',
    'I can hear you. Give me a name.',
    'Speak, dead friends. Who should I watch?',
  ],
  mournerRelay: [
    'The dead have been talking to me. They say {t}. {x}.',
    "I'm the Mourner. The graveyard points at {t}. {x}.",
    'Mourner here: the spirits name {t}. {x}.',
  ],
  magistrateReveal: [
    'I am the Magistrate. Listen carefully now.',
    'By the authority of this chain: Magistrate. My vote counts three.',
    "Time to stop hiding. I'm the Magistrate.",
    'Magistrate. Follow my lead.',
  ],
  magistrateReact: [
    "{t} is the Magistrate. Let's protect them.",
    'A Magistrate! Finally, some order.',
    '{t} revealed. Menders, you know what to do.',
  ],
  harlequinBait: [
    "Maybe I'm guilty. Maybe I'm not. Who can say?",
    "I won't explain myself. Vote me if you dare.",
    "Fine, I'm the Augur. Or the Patron. Pick one.",
    'You all look so serious. It is adorable.',
    'I have a secret and I am not telling.',
    'Go on, put me up. I dare you.',
  ],
  endWin: [
    'Good game! That went well.',
    'Victory. Well played, team.',
    'We did it!',
    'Told you so.',
    'GG, everyone.',
  ],
  endLose: [
    'Good game. You got us.',
    'Well played. I never saw it coming.',
    'GG. Next time.',
    'Ouch. Well done, though.',
    'I was so sure. Good game.',
  ],
  endDraw: [
    'A draw. Nobody wins. Fitting.',
    'Stalemate. Good game anyway.',
    'Well, that ended strangely.',
  ],
  reply: [
    "{t}, I'm Town. Ask me something harder.",
    "Honestly, {t}? I'm still deciding.",
    "{t}, I'll share when it matters.",
    'Fair question, {t}. I have nothing to hide.',
    "I'm watching the votes, {t}. That's my answer.",
    "{t}, I'm not the one you want.",
  ],
  replyHold: [
    'Not claiming yet, {t}. Put me on trial and I will.',
    "I'd rather not paint a target on myself, {t}.",
    '{t}, claiming now only helps the killers.',
    "Ask me again if I'm on the stand, {t}.",
    "Town. That's all you get for now, {t}.",
    "Nice try, {t}. I'll claim when it matters.",
  ],
  replyNoRead: [
    'No strong read yet, {t}. Still watching.',
    'Honestly, {t}, nobody stands out yet.',
    'Too early to say, {t}. I want to see the votes.',
    "I don't have a name yet, {t}. Give it time.",
    "{t}, I'm undecided. Ask me after the vote.",
  ],
  counterClaim: [
    "I'm the real {r}. {t} is lying. {x}.",
    '{t} is lying. I am the {r}. {x}.',
    "That's my role, {t}. I'm the {r}. {x}.",
    'No. I am the {r}, and {t} is a fake. {x}.',
    "There's only one {r}, {t}, and it's me. {x}.",
  ],
  whisperClaim: [
    "Between us: I'm the {r}.",
    'Keep this quiet. {r}.',
    "I'm trusting you. I'm the {r}.",
  ],
  trialReact: [
    "Let's hear {t} out.",
    '{t} on the stand. Make it good.',
    'Okay, {t}. Convince us.',
    'Here we go. {t}, speak.',
  ],
};

/** Extra lines by temperament, mixed in with double weight. */
export const TEMPERAMENT_LINES: Partial<Record<Temperament, Partial<Record<Category, string[]>>>> =
  {
    fiery: {
      accuse: ["{t}! Don't even try it. {x}.", "I'm done with {t}. {x}!", '{t} is rotten. {x}!'],
      defendSelf: [
        'Back off, {t}!',
        "Unbelievable, {t}. I'm Town!",
        'Point that finger elsewhere, {t}!',
      ],
      banter: ['Stop dithering and vote!', "I'm sick of the silence!", 'Somebody give me a name!'],
      vote: ['{t}. Now!', 'Everybody on {t}!'],
      quietNight: ['No deaths? Somebody explain!'],
      endLose: ['Ugh! Rematch.'],
    },
    anxious: {
      accuse: [
        'I could be wrong, but... {t}? {x}.',
        'Maybe {t}? Sorry. {x}.',
        'Is it just me, or is {t} strange? {x}.',
      ],
      defendSelf: ["Wait, me? {t}, I swear I'm not...", "Please don't, {t}. I'm on your side."],
      banter: [
        "I really hope I'm not next.",
        "Everybody's staring at me, aren't they?",
        'This is so stressful.',
      ],
      deathReact: ['Oh no. {v}. The {r}. Who is next?'],
      quietNight: ['Nobody died? Oh thank goodness.'],
    },
    cheerful: {
      accuse: ["Sorry {t}, but you're my pick today! {x}.", '{t}, nothing personal, but... {x}.'],
      defendSelf: ["Aw, {t}, I'm one of the good ones!", "{t}, friend, you've got me all wrong!"],
      banter: ["We've got this, team!", 'Love the energy today.', 'Group hug after the vote?'],
      greet: ['Hi everyone! Lovely evening for it.', 'Ooh, what a great table!'],
      endWin: ['Yay! Great game, everyone!'],
    },
    cold: {
      accuse: ['{t}. {x}.', '{t}. Obvious.'],
      defendSelf: ['No.', 'Wrong, {t}.'],
      banter: ['Talk less. Think more.', 'Noted.'],
      vote: ['{t}.'],
      deathReact: ['{v}. {r}. Moving on.'],
    },
    theatrical: {
      accuse: [
        'Behold {t}, wolf in a lamb’s coat! {x}.',
        'The villain stands among us, and it is {t}! {x}.',
      ],
      defendSelf: ['You wound me, {t}! I am innocent as dawn.', 'How dare you, {t}!'],
      banter: [
        'What a night. What a cast.',
        'The plot thickens, friends.',
        'Every great tragedy has a twist.',
      ],
      deathReact: ['Alas, poor {v}, our {r}! Gone too soon.'],
      lastWords: ['Remember me, and weep!', 'Exit, pursued by a mob.'],
    },
    wry: {
      accuse: [
        '{t} is giving very guilty energy. {x}.',
        'funny how {t} always lands on the safe side. {x}.',
      ],
      defendSelf: ['bold move, {t}. wrong, but bold.', 'me? {t}, please.'],
      banter: [
        'love a good mob decision.',
        'so this is how democracy dies.',
        'great, another quiet genius.',
      ],
      quietNight: ['nobody died. suspicious amounts of competence.'],
    },
    earnest: {
      accuse: [
        'I have thought about it carefully, and it is {t}. {x}.',
        'The evidence points to {t}. {x}.',
      ],
      defendSelf: ['{t}, I understand the worry, but I am Town.', 'Let me explain, {t}.'],
      banter: ['Let us lay out what we actually know.', 'Facts first, feelings second.'],
      questionGeneric: ['Could each of us share one suspicion, please?'],
    },
    calm: {
      accuse: ["Let's look at {t}. {x}.", '{t} is my best guess. {x}.'],
      banter: ['Slow down. We have time.', 'Breathe, everyone.'],
    },
  };

const OPENERS: Record<Temperament, string[]> = {
  calm: ['Okay.', 'Alright,', 'So,'],
  fiery: ['Seriously?', 'Listen!', 'Come on,'],
  anxious: ['Um,', 'Sorry, but', 'I mean,'],
  cheerful: ['Hey all!', 'Okay friends,', 'Ooh,'],
  cold: ['Fact:', 'Noted.'],
  theatrical: ['Friends, neighbors,', 'Hark!', 'Alas,'],
  wry: ['well,', 'funny thing:', 'so.'],
  earnest: ['To be clear,', "Let's think.", 'Honestly,'],
};

const CONTRACTIONS: [RegExp, string][] = [
  [/\bI'm\b/g, 'I am'],
  [/\bdon't\b/gi, 'do not'],
  [/\bcan't\b/gi, 'cannot'],
  [/\bwon't\b/gi, 'will not'],
  [/\bit's\b/gi, 'it is'],
  [/\bthat's\b/gi, 'that is'],
  [/\byou're\b/gi, 'you are'],
  [/\bthey're\b/gi, 'they are'],
  [/\bisn't\b/gi, 'is not'],
  [/\bLet's\b/g, 'Let us'],
  [/\blet's\b/g, 'let us'],
  [/\bI'll\b/g, 'I will'],
  [/\bI've\b/g, 'I have'],
];

export function nickname(name: string): string {
  if (name.length <= 4) return name;
  const base = name.slice(0, 3);
  return /[aeiouy]$/i.test(base) ? base : `${base}${name.length > 6 ? 'y' : ''}`;
}

export interface RenderInput {
  t?: string;
  v?: string;
  r?: string;
  x?: string;
}

/**
 * Pick a template for `category` that this bot has not used recently, fill it,
 * and pass it through the personality filter. Returns the line and its id.
 */
export function render(
  category: Category,
  input: RenderInput,
  personality: Personality,
  rng: Rng,
  recent: string[],
): { text: string; id: string } {
  const base = LINES[category].map((line, i) => ({ line, id: `${category}:${i}`, w: 1 }));
  const extra = (TEMPERAMENT_LINES[personality.temperament]?.[category] ?? []).map((line, i) => ({
    line,
    id: `${category}:${personality.temperament}:${i}`,
    w: 2,
  }));
  const all = [...base, ...extra];
  const fresh = all.filter((c) => !recent.includes(c.id));
  const choice = rng.weighted(fresh.length > 0 ? fresh : all, (c) => c.w);
  const nick = personality.quirks.includes('nicknames');
  const name = (n?: string) => (n ? (nick ? nickname(n) : n) : 'someone');
  let text = choice.line
    .replaceAll('{t}', name(input.t))
    .replaceAll('{v}', name(input.v))
    .replaceAll('{r}', input.r ?? 'Resident')
    .replaceAll('{x}', input.x ?? '');
  text = tidy(text);
  // Keep names and "I" capitalized when an opener is prepended.
  const keepCase = /^(\{|I\b|I')/.test(choice.line);
  text = applyQuirks(text, personality, rng, category, keepCase);
  return { text, id: choice.id };
}

/** Clean up empty detail slots like "Foo. ." left by a missing {x}. */
function tidy(text: string): string {
  return text
    .replace(/\s+([.!?,])/g, '$1')
    .replace(/([.!?])\s*\.+/g, '$1')
    .replace(/:\s*\./g, '.')
    .replace(/\?\s*\./g, '?')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const NO_OPENER: Category[] = ['vote', 'claim', 'claimResult', 'mafiaAgree', 'lastWordsHarlequin'];

function applyQuirks(
  text: string,
  p: Personality,
  rng: Rng,
  category: Category,
  keepCase: boolean,
): string {
  let out = text;
  if (!NO_OPENER.includes(category) && rng.chance(0.18)) {
    const opener = rng.pick(OPENERS[p.temperament]);
    const body = keepCase ? out : `${out.charAt(0).toLowerCase()}${out.slice(1)}`;
    out = `${opener} ${body}`;
  }
  if (p.quirks.includes('formal')) for (const [re, rep] of CONTRACTIONS) out = out.replace(re, rep);
  if (p.quirks.includes('terse')) {
    out = out
      .replace(/\b(honestly|really|just|actually|I think)\b,?\s*/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  if (p.quirks.includes('exclaims') && rng.chance(0.6)) out = out.replace(/\.$/, '!');
  if (p.quirks.includes('ellipses') && rng.chance(0.5)) out = out.replace(/[.!]$/, '...');
  if (p.quirks.includes('questions') && rng.chance(0.2) && /\.$/.test(out)) {
    out = `${out} ${rng.pick(['Right?', 'No?', 'Agreed?', 'Thoughts?'])}`;
  }
  if (p.quirks.includes('catchphrase') && p.catchphrase && rng.chance(0.15)) {
    out = `${out} ${p.catchphrase}`;
  }
  if (p.quirks.includes('lowercase')) out = out.toLowerCase();
  out =
    out.charAt(0) === out.charAt(0).toLowerCase() && !p.quirks.includes('lowercase')
      ? out.charAt(0).toUpperCase() + out.slice(1)
      : out;
  return out.slice(0, 280);
}

/** Notes a killer might leave on a body. */
export const DEATH_NOTES = [
  'Hush now.',
  'The lamps go out one by one.',
  'You talked too much.',
  'Sleep well.',
  'Nothing personal.',
  'Count the empty chairs.',
  'Dusk always wins.',
  'One fewer voice.',
  'Ask the bells who is next.',
  'You looked so peaceful.',
];
