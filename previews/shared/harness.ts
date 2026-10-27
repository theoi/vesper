import { AudioDirector, measure, renderOffline, wavBase64, type Score } from './audio-kit.ts';
import { Tweener } from './tween.ts';
import './harness.css';

export interface SceneCtx {
  /** Fresh container for this scene. It gets `.pv-leaving` when the scene exits, then is removed. */
  root: HTMLElement;
  /** Run `fn` `ms` from now (scenes call this while entering), unless the scene has been left. */
  at(ms: number, fn: () => void): void;
  /** Run `fn` every `ms` until the scene is left. */
  every(ms: number, fn: () => void): void;
  /** Aborted when the scene is left. */
  signal: AbortSignal;
  audio: AudioDirector;
  tween: Tweener;
  /** Milliseconds since the scene started. */
  elapsed(): number;
}

export interface SceneDef {
  id: string;
  label: string;
  /** How long auto-play stays on this scene (ms). */
  duration: number;
  /** Moments to capture for evidence screenshots (ms after enter). Defaults to one at 4 s. */
  shots?: { name: string; at: number }[];
  enter(ctx: SceneCtx): void | (() => void);
}

export interface PreviewConfig {
  slug: string;
  name: string;
  score: Score;
  /** Fill the click-to-begin gate. Include an element with `data-begin`. */
  gate(el: HTMLElement): void;
  /** How long a leaving scene stays mounted for its exit animation (ms). */
  exitMs?: number;
  /**
   * Load heavy assets (images) after the click. The gate shows combined progress of this and
   * the score's samples, and the first scene starts once both are done.
   */
  preload?(onProgress: (fraction: number) => void): Promise<void>;
}

export interface Preview {
  stage: HTMLElement;
  bg: HTMLCanvasElement;
  fx: HTMLCanvasElement;
  tween: Tweener;
  audio: AudioDirector;
  reducedMotion: boolean;
  /** Register a per-frame callback (rAF timestamp ms, delta ms). Runs before and after begin. */
  onFrame(fn: (now: number, dt: number) => void): void;
  /** Mount the scene list and rail. */
  start(scenes: SceneDef[]): void;
  readonly current: string | null;
}

const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  html?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export function createPreview(cfg: PreviewConfig): Preview {
  const params = new URLSearchParams(location.search);
  const stage = h('div', 'pv-stage');
  const bg = h('canvas', 'pv-bg');
  const scenesEl = h('div', 'pv-scenes');
  const fx = h('canvas', 'pv-fx');
  stage.append(bg, scenesEl, fx);
  document.body.append(stage);
  document.body.classList.add('pv-body', `pv-${cfg.slug}`);
  if (params.get('ui') === '0') document.body.classList.add('pv-no-rail');

  const tween = new Tweener();
  const audio = new AudioDirector(cfg.score);
  const frames: ((now: number, dt: number) => void)[] = [];
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(100, now - last);
    last = now;
    tween.update(now);
    for (const f of frames) f(now, dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  let scenes: SceneDef[] = [];
  let index = -1;
  let enteredAt = 0;
  let auto = params.get('auto') !== '0';
  let leave: (() => void) | null = null;
  let begun = false;
  const rail = h('nav', 'pv-rail');
  const exitMs = cfg.exitMs ?? 900;

  const goto = (i: number) => {
    if (!ready || scenes.length === 0) return;
    const n = scenes.length;
    i = ((i % n) + n) % n;
    leave?.();
    const scene = scenes[i];
    if (!scene) return;
    index = i;
    enteredAt = performance.now();
    const root = h('div', `pv-scene pv-scene-${scene.id}`);
    scenesEl.append(root);
    const ac = new AbortController();
    const timers: number[] = [];
    const ctx: SceneCtx = {
      root,
      signal: ac.signal,
      audio,
      tween,
      elapsed: () => performance.now() - enteredAt,
      at(ms, fn) {
        timers.push(window.setTimeout(() => !ac.signal.aborted && fn(), ms));
      },
      every(ms, fn) {
        const id = window.setInterval(() => !ac.signal.aborted && fn(), ms);
        ac.signal.addEventListener('abort', () => clearInterval(id));
      },
    };
    const cleanup = scene.enter(ctx);
    leave = () => {
      ac.abort();
      timers.forEach(clearTimeout);
      if (cleanup) cleanup();
      root.classList.add('pv-leaving');
      window.setTimeout(() => root.remove(), exitMs);
    };
    document.body.dataset.scene = scene.id;
    rail.querySelectorAll<HTMLElement>('[data-i]').forEach((b) => {
      b.classList.toggle('pv-on', Number(b.dataset.i) === i);
    });
    history.replaceState(null, '', `#${scene.id}`);
  };

  const gate = h('div', 'pv-gate');
  cfg.gate(gate);
  document.body.append(gate);
  let ready = false;
  const begin = async () => {
    if (begun) return;
    begun = true;
    gate.classList.add('pv-loading');
    const parts = { audio: 0, assets: cfg.preload ? 0 : 1 };
    const report = () => {
      const f = (parts.audio + parts.assets) / 2;
      gate.style.setProperty('--pv-progress', f.toFixed(3));
      const label = gate.querySelector('[data-progress]');
      if (label) label.textContent = `${Math.round(f * 100)}%`;
    };
    try {
      await audio.begin((f) => {
        parts.audio = f;
        report();
      });
    } catch (err) {
      console.warn('audio unavailable', err);
    }
    const loading = Promise.all([
      audio.ready.then(() => {
        parts.audio = 1;
        report();
      }),
      cfg.preload?.((f) => {
        parts.assets = f;
        report();
      }),
    ]).catch((err: unknown) => console.warn('some assets failed to load', err));
    await Promise.race([loading, new Promise((r) => window.setTimeout(r, 25000))]);
    ready = true;
    gate.classList.add('pv-gone');
    window.setTimeout(() => gate.remove(), 1600);
    const start = location.hash.slice(1) || params.get('scene') || '';
    const si = scenes.findIndex((s) => s.id === start);
    goto(si >= 0 ? si : 0);
  };
  gate.addEventListener('click', () => void begin());

  const buildRail = () => {
    rail.innerHTML = '';
    const home = h('a', 'pv-home', '<span>←</span> Directions');
    home.href = '../';
    const list = h('div', 'pv-list');
    scenes.forEach((s, i) => {
      const b = h(
        'button',
        'pv-chip',
        `<span class="pv-n">${String(i + 1).padStart(2, '0')}</span><span class="pv-l">${s.label}</span>`,
      );
      b.dataset.i = String(i);
      b.title = `${s.label} (${i + 1})`;
      b.addEventListener('click', () => goto(i));
      list.append(b);
    });
    const ctl = h('div', 'pv-ctl');
    const prev = h('button', 'pv-prev', '‹');
    prev.title = 'Previous scene (←)';
    prev.addEventListener('click', () => goto(index - 1));
    const autoBtn = h('button', 'pv-auto');
    const syncAuto = () => {
      autoBtn.textContent = auto ? 'Auto' : 'Hold';
      autoBtn.classList.toggle('pv-on', auto);
      autoBtn.title = auto ? 'Auto-advance is on (A)' : 'Auto-advance is off (A)';
    };
    autoBtn.addEventListener('click', () => {
      auto = !auto;
      enteredAt = performance.now();
      syncAuto();
    });
    const next = h('button', 'pv-next', '›');
    next.title = 'Next scene (→)';
    next.addEventListener('click', () => goto(index + 1));
    const mute = h('button', 'pv-mute');
    const syncMute = () => {
      mute.textContent = audio.muted ? 'Sound off' : 'Sound on';
      mute.classList.toggle('pv-on', !audio.muted);
    };
    mute.title = 'Mute (M)';
    mute.addEventListener('click', () => {
      audio.setMuted(!audio.muted);
      syncMute();
    });
    const vol = h('input', 'pv-vol');
    vol.type = 'range';
    vol.min = '0';
    vol.max = '100';
    vol.value = String(Math.round(audio.volume * 100));
    vol.title = 'Volume';
    vol.setAttribute('aria-label', 'Volume');
    vol.addEventListener('input', () => {
      audio.setVolume(Number(vol.value) / 100);
      if (audio.muted) {
        audio.setMuted(false);
        syncMute();
      }
    });
    syncAuto();
    syncMute();
    ctl.append(prev, autoBtn, next, mute, vol);
    const progress = h('div', 'pv-progress', '<i></i>');
    rail.append(home, list, ctl, progress);
    document.body.append(rail);

    const bar = progress.querySelector('i');
    frames.push((now) => {
      const s = scenes[index];
      if (!begun || !s) return;
      const p = Math.min(1, (now - enteredAt) / s.duration);
      if (bar) bar.style.transform = `scaleX(${auto ? p : 0})`;
      if (auto && p >= 1) goto(index + 1);
    });

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (!begun) {
        if (e.key === 'Enter' || e.key === ' ') void begin();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') goto(index + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') goto(index - 1);
      else if (e.key === 'm' || e.key === 'M') mute.click();
      else if (e.key === 'a' || e.key === 'A' || e.key === ' ') autoBtn.click();
      else if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('pv-no-rail');
      else if (/^[1-9]$/.test(e.key)) goto(Number(e.key) - 1);
      else return;
      e.preventDefault();
    });
  };

  const pv: Preview = {
    stage,
    bg,
    fx,
    tween,
    audio,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    onFrame(fn) {
      frames.push(fn);
    },
    start(list) {
      scenes = list;
      buildRail();
      exposeTestApi();
    },
    get current() {
      return scenes[index]?.id ?? null;
    },
  };

  // Automation hooks for evidence screenshots and audio verification.
  const exposeTestApi = () => {
    (window as unknown as { __preview: unknown }).__preview = {
      slug: cfg.slug,
      scenes: scenes.map((s) => ({
        id: s.id,
        label: s.label,
        duration: s.duration,
        shots: s.shots ?? [{ name: s.id, at: 4000 }],
      })),
      begin,
      goto: (id: string) => goto(scenes.findIndex((s) => s.id === id)),
      setAuto: (on: boolean) => {
        auto = on;
      },
      current: () => pv.current,
      level: () => audio.level(),
      audioState: () => audio.ctx?.state ?? 'none',
      isReady: () => ready,
      async audioCheck(bedSeconds = 8, stingSeconds = 5) {
        const out: {
          kind: string;
          name: string;
          rmsDb: number;
          peakDb: number;
          silentFrac: number;
        }[] = [];
        for (const name of cfg.score.beds) {
          out.push({
            kind: 'bed',
            name,
            ...measure(await renderOffline(cfg.score, { bed: name, seconds: bedSeconds })),
          });
        }
        for (const name of cfg.score.stings) {
          out.push({
            kind: 'sting',
            name,
            ...measure(await renderOffline(cfg.score, { sting: name, seconds: stingSeconds })),
          });
        }
        return out;
      },
      async renderWav(kind: 'bed' | 'sting', name: string, seconds: number) {
        return wavBase64(await renderOffline(cfg.score, { [kind]: name, seconds }));
      },
    };
  };

  return pv;
}

/** Tiny DOM helper shared by the directions. */
export const el = h;
