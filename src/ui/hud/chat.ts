import { describeEvent, nameOf, roleName } from '../../app/format.ts';
import { fill } from '../../content/index.ts';
import type { GameEvent, PlayerId, PlayerView } from '../../engine/index.ts';
import type { SessionSnapshot } from '../../net/index.ts';
import { h, setText, show } from '../dom.ts';
import type { UiContext } from '../screens/context.ts';

type Channel = 'public' | 'mafia' | 'dead' | 'whisper';

const LABEL: Record<Channel, string> = {
  public: 'Town',
  mafia: fill('{mafia}'),
  dead: 'Séance',
  whisper: 'Whisper',
};

const PLACEHOLDER: Record<Exclude<Channel, 'whisper'>, string> = {
  public: 'Speak to the town…',
  mafia: fill('Murmur to the {mafia}…'),
  dead: 'Speak to the séance…',
};

const CHAT_CUE_GAP_MS = 400;
const STICK_PX = 80;

/** One feed line. Its text matches `describeEvent`, which tests and logs rely on. */
function feedItem(view: PlayerView, e: GameEvent): HTMLLIElement | null {
  const text = describeEvent(view, e);
  if (!text) return null;
  const li = h('li', { 'data-type': e.type, 'data-seq': e.seq });
  const secret = e.audience !== 'all';
  if (e.type === 'chat') {
    const who = e.from ? nameOf(view, e.from) : (e.fromLabel ?? 'someone');
    const where =
      e.channel === 'public'
        ? ''
        : e.channel === 'whisper'
          ? ` (whisper to ${nameOf(view, e.to)})`
          : ` [${e.channel === 'mafia' ? 'Syndicate' : 'dead'}]`;
    li.className = `ln ln-chat ch-${e.channel}${e.from === view.you.id ? ' is-mine' : ''}`;
    li.append(h('span', { class: 'ln-who', text: who }));
    if (where) li.append(h('span', { class: 'ln-where', text: where }));
    li.append(
      h('span', { class: 'ln-sep', text: ': ' }),
      h('span', { class: 'ln-text', text: e.text }),
    );
    return li;
  }
  li.className = `ln ln-sys ln-${e.type}${secret ? ' is-secret' : ''}`;
  const willAt = e.type === 'death' && e.will ? text.indexOf(' Their will: ') : -1;
  if (willAt >= 0) {
    li.append(
      h('span', { text: text.slice(0, willAt) }),
      h('span', { class: 'ln-will', text: text.slice(willAt) }),
    );
  } else {
    li.textContent = text;
  }
  return li;
}

export interface ChatPanel {
  el: HTMLElement;
  update(view: PlayerView, session: SessionSnapshot): void;
  whisperOpen(): boolean;
  recipient(): PlayerId | null;
  setRecipient(id: PlayerId | null): void;
  toggleWhisper(): void;
}

export function createChat(ctx: UiContext, opts: { onComposerChange(): void }): ChatPanel {
  const c = ctx.controller;
  const mates = h('section', { 'data-testid': 'teammates', class: 'vx-mates', hidden: true });
  const target = h('p', { class: 'vx-secret-target', hidden: true });
  const tabs = h('div', { class: 'vx-tabs', role: 'tablist', 'aria-label': 'Chat channel' });
  // Kept as a real <select> so scripts and tests can set the channel; the tabs mirror it.
  const channel = h('select', {
    'data-testid': 'chat-channel',
    class: 'vx-sr',
    'aria-hidden': 'true',
    tabindex: -1,
  });
  const log = h('ol', { 'data-testid': 'log', class: 'vx-feed', 'aria-live': 'polite' });
  const toSelect = h('select', { class: 'vx-whisper-to', 'aria-label': 'Whisper to' });
  const toRow = h(
    'div',
    { class: 'vx-whisper-row', hidden: true },
    h('span', { text: 'To' }),
    toSelect,
  );
  const input = h('input', {
    'data-testid': 'chat-input',
    class: 'vx-chat-input',
    maxlength: 300,
    autocomplete: 'off',
    'aria-label': 'Message',
  });
  const send = h('button', {
    type: 'button',
    'data-testid': 'chat-send',
    class: 'tk tk-primary vx-send',
    text: 'Send',
  });
  const rejection = h('p', { 'data-testid': 'rejection', role: 'alert', class: 'vx-rejection' });
  const seanceList = h('ul', { class: 'vx-seance-list' });
  const seance = h(
    'section',
    { class: 'vx-seance', hidden: true },
    h('h3', { text: 'The séance' }),
    seanceList,
  );

  let view: PlayerView | null = null;
  let current: Channel | null = null;
  let tabsKey: string | null = null;
  let rcpt: PlayerId | null = null;
  let phaseKey = '';
  let rendered = 0;
  let renderedFirstSeq = -1;
  let lastCue = 0;
  let lastRejectionId = 0;
  let rejectionTimer: ReturnType<typeof setTimeout> | undefined;

  const showRejection = (text: string) => {
    rejection.textContent = text;
    clearTimeout(rejectionTimer);
    rejectionTimer = setTimeout(() => {
      if (rejection.textContent === text) rejection.textContent = '';
    }, 4000);
  };

  const syncComposer = () => {
    for (const b of tabs.querySelectorAll<HTMLButtonElement>('button')) {
      const on = b.dataset.ch === current;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    if (channel.value !== (current ?? '')) channel.value = current ?? '';
    show(toRow, current === 'whisper');
    if (toSelect.value !== (rcpt ?? '')) toSelect.value = rcpt ?? '';
    input.disabled = send.disabled = current === null;
    input.placeholder =
      current === null
        ? 'You cannot speak right now.'
        : current === 'whisper'
          ? rcpt && view
            ? `Whisper to ${nameOf(view, rcpt)}…`
            : 'Choose who to whisper to…'
          : PLACEHOLDER[current];
    el.dataset.channel = current ?? 'none';
  };

  const setChannel = (ch: Channel | null) => {
    if (ch === current) return;
    const wasWhisper = current === 'whisper';
    current = ch;
    syncComposer();
    if (wasWhisper !== (ch === 'whisper')) opts.onComposerChange();
  };

  const setRecipient = (id: PlayerId | null) => {
    rcpt = id;
    syncComposer();
    opts.onComposerChange();
  };

  // Whisper mode is a short aside: it ends once the whisper is sent or the phase moves on,
  // so a later candle click never goes to a recipient picker by surprise.
  const closeWhisper = () => {
    if (current !== 'whisper') return;
    rcpt = null;
    setChannel(view?.allowed.chat[0] ?? null);
  };

  channel.onchange = () => setChannel((channel.value || null) as Channel | null);
  toSelect.onchange = () => setRecipient(toSelect.value || null);

  const doSend = () => {
    const text = input.value.trim();
    if (!text || !current) return;
    if (current === 'whisper') {
      if (!rcpt) {
        showRejection('Choose who to whisper to first.');
        return;
      }
      c.whisper(rcpt, text);
      closeWhisper();
    } else {
      c.chat(current, text);
    }
    input.value = '';
    log.dataset.stick = '1';
  };
  send.onclick = doSend;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') doSend();
  };
  log.onscroll = () => {
    log.dataset.stick = log.scrollHeight - log.scrollTop - log.clientHeight < STICK_PX ? '1' : '';
  };

  const el = h(
    'aside',
    { class: 'vx-chat', 'aria-label': 'Talk' },
    mates,
    target,
    h('div', { class: 'vx-chat-head' }, tabs, channel),
    log,
    h(
      'div',
      { class: 'vx-compose' },
      toRow,
      h('div', { class: 'vx-compose-row' }, input, send),
      rejection,
    ),
    seance,
  );

  const renderTabs = (v: PlayerView) => {
    const chans: Channel[] = [...v.allowed.chat];
    if (v.allowed.whisperTo.length) chans.push('whisper');
    const key = chans.join();
    if (key !== tabsKey) {
      tabsKey = key;
      channel.replaceChildren(...chans.map((ch) => h('option', { value: ch, text: LABEL[ch] })));
      tabs.replaceChildren(
        ...chans.map((ch) => {
          const b = h('button', {
            type: 'button',
            role: 'tab',
            class: `vx-tab ch-${ch}`,
            'data-ch': ch,
            text: LABEL[ch],
          });
          b.onclick = () => {
            setChannel(ch);
            input.focus();
          };
          return b;
        }),
      );
      if (!chans.length) {
        tabs.append(h('span', { class: 'vx-tabs-none', text: "You can't speak now" }));
      }
    }
    const next = current && chans.includes(current) ? current : (v.allowed.chat[0] ?? null);
    if (rcpt && !v.allowed.whisperTo.includes(rcpt)) rcpt = null;
    const names = v.allowed.whisperTo.map((id) => `${id}:${nameOf(v, id)}`).join();
    if (toSelect.dataset.key !== names) {
      toSelect.dataset.key = names;
      toSelect.replaceChildren(
        h('option', { value: '', text: 'Choose…' }),
        ...v.allowed.whisperTo.map((id) => h('option', { value: id, text: nameOf(v, id) })),
      );
    }
    if (next !== current) setChannel(next);
    else syncComposer();
  };

  const renderFeed = (v: PlayerView) => {
    const events = v.events;
    const firstSeq = events[0]?.seq ?? -1;
    const initial = rendered === 0 || events.length < rendered || firstSeq !== renderedFirstSeq;
    if (events.length < rendered || firstSeq !== renderedFirstSeq) {
      log.replaceChildren();
      rendered = 0;
      renderedFirstSeq = firstSeq;
    }
    const stick = log.dataset.stick !== '';
    for (const e of events.slice(rendered)) {
      const li = feedItem(v, e);
      if (li) log.append(li);
      if (!initial && e.type === 'chat' && e.from !== v.you.id) {
        const now = performance.now();
        if (now - lastCue >= CHAT_CUE_GAP_MS) {
          lastCue = now;
          ctx.audio.cue('chat');
        }
      }
    }
    if (events.length > rendered && stick) log.scrollTop = log.scrollHeight;
    rendered = events.length;
  };

  const renderSide = (v: PlayerView) => {
    const you = v.you;
    const matesKey = you.teammates.map((t) => `${t.id}${t.alive}${t.role}`).join();
    if (mates.dataset.key !== matesKey) {
      mates.dataset.key = matesKey;
      mates.replaceChildren(
        h('h3', { text: `Your ${fill('{mafia}')}` }),
        h(
          'ul',
          {},
          ...you.teammates.map((t) =>
            h(
              'li',
              { class: t.alive ? '' : 'is-dead' },
              h('span', { text: t.name }),
              h('span', {
                class: 'vx-mate-role',
                text: `${roleName(t.role)}${t.alive ? '' : ' †'}`,
              }),
            ),
          ),
        ),
      );
    }
    show(mates, you.teammates.length > 0);
    show(target, !!you.accuserTarget);
    if (you.accuserTarget) setText(target, `Your target: ${nameOf(v, you.accuserTarget)}`);

    const dead = v.players.filter((p) => !p.alive);
    const deadKey = dead.map((p) => `${p.id}${p.role}`).join();
    if (seanceList.dataset.key !== deadKey) {
      seanceList.dataset.key = deadKey;
      seanceList.replaceChildren(
        ...dead.map((p) => {
          const grave = v.graveyard.find((g) => g.id === p.id);
          const role = p.role ?? grave?.role ?? null;
          return h(
            'li',
            { class: p.id === you.id ? 'is-you' : '' },
            h('span', {
              class: 'vx-seance-name',
              text: p.id === you.id ? `${p.name} (you)` : p.name,
            }),
            h('span', { class: 'vx-seance-role', text: role ? roleName(role) : 'role hidden' }),
          );
        }),
      );
    }
    show(seance, dead.length > 0);
  };

  return {
    el,
    whisperOpen: () => current === 'whisper',
    recipient: () => rcpt,
    setRecipient,
    toggleWhisper() {
      if (current === 'whisper') {
        closeWhisper();
      } else if (view?.allowed.whisperTo.length) {
        setChannel('whisper');
        input.focus();
      }
    },
    update(v, s) {
      view = v;
      const key = `${v.phase.kind}:${v.phase.day}`;
      if (key !== phaseKey) {
        phaseKey = key;
        if (current === 'whisper') {
          current = null;
          rcpt = null;
        }
      }
      renderTabs(v);
      renderFeed(v);
      renderSide(v);
      const rej = s.lastRejection;
      if (rej && rej.id !== lastRejectionId) {
        lastRejectionId = rej.id;
        showRejection(rej.error);
      }
    },
  };
}
