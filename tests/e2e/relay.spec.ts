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

// Claude through the host's own relay (relay/ in this repo). Run by
// .github/workflows/claude-relay-e2e.yml against a relay started in CI or the
// host's deployed one. Needs RELAY_URL and RELAY_PASSPHRASE; ANTHROPIC_API_KEY,
// when set, is used only to check that it never reaches a browser. Never print
// the passphrase or the key: assertions on them are boolean, and the run must
// use --trace off.

const RELAY = (process.env.RELAY_URL ?? '').replace(/\/+$/, '');
const PASS = process.env.RELAY_PASSPHRASE ?? '';
const KEY = process.env.ANTHROPIC_API_KEY ?? '';
const CALLS = Math.max(10, Math.min(200, Number(process.env.CLAUDE_E2E_CALLS ?? 60)));
const OUT = 'test-results/relay';
const SECRETS = [PASS, KEY].filter(Boolean);
const leaks = (text: string) => SECRETS.some((s) => text.includes(s));

test.skip(!RELAY || !PASS, 'needs RELAY_URL and RELAY_PASSPHRASE');

function siteOrigin(baseURL: string | undefined): string {
  return new URL(baseURL ?? 'http://localhost:4173/vesper/').origin;
}

/** Type a secret into a field without it appearing in any step title or log. */
async function fillSecret(p: Player, testId: string, value: string): Promise<void> {
  await p.page.getByTestId(testId).evaluate((el, v) => ((el as HTMLInputElement).value = v), value);
}

async function useRelay(p: Player, passphrase: string): Promise<void> {
  await p.page.getByTestId('claude-mode-relay').check();
  await p.page.getByTestId('claude-relay-url').fill(RELAY);
  await fillSecret(p, 'claude-relay-passphrase', passphrase);
  await p.page.getByTestId('claude-relay-save').click();
}

function writeSummary(name: string, summary: Record<string, unknown>): void {
  mkdirSync(OUT, { recursive: true });
  const json = JSON.stringify(summary, null, 2);
  // Never write a file that contains a secret.
  if (!leaks(json)) writeFileSync(`${OUT}/${name}.json`, json);
}

test.describe('Claude relay @relay', () => {
  test('the relay refuses bad requests and answers CORS preflight', async ({ baseURL }) => {
    const origin = siteOrigin(baseURL);
    const results: Record<string, unknown> = { origin };
    // Node's fetch rather than Playwright's request context: it falls back to
    // IPv4 when IPv6 is unreachable, and it can send any Origin header.
    try {
      const health = await fetch(`${RELAY}/`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ service: 'vesper-claude-relay', ready: true });

      const pre = await fetch(`${RELAY}/v1/messages`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type,anthropic-version,x-relay-passphrase',
          'access-control-request-private-network': 'true',
        },
      });
      expect(pre.status).toBe(204);
      expect(pre.headers.get('access-control-allow-origin')).toBe(origin);
      expect(pre.headers.get('access-control-allow-headers')).toContain('x-relay-passphrase');
      expect(pre.headers.get('access-control-allow-private-network')).toBe('true');
      results.preflight = pre.status;

      const body = {
        model: 'claude-haiku-5-5',
        max_tokens: 8,
        messages: [{ role: 'user', content: 'hi' }],
      };
      const post = (headers: Record<string, string>, data: unknown = body) =>
        fetch(`${RELAY}/v1/messages`, {
          method: 'POST',
          headers: {
            origin,
            'content-type': 'application/json',
            'x-relay-passphrase': PASS,
            ...headers,
          },
          body: JSON.stringify(data),
        });
      const cases: [string, () => Promise<Response>, number, string][] = [
        [
          'wrong passphrase',
          () => post({ 'x-relay-passphrase': 'not-the-passphrase' }),
          401,
          'relay_auth',
        ],
        ['disallowed origin', () => post({ origin: 'https://evil.example' }), 403, 'relay_origin'],
        [
          'disallowed model',
          () => post({}, { ...body, model: 'claude-not-on-the-list' }),
          400,
          'relay_model',
        ],
        [
          'oversized body',
          () => post({}, { ...body, messages: [{ role: 'user', content: 'x'.repeat(70 * 1024) }] }),
          413,
          'relay_too_large',
        ],
      ];
      for (const [label, send, status, type] of cases) {
        const res = await send();
        const text = await res.text();
        const parsed = JSON.parse(text) as { error?: { type?: string } };
        results[label] = { status: res.status, type: parsed.error?.type };
        expect(res.status, label).toBe(status);
        expect(parsed.error?.type, label).toBe(type);
        expect(leaks(text), `${label}: no secret in the reply`).toBe(false);
      }
    } finally {
      writeSummary('rejections', results);
    }
  });

  test('a wrong passphrase and a site the relay does not allow get clear statuses', async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(3 * 60_000);
    const host = await openPlayer(browser, 'Hana');
    const blocked = await openPlayer(browser, 'Bea');
    const results: Record<string, unknown> = {};
    try {
      await hostRoom(host, { online: false });
      await useRelay(host, 'not-the-passphrase');
      const status = host.page.getByTestId('claude-status');
      await expect(status).toHaveAttribute('data-state', 'relay-error', { timeout: 30_000 });
      await expect(status).toContainText('passphrase');
      results.wrongPassphrase = await status.textContent();

      // Serve the same build from another origin; the relay must refuse it.
      const base = new URL(baseURL ?? 'http://localhost:4173/vesper/');
      const other = 'https://vesper-blocked.invalid';
      await blocked.context.route(`${other}/**`, async (route) => {
        const url = new URL(route.request().url());
        const res = await route.fetch({ url: `${base.origin}${url.pathname}${url.search}` });
        await route.fulfill({ response: res });
      });
      await blocked.page.goto(`${other}${base.pathname}`);
      await blocked.page.getByTestId('name-input').fill('Bea');
      await blocked.page.getByTestId('host-solo').click();
      await useRelay(blocked, PASS);
      const blockedStatus = blocked.page.getByTestId('claude-status');
      await expect(blockedStatus).toHaveAttribute('data-state', 'relay-error', { timeout: 30_000 });
      await expect(blockedStatus).toContainText('ALLOWED_ORIGINS');
      results.blockedOrigin = await blockedStatus.textContent();
    } finally {
      writeSummary('statuses', results);
      await closeAll([host, blocked]);
    }
  });

  test('a host plays with Claude bots through the relay and one friend', async ({ browser }) => {
    test.setTimeout(15 * 60_000);
    const host = await openPlayer(browser, 'Hana');
    const friend = await openPlayer(browser, 'Ari');
    const players: Player[] = [host, friend];
    const summary: Record<string, unknown> = { callCap: CALLS, relayHost: new URL(RELAY).host };
    const relayHost = new URL(RELAY).host;
    // Every request either browser makes, reduced to booleans about secrets.
    const requests: {
      who: string;
      host: string;
      carriesPassphrase: boolean;
      carriesKey: boolean;
      apiKeyHeader: boolean;
    }[] = [];
    const watch = (p: Player) =>
      p.context.on('request', (req) => {
        const raw = JSON.stringify({
          url: req.url(),
          headers: req.headers(),
          body: req.postData() ?? '',
        });
        requests.push({
          who: p.name,
          host: new URL(req.url()).host,
          carriesPassphrase: raw.includes(PASS),
          carriesKey: KEY ? raw.includes(KEY) : false,
          apiKeyHeader: 'x-api-key' in req.headers(),
        });
      });
    players.forEach(watch);
    try {
      const code = await hostRoom(host, { params: { claudeCalls: String(CALLS) } });
      await useRelay(host, PASS);
      const checked = await host.page.evaluate(async () => {
        const s = await window.__vesper?.testClaude();
        return s ? `${s.state}: ${s.detail}` : 'no controller';
      });
      summary.statusAfterSetup = checked;
      expect(checked, 'Claude status through the relay').toMatch(/^ok:/);
      expect(await host.page.getByTestId('claude-relay-passphrase').inputValue()).toBe('');

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
        forbidden: SECRETS,
      });
      const pageText = async (p: Player) =>
        p.page.evaluate(() =>
          JSON.stringify({
            local: { ...localStorage },
            session: { ...sessionStorage },
            state: window.__vesper?.getState(),
            html: document.documentElement.outerHTML,
          }),
        );
      const hostPage = await pageText(host);
      const friendPage = await pageText(friend);
      const withPassphrase = requests.filter((r) => r.carriesPassphrase);

      Object.assign(summary, {
        finalStatus: claude?.status,
        mode: claude?.mode,
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
        browserRequests: requests.length,
        requestsToAnthropic: requests.filter((r) => r.host === 'api.anthropic.com').length,
        requestsWithApiKeyHeader: requests.filter((r) => r.apiKeyHeader).length,
        requestsCarryingKey: requests.filter((r) => r.carriesKey).length,
        requestsCarryingPassphrase: withPassphrase.length,
        passphraseOnlyToRelay: withPassphrase.every(
          (r) => r.who === 'Hana' && r.host === relayHost,
        ),
        keyCheckedAgainst: KEY ? 'ANTHROPIC_API_KEY' : 'none (not provided)',
        secretInHostPage: leaks(hostPage),
        secretInFriendPage: leaks(friendPage),
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
      expect(voiced.length, 'Claude wrote bot lines through the relay').toBeGreaterThanOrEqual(5);
      expect(friendHeardClaude, 'the friend received Claude-written lines').toBeGreaterThan(0);
      expect(problems).toEqual([]);
      expect(summary.requestsToAnthropic, 'no browser request goes to Anthropic').toBe(0);
      expect(summary.requestsWithApiKeyHeader, 'no browser request has an x-api-key header').toBe(
        0,
      );
      expect(summary.requestsCarryingKey, 'no browser request carries the key').toBe(0);
      expect(withPassphrase.length, 'the host sent the passphrase to the relay').toBeGreaterThan(0);
      expect(summary.passphraseOnlyToRelay, 'the passphrase went only to the relay').toBe(true);
      expect(leaks(hostPage), 'no secret in the host page, storage, or app state').toBe(false);
      expect(leaks(friendPage), 'no secret in the friend page').toBe(false);
      expect(claude?.costUsd ?? 0, 'estimated cost').toBeLessThan(1);
      for (const p of players) expect(p.errors).toEqual([]);
    } finally {
      writeSummary('summary', summary);
      await closeAll(players);
    }
  });
});
