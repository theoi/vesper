import { describe, expect, it } from 'vitest';
import { applyIntent, createGame, tick } from './game.ts';
import { ROLES } from './roles.ts';
import { DEFAULT_OPTIONS, PRESETS, defaultConfig, presetFor, validateRoleList } from './setup.ts';
import { TEST_TIMERS, act, pinnedGame, runNight, start, until } from './testkit.ts';
import type { GameConfig, RoleId } from './types.ts';
import { viewFor } from './view.ts';

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Name${i}`, isBot: i > 0 }));

describe('player views', () => {
  it('a Town player sees only their own role among the living', () => {
    const d = start(pinnedGame(['augur', 'resident', 'resident', 'resident', 'patron', 'hatchet']));
    const v = viewFor(d.state, 'p0');
    expect(v.you.role).toBe('augur');
    expect(v.players.map((p) => p.role)).toEqual(['augur', null, null, null, null, null]);
    expect(v.you.teammates).toEqual([]);
  });

  it('a Syndicate member sees teammates', () => {
    const d = start(pinnedGame(['augur', 'resident', 'resident', 'resident', 'patron', 'hatchet']));
    const v = viewFor(d.state, 'p5');
    expect(v.players.map((p) => p.role)).toEqual([null, null, null, null, 'patron', 'hatchet']);
    expect(v.you.teammates).toEqual([{ id: 'p4', name: 'Eli', role: 'patron', alive: true }]);
  });

  it("events never leak another player's private information", () => {
    let d = until(
      start(pinnedGame(['augur', 'mender', 'resident', 'resident', 'patron', 'hatchet'])),
      'night',
    );
    d = act(d, 'p5', { type: 'chat', channel: 'mafia', text: 'Augur first.' });
    d = runNight(d, { p0: 'p4', p1: 'p2', p4: 'p1' });
    const visible = viewFor(d.state, 'p2').events;
    for (const e of visible) {
      expect(e.audience === 'all' || e.audience.includes('p2')).toBe(true);
      if (e.type === 'roleAssigned' || e.type === 'nightResult' || e.type === 'nightActionSet') {
        expect(e.player).toBe('p2');
      }
      expect(e.type).not.toBe('mafiaPick');
    }
    expect(visible.some((e) => e.type === 'chat')).toBe(false);
    expect(JSON.stringify(viewFor(d.state, 'p2'))).not.toContain('Augur first.');
  });

  it('sinceSeq returns only newer events', () => {
    let d = until(
      start(pinnedGame(['resident', 'resident', 'resident', 'resident', 'hatchet'])),
      'discussion',
    );
    const seq = viewFor(d.state, 'p0').lastSeq;
    d = act(d, 'p1', { type: 'chat', channel: 'public', text: 'hi' });
    const v = viewFor(d.state, 'p0', { sinceSeq: seq });
    expect(v.events.map((e) => e.type)).toEqual(['chat']);
    expect(v.lastSeq).toBe(seq + 1);
  });

  it('the view lists only actions the engine would accept', () => {
    const d = until(
      start(pinnedGame(['augur', 'resident', 'resident', 'resident', 'hatchet'])),
      'night',
    );
    const v = viewFor(d.state, 'p0');
    expect(v.allowed).toMatchObject({
      nightAction: 'investigate',
      nightTargets: ['p1', 'p2', 'p3', 'p4'],
    });
    for (const t of v.allowed.nightTargets) {
      expect(applyIntent(d.state, 'p0', { type: 'night', targets: [t] }, 1).error).toBeUndefined();
    }
    expect(viewFor(d.state, 'p1').allowed.nightAction).toBeNull();
  });
});

describe('purity and determinism', () => {
  it('createGame is deterministic for a seed and varies across seeds', () => {
    const cfg = defaultConfig(players(12));
    const a = createGame(cfg, 'seed-1', 0).state;
    const b = createGame(cfg, 'seed-1', 0).state;
    expect(a).toEqual(b);
    const roleSets = new Set(
      Array.from({ length: 8 }, (_, i) =>
        createGame(cfg, i, 0)
          .state.players.map((p) => p.role)
          .join(),
      ),
    );
    expect(roleSets.size).toBeGreaterThan(1);
  });

  it('state and views survive a JSON round trip', () => {
    let d = until(
      start(pinnedGame(['augur', 'mender', 'resident', 'resident', 'patron', 'hatchet'])),
      'night',
    );
    d = runNight(d, { p4: 'p2', p0: 'p4' });
    expect(JSON.parse(JSON.stringify(d.state))).toEqual(d.state);
    const v = viewFor(d.state, 'p0');
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
  });

  it('applyIntent and tick never mutate their input', () => {
    let d = until(
      start(pinnedGame(['augur', 'mender', 'resident', 'resident', 'patron', 'hatchet'])),
      'night',
    );
    const before = JSON.stringify(d.state);
    applyIntent(d.state, 'p4', { type: 'night', targets: ['p2'] }, 5);
    tick(d.state, d.state.phase.endsAt as number);
    expect(JSON.stringify(d.state)).toBe(before);
    d = act(d, 'p4', { type: 'night', targets: ['p2'] });
    const mid = JSON.stringify(d.state);
    tick(d.state, d.state.phase.endsAt as number);
    expect(JSON.stringify(d.state)).toBe(mid);
  });

  it('a rejected intent returns the same state and no events', () => {
    const d = until(
      start(pinnedGame(['resident', 'resident', 'resident', 'resident', 'hatchet'])),
      'night',
    );
    const r = applyIntent(d.state, 'p0', { type: 'chat', channel: 'public', text: 'hi' }, 2);
    expect(r.error).toBeDefined();
    expect(r.state).toBe(d.state);
    expect(r.events).toEqual([]);
    expect(applyIntent(d.state, 'ghost', { type: 'ready', ready: true }, 2).error).toBeDefined();
    expect(applyIntent(d.state, 'p0', { type: 'nope' } as never, 2).error).toBeDefined();
  });

  it('event seqs are 1..n in log order', () => {
    const d = runNight(
      start(pinnedGame(['augur', 'mender', 'resident', 'resident', 'patron', 'hatchet'])),
      {
        p4: 'p2',
      },
    );
    expect(d.state.log.map((e) => e.seq)).toEqual(d.state.log.map((_, i) => i + 1));
    expect(d.state.seq).toBe(d.state.log.length);
  });
});

describe('setup', () => {
  it('every preset for 7 to 15 players is valid', () => {
    for (let n = 7; n <= 15; n++) {
      const preset = presetFor(n);
      expect(preset.players).toBe(n);
      expect(validateRoleList(preset.roles, n)).toMatchObject({ ok: true, errors: [] });
    }
    expect(PRESETS.map((p) => p.players)).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it('fallback presets cover 4 to 16 players', () => {
    for (let n = 4; n <= 16; n++) expect(validateRoleList(presetFor(n).roles, n).ok).toBe(true);
  });

  it('presets do not depend on the Mourner', () => {
    for (const p of PRESETS)
      expect(p.roles.filter((r) => r === 'mourner').length).toBeLessThanOrEqual(1);
    expect(presetFor(7).roles).not.toContain('mourner');
  });

  it('rejects broken role lists with clear errors', () => {
    expect(validateRoleList(['resident', 'resident', 'hatchet'], 4).errors[0]).toMatch(
      /3 slots for 4/,
    );
    expect(
      validateRoleList(['resident', 'resident', 'resident', 'resident'], 4).errors.join(),
    ).toMatch(/Syndicate slot or a Cutthroat/);
    expect(
      validateRoleList(['resident', 'resident', 'patron', 'patron', 'resident'], 5).errors.join(),
    ).toMatch(/only once/);
    expect(validateRoleList(['resident', 'resident', 'hatchet', 'lure'], 4).errors.join()).toMatch(
      /smaller than the Town/,
    );
    expect(validateRoleList(['resident', 'resident', 'resident', 'wizard'], 4).ok).toBe(false);
    expect(
      validateRoleList(['resident', 'resident', 'resident', 'neutral-killing', 'cutthroat'], 5).ok,
    ).toBe(false);
  });

  it('warns about a Syndicate with no killer and promotes one at the deal', () => {
    const roles: RoleId[] = ['resident', 'resident', 'resident', 'resident', 'lure'];
    expect(validateRoleList(roles, 5).warnings.join()).toMatch(/promoted to Hatchet/);
    const cfg: GameConfig = {
      players: players(5),
      roles,
      timers: TEST_TIMERS,
      options: DEFAULT_OPTIONS,
    };
    expect(createGame(cfg, 1).state.players.some((p) => p.role === 'hatchet')).toBe(true);
  });

  it('resolves random slots into matching roles', () => {
    const roles = [
      'random-town',
      'town-investigative',
      'town-protective',
      'resident',
      'random-mafia',
      'neutral-evil',
    ];
    const cfg: GameConfig = {
      players: players(6),
      roles: roles as never,
      timers: TEST_TIMERS,
      options: DEFAULT_OPTIONS,
    };
    for (let seed = 0; seed < 20; seed++) {
      const dealt = createGame(cfg, seed).state.players.map((p) => p.role);
      expect(
        dealt.filter((r) => ROLES[r].category === 'town-investigative').length,
      ).toBeGreaterThanOrEqual(1);
      expect(dealt.filter((r) => ROLES[r].faction === 'mafia').length).toBe(1);
      expect(dealt.filter((r) => ROLES[r].category === 'neutral-evil').length).toBe(1);
      expect(dealt.some((r) => r === 'hatchet' || r === 'patron')).toBe(true);
    }
  });

  it('createGame rejects bad configs', () => {
    const base = defaultConfig(players(7));
    expect(() => createGame({ ...base, roles: base.roles.slice(1) }, 1)).toThrow(/role list/);
    const dupe = players(7);
    dupe[1] = { ...dupe[1]!, name: 'name0' };
    expect(() => createGame({ ...base, players: dupe }, 1)).toThrow(/named/);
  });

  it('assigns each Accuser a Town target', () => {
    const cfg = defaultConfig(players(8));
    for (let seed = 0; seed < 10; seed++) {
      const s = createGame(cfg, seed).state;
      const acc = s.players.find((p) => p.role === 'accuser')!;
      const target = s.players.find((p) => p.id === acc.accuserTarget)!;
      expect(ROLES[target.role].faction).toBe('town');
      expect(viewFor(s, acc.id).you.accuserTarget).toBe(target.id);
    }
  });
});
