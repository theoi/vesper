import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { viewFor, type GameEvent, type PlayerView } from '../engine/index.ts';
import { auditClientMessages } from '../../tests/support/leak-audit.ts';
import { ClientSession } from './client.ts';
import { HostSession, parseHostSave, type HostSave } from './host.ts';
import { randomId } from './identity.ts';
import { createMemoryNetwork, type MemoryNetwork } from './memory.ts';
import { parseClientMessage, type HostMessage } from './protocol.ts';
import { normalizeCode, randomCode, roomFromUrl, roomLink } from './room.ts';
import { ViewChannel, mergeView } from './session.ts';
import { NetError } from './transport.ts';

const flush = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

async function openHost(net: MemoryNetwork, code = 'ABCDE') {
  const host = new HostSession({ hostName: 'Hana', transport: net, code });
  await host.open();
  return host;
}

async function join(net: MemoryNetwork, name: string, token = randomId(), code = 'ABCDE') {
  const received: HostMessage[] = [];
  const client = new ClientSession({
    code,
    name,
    transport: net,
    token,
    onReceive: (m) => received.push(m),
  });
  const joining = client.join();
  await flush(10);
  await joining;
  return { client, received, token };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('room codes', () => {
  it('generates readable codes that survive normalization', () => {
    for (let i = 0; i < 50; i++) {
      const code = randomCode();
      expect(code).toMatch(/^[A-HJKMNP-Z2-9]{5}$/);
      expect(normalizeCode(code.toLowerCase())).toBe(code);
    }
    expect(normalizeCode('ab-c d2')).toBe('ABCD2');
    expect(normalizeCode('ABC0O')).toBeNull();
    expect(normalizeCode('ABCD')).toBeNull();
  });

  it('builds and parses share links', () => {
    const link = roomLink('KX7QM', 'https://theoi.github.io/vesper/?x=1#y');
    expect(link).toBe('https://theoi.github.io/vesper/?room=KX7QM');
    expect(roomFromUrl(link)).toBe('KX7QM');
    expect(roomFromUrl('https://theoi.github.io/vesper/#room=kx7qm')).toBe('KX7QM');
    expect(roomFromUrl('https://theoi.github.io/vesper/')).toBeNull();
  });
});

describe('parseClientMessage', () => {
  it('rejects malformed input', () => {
    expect(parseClientMessage(null)).toBeNull();
    expect(parseClientMessage({ t: 'hello', v: 1, token: 'short', name: 'x' })).toBeNull();
    expect(parseClientMessage({ t: 'intent', id: 1, intent: 'vote' })).toBeNull();
    expect(parseClientMessage({ t: 'nope' })).toBeNull();
    expect(parseClientMessage({ t: 'ping', at: 5 })).toEqual({ t: 'ping', at: 5 });
  });
});

describe('lobby', () => {
  it('seats joining players with unique names and shows them to everyone', async () => {
    const net = createMemoryNetwork();
    const host = await openHost(net);
    expect(host.snapshot().network).toEqual({ state: 'open' });
    const a = await join(net, 'Hana');
    const b = await join(net, '  Wren  ');
    const names = host.snapshot().lobby?.seats.map((s) => s.name);
    expect(names).toEqual(['Hana', 'Hana 2', 'Wren']);
    expect(b.client.snapshot().status).toBe('lobby');
    expect(b.client.snapshot().lobby?.seats.map((s) => s.name)).toEqual(names);
    expect(a.client.snapshot().you).toBe(host.snapshot().lobby?.seats[1]?.id);
  });

  it('lets the host add and remove bots and change settings', async () => {
    const net = createMemoryNetwork();
    const host = await openHost(net);
    const a = await join(net, 'Ari');
    host.fillWithBots(7);
    host.updateSettings({ pace: 'fast' });
    await flush(10);
    const lobby = a.client.snapshot().lobby;
    expect(lobby?.seats).toHaveLength(7);
    expect(lobby?.seats.filter((s) => s.kind === 'bot')).toHaveLength(5);
    expect(lobby?.settings.pace).toBe('fast');
    expect(lobby?.roles).toHaveLength(7);
    expect(lobby?.validation.ok).toBe(true);
    const bot = lobby?.seats.find((s) => s.kind === 'bot');
    host.removeSeat(bot!.id);
    await flush(10);
    expect(a.client.snapshot().lobby?.seats).toHaveLength(6);
  });

  it('removes a kicked player and refuses their return', async () => {
    const net = createMemoryNetwork();
    const host = await openHost(net);
    const a = await join(net, 'Ari');
    host.removeSeat(a.client.snapshot().you!);
    await flush(500);
    expect(a.client.snapshot().status).toBe('closed');
    expect(a.client.snapshot().notice?.code).toBe('kicked');
    const again = await join(net, 'Ari', a.token);
    expect(again.client.snapshot().status).toBe('error');
    expect(again.client.snapshot().notice?.code).toBe('kicked');
  });

  it('gives a late friend the last bot seat when the table is full', async () => {
    const net = createMemoryNetwork();
    const host = await openHost(net);
    host.fillWithBots(16);
    const a = await join(net, 'Ari');
    const seats = host.snapshot().lobby!.seats;
    expect(seats).toHaveLength(16);
    expect(seats.at(-1)?.name).toBe('Ari');
    expect(a.client.snapshot().status).toBe('lobby');
  });

  it('rejects a mismatched protocol version and joins after the game started', async () => {
    const net = createMemoryNetwork();
    const host = await openHost(net);
    host.fillWithBots(7);
    expect(host.start()).toBeNull();
    const late = await join(net, 'Late');
    expect(late.client.snapshot().status).toBe('error');
    expect(late.client.snapshot().notice?.code).toBe('started');
  });

  it('reports a missing room and a failed signaling service', async () => {
    const net = createMemoryNetwork();
    const nobody = await join(net, 'Ari', randomId(), 'ZZZZZ');
    expect(nobody.client.snapshot().status).toBe('error');
    expect(nobody.client.snapshot().notice?.code).toBe('roomNotFound');
    expect(nobody.client.snapshot().notice?.message).toMatch(/No game is open/);

    await openHost(net);
    net.failNext(new NetError('signaling'));
    const blocked = await join(net, 'Bo');
    expect(blocked.client.snapshot().notice?.code).toBe('signaling');
  });

  it('picks a new code if the first one is taken', async () => {
    const net = createMemoryNetwork();
    await openHost(net, 'ABCDE');
    const second = await openHost(net, 'ABCDE');
    expect(second.snapshot().network.state).toBe('open');
    expect(second.code).not.toBe('ABCDE');
    expect(second.snapshot().code).toBe(second.code);
  });

  it('plays offline without a transport', async () => {
    const host = new HostSession({ hostName: 'Solo', transport: null });
    expect(await host.open()).toEqual({ state: 'offline' });
    host.fillWithBots(7);
    expect(host.start()).toBeNull();
    expect(host.snapshot().status).toBe('playing');
    expect(host.snapshot().view?.you.id).toBe(host.hostId);
    host.leave();
  });
});

describe('game sessions', () => {
  it('sends each client only its own view, relays intents, and passes the leak audit', async () => {
    const net = createMemoryNetwork();
    const host = await openHost(net);
    const a = await join(net, 'Ari');
    const b = await join(net, 'Bo');
    host.fillWithBots(8);
    host.updateSettings({ pace: 'fast' });
    expect(host.start()).toBeNull();
    await flush(10);

    for (const c of [a, b]) {
      const snap = c.client.snapshot();
      expect(snap.status).toBe('playing');
      expect(snap.view?.you.id).toBe(snap.you);
      const assigned = snap.view?.events.filter((e) => e.type === 'roleAssigned') ?? [];
      expect(assigned).toHaveLength(1);
      expect(assigned[0]).toMatchObject({ player: snap.you });
    }

    // Reveal ends, then Day 1 discussion: a public line reaches the host and the other client.
    await flush(5000);
    expect(a.client.snapshot().view?.phase.kind).toBe('discussion');
    a.client.sendIntent({ type: 'chat', channel: 'public', text: 'Good evening, all.' });
    await flush(20);
    const said = (s: ReturnType<typeof host.snapshot>) =>
      s.view?.events.some((e) => e.type === 'chat' && e.text === 'Good evening, all.');
    expect(said(host.snapshot())).toBe(true);
    expect(said(b.client.snapshot())).toBe(true);

    // An illegal intent comes back as a rejection.
    const id = b.client.sendIntent({ type: 'vote', target: a.client.snapshot().you });
    await flush(20);
    expect(b.client.snapshot().lastRejection).toMatchObject({ id });

    // Will edits emit no event but still reach the writer's view.
    a.client.sendIntent({ type: 'will', text: 'I was home all night.' });
    await flush(20);
    expect(a.client.snapshot().view?.you.will).toBe('I was home all night.');

    // Run the game out (idle players and stub bots end in a stalemate or a win).
    for (let i = 0; i < 120 && host.snapshot().status !== 'ended'; i++) await flush(10_000);
    expect(host.snapshot().status).toBe('ended');
    expect(a.client.snapshot().status).toBe('ended');
    expect(a.client.snapshot().view?.result).not.toBeNull();

    const { game, tokens } = host.debugState();
    for (const c of [a, b]) {
      const problems = auditClientMessages({
        playerId: c.client.snapshot().you!,
        messages: c.received,
        hostLog: game!.log,
        tokens,
      });
      expect(problems).toEqual([]);
      // Client event history equals what the engine says this player may see.
      const views = c.received.filter((m) => m.t === 'view');
      expect(views.length).toBeGreaterThan(0);
    }
  });

  it('lets a dropped player rejoin the same seat with the same token', async () => {
    const net = createMemoryNetwork();
    const host = await openHost(net);
    const a = await join(net, 'Ari');
    host.fillWithBots(7);
    expect(host.start()).toBeNull();
    await flush(10);
    const seat = a.client.snapshot().you;
    const role = a.client.snapshot().view?.you.role;
    a.client.leave();
    await flush(200);
    expect(host.snapshot().lobby?.seats.find((s) => s.id === seat)?.connected).toBe(false);

    const back = await join(net, 'Ari again', a.token);
    expect(back.client.snapshot().you).toBe(seat);
    expect(back.client.snapshot().status).toBe('playing');
    expect(back.client.snapshot().view?.you.role).toBe(role);
    expect(back.received.find((m) => m.t === 'view')).toMatchObject({ full: true });
    expect(host.snapshot().lobby?.seats.find((s) => s.id === seat)?.connected).toBe(true);
  });

  it('reconnects on its own after a network drop', async () => {
    const net = createMemoryNetwork();
    const host = await openHost(net);
    const a = await join(net, 'Ari');
    host.fillWithBots(7);
    host.start();
    await flush(10);
    const transport = (a.client as unknown as { transport: Parameters<typeof net.cut>[0] })
      .transport;
    net.cut(transport);
    await flush(0);
    expect(a.client.snapshot().status).toBe('reconnecting');
    await flush(2000);
    expect(a.client.snapshot().status).toBe('playing');
    expect(a.client.snapshot().view?.you.id).toBe(a.client.snapshot().you);
  });

  it('replaces an older tab when the same player connects again', async () => {
    const net = createMemoryNetwork();
    await openHost(net);
    const first = await join(net, 'Ari');
    const second = await join(net, 'Ari', first.token);
    await flush(500);
    expect(second.client.snapshot().you).toBe(first.client.snapshot().you);
    expect(first.client.snapshot().status).toBe('closed');
    expect(first.client.snapshot().notice?.code).toBe('replaced');
  });

  it('tells clients the game ended when the host leaves', async () => {
    const net = createMemoryNetwork();
    const host = await openHost(net);
    const a = await join(net, 'Ari');
    host.leave();
    await flush(500);
    expect(a.client.snapshot().status).toBe('closed');
    expect(a.client.snapshot().notice?.message).toBe('The host left, so the game has ended.');
  });

  it('detects a host that vanished without saying goodbye', async () => {
    const net = createMemoryNetwork();
    const host = await openHost(net);
    const a = await join(net, 'Ari');
    // Simulate the host tab dying: the room disappears and the channel goes silent.
    (host as unknown as { transport: { close(): void } }).transport.close();
    await flush(40_000);
    expect(a.client.snapshot().status).toBe('closed');
    expect(a.client.snapshot().notice?.code).toBe('hostLeft');
  });

  it('rate-limits a flooding client', async () => {
    const net = createMemoryNetwork();
    const host = await openHost(net);
    const a = await join(net, 'Ari');
    host.fillWithBots(7);
    host.updateSettings({ pace: 'fast' });
    host.start();
    await flush(5000);
    for (let i = 0; i < 30; i++) {
      a.client.sendIntent({ type: 'chat', channel: 'public', text: `spam ${i}` });
    }
    await flush(20);
    const lines = host.snapshot().view?.events.filter((e) => e.type === 'chat') ?? [];
    expect(lines.length).toBeLessThan(20);
    expect(a.client.snapshot().lastRejection?.error).toMatch(/Slow down/);
  });
});

describe('rematch', () => {
  const runOut = async (host: HostSession) => {
    for (let i = 0; i < 200 && host.snapshot().status !== 'ended'; i++) await flush(10_000);
    expect(host.snapshot().status).toBe('ended');
  };

  it('plays a second game in the same room with the same friends, bots, and settings', async () => {
    const net = createMemoryNetwork();
    const host = await openHost(net);
    const a = await join(net, 'Ari');
    const b = await join(net, 'Bo');
    host.fillWithBots(8);
    host.updateSettings({ pace: 'fast' });
    const seats1 = host.snapshot().lobby!.seats;
    expect(host.start()).toBeNull();
    expect(host.snapshot().lobby?.round).toBe(1);
    await flush(5000);
    // Bo leaves partway through the first game.
    const boSeat = b.client.snapshot().you;
    b.client.leave();
    await runOut(host);
    const game1 = host.debugState();
    const aGame1 = a.received.length;
    expect(a.client.snapshot().view?.result).not.toBeNull();

    host.backToLobby();
    await flush(20);
    expect(host.snapshot().status).toBe('lobby');
    expect(host.snapshot().view).toBeNull();
    const lobby = a.client.snapshot().lobby!;
    expect(a.client.snapshot().status).toBe('lobby');
    expect(a.client.snapshot().view).toBeNull();
    expect(lobby.status).toBe('open');
    expect(lobby.round).toBe(1);
    expect(lobby.settings.pace).toBe('fast');
    // Everyone who stayed keeps their seat; Bo's empty seat is gone.
    expect(lobby.seats.map((s) => s.id)).toEqual(
      seats1.filter((s) => s.id !== boSeat).map((s) => s.id),
    );

    // Bo can come back while the lobby is open, in a new seat.
    const bo2 = await join(net, 'Bo', b.token);
    expect(bo2.client.snapshot().status).toBe('lobby');
    expect(bo2.client.snapshot().you).not.toBe(boSeat);
    expect(host.snapshot().lobby?.seats).toHaveLength(seats1.length);

    expect(host.start()).toBeNull();
    await flush(20);
    expect(host.snapshot().lobby?.round).toBe(2);
    const game2Start = host.debugState().game!;
    expect(game2Start.phase.day).toBeLessThanOrEqual(1);
    expect(game2Start.log.some((e) => e.type === 'gameOver')).toBe(false);
    for (const c of [a, bo2]) {
      const snap = c.client.snapshot();
      expect(snap.status).toBe('playing');
      expect(snap.view?.result).toBeNull();
      const assigned = snap.view?.events.filter((e) => e.type === 'roleAssigned') ?? [];
      expect(assigned).toHaveLength(1);
      expect(assigned[0]).toMatchObject({ player: snap.you });
      // A fresh event stream, numbered from the start again.
      expect(snap.view?.events[0]?.seq).toBe(1);
    }

    await runOut(host);
    expect(a.client.snapshot().view?.result).not.toBeNull();
    const game2 = host.debugState();
    const audits = [
      { playerId: a.client.snapshot().you!, messages: a.received.slice(0, aGame1), state: game1 },
      { playerId: a.client.snapshot().you!, messages: a.received.slice(aGame1), state: game2 },
      { playerId: bo2.client.snapshot().you!, messages: bo2.received, state: game2 },
    ];
    for (const { playerId, messages, state } of audits) {
      expect(messages.filter((m) => m.t === 'view').length).toBeGreaterThan(0);
      const problems = auditClientMessages({
        playerId,
        messages,
        hostLog: state.game!.log,
        tokens: state.tokens,
      });
      expect(problems).toEqual([]);
    }
  });

  it('never shows the last game to a friend whose connection missed the return to the lobby', async () => {
    const net = createMemoryNetwork();
    const host = await openHost(net);
    const a = await join(net, 'Ari');
    host.fillWithBots(7);
    host.updateSettings({ pace: 'fast' });
    expect(host.start()).toBeNull();
    await runOut(host);
    await flush(20);
    const seat = a.client.snapshot().you;
    const stale: string[] = [];
    a.client.subscribe((s) => {
      if (s.lobby?.round === 2 && s.view?.result) stale.push(s.status);
    });

    // The lobby message is lost with the connection, and the next game starts
    // before Ari is back.
    host.backToLobby();
    const transport = (a.client as unknown as { transport: Parameters<typeof net.cut>[0] })
      .transport;
    net.cut(transport);
    expect(host.start()).toBeNull();
    await flush(0);
    expect(a.client.snapshot().status).toBe('reconnecting');
    await flush(3000);

    const snap = a.client.snapshot();
    expect(snap.status).toBe('playing');
    expect(snap.you).toBe(seat);
    expect(snap.lobby?.round).toBe(2);
    expect(snap.view?.result).toBeNull();
    expect(snap.view?.events.filter((e) => e.type === 'roleAssigned')).toHaveLength(1);
    expect(stale).toEqual([]);
  });
});
describe('host resume', () => {
  const roundTrip = (save: HostSave): HostSave => JSON.parse(JSON.stringify(save)) as HostSave;

  it('picks a saved game back up from JSON exactly where it left off', async () => {
    const host = new HostSession({ hostName: 'Solo', transport: null, code: 'ABCDE' });
    await host.open();
    host.fillWithBots(9);
    host.updateSettings({ pace: 'fast' });
    expect(host.start()).toBeNull();
    await flush(20_000);
    expect(host.botLines().length).toBeGreaterThan(0);

    const saved = parseHostSave(roundTrip(host.save()));
    expect(saved).not.toBeNull();
    const resumed = new HostSession({ hostName: 'Other', transport: null, resume: saved! });
    expect(resumed.code).toBe('ABCDE');
    expect(resumed.hostId).toBe(host.hostId);
    expect(resumed.snapshot().status).toBe('playing');
    expect(resumed.snapshot().view?.you.role).toBe(host.snapshot().view?.you.role);

    // Run the original and the resumed copy side by side: bots, timers, and
    // the engine must carry on identically.
    for (let i = 0; i < 200 && host.snapshot().status !== 'ended'; i++) await flush(10_000);
    expect(host.snapshot().status).toBe('ended');
    expect(resumed.snapshot().status).toBe('ended');
    expect(resumed.debugState().game).toEqual(host.debugState().game);
    expect(resumed.snapshot().view).toEqual(host.snapshot().view);
    expect(resumed.botLines()).toEqual(host.botLines());
  });

  it('brings friends back to their seats after the host page reloads', async () => {
    const net = createMemoryNetwork();
    const host = await openHost(net);
    const a = await join(net, 'Ari');
    host.fillWithBots(7);
    host.updateSettings({ pace: 'fast' });
    expect(host.start()).toBeNull();
    await flush(5000);
    const seat = a.client.snapshot().you;
    const role = a.client.snapshot().view?.you.role;

    const saved = roundTrip(host.save());
    host.suspend();
    await flush(1000);
    expect(a.client.snapshot().status).toBe('reconnecting');

    const back = new HostSession({ hostName: 'Hana', transport: net, resume: saved });
    expect(await back.open()).toEqual({ state: 'open' });
    expect(back.code).toBe('ABCDE');
    await flush(3000);
    expect(a.client.snapshot().status).toBe('playing');
    expect(a.client.snapshot().you).toBe(seat);
    expect(a.client.snapshot().view?.you.role).toBe(role);
    expect(back.snapshot().lobby?.seats.find((s) => s.id === seat)?.connected).toBe(true);

    a.client.sendIntent({ type: 'will', text: 'Back again.' });
    await flush(20);
    expect(a.client.snapshot().view?.you.will).toBe('Back again.');
    expect(a.received.some((m) => m.t === 'closed')).toBe(false);
  });

  it('waits for the old room id to be released instead of changing the code', async () => {
    const net = createMemoryNetwork();
    const host = await openHost(net);
    const back = new HostSession({
      hostName: 'Hana',
      transport: net,
      resume: roundTrip(host.save()),
    });
    const opening = back.open();
    await flush(100);
    expect(back.snapshot().network.state).toBe('opening');
    host.suspend();
    await flush(5000);
    expect(await opening).toEqual({ state: 'open' });
    expect(back.code).toBe('ABCDE');
  });

  it('rejects saves from another version', () => {
    const save = new HostSession({ hostName: 'Hana', transport: null }).save();
    expect(parseHostSave(roundTrip(save))).not.toBeNull();
    expect(parseHostSave({ ...save, v: 2 })).toBeNull();
    expect(parseHostSave({ ...save, protocol: 0 })).toBeNull();
    expect(parseHostSave({ ...save, status: 'playing' })).toBeNull();
    expect(parseHostSave('nope')).toBeNull();
  });
});

describe('view patches', () => {
  it('rebuilds exactly the full view from patches that carry only what changed', async () => {
    const host = new HostSession({ hostName: 'Solo', transport: null });
    await host.open();
    host.fillWithBots(12);
    host.updateSettings({ pace: 'fast' });
    expect(host.start()).toBeNull();
    const ids = host.debugState().game!.players.map((p) => p.id);
    const channels = ids.map((id) => new ViewChannel(id));
    const views = new Map<string, PlayerView | null>();
    const noSeq = (events: readonly GameEvent[]) => events.map(({ seq: _seq, ...e }) => e);
    let patches = 0;
    let patchBytes = 0;
    let wholeBytes = 0;
    let quiet = 0;
    for (let i = 0; i < 1200 && host.snapshot().status !== 'ended'; i++) {
      await flush(1000);
      const game = host.debugState().game!;
      channels.forEach((ch, k) => {
        const id = ids[k]!;
        const update = ch.next(game);
        if (!update) {
          quiet++;
          return;
        }
        const merged = mergeView(views.get(id) ?? null, update);
        views.set(id, merged);
        const { events, lastSeq: _a, ...fields } = merged!;
        const { events: allEvents, lastSeq: _b, ...want } = viewFor(game, id);
        expect(fields).toEqual(want);
        expect(noSeq(events)).toEqual(noSeq(allEvents));
        if (!update.full) {
          patches++;
          patchBytes += JSON.stringify(update.view).length;
          wholeBytes += JSON.stringify({ ...want, events: update.view.events }).length;
        }
      });
    }
    expect(host.snapshot().status).toBe('ended');
    expect(patches).toBeGreaterThan(100);
    expect(quiet).toBeGreaterThan(0);
    // Seats, the role list, and timers rarely change, so patches stay small.
    expect(patchBytes).toBeLessThan(wholeBytes / 3);
  });
});
