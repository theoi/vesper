import { describe, expect, it } from 'vitest';
import { ROLES } from './roles.ts';
import {
  act,
  alive,
  judge,
  pinnedGame,
  putOnTrial,
  resultsFor,
  runNight,
  start,
  tryAct,
  until,
} from './testkit.ts';
import type { GameEvent, RoleId } from './types.ts';
import { viewFor } from './view.ts';

const deathOf = (events: GameEvent[], id: string) =>
  events.find(
    (e): e is Extract<GameEvent, { type: 'death' }> => e.type === 'death' && e.player === id,
  );

describe('night resolution', () => {
  it('a Mender heal beats a Syndicate kill', () => {
    const d = runNight(
      start(pinnedGame(['mender', 'resident', 'resident', 'resident', 'hatchet'])),
      {
        p4: 'p1',
        p0: 'p1',
      },
    );
    expect(alive(d, 'p1')).toBe(true);
    expect(resultsFor(d, 'p1')).toContainEqual({ kind: 'attackedSurvived', savedBy: 'healed' });
    expect(resultsFor(d, 'p0')).toContainEqual({
      kind: 'patientAttacked',
      target: 'p1',
      saved: true,
    });
    expect(resultsFor(d, 'p4')).toContainEqual({ kind: 'targetSurvived', target: 'p1' });
  });

  it('without a heal the kill lands and the dawn reports it', () => {
    const d = runNight(
      start(pinnedGame(['mender', 'resident', 'resident', 'resident', 'hatchet'])),
      {
        p4: 'p1',
        p0: 'p2',
      },
    );
    expect(alive(d, 'p1')).toBe(false);
    expect(d.state.phase.kind).toBe('dawn');
    expect(d.state.phase.day).toBe(2);
    const dawn = d.events.find((e) => e.type === 'dawn');
    expect(dawn).toMatchObject({ deaths: ['p1'] });
    expect(deathOf(d.events, 'p1')).toMatchObject({ causes: ['mafia'], role: 'resident' });
  });

  it('a Muse distracting the Hatchet stops the kill', () => {
    const d = runNight(start(pinnedGame(['muse', 'resident', 'resident', 'resident', 'hatchet'])), {
      p4: 'p1',
      p0: 'p4',
    });
    expect(alive(d, 'p1')).toBe(true);
    expect(resultsFor(d, 'p4')).toContainEqual({ kind: 'blocked' });
  });

  it('a Lure distracting the Augur stops the reading', () => {
    const d = runNight(
      start(
        pinnedGame(['augur', 'resident', 'resident', 'resident', 'resident', 'lure', 'hatchet']),
      ),
      { p0: 'p6', p5: 'p0' },
    );
    expect(resultsFor(d, 'p0')).toEqual([{ kind: 'blocked' }]);
  });

  it('a Slanderer frame makes an innocent read Suspicious', () => {
    const roles: RoleId[] = ['augur', 'resident', 'resident', 'resident', 'slanderer', 'hatchet'];
    const framed = runNight(start(pinnedGame(roles)), { p0: 'p1', p4: 'p1' });
    expect(resultsFor(framed, 'p0')).toContainEqual({
      kind: 'investigation',
      target: 'p1',
      finding: 'suspicious',
    });
    const clean = runNight(start(pinnedGame(roles)), { p0: 'p1', p4: 'p2' });
    expect(resultsFor(clean, 'p0')).toContainEqual({
      kind: 'investigation',
      target: 'p1',
      finding: 'clear',
    });
  });

  it('the Patron reads Clear while the Hatchet and Cutthroat read Suspicious', () => {
    const roles: RoleId[] = [
      'augur',
      'augur',
      'augur',
      'resident',
      'resident',
      'resident',
      'patron',
      'hatchet',
      'cutthroat',
    ];
    const d = runNight(start(pinnedGame(roles)), { p0: 'p6', p1: 'p7', p2: 'p8' });
    expect(resultsFor(d, 'p0')).toContainEqual({
      kind: 'investigation',
      target: 'p6',
      finding: 'clear',
    });
    expect(resultsFor(d, 'p1')).toContainEqual({
      kind: 'investigation',
      target: 'p7',
      finding: 'suspicious',
    });
    expect(resultsFor(d, 'p2')).toContainEqual({
      kind: 'investigation',
      target: 'p8',
      finding: 'suspicious',
    });
  });

  it('Syndicate abilities cannot target teammates', () => {
    const roles: RoleId[] = [
      'augur',
      'resident',
      'resident',
      'resident',
      'resident',
      'patron',
      'slanderer',
    ];
    const d = until(start(pinnedGame(roles)), 'night');
    expect(tryAct(d, 'p6', { type: 'night', targets: ['p5'] })).toBeDefined();
    expect(viewFor(d.state, 'p6').allowed.nightTargets).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
  });

  it("the Patron's order overrides the Hatchet, who is the one seen visiting", () => {
    const roles: RoleId[] = [
      'lamplighter',
      'resident',
      'resident',
      'resident',
      'patron',
      'hatchet',
    ];
    const d = runNight(start(pinnedGame(roles)), { p4: 'p1', p5: 'p2', p0: 'p1' });
    expect(alive(d, 'p1')).toBe(false);
    expect(alive(d, 'p2')).toBe(true);
    expect(resultsFor(d, 'p0')).toContainEqual({
      kind: 'visitors',
      target: 'p1',
      visitors: ['p5'],
    });
  });

  it("a distracted Patron's order is lost and the Hatchet's own pick stands", () => {
    const roles: RoleId[] = ['muse', 'resident', 'resident', 'resident', 'patron', 'hatchet'];
    const d = runNight(start(pinnedGame(roles)), { p4: 'p1', p5: 'p2', p0: 'p4' });
    expect(alive(d, 'p1')).toBe(true);
    expect(alive(d, 'p2')).toBe(false);
    expect(resultsFor(d, 'p4')).toContainEqual({ kind: 'blocked' });
  });

  it('a Patron with no Hatchet carries out the kill', () => {
    const d = runNight(
      start(pinnedGame(['resident', 'resident', 'resident', 'resident', 'patron'])),
      {
        p4: 'p1',
      },
    );
    expect(alive(d, 'p1')).toBe(false);
  });

  it('the Patron survives a basic attack', () => {
    const roles: RoleId[] = ['reckoner', 'resident', 'resident', 'resident', 'resident', 'patron'];
    let d = runNight(start(pinnedGame(roles)), {});
    d = runNight(d, { p0: 'p5' });
    expect(alive(d, 'p5')).toBe(true);
    expect(resultsFor(d, 'p5')).toContainEqual({ kind: 'attackedSurvived', savedBy: 'defense' });
  });

  it('a Sentinel kills the attacker and dies in place of its charge', () => {
    const roles: RoleId[] = [
      'sentinel',
      'resident',
      'resident',
      'resident',
      'resident',
      'hatchet',
      'lure',
    ];
    const d = runNight(start(pinnedGame(roles)), { p5: 'p1', p0: 'p1' });
    expect(alive(d, 'p1')).toBe(true);
    expect(alive(d, 'p5')).toBe(false);
    expect(alive(d, 'p0')).toBe(false);
    expect(deathOf(d.events, 'p5')?.causes).toEqual(['sentinel']);
    expect(deathOf(d.events, 'p0')?.causes).toEqual(['guarding']);
    expect(resultsFor(d, 'p1')).toContainEqual({ kind: 'attackedSurvived', savedBy: 'guarded' });
    expect(resultsFor(d, 'p0')).toContainEqual({ kind: 'guardFought', target: 'p1' });
    // The Hatchet died, so the Lure is promoted.
    expect(d.state.players[6]?.role).toBe('hatchet');
  });

  it('a Mender can save a Sentinel from the fight', () => {
    const roles: RoleId[] = ['sentinel', 'mender', 'resident', 'resident', 'resident', 'hatchet'];
    const d = runNight(start(pinnedGame(roles)), { p5: 'p2', p0: 'p2', p1: 'p0' });
    expect(alive(d, 'p0')).toBe(true);
    expect(alive(d, 'p2')).toBe(true);
    expect(alive(d, 'p5')).toBe(false);
  });

  it('a Cutthroat shrugs off a basic attack and kills the Muse who distracts it', () => {
    const roles: RoleId[] = [
      'muse',
      'resident',
      'resident',
      'resident',
      'hatchet',
      'cutthroat',
      'resident',
    ];
    const d = runNight(start(pinnedGame(roles)), { p4: 'p5', p5: 'p1', p0: 'p5' });
    expect(alive(d, 'p5')).toBe(true);
    expect(alive(d, 'p0')).toBe(false);
    expect(alive(d, 'p1')).toBe(true);
    expect(deathOf(d.events, 'p0')?.causes).toEqual(['cutthroat']);
    expect(resultsFor(d, 'p5')).toContainEqual({ kind: 'attackedSurvived', savedBy: 'defense' });
  });

  it('the Reckoner cannot shoot on Night 1, then shoots on Night 2', () => {
    const roles: RoleId[] = ['reckoner', 'resident', 'resident', 'resident', 'hatchet', 'resident'];
    let d = until(start(pinnedGame(roles)), 'night');
    expect(tryAct(d, 'p0', { type: 'night', targets: ['p4'] })).toBeDefined();
    expect(viewFor(d.state, 'p0').allowed.nightTargets).toEqual([]);
    d = runNight(d, {});
    d = runNight(d, { p0: 'p4' });
    expect(alive(d, 'p4')).toBe(false);
    expect(d.state.players[0]?.usesLeft).toBe(1);
  });

  it('a Reckoner who kills a Town member puts the gun down', () => {
    const roles: RoleId[] = ['reckoner', 'resident', 'resident', 'resident', 'hatchet', 'resident'];
    let d = runNight(start(pinnedGame(roles)), {});
    d = runNight(d, { p0: 'p1' });
    expect(alive(d, 'p1')).toBe(false);
    expect(d.state.players[0]?.usesLeft).toBe(0);
    expect(resultsFor(d, 'p0')).toContainEqual({ kind: 'reckonerGuilt', target: 'p1' });
  });

  it('Drifter armor survives a basic attack and uses a charge', () => {
    const d = runNight(
      start(pinnedGame(['drifter', 'resident', 'resident', 'resident', 'hatchet'])),
      {
        p0: 'p0',
        p4: 'p0',
      },
    );
    expect(alive(d, 'p0')).toBe(true);
    expect(d.state.players[0]?.usesLeft).toBe(1);
    expect(resultsFor(d, 'p0')).toContainEqual({ kind: 'attackedSurvived', savedBy: 'vest' });
  });

  it('the Embalmer hides the role and will from everyone but itself until the end', () => {
    const roles: RoleId[] = ['resident', 'resident', 'resident', 'resident', 'hatchet', 'embalmer'];
    let d = until(start(pinnedGame(roles)), 'night');
    d = act(d, 'p1', { type: 'will', text: 'I am a Resident. Trust Ada.' });
    d = runNight(d, { p4: 'p1', p5: 'p1' });
    expect(deathOf(d.events, 'p1')).toMatchObject({ role: null, will: null, embalmed: true });
    expect(resultsFor(d, 'p5')).toContainEqual({
      kind: 'embalmed',
      target: 'p1',
      role: 'resident',
      will: 'I am a Resident. Trust Ada.',
    });
    expect(d.state.players[5]?.usesLeft).toBe(1);
    const townView = viewFor(d.state, 'p0');
    expect(townView.graveyard[0]).toMatchObject({ id: 'p1', role: null, will: null });
    expect(townView.players[1]?.role).toBeNull();
  });

  it('an Embalmer use is kept when the target survives', () => {
    const roles: RoleId[] = ['mender', 'resident', 'resident', 'resident', 'hatchet', 'embalmer'];
    const d = runNight(start(pinnedGame(roles)), { p4: 'p1', p5: 'p1', p0: 'p1' });
    expect(alive(d, 'p1')).toBe(true);
    expect(d.state.players[5]?.usesLeft).toBe(2);
  });

  it('the Mender may tend itself only once', () => {
    const roles: RoleId[] = ['mender', 'resident', 'resident', 'resident', 'hatchet'];
    let d = runNight(start(pinnedGame(roles)), { p0: 'p0' });
    d = until(d, 'night');
    expect(viewFor(d.state, 'p0').allowed.nightTargets).not.toContain('p0');
    expect(tryAct(d, 'p0', { type: 'night', targets: ['p0'] })).toBeDefined();
  });

  it('the Lamplighter sees every visitor in seat order, but not itself', () => {
    const roles: RoleId[] = ['lamplighter', 'mender', 'augur', 'resident', 'hatchet', 'resident'];
    const d = runNight(start(pinnedGame(roles)), { p0: 'p3', p1: 'p3', p2: 'p3', p4: 'p3' });
    expect(alive(d, 'p3')).toBe(true);
    expect(resultsFor(d, 'p0')).toContainEqual({
      kind: 'visitors',
      target: 'p3',
      visitors: ['p1', 'p2', 'p4'],
    });
  });

  it('a distracted visitor is not seen visiting', () => {
    const roles: RoleId[] = ['lamplighter', 'muse', 'augur', 'resident', 'hatchet', 'resident'];
    const d = runNight(start(pinnedGame(roles)), { p0: 'p3', p1: 'p2', p2: 'p3' });
    expect(resultsFor(d, 'p0')).toContainEqual({ kind: 'visitors', target: 'p3', visitors: [] });
  });

  it("killers' death notes appear on their victims", () => {
    let d = until(
      start(pinnedGame(['resident', 'resident', 'resident', 'resident', 'hatchet'])),
      'night',
    );
    d = act(d, 'p4', { type: 'deathNote', text: 'The bells toll for you.' });
    d = runNight(d, { p4: 'p2' });
    expect(deathOf(d.events, 'p2')?.deathNotes).toEqual(['The bells toll for you.']);
    expect(tryAct(d, 'p0', { type: 'deathNote', text: 'x' })).toBeDefined();
  });

  it('a will is revealed when its writer dies at night', () => {
    let d = until(
      start(pinnedGame(['resident', 'resident', 'resident', 'resident', 'hatchet'])),
      'night',
    );
    d = act(d, 'p2', { type: 'will', text: 'Night 1: nothing.\nSuspect Eli.' });
    d = runNight(d, { p4: 'p2' });
    expect(deathOf(d.events, 'p2')?.will).toBe('Night 1: nothing.\nSuspect Eli.');
    expect(viewFor(d.state, 'p0').graveyard[0]?.will).toBe('Night 1: nothing.\nSuspect Eli.');
  });

  it('the submission order of night actions does not change the outcome', () => {
    const roles: RoleId[] = [
      'mender',
      'muse',
      'resident',
      'resident',
      'hatchet',
      'cutthroat',
      'resident',
    ];
    const a = runNight(start(pinnedGame(roles)), { p0: 'p2', p1: 'p5', p4: 'p2', p5: 'p3' });
    const b = runNight(start(pinnedGame(roles)), { p5: 'p3', p4: 'p2', p1: 'p5', p0: 'p2' });
    const summary = (x: typeof a) => x.state.players.map((p) => [p.id, p.alive, p.nightResults]);
    expect(summary(a)).toEqual(summary(b));
  });

  it('an executed Hatchet with no Patron promotes a Syndicate member', () => {
    const roles: RoleId[] = ['resident', 'resident', 'resident', 'resident', 'hatchet', 'lure'];
    let d = runNight(start(pinnedGame(roles)), {});
    d = putOnTrial(d, 'p4', ['p0', 'p1', 'p2', 'p3']);
    d = judge(d, { p0: 'guilty', p1: 'guilty', p2: 'guilty', p3: 'guilty' });
    d = until(d, 'execution');
    expect(alive(d, 'p4')).toBe(false);
    expect(d.state.players[5]?.role).toBe('hatchet');
    const promo = d.events.find((e) => e.type === 'roleChanged');
    expect(promo).toMatchObject({ player: 'p5', from: 'lure', to: 'hatchet', audience: ['p5'] });
  });

  it('every role has a complete card', () => {
    for (const r of Object.values(ROLES)) {
      expect(r.name.length).toBeGreaterThan(2);
      expect(r.summary.length).toBeGreaterThan(20);
      expect(r.flavor.length).toBeGreaterThan(10);
      expect(r.goal.length).toBeGreaterThan(5);
    }
  });
});
