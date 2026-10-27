import './stage.css';
import { nameOf } from '../../app/format.ts';
import { ROLES, type NightActionKind, type PlayerId, type PlayerView } from '../../engine/index.ts';
import type { GameAudio, LobbySeat, PickMode, StageApi } from '../contracts.ts';
import { allArtUrls, castFaces, type Act, type Face } from './art.ts';
import { Cloth, type Look } from './cloth.ts';
import { Film, type Tone } from './film.ts';
import { closeup, type Close } from './portrait.ts';
import { Shade } from './shade.ts';

export { type Act, type Face } from './art.ts';
export { type Look } from './cloth.ts';
export { type Shade } from './shade.ts';

/** Fraction of the stage height (from the bottom) taken by the floor in front of the cloth. */
const FLOOR = 0.22;

interface Member {
  id: PlayerId;
  seat: number;
  name: string;
  face: Face;
  shade: Shade;
  x: number;
  li: HTMLLIElement;
  btn: HTMLButtonElement;
  hit: HTMLButtonElement;
  alive: boolean;
}

interface Spot {
  show: boolean;
  x: number;
  z?: number;
  dim?: number;
  act: Act;
  face?: 1 | -1;
  ghost?: boolean;
}

/** What the director can do with the stage, on top of what the app shell uses. */
export interface Stage extends StageApi {
  readonly cloth: Cloth;
  readonly film: Film;
  readonly reduced: boolean;
  readonly view: PlayerView | null;
  faceOf(id: PlayerId): Face | undefined;
  shadeOf(id: PlayerId): Shade | undefined;
  markOf(id: PlayerId): number;
  nameOf(id: PlayerId | null | undefined): string;
  /** Stereo position of a player's mark, -1..1. */
  pan(id: PlayerId): number;
  /** While held, view updates refresh the candles but leave shades and light to the director. */
  hold(on: boolean): void;
  /** Put every shade where the current view says it rests, over `ms`. */
  settle(ms?: number): void;
  /** Ease the light to the look for the current phase. */
  restLook(ms?: number): void;
  /** Words written on the cloth in a spirit hand. */
  spirit(text: string, tone: Tone, sub?: string): HTMLElement;
  /** A small ink plate at the top of the cloth (a claim, a notice). Removes itself after `ms`. */
  plate(text: string, kicker?: string, ms?: number): HTMLElement;
  /** A handwritten letter (a will, a death note). With `ms`, it outlives the sequence. */
  letter(title: string, body: string, kind?: 'will' | 'note', ms?: number): HTMLElement;
  /** A thread of light between two shades (a whisper). */
  thread(a: PlayerId, b: PlayerId): void;
  /** Transient candle effects. */
  candle(id: PlayerId, fx: 'out' | 'flare' | 'dim' | 'lit'): void;
  /** The trial inset: a close-up of the defendant beside the cloth. */
  inset(): Close | null;
  clearOver(): void;
  /** A temporary shade that belongs to no seat (a watchman, a stranger). */
  extra(x: number, fig: 'm' | 'w', dim?: number): Shade;
  dropExtra(s: Shade, ms?: number): void;
  onSkip(cb: () => void): void;
  /** Size of the area the shades stand in. */
  box(): DOMRect;
}

function div(cls: string, text?: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
}

const NIGHT_ACT: Record<NightActionKind, Act> = {
  investigate: 'creep',
  watch: 'lantern',
  heal: 'heal',
  guard: 'guard',
  shoot: 'aim',
  block: 'knock',
  kill: 'lunge',
  frame: 'creep',
  embalm: 'cloak',
  stab: 'lunge',
  vest: 'cloak',
};

/** How far from the target a visitor stands, by what they do. */
const NIGHT_GAP: Partial<Record<NightActionKind, number>> = { shoot: 16, watch: 9, guard: 5 };

class ScrimStage implements Stage {
  readonly el: HTMLElement;
  readonly cloth: Cloth;
  readonly film = new Film();
  private readonly shadows: HTMLElement;
  private readonly fx: HTMLElement;
  private readonly hits: HTMLElement;
  private readonly candles: HTMLOListElement;
  private readonly over: HTMLElement;
  private readonly insetEl: HTMLElement;
  private insetClose: { id: PlayerId; c: Close } | null = null;
  private members = new Map<PlayerId, Member>();
  private castKey = '';
  private mode: 'none' | 'lobby' | 'game' = 'none';
  private pickMode: PickMode = 'none';
  private targets = new Set<PlayerId>();
  private chosen = new Set<PlayerId>();
  private pickCb: (id: PlayerId) => void = () => {};
  private skipCb: () => void = () => {};
  private holds = 0;
  private walkTimers = new Map<Shade, number>();
  private extras = new Set<Shade>();
  private raf = 0;
  private lastPhase = '';
  reduced = false;
  view: PlayerView | null = null;

  constructor(private readonly audio: GameAudio) {
    this.el = div('vs-stage');
    const canvas = document.createElement('canvas');
    canvas.className = 'vs-cloth';
    this.cloth = new Cloth(canvas, FLOOR);
    if (!this.cloth.ok) this.el.classList.add('no-gl');
    this.shadows = div('vs-shadows');
    this.fx = div('vs-fx');
    this.hits = div('vs-hits');
    this.candles = document.createElement('ol');
    this.candles.className = 'vs-candles';
    this.over = div('vs-over');
    this.insetEl = div('vs-inset');
    this.el.append(
      canvas,
      this.shadows,
      this.fx,
      this.hits,
      this.candles,
      this.over,
      this.insetEl,
      this.film.el,
    );
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('button, a, input, textarea, select')) return;
      this.skipCb();
    });
    this.cloth.look('lobby', 0);
    let clothAt = 0;
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      // The cloth flickers like film: about 30 frames a second is plenty and halves the GPU cost.
      if (now - clothAt >= 30) {
        clothAt = now;
        this.cloth.render(now, 0.6);
      }
      this.film.draw();
    };
    this.raf = requestAnimationFrame(loop);
    // Warm the cache so close-ups and poses never pop in mid-sequence.
    const warm = () => {
      for (const url of allArtUrls()) {
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
      }
    };
    if ('requestIdleCallback' in window) requestIdleCallback(warm);
    else setTimeout(warm, 800);
  }

  // --- cast -----------------------------------------------------------------------

  private build(
    players: readonly { id: PlayerId; name: string; seat: number }[],
    key: string,
  ): void {
    if (
      key === this.castKey &&
      players.every((p) => this.members.has(p.id)) &&
      players.length === this.members.size
    )
      return;
    const faces = castFaces(players.length, key);
    const keep = new Map(this.members);
    this.members.clear();
    this.candles.replaceChildren();
    this.hits.replaceChildren();
    const n = players.length;
    players.forEach((p, i) => {
      const face = faces[i] as Face;
      const x = 9 + (82 * (i + 0.5)) / Math.max(1, n);
      const old = keep.get(p.id);
      keep.delete(p.id);
      let shade = old?.shade;
      if (!shade || shade.fig !== face.fig) {
        shade?.el.remove();
        shade = new Shade(
          this.shadows,
          { x: x < 50 ? -12 : 112, fig: face.fig, h: 0.94 + ((i * 37) % 11) / 100, dim: 0 },
          () => this.reduced,
        );
      }
      const li = document.createElement('li');
      li.className = 'vs-candle';
      li.dataset.playerId = p.id;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vs-cbtn';
      btn.append(
        div('vs-mark'),
        div('vs-flame'),
        div('vs-wax'),
        div('vs-name', p.name),
        div('vs-tag'),
        div('vs-votes'),
      );
      btn.addEventListener('click', () => this.clickPlayer(p.id));
      li.append(btn);
      this.candles.append(li);
      const hit = document.createElement('button');
      hit.type = 'button';
      hit.className = 'vs-hit';
      hit.tabIndex = -1;
      hit.setAttribute('aria-hidden', 'true');
      hit.style.left = `${x}%`;
      hit.addEventListener('click', () => this.clickPlayer(p.id));
      this.hits.append(hit);
      this.members.set(p.id, {
        id: p.id,
        seat: p.seat,
        name: p.name,
        face,
        shade,
        x,
        li,
        btn,
        hit,
        alive: true,
      });
    });
    for (const m of keep.values()) m.shade.el.remove();
    this.candles.style.setProperty('--n', String(n));
    this.candles.classList.toggle('crowd', n >= 7);
    this.castKey = key;
  }

  private clickPlayer(id: PlayerId): void {
    if (this.pickMode !== 'none' && this.targets.has(id)) this.pickCb(id);
  }

  showLobby(seats: readonly LobbySeat[]): void {
    const entering = this.mode !== 'lobby';
    this.mode = 'lobby';
    this.view = null;
    this.candles.removeAttribute('data-testid');
    const before = new Set(this.members.keys());
    this.build(
      seats.map((s, i) => ({ id: s.id, name: s.name, seat: i })),
      `lobby:${seats.length}`,
    );
    for (const m of this.members.values()) {
      m.li.removeAttribute('data-testid');
      m.li.dataset.alive = 'true';
      m.li.classList.remove('is-dead', 'is-target', 'is-chosen', 'is-you');
      m.btn.disabled = true;
      m.btn.setAttribute('aria-label', m.name);
      m.hit.hidden = true;
      if (!before.has(m.id) && !entering) this.audio.cue('candleLight', { pan: this.pan(m.id) });
      const ms = m.shade.walkTo(m.x, { dim: 1 });
      this.afterWalk(m.shade, ms, 'idle', m.x < 50 ? 1 : -1);
    }
    if (entering) this.cloth.look('lobby', 1200);
  }

  update(view: PlayerView): void {
    const first = this.mode !== 'game';
    this.mode = 'game';
    this.view = view;
    const start = view.events.find((e) => e.type === 'gameStart');
    this.build(view.players, `${start?.at ?? 0}:${view.players.map((p) => p.id).join()}`);
    this.candles.dataset.testid = 'players';
    this.el.dataset.phase = view.phase.kind;
    this.paintCandles(view);
    const phaseKey = `${view.phase.kind}:${view.phase.day}`;
    const changed = phaseKey !== this.lastPhase;
    this.lastPhase = phaseKey;
    if (this.holds === 0) {
      this.settle(first ? 0 : changed ? 1400 : 700);
      if (changed || first) this.restLook(first ? 0 : 1800);
    }
    this.syncInset(view);
  }

  private paintCandles(view: PlayerView): void {
    const tally = new Map<PlayerId, number>();
    for (const [voter, target] of Object.entries(view.votes)) {
      const w = view.players.find((p) => p.id === voter)?.magistrateRevealed ? 3 : 1;
      tally.set(target, (tally.get(target) ?? 0) + w);
    }
    const need = Math.max(1, view.voteThreshold);
    for (const p of view.players) {
      const m = this.members.get(p.id);
      if (!m) continue;
      const li = m.li;
      li.dataset.testid = `player-${p.seat}`;
      li.dataset.alive = String(p.alive);
      if (m.alive && !p.alive) this.snuff(m);
      m.alive = p.alive;
      li.classList.toggle('is-dead', !p.alive);
      li.classList.toggle('is-you', p.id === view.you.id);
      li.classList.toggle('is-target', this.targets.has(p.id));
      li.classList.toggle('is-chosen', this.chosen.has(p.id));
      li.classList.toggle('is-trial', view.trial?.defendant === p.id);
      const votes = tally.get(p.id) ?? 0;
      li.style.setProperty('--g', Math.min(1.2, votes / need).toFixed(3));
      const pips = li.querySelector('.vs-votes');
      if (pips) pips.textContent = votes > 0 ? '•'.repeat(Math.min(votes, 9)) : '';
      const tag = li.querySelector('.vs-tag');
      const role = p.role ? ROLES[p.role].name : p.magistrateRevealed ? 'Magistrate' : '';
      if (tag) tag.textContent = p.id === view.you.id ? `you · ${role}` : role;
      const status = !p.alive
        ? ', dead'
        : view.trial?.defendant === p.id
          ? ', on trial'
          : votes
            ? `, ${votes} votes`
            : '';
      m.btn.setAttribute(
        'aria-label',
        `${p.name}${p.id === view.you.id ? ' (you)' : ''}${role ? `, ${role}` : ''}${status}`,
      );
      m.btn.disabled = !(this.pickMode !== 'none' && this.targets.has(p.id));
      m.btn.setAttribute('aria-pressed', String(this.chosen.has(p.id)));
      m.hit.hidden = m.btn.disabled;
      m.hit.title = p.name;
    }
  }

  private snuff(m: Member): void {
    m.li.classList.remove('snuff');
    void m.li.offsetWidth;
    m.li.classList.add('snuff');
  }

  setPick(mode: PickMode, targets: readonly PlayerId[], chosen: readonly PlayerId[]): void {
    this.pickMode = mode;
    this.targets = new Set(targets);
    this.chosen = new Set(chosen);
    this.el.dataset.pick = mode;
    if (this.view) this.paintCandles(this.view);
  }

  onPick(cb: (id: PlayerId) => void): void {
    this.pickCb = cb;
  }

  onSkip(cb: () => void): void {
    this.skipCb = cb;
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on;
    this.cloth.calm = on;
    this.film.calm = on;
    if (on) this.film.clearGrain();
    this.el.classList.toggle('rm', on);
  }

  // --- layout ---------------------------------------------------------------------

  hold(on: boolean): void {
    this.holds = Math.max(0, this.holds + (on ? 1 : -1));
  }

  private spots(view: PlayerView): Map<PlayerId, Spot> {
    const out = new Map<PlayerId, Spot>();
    const kind = view.phase.kind;
    const you = view.you;
    const mark = (id: PlayerId) => this.members.get(id)?.x ?? 50;
    const toward = (from: number, to: number): 1 | -1 => (to >= from ? 1 : -1);
    const centre = (x: number): 1 | -1 => (x < 50 ? 1 : -1);
    const defendant = view.trial?.defendant ?? null;

    if (kind === 'night') {
      if (!you.alive) {
        const dead = view.players.filter((p) => !p.alive);
        dead.forEach((p, i) => {
          const x = 50 + (i - (dead.length - 1) / 2) * Math.min(12, 70 / Math.max(1, dead.length));
          out.set(p.id, {
            show: true,
            x,
            act: 'sit',
            dim: 0.7,
            face: centre(x),
            ghost: true,
            z: 0.04,
          });
        });
        return out;
      }
      const visits = new Map<PlayerId, { target: PlayerId; kind: NightActionKind }>();
      const mine =
        view.allowed.nightAction ?? (ROLES[you.role].night?.kind as NightActionKind | undefined);
      if (you.nightTargets?.length && mine)
        visits.set(you.id, { target: you.nightTargets[0] as PlayerId, kind: mine });
      if (you.faction === 'mafia') {
        const since = view.events.findLastIndex((e) => e.type === 'phase' && e.phase === 'night');
        for (const e of view.events.slice(since + 1)) {
          if (e.type !== 'mafiaPick' || e.player === you.id) continue;
          if (e.targets?.length)
            visits.set(e.player, { target: e.targets[0] as PlayerId, kind: e.kind });
          else visits.delete(e.player);
        }
      }
      const visible = new Set<PlayerId>([you.id]);
      if (you.faction === 'mafia') for (const t of you.teammates) if (t.alive) visible.add(t.id);
      const slot = new Map<PlayerId, number>();
      for (const id of visible) {
        const v = visits.get(id);
        if (v && v.target !== id) {
          const n = slot.get(v.target) ?? 0;
          slot.set(v.target, n + 1);
          const tx = mark(v.target);
          const side = (n % 2 === 0 ? -1 : 1) * (tx < 20 ? -1 : tx > 80 ? 1 : 1);
          const gap = (NIGHT_GAP[v.kind] ?? 6) + Math.floor(n / 2) * 4;
          const x = Math.min(95, Math.max(5, tx + side * gap));
          out.set(id, { show: true, x, act: NIGHT_ACT[v.kind], face: toward(x, tx), dim: 1 });
          if (v.kind !== 'heal' && !visible.has(v.target))
            out.set(v.target, { show: true, x: tx, act: 'sit', dim: 0.38, face: toward(tx, x) });
        } else {
          const x = mark(id);
          out.set(id, {
            show: true,
            x,
            act: v ? NIGHT_ACT[v.kind] : id === you.id ? 'idle' : 'cloak',
            face: centre(x),
            dim: id === you.id ? 0.9 : 0.6,
          });
        }
      }
      return out;
    }

    const freshDead = new Set(
      kind === 'dawn'
        ? view.graveyard
            .filter((g) => g.day === view.phase.day - 1 && g.time === 'night')
            .map((g) => g.id)
        : [],
    );
    for (const p of view.players) {
      const x = mark(p.id);
      if (!p.alive) {
        out.set(
          p.id,
          freshDead.has(p.id)
            ? { show: true, x, act: 'lie', dim: 0.9 }
            : { show: false, x, act: 'idle' },
        );
        continue;
      }
      if (kind === 'reveal') {
        out.set(p.id, {
          show: true,
          x,
          act: 'idle',
          dim: p.id === you.id ? 1 : 0.45,
          face: centre(x),
        });
        continue;
      }
      if (defendant && ['defense', 'judgment', 'lastWords', 'execution'].includes(kind)) {
        if (p.id === defendant) {
          out.set(p.id, {
            show: true,
            x: 50,
            z: 0.16,
            act: kind === 'lastWords' ? 'kneel' : 'idle',
            face: x < 50 ? -1 : 1,
          });
        } else {
          const ballot = kind === 'judgment' && view.trial?.voted.includes(p.id);
          out.set(p.id, {
            show: true,
            x: x > 42 && x < 58 ? (x < 50 ? 41 : 59) : x,
            act: ballot ? 'knock' : 'idle',
            dim: 0.72,
            face: toward(x, 50),
          });
        }
        continue;
      }
      const target = view.votes[p.id];
      if (kind === 'voting' && target) {
        out.set(p.id, { show: true, x, act: 'vote', face: toward(x, mark(target)) });
        continue;
      }
      if (kind === 'ended' && view.result) {
        const won = view.result.winners.includes(p.id);
        const act: Act = won ? (view.result.outcome === 'mafia' ? 'bow' : 'vote') : 'idle';
        out.set(p.id, { show: true, x, act, dim: won ? 1 : 0.55, face: centre(x) });
        continue;
      }
      out.set(p.id, { show: true, x, act: 'idle', face: centre(x) });
    }
    return out;
  }

  settle(ms = 700): void {
    const view = this.view;
    if (!view || this.mode !== 'game') return;
    const spots = this.spots(view);
    for (const m of this.members.values()) {
      const s = spots.get(m.id);
      const sh = m.shade;
      sh.flag('ghost', !!s?.ghost);
      if (!s || !s.show) {
        this.stopWalk(sh);
        sh.walk(false);
        sh.go({ dim: 0 }, Math.min(ms, 900));
        continue;
      }
      const wasHidden = sh.dim < 0.05;
      if (wasHidden) {
        // Appear in place rather than walking from wherever the shade was last.
        sh.go({ x: s.x, z: s.z ?? 0 }, 0);
        sh.act(s.act, 0);
        if (s.face) sh.face(s.face);
        sh.go({ dim: s.dim ?? 1 }, Math.min(ms, 900));
        continue;
      }
      if (Math.abs(sh.x - s.x) > 2.5 && ms > 0) {
        const t = sh.walkTo(s.x, { z: s.z ?? 0, dim: s.dim ?? 1 });
        this.afterWalk(sh, t, s.act, s.face);
      } else {
        this.stopWalk(sh);
        sh.walk(false);
        sh.go({ x: s.x, z: s.z ?? 0, dim: s.dim ?? 1 }, ms);
        sh.act(s.act, 260);
        if (s.face) sh.face(s.face);
      }
    }
  }

  private stopWalk(sh: Shade): void {
    const t = this.walkTimers.get(sh);
    if (t) window.clearTimeout(t);
    this.walkTimers.delete(sh);
  }

  private afterWalk(sh: Shade, ms: number, act: Act, face?: 1 | -1): void {
    this.stopWalk(sh);
    const done = () => {
      sh.walk(false);
      sh.act(act, 260);
      if (face) sh.face(face);
      this.walkTimers.delete(sh);
    };
    if (ms <= 0) done();
    else this.walkTimers.set(sh, window.setTimeout(done, ms));
  }

  restLook(ms = 1600): void {
    const view = this.view;
    if (!view) return;
    const kind = view.phase.kind;
    let look: Look = 'day';
    const extra: { hx?: number; lamp?: number; hr?: number } = {};
    if (kind === 'reveal') look = 'reveal';
    else if (kind === 'voting') look = 'voting';
    else if (kind === 'defense' || kind === 'judgment') look = 'trial';
    else if (kind === 'lastWords' || kind === 'execution') look = 'lastWords';
    else if (kind === 'night')
      look = !view.you.alive
        ? 'nightDead'
        : view.you.faction === 'mafia'
          ? 'nightSyndicate'
          : 'night';
    else if (kind === 'dawn') look = 'dawn';
    else if (kind === 'ended') look = view.result ? (view.result.outcome as Look) : 'day';
    if (kind === 'night' && view.you.alive) {
      // The lamp follows you at night, so your own shadow is never lost in the dark edges.
      const x = this.spots(view).get(view.you.id)?.x ?? 50;
      Object.assign(extra, { hx: Math.min(0.85, Math.max(0.15, x / 100)), lamp: 0.52, hr: 0.4 });
    }
    if ((kind === 'defense' || kind === 'judgment' || kind === 'lastWords') && view.trial)
      extra.hx = 0.5;
    this.cloth.look(look, ms, extra);
  }

  // --- overlays -------------------------------------------------------------------

  private syncInset(view: PlayerView): void {
    const id = view.trial?.defendant ?? null;
    const on = !!id && ['defense', 'judgment', 'lastWords'].includes(view.phase.kind);
    if (!on || !id) {
      if (this.insetClose) {
        this.insetClose.c.p.dispose();
        this.insetClose = null;
        this.insetEl.replaceChildren();
        this.insetEl.classList.remove('on');
      }
      return;
    }
    if (this.insetClose?.id === id) return;
    const face = this.faceOf(id);
    if (!face) return;
    this.insetClose?.c.p.dispose();
    const c = closeup(face, { x: 'afraid', z: 1.45, ay: 0.5 });
    this.insetClose = { id, c };
    this.insetEl.replaceChildren(c.el, div('vs-inset-name', this.nameOf(id)));
    this.insetEl.classList.add('on');
  }

  inset(): Close | null {
    return this.insetClose?.c ?? null;
  }

  spirit(text: string, tone: Tone, sub?: string): HTMLElement {
    const el = div(`vs-spirit tone-${tone}`);
    const line = div('vs-spirit-line', text);
    el.append(line);
    if (sub) el.append(div('vs-spirit-sub', sub));
    this.over.append(el);
    return el;
  }

  plate(text: string, kicker?: string, ms = 2600): HTMLElement {
    for (const old of this.over.querySelectorAll('.vs-plate')) old.remove();
    const el = div('vs-plate');
    if (kicker) el.append(div('vs-k', kicker));
    el.append(div('vs-plate-text', text));
    this.over.append(el);
    window.setTimeout(() => {
      el.classList.add('out');
      window.setTimeout(() => el.remove(), 500);
    }, ms);
    return el;
  }

  letter(title: string, body: string, kind: 'will' | 'note' = 'will', ms = 0): HTMLElement {
    for (const old of this.over.querySelectorAll(`.vs-letter.${kind}`)) old.remove();
    const el = div(`vs-letter ${kind}`);
    el.append(div('vs-letter-title', title), div('vs-letter-body', body));
    this.over.append(el);
    requestAnimationFrame(() => el.classList.add('on'));
    if (ms > 0) {
      // A lingering letter stays readable after its sequence ends; a click puts it away.
      el.classList.add('linger');
      el.title = 'Put the letter away';
      const close = () => {
        el.classList.remove('on');
        window.setTimeout(() => el.remove(), 700);
      };
      const timer = window.setTimeout(close, ms);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        window.clearTimeout(timer);
        close();
      });
    }
    return el;
  }

  thread(a: PlayerId, b: PlayerId): void {
    const xa = this.shadeOf(a)?.x ?? this.markOf(a);
    const xb = this.shadeOf(b)?.x ?? this.markOf(b);
    const el = div('vs-thread');
    el.style.left = `${Math.min(xa, xb)}%`;
    el.style.width = `${Math.max(2, Math.abs(xa - xb))}%`;
    el.classList.toggle('rtl', xb < xa);
    this.fx.append(el);
    window.setTimeout(() => el.remove(), 2600);
  }

  candle(id: PlayerId, fx: 'out' | 'flare' | 'dim' | 'lit'): void {
    const li = this.members.get(id)?.li;
    if (!li) return;
    if (fx === 'out') {
      li.classList.remove('snuff');
      void li.offsetWidth;
      li.classList.add('snuff', 'is-dead');
      return;
    }
    if (fx === 'flare') {
      li.classList.remove('flare');
      void li.offsetWidth;
      li.classList.add('flare');
      return;
    }
    li.classList.toggle('dimmed', fx === 'dim');
  }

  clearOver(): void {
    for (const el of [...this.over.children]) if (!el.classList.contains('linger')) el.remove();
    for (const li of this.candles.children) li.classList.remove('dimmed');
  }

  extra(x: number, fig: 'm' | 'w', dim = 1): Shade {
    const s = new Shade(this.shadows, { x, fig, dim: 0 }, () => this.reduced);
    s.go({ dim }, 0);
    this.extras.add(s);
    return s;
  }

  dropExtra(s: Shade, ms = 400): void {
    s.go({ dim: 0 }, ms);
    this.extras.delete(s);
    window.setTimeout(() => s.el.remove(), ms + 50);
  }

  // --- lookups --------------------------------------------------------------------

  faceOf(id: PlayerId): Face | undefined {
    return this.members.get(id)?.face;
  }

  shadeOf(id: PlayerId): Shade | undefined {
    return this.members.get(id)?.shade;
  }

  markOf(id: PlayerId): number {
    return this.members.get(id)?.x ?? 50;
  }

  nameOf(id: PlayerId | null | undefined): string {
    if (this.view) return nameOf(this.view, id);
    return (id && this.members.get(id)?.name) || 'someone';
  }

  pan(id: PlayerId): number {
    return Math.max(-1, Math.min(1, (this.markOf(id) - 50) / 50));
  }

  box(): DOMRect {
    return this.shadows.getBoundingClientRect();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    for (const t of this.walkTimers.values()) window.clearTimeout(t);
    this.insetClose?.c.p.dispose();
    this.film.dispose();
    this.cloth.dispose();
    this.el.remove();
  }
}

export function createStage(audio: GameAudio): Stage {
  return new ScrimStage(audio);
}
