// Hidden-tab check for the host loop, driven over raw CDP because Playwright
// keeps every tab "visible". Launches Playwright's Chromium with intensive
// timer throttling after GRACE seconds, starts a game, opens a second tab so
// the host tab is hidden, waits HIDDEN_MS, then reports how late phase changes
// were. With ONLINE=1 the host opens a room and the second tab joins it as a
// friend, so the friend stays visible while the host is hidden.
//
//   npm run build && npx vite preview --port 4173 &
//   BASE=http://localhost:4173/vesper/ HIDDEN_MS=240000 xvfb-run -a node tests/e2e/manual/hidden-host.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE ?? 'https://theoi.github.io/vesper/';
const HIDDEN_MS = Number(process.env.HIDDEN_MS ?? 180000);
const GRACE = process.env.GRACE ?? '10';
const ONLINE = process.env.ONLINE === '1';
const PORT = 9333 + Math.floor(Math.random() * 500);
const pwDir = join(homedir(), '.cache/ms-playwright');
const chromeDir = readdirSync(pwDir).find((d) => /^chromium-\d+$/.test(d));
const exe = join(pwDir, chromeDir, 'chrome-linux64/chrome');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(
  exe,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'vsp-cdp-'))}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--enable-features=IntensiveWakeUpThrottling:grace_period_seconds/${GRACE}`,
    BASE,
  ],
  { stdio: 'ignore' },
);

async function attach(match) {
  for (let i = 0; i < 60; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const t = targets.find((x) => x.type === 'page' && match(x.url));
      if (t) {
        const ws = new WebSocket(t.webSocketDebuggerUrl);
        await new Promise((r) => ws.addEventListener('open', r, { once: true }));
        let id = 1;
        const pending = new Map();
        ws.addEventListener('message', (e) => {
          const m = JSON.parse(e.data);
          if (m.id && pending.has(m.id)) {
            pending.get(m.id)(m);
            pending.delete(m.id);
          }
        });
        const evaluate = (expression) =>
          new Promise((r) => {
            const n = id++;
            pending.set(n, (m) => r(m.result?.result?.value));
            ws.send(
              JSON.stringify({
                id: n,
                method: 'Runtime.evaluate',
                params: { expression, awaitPromise: true, returnByValue: true },
              }),
            );
          });
        for (let j = 0; j < 50 && !(await evaluate('!!window.__vesper')); j++) await sleep(200);
        return { ws, evaluate };
      }
    } catch {
      // Chrome is still starting.
    }
    await sleep(300);
  }
  throw new Error('page not found');
}

const host = await attach((u) => u.startsWith(BASE) && !u.includes('room='));
const code = await host.evaluate(`(async () => {
  const c = window.__vesper;
  await c.hostRoom('Hana', { online: ${ONLINE}, seats: ${ONLINE ? 0 : 7} });
  ${ONLINE ? "for (let i = 0; i < 100 && c.getState().session.network.state !== 'open'; i++) await new Promise((r) => setTimeout(r, 200));" : ''}
  return c.getState().session.code;
})()`);
let friend = null;
if (ONLINE) {
  await fetch(`http://127.0.0.1:${PORT}/json/new?${BASE}?room=${code}`, { method: 'PUT' });
  friend = await attach((u) => u.includes(`room=${code}`));
  await friend.evaluate(`(async () => {
    window.__statuses = [];
    window.__vesper.subscribe((s) => { const st = s.session?.status; if (st && window.__statuses.at(-1) !== st) window.__statuses.push(st); });
    if (!window.__vesper.getState().session) await window.__vesper.joinRoom('${code}', 'Ari');
    for (let i = 0; i < 100 && window.__vesper.getState().session?.status !== 'lobby'; i++) await new Promise((r) => setTimeout(r, 200));
  })()`);
}
await host.evaluate(`(() => {
  const c = window.__vesper;
  ${ONLINE ? 'c.fillWithBots(7);' : ''}
  c.updateSettings({ pace: 'fast' });
  c.start();
  window.__ticks = [];
  const loop = () => { window.__ticks.push(Date.now()); setTimeout(loop, 1000); };
  loop();
})()`);
if (!ONLINE) await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
await sleep(1500);
const visibility = await host.evaluate('document.visibilityState');
const t0 = Date.now();
await sleep(HIDDEN_MS);
const data = await host.evaluate(`(() => {
  const since = ${t0};
  const v = window.__vesper.getState().session.view;
  const phases = v.events.filter((e) => e.type === 'phase');
  const late = [];
  for (let i = 1; i < phases.length; i++) {
    const prev = phases[i - 1];
    if (prev.endsAt && phases[i].at >= since) late.push(phases[i].at - prev.endsAt);
  }
  const ticks = window.__ticks.filter((t) => t >= since);
  const gaps = ticks.slice(1).map((t, i) => t - ticks[i]);
  return {
    late,
    at: v.phase.kind + ' day ' + v.phase.day,
    maxGap: Math.max(...gaps),
    botLines: window.__vesper.botTranscript().filter((l) => l.at >= since).length,
    friendSeat: window.__vesper.getState().session.lobby.seats.find((s) => s.kind === 'human') ?? null,
  };
})()`);
const friendInfo = friend
  ? await friend.evaluate(
      '({ status: window.__vesper.getState().session?.status, statuses: window.__statuses, visibility: document.visibilityState })',
    )
  : null;
const late = data.late.slice().sort((a, b) => a - b);
console.log(
  JSON.stringify({
    base: BASE,
    online: ONLINE,
    hostVisibility: visibility,
    hiddenSec: HIDDEN_MS / 1000,
    graceSec: Number(GRACE),
    phaseChangesWhileHidden: late.length,
    maxLateMs: late.at(-1) ?? null,
    medianLateMs: late[Math.floor(late.length / 2)] ?? null,
    pageTimerMaxGapMs: data.maxGap,
    botLinesWhileHidden: data.botLines,
    endedAt: data.at,
    friendSeatConnected: data.friendSeat?.connected ?? null,
    friend: friendInfo,
  }),
);
host.ws.close();
friend?.ws.close();
proc.kill();
process.exit(0);
