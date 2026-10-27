import { ROLES, type PlayerView } from '../../engine/index.ts';
import { h, show, ticket } from '../dom.ts';
import type { UiContext } from '../screens/context.ts';

/** The will (and, for killers, the death note) as letters written by hand. */
export function createLetters(ctx: UiContext): { open(): void; update(view: PlayerView): void } {
  const c = ctx.controller;
  const will = h('textarea', {
    'data-testid': 'will-input',
    class: 'vx-hand',
    maxlength: 800,
    rows: 7,
    'aria-label': 'Your will',
    placeholder: 'What you know, what you did, whom you suspect…',
  });
  const willSave = ticket('Seal the will', { 'data-testid': 'will-save' }, 'primary');
  const willStatus = h('span', { class: 'vx-saved', role: 'status' });
  const note = h('textarea', {
    'data-testid': 'deathnote-input',
    class: 'vx-hand',
    maxlength: 300,
    rows: 3,
    'aria-label': 'Your death note',
    placeholder: 'Left on the body for the town to find…',
  });
  const noteSave = ticket('Seal the note', { 'data-testid': 'deathnote-save' }, 'danger');
  const noteStatus = h('span', { class: 'vx-saved', role: 'status' });
  const willHint = h('p', { class: 'vx-letter-hint' });
  const noteBox = h(
    'section',
    { class: 'vx-letter-sheet vx-letter-note', hidden: true },
    h('h3', { text: 'Death note' }),
    h('p', { class: 'vx-letter-hint', text: 'Shown on whoever you kill at night.' }),
    note,
    h('div', { class: 'vx-letter-actions' }, noteStatus, noteSave),
  );
  const content = h(
    'div',
    { class: 'vx-letters' },
    h(
      'section',
      { class: 'vx-letter-sheet' },
      h('h3', { text: 'Last will' }),
      willHint,
      will,
      h('div', { class: 'vx-letter-actions' }, willStatus, willSave),
    ),
    noteBox,
  );
  let willDirty = false;
  let noteDirty = false;
  will.oninput = () => (willDirty = true);
  note.oninput = () => (noteDirty = true);
  const flash = (el: HTMLElement, text: string) => {
    el.textContent = text;
    setTimeout(() => el.textContent === text && (el.textContent = ''), 2200);
  };
  willSave.onclick = () => {
    c.setWill(will.value);
    willDirty = false;
    flash(willStatus, 'Sealed.');
  };
  noteSave.onclick = () => {
    c.setDeathNote(note.value);
    noteDirty = false;
    flash(noteStatus, 'Sealed.');
  };
  let close: (() => void) | null = null;
  return {
    open() {
      if (close) return;
      close = ctx.modals.open({
        title: 'Your letters',
        content,
        className: 'vx-modal-letter',
        focus: will.disabled ? undefined : will,
        onClose: () => (close = null),
      });
    },
    update(view) {
      will.disabled = willSave.disabled = !view.allowed.will;
      willHint.textContent = view.allowed.will
        ? 'Read aloud to the town when you die.'
        : 'Your will can no longer be changed.';
      if (!willDirty && document.activeElement !== will) will.value = view.you.will;
      show(noteBox, ROLES[view.you.role].deathNote);
      note.disabled = noteSave.disabled = !view.allowed.deathNote;
      if (!noteDirty && document.activeElement !== note) note.value = view.you.deathNote;
    },
  };
}
