import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientSession } from './client.ts';
import { fallbackTransport } from './fallback.ts';
import { HostSession } from './host.ts';
import { randomId } from './identity.ts';
import { createMemoryNetwork } from './memory.ts';
import { NetError } from './transport.ts';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('fallbackTransport', () => {
  it('joins over the second transport when the first signaling service is down', async () => {
    const primary = createMemoryNetwork();
    const secondary = createMemoryNetwork();
    const net = fallbackTransport([primary, secondary]);
    const host = new HostSession({ hostName: 'Hana', transport: net, code: 'ABCDE' });
    await host.open();
    primary.failNext(new NetError('signaling'));
    const client = new ClientSession({
      code: 'ABCDE',
      name: 'Ari',
      transport: net,
      token: randomId(),
    });
    const joining = client.join();
    await vi.advanceTimersByTimeAsync(20);
    await joining;
    expect(client.snapshot().status).toBe('lobby');
    host.rename('Hana B');
    await vi.advanceTimersByTimeAsync(20);
    expect(client.snapshot().lobby?.seats[0]?.name).toBe('Hana B');
  });

  it('reports the first transport error when every transport fails', async () => {
    const net = fallbackTransport([createMemoryNetwork(), createMemoryNetwork()]);
    const client = new ClientSession({
      code: 'QQQQQ',
      name: 'Ari',
      transport: net,
      token: randomId(),
    });
    const joining = client.join();
    await vi.advanceTimersByTimeAsync(20);
    await joining;
    expect(client.snapshot().status).toBe('error');
    expect(client.snapshot().notice?.code).toBe('roomNotFound');
  });

  it('keeps the room open when only one transport can open it', async () => {
    const taken = createMemoryNetwork();
    await taken.host('ABCDE').open();
    const free = createMemoryNetwork();
    const t = fallbackTransport([taken, free]).host('ABCDE');
    await expect(t.open()).resolves.toBeUndefined();
  });
});
