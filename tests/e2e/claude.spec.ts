import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { BotLine } from '../../src/net/index.ts';
import { auditClientMessages } from '../support/leak-audit.ts';
import {
  closeAll,
  hostRoom,
  hostSecrets,
  joinRoom,
  openPlayer,
  received,
  you,
  type Player,
} from './support/harness.ts';

// Real Claude through the browser path, on the live site. Needs ANTHROPIC_API_KEY
// (and ANTHROPIC_WORKSPACE_ID for keys not scoped to a workspace). Run by
// .github/workflows/claude-browser-e2e.yml. Never print the key: assertions on it
// are boolean so a failure message can't echo it, and the run must use --trace off.

const KEY = process.env.ANTHROPIC_API_KEY ?? '';
const WORKSPACE = process.env.ANTHROPIC_WORKSPACE_ID ?? '';
const CALLS = Math.max(10, Math.min(200, Number(process.env.CLAUDE_E2E_CALLS ?? 60)));
const OUT = 'test-results/claude';

test.skip(!KEY, 'needs ANTHROPIC_API_KEY');

test('a host plays with Claude bots and one friend on the live site @claude', async ({
  browser,
}) => {
  test.setTimeout(15 * 60_000);
  const host = await openPlayer(browser, 'Hana');
  const friend = await openPlayer(browser, 'Ari');
  const players: Player[] = [host, friend];
  const summary: Record<string, unknown> = { callCap: CALLS };
  try {
    const code = await hostRoom(host, { params: { claudeCalls: String(CALLS) } });

    // Fill the key field without the value appearing in any step title or log.
    await host.page
      .getByTestId('claude-key')
      .evaluate((el, k) => ((el as HTMLInputElement).value = k), KEY);
    if (WORKSPACE) {
      await host.page.getByTestId('claude-workspace').evaluate((el, w) => {
        const input = el as HTMLInputElement;
        input.value = w;
        input.dispatchEvent(new Event('change'));
      }, WORKSPACE);
    }
    await host.page.getByTestId('claude-save').click();
    await expect(host.page.getByTestId('claude-status')).toHaveAttribute(
      'data-state',
      /ok|invalid-key|degraded|rate-limited/,
      {
        timeout: 30_000,
      },
    );
    summary.statusAfterKey = await host.page.getByTestId('claude-status').textContent();
    await expect(host.page.getByTestId('claude-status')).toHaveAttribute('data-state', 'ok');
    expect(await host.page.getByTestId('claude-key').inputValue()).toBe('');

    await joinRoom(friend, code);
    await host.page.getByTestId('fill-count').selectOption('7');
    await host.page.getByTestId('fill-bots').click();
    await host.page.getByTestId('pace').selectOption('fast');
    await expect(friend.page.getByTestId('seats').locator('li')).toHaveCount(7);
    await host.page.getByTestId('start').click();
    for (const p of players) await expect(p.page.getByTestId('screen-game')).toBeVisible();

    for (const p of players) {
      await expect(p.page.getByTestId('result')).toBeVisible({ timeout: 12 * 60_000 });
    }

    const transcript = await host.page.evaluate(() => window.__vesper?.botTranscript() ?? []);
    const claude = await host.page.evaluate(() => window.__vesper?.getState().claude);
    const voiced = transcript.filter((l: BotLine) => l.source === 'claude');
    const reasons: Record<string, number> = {};
    for (const l of transcript) {
      if (l.source === 'scripted') reasons[l.reason ?? '?'] = (reasons[l.reason ?? '?'] ?? 0) + 1;
    }
    const secrets = await hostSecrets(host);
    const gameOver = secrets.log.find((e) => e.type === 'gameOver');
    const messages = await received(friend);
    const friendChat = new Set(
      messages.flatMap((m) =>
        m.t === 'view' ? m.view.events.filter((e) => e.type === 'chat').map((e) => e.text) : [],
      ),
    );
    const friendHeardClaude = voiced.filter((l) => l.delivered && friendChat.has(l.text)).length;
    const problems = auditClientMessages({
      playerId: await you(friend),
      messages,
      hostLog: secrets.log,
      tokens: secrets.tokens,
      forbidden: [KEY, WORKSPACE].filter(Boolean),
    });
    const friendPage = await friend.page.evaluate(() =>
      JSON.stringify({ storage: { ...localStorage }, html: document.documentElement.outerHTML }),
    );
    const hostState = await host.page.evaluate(() => JSON.stringify(window.__vesper?.getState()));

    Object.assign(summary, {
      finalStatus: claude?.status,
      model: claude?.model,
      calls: claude?.callsThisGame,
      lines: transcript.length,
      claudeLines: voiced.length,
      scriptedReasons: reasons,
      costUsd: claude?.costUsd,
      result: gameOver && 'result' in gameOver ? gameOver.result : null,
      friendMessages: messages.length,
      friendHeardClaudeLines: friendHeardClaude,
      auditProblems: problems,
      keyInFriendPage: friendPage.includes(KEY),
      keyInHostState: hostState.includes(KEY),
      transcript: transcript.map((l: BotLine) => ({
        day: l.day,
        phase: l.phase,
        bot: l.name,
        channel: l.channel,
        source: l.source,
        reason: l.reason,
        delivered: l.delivered,
        scripted: l.scripted,
        text: l.text,
      })),
    });

    expect(gameOver, 'the game completed').toBeTruthy();
    expect(voiced.length, 'Claude wrote bot lines').toBeGreaterThanOrEqual(5);
    expect(friendHeardClaude, 'the friend received Claude-written lines').toBeGreaterThan(0);
    expect(problems).toEqual([]);
    expect(friendPage.includes(KEY), 'friend page must not contain the key').toBe(false);
    expect(hostState.includes(KEY), 'host app state must not contain the key').toBe(false);
    expect(claude?.costUsd ?? 0, 'estimated cost').toBeLessThan(1);
    for (const p of players) expect(p.errors).toEqual([]);
  } finally {
    mkdirSync(OUT, { recursive: true });
    const json = JSON.stringify(summary, null, 2);
    // Belt and braces: never write a file that contains the key.
    if (!KEY || !json.includes(KEY)) writeFileSync(`${OUT}/summary.json`, json);
    await closeAll(players);
  }
});
