import { ROLES, type PlayerId, type PlayerView } from '../../engine/index.ts';
import type { AudioScene, DirectorApi, GameAudio } from '../contracts.ts';
import type { Stage } from '../stage/index.ts';
import { newMemo, plan, SKIPPABLE, type Beat, type Memo, type SeqSpec } from './plan.ts';
import { runSequence, Skip, Take } from './sequences.ts';

/** Sequences that may play when the director joins a game already under way. */
const CATCH_UP_MS = 20_000;

function sceneFor(view: PlayerView): AudioScene {
  switch (view.phase.kind) {
    case 'reveal':
      return 'lobby';
    case 'discussion':
      return 'day';
    case 'voting':
      return 'voting';
    case 'defense':
    case 'judgment':
    case 'lastWords':
    case 'execution':
      return 'trial';
    case 'night':
      return !view.you.alive
        ? 'nightDead'
        : view.you.faction === 'mafia'
          ? 'nightSyndicate'
          : 'night';
    case 'dawn':
      return 'dawn';
    case 'ended':
      return 'end';
  }
}

function tensionFor(view: PlayerView): number {
  const kind = view.phase.kind;
  if (kind === 'voting') {
    const tally = new Map<PlayerId, number>();
    for (const t of Object.values(view.votes)) tally.set(t, (tally.get(t) ?? 0) + 1);
    const most = Math.max(0, ...tally.values());
    return Math.min(1, most / Math.max(1, view.voteThreshold));
  }
  if (kind === 'defense') return 0.55;
  if (kind === 'judgment') {
    const alive = view.players.filter((p) => p.alive).length;
    return Math.min(1, 0.6 + (0.4 * (view.trial?.voted.length ?? 0)) / Math.max(1, alive - 1));
  }
  if (kind === 'lastWords' || kind === 'execution') return 1;
  return 0;
}

/**
 * Reads the events each new view brings and stages them: continuous beats (speech, votes,
 * whispers, ballots) right away, and short sequences (deal, nightfall, dawn, trial, verdict,
 * deaths, finale) one at a time. A sequence never blocks play; when they pile up, the
 * director speeds them up and drops the ones that no longer matter.
 */
class Director implements DirectorApi {
  private cursor = 0;
  private gameKey = '';
  private memo: Memo = newMemo('');
  private queue: SeqSpec[] = [];
  private take: Take | null = null;
  private view: PlayerView | null = null;
  private scene: AudioScene | null = null;
  private ambient = 0;
  private reduced = false;
  private disposed = false;
  private speakTimers = new Map<PlayerId, number>();
  /** Voters who have stomped in the current trial (a changed ballot does not stomp again). */
  private stomped = new Set<string>();

  constructor(
    private readonly stage: Stage,
    private readonly audio: GameAudio,
  ) {
    stage.onSkip(() => this.skip());
    this.scheduleAmbient();
  }

  feed(view: PlayerView): void {
    if (this.disposed) return;
    this.view = view;
    const start = view.events.find((e) => e.type === 'gameStart');
    const key = `${start?.at ?? 0}:${view.players.map((p) => p.id).join()}:${view.you.id}`;
    if (key !== this.gameKey) {
      this.reset(key);
      const last = view.events.at(-1);
      // Joined (or reloaded) mid-game: only stage what happens from now on.
      if (!start || (last && last.at - start.at > CATCH_UP_MS)) this.cursor = view.lastSeq;
    }
    const fresh = view.events.filter((e) => e.seq > this.cursor);
    this.cursor = Math.max(this.cursor, view.lastSeq);
    if (fresh.length) {
      for (const step of plan(fresh, view, this.memo)) {
        if (step.kind === 'beat') this.beat(step.beat, view);
        else this.enqueue(step.seq);
      }
    }
    const scene = sceneFor(view);
    if (scene !== this.scene && scene !== 'end') {
      this.scene = scene;
      this.audio.setScene(scene);
    }
    this.audio.setTension(tensionFor(view));
    this.pump();
  }

  private reset(key: string): void {
    this.take?.skip();
    this.queue = [];
    this.gameKey = key;
    this.memo = newMemo(key);
    this.cursor = 0;
    this.scene = null;
  }

  // --- beats: immediate, small ------------------------------------------------------

  private beat(b: Beat, view: PlayerView): void {
    const s = this.stage;
    const playing = this.take !== null;
    switch (b.type) {
      case 'speak': {
        this.audio.cue('chat', { pan: s.pan(b.who), gain: 0.6 });
        const inset = s.inset();
        if (inset && view.trial?.defendant === b.who)
          inset.p.talk(Math.min(4000, 600 + b.text.length * 45));
        if (playing) return;
        const sh = s.shadeOf(b.who);
        if (!sh) return;
        sh.speak(Math.min(2400, 900 + b.text.length * 25));
        const act = b.act;
        if (act?.kind === 'accuse' && view.phase.kind !== 'night') {
          const target = s.shadeOf(act.target);
          sh.act('accuse', 200);
          sh.face(s.markOf(act.target) >= sh.x ? 1 : -1);
          target?.act('recoil', 250);
          this.later(b.who, 1900, () => {
            if (!this.take) s.settle(400);
          });
        } else if (act?.kind === 'claim') {
          s.plate(`“I am the ${ROLES[act.role].name}.”`, s.nameOf(b.who), 2600);
          this.audio.cue('claim', { pan: s.pan(b.who) });
        }
        return;
      }
      case 'whisper':
        if (!playing) s.thread(b.from, b.to);
        this.audio.cue('whisper', { pan: (s.pan(b.from) + s.pan(b.to)) / 2 });
        return;
      case 'vote':
        this.audio.cue(b.target ? 'knock' : 'unknock', { pan: s.pan(b.voter) });
        return;
      case 'ballot': {
        const key = `${view.phase.day}:${view.trial?.number ?? 0}:${b.voter}`;
        if (this.stomped.has(key)) return;
        this.stomped.add(key);
        this.audio.cue('stomp', { pan: s.pan(b.voter) });
        const inset = s.inset();
        if (inset) {
          inset.p.flinch();
          inset.zoom(Math.min(2.4, 1.45 + 0.1 * (view.trial?.voted.length ?? 0)));
        }
        return;
      }
      case 'votingOpen':
        if (!playing)
          s.plate(
            `The vote is open. ${b.need} to put someone on trial.`,
            `Day ${view.phase.day}`,
            3000,
          );
        this.audio.cue('knock', { variant: 0 });
        this.audio.cue('knock', { variant: 1, delay: 0.32 });
        return;
      case 'night':
        if (!playing) {
          s.settle(1200);
          s.restLook(1400);
        }
        this.audio.cue('creep', { pan: s.pan(view.you.id), gain: 0.7 });
        return;
    }
  }

  private later(id: PlayerId, ms: number, fn: () => void): void {
    const old = this.speakTimers.get(id);
    if (old) window.clearTimeout(old);
    this.speakTimers.set(
      id,
      window.setTimeout(() => {
        this.speakTimers.delete(id);
        fn();
      }, ms),
    );
  }

  // --- sequences: queued, one at a time ----------------------------------------------

  private enqueue(q: SeqSpec): void {
    this.queue.push(q);
    // Falling behind: drop phase openers that the game has moved past, and hurry the rest.
    if (this.queue.length > 1) {
      const last = this.queue.length - 1;
      this.queue = this.queue.filter((x, i) => i === last || !SKIPPABLE.has(x.id));
    }
    if (this.take && this.queue.length > 0) this.take.speed = Math.max(this.take.speed, 1.8);
  }

  private pump(): void {
    if (this.take || this.disposed) return;
    const q = this.queue.shift();
    if (!q) return;
    const s = this.stage;
    const t = new Take(s);
    if (this.queue.length > 0) t.speed = 1.6;
    this.take = t;
    s.hold(true);
    s.el.classList.add('playing');
    runSequence(t, s, this.audio, q)
      .catch((e: unknown) => {
        if (!(e instanceof Skip)) console.error('Sequence failed', q.id, e);
      })
      .finally(() => {
        t.end();
        if (this.disposed) return;
        s.film.clear(t.skipped ? 0 : 260);
        s.clearOver();
        s.hold(false);
        s.el.classList.remove('playing');
        this.take = null;
        s.settle(t.skipped ? 300 : 900);
        s.restLook(t.skipped ? 400 : 1200);
        this.pump();
      });
  }

  skip(): void {
    this.take?.skip();
  }

  // --- night life: strangers cross the cloth now and then (never tied to real actions) --

  private scheduleAmbient(): void {
    window.clearTimeout(this.ambient);
    this.ambient = window.setTimeout(() => this.stranger(), 7000 + Math.random() * 7000);
  }

  private stranger(): void {
    if (this.disposed) return;
    this.scheduleAmbient();
    const view = this.view;
    if (!view || view.phase.kind !== 'night' || this.take || this.reduced) return;
    const s = this.stage;
    const ltr = Math.random() < 0.5;
    const z = Math.random() * 0.3;
    const e = s.extra(ltr ? -14 : 114, Math.random() < 0.5 ? 'm' : 'w', 0.55 - z * 0.6);
    const act =
      (['cloak', 'creep', 'walk', 'lantern'] as const)[Math.floor(Math.random() * 4)] ?? 'cloak';
    e.go({ z }, 0);
    e.act(act, 0);
    const ms = e.walkTo(ltr ? 114 : -14, { speed: 9 + Math.random() * 10, act });
    this.audio.cue('creep', { pan: ltr ? -0.7 : 0.7, gain: 0.5 });
    window.setTimeout(() => s.dropExtra(e, 200), ms + 100);
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on;
    this.stage.setReducedMotion(on);
  }

  dispose(): void {
    this.disposed = true;
    this.take?.skip();
    window.clearTimeout(this.ambient);
    for (const t of this.speakTimers.values()) window.clearTimeout(t);
  }
}

export function createDirector(stage: Stage, audio: GameAudio): DirectorApi {
  return new Director(stage, audio);
}
