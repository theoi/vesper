/** Tiny DOM builder shared by the screens and the HUD. */

type AttrValue = string | number | boolean | null | undefined;
export type Attrs = Record<string, AttrValue>;
export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

/** A ticket-styled button. `kind` picks the look; `tk` buttons play the UI click. */
export function ticket(
  label: string,
  attrs: Attrs = {},
  kind: 'primary' | 'plain' | 'ghost' | 'danger' = 'plain',
): HTMLButtonElement {
  const cls = ['tk', `tk-${kind}`, attrs.class].filter(Boolean).join(' ');
  return h('button', { type: 'button', ...attrs, class: cls, text: label });
}

export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function show(el: HTMLElement, visible: boolean): void {
  if (el.hidden === visible) el.hidden = !visible;
}
