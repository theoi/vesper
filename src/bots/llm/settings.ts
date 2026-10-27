/**
 * Persisting the host's Claude settings. The key lives only in memory unless the
 * host asks to remember it, and then only in their own browser's storage.
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
  return out;
}

/**
 * Save settings. With `rememberKey` false (the default) any stored key is
 * removed, so the key stays in memory for this session only.
 */
export function saveSettings(
  store: KeyValueStore,
  settings: Partial<ChatSettings>,
  rememberKey = false,
): void {
  if (rememberKey && settings.apiKey) store.setItem(STORAGE_KEYS.apiKey, settings.apiKey);
  else store.removeItem(STORAGE_KEYS.apiKey);
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
