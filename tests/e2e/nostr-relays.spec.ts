import { expect, test } from '@playwright/test';
import { createEvent, subscribe } from 'trystero';
import { NOSTR_RELAYS } from '../../src/net/trystero.ts';

// Checks that each pinned Nostr relay still does what Trystero's signaling
// needs: accept ephemeral events (kinds 20000-29999) from a fresh key, deliver
// them to a subscriber, and take a short burst without rate limits. Runs from
// Node, like a browser would over WebSocket. Swap out a relay that fails here.
//   npx playwright test --grep @online nostr-relays
// Against the deployed site this needs no server, but Playwright still wants a
// base URL: E2E_BASE_URL=https://theoi.github.io/vesper/ skips the local build.

const BURST = 20;
const CONNECT_MS = 8000;
const SETTLE_MS = 5000;

interface Result {
  relay: string;
  accepted: number;
  delivered: number;
  rejections: string[];
  error?: string;
}

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('connect timeout'));
    }, CONNECT_MS);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve(ws);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('connection failed'));
    };
  });
}

const parse = (data: unknown): unknown[] => {
  const msg: unknown = JSON.parse(String(data));
  return Array.isArray(msg) ? msg : [];
};

async function probe(relay: string): Promise<Result> {
  const result: Result = { relay, accepted: 0, delivered: 0, rejections: [] };
  const sockets: WebSocket[] = [];
  try {
    const [sub, pub] = await Promise.all([open(relay), open(relay)]);
    sockets.push(sub, pub);
    const topic = `vesper-relay-check-${Math.random().toString(36).slice(2)}`;
    await new Promise<void>((resolve) => {
      sub.onmessage = (m) => {
        const [type] = parse(m.data);
        if (type === 'EOSE') resolve();
        else if (type === 'EVENT') result.delivered++;
        else if (type === 'CLOSED') result.rejections.push(`subscription closed`);
      };
      sub.send(subscribe(Math.random().toString(36).slice(2, 12), topic));
      setTimeout(resolve, 3000);
    });
    pub.onmessage = (m) => {
      const [type, , ok, reason] = parse(m.data);
      if (type === 'OK' && ok === true) result.accepted++;
      else if (type === 'OK' || type === 'NOTICE') result.rejections.push(String(reason ?? ok));
    };
    for (let i = 0; i < BURST; i++) {
      pub.send(await createEvent(topic, JSON.stringify({ i })));
      await new Promise((r) => setTimeout(r, 50));
    }
    await new Promise((r) => setTimeout(r, SETTLE_MS));
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  } finally {
    sockets.forEach((ws) => ws.close());
  }
  return result;
}

test('the pinned Nostr relays carry Trystero signaling @online', async () => {
  test.setTimeout(60_000);
  const results = await Promise.all(NOSTR_RELAYS.map(probe));
  const healthy = results.filter((r) => !r.error && r.accepted === BURST && r.delivered === BURST);
  const report = results.map((r) => ({
    ...r,
    rejections: [...new Set(r.rejections)].slice(0, 3),
  }));
  console.log(
    `E2E-NOSTR ${JSON.stringify({ healthy: healthy.length, of: results.length, report })}`,
  );
  // One relay having a bad day is fine (rooms need only one in common);
  // more than that and the list needs updating.
  expect(healthy.length, JSON.stringify(report, null, 1)).toBeGreaterThanOrEqual(
    NOSTR_RELAYS.length - 1,
  );
});
