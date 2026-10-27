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

export function appUrl(params: Record<string, string> = {}): string {
  const q = new URLSearchParams(params).toString();
  const all = [q, NET].filter(Boolean).join('&');
  return all ? `./?${all}` : './';
}

export async function openPlayer(browser: Browser, name: string): Promise<Player> {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('vesper.netlog', '1'));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { name, context, page, errors };
}

/** Host a room from the home screen; returns the room code. */
export async function hostRoom(p: Player, opts: { online?: boolean } = {}): Promise<string> {
  const online = opts.online ?? true;
  await p.page.goto(appUrl());
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
