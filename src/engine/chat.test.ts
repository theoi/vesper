import { describe, expect, it } from 'vitest';
import { act, pinnedGame, runNight, start, tryAct, until } from './testkit.ts';
import type { GameEvent, RoleId } from './types.ts';
import { eventsFor, viewFor } from './view.ts';

const chats = (events: GameEvent[]) =>
  events.filter((e): e is Extract<GameEvent, { type: 'chat' }> => e.type === 'chat');

const ROLES7: RoleId[] = [
  'mourner',
  'resident',
  'resident',
  'resident',
  'resident',
  'hatchet',
  'lure',
];

describe('chat channels', () => {
  it('public chat is day-only for the living', () => {
    let d = until(start(pinnedGame(ROLES7)), 'discussion');
    d = act(d, 'p1', { type: 'chat', channel: 'public', text: '  hello\n  town ' });
    expect(chats(d.events)[0]).toMatchObject({ audience: 'all', from: 'p1', text: 'hello town' });
    expect(tryAct(d, 'p1', { type: 'chat', channel: 'public', text: '   ' })).toBeDefined();
    d = until(d, 'night');
    expect(tryAct(d, 'p1', { type: 'chat', channel: 'public', text: 'psst' })).toBeDefined();
  });

  it('Syndicate chat is night-only and reaches only living Syndicate members', () => {
    let d = until(start(pinnedGame(ROLES7)), 'discussion');
    expect(tryAct(d, 'p5', { type: 'chat', channel: 'mafia', text: 'plan' })).toBeDefined();
    d = until(d, 'night');
    expect(tryAct(d, 'p1', { type: 'chat', channel: 'mafia', text: 'let me in' })).toBeDefined();
    d = act(d, 'p5', { type: 'chat', channel: 'mafia', text: 'Hit Bea tonight.' });
    expect(chats(d.events).at(-1)?.audience).toEqual(['p5', 'p6']);
    expect(eventsFor(d.events, 'p1').some((e) => e.type === 'chat')).toBe(false);
  });

  it('dead chat reaches the dead, and the living Mourner only at night', () => {
    let d = until(start(pinnedGame(ROLES7)), 'night');
    d = runNight(d, { p5: 'p1' });
    d = until(d, 'discussion');
    // Day: the dead talk among themselves only.
    d = act(d, 'p1', { type: 'chat', channel: 'dead', text: 'It was dark.' });
    expect(chats(d.events).at(-1)?.audience).toEqual(['p1']);
    expect(tryAct(d, 'p0', { type: 'chat', channel: 'dead', text: 'hello?' })).toBeDefined();
    // Night: the living Mourner hears and speaks, anonymously.
    d = until(d, 'night');
    d = act(d, 'p1', { type: 'chat', channel: 'dead', text: 'Mourner, it was Fay.' });
    expect(chats(d.events).at(-1)).toMatchObject({ audience: ['p1', 'p0'], from: 'p1' });
    d = act(d, 'p0', { type: 'chat', channel: 'dead', text: 'Who killed you?' });
    const [anon, own] = chats(d.events).slice(-2);
    expect(anon).toMatchObject({ audience: ['p1'], from: null, fromLabel: 'the Mourner' });
    expect(own).toMatchObject({ audience: ['p0'], from: 'p0' });
    // No other living player ever receives dead chat.
    for (const id of ['p2', 'p3', 'p4', 'p5', 'p6']) {
      expect(
        eventsFor(d.state.log, id).some((e) => e.type === 'chat' && e.channel === 'dead'),
      ).toBe(false);
    }
  });

  it('dead players cannot speak publicly, whisper, vote, act, or edit their will', () => {
    let d = until(start(pinnedGame(ROLES7)), 'night');
    d = runNight(d, { p5: 'p1' });
    d = until(d, 'discussion');
    expect(tryAct(d, 'p1', { type: 'chat', channel: 'public', text: 'boo' })).toBeDefined();
    expect(tryAct(d, 'p1', { type: 'whisper', to: 'p2', text: 'boo' })).toBeDefined();
    expect(tryAct(d, 'p1', { type: 'will', text: 'new will' })).toBeDefined();
    expect(tryAct(d, 'p1', { type: 'ready', ready: true })).toBeDefined();
    d = until(d, 'voting');
    expect(tryAct(d, 'p1', { type: 'vote', target: 'p5' })).toBeDefined();
    d = until(d, 'night');
    const roles5: RoleId[] = ['resident', 'resident', 'resident', 'resident', 'hatchet'];
    let e = until(start(pinnedGame(roles5)), 'night');
    e = runNight(e, { p4: 'p0' });
    e = until(e, 'night');
    expect(tryAct(e, 'p0', { type: 'night', targets: ['p1'] })).toBeDefined();
    const view = viewFor(d.state, 'p1');
    expect(view.allowed).toMatchObject({
      chat: ['dead'],
      whisperTo: [],
      voteTargets: [],
      nightTargets: [],
      judge: false,
      will: false,
      ready: false,
    });
  });

  it('whispers reach only the pair, and everyone sees that one happened', () => {
    let d = until(start(pinnedGame(ROLES7)), 'discussion');
    d = act(d, 'p1', { type: 'whisper', to: 'p2', text: 'I trust you' });
    const w = chats(d.events).at(-1);
    expect(w).toMatchObject({ channel: 'whisper', to: 'p2', audience: ['p1', 'p2'] });
    expect(d.events.at(-1)).toMatchObject({
      type: 'whisperNotice',
      from: 'p1',
      to: 'p2',
      audience: 'all',
    });
    expect(tryAct(d, 'p1', { type: 'whisper', to: 'p1', text: 'me' })).toBeDefined();
  });

  it('whispers can be turned off', () => {
    const d = until(start(pinnedGame(ROLES7, { whispers: false })), 'discussion');
    expect(tryAct(d, 'p1', { type: 'whisper', to: 'p2', text: 'hi' })).toBeDefined();
  });

  it('keeps only well-formed speech acts', () => {
    let d = until(start(pinnedGame(ROLES7)), 'discussion');
    d = act(d, 'p1', {
      type: 'chat',
      channel: 'public',
      text: 'I am the Augur, Fay is suspicious',
      meta: {
        kind: 'claim',
        role: 'augur',
        results: [{ night: 1, target: 'p5', finding: 'suspicious' }],
      },
    });
    expect(chats(d.events).at(-1)?.meta).toMatchObject({ kind: 'claim', role: 'augur' });
    d = act(d, 'p2', {
      type: 'chat',
      channel: 'public',
      text: 'bad meta',
      meta: { kind: 'accuse', target: 'nobody', confidence: 1 },
    });
    expect(chats(d.events).at(-1)?.meta).toBeUndefined();
  });

  it('everyone may chat publicly after the game ends', () => {
    let d = start(pinnedGame(['resident', 'resident', 'resident', 'hatchet']));
    d = runNight(d, { p3: 'p0' });
    d = until(d, 'voting');
    d = act(d, 'p1', { type: 'vote', target: 'p2' });
    d = act(d, 'p3', { type: 'vote', target: 'p2' });
    d = until(d, 'judgment');
    d = act(d, 'p1', { type: 'judge', ballot: 'guilty' });
    d = act(d, 'p3', { type: 'judge', ballot: 'guilty' });
    d = until(d, 'ended');
    d = act(d, 'p0', { type: 'chat', channel: 'public', text: 'gg' });
    expect(chats(d.events).at(-1)).toMatchObject({ from: 'p0', audience: 'all' });
  });
});
