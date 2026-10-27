// Capture every scene of every preview and verify audio, using the system Chrome.
//
//   node previews/_tools/shoot.mjs <baseUrl> <outDir> [slug ...] [--audio] [--hide-ui] [--wav]
//
// <baseUrl> is the site root, e.g. http://localhost:4173/vesper/ or https://theoi.github.io/vesper/.
// Prints a JSON report: console errors, live output level per shot, and (with --audio)
// offline-rendered loudness for every bed and sting. --wav also writes WAVs for spectrograms.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [base, outDir, ...slugs] = args.filter((a) => !a.startsWith('--'));
if (!base || !outDir || slugs.length === 0) {
  console.error('usage: shoot.mjs <baseUrl> <outDir> <slug...> [--audio] [--hide-ui] [--wav]');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: true,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});

const report = [];
for (const slug of slugs) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  const url = `${base}previews/${slug}/?auto=0`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__preview, null, {
    timeout: 15000,
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(outDir, `${slug}-gate.png`), timeout: 120000 });
  await page.click('.pv-gate');
  await page.waitForTimeout(600);
  if (flags.has('--hide-ui')) await page.evaluate(() => document.body.classList.add('pv-no-rail'));
  const scenes = await page.evaluate(() => window.__preview.scenes);
  const shots = [];
  for (const scene of scenes) {
    await page.evaluate((id) => window.__preview.goto(id), scene.id);
    const t0 = Date.now();
    for (const shot of [...scene.shots].sort((a, b) => a.at - b.at)) {
      const wait = shot.at - (Date.now() - t0);
      if (wait > 0) await page.waitForTimeout(wait);
      const level = await page.evaluate(() => window.__preview.level());
      const file = join(outDir, `${slug}-${shot.name}.png`);
      await page.screenshot({ path: file, timeout: 120000 });
      shots.push({ scene: scene.id, shot: shot.name, file, level: Number(level.toFixed(4)) });
    }
  }
  const audioState = await page.evaluate(() => window.__preview.audioState());
  let audio = null;
  if (flags.has('--audio')) audio = await page.evaluate(() => window.__preview.audioCheck());
  if (flags.has('--wav')) {
    for (const [kind, name, seconds] of [
      ['bed', 'night', 12],
      ['bed', 'day', 12],
      ['bed', 'trial', 12],
      ['sting', 'verdict', 6],
      ['sting', 'death', 8],
    ]) {
      const b64 = await page.evaluate(
        ([k, n, s]) => window.__preview.renderWav(k, n, s).catch(() => ''),
        [kind, name, seconds],
      );
      if (b64)
        writeFileSync(join(outDir, `${slug}-${kind}-${name}.wav`), Buffer.from(b64, 'base64'));
    }
  }
  report.push({ slug, url, errors, audioState, shots, audio });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 2));
