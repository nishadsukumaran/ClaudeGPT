/**
 * @deprecated Compatibility shim. The QA reviewer moved to the Codex CLI
 * (ChatGPT Pro subscription auth). Import from './codexClient.js' instead.
 *
 * This file persists only because the workspace tooling cannot delete files
 * in this environment. Safe to remove manually.
 */

export {
  invokeCodex as getOpenAIClient,
  resetCodexClient as resetOpenAIClient,
  getQaModel,
  DEFAULT_QA_MODEL,
} from './codexClient.js';
