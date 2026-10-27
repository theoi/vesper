import { describe, expect, it } from 'vitest';
import {
  act,
  alive,
  judge,
  pinnedGame,
  putOnTrial,
  runNight,
  start,
  step,
  until,
  type Driver,
} from './testkit.ts';
import type { GameEvent, RoleId } from './types.ts';
import { viewFor } from './view.ts';
import { evaluateWin } from './win.ts';

function execute(d: Driver, target: string): Driver {
  const voters = d.state.players.filter((p) => p.alive && p.id !== target).map((p) => p.id);
  let cur = putOnTrial(d, target, voters);
  cur = judge(cur, Object.fromEntries(voters.map((v) => [v, 'guilty' as const])));
  return until(cur, 'execution');
}

const gameOver = (events: GameEvent[]) =>
  events.find((e): e is Extract<GameEvent, { type: 'gameOver' }> => e.type === 'gameOver');

describe('win conditions', () => {
  it('the Town wins when the last killer is executed', () => {
    let d = runNight(
      start(pinnedGame(['resident', 'resident', 'resident', 'resident', 'hatchet'])),
      {},
    );
    d = execute(d, 'p4');
    d = step(d);
    expect(d.state.phase.kind).toBe('ended');
    expect(d.state.result).toMatchObject({ outcome: 'town', reason: 'threatsEliminated' });
    expect(d.state.result?.winners).toEqual(['p0', 'p1', 'p2', 'p3']);
    expect(gameOver(d.events)?.roles).toMatchObject({ p4: 'hatchet', p0: 'resident' });
  });

  it('the Syndicate wins at parity', () => {
    let d = runNight(start(pinnedGame(['resident', 'resident', 'resident', 'hatchet'])), {
      p3: 'p0',
    });
    d = execute(d, 'p1');
    d = step(d);
    expect(d.state.result).toMatchObject({
      outcome: 'mafia',
      reason: 'mafiaParity',
      winners: ['p3'],
    });
  });

  it('a revealed Magistrate counts three toward parity', () => {
    const roles: RoleId[] = ['magistrate', 'resident', 'resident', 'resident', 'hatchet', 'lure'];
    let d = runNight(start(pinnedGame(roles)), { p4: 'p1' });
    d = until(d, 'discussion');
    d = act(d, 'p0', { type: 'reveal' });
    d = execute(d, 'p2');
    d = step(d);
    // 2 Syndicate vs Magistrate (3) + Resident: no parity yet.
    expect(d.state.phase.kind).toBe('night');
  });

  it('the Cutthroat wins as the last killer standing', () => {
    let d = runNight(start(pinnedGame(['resident', 'resident', 'resident', 'cutthroat'])), {
      p3: 'p0',
    });
    d = execute(d, 'p1');
    d = step(d);
    expect(d.state.result).toMatchObject({ outcome: 'cutthroat', winners: ['p3'] });
  });

  it('an executed Harlequin wins and the game goes on; the win stands at the end', () => {
    const roles: RoleId[] = [
      'resident',
      'resident',
      'resident',
      'resident',
      'hatchet',
      'harlequin',
    ];
    let d = runNight(start(pinnedGame(roles)), {});
    d = execute(d, 'p5');
    expect(d.events.find((e) => e.type === 'neutralWin')).toMatchObject({
      player: 'p5',
      audience: 'all',
    });
    d = step(d);
    expect(d.state.phase.kind).toBe('night');
    d = runNight(d, {});
    d = execute(d, 'p4');
    d = step(d);
    expect(d.state.result?.outcome).toBe('town');
    expect(d.state.result?.winners).toContain('p5');
  });

  it('the Accuser wins privately when its target is executed', () => {
    const roles: RoleId[] = ['resident', 'resident', 'resident', 'resident', 'hatchet', 'accuser'];
    let d = runNight(start(pinnedGame(roles, {}, 'p0')), {});
    d = execute(d, 'p0');
    const win = d.events.find((e) => e.type === 'neutralWin');
    expect(win).toMatchObject({ player: 'p5', role: 'accuser', audience: ['p5'] });
    expect(d.state.players[5]?.neutralWin).toBe(true);
  });

  it('the Accuser becomes a Harlequin when its target dies at night', () => {
    const roles: RoleId[] = ['resident', 'resident', 'resident', 'resident', 'hatchet', 'accuser'];
    const d = runNight(start(pinnedGame(roles, {}, 'p0')), { p4: 'p0' });
    expect(d.state.players[5]?.role).toBe('harlequin');
    expect(d.events.find((e) => e.type === 'roleChanged')).toMatchObject({
      player: 'p5',
      from: 'accuser',
      to: 'harlequin',
      audience: ['p5'],
    });
    expect(viewFor(d.state, 'p5').you.role).toBe('harlequin');
  });

  it('a living Drifter wins alongside the Town', () => {
    let d = runNight(
      start(pinnedGame(['drifter', 'resident', 'resident', 'resident', 'hatchet'])),
      {},
    );
    d = execute(d, 'p4');
    d = step(d);
    expect(d.state.result?.winners).toEqual(['p0', 'p1', 'p2', 'p3']);
  });

  it('a dead Drifter does not win', () => {
    let d = runNight(
      start(pinnedGame(['drifter', 'resident', 'resident', 'resident', 'resident', 'hatchet'])),
      {
        p5: 'p0',
      },
    );
    expect(alive(d, 'p0')).toBe(false);
    d = execute(d, 'p5');
    d = step(d);
    expect(d.state.result?.winners).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('three quiet cycles end in a stalemate draw', () => {
    let d = start(pinnedGame(['resident', 'resident', 'resident', 'hatchet']));
    d = until(d, 'ended');
    expect(d.state.result).toMatchObject({ outcome: 'draw', reason: 'stalemate', winners: [] });
    expect(d.state.result?.day).toBe(4);
  });

  it('the day limit ends the game in a draw', () => {
    let d = start(
      pinnedGame(['resident', 'resident', 'resident', 'hatchet'], {
        maxDays: 2,
        stalemateCycles: 99,
      }),
    );
    d = until(d, 'ended');
    expect(d.state.result).toMatchObject({ outcome: 'draw', reason: 'dayLimit', day: 3 });
  });

  it('nobody alive is a draw; no threats with no Town left is a draw', () => {
    const s = pinnedGame(['drifter', 'resident', 'resident', 'hatchet']);
    for (const p of s.players) p.alive = false;
    expect(evaluateWin(s)).toMatchObject({ outcome: 'draw', reason: 'allDead' });
    const t = pinnedGame(['drifter', 'resident', 'resident', 'hatchet']);
    for (const p of t.players) p.alive = p.role === 'drifter';
    expect(evaluateWin(t)).toMatchObject({
      outcome: 'draw',
      reason: 'threatsEliminated',
      winners: ['p0'],
    });
  });

  it('a Syndicate and a Cutthroat together block each other from winning', () => {
    const s = pinnedGame(['resident', 'resident', 'resident', 'resident', 'hatchet', 'cutthroat']);
    for (const p of s.players) p.alive = p.role === 'hatchet' || p.role === 'cutthroat';
    expect(evaluateWin(s)).toBeNull();
  });

  it('the end reveals every role to everyone', () => {
    let d = runNight(
      start(pinnedGame(['resident', 'resident', 'resident', 'resident', 'hatchet'])),
      {},
    );
    d = execute(d, 'p4');
    d = step(d);
    const v = viewFor(d.state, 'p0');
    expect(v.players.map((p) => p.role)).toEqual([
      'resident',
      'resident',
      'resident',
      'resident',
      'hatchet',
    ]);
    expect(v.result?.outcome).toBe('town');
  });
});
