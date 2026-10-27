import type { AudioScene, CueName, EndVariant } from '../../src/ui/contracts.ts';
import { sampleUrls } from '../../src/audio/bank.ts';
import { CUE_NAMES, CUE_TAKES } from '../../src/audio/cues.ts';
import { measure } from '../../src/audio/dsp.ts';
import { AudioEngine, renderOffline, type RenderJob } from '../../src/audio/engine.ts';

interface Row {
  name: string;
  kind: 'scene' | 'cue';
  rmsDb: number;
  peakDb: number;
  silentFrac: number;
  ok: boolean;
}

interface StressResult {
  errors: string[];
  /** Most voices while beds play at full tension with a few cues, before the stress. */
  peakNormal: number;
  peakVoices: number;
  voicesAfterBurst: number;
  bedsAfterSwitching: number;
  voicesSettled: number;
}

declare global {
  interface Window {
    __audioCheck?: () => Promise<Row[]>;
    __audioStress?: () => Promise<StressResult>;
    __audioBytes?: () => Promise<number>;
  }
}

const audio = new AudioEngine();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const SCENES: { label: string; scene: AudioScene; end?: EndVariant; won?: boolean }[] = [
  { label: 'silence', scene: 'silence' },
  { label: 'lobby', scene: 'lobby' },
  { label: 'day', scene: 'day' },
  { label: 'voting', scene: 'voting' },
  { label: 'trial', scene: 'trial' },
  { label: 'night', scene: 'night' },
  { label: 'nightSyndicate', scene: 'nightSyndicate' },
  { label: 'nightDead', scene: 'nightDead' },
  { label: 'dawn', scene: 'dawn' },
  { label: 'end town (won)', scene: 'end', end: 'town', won: true },
  { label: 'end town (lost)', scene: 'end', end: 'town', won: false },
  { label: 'end mafia (won)', scene: 'end', end: 'mafia', won: true },
  { label: 'end mafia (lost)', scene: 'end', end: 'mafia', won: false },
  { label: 'end cutthroat', scene: 'end', end: 'cutthroat', won: true },
  { label: 'end draw', scene: 'end', end: 'draw', won: false },
];

const begin = () => void audio.begin();

for (const s of SCENES) {
  const b = document.createElement('button');
  b.textContent = s.label;
  b.addEventListener('click', () => {
    begin();
    audio.setScene(s.scene, { end: s.end, won: s.won });
    document.querySelectorAll('#scenes button').forEach((x) => x.classList.toggle('on', x === b));
  });
  $('scenes').append(b);
}

for (const name of CUE_NAMES) {
  const b = document.createElement('button');
  b.textContent = `${name} ×${CUE_TAKES[name]}`;
  b.addEventListener('click', (e) => {
    begin();
    audio.cue(name, { pan: e.shiftKey ? -0.8 : e.altKey ? 0.8 : 0 });
  });
  $('cues').append(b);
}

$('begin').addEventListener('click', begin);
const muteBtn = $('mute');
const renderMute = () => {
  muteBtn.textContent = audio.muted ? 'Unmute' : 'Mute';
};
renderMute();
muteBtn.addEventListener('click', () => {
  audio.setMuted(!audio.muted);
  renderMute();
});
const vol = $<HTMLInputElement>('volume');
vol.value = String(audio.volume);
vol.addEventListener('input', () => audio.setVolume(Number(vol.value)));
const tension = $<HTMLInputElement>('tension');
tension.addEventListener('input', () => audio.setTension(Number(tension.value)));

const meter = $('meter').firstElementChild as HTMLElement;
const frame = () => {
  meter.style.width = `${Math.min(100, audio.level() * 300)}%`;
  const d = audio.debug();
  $('status').textContent =
    `${d.scene} · beds ${d.beds} · voices ${d.voices} (peak ${d.peak}) · tension ${d.tension.toFixed(2)}`;
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-inf');

async function check(): Promise<Row[]> {
  const rows: Row[] = [];
  const jobs: { name: string; kind: Row['kind']; job: RenderJob }[] = [];
  for (const s of SCENES)
    jobs.push({
      name: s.label,
      kind: 'scene',
      job: { scene: s.scene, end: s.end, won: s.won, seconds: 8 },
    });
  jobs.push({
    name: 'day (tension 1)',
    kind: 'scene',
    job: { scene: 'day', tension: 1, seconds: 8 },
  });
  jobs.push({
    name: 'voting (tension 0.7)',
    kind: 'scene',
    job: { scene: 'voting', tension: 0.7, seconds: 8 },
  });
  jobs.push({
    name: 'trial (tension 1)',
    kind: 'scene',
    job: { scene: 'trial', tension: 1, seconds: 8 },
  });
  for (const name of CUE_NAMES)
    for (let v = 0; v < CUE_TAKES[name]; v++)
      jobs.push({
        name: `${name}#${v}`,
        kind: 'cue',
        job: { cue: name as CueName, variant: v, seconds: 4 },
      });
  for (const j of jobs) {
    const m = measure(await renderOffline(j.job));
    const silence = j.job.scene === 'silence';
    const ok =
      m.peakDb <= -0.5 &&
      (j.kind === 'cue'
        ? m.rmsDb > -45
        : silence || (m.rmsDb >= -30 && m.rmsDb <= -12 && m.silentFrac < 0.3));
    rows.push({ name: j.name, kind: j.kind, ...m, ok });
  }
  const table = document.createElement('table');
  table.innerHTML =
    '<tr><th>name</th><th>RMS dBFS</th><th>peak dBFS</th><th>silent</th></tr>' +
    rows
      .map(
        (r) =>
          `<tr class="${r.ok ? '' : 'bad'}"><td>${r.name}</td><td>${fmt(r.rmsDb)}</td><td>${fmt(r.peakDb)}</td><td>${r.silentFrac.toFixed(2)}</td></tr>`,
      )
      .join('');
  $('out').replaceChildren(table);
  return rows;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function stress(): Promise<StressResult> {
  const errors: string[] = [];
  const onError = (e: ErrorEvent) => errors.push(e.message);
  window.addEventListener('error', onError);
  await audio.begin();
  const scenes = SCENES.map((s) => s);
  let peakNormal = 0;
  try {
    for (const scene of ['trial', 'day', 'night'] as const) {
      audio.setScene(scene);
      audio.setTension(1);
      await wait(3000);
      audio.cue('knock');
      audio.cue('guilty');
      await wait(1500);
    }
    peakNormal = audio.debug(true).peak;
    for (let i = 0; i < 20; i++) {
      const s = scenes[(i * 7) % scenes.length] ?? scenes[0];
      if (s) audio.setScene(s.scene, { end: s.end, won: s.won });
      audio.setTension((i % 5) / 4);
      await wait(100);
    }
    const bedsAfterSwitching = audio.debug().beds;
    audio.setScene('day');
    for (let i = 0; i < 50; i++) {
      audio.cue(CUE_NAMES[i % CUE_NAMES.length] ?? 'ui', { pan: (i % 3) - 1 });
      await wait(20);
    }
    const voicesAfterBurst = audio.debug().voices;
    await wait(6000);
    const d = audio.debug();
    return {
      errors,
      peakNormal,
      peakVoices: d.peak,
      voicesAfterBurst,
      bedsAfterSwitching,
      voicesSettled: d.voices,
    };
  } catch (err) {
    errors.push(String(err));
    return {
      errors,
      peakNormal,
      peakVoices: audio.debug().peak,
      voicesAfterBurst: -1,
      bedsAfterSwitching: -1,
      voicesSettled: -1,
    };
  } finally {
    window.removeEventListener('error', onError);
  }
}

async function bytes(): Promise<number> {
  let total = 0;
  for (const url of sampleUrls()) total += (await (await fetch(url)).arrayBuffer()).byteLength;
  return total;
}

$('check').addEventListener('click', () => void check());
$('stress').addEventListener(
  'click',
  () =>
    void stress().then((r) => {
      $('out').textContent = JSON.stringify(r, null, 2);
    }),
);

window.__audioCheck = check;
window.__audioStress = stress;
window.__audioBytes = bytes;
