import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';

// Measurement harness for the WebRTC signaling pilot. Not part of CI: it
// depends on public signaling and STUN services. Run it with
//   E2E_BASE_URL=https://theoi.github.io/vesper/ npx playwright test --grep @pilot
// PILOT_TRANSPORTS (comma list), PILOT_TRIALS and PILOT_CLIENTS tune the run.

type PilotState = {
  status: string;
  errors: string[];
  signalingReadyAt: number | null;
  connectedAt: number | null;
  peers: string[];
  received: { at: number; from: string; data: { kind: string; seq?: number } }[];
};

type Trial = {
  transport: string;
  trial: number;
  ok: boolean;
  hostSignalingMs: number | null;
  clientConnectMs: (number | null)[];
  allConnectedWallMs: number | null;
  roundTripOk: boolean;
  errors: string[];
};

const transports = (
  process.env.PILOT_TRANSPORTS ?? 'peerjs,trystero-nostr,trystero-mqtt,trystero-torrent'
).split(',');
const trials = Number(process.env.PILOT_TRIALS ?? 10);
const clientCount = Number(process.env.PILOT_CLIENTS ?? 2);
const joinDelayMs = Number(process.env.PILOT_JOIN_DELAY_MS ?? 0);
const connectTimeout = 30_000;

const readState = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pilot: { state: PilotState } }).__pilot.state);

async function runTrial(browser: Browser, transport: string, n: number): Promise<Trial> {
  const room = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const url = (role: string) => `labs/net-pilot/?transport=${transport}&room=${room}&role=${role}`;
  const contexts = await Promise.all(
    Array.from({ length: clientCount + 1 }, () => browser.newContext()),
  );
  const [hostCtx, ...clientCtxs] = contexts;
  const result: Trial = {
    transport,
    trial: n,
    ok: false,
    hostSignalingMs: null,
    clientConnectMs: [],
    allConnectedWallMs: null,
    roundTripOk: false,
    errors: [],
  };
  try {
    const host = await hostCtx!.newPage();
    await host.goto(url('host'));
    await expect
      .poll(async () => (await readState(host)).signalingReadyAt, { timeout: 20_000 })
      .not.toBeNull();
    result.hostSignalingMs = (await readState(host)).signalingReadyAt;
    if (joinDelayMs > 0) await host.waitForTimeout(joinDelayMs);

    const started = Date.now();
    const clients = await Promise.all(clientCtxs.map((c) => c.newPage()));
    await Promise.all(clients.map((p) => p.goto(url('client'))));
    const deadline = started + connectTimeout;
    while (Date.now() < deadline) {
      const hs = await readState(host);
      const cs = await Promise.all(clients.map(readState));
      if (hs.peers.length >= clientCount && cs.every((s) => s.status === 'connected')) {
        result.allConnectedWallMs = Date.now() - started;
        break;
      }
      await host.waitForTimeout(100);
    }
    const cs = await Promise.all(clients.map(readState));
    result.clientConnectMs = cs.map((s) => s.connectedAt);
    if (result.allConnectedWallMs === null) {
      const hs = await readState(host);
      result.errors.push(
        `timeout: host peers=${hs.peers.length}, client status=${cs.map((s) => s.status).join('/')}`,
        ...hs.errors,
        ...cs.flatMap((s) => s.errors),
      );
      return result;
    }

    // Host -> each client targeted ping, and each client -> host ping.
    const hostPeers = (await readState(host)).peers;
    for (const [i, peerId] of hostPeers.entries()) {
      await host.evaluate(
        ([id, seq]) =>
          (
            window as unknown as { __pilot: { sendTo: (a: string, b: unknown) => void } }
          ).__pilot.sendTo(id as string, { kind: 'ping', seq }),
        [peerId, i] as const,
      );
    }
    await Promise.all(
      clients.map((p, i) =>
        p.evaluate(
          (seq) =>
            (
              window as unknown as { __pilot: { sendToHost: (b: unknown) => void } }
            ).__pilot.sendToHost({ kind: 'ping', seq }),
          100 + i,
        ),
      ),
    );
    const pongs = async () => {
      const hs = await readState(host);
      const hostPongs = hs.received.filter((m) => m.data.kind === 'pong').length;
      const clientPongs = (await Promise.all(clients.map(readState))).filter((s) =>
        s.received.some((m) => m.data.kind === 'pong'),
      ).length;
      return hostPongs >= clientCount && clientPongs === clientCount;
    };
    await expect.poll(pongs, { timeout: 10_000 }).toBe(true);
    result.roundTripOk = true;
    result.ok = true;
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message.split('\n')[0]! : String(e));
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
  return result;
}

for (const transport of transports) {
  test(`pilot ${transport} @pilot`, async ({ browser }) => {
    test.setTimeout(trials * (70_000 + joinDelayMs));
    const results: Trial[] = [];
    for (let n = 1; n <= trials; n++) {
      const r = await runTrial(browser, transport, n);
      results.push(r);
      console.log(JSON.stringify(r));
    }
    mkdirSync('test-results/pilot', { recursive: true });
    const tag = process.env.PILOT_TAG ? `-${process.env.PILOT_TAG}` : '';
    writeFileSync(`test-results/pilot/${transport}${tag}.json`, JSON.stringify(results, null, 2));
    expect(results.some((r) => r.ok)).toBe(true);
  });
}
