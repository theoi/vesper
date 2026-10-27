import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetError } from './transport.ts';

type Handler = (...args: unknown[]) => void;

class Emitter {
  private handlers = new Map<string, Handler[]>();
  on(event: string, fn: Handler): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
    return this;
  }
  emit(event: string, ...args: unknown[]): void {
    for (const fn of this.handlers.get(event) ?? []) fn(...args);
  }
}

class FakeConnection extends Emitter {
  peerConnection: { remoteDescription: object | null } = { remoteDescription: null };
  open = false;
  close(): void {}
}

const fake = vi.hoisted(() => ({ answered: false }));

vi.mock('peerjs', () => ({
  Peer: class extends Emitter {
    constructor() {
      super();
      setTimeout(() => this.emit('open', 'me'), 10);
    }
    connect() {
      const conn = new FakeConnection();
      if (fake.answered) conn.peerConnection.remoteDescription = { type: 'answer' };
      return conn;
    }
    disconnect() {}
    destroy() {}
  },
}));

const { peerJsTransport } = await import('./peerjs.ts');

async function failure(): Promise<NetError> {
  const client = peerJsTransport.client('KX7QM');
  const result = client.connect().then(
    () => null,
    (e: unknown) => e,
  );
  await vi.advanceTimersByTimeAsync(60_000);
  const err = await result;
  if (!(err instanceof NetError)) throw new Error(`expected a NetError, got ${String(err)}`);
  return err;
}

describe('PeerJS client', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('RTCPeerConnection', class {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    fake.answered = false;
  });

  it('reports a missing room when the server and the host both stay silent', async () => {
    expect((await failure()).code).toBe('roomNotFound');
  });

  it('reports a failed connection when the host answered but nothing connected', async () => {
    fake.answered = true;
    expect((await failure()).code).toBe('connectFailed');
  });
});
