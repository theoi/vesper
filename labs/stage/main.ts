import '@fontsource/old-standard-tt/400.css';
import '@fontsource/old-standard-tt/400-italic.css';
import '@fontsource/old-standard-tt/700.css';
import '@fontsource/homemade-apple/400.css';
import { createGameAudio } from '../../src/audio/index.ts';
import {
  createGame,
  defaultConfig,
  viewFor,
  type PhaseKind,
  type PlayerView,
  type RoleId,
} from '../../src/engine/index.ts';
import type { DeathInfo, SeqSpec } from '../../src/ui/director/plan.ts';
import { runSequence, Skip, Take } from '../../src/ui/director/sequences.ts';
import { createStage } from '../../src/ui/stage/index.ts';

const NAMES = ['Wren', 'Arvo', 'Ines', 'Silas', 'Juniper', 'Rook', 'Ysolde', 'Tamsin', 'Oren'];
const config = defaultConfig(NAMES.map((name, i) => ({ id: `p${i}`, name, isBot: i > 0 })));
const game = createGame(config, 'stage-lab', 0).state;
const base = viewFor(game, 'p0');

const audio = createGameAudio();
const stage = createStage(audio);
document.getElementById('stage')?.append(stage.el);

/** A view of the lab game in a given phase, with some players dead and roles known. */
function viewAt(
  kind: PhaseKind,
  o: {
    dead?: string[];
    you?: Partial<PlayerView['you']>;
    trial?: string;
    result?: PlayerView['result'];
  } = {},
): PlayerView {
  const dead = new Set(o.dead ?? []);
  return {
    ...base,
    you: { ...base.you, ...o.you },
    phase: { kind, day: 2, startedAt: 0, endsAt: null },
    players: base.players.map((p) => ({ ...p, alive: !dead.has(p.id) })),
    trial: o.trial ? { defendant: o.trial, number: 1, voted: [] } : null,
    votes: {},
    result: o.result ?? null,
  };
}

function death(
  player: string,
  staging: DeathInfo['staging'],
  role: RoleId | null,
  will = '',
): DeathInfo {
  const causes = {
    mafia: ['mafia'],
    cutthroat: ['cutthroat'],
    reckoner: ['reckoner'],
    guard: ['sentinel'],
    executed: ['executed'],
  }[staging] as DeathInfo['causes'];
  return { player, causes, role, will, notes: [], embalmed: role === null, staging };
}

const WILL = 'I read Silas on the second night.\nClear. Trust him.\nAnd keep the lamp lit.';

interface Scene {
  group: string;
  label: string;
  view: () => PlayerView;
  spec?: SeqSpec;
  /** A scene driven by stage calls rather than a sequence (a beat, like the Mourner's hand). */
  run?: (t: Take) => Promise<void>;
}

const SCENES: Scene[] = [
  {
    group: 'Role deal',
    label: 'Town',
    view: () => viewAt('reveal'),
    spec: { id: 'deal', tone: 'town', role: 'augur', teammates: [], changed: false },
  },
  {
    group: 'Role deal',
    label: 'Syndicate',
    view: () => viewAt('reveal', { you: { faction: 'mafia', role: 'hatchet' } }),
    spec: { id: 'deal', tone: 'mafia', role: 'hatchet', teammates: ['p3', 'p6'], changed: false },
  },
  {
    group: 'Role deal',
    label: 'Neutral',
    view: () => viewAt('reveal', { you: { faction: 'neutral', role: 'harlequin' } }),
    spec: { id: 'deal', tone: 'neutral', role: 'harlequin', teammates: [], changed: false },
  },
  {
    group: 'Day opens',
    label: 'First day',
    view: () => viewAt('discussion'),
    spec: { id: 'dayOpen', variant: 'first', day: 1, line: 'The company takes its marks.' },
  },
  {
    group: 'Day opens',
    label: 'Quiet night',
    view: () => viewAt('discussion'),
    spec: { id: 'dayOpen', variant: 'quiet', day: 3, line: 'No one is missing. Not yet.' },
  },
  {
    group: 'Day opens',
    label: 'Mourning',
    view: () => viewAt('discussion', { dead: ['p4'] }),
    spec: {
      id: 'dayOpen',
      variant: 'mourning',
      day: 2,
      line: 'A cold candle stands where someone was.',
    },
  },
  {
    group: 'Nightfall',
    label: 'Lamps out',
    view: () => viewAt('night'),
    spec: { id: 'nightfall', variant: 'lamps', first: false, line: '' },
  },
  {
    group: 'Nightfall',
    label: 'Fog',
    view: () => viewAt('night'),
    spec: { id: 'nightfall', variant: 'fog', first: false, line: '' },
  },
  {
    group: 'Nightfall',
    label: "Watchman's lantern",
    view: () => viewAt('night'),
    spec: { id: 'nightfall', variant: 'lantern', first: false, line: '' },
  },
  {
    group: 'Nightfall',
    label: 'First night',
    view: () => viewAt('night'),
    spec: {
      id: 'nightfall',
      variant: 'fog',
      first: true,
      line: 'Doors are barred. Some of them will open.',
    },
  },
  {
    group: 'Dawn',
    label: 'Nobody died',
    view: () => viewAt('dawn'),
    spec: { id: 'dawn', variant: 'quiet', quiet: 'birds', deaths: [], notes: [], day: 3 },
  },
  {
    group: 'Dawn',
    label: 'Every candle burns',
    view: () => viewAt('dawn'),
    spec: {
      id: 'dawn',
      variant: 'quiet',
      quiet: 'candles',
      deaths: [],
      notes: [{ text: 'Silas: Clear', tone: 'town' }],
      day: 3,
    },
  },
  {
    group: 'Dawn',
    label: 'One death + will',
    view: () => viewAt('dawn', { dead: ['p4'] }),
    spec: {
      id: 'dawn',
      variant: 'one',
      quiet: 'birds',
      deaths: [death('p4', 'mafia', 'augur', WILL)],
      notes: [],
      day: 3,
    },
  },
  {
    group: 'Dawn',
    label: 'Several deaths',
    view: () => viewAt('dawn', { dead: ['p2', 'p7'] }),
    spec: {
      id: 'dawn',
      variant: 'several',
      quiet: 'birds',
      deaths: [death('p2', 'cutthroat', 'mender'), death('p7', 'reckoner', 'lure')],
      notes: [],
      day: 3,
    },
  },
  {
    group: 'Dawn',
    label: 'Saved (private)',
    view: () => viewAt('dawn'),
    spec: {
      id: 'dawn',
      variant: 'quiet',
      quiet: 'birds',
      deaths: [],
      notes: [{ text: 'Attacked in the night, but a Mender saved your life', tone: 'town' }],
      day: 3,
    },
  },
  {
    group: 'Death',
    label: 'Syndicate',
    view: () => viewAt('dawn', { dead: ['p5'] }),
    spec: { id: 'death', death: death('p5', 'mafia', 'sentinel') },
  },
  {
    group: 'Death',
    label: 'Cutthroat',
    view: () => viewAt('dawn', { dead: ['p5'] }),
    spec: { id: 'death', death: death('p5', 'cutthroat', 'resident') },
  },
  {
    group: 'Death',
    label: 'Reckoner',
    view: () => viewAt('dawn', { dead: ['p5'] }),
    spec: { id: 'death', death: death('p5', 'reckoner', 'slanderer') },
  },
  {
    group: 'Death',
    label: 'Sentinel',
    view: () => viewAt('dawn', { dead: ['p5'] }),
    spec: { id: 'death', death: death('p5', 'guard', 'hatchet') },
  },
  {
    group: 'Death',
    label: 'Embalmed',
    view: () => viewAt('dawn', { dead: ['p5'] }),
    spec: { id: 'death', death: death('p5', 'mafia', null) },
  },
  {
    group: 'Trial',
    label: 'Hard cut',
    view: () => viewAt('defense', { trial: 'p3' }),
    spec: { id: 'trial', variant: 'cut', defendant: 'p3' },
  },
  {
    group: 'Trial',
    label: 'Walk to the lamp',
    view: () => viewAt('defense', { trial: 'p3' }),
    spec: { id: 'trial', variant: 'walk', defendant: 'p3' },
  },
  {
    group: 'Trial',
    label: 'Second trial',
    view: () => viewAt('defense', { trial: 'p6' }),
    spec: { id: 'trial', variant: 'again', defendant: 'p6' },
  },
  {
    group: 'Verdict',
    label: 'Guilty: jury',
    view: () => viewAt('judgment', { trial: 'p3' }),
    spec: {
      id: 'verdict',
      variant: 'poly',
      guilty: true,
      defendant: 'p3',
      guiltyVoters: ['p0', 'p1', 'p2', 'p5', 'p8'],
      innocentVoters: ['p4'],
      g: 5,
      i: 1,
    },
  },
  {
    group: 'Verdict',
    label: 'Guilty: slam',
    view: () => viewAt('judgment', { trial: 'p3' }),
    spec: {
      id: 'verdict',
      variant: 'slam',
      guilty: true,
      defendant: 'p3',
      guiltyVoters: ['p1'],
      innocentVoters: [],
      g: 4,
      i: 2,
    },
  },
  {
    group: 'Verdict',
    label: 'Guilty: flare',
    view: () => viewAt('judgment', { trial: 'p3' }),
    spec: {
      id: 'verdict',
      variant: 'flare',
      guilty: true,
      defendant: 'p3',
      guiltyVoters: ['p1'],
      innocentVoters: [],
      g: 4,
      i: 3,
    },
  },
  {
    group: 'Verdict',
    label: 'Innocent: exhale',
    view: () => viewAt('judgment', { trial: 'p3' }),
    spec: {
      id: 'verdict',
      variant: 'exhale',
      guilty: false,
      defendant: 'p3',
      guiltyVoters: [],
      innocentVoters: ['p1', 'p2'],
      g: 2,
      i: 5,
    },
  },
  {
    group: 'Verdict',
    label: 'Innocent: claps',
    view: () => viewAt('judgment', { trial: 'p3' }),
    spec: {
      id: 'verdict',
      variant: 'claps',
      guilty: false,
      defendant: 'p3',
      guiltyVoters: [],
      innocentVoters: ['p1', 'p2', 'p5'],
      g: 2,
      i: 5,
    },
  },
  {
    group: 'Execution',
    label: 'Into the lamp',
    view: () => viewAt('execution', { dead: ['p3'] }),
    spec: {
      id: 'execution',
      variant: 'lamp',
      player: 'p3',
      death: death('p3', 'executed', 'patron', 'Burn my ledger.'),
    },
  },
  {
    group: 'Execution',
    label: 'Lamp lowered',
    view: () => viewAt('execution', { dead: ['p3'] }),
    spec: {
      id: 'execution',
      variant: 'lowered',
      player: 'p3',
      death: death('p3', 'executed', 'resident'),
    },
  },
  {
    group: 'Magistrate',
    label: 'Reveal',
    view: () => viewAt('discussion'),
    spec: { id: 'magistrate', player: 'p8' },
  },
  {
    group: 'Game over',
    label: 'Town',
    view: () =>
      viewAt('ended', {
        dead: ['p3', 'p6'],
        result: {
          outcome: 'town',
          winners: ['p0', 'p1', 'p2', 'p4', 'p5', 'p7', 'p8'],
          reason: 'threatsEliminated',
          day: 4,
        },
      }),
    spec: { id: 'finale', outcome: 'town', won: true },
  },
  {
    group: 'Game over',
    label: 'Syndicate',
    view: () =>
      viewAt('ended', {
        dead: ['p1', 'p2', 'p4', 'p5'],
        result: { outcome: 'mafia', winners: ['p3', 'p6'], reason: 'mafiaParity', day: 5 },
      }),
    spec: { id: 'finale', outcome: 'mafia', won: false },
  },
  {
    group: 'Game over',
    label: 'Cutthroat',
    view: () =>
      viewAt('ended', {
        dead: ['p0', 'p1', 'p2', 'p3', 'p4', 'p6', 'p7'],
        result: { outcome: 'cutthroat', winners: ['p5'], reason: 'lastKillerStanding', day: 6 },
      }),
    spec: { id: 'finale', outcome: 'cutthroat', won: false },
  },
  {
    group: 'Game over',
    label: 'Draw',
    view: () =>
      viewAt('ended', { result: { outcome: 'draw', winners: [], reason: 'stalemate', day: 7 } }),
    spec: { id: 'finale', outcome: 'draw', won: false },
  },
  {
    group: 'Night',
    label: "The Mourner's hand",
    view: () => viewAt('night', { dead: ['p0', 'p2', 'p5', 'p7'], you: { alive: false } }),
    run: async (t) => {
      stage.hand('Who came to your door?');
      await t.wait(3200);
      stage.hand('Tell me and I will carry it into the light.');
      await t.wait(6500);
    },
  },
  {
    group: 'Faces',
    label: 'Accusation',
    view: () => viewAt('discussion'),
    run: async (t) => {
      stage.shadeOf('p2')?.act('accuse', 200);
      stage.shadeOf('p6')?.act('recoil', 250);
      stage.cameo('accuse', 'p2', 'p6');
      await t.wait(2200);
    },
  },
  {
    group: 'Faces',
    label: 'Votes pile up',
    view: () => viewAt('voting'),
    run: async (t) => {
      stage.cameo('sweat', 'p4');
      await t.wait(2200);
    },
  },
  {
    group: 'Faces',
    label: 'Whisper',
    view: () => viewAt('discussion'),
    run: async (t) => {
      stage.thread('p1', 'p5');
      stage.cameo('whisper', 'p1', 'p5');
      await t.wait(1900);
    },
  },
  {
    group: 'Faces',
    label: 'Claim',
    view: () => viewAt('discussion'),
    run: async (t) => {
      stage.plate('“I am the Augur.”', 'Silas', 2600);
      stage.cameo('claim', 'p3');
      await t.wait(2800);
    },
  },
  {
    group: 'Faces',
    label: 'You are accused',
    view: () => viewAt('discussion'),
    run: async (t) => {
      stage.cameo('accuse', 'p7', 'p0');
      await t.wait(2200);
    },
  },
  {
    group: 'Curtain call',
    label: 'What really happened',
    view: () =>
      viewAt('ended', {
        dead: ['p3', 'p6', 'p7'],
        result: {
          outcome: 'town',
          winners: ['p0', 'p1', 'p2', 'p4', 'p5', 'p8'],
          reason: 'threatsEliminated',
          day: 3,
        },
      }),
    spec: {
      id: 'replay',
      outcome: 'town',
      won: true,
      nights: [
        {
          night: 1,
          deaths: [],
          actions: [
            {
              actor: 'p1',
              role: 'augur',
              kind: 'investigate',
              target: 'p3',
              outcome: 'suspicious',
            },
            { actor: 'p2', role: 'mender', kind: 'heal', target: 'p4', outcome: 'saved' },
            { actor: 'p3', role: 'patron', kind: 'kill', target: 'p4', outcome: 'ordered' },
            { actor: 'p6', role: 'hatchet', kind: 'kill', target: 'p4', outcome: 'survived' },
            {
              actor: 'p7',
              role: 'lamplighter',
              kind: 'watch',
              target: 'p4',
              outcome: 'watched',
              visitors: ['p2', 'p6'],
            },
          ],
        },
        {
          night: 2,
          deaths: ['p3', 'p7'],
          actions: [
            { actor: 'p1', role: 'augur', kind: 'investigate', target: 'p6', outcome: 'blocked' },
            { actor: 'p5', role: 'muse', kind: 'block', target: 'p1', outcome: 'distracted' },
            { actor: 'p6', role: 'hatchet', kind: 'kill', target: 'p7', outcome: 'killed' },
            { actor: 'p8', role: 'reckoner', kind: 'shoot', target: 'p3', outcome: 'killed' },
          ],
        },
      ],
    },
  },
];

let take: Take | null = null;
const now = document.getElementById('now');

async function play(i: number): Promise<void> {
  const scene = SCENES[i];
  if (!scene) return;
  take?.skip();
  await audio.begin();
  const v = scene.view();
  stage.update(v);
  stage.settle(0);
  stage.restLook(0);
  if (now) now.textContent = `${scene.group}: ${scene.label}`;
  const t = new Take(stage);
  take = t;
  stage.hold(true);
  try {
    if (scene.run) await scene.run(t);
    else if (scene.spec) await runSequence(t, stage, audio, scene.spec);
  } catch (e) {
    if (!(e instanceof Skip)) console.error(e);
  } finally {
    t.end();
    if (take === t) {
      take = null;
      stage.film.clear();
      stage.clearOver();
      stage.hold(false);
      stage.settle(900);
      stage.restLook(1200);
    }
  }
}

const controls = document.getElementById('controls');
let group = '';
SCENES.forEach((s, i) => {
  if (s.group !== group) {
    group = s.group;
    const h = document.createElement('h2');
    h.textContent = group;
    controls?.append(h);
  }
  const b = document.createElement('button');
  b.textContent = s.label;
  b.dataset.scene = String(i);
  b.onclick = () => void play(i);
  controls?.append(b);
});
stage.onSkip(() => take?.skip());
stage.update(viewAt('discussion'));
stage.restLook(0);

declare global {
  interface Window {
    __stageLab?: { scenes: { group: string; label: string }[]; play(i: number): Promise<void> };
  }
}
window.__stageLab = { scenes: SCENES.map((s) => ({ group: s.group, label: s.label })), play };
if (new URLSearchParams(location.search).has('clip')) document.body.classList.add('clip');
