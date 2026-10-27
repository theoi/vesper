import type { AppController, AppState } from '../../app/controller.ts';
import { h, ticket } from '../dom.ts';

/**
 * Host-only Claude settings: a direct key, or the host's own relay. Secret
 * inputs are cleared after saving; the key and passphrase never enter AppState.
 */
export function claudePanel(c: AppController): { el: HTMLElement; update(st: AppState): void } {
  const modeKey = h('input', {
    'data-testid': 'claude-mode-key',
    type: 'radio',
    name: 'vx-claude-mode',
    value: 'key',
  });
  const modeRelay = h('input', {
    'data-testid': 'claude-mode-relay',
    type: 'radio',
    name: 'vx-claude-mode',
    value: 'relay',
  });
  const key = h('input', {
    'data-testid': 'claude-key',
    type: 'password',
    autocomplete: 'off',
    'aria-label': 'Anthropic API key',
    placeholder: 'Anthropic API key (sk-ant-…)',
  });
  const save = ticket('Use key', { 'data-testid': 'claude-save' });
  const relayUrl = h('input', {
    'data-testid': 'claude-relay-url',
    type: 'url',
    autocomplete: 'off',
    'aria-label': 'Relay URL',
    placeholder: 'Relay URL (https://….workers.dev)',
  });
  const relayPass = h('input', {
    'data-testid': 'claude-relay-passphrase',
    type: 'password',
    autocomplete: 'off',
    'aria-label': 'Relay passphrase',
    placeholder: 'Relay passphrase',
  });
  const relaySave = ticket('Use relay', { 'data-testid': 'claude-relay-save' });
  const remember = h('input', { 'data-testid': 'claude-remember', type: 'checkbox' });
  const test = ticket('Test', { 'data-testid': 'claude-test' }, 'ghost');
  const forget = ticket('Forget', { 'data-testid': 'claude-forget' }, 'ghost');
  const enabled = h('input', { 'data-testid': 'claude-enabled', type: 'checkbox' });
  const model = h('input', { 'data-testid': 'claude-model', 'aria-label': 'Model' });
  const workspace = h('input', {
    'data-testid': 'claude-workspace',
    'aria-label': 'Workspace ID',
    placeholder: 'Workspace ID (optional)',
  });
  const status = h('p', { 'data-testid': 'claude-status', class: 'vx-claude-status' });
  const usage = h('p', { 'data-testid': 'claude-usage', class: 'vx-hint' });
  save.onclick = () => {
    const value = key.value.trim();
    if (!value) return;
    c.setClaudeKey(value, { remember: remember.checked });
    key.value = '';
    void c.testClaude();
  };
  key.onkeydown = (e) => e.key === 'Enter' && save.click();
  relaySave.onclick = () => {
    const url = relayUrl.value.trim();
    const pass = relayPass.value.trim();
    if (!url || !pass) return;
    c.setClaudeRelay(url, pass, { remember: remember.checked });
    relayPass.value = '';
    void c.testClaude();
  };
  relayPass.onkeydown = (e) => e.key === 'Enter' && relaySave.click();
  modeKey.onchange = () => modeKey.checked && c.setClaudeMode('key');
  modeRelay.onchange = () => modeRelay.checked && c.setClaudeMode('relay');
  test.onclick = () => void c.testClaude();
  forget.onclick = () => c.forgetClaude();
  enabled.onchange = () => c.setClaudeSettings({ enabled: enabled.checked });
  model.onchange = () => c.setClaudeSettings({ model: model.value });
  workspace.onchange = () => c.setClaudeSettings({ workspaceId: workspace.value || null });
  const keyRow = h('div', { class: 'vx-claude-row' }, key, save, workspace);
  const relayRow = h('div', { class: 'vx-claude-row' }, relayUrl, relayPass, relaySave);
  const help = h('p', { class: 'vx-hint' });
  const el = h(
    'section',
    { 'data-testid': 'claude-panel', class: 'vx-bill-section vx-claude' },
    h('h2', { class: 'vx-bill-head', text: 'Claude bots' }),
    h('p', { class: 'vx-hint', text: 'Optional: bots write their lines with Claude.' }),
    h(
      'div',
      { class: 'vx-claude-modes' },
      h('label', { class: 'vx-check-inline' }, modeKey, ' API key'),
      h('label', { class: 'vx-check-inline' }, modeRelay, ' My relay'),
    ),
    help,
    keyRow,
    relayRow,
    h(
      'div',
      { class: 'vx-claude-row' },
      h('label', { class: 'vx-check-inline' }, remember, ' Remember on this device'),
      h('label', { class: 'vx-check-inline' }, enabled, ' Use Claude'),
    ),
    h(
      'div',
      { class: 'vx-claude-row' },
      h('label', { class: 'vx-inline-label' }, 'Model ', model),
      test,
      forget,
    ),
    status,
    usage,
  );
  return {
    el,
    update: (st) => {
      const cl = st.claude;
      const relay = cl.mode === 'relay';
      modeKey.checked = !relay;
      modeRelay.checked = relay;
      keyRow.hidden = relay;
      relayRow.hidden = !relay;
      help.textContent = relay
        ? 'Your relay (a small Cloudflare Worker you deploy) holds the Anthropic key. This browser sends only the passphrase, and only to your relay. Setup steps are in the README.'
        : 'The key stays in this browser and goes only to Anthropic; other players never receive it.';
      status.dataset.state = cl.status.state;
      status.textContent = `${cl.status.state}: ${cl.status.detail}`;
      key.placeholder = cl.hasKey
        ? `Key set${!relay && cl.remembered ? ' and remembered' : ' for this session'} (hidden)`
        : 'Anthropic API key (sk-ant-…)';
      relayPass.placeholder = cl.hasRelay
        ? `Passphrase set${relay && cl.remembered ? ' and remembered' : ''} (hidden)`
        : 'Relay passphrase';
      if (document.activeElement !== relayUrl && cl.relayUrl) relayUrl.value = cl.relayUrl;
      test.disabled = forget.disabled = !cl.ready;
      enabled.checked = cl.enabled;
      remember.checked = cl.remembered;
      if (document.activeElement !== model) model.value = cl.model;
      if (document.activeElement !== workspace) workspace.value = cl.workspaceId ?? '';
      usage.textContent = cl.ready ? `Per-game budget: ${cl.maxCallsPerGame} calls.` : '';
    },
  };
}
