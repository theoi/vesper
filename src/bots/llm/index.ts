/**
 * Optional Claude chat for bots. The host creates one `ChatLayer`, configures it
 * with the key from settings, and passes each bot line through `rewrite` (or
 * `voiceSpeech`) before applying it. Decisions stay scripted; only the wording
 * changes, and every failure falls back to the scripted line.
 *
 *   const chat = new ChatLayer({ ...loadSettings(localStorage) });
 *   chat.subscribe((s) => showStatus(s.state, s.detail));
 *   chat.newGame();
 *   const { speech } = await voiceSpeech(chat, viewFor(state, bot.id), d.speech[0]);
 *   applyIntent(state, bot.id, speech.intent, Date.now());
 */
export {
  ChatLayer,
  DEFAULT_LIMITS,
  PRICES,
  estimateCost,
  voiceSpeech,
  type ChatLayerOptions,
  type ChatLimits,
  type ChatMetrics,
  type ChatSettings,
  type ChatState,
  type ChatStatus,
  type FallbackReason,
  type RewriteResult,
} from './layer.ts';
export { ANTHROPIC_VERSION, DEFAULT_MODEL, type FetchLike, type Usage } from './client.ts';
export { buildPrompt, SYSTEM_PROMPT, type Prompt } from './prompt.ts';
export { checkReply, cleanReply, type GuardRule } from './guard.ts';
export {
  STORAGE_KEYS,
  clearSettings,
  loadSettings,
  saveSettings,
  type KeyValueStore,
} from './settings.ts';
