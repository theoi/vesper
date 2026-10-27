import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { GameEvent, PlayerId } from '../../../src/engine/index.ts';
import type { HostMessage, SessionSnapshot } from '../../../src/net/index.ts';

/**
 * Multi-browser harness. Each player gets an isolated browser context (its own
 * localStorage, so its own seat token) with network recording switched on:
 * every message the page receives from the host lands in
 * `window.__vesper.netLog`, which `received()` reads back for audits.
 */

export interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
  errors: string[];
}

/** `?net=` override, e.g. NET=trystero-nostr to exercise the fallback transport alone. */
const NET = process.env.NET ? `net=${process.env.NET}` : '';
/**
 * `?ui=` override: UI=shell runs a suite against the fallback shell. Unset,
 * pages open without `?ui`, as players do, and must mount the default UI.
 */
const UI_PARAM = process.env.UI ?? '';
export const UI = UI_PARAM || 'v2';

export function appUrl(params: Record<string, string> = {}): string {
  const q = new URLSearchParams(params).toString();
  const all = [q, NET, UI_PARAM ? `ui=${UI_PARAM}` : ''].filter(Boolean).join('&');
  return all ? `./?${all}` : './';
}

/**
 * `serviceWorkers: 'block'` for tests that intercept or count the page's
 * requests: Playwright can't see requests a service worker handles.
 */
export async function openPlayer(
  browser: Browser,
  name: string,
  opts: { serviceWorkers?: 'allow' | 'block' } = {},
): Promise<Player> {
  const context = await browser.newContext({ serviceWorkers: opts.serviceWorkers ?? 'allow' });
  await context.addInitScript(() => localStorage.setItem('vesper.netlog', '1'));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { name, context, page, errors };
}

/** Make sure the expected UI mounted (the app falls back to the shell if the game UI can't load). */
async function expectUi(p: Player): Promise<void> {
  await expect(p.page.locator('html')).toHaveAttribute('data-ui', UI);
}

/** Host a room from the home screen; returns the room code. */
export async function hostRoom(
  p: Player,
  opts: { online?: boolean; params?: Record<string, string> } = {},
): Promise<string> {
  const online = opts.online ?? true;
  await p.page.goto(appUrl(opts.params));
  await expectUi(p);
  await p.page.getByTestId('name-input').fill(p.name);
  await p.page.getByTestId(online ? 'host-online' : 'host-solo').click();
  await expect(p.page.getByTestId('screen-lobby')).toBeVisible();
  if (online) {
    await expect(p.page.getByTestId('network-status')).toHaveText('Open for friends', {
      timeout: 30_000,
    });
  }
  return (await p.page.getByTestId('room-code').textContent()) ?? '';
}

/** Open a share link and join from the home screen. */
export async function joinRoom(p: Player, code: string): Promise<void> {
  await p.page.goto(appUrl({ room: code }));
  await joinFromHome(p, code);
}

/**
 * Join through the exact link the host's lobby shows, as a friend would.
 * Only the test's `?net=` override is added, so a forced transport stays forced.
 */
export async function joinByLink(p: Player, link: string): Promise<void> {
  const url = new URL(link);
  if (process.env.NET) url.searchParams.set('net', process.env.NET);
  await p.page.goto(url.toString());
  await joinFromHome(p, url.searchParams.get('room') ?? '');
}

async function joinFromHome(p: Player, code: string): Promise<void> {
  await expectUi(p);
  await expect(p.page.getByTestId('code-input')).toHaveValue(code);
  await p.page.getByTestId('name-input').fill(p.name);
  await p.page.getByTestId('join').click();
  await expect(p.page.getByTestId('screen-lobby')).toBeVisible({ timeout: 45_000 });
}

export function snapshot(p: Player): Promise<SessionSnapshot | null> {
  return p.page.evaluate(() => window.__vesper?.getState().session ?? null);
}

export async function you(p: Player): Promise<PlayerId> {
  const s = await snapshot(p);
  if (!s?.you) throw new Error(`${p.name} has no seat`);
  return s.you;
}

/** Every message this player's browser received from the host. */
export function received(p: Player): Promise<HostMessage[]> {
  return p.page.evaluate(() => window.__vesper?.netLog.map((x) => x.msg) ?? []);
}

/** The host's full game log and seat tokens (host page only). */
export function hostSecrets(
  host: Player,
): Promise<{ log: GameEvent[]; tokens: Record<string, PlayerId> }> {
  return host.page.evaluate(() => {
    const debug = window.__vesper?.host?.debugState();
    return { log: debug?.game?.log ?? [], tokens: debug?.tokens ?? {} };
  });
}

/** Text lines in a player's game log. */
export function logLines(p: Player): Promise<string[]> {
  return p.page.getByTestId('log').locator('li').allTextContents();
}

export async function closeAll(players: Player[]): Promise<void> {
  await Promise.all(players.map((p) => p.context.close().catch(() => undefined)));
}

/**
 * Split one player's received messages by game, using the lobby messages
 * around them: a game runs from its start (`lobby.round` = N) until the host
 * returns everyone to the lobby. Messages outside any game go under 0.
 */
export function messagesByGame<T extends HostMessage | { msg: HostMessage }>(
  items: readonly T[],
): Map<number, T[]> {
  const out = new Map<number, T[]>();
  let round = 0;
  for (const item of items) {
    const x: HostMessage | { msg: HostMessage } = item;
    const m = 'msg' in x ? x.msg : x;
    if (m.t === 'lobby') round = m.lobby.status === 'open' ? 0 : m.lobby.round;
    const list = out.get(round) ?? [];
    list.push(item);
    out.set(round, list);
  }
  return out;
}

export interface GameSecrets {
  log: GameEvent[];
  tokens: Record<string, PlayerId>;
}

/**
 * Keep each finished game's log and tokens as the host returns to the lobby,
 * so a rematch can still be audited game by game (host page only).
 */
export function keepFinishedGames(host: Player): Promise<void> {
  return host.page.evaluate(() => {
    const h = window.__vesper!.host!;
    const w = window as unknown as { __finished: unknown[] };
    w.__finished = [];
    const back = h.backToLobby.bind(h);
    h.backToLobby = () => {
      const d = h.debugState();
      if (h.snapshot().status === 'ended' && d.game) {
        w.__finished.push(JSON.parse(JSON.stringify({ log: d.game.log, tokens: d.tokens })));
      }
      back();
    };
  });
}

/** Every game's secrets so far, in order: the finished ones, then the current one. */
export async function allGameSecrets(host: Player): Promise<GameSecrets[]> {
  const finished = await host.page.evaluate(
    () => (window as unknown as { __finished?: GameSecrets[] }).__finished ?? [],
  );
  const current = await hostSecrets(host);
  return current.log.length > 0 ? [...finished, current] : finished;
}
