import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type CDPSession } from '@playwright/test';
import type { GameEvent, PlayerId, RoleSlot } from '../../src/engine/index.ts';
import type { HostMessage } from '../../src/net/index.ts';
import { auditClientMessages } from '../support/leak-audit.ts';
import {
  allGameSecrets,
  closeAll,
  hostRoom,
  hostSecrets,
  joinRoom,
  keepFinishedGames,
  messagesByGame,
  openPlayer,
  snapshot,
  you,
  type Player,
} from './support/harness.ts';

// A full table over real WebRTC: the host and 7 friends (8 people) plus 8 bots.
// Every person runs an autopilot that chats on every channel it may use
// (public, Syndicate, dead, the Mourner at night), whispers, votes, judges,
// and acts at night. The host deals again until a friend has received every
// kind of private message (or BIGTABLE_GAMES games), then every friend's
// messages are audited against the host's log, game by game. Also measures
// the host's message rate, bandwidth, CPU, and view-update latency.
//   E2E_BASE_URL=https://theoi.github.io/vesper/ npx playwright test --grep @bigtable

const NAMES = ['Hana', 'Ari', 'Bo', 'Cyd', 'Dee', 'Eli', 'Fen', 'Gus'];
const SEATS = 16;
// Three Mourners and four Syndicate make it likely that friends hold the
// roles behind every private channel.
const ROLES: RoleSlot[] = [
  'augur',
  'lamplighter',
  'mender',
  'sentinel',
  'reckoner',
  'muse',
  'magistrate',
  'mourner',
  'mourner',
  'mourner',
  'patron',
  'hatchet',
  'slanderer',
  'lure',
  'cutthroat',
  'harlequin',
];
const MAX_GAMES = Number(process.env.BIGTABLE_GAMES ?? 3);

/** Private channels a friend must have received at least once. */
const CHANNELS = {
  roleAssigned: (e: GameEvent) => e.type === 'roleAssigned',
  syndicateChat: (e: GameEvent) => e.type === 'chat' && e.channel === 'mafia',
  mafiaPick: (e: GameEvent) => e.type === 'mafiaPick',
  deadChat: (e: GameEvent) => e.type === 'chat' && e.channel === 'dead' && e.from !== null,
  mournerChat: (e: GameEvent) =>
    e.type === 'chat' && e.channel === 'dead' && e.fromLabel === 'the Mourner',
  whisper: (e: GameEvent) => e.type === 'chat' && e.channel === 'whisper',
  whisperNotice: (e: GameEvent) => e.type === 'whisperNotice',
  nightResult: (e: GameEvent) => e.type === 'nightResult',
} satisfies Record<string, (e: GameEvent) => boolean>;
type Channel = keyof typeof CHANNELS;

interface AutoStats {
  public: number;
  mafia: number;
  dead: number;
  mourner: number;
  whisper: number;
  vote: number;
  judge: number;
  night: number;
  rejected: number;
  rtt: number[];
}

/** Runs inside each page: plays like an eager human through the controller API. */
function installAutopilot(seed: number) {
  const c = window.__vesper!;
  const w = window as unknown as { __auto?: { timer: number; stats: AutoStats } };
  if (w.__auto) clearInterval(w.__auto.timer);
  const stats: AutoStats = {
    public: 0,
    mafia: 0,
    dead: 0,
    mourner: 0,
    whisper: 0,
    vote: 0,
    judge: 0,
    night: 0,
    rejected: 0,
    rtt: [],
  };
  let r = seed;
  const rand = () => {
    r = (r * 1103515245 + 12345) % 2147483648;
    return r / 2147483648;
  };
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const done = new Set<string>();
  const pending = new Map<string, number>();
  let n = 0;
  let lastRejection = 0;
  c.subscribe((st) => {
    const s = st.session;
    if (s?.lastRejection && s.lastRejection.id !== lastRejection) {
      lastRejection = s.lastRejection.id;
      stats.rejected++;
    }
    const v = s?.view;
    if (!v || pending.size === 0) return;
    for (const e of v.events.slice(-30)) {
      if (e.type !== 'chat' || e.from !== v.you.id) continue;
      const at = pending.get(e.text);
      if (at === undefined) continue;
      stats.rtt.push(Math.round(performance.now() - at));
      pending.delete(e.text);
    }
  });
  const tick = () => {
    const v = c.getState().session?.view;
    if (!v || v.result) return;
    const a = v.allowed;
    const phase = `d${v.phase.day} ${v.phase.kind}`;
    const once = (k: string) => {
      const key = `${phase}:${k}`;
      if (done.has(key)) return false;
      done.add(key);
      return true;
    };
    for (const ch of a.chat) {
      if (ch === 'public' && rand() < 0.25) {
        const text = `${v.you.name} wonders aloud (${++n}).`;
        pending.set(text, performance.now());
        c.chat('public', text);
        stats.public++;
      } else if (ch === 'mafia' && once('mafia')) {
        c.chat('mafia', `Syndicate, ${phase}: keep your heads down.`);
        stats.mafia++;
      } else if (ch === 'dead' && once('dead')) {
        c.chat(
          'dead',
          v.you.alive ? `Can anyone hear me? (${phase})` : `It is cold here. (${phase})`,
        );
        if (v.you.alive) stats.mourner++;
        else stats.dead++;
      }
    }
    if (a.whisperTo.length > 0 && once('whisper')) {
      c.whisper(pick(a.whisperTo), `Between us, ${phase}.`);
      stats.whisper++;
    }
    if (a.voteTargets.length > 0 && !v.you.vote && rand() < 0.5) {
      // Most people pile onto the same lowest seat so trials actually happen.
      const seatOf = (id: PlayerId) => v.players.find((p) => p.id === id)?.seat ?? 99;
      const target = [...a.voteTargets].sort((x, y) => seatOf(x) - seatOf(y))[0]!;
      c.vote(rand() < 0.8 ? target : pick(a.voteTargets));
      stats.vote++;
    }
    if (a.judge && !v.you.ballot && rand() < 0.7) {
      c.judge(rand() < 0.75 ? 'guilty' : 'innocent');
      stats.judge++;
    }
    if (a.nightTargets.length > 0 && !v.you.nightTargets && once('night')) {
      c.nightAction([pick(a.nightTargets)]);
      stats.night++;
    }
  };
  w.__auto = { timer: window.setInterval(tick, 1500 + Math.floor(rand() * 1000)), stats };
}

interface HostMetrics {
  sends: number;
  bytes: number;
  byType: Record<string, { n: number; bytes: number }>;
  measureMs: number;
  flushes: number;
  flushMs: number;
  flushTimes: number[];
}

/** Runs in the host page: counts what the host sends and times view fan-out. */
function installHostMetrics() {
  type Host = {
    transport: { send(peer: string, msg: HostMessage): void; __wrapped?: boolean } | null;
    flushViews(): void;
  };
  const h = window.__vesper!.host as unknown as Host;
  const m: HostMetrics = {
    sends: 0,
    bytes: 0,
    byType: {},
    measureMs: 0,
    flushes: 0,
    flushMs: 0,
    flushTimes: [],
  };
  (window as unknown as { __hostMetrics: HostMetrics }).__hostMetrics = m;
  const wrap = () => {
    const t = h.transport;
    if (!t || t.__wrapped) return;
    t.__wrapped = true;
    const send = t.send.bind(t);
    t.send = (peer, msg) => {
      const t0 = performance.now();
      const len = JSON.stringify(msg).length;
      m.measureMs += performance.now() - t0;
      m.sends++;
      m.bytes += len;
      const b = (m.byType[msg.t] ??= { n: 0, bytes: 0 });
      b.n++;
      b.bytes += len;
      send(peer, msg);
    };
  };
  wrap();
  setInterval(wrap, 1000);
  const flush = h.flushViews.bind(h);
  h.flushViews = () => {
    const t0 = performance.now();
    flush();
    const d = performance.now() - t0;
    m.flushes++;
    m.flushMs += d;
    m.flushTimes.push(Math.round(d * 100) / 100);
  };
}

const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function cpuMetrics(cdp: CDPSession) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const get = (name: string) => metrics.find((x) => x.name === name)?.value ?? 0;
  return {
    task: get('TaskDuration'),
    script: get('ScriptDuration'),
    heapMb: get('JSHeapUsedSize') / 2 ** 20,
  };
}

test.describe('big table @bigtable', () => {
  let players: Player[] = [];
  test.afterEach(async () => {
    await closeAll(players);
    players = [];
  });

  test('8 people and 8 bots: every private channel stays private, and the host keeps up', async ({
    browser,
  }) => {
    test.setTimeout(MAX_GAMES * 25 * 60_000);
    players = await Promise.all(NAMES.map((n) => openPlayer(browser, n)));
    const [host, ...friends] = players as [Player, ...Player[]];
    const t0 = Date.now();
    const code = await hostRoom(host);
    await Promise.all(friends.map((f) => joinRoom(f, code)));
    const joinMs = Date.now() - t0;
    await host.page.evaluate(
      ({ seats, roles }) => {
        const c = window.__vesper!;
        c.fillWithBots(seats);
        c.updateSettings({ pace: 'fast', roles });
      },
      { seats: SEATS, roles: ROLES },
    );
    for (const p of players) {
      await expect(p.page.getByTestId('seats').locator('li')).toHaveCount(SEATS);
    }
    const lobby = (await snapshot(host))!.lobby!;
    expect(lobby.validation.errors).toEqual([]);
    const seatOf = new Map<Player, PlayerId>();
    for (const f of friends) seatOf.set(f, await you(f));

    await keepFinishedGames(host);
    await host.page.evaluate(installHostMetrics);
    const cdp = await host.context.newCDPSession(host.page);
    await cdp.send('Performance.enable');
    for (const [i, p] of players.entries()) await p.page.evaluate(installAutopilot, 1000 + i * 77);

    const netLog = (p: Player) => p.page.evaluate(() => window.__vesper!.netLog);
    const covered = new Map<Channel, string>();
    const games: Record<string, unknown>[] = [];
    for (let round = 1; round <= MAX_GAMES; round++) {
      const cpu0 = await cpuMetrics(cdp);
      const host0 = await host.page.evaluate(() => {
        const m = (window as unknown as { __hostMetrics: HostMetrics }).__hostMetrics;
        return { sends: m.sends, bytes: m.bytes, times: m.flushTimes.length };
      });
      const started = Date.now();
      await host.page.getByTestId('start').click();
      await expect(host.page.getByTestId('screen-game')).toBeVisible();
      for (const p of players) {
        await expect(p.page.getByTestId('result')).toBeVisible({ timeout: 20 * 60_000 });
      }
      const ms = Date.now() - started;
      const cpu1 = await cpuMetrics(cdp);
      const hostM = await host.page.evaluate(
        () => (window as unknown as { __hostMetrics: HostMetrics }).__hostMetrics,
      );
      const flushTimes = hostM.flushTimes.slice(host0.times);
      const sends = hostM.sends - host0.sends;
      const bytes = hostM.bytes - host0.bytes;

      // Coverage and latency from this game's messages. The leak audit runs at
      // the end, once every game's log is final.
      const latencies: number[] = [];
      const perFriend: Record<string, unknown> = {};
      for (const f of friends) {
        const mine = messagesByGame(await netLog(f)).get(round) ?? [];
        const messages = mine.map((x) => x.msg);
        const events = messages.flatMap((m) => (m.t === 'view' ? m.view.events : []));
        for (const [name, match] of Object.entries(CHANNELS) as [
          Channel,
          (e: GameEvent) => boolean,
        ][]) {
          if (!covered.has(name) && events.some(match))
            covered.set(name, `${f.name} (game ${round})`);
        }
        for (const x of mine) if (x.msg.t === 'view') latencies.push(x.at - x.msg.hostNow);
        const assigned = events.find((e) => e.type === 'roleAssigned');
        perFriend[f.name] = {
          role: assigned?.type === 'roleAssigned' ? assigned.role : null,
          messages: messages.length,
          views: messages.filter((m) => m.t === 'view').length,
          kb: Math.round(JSON.stringify(messages).length / 1024),
          welcomes: messages.filter((m) => m.t === 'welcome').length,
        };
      }
      const autos = await Promise.all(
        players.map((p) =>
          p.page.evaluate(
            () => (window as unknown as { __auto: { stats: AutoStats } }).__auto.stats,
          ),
        ),
      );
      const rtts = autos.flatMap((a) => a.rtt);
      const hostLog = (await hostSecrets(host)).log;
      const result = hostLog.find((e) => e.type === 'gameOver');
      const game = {
        round,
        ms,
        hostEvents: hostLog.length,
        result: result && result.type === 'gameOver' ? result.result : null,
        host: {
          sends,
          msgPerSec: Math.round((sends / ms) * 1000 * 10) / 10,
          kbTotal: Math.round(bytes / 1024),
          kbPerSec: Math.round((bytes / 1024 / (ms / 1000)) * 10) / 10,
          byType: hostM.byType,
          flushes: flushTimes.length,
          flushMsMean:
            Math.round(
              (flushTimes.reduce((a, b) => a + b, 0) / Math.max(1, flushTimes.length)) * 100,
            ) / 100,
          flushMsP95: pct(flushTimes, 95),
          flushMsMax: pct(flushTimes, 100),
          cpuBusyPct: Math.round(((cpu1.task - cpu0.task) / (ms / 1000)) * 1000) / 10,
          scriptBusyPct: Math.round(((cpu1.script - cpu0.script) / (ms / 1000)) * 1000) / 10,
          heapMb: Math.round(cpu1.heapMb * 10) / 10,
        },
        viewLatencyMs: {
          p50: pct(latencies, 50),
          p95: pct(latencies, 95),
          max: pct(latencies, 100),
          n: latencies.length,
        },
        chatRttMs: { p50: pct(rtts, 50), p95: pct(rtts, 95), max: pct(rtts, 100), n: rtts.length },
        acts: Object.fromEntries(autos.map((a, i) => [NAMES[i], { ...a, rtt: a.rtt.length }])),
        friends: perFriend,
      };
      games.push(game);
      console.log(`BIGTABLE-GAME ${JSON.stringify(game)}`);

      const missing = Object.keys(CHANNELS).filter((k) => !covered.has(k as Channel));
      if (missing.length === 0 || round === MAX_GAMES) break;
      await host.page.getByTestId('back-to-lobby').click();
      for (const p of players) {
        await expect(p.page.getByTestId('screen-lobby')).toBeVisible({ timeout: 20_000 });
      }
    }

    // Leak audit over every message each friend received, game by game. Read
    // the friends first so the host's logs cover everything they hold.
    const inbox = new Map<Player, HostMessage[]>();
    for (const f of friends)
      inbox.set(
        f,
        (await netLog(f)).map((x) => x.msg),
      );
    const secrets = await allGameSecrets(host);
    expect(secrets).toHaveLength(games.length);
    const audit: Record<string, number[]> = {};
    for (const f of friends) {
      audit[f.name] = [];
      for (const [round, messages] of messagesByGame(inbox.get(f)!)) {
        const game = round === 0 ? { log: [], tokens: secrets[0]!.tokens } : secrets[round - 1];
        expect(game, `${f.name} round ${round}`).toBeDefined();
        const problems = auditClientMessages({
          playerId: seatOf.get(f)!,
          messages,
          hostLog: game!.log,
          tokens: game!.tokens,
        });
        expect(problems, `${f.name} round ${round}`).toEqual([]);
        if (round > 0) audit[f.name]!.push(messages.length);
      }
    }

    const summary = {
      transport: process.env.NET ?? 'default',
      site: process.env.E2E_BASE_URL ?? 'local',
      seats: SEATS,
      people: NAMES.length,
      joinMs,
      covered: Object.fromEntries(covered),
      missing: Object.keys(CHANNELS).filter((k) => !covered.has(k as Channel)),
      auditedMessages: audit,
      auditProblems: 0,
      games,
    };
    mkdirSync('test-results', { recursive: true });
    writeFileSync('test-results/big-table.json', JSON.stringify(summary, null, 2));
    console.log(`BIGTABLE-SUMMARY ${JSON.stringify({ ...summary, games: games.length })}`);
    expect(summary.missing).toEqual([]);
    for (const p of players) expect(p.errors).toEqual([]);
  });
});
