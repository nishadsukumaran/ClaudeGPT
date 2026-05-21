/**
 * @claudegpt/runner — Claude Code runner package.
 *
 * Public API used by the worker handlers in apps/worker/src/handlers/.
 * See docs/00-architecture.md §5.7 and docs/07-worker-jobs.md §10.
 */

export { runImplementation } from './runImplementation.js';
export { runRework } from './runRework.js';

// Subsystem exports (useful for tests and future composition).
export { createWorkspace, cleanupWorkspace } from './workspace.js';
export type { Workspace } from './workspace.js';
export {
  shallowClone,
  createBranch,
  checkoutExistingBranch,
  commitAll,
  pushBranch,
  headSha,
  redactCloneUrl,
} from './git.js';
export { runHook } from './hooks.js';
export type { HookName, HookResult } from './hooks.js';
export {
  runCommand,
  runValidationChain,
  toHookValidationShape,
  allValidationPassed,
} from './validate.js';
export type {
  ValidationStep,
  ValidationStatus,
  ValidationStepResult,
  ValidationResults,
  ProjectCommands,
} from './validate.js';
export { invokeClaude } from './claude.js';
export type {
  ClaudeStructuredResult,
  ClaudeInvocationOptions,
  ClaudeInvocationResult,
} from './claude.js';
export { buildPrompt, loadAgentDefinition } from './promptBuilder.js';
export type { AgentDefinition, PromptVariables } from './promptBuilder.js';
