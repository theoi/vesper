import { ROLES, slotName, type PlayerView } from '../engine/index.ts';
import type { SessionSnapshot } from '../net/index.ts';
import type { AppController, AppState } from './controller.ts';
import { describeEvent, nameOf, phaseLabel, roleName } from './format.ts';

/**
 * Plain, functional placeholder UI. It only reads `AppState` and calls
 * controller methods, so the real UI can replace it wholesale. Elements carry
 * `data-testid` hooks that the e2e tests rely on (see src/app/README.md).
 */

type Attrs = Record<string, string | number | boolean | undefined>;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

const STYLE = `
.vs{font:15px/1.45 system-ui,sans-serif;color:#e9e4f5;background:#09080d;min-height:100vh;margin:0;padding:1.25rem;box-sizing:border-box}
.vs h1{font-weight:300;letter-spacing:.4em;margin:.2em 0 .6em}
.vs section{margin:.8rem 0;padding:.8rem;border:1px solid #2a2635;border-radius:8px;max-width:56rem}
.vs button{font:inherit;background:#221d30;color:inherit;border:1px solid #4a4160;border-radius:6px;padding:.3em .8em;margin:.15em;cursor:pointer}
.vs button:disabled{opacity:.4;cursor:default}
.vs input,.vs select,.vs textarea{font:inherit;background:#120f19;color:inherit;border:1px solid #3a3350;border-radius:6px;padding:.3em .5em;margin:.15em}
.vs textarea{width:100%;max-width:40rem;min-height:4em}
.vs ol,.vs ul{padding-left:1.4em}
.vs [data-testid=log]{max-height:22rem;overflow:auto;font-size:14px}
.vs .dead{opacity:.5;text-decoration:line-through}
.vs .muted{opacity:.6}
.vs .alert{color:#ff9d9d}
.vs .banner{background:#3b2a12;padding:.4em .8em;border-radius:6px}
`;

export function mountShell(root: HTMLElement, controller: AppController): () => void {
  const style = h('style', { text: STYLE });
  document.head.append(style);
  root.classList.add('vs');
  let frame: Frame | null = null;
  let frameKey = '';

  const render = (state: AppState) => {
    const key = frameFor(state);
    if (key !== frameKey) {
      frame?.dispose?.();
      frameKey = key;
      frame = FRAMES[key](controller);
      root.replaceChildren(frame.el);
    }
    frame?.update(state);
  };
  render(controller.getState());
  const unsubscribe = controller.subscribe(render);
  return () => {
    unsubscribe();
    frame?.dispose?.();
    style.remove();
  };
}

interface Frame {
  el: HTMLElement;
  update(state: AppState): void;
  dispose?(): void;
}

type FrameKey = 'home' | 'connecting' | 'notice' | 'lobby' | 'game';

function frameFor(state: AppState): FrameKey {
  const s = state.session;
  if (state.screen === 'home' || !s) return 'home';
  if (s.status === 'closed' || s.status === 'error') return 'notice';
  if (s.status === 'connecting' || !s.lobby) return 'connecting';
  return s.lobby.status === 'open' ? 'lobby' : 'game';
}

const FRAMES: Record<FrameKey, (c: AppController) => Frame> = {
  home: homeFrame,
  connecting: connectingFrame,
  notice: noticeFrame,
  lobby: lobbyFrame,
  game: gameFrame,
};

// -----------------------------------------------------------------------------

function homeFrame(c: AppController): Frame {
  const st = c.getState();
  const name = h('input', {
    'data-testid': 'name-input',
    maxlength: 24,
    placeholder: 'Your name',
    value: st.name,
  });
  const code = h('input', {
    'data-testid': 'code-input',
    placeholder: 'Room code or link',
    value: st.linkCode ?? '',
  });
  const error = h('p', { 'data-testid': 'home-error', role: 'alert', class: 'alert' });
  const needName = () => {
    if (name.value.trim()) return false;
    error.textContent = 'Enter a name first.';
    name.focus();
    return true;
  };
  const hostBtn = h('button', { 'data-testid': 'host-online', text: 'Host a game' });
  const soloBtn = h('button', { 'data-testid': 'host-solo', text: 'Play solo with bots' });
  const joinBtn = h('button', { 'data-testid': 'join', text: 'Join' });
  hostBtn.onclick = () => !needName() && void c.hostRoom(name.value, { online: true });
  soloBtn.onclick = () => !needName() && void c.hostRoom(name.value, { online: false, seats: 7 });
  joinBtn.onclick = () => !needName() && void c.joinRoom(code.value, name.value);
  code.onkeydown = (e) => e.key === 'Enter' && joinBtn.click();
  const el = h(
    'main',
    { 'data-testid': 'screen-home' },
    h('h1', { text: 'VESPER' }),
    h('section', {}, h('label', {}, 'Name ', name)),
    h('section', {}, hostBtn, soloBtn),
    h('section', {}, h('label', {}, 'Join a friend ', code), joinBtn),
    error,
  );
  if (st.linkCode) setTimeout(() => (name.value ? joinBtn.focus() : name.focus()));
  return {
    el,
    update: (s) => {
      error.textContent = s.homeError ?? '';
    },
  };
}

function connectingFrame(c: AppController): Frame {
  const msg = h('p', { 'data-testid': 'connecting' });
  const cancel = h('button', { 'data-testid': 'leave', text: 'Cancel' });
  cancel.onclick = () => c.leaveRoom();
  return {
    el: h('main', { 'data-testid': 'screen-connecting' }, h('h1', { text: 'VESPER' }), msg, cancel),
    update: (s) => {
      msg.textContent = `Connecting to room ${s.session?.code ?? ''}…`;
    },
  };
}

function noticeFrame(c: AppController): Frame {
  const msg = h('p', { 'data-testid': 'notice', role: 'alert' });
  const home = h('button', { 'data-testid': 'go-home', text: 'Back to start' });
  home.onclick = () => c.goHome();
  return {
    el: h('main', { 'data-testid': 'screen-notice' }, h('h1', { text: 'VESPER' }), msg, home),
    update: (s) => {
      msg.textContent = s.session?.notice?.message ?? 'The room is closed.';
      msg.dataset.code = s.session?.notice?.code ?? '';
    },
  };
}

function banner(s: SessionSnapshot | null): string {
  if (!s) return '';
  if (s.status === 'reconnecting') return 'Connection lost. Reconnecting…';
  if (s.isHost && s.network.state === 'error')
    return `Friends can't join: ${s.network.error.message}`;
  return '';
}

function lobbyFrame(c: AppController): Frame {
  const code = h('code', { 'data-testid': 'room-code' });
  const link = h('input', { 'data-testid': 'room-link', readonly: true, size: 44 });
  const copy = h('button', { 'data-testid': 'copy-link', text: 'Copy link' });
  copy.onclick = () => void navigator.clipboard?.writeText(link.value).catch(() => undefined);
  const net = h('span', { 'data-testid': 'network-status', class: 'muted' });
  const bannerEl = h('p', { 'data-testid': 'banner', class: 'banner', hidden: true });
  const seats = h('ol', { 'data-testid': 'seats' });
  const seatCount = h('span', { 'data-testid': 'seat-count' });
  const addBot = h('button', { 'data-testid': 'add-bot', text: 'Add bot' });
  addBot.onclick = () => c.addBot();
  const fillCount = h('select', { 'data-testid': 'fill-count' });
  for (let n = 4; n <= 16; n++) fillCount.append(h('option', { value: n, text: `${n} seats` }));
  fillCount.value = '7';
  const fill = h('button', { 'data-testid': 'fill-bots', text: 'Fill with bots' });
  fill.onclick = () => c.fillWithBots(Number(fillCount.value));
  const pace = h(
    'select',
    { 'data-testid': 'pace' },
    h('option', { value: 'standard', text: 'Standard pace' }),
    h('option', { value: 'fast', text: 'Fast pace' }),
  );
  pace.onchange = () => c.updateSettings({ pace: pace.value === 'fast' ? 'fast' : 'standard' });
  const roles = h('ol', { 'data-testid': 'role-list' });
  const validation = h('p', { 'data-testid': 'validation', class: 'alert' });
  const start = h('button', { 'data-testid': 'start', text: 'Start game' });
  const startError = h('p', { 'data-testid': 'start-error', class: 'alert' });
  start.onclick = () => {
    startError.textContent = c.start() ?? '';
  };
  const waiting = h('p', { 'data-testid': 'waiting', text: 'Waiting for the host to start…' });
  const rename = h('input', { 'data-testid': 'rename-input', maxlength: 24 });
  const renameBtn = h('button', { 'data-testid': 'rename', text: 'Change name' });
  renameBtn.onclick = () => rename.value.trim() && c.rename(rename.value);
  const leave = h('button', { 'data-testid': 'leave', text: 'Leave room' });
  leave.onclick = () => c.leaveRoom();
  const hostControls = h('div', {}, addBot, fillCount, fill);

  const el = h(
    'main',
    { 'data-testid': 'screen-lobby' },
    h('h1', { text: 'VESPER' }),
    h('section', {}, 'Room ', code, ' ', link, copy, ' ', net),
    bannerEl,
    h('section', {}, h('h2', {}, 'Seats (', seatCount, ')'), seats, hostControls),
    h('section', {}, h('h2', { text: 'Setup' }), pace, roles, validation),
    h('section', {}, start, startError, waiting),
    h('section', {}, rename, renameBtn, ' ', leave),
  );

  return {
    el,
    update: (st) => {
      const s = st.session;
      const lobby = s?.lobby;
      if (!s || !lobby) return;
      const isHost = s.isHost;
      code.textContent = s.code;
      link.value = st.link ?? '';
      link.hidden = copy.hidden = !st.link;
      net.textContent = isHost
        ? {
            offline: 'Offline (solo)',
            opening: 'Opening room…',
            open: 'Open for friends',
            error: 'Not reachable',
          }[s.network.state]
        : '';
      const b = banner(s);
      bannerEl.textContent = b;
      bannerEl.hidden = !b;
      seatCount.textContent = `${lobby.seats.length}/${lobby.maxSeats}`;
      seats.replaceChildren(
        ...lobby.seats.map((seat, i) => {
          const remove =
            isHost && seat.kind !== 'host'
              ? h('button', {
                  'data-testid': `remove-${i}`,
                  text: seat.kind === 'bot' ? 'Remove' : 'Kick',
                })
              : null;
          if (remove) remove.onclick = () => c.removeSeat(seat.id);
          const tags = [
            seat.kind === 'host' ? 'host' : seat.kind === 'bot' ? 'bot' : '',
            seat.id === s.you ? 'you' : '',
            seat.kind === 'human' && !seat.connected ? 'disconnected' : '',
          ].filter(Boolean);
          return h(
            'li',
            { 'data-testid': `seat-${i}`, 'data-player-id': seat.id, 'data-kind': seat.kind },
            seat.name,
            tags.length ? h('span', { class: 'muted', text: ` (${tags.join(', ')})` }) : null,
            ' ',
            remove,
          );
        }),
      );
      hostControls.hidden = !isHost;
      pace.disabled = !isHost;
      pace.value = lobby.settings.pace;
      roles.replaceChildren(...lobby.roles.map((r) => h('li', { text: slotName(r) })));
      validation.textContent = [...lobby.validation.errors, ...lobby.validation.warnings].join(' ');
      start.hidden = !isHost;
      start.disabled = !lobby.validation.ok;
      startError.hidden = !isHost;
      waiting.hidden = isHost;
      if (document.activeElement !== rename) {
        rename.value = lobby.seats.find((x) => x.id === s.you)?.name ?? '';
      }
    },
  };
}

function gameFrame(c: AppController): Frame {
  const phase = h('strong', { 'data-testid': 'phase' });
  const timer = h('span', { 'data-testid': 'timer', class: 'muted' });
  const bannerEl = h('p', { 'data-testid': 'banner', class: 'banner', hidden: true });
  const roleCard = h('section', { 'data-testid': 'role-card' });
  const players = h('ul', { 'data-testid': 'players' });
  const trial = h('section', { 'data-testid': 'trial', hidden: true });
  const ready = h('button', { 'data-testid': 'ready' });
  const reveal = h('button', { 'data-testid': 'reveal', text: 'Reveal as Magistrate' });
  reveal.onclick = () => c.reveal();
  const clearVote = h('button', { 'data-testid': 'clear-vote', text: 'Withdraw vote' });
  clearVote.onclick = () => c.vote(null);
  const clearNight = h('button', { 'data-testid': 'clear-night', text: 'Cancel night action' });
  clearNight.onclick = () => c.nightAction(null);
  const channel = h('select', { 'data-testid': 'chat-channel' });
  const chatInput = h('input', { 'data-testid': 'chat-input', size: 50, maxlength: 300 });
  const send = h('button', { 'data-testid': 'chat-send', text: 'Send' });
  const doSend = () => {
    const text = chatInput.value.trim();
    if (!text || !channel.value) return;
    c.chat(channel.value as 'public' | 'mafia' | 'dead', text);
    chatInput.value = '';
  };
  send.onclick = doSend;
  chatInput.onkeydown = (e) => e.key === 'Enter' && doSend();
  const log = h('ol', { 'data-testid': 'log' });
  const will = h('textarea', { 'data-testid': 'will-input', maxlength: 800 });
  const willSave = h('button', { 'data-testid': 'will-save', text: 'Save will' });
  willSave.onclick = () => c.setWill(will.value);
  const note = h('textarea', { 'data-testid': 'deathnote-input', maxlength: 300 });
  const noteSave = h('button', { 'data-testid': 'deathnote-save', text: 'Save death note' });
  noteSave.onclick = () => c.setDeathNote(note.value);
  const noteBox = h('div', { hidden: true }, h('h3', { text: 'Death note' }), note, noteSave);
  const result = h('section', { 'data-testid': 'result', hidden: true });
  const back = h('button', { 'data-testid': 'back-to-lobby', text: 'Back to lobby', hidden: true });
  back.onclick = () => c.backToLobby();
  const rejection = h('p', { 'data-testid': 'rejection', role: 'alert', class: 'alert' });
  const leave = h('button', { 'data-testid': 'leave', text: 'Leave game' });
  leave.onclick = () => c.leaveRoom();

  const el = h(
    'main',
    { 'data-testid': 'screen-game' },
    h('section', {}, phase, ' ', timer),
    bannerEl,
    roleCard,
    h('section', {}, h('h2', { text: 'Players' }), players, clearVote, clearNight),
    trial,
    h('section', {}, ready, reveal),
    h('section', {}, channel, chatInput, send, rejection, log),
    h('section', {}, h('h3', { text: 'Last will' }), will, willSave, noteBox),
    result,
    h('section', {}, back, leave),
  );

  let rendered = 0;
  let renderedFirstSeq = -1;
  let last: AppState | null = null;
  let lastRejectionId = 0;
  const tickTimer = () => {
    const s = last?.session;
    const endsAt = s?.view?.phase.endsAt;
    if (!s || !endsAt) {
      timer.textContent = '';
      return;
    }
    const left = Math.max(0, Math.ceil((endsAt - (Date.now() + s.clockOffset)) / 1000));
    timer.textContent = `${left}s`;
  };
  const interval = setInterval(tickTimer, 250);

  return {
    el,
    dispose: () => clearInterval(interval),
    update: (st) => {
      last = st;
      const s = st.session;
      const view = s?.view;
      const b = banner(s);
      bannerEl.textContent = b;
      bannerEl.hidden = !b;
      if (!s || !view) {
        phase.textContent = 'Starting…';
        return;
      }
      phase.textContent = phaseLabel(view);
      tickTimer();
      renderRole(roleCard, view);
      renderPlayers(players, view, c);
      renderTrial(trial, view, c);

      ready.hidden = !view.allowed.ready;
      ready.textContent = view.you.ready ? 'Not ready' : 'Ready';
      ready.onclick = () => c.ready(!view.you.ready);
      reveal.hidden = !view.allowed.reveal;
      clearVote.hidden = !view.you.vote;
      clearNight.hidden = !view.you.nightTargets || view.allowed.nightTargets.length === 0;

      const chans = view.allowed.chat;
      const current = channel.value;
      if (channel.dataset.chans !== chans.join()) {
        channel.dataset.chans = chans.join();
        channel.replaceChildren(
          ...chans.map((ch) =>
            h('option', {
              value: ch,
              text: ch === 'mafia' ? 'Syndicate' : ch === 'dead' ? 'Dead' : 'Public',
            }),
          ),
        );
        if (chans.includes(current as never)) channel.value = current;
      }
      chatInput.disabled = send.disabled = chans.length === 0;

      const events = view.events;
      const firstSeq = events[0]?.seq ?? -1;
      if (events.length < rendered || firstSeq !== renderedFirstSeq) {
        log.replaceChildren();
        rendered = 0;
        renderedFirstSeq = firstSeq;
      }
      for (const e of events.slice(rendered)) {
        const text = describeEvent(view, e);
        if (text) log.append(h('li', { 'data-type': e.type, 'data-seq': e.seq, text }));
      }
      if (events.length > rendered) log.scrollTop = log.scrollHeight;
      rendered = events.length;

      will.disabled = willSave.disabled = !view.allowed.will;
      if (document.activeElement !== will) will.value = view.you.will;
      noteBox.hidden = !ROLES[view.you.role].deathNote;
      note.disabled = noteSave.disabled = !view.allowed.deathNote;
      if (document.activeElement !== note) note.value = view.you.deathNote;

      const rej = s.lastRejection;
      if (rej && rej.id !== lastRejectionId) {
        lastRejectionId = rej.id;
        rejection.textContent = rej.error;
        setTimeout(() => {
          if (rejection.textContent === rej.error) rejection.textContent = '';
        }, 4000);
      }

      result.hidden = !view.result;
      if (view.result) {
        const winners = view.result.winners.map((id) => nameOf(view, id)).join(', ') || 'nobody';
        result.replaceChildren(
          h('h2', { text: `Winner: ${view.result.outcome}` }),
          h('p', { text: `Winners: ${winners}` }),
          h(
            'ul',
            {},
            ...view.players.map((p) => h('li', { text: `${p.name}: ${roleName(p.role)}` })),
          ),
        );
      }
      back.hidden = !(s.isHost && s.status === 'ended');
    },
  };
}

function renderRole(el: HTMLElement, view: PlayerView): void {
  const role = ROLES[view.you.role];
  const key = `${view.you.role}|${view.you.alive}|${view.you.teammates.map((t) => t.id + t.alive).join()}`;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  const parts: (Node | null)[] = [
    h('h2', { 'data-testid': 'you-role', 'data-role': role.id, text: role.name }),
    h('p', { text: `${role.goal} ${role.summary}` }),
    view.you.teammates.length
      ? h(
          'p',
          { 'data-testid': 'teammates' },
          `Syndicate: ${view.you.teammates.map((t) => `${t.name} (${roleName(t.role)})${t.alive ? '' : ' †'}`).join(', ')}`,
        )
      : null,
    view.you.accuserTarget
      ? h('p', { text: `Your target: ${nameOf(view, view.you.accuserTarget)}` })
      : null,
    view.you.alive
      ? null
      : h('p', { class: 'alert', text: 'You are dead. You can talk with the dead.' }),
  ];
  el.replaceChildren(...parts.filter((p): p is Node => p !== null));
}

function renderPlayers(el: HTMLElement, view: PlayerView, c: AppController): void {
  const voteSet = new Set(view.allowed.voteTargets);
  const nightSet = new Set(view.allowed.nightTargets);
  const tally = new Map<string, number>();
  for (const target of Object.values(view.votes)) tally.set(target, (tally.get(target) ?? 0) + 1);
  el.replaceChildren(
    ...view.players.map((p) => {
      const voteBtn = voteSet.has(p.id)
        ? h('button', {
            'data-testid': `vote-${p.seat}`,
            text: view.you.vote === p.id ? 'Voted' : 'Vote',
            disabled: view.you.vote === p.id,
          })
        : null;
      if (voteBtn) voteBtn.onclick = () => c.vote(p.id);
      const nightBtn = nightSet.has(p.id)
        ? h('button', {
            'data-testid': `night-${p.seat}`,
            text: view.you.nightTargets?.includes(p.id)
              ? 'Chosen'
              : (view.allowed.nightAction ?? 'Act'),
            disabled: view.you.nightTargets?.includes(p.id) ?? false,
          })
        : null;
      if (nightBtn) nightBtn.onclick = () => c.nightAction([p.id]);
      const votes = tally.get(p.id);
      return h(
        'li',
        {
          'data-testid': `player-${p.seat}`,
          'data-player-id': p.id,
          'data-alive': p.alive,
          class: p.alive ? '' : 'dead',
        },
        p.name,
        h('span', {
          class: 'muted',
          text: [
            p.id === view.you.id ? ' (you)' : '',
            p.isBot ? ' (bot)' : '',
            p.role ? ` · ${roleName(p.role)}` : '',
            votes ? ` · ${votes} vote${votes > 1 ? 's' : ''}` : '',
          ].join(''),
        }),
        ' ',
        voteBtn,
        nightBtn,
      );
    }),
  );
  if (view.phase.kind === 'voting') {
    el.append(
      h('li', { class: 'muted', text: `${view.voteThreshold} votes put someone on trial.` }),
    );
  }
}

function renderTrial(el: HTMLElement, view: PlayerView, c: AppController): void {
  el.hidden = !view.trial;
  if (!view.trial) return;
  const judge = (ballot: 'guilty' | 'innocent' | 'abstain', label: string) => {
    const b = h('button', {
      'data-testid': `judge-${ballot}`,
      text: view.you.ballot === ballot ? `${label} ✓` : label,
      disabled: !view.allowed.judge,
    });
    b.onclick = () => c.judge(ballot);
    return b;
  };
  el.replaceChildren(
    h('h2', { text: `On trial: ${nameOf(view, view.trial.defendant)}` }),
    h('p', { class: 'muted', text: `${view.trial.voted.length} have voted.` }),
    judge('guilty', 'Guilty'),
    judge('innocent', 'Innocent'),
    judge('abstain', 'Abstain'),
  );
}
