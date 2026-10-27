import type { PlayerId, PlayerView } from '../../engine/index.ts';
import { nightsOf } from '../director/history.ts';
import { createDirector } from '../director/index.ts';
import { h } from '../dom.ts';
import { createChat } from '../hud/chat.ts';
import { createLetters } from '../hud/letters.ts';
import { createPromptBar, type PickState } from '../hud/prompt.ts';
import { createResult } from '../hud/result.ts';
import { createTopBar } from '../hud/topbar.ts';
import { createStage } from '../stage/index.ts';
import type { Frame, UiContext } from './context.ts';

const NO_PICK: PickState = { mode: 'none', targets: [], chosen: [] };
const TICK_MS = 250;

export function gameFrame(ctx: UiContext): Frame {
  const c = ctx.controller;
  const stage = createStage(ctx.audio);
  const director = createDirector(stage, ctx.audio);
  const applyMotion = (on: boolean) => {
    stage.setReducedMotion(on);
    director.setReducedMotion(on);
  };
  applyMotion(ctx.prefs.reducedMotion);
  const unPrefs = ctx.prefs.subscribe(applyMotion);

  let view: PlayerView | null = null;

  const pickState = (): PickState => {
    const v = view;
    if (!v) return NO_PICK;
    const a = v.allowed;
    // A vote outranks an open whisper: during voting the recipient comes from the chat's To field.
    if (a.voteTargets.length) {
      return { mode: 'vote', targets: a.voteTargets, chosen: v.you.vote ? [v.you.vote] : [] };
    }
    if (chat.whisperOpen() && a.whisperTo.length) {
      const to = chat.recipient();
      return { mode: 'whisper', targets: a.whisperTo, chosen: to ? [to] : [] };
    }
    if (a.nightTargets.length) {
      return { mode: 'night', targets: a.nightTargets, chosen: v.you.nightTargets ?? [] };
    }
    return NO_PICK;
  };

  const onPick = (id: PlayerId) => {
    const v = view;
    if (!v) return;
    const p = pickState();
    if (!p.targets.includes(id)) return;
    if (p.mode === 'vote') c.vote(id === v.you.vote ? null : id);
    else if (p.mode === 'night') c.nightAction(p.chosen.includes(id) ? null : [id]);
    else if (p.mode === 'whisper') chat.setRecipient(id);
  };

  const refreshPicks = () => {
    if (!view) return;
    const p = pickState();
    stage.setPick(p.mode, p.targets, p.chosen);
    prompt.update(view, p, chat.whisperOpen());
  };

  const chat = createChat(ctx, { onComposerChange: refreshPicks });
  const letters = createLetters(ctx);
  const top = createTopBar(ctx, { openLetters: () => letters.open() });
  const prompt = createPromptBar(ctx, { pick: onPick, toggleWhisper: () => chat.toggleWhisper() });
  const result = createResult(ctx, {
    replay: () => {
      if (view) director.replay(nightsOf(view));
    },
  });
  stage.onPick(onPick);

  const el = h(
    'main',
    { 'data-testid': 'screen-game', class: 'vx-game' },
    top.el,
    h(
      'section',
      { class: 'vx-stage', 'aria-label': 'Stage' },
      h('div', { class: 'vx-stage-host' }, stage.el),
      top.banner,
      result.el,
    ),
    prompt.el,
    chat.el,
  );
  const interval = setInterval(top.tick, TICK_MS);

  return {
    el,
    update(st) {
      top.update(st);
      const s = st.session;
      const v = s?.view;
      if (!s || !v) return;
      view = v;
      const root = ctx.root.dataset;
      root.phase = v.phase.kind;
      root.faction = v.you.faction;
      root.alive = String(v.you.alive);
      stage.update(v);
      director.feed(v);
      chat.update(v, s);
      letters.update(v);
      result.update(v, s);
      refreshPicks();
    },
    skip: () => director.skip(),
    dispose() {
      clearInterval(interval);
      unPrefs();
      director.dispose();
      stage.dispose();
    },
  };
}
