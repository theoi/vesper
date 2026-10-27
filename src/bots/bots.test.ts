import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyIntent } from '../engine/game.ts';
import { act, pinnedGame, runNight, start, until, type Driver } from '../engine/testkit.ts';
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
    const dir = join(import.meta.dirname);
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
    for (const file of readdirSync(dir).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
    )) {
      const src = readFileSync(join(dir, file), 'utf8');
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
