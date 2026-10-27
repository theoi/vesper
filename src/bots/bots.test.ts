import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyIntent } from '../engine/game.ts';
import {
  act,
  pinnedGame,
  putOnTrial,
  runNight,
  start,
  until,
  type Driver,
} from '../engine/testkit.ts';
import type { RoleId } from '../engine/types.ts';
import { viewFor } from '../engine/view.ts';
import {
  PERSONALITIES,
  createBot,
  decideBot,
  parseLine,
  parseWill,
  pickBotNames,
  type BotState,
} from './index.ts';

/** Run bots on a shared clock for `ms` after the phase start (or until the phase changes). */
function driveAll(d: Driver, bots: BotState[], ms: number): { d: Driver; bots: BotState[] } {
  let cur = d;
  const list = bots.slice();
  const startAt = cur.state.phase.startedAt;
  for (
    let now = startAt;
    now <= startAt + ms && cur.state.phase.startedAt === startAt;
    now += 250
  ) {
    for (let i = 0; i < list.length; i++) {
      const b = list[i] as BotState;
      if (b.wakeAt > now) continue;
      const out = decideBot(b, viewFor(cur.state, b.id, { sinceSeq: b.seenSeq }), now);
      list[i] = out.bot;
      for (const intent of [...out.speech.map((s) => s.intent), ...out.intents]) {
        const r = applyIntent(cur.state, b.id, intent, now);
        if (!r.error) cur = { state: r.state, events: [...cur.events, ...r.events] };
      }
    }
  }
  return { d: cur, bots: list };
}

function drive(d: Driver, bot: BotState, ms: number): { d: Driver; bot: BotState } {
  const r = driveAll(d, [bot], ms);
  return { d: r.d, bot: r.bots[0] as BotState };
}

const LONG = { discussion: 60_000, voting: 40_000, night: 40_000 };

function longGame(roles: RoleId[]): Driver {
  const s = pinnedGame(roles);
  s.config = { ...s.config, timers: { ...s.config.timers, ...LONG } };
  return start(s);
}

describe('bot boundaries', () => {
  it('bot code never imports engine internals that expose full game state', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? files(join(dir, e.name))
          : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')
            ? [join(dir, e.name)]
            : [],
      );
    const forbidden = [
      'game.ts',
      'view.ts',
      'ctx.ts',
      'night.ts',
      'win.ts',
      'rules.ts',
      'setup.ts',
      'testkit.ts',
    ];
    const all = files(import.meta.dirname);
    expect(all.some((f) => f.includes('/llm/'))).toBe(true);
    for (const file of all) {
      const src = readFileSync(file, 'utf8');
      for (const f of forbidden)
        expect(src, `${file} imports ${f}`).not.toMatch(new RegExp(`engine/${f}`));
      expect(src, `${file} mentions GameState`).not.toMatch(/\bGameState\b/);
    }
  });

  it('decisions are deterministic for the same bot, view, and time', () => {
    const d = until(
      longGame(['augur', 'resident', 'resident', 'resident', 'hatchet']),
      'discussion',
    );
    const bot = createBot('p0', 7);
    const v = viewFor(d.state, 'p0');
    expect(decideBot(bot, v, 5000)).toEqual(decideBot(bot, JSON.parse(JSON.stringify(v)), 5000));
  });
});

describe('bot decisions', () => {
  it('the Hatchet follows the Patron’s order', () => {
    let d = until(
      longGame(['resident', 'resident', 'resident', 'resident', 'resident', 'patron', 'hatchet']),
      'night',
    );
    d = act(d, 'p5', { type: 'night', targets: ['p2'] });
    const r = drive(d, createBot('p6', 3), 30_000);
    expect(r.d.state.night['p6']).toEqual(['p2']);
  });

  it('Syndicate bots never vote for or target a teammate', () => {
    for (let seed = 0; seed < 25; seed++) {
      let d = runNight(
        longGame(['resident', 'resident', 'resident', 'resident', 'resident', 'patron', 'hatchet']),
        {},
      );
      d = until(d, 'voting');
      // Make the town loudly accuse the Hatchet so the Patron is tempted.
      const bot = createBot('p5', seed, { personality: 'hothead' });
      const r = drive(d, bot, 35_000);
      const vote = r.d.state.votes['p5'];
      expect(vote === undefined || vote !== 'p6').toBe(true);
    }
  });

  it('an Augur with a Suspicious reading usually claims it with the result attached', () => {
    let claims = 0;
    for (let seed = 0; seed < 12; seed++) {
      let d = runNight(
        longGame(['augur', 'resident', 'resident', 'resident', 'resident', 'hatchet']),
        { p0: 'p5' },
      );
      d = until(d, 'discussion');
      const r = drive(d, createBot('p0', seed, { personality: 'hothead' }), 55_000);
      const claim = r.d.events.find(
        (e) => e.type === 'chat' && e.from === 'p0' && e.meta?.kind === 'claim',
      );
      if (claim && claim.type === 'chat' && claim.meta?.kind === 'claim') {
        expect(claim.meta.role).toBe('augur');
        expect(claim.meta.results).toContainEqual(
          expect.objectContaining({ target: 'p5', finding: 'suspicious' }),
        );
        claims++;
      }
    }
    expect(claims).toBeGreaterThanOrEqual(8);
  });

  it('Town bots vote out a player the Augur proved Suspicious', () => {
    let d = runNight(
      longGame(['augur', 'resident', 'resident', 'resident', 'resident', 'hatchet']),
      { p0: 'p5' },
    );
    d = until(d, 'discussion');
    d = act(d, 'p0', {
      type: 'chat',
      channel: 'public',
      text: 'I am the Augur. Fay read Suspicious.',
      meta: {
        kind: 'claim',
        role: 'augur',
        results: [{ night: 1, target: 'p5', finding: 'suspicious' }],
      },
    });
    d = until(d, 'voting');
    const bots = ['p1', 'p2', 'p3', 'p4'].map((id, i) =>
      createBot(id, 100 + i, { personality: 'steady' }),
    );
    d = driveAll(d, bots, 39_000).d;
    expect(d.events.find((e) => e.type === 'trial')).toMatchObject({ defendant: 'p5' });
  });

  it('a bot defends itself when accused', () => {
    let d = runNight(
      longGame(['resident', 'resident', 'resident', 'resident', 'resident', 'hatchet']),
      {},
    );
    d = until(d, 'discussion');
    d = act(d, 'p2', {
      type: 'chat',
      channel: 'public',
      text: 'Ada is Syndicate, I am sure.',
      meta: { kind: 'accuse', target: 'p0', confidence: 1 },
    });
    const r = drive(d, createBot('p0', 4, { personality: 'hothead' }), 55_000);
    const replies = r.d.events.filter(
      (e) =>
        e.type === 'chat' &&
        e.from === 'p0' &&
        (e.meta?.kind === 'defend' || e.meta?.kind === 'claim'),
    );
    expect(replies.length).toBeGreaterThan(0);
  });

  it('a Syndicate bot on trial claims a Town cover, never its real role', () => {
    for (let seed = 0; seed < 10; seed++) {
      let d = runNight(
        longGame(['resident', 'resident', 'resident', 'resident', 'resident', 'hatchet', 'lure']),
        {},
      );
      d = until(d, 'voting');
      for (const v of ['p0', 'p1', 'p2', 'p3']) d = act(d, v, { type: 'vote', target: 'p6' });
      expect(d.state.phase.kind).toBe('defense');
      const r = drive(d, createBot('p6', seed), 20_000);
      const claim = r.d.events.find(
        (e) => e.type === 'chat' && e.from === 'p6' && e.meta?.kind === 'claim',
      );
      if (claim && claim.type === 'chat' && claim.meta?.kind === 'claim') {
        expect(['lure', 'hatchet', 'patron', 'slanderer', 'embalmer']).not.toContain(
          claim.meta.role,
        );
      }
    }
  });

  it('every speech line carries matching meta, a category, and the bot’s voice', () => {
    let d = runNight(longGame(['augur', 'mender', 'resident', 'resident', 'resident', 'hatchet']), {
      p5: 'p2',
    });
    d = until(d, 'discussion');
    for (const p of PERSONALITIES) {
      let bot = createBot('p0', 11, { personality: p.id });
      for (let now = d.state.phase.startedAt; now < d.state.phase.startedAt + 50_000; now += 2000) {
        const out = decideBot(bot, viewFor(d.state, 'p0', { sinceSeq: bot.seenSeq }), now);
        bot = out.bot;
        for (const s of out.speech) {
          expect(s.intent.text.length).toBeGreaterThan(0);
          expect(s.intent.meta).toEqual(s.act);
          expect(s.personality).toBe(p.id);
          expect(s.category.length).toBeGreaterThan(0);
          if (p.quirks.includes('lowercase'))
            expect(s.intent.text).toBe(s.intent.text.toLowerCase());
        }
      }
    }
  });
});

describe('Clear readings', () => {
  // Ada (Augur) reads Bea Clear on night 1. A Patron is in the game, so Clear is not proof.
  const SEVEN: RoleId[] = [
    'augur',
    'resident',
    'resident',
    'resident',
    'resident',
    'patron',
    'hatchet',
  ];
  const dawn2 = (read = 'p1') => runNight(longGame(SEVEN), { p0: read });

  /**
   * A bot that has taken in everything so far, with its memory then adjusted.
   * Prime it a phase early: bots plan when a phase starts.
   */
  function primed(
    d: Driver,
    id: string,
    seed: number,
    personality: string,
    patch: (m: BotState['memory']) => void,
  ): BotState {
    const view = viewFor(d.state, id);
    const bot = structuredClone(
      decideBot(createBot(id, seed, { personality }), view, d.state.phase.startedAt).bot,
    );
    patch(bot.memory);
    return bot;
  }

  const accusations = (d: Driver, from: string, target: string): string[] =>
    d.events.flatMap((e) =>
      e.type === 'chat' && e.from === from && e.meta?.kind === 'accuse' && e.meta.target === target
        ? [e.text]
        : [],
    );

  /** Accusations of Bea in discussion, and whether the bot voted Bea, over a dozen seeds. */
  function turnsOnBea(dawn: Driver, id: string, patch: (m: BotState['memory']) => void) {
    let accused = 0;
    let votes = 0;
    const d = until(dawn, 'discussion');
    for (let seed = 0; seed < 12; seed++) {
      const talk = drive(d, primed(dawn, id, seed, 'hothead', patch), 59_000);
      accused += accusations(talk.d, id, 'p1').length;
      const vote = drive(until(talk.d, 'voting'), talk.bot, 39_000);
      if (vote.d.events.some((e) => e.type === 'vote' && e.voter === id && e.target === 'p1'))
        votes++;
    }
    return { accused, votes };
  }

  it('the Augur does not accuse or vote a player it read Clear on weak suspicion', () => {
    const weak = (m: BotState['memory']) => {
      m.suspicion['p1'] = 4;
    };
    // Control: the same suspicion without the Clear reading gets Bea accused and voted.
    const control = turnsOnBea(dawn2('p2'), 'p0', weak);
    expect(control.accused).toBeGreaterThan(0);
    expect(control.votes).toBeGreaterThan(0);
    expect(turnsOnBea(dawn2('p1'), 'p0', weak)).toEqual({ accused: 0, votes: 0 });
  });

  it('the Augur votes innocent on a player it read Clear unless the case is strong', () => {
    const ballot = (suspicion: number, seed: number) => {
      const defense = until(putOnTrial(dawn2('p1'), 'p1', ['p2', 'p3', 'p4', 'p5']), 'defense');
      const bot = primed(defense, 'p0', seed, 'hothead', (m) => {
        m.suspicion['p1'] = suspicion;
      });
      const r = drive(until(defense, 'judgment'), bot, 30_000);
      return r.d.state.trial?.ballots['p0'];
    };
    for (let seed = 0; seed < 8; seed++) expect(ballot(3, seed)).toBe('innocent');
    expect([0, 1, 2, 3].map((seed) => ballot(30, seed))).toContain('guilty');
  });

  it('a claimed Augur turning on a player it read Clear explains that the Patron reads Clear', () => {
    let texts: string[] = [];
    const dawn = dawn2('p1');
    const d = until(dawn, 'discussion');
    for (let seed = 0; seed < 12; seed++) {
      const bot = primed(dawn, 'p0', seed, 'hothead', (m) => {
        m.suspicion['p1'] = 9;
        m.claimed = 'augur';
      });
      texts = texts.concat(accusations(drive(d, bot, 59_000).d, 'p0', 'p1'));
    }
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(text).toMatch(/rule out the patron/i);
  });

  it('a Syndicate bot never turns on a player its fake Augur claim cleared', () => {
    const suspected = (m: BotState['memory']) => {
      m.suspicion['p1'] = 9;
    };
    const control = turnsOnBea(dawn2(), 'p5', suspected);
    expect(control.accused + control.votes).toBeGreaterThan(0);
    const story = (m: BotState['memory']) => {
      suspected(m);
      m.claimed = 'augur';
      m.fakeResults = [{ night: 1, target: 'p1', finding: 'clear' }];
    };
    expect(turnsOnBea(dawn2(), 'p5', story)).toEqual({ accused: 0, votes: 0 });
  });
});
describe('reading human chat', () => {
  const players = ['Ada', 'Bea', 'Cal', 'Dov'].map((name, i) => ({
    id: `p${i}`,
    name,
    seat: i,
    alive: true,
    isBot: false,
    magistrateRevealed: false,
    role: null,
  }));

  it('parses claims with results, accusations, defenses, and questions', () => {
    expect(parseLine("I'm the Augur, Bea is suspicious", players, 'p0')).toEqual([
      {
        kind: 'claim',
        role: 'augur',
        results: [{ night: 0, target: 'p1', finding: 'suspicious' }],
      },
    ]);
    expect(parseLine('Cal is totally mafia', players, 'p0')).toEqual([
      { kind: 'accuse', target: 'p2', confidence: 0.6 },
    ]);
    expect(parseLine('I trust Dov', players, 'p0')).toEqual([{ kind: 'defend', target: 'p3' }]);
    expect(parseLine('Bea, what is your role?', players, 'p0')).toEqual([
      { kind: 'question', target: 'p1' },
    ]);
    expect(parseLine('i am the mender', players, 'p0')).toEqual([
      { kind: 'claim', role: 'mender' },
    ]);
  });

  it('reads results out of a will', () => {
    expect(
      parseWill(
        'Augur.\nN1: Bea - Suspicious\nN2: Cal - Clear\nN3: Dov visited by Ada, Bea',
        players,
      ),
    ).toEqual([
      { night: 1, target: 'p1', finding: 'suspicious' },
      { night: 2, target: 'p2', finding: 'clear' },
      { night: 3, target: 'p3', finding: 'visited', visitors: ['p0', 'p1'] },
    ]);
  });
});

describe('bot names', () => {
  it('picks distinct names that avoid taken ones', () => {
    const names = pickBotNames(14, 1, ['Wren', 'bram']);
    expect(new Set(names).size).toBe(14);
    expect(names).not.toContain('Wren');
    expect(names).not.toContain('Bram');
    expect(pickBotNames(40, 2).length).toBe(40);
  });
});
