/**
 * Persisting the host's Claude settings. The key (or the relay URL and
 * passphrase) lives only in memory unless the host asks to remember it, and
 * then only in their own browser's storage.
 */
import type { ChatSettings } from './layer.ts';

/** The subset of the Web Storage API this module needs (e.g. `localStorage`). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const STORAGE_KEYS = {
  apiKey: 'vesper.claude.apiKey',
  model: 'vesper.claude.model',
  workspaceId: 'vesper.claude.workspaceId',
  enabled: 'vesper.claude.enabled',
  mode: 'vesper.claude.mode',
  relayUrl: 'vesper.claude.relayUrl',
  relayPassphrase: 'vesper.claude.relayPassphrase',
} as const;

export function loadSettings(store: KeyValueStore): Partial<ChatSettings> {
  const out: Partial<ChatSettings> = {};
  const key = store.getItem(STORAGE_KEYS.apiKey);
  if (key) out.apiKey = key;
  const model = store.getItem(STORAGE_KEYS.model);
  if (model) out.model = model;
  const ws = store.getItem(STORAGE_KEYS.workspaceId);
  if (ws) out.workspaceId = ws;
  const enabled = store.getItem(STORAGE_KEYS.enabled);
  if (enabled !== null) out.enabled = enabled !== 'false';
  const mode = store.getItem(STORAGE_KEYS.mode);
  if (mode === 'relay' || mode === 'key') out.mode = mode;
  const relayUrl = store.getItem(STORAGE_KEYS.relayUrl);
  if (relayUrl) out.relayUrl = relayUrl;
  const relayPassphrase = store.getItem(STORAGE_KEYS.relayPassphrase);
  if (relayPassphrase) out.relayPassphrase = relayPassphrase;
  return out;
}

/**
 * Save settings. Credentials in `settings` (the key, or the relay URL and
 * passphrase) are stored only with `rememberKey`; otherwise any stored copy is
 * removed, so they stay in memory for this session only. Fields left out of
 * `settings` are not touched.
 */
export function saveSettings(
  store: KeyValueStore,
  settings: Partial<ChatSettings>,
  rememberKey = false,
): void {
  const credential = (k: 'apiKey' | 'relayUrl' | 'relayPassphrase') => {
    if (!(k in settings)) return;
    const v = settings[k];
    if (rememberKey && v) store.setItem(STORAGE_KEYS[k], v);
    else store.removeItem(STORAGE_KEYS[k]);
  };
  credential('apiKey');
  credential('relayUrl');
  credential('relayPassphrase');
  if (settings.mode !== undefined) store.setItem(STORAGE_KEYS.mode, settings.mode);
  if (settings.model !== undefined) store.setItem(STORAGE_KEYS.model, settings.model);
  if (settings.workspaceId !== undefined) {
    if (settings.workspaceId) store.setItem(STORAGE_KEYS.workspaceId, settings.workspaceId);
    else store.removeItem(STORAGE_KEYS.workspaceId);
  }
  if (settings.enabled !== undefined) store.setItem(STORAGE_KEYS.enabled, String(settings.enabled));
}

/** Forget everything, including a remembered key. */
export function clearSettings(store: KeyValueStore): void {
  for (const k of Object.values(STORAGE_KEYS)) store.removeItem(k);
}
