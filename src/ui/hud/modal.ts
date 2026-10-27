import { h } from '../dom.ts';

export interface ModalOptions {
  title: string;
  content: Node;
  className?: string;
  /** Element to focus when the modal opens (defaults to the close button). */
  focus?: HTMLElement;
  onClose?: () => void;
}

export interface ModalHost {
  readonly el: HTMLElement;
  /** Opens a modal; returns a function that closes it. */
  open(opts: ModalOptions): () => void;
  /** Closes the topmost modal; false when none was open. */
  closeTop(): boolean;
  closeAll(): void;
}

interface Entry {
  node: HTMLElement;
  onClose?: () => void;
  restore: HTMLElement | null;
}

export function createModalHost(): ModalHost {
  const el = h('div', { class: 'vx-modals' });
  const stack: Entry[] = [];
  const close = (entry: Entry) => {
    const i = stack.indexOf(entry);
    if (i < 0) return;
    stack.splice(i, 1);
    entry.node.remove();
    entry.onClose?.();
    if (entry.restore?.isConnected) entry.restore.focus();
  };
  return {
    el,
    open({ title, content, className, focus, onClose }) {
      const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const closeBtn = h('button', {
        type: 'button',
        class: 'vx-modal-close',
        'aria-label': 'Close',
        text: '×',
      });
      const dialog = h(
        'div',
        {
          class: ['vx-modal', className].filter(Boolean).join(' '),
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': title,
        },
        h('header', { class: 'vx-modal-head' }, h('h2', { text: title }), closeBtn),
        h('div', { class: 'vx-modal-body' }, content),
      );
      const node = h('div', { class: 'vx-modal-backdrop' }, dialog);
      const entry: Entry = { node, onClose, restore };
      closeBtn.onclick = () => close(entry);
      node.addEventListener('pointerdown', (e) => {
        if (e.target === node) close(entry);
      });
      stack.push(entry);
      el.append(node);
      (focus ?? closeBtn).focus();
      return () => close(entry);
    },
    closeTop() {
      const top = stack.at(-1);
      if (!top) return false;
      close(top);
      return true;
    },
    closeAll() {
      for (const e of [...stack].reverse()) close(e);
    },
  };
}
