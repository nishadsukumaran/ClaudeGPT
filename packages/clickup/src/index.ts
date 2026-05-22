/**
 * @claudegpt/clickup — public surface.
 *
 * Phase 5 of the orchestrator. This package mirrors GitHub state into ClickUp
 * via the v2 REST API. There is no LLM in this codepath; it is deterministic.
 *
 * Wiring (done centrally in apps/worker/src/index.ts after all phases land):
 *
 *   import { runSync } from '@claudegpt/clickup';
 *   new Worker(QUEUE_NAMES.clickupSync, async (job) => runSync(job.data.jobId), ...)
 *
 * See agents/sync.md for the agent definition and docs/07-worker-jobs.md §6.4
 * for the payload contract.
 */

export { runSync } from './sync.js';
export type { SyncPayload, SyncResult } from './sync.js';
export {
  getTask,
  updateTaskStatus,
  createComment,
  moveTask,
  ClickUpApiError,
  resetClickUpClient,
} from './client.js';
export type { ClickUpTask, ClickUpComment } from './client.js';
export { resolveStatus, DEFAULT_STATUS_MAP } from './statusMap.js';
export {
  ensureTaskForIssue,
  moveTaskForIssue,
  moveTaskByPrNumber,
  createNishadActionTicket,
  commentOnIssueTask,
} from './lifecycle.js';
export type { Lane } from './lifecycle.js';
